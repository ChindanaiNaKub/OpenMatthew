/**
 * Platform-agnostic Matthew chat client.
 * Transforms an OpenAI-format chat/completions request into calls against
 * Matthew's thread-based API (FormData + SSE), and normalizes the response
 * back into OpenAI's chat/completions shape. No host-platform dependency.
 */

import { randomUUID } from "node:crypto";
import { CLIENT_NAME } from "../constants.js";
import {
  createReplyParser,
  jsonResponse,
  openReplyStream,
  openThread,
  readWholeReply,
  sseResponse,
} from "./matthew.js";
import {
  buildToolInstructions,
  formatToolCall,
  parseToolCalls,
  toolCallDeltas,
  toolNames,
} from "./tools.js";
import type { OpenAITool, OpenAIToolCall, ToolChoice } from "./tools.js";
import type { UsageStats } from "./usage.js";

/**
 * OpenAI allows `content` to be a string, a list of typed parts, or null
 * on an assistant turn that only carries tool calls. Clients that use
 * tools tend to send the list form, so all three have to survive the trip
 * into Matthew's single string field.
 */
export type OpenAIContentPart = { type?: string; text?: string };

export interface OpenAIMessage {
  role: string;
  content?: string | OpenAIContentPart[] | null;
  /** Present on `role: "tool"`, naming the call this answers. */
  tool_call_id?: string;
  /** The tool's own name, on some clients. */
  name?: string;
  /** Present on an assistant turn that called tools. */
  tool_calls?: OpenAIToolCall[];
}

/** Flatten any of the three `content` shapes into plain text. */
export function messageText(message: OpenAIMessage | undefined): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/**
 * OpenAI responses carry an `id`/`object`/`created` envelope around the
 * choices. Plenty of clients and SDKs validate those fields and reject a
 * payload without them, so every response has to be wrapped even though
 * Matthew supplies none of it.
 */
function newCompletionId(): string {
  return `chatcmpl-${randomUUID().replace(/-/g, "")}`;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  tools?: OpenAITool[];
  tool_choice?: ToolChoice;
}

/**
 * Flatten an OpenAI conversation into the single message Matthew accepts.
 *
 * Matthew keeps conversation state server-side per thread, but every
 * request here opens a fresh thread (`thread_id: "newchat"`), and OpenAI
 * clients are stateless — they resend the whole conversation each turn. So
 * the history has to travel inside the message body, or the system prompt
 * and every prior turn are silently lost.
 */
export function serializeConversation(messages: OpenAIMessage[]): string {
  if (messages.length === 0) return "";

  const lastIndex = messages.length - 1;
  const last = messages[lastIndex];

  // A lone user message is the common case — send it verbatim so simple
  // requests reach Matthew looking exactly like a person typed them.
  if (messages.length === 1 && last?.role === "user") {
    return messageText(last);
  }

  // A tool result names the call it answers by id, not by name, so the
  // names have to come from the assistant turn that made the call. Without
  // this the model sees an unlabelled blob of output and has to guess
  // which of its calls produced it.
  const callNames = new Map<string, string>();
  for (const message of messages) {
    for (const call of message.tool_calls ?? []) {
      if (call?.id && call.function?.name) callNames.set(call.id, call.function.name);
    }
  }

  const render = (message: OpenAIMessage | undefined): string => {
    if (!message) return "";
    const text = messageText(message);

    if (message.role === "tool") {
      const name = message.name || callNames.get(message.tool_call_id ?? "") || "tool";
      return `Tool result (${name}): ${text}`;
    }

    if (message.role === "assistant") {
      const calls = (message.tool_calls ?? []).map(formatToolCall);
      const body = [text, ...calls].filter(Boolean).join("\n");
      return `Assistant: ${body}`;
    }

    const label = message.role === "system" ? "Instructions" : "User";
    return `${label}: ${text}`;
  };

  const transcript = messages.slice(0, lastIndex).map(render);

  const closing =
    last?.role === "user"
      ? "Respond to the final User message above."
      : last?.role === "tool"
        ? "Continue, using the tool result above."
        : "Continue.";

  return [...transcript, `${render(last)}\n\n${closing}`].join("\n\n");
}

export async function handleMatthewChat(
  body: OpenAIChatRequest,
  accessToken: string,
  sessionToken: string,
  assistantId: string,
  apiBase: string,
  clientName = CLIENT_NAME,
): Promise<Response> {
  // Matthew has no tool slot, so the schemas ride in front of the
  // conversation as prompt text. A null block means tools were not offered
  // (or were declined with `tool_choice: "none"`), which is also what stops
  // the reply from being searched for calls.
  const toolBlock = buildToolInstructions(body.tools, body.tool_choice);
  const conversation = serializeConversation(body.messages ?? []);
  const messageBody = toolBlock
    ? `${toolBlock}\n\n# Conversation\n\n${conversation}`
    : conversation;
  const allowedTools = toolBlock ? toolNames(body.tools) : null;

  const opened = await openThread(messageBody, accessToken, sessionToken, assistantId, apiBase, clientName);
  if ("error" in opened) return opened.error;
  const threadId = opened.threadId;

  if (body.stream === false) {
    return handleNonStreaming(threadId, accessToken, apiBase, body.model, allowedTools);
  }

  return handleStreaming(threadId, accessToken, apiBase, body.model, allowedTools);
}

