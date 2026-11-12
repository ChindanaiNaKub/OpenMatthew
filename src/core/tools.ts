/**
 * Prompted emulation of OpenAI tool calling.
 *
 * Matthew's API takes a string and returns a string. It has no tool slot,
 * no function schema, no `tool_calls` in its response — and it is not ours
 * to extend. But every agent platform worth pointing at this server drives
 * its loop with tool calls, so without them the server is a chat box that
 * only *looks* like an agent backend.
 *
 * So the tools are rendered into the prompt, the model is asked for a
 * specific textual protocol back, and that protocol is parsed into OpenAI
 * `tool_calls` on the way out. The agent never learns the difference.
 *
 * This is emulation, not native tool calling: a prompted model obeys a
 * format roughly rather than exactly, which is why the parser accepts
 * three shapes and why unknown tool names are treated as prose.
 */

import { randomUUID } from "node:crypto";

export interface OpenAIFunctionDef {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface OpenAITool {
  type?: string;
  function: OpenAIFunctionDef;
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type?: string; function?: { name?: string } };

/** The tag pair the model is asked to wrap calls in. */
export const TOOL_CALL_OPEN = "<tool_call>";
export const TOOL_CALL_CLOSE = "</tool_call>";

export function newToolCallId(): string {
  return `call_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function namedChoice(toolChoice: ToolChoice | undefined): string | null {
  if (!toolChoice || typeof toolChoice === "string") return null;
  const name = toolChoice.function?.name;
  return typeof name === "string" && name ? name : null;
}

/**
 * The tool names the model is allowed to call. Anything else it emits is
 * treated as prose, since a model that has been *shown* the tag syntax
 * will sometimes use it to talk about a tool rather than to call one.
 */
export function toolNames(tools: OpenAITool[] | undefined): string[] {
  return (tools ?? [])
    .map((tool) => tool?.function?.name)
    .filter((name): name is string => typeof name === "string" && name.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function typeName(expected: unknown): string {
  if (Array.isArray(expected)) {
    return expected.filter((type) => typeof type === "string").join(" or ");
  }
  return typeof expected === "string" ? expected : "the declared type";
}

function matchesType(value: unknown, expected: unknown): boolean {
  const types = Array.isArray(expected) ? expected : [expected];
  return types.some((type) => {
    if (typeof type !== "string") return true;
    if (type === "integer") return typeof value === "number" && Number.isInteger(value);
    return jsonType(value) === type;
  });
}

/**
 * Check one call against the tool's parameter schema. Returns a problem
 * description, or null when the arguments fit.
 *
 * shortcut: only the top level of each schema is checked; use a full JSON
 * Schema validator if nested schemas become common.
 */
export function validateToolCall(call: OpenAIToolCall, tools: OpenAITool[]): string | null {
  const tool = tools.find((candidate) => candidate?.function?.name === call.function.name);
  if (!tool) return "is not one of the offered tools";

  let args: unknown;
  try {
    args = JSON.parse(call.function.arguments) as unknown;
  } catch {
    return "has arguments that are not valid JSON";
  }
  if (!isRecord(args)) return "must pass a JSON object as arguments";

  const schema = isRecord(tool.function.parameters) ? tool.function.parameters : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (typeof key === "string" && !(key in args)) return `is missing required property "${key}"`;
  }

  const properties = isRecord(schema.properties) ? schema.properties : {};
  for (const [key, value] of Object.entries(args)) {
    const property = properties[key];
    if (!isRecord(property)) continue;

    if (property.type !== undefined && !matchesType(value, property.type)) {
      return `property "${key}" must be ${typeName(property.type)}, got ${jsonType(value)}`;
    }

    if (Array.isArray(property.enum) && !property.enum.some((option) => Object.is(option, value))) {
      const options = property.enum.map((option) => JSON.stringify(option)).join(", ");
      return `property "${key}" must be one of ${options}`;
    }
  }

  return null;
}

/** Every problem across a reply's calls, each prefixed with the tool name. */
export function validateToolCalls(calls: OpenAIToolCall[], tools: OpenAITool[]): string[] {
  return calls.flatMap((call) => {
    const problem = validateToolCall(call, tools);
    return problem ? [`${call.function.name} ${problem}`] : [];
  });
}

/** The one follow-up the model gets when its calls do not fit the schemas. */
export function toolCallCorrection(issues: string[]): string {
  return [
    "# Invalid tool calls",
    "",
    "Your previous reply had these problems:",
    ...issues.map((issue) => `- ${issue}`),
    "",
    "Reply again with corrected tool_call blocks. Match each tool's parameter schema, and add no prose.",
  ].join("\n");
}

/**
 * Render the tool schemas and the output protocol as prompt text.
 *
 * Returns null when there is nothing to inject — no tools, or
 * `tool_choice: "none"` — which is also the signal to skip parsing the
 * reply. A response is only searched for tool calls when tools were
 * offered, so ordinary chat can mention `<tool_call>` without it being
 * mistaken for one.
 */
export function buildToolInstructions(
  tools: OpenAITool[] | undefined,
  toolChoice?: ToolChoice,
): string | null {
  if (toolChoice === "none") return null;

  const usable = (tools ?? []).filter((tool) => tool?.function?.name);
  if (usable.length === 0) return null;

  const forced = namedChoice(toolChoice);

  const lines: string[] = [
    "# Tools",
    "",
    "You can call tools. To call one, emit a block exactly like this, on its own lines:",
    "",
    TOOL_CALL_OPEN,
    '{"name": "tool_name", "arguments": {"first": "value"}}',
    TOOL_CALL_CLOSE,
    "",
    "Rules:",
    "- `arguments` must be a JSON object matching that tool's parameter schema.",
    "- Emit one block per call. Several blocks in one reply are allowed.",
    "- Describing a call in prose does nothing — only the block above is executed.",
    "- Do not invent tools. Only the names listed below exist.",
  ];

  if (forced) {
    lines.push(`- You must call \`${forced}\` in this reply.`);
  } else if (toolChoice === "required") {
    lines.push("- You must call at least one tool in this reply.");
  } else {
    lines.push("- If no tool is needed, just reply normally.");
  }

  lines.push("", "## Available tools", "");

  for (const tool of usable) {
    const fn = tool.function;
    lines.push(`### ${fn.name}`);
    if (fn.description) lines.push(fn.description);
    lines.push(
      `Parameters (JSON Schema): ${JSON.stringify(fn.parameters ?? { type: "object", properties: {} })}`,
      "",
    );
  }

  return lines.join("\n").trimEnd();
}

