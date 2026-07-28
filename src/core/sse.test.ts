import { test } from "node:test";
import assert from "node:assert/strict";
import { createSseReader } from "./sse.js";
import type { MatthewToolCall } from "./sse.js";

function collect(chunks: string[]) {
  const text: string[] = [];
  const toolCalls: MatthewToolCall[] = [];
  const usage = { prompt: 0, completion: 0 };
  let errored: string | null = null;
  let completed = false;

  const sse = createSseReader({
    onText: (t) => text.push(t),
    onToolCall: (c) => toolCalls.push(c),
    onPromptTokens: (n) => (usage.prompt += n),
    onCompletionTokens: (n) => (usage.completion += n),
    onError: (e) => (errored = e),
    onComplete: () => (completed = true),
  });

  for (const chunk of chunks) sse.push(chunk);
  sse.flush();

  return { text, toolCalls, usage, errored, completed, finished: sse.finished };
}

// The whole reason this is a state machine: which handler a `data:` line
// belongs to is decided by the `event:` line before it, and the two can
// arrive in different reads from the socket.
test("keeps the event name across a chunk boundary", () => {
  const result = collect(["event: ctoken\n", "data: 42\n\n"]);

  assert.deepEqual(result.usage, { prompt: 0, completion: 42 });
  assert.deepEqual(result.text, []);
});

test("splits a line that arrives in two reads", () => {
  const result = collect(['data: {"mess', 'age":"hi"}\n\n']);
  assert.deepEqual(result.text, ["hi"]);
});

test("treats an unlabelled data line as a message", () => {
  assert.deepEqual(collect(['data: {"message":"plain"}\n\n']).text, ["plain"]);
});

test("stops at complete", () => {
  const result = collect(["event: complete\ndata: {}\n\n", 'data: {"message":"after"}\n\n']);

  assert.ok(result.completed);
  assert.ok(result.finished);
  assert.deepEqual(result.text, []);
});

test("reports an error event and stops", () => {
  const result = collect(["event: error\ndata: quota exceeded\n\n"]);

  assert.equal(result.errored, "quota exceeded");
  assert.ok(result.finished);
});

test("parses a tool call with its id and arguments", () => {
  const result = collect([
    'event: tool_call\ndata: {"name":"run_data_analysis","tool_call_id":"tc","arguments":{"file_id":"f"}}\n\n',
  ]);

  assert.deepEqual(result.toolCalls, [
    { name: "run_data_analysis", toolCallId: "tc", arguments: { file_id: "f" } },
  ]);
});

// A call with no id cannot be answered, so surfacing it would produce a
// submit_tool_result Matthew rejects.
test("drops a tool call missing its id", () => {
  const result = collect(['event: tool_call\ndata: {"name":"x"}\n\n']);
  assert.deepEqual(result.toolCalls, []);
});

test("ignores events with no OpenAI equivalent", () => {
  const result = collect([
    'event: web_sources\ndata: [{"url":"http://x"}]\n\n',
    'event: tool\ndata: {"tool":"code_interpreter"}\n\n',
    'event: progress\ndata: 50\n\n',
    'data: {"message":"real"}\n\n',
  ]);

  assert.deepEqual(result.text, ["real"]);
  assert.deepEqual(result.toolCalls, []);
});

test("survives malformed json without losing the stream", () => {
  const result = collect(["data: {not json\n\n", 'data: {"message":"ok"}\n\n']);
  assert.deepEqual(result.text, ["ok"]);
});
