import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildToolInstructions,
  formatToolCall,
  parseToolCalls,
  toolCallDeltas,
  toolNames,
} from "./tools.js";
import type { OpenAITool } from "./tools.js";

const READ_FILE: OpenAITool = {
  type: "function",
  function: {
    name: "read_file",
    description: "Read a file from disk.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
};

const RUN: OpenAITool = {
  type: "function",
  function: { name: "run", description: "Run a command." },
};

test("injects nothing when no tools are offered", () => {
  assert.equal(buildToolInstructions(undefined), null);
  assert.equal(buildToolInstructions([]), null);
});

// `tool_choice: "none"` is a client saying "not this turn". Injecting the
// schemas anyway would spend context and invite a call it asked not to get.
test("injects nothing when tool_choice is none", () => {
  assert.equal(buildToolInstructions([READ_FILE], "none"), null);
});

test("renders each tool's name, description and schema", () => {
  const prompt = buildToolInstructions([READ_FILE, RUN])!;

  assert.match(prompt, /read_file/);
  assert.match(prompt, /Read a file from disk\./);
  assert.match(prompt, /"required":\["path"\]/);
  assert.match(prompt, /### run/);
  assert.match(prompt, /<tool_call>/);
});

test("demands a call when tool_choice requires one", () => {
  assert.match(buildToolInstructions([READ_FILE], "required")!, /must call at least one/);
  assert.match(
    buildToolInstructions([READ_FILE, RUN], { type: "function", function: { name: "run" } })!,
    /must call `run`/,
  );
  assert.match(buildToolInstructions([READ_FILE])!, /just reply normally/);
});

test("lists the callable names", () => {
  assert.deepEqual(toolNames([READ_FILE, RUN]), ["read_file", "run"]);
  assert.deepEqual(toolNames(undefined), []);
});

test("parses the tagged form the prompt asks for", () => {
  const { content, toolCalls } = parseToolCalls(
    '<tool_call>\n{"name": "read_file", "arguments": {"path": "a.ts"}}\n</tool_call>',
    ["read_file"],
  );

  assert.equal(content, null);
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0]?.type, "function");
  assert.match(toolCalls[0]!.id, /^call_/);
  assert.equal(toolCalls[0]?.function.name, "read_file");
  // OpenAI carries arguments as a JSON *string*, not an object — clients
  // JSON.parse it, and an object here breaks them.
  assert.equal(typeof toolCalls[0]?.function.arguments, "string");
  assert.deepEqual(JSON.parse(toolCalls[0]!.function.arguments), { path: "a.ts" });
});

// A prompted model narrates. The call has to survive being surrounded by
// explanation, and the explanation has to survive being separated from it.
test("keeps prose around a call as content", () => {
  const { content, toolCalls } = parseToolCalls(
    'Let me look.\n<tool_call>{"name":"run","arguments":{"cmd":"ls"}}</tool_call>\nStand by.',
    ["run"],
  );

  assert.equal(toolCalls.length, 1);
  assert.equal(content, "Let me look.\n\nStand by.");
});

test("parses a fenced json block when the tags are missing", () => {
  const { toolCalls } = parseToolCalls(
    '```json\n{"name": "run", "arguments": {"cmd": "ls"}}\n```',
    ["run"],
  );

  assert.equal(toolCalls[0]?.function.name, "run");
});

test("parses a reply that is nothing but a json object", () => {
  const { content, toolCalls } = parseToolCalls('{"name":"run","arguments":{"cmd":"ls"}}', ["run"]);

  assert.equal(content, null);
  assert.equal(toolCalls[0]?.function.name, "run");
});

test("parses several calls in one reply with ascending index", () => {
  const { toolCalls } = parseToolCalls(
    '<tool_call>{"name":"run","arguments":{"cmd":"ls"}}</tool_call>' +
      '<tool_call>{"name":"read_file","arguments":{"path":"a.ts"}}</tool_call>',
    ["run", "read_file"],
  );

  assert.deepEqual(
    toolCalls.map((c) => c.function.name),
    ["run", "read_file"],
  );
  assert.deepEqual(
    toolCallDeltas(toolCalls).map((d) => d.index),
    [0, 1],
  );
});

test("parses an array of calls inside one block", () => {
  const { toolCalls } = parseToolCalls(
    '<tool_call>[{"name":"run","arguments":{}},{"name":"run","arguments":{}}]</tool_call>',
    ["run"],
  );

  assert.equal(toolCalls.length, 2);
});

// Models emit the same call in whichever envelope they were trained on.
test("unwraps the envelopes models actually produce", () => {
  for (const body of [
    '{"tool_call": {"name": "run", "arguments": {}}}',
    '{"type": "function", "function": {"name": "run", "arguments": {}}}',
    '{"name": "run", "parameters": {}}',
    '{"name": "run", "arguments": "{}"}',
  ]) {
    const { toolCalls } = parseToolCalls(`<tool_call>${body}</tool_call>`, ["run"]);
    assert.equal(toolCalls[0]?.function.name, "run", body);
    assert.doesNotThrow(() => JSON.parse(toolCalls[0]!.function.arguments), body);
  }
});

// A model shown the tag syntax will use it to *talk about* a tool. Calling
// something that was never offered is worse than leaving it as prose.
test("treats an unoffered tool name as prose", () => {
  const text = '<tool_call>{"name":"rm_rf","arguments":{}}</tool_call>';
  const { content, toolCalls } = parseToolCalls(text, ["run"]);

  assert.equal(toolCalls.length, 0);
  assert.equal(content, text);
});

test("leaves an ordinary reply alone", () => {
  const { content, toolCalls } = parseToolCalls("Just an answer.", ["run"]);

  assert.equal(toolCalls.length, 0);
  assert.equal(content, "Just an answer.");
});

test("round-trips a call back into the protocol", () => {
  const call = {
    id: "call_1",
    type: "function" as const,
    function: { name: "run", arguments: '{"cmd":"ls"}' },
  };

  const { toolCalls } = parseToolCalls(formatToolCall(call), ["run"]);
  assert.equal(toolCalls[0]?.function.name, "run");
  assert.deepEqual(JSON.parse(toolCalls[0]!.function.arguments), { cmd: "ls" });
});