/** Render a call back into the protocol, so the model sees its own turn. */
export function formatToolCall(call: OpenAIToolCall): string {
  return [
    TOOL_CALL_OPEN,
    JSON.stringify({
      name: call.function.name,
      arguments: safeParseArguments(call.function.arguments),
    }),
    TOOL_CALL_CLOSE,
  ].join("\n");
}

function safeParseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

/**
 * Normalize one candidate JSON blob into a tool call, or null if it isn't
 * one. Models wrap the same call in several envelopes depending on which
 * API they were trained against, so all of them are unwrapped here rather
 * than demanding the one shape the prompt asked for.
 */
function normalizeCall(value: unknown, allowed: Set<string> | null): OpenAIToolCall | null {
  if (!value || typeof value !== "object") return null;
  let record = value as Record<string, unknown>;

  // {"tool_call": {...}} / {"function": {...}} / {"type": "function", "function": {...}}
  for (const key of ["tool_call", "function_call", "function"]) {
    const inner = record[key];
    if (inner && typeof inner === "object") {
      record = inner as Record<string, unknown>;
      break;
    }
  }

  const name = record.name ?? record.tool ?? record.tool_name;
  if (typeof name !== "string" || !name) return null;
  if (allowed && !allowed.has(name)) return null;

  const rawArgs = record.arguments ?? record.parameters ?? record.args ?? {};

  let args: string;
  if (typeof rawArgs === "string") {
    // Already serialized — keep it verbatim if it is really JSON, since the
    // client will JSON.parse it, and drop it if it isn't.
    try {
      JSON.parse(rawArgs);
      args = rawArgs;
    } catch {
      args = "{}";
    }
  } else {
    args = JSON.stringify(rawArgs);
  }

  return { id: newToolCallId(), type: "function", function: { name, arguments: args } };
}

const TAG_BLOCK = /<tool_call>([\s\S]*?)<\/tool_call>/g;
const FENCED_BLOCK = /```(?:json|tool_call|tool_calls)?\s*\n([\s\S]*?)```/g;

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw.trim()) as unknown;
  } catch {
    return null;
  }
}

/** The calls in one parsed value: a single object, or an array of them. */
function callsIn(value: unknown, allowed: Set<string> | null): OpenAIToolCall[] {
  const candidates = Array.isArray(value) ? value : [value];
  return candidates
    .map((candidate) => normalizeCall(candidate, allowed))
    .filter((call): call is OpenAIToolCall => call !== null);
}

export interface ParsedReply {
  /** Prose left over once the call blocks are lifted out; null if none. */
  content: string | null;
  toolCalls: OpenAIToolCall[];
}

/**
 * Pull tool calls out of a model reply.
 *
 * Three shapes are accepted, in descending order of confidence: the tag
 * pair the prompt asked for, a fenced JSON block, and a reply that is
 * nothing but a JSON object. Only the first shape that yields a call is
 * used — mixing them would double-count a fenced block that also carries
 * tags.
 */
export function parseToolCalls(text: string, allowedNames?: string[] | null): ParsedReply {
  const allowed = allowedNames && allowedNames.length > 0 ? new Set(allowedNames) : null;

  for (const pattern of [TAG_BLOCK, FENCED_BLOCK]) {
    const calls: OpenAIToolCall[] = [];
    // Only blocks that hold a call are lifted out. Other blocks stay as prose.
    // One block may hold an array of calls, or several concatenated objects.
    const remaining = text.replace(pattern, (block: string, inner: string) => {
      const found = callsIn(parseJson(inner), allowed);
      if (found.length === 0) return block;
      calls.push(...found);
      return "";
    });

    if (calls.length > 0) {
      const content = remaining.trim();
      return { content: content || null, toolCalls: calls };
    }
  }

  // A reply that is a bare JSON object and nothing else.
  const bare = callsIn(parseJson(text), allowed);
  if (bare.length > 0) return { content: null, toolCalls: bare };

  return { content: text, toolCalls: [] };
}

/**
 * Streaming deltas for a set of calls.
 *
 * Each call is emitted whole in a single delta rather than split across
 * fragments. OpenAI's own stream dribbles `function.arguments` out piece
 * by piece, but clients accumulate by `index` either way, and there is
 * nothing to gain from faking the fragmentation: the calls are only
 * recognisable here once the full reply has already arrived.
 */
export function toolCallDeltas(calls: OpenAIToolCall[]): Record<string, unknown>[] {
  return calls.map((call, index) => ({
    index,
    id: call.id,
    type: "function",
    function: { name: call.function.name, arguments: call.function.arguments },
  }));
}