const DONE = "data: [DONE]\n\n";

function formatOpenAISSE(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/** Builds SSE chunks that share one completion id and timestamp. */
function chunkWriter(model: string): (choices: unknown[], extra?: Record<string, unknown>) => string {
  const envelope = {
    id: newCompletionId(),
    object: "chat.completion.chunk",
    created: nowSeconds(),
    model,
  };
  return (choices, extra = {}) => formatOpenAISSE({ ...envelope, choices, ...extra });
}

export async function handleStreaming(
  threadId: string,
  accessToken: string,
  apiBase: string,
  model: string,
  allowedTools?: string[] | null,
): Promise<Response> {
  // A tool call is not recognisable until its closing tag arrives, so when
  // tools are in play the whole reply is read before anything is emitted.
  // Streaming content out and retracting it once a call turns up is not
  // expressible in OpenAI's wire format.
  if (allowedTools) {
    return streamBuffered(threadId, accessToken, apiBase, model, allowedTools);
  }

  const opened = await openReplyStream(threadId, accessToken, apiBase);
  if ("error" in opened) return opened.error;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = opened.body.getReader();
  const chunk = chunkWriter(model);
  const out: string[] = [];

  const reply = createReplyParser({
    onText: (content) => {
      out.push(chunk([{ delta: { content, role: "assistant" }, finish_reason: null, index: 0 }]));
    },
    onError: (message) => {
      out.push(
        chunk([{ delta: { content: `\n[Error: ${message}]` }, finish_reason: "stop", index: 0 }]),
        DONE,
      );
    },
    onEnd: () => {
      const usage = reply.usage();
      out.push(
        chunk([{ delta: {}, finish_reason: "stop", index: 0 }], usage ? { usage } : {}),
        DONE,
      );
    },
  });

  // Pull until something is ready to send. A chunk with only event lines
  // yields nothing, and the stream would never pull again.
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (out.length === 0 && !reply.done) {
        const { done, value } = await reader.read();
        if (done) {
          reply.push(decoder.decode());
          reply.end();
        } else {
          reply.push(decoder.decode(value, { stream: true }));
        }
      }
      if (out.length > 0) controller.enqueue(encoder.encode(out.splice(0).join("")));
      if (reply.done) controller.close();
    },
    cancel() {
      reader.cancel();
    },
  });

  return sseResponse(stream);
}

/** Emit an already-complete reply as a short OpenAI SSE stream. */
async function streamBuffered(
  threadId: string,
  accessToken: string,
  apiBase: string,
  model: string,
  allowedTools: string[],
): Promise<Response> {
  const reply = await readWholeReply(threadId, accessToken, apiBase);
  if ("error" in reply) return reply.error;

  const { content, toolCalls } = parseToolCalls(reply.text, allowedTools);
  const chunk = chunkWriter(model);

  const parts: string[] = [chunk([{ delta: { role: "assistant" }, finish_reason: null, index: 0 }])];

  if (content) {
    parts.push(chunk([{ delta: { content }, finish_reason: null, index: 0 }]));
  }

  if (toolCalls.length > 0) {
    parts.push(chunk([{ delta: { tool_calls: toolCallDeltas(toolCalls) }, finish_reason: null, index: 0 }]));
  }

  parts.push(
    chunk(
      [{ delta: {}, finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop", index: 0 }],
      reply.usage ? { usage: reply.usage } : {},
    ),
    DONE,
  );

  return sseResponse(parts.join(""));
}

export async function handleNonStreaming(
  threadId: string,
  accessToken: string,
  apiBase: string,
  model: string,
  allowedTools?: string[] | null,
): Promise<Response> {
  const reply = await readWholeReply(threadId, accessToken, apiBase);
  if ("error" in reply) return reply.error;

  const { content, toolCalls } = allowedTools
    ? parseToolCalls(reply.text, allowedTools)
    : { content: reply.text, toolCalls: [] as OpenAIToolCall[] };

  const message: Record<string, unknown> = { role: "assistant", content };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  const usage: UsageStats = reply.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  return jsonResponse(200, {
    id: newCompletionId(),
    object: "chat.completion",
    created: nowSeconds(),
    model,
    choices: [{
      message,
      finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
      index: 0,
    }],
    usage,
  });
}
