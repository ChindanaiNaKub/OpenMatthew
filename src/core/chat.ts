/**
 * Platform-agnostic Matthew chat client.
 * Transforms an OpenAI-format chat/completions request into calls against
 * Matthew's thread-based API (FormData + SSE), and normalizes the response
 * back into OpenAI's chat/completions shape. No host-platform dependency.
 */

import { randomUUID } from "node:crypto";
import {
  buildToolInstructions,
  formatToolCall,
  parseToolCalls,
  toolCallDeltas,
  toolNames,
} from "./tools.js";
import type { OpenAITool, OpenAIToolCall, ToolChoice } from "./tools.js";
import { createSseReader } from "./sse.js";
import type { MatthewToolCall } from "./sse.js";

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
  /** `{include_usage: true}` asks for a usage chunk before `[DONE]`. */
  stream_options?: { include_usage?: boolean };
}

/**
 * Matthew reports token counts as their own SSE events rather than in the
 * message payload — `ptoken` for the prompt, `ctoken` for the completion,
 * each carrying a bare integer that the caller accumulates.
 */
export interface StreamUsage {
  prompt: number;
  completion: number;
}

function newUsage(): StreamUsage {
  return { prompt: 0, completion: 0 };
}

function addTokenCount(usage: StreamUsage, event: string, data: string): void {
  const count = Number.parseInt(data, 10);
  if (!Number.isFinite(count) || count < 0) return;
  if (event === "ptoken") usage.prompt += count;
  else usage.completion += count;
}

function usageBlock(usage: StreamUsage): Record<string, number> {
  return {
    prompt_tokens: usage.prompt,
    completion_tokens: usage.completion,
    total_tokens: usage.prompt + usage.completion,
  };
}

/**
 * The usage chunk OpenAI sends just before `[DONE]`, and only when the
 * client asked for it with `stream_options: {include_usage: true}`. It
 * carries an empty `choices` array — a client that ignores usage must not
 * see a phantom delta at the end of the stream.
 */
function usageChunk(envelope: Record<string, unknown>, usage: StreamUsage): string {
  return formatOpenAISSE({ ...envelope, choices: [], usage: usageBlock(usage) });
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
  clientName = "OpenMatthew",
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

  const formData = new FormData();
  formData.append("token", sessionToken);
  formData.append("message", messageBody);
  formData.append("thread_id", "newchat");
  formData.append("tid", "newchat");
  formData.append("aid", assistantId);
  formData.append("uname", clientName);
  formData.append("uname_th", clientName);

  const msgResponse = await fetch(`${apiBase}/api/thread_sse_message`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });

  if (!msgResponse.ok) {
    const errorText = await msgResponse.text();
    return new Response(
      JSON.stringify({ error: { message: errorText } }),
      { status: msgResponse.status, headers: { "Content-Type": "application/json" } },
    );
  }

  const msgText = await msgResponse.text();
  let msgData: Record<string, unknown>;
  try {
    msgData = JSON.parse(msgText);
  } catch {
    return new Response(
      JSON.stringify({ error: { message: `Matthew returned non-JSON: ${msgText.substring(0, 200)}` } }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  const newThread = msgData.new_thread as Record<string, unknown> | undefined;
  const threadId =
    (newThread?.thread_actual_id as string) ||
    (msgData.thread_actual_id as string) ||
    (msgData.thread_id as string);

  if (!threadId) {
    return new Response(
      JSON.stringify({ error: { message: `No thread_id. Matthew response: ${JSON.stringify(msgData).substring(0, 300)}` } }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  if (body.stream === false) {
    return handleNonStreaming(
      threadId,
      accessToken,
      sessionToken,
      apiBase,
      body.model,
      allowedTools,
    );
  }

  return handleStreaming(
    threadId,
    accessToken,
    sessionToken,
    apiBase,
    body.model,
    allowedTools,
    body.stream_options?.include_usage === true,
  );
}

/**
 * Matthew's response stream is authenticated by a short-lived ticket, not
 * by the access token: the frontend drives it with an `EventSource`, which
 * cannot set request headers, so the token is exchanged for a ticket first
 * and only the ticket travels on the stream URL.
 */
async function buildStreamUrl(
  threadId: string,
  accessToken: string,
  apiBase: string,
): Promise<{ url: string } | { error: Response }> {
  const ticketResponse = await fetch(`${apiBase}/api/thread_sse_ticket`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ thread_id: threadId }),
  });

  if (!ticketResponse.ok) {
    const detail = await ticketResponse.text().catch(() => "");
    const hint =
      ticketResponse.status === 401
        ? " — your Matthew session has expired, log in again for a fresh token"
        : "";
    return {
      error: new Response(
        JSON.stringify({
          error: {
            message: `Failed to obtain Matthew stream ticket (status ${ticketResponse.status})${hint}: ${detail.slice(0, 300)}`,
          },
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      ),
    };
  }

  const { ticket } = (await ticketResponse.json()) as { ticket?: string };

  if (!ticket) {
    return {
      error: new Response(
        JSON.stringify({ error: { message: "Matthew returned no stream ticket" } }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      ),
    };
  }

  return {
    url:
      `${apiBase}/api/thread_sse_response_stream?thread_id=${encodeURIComponent(threadId)}` +
      `&ticket=${encodeURIComponent(ticket)}`,
  };
}

/**
 * Answer one of Matthew's own tool calls with a refusal.
 *
 * Matthew's frontend implements `run_data_analysis` and
 * `generate_document` in the browser and posts the result back. We are not
 * a browser and cannot run either, but staying silent is worse than saying
 * so: the stream does not continue until the call is answered.
 */
async function declineToolCall(
  apiBase: string,
  accessToken: string,
  sessionToken: string,
  threadId: string,
  call: MatthewToolCall,
): Promise<void> {
  const content = JSON.stringify({
    status: "failed",
    error:
      `The connected client cannot run \`${call.name}\`. OpenMatthew is an ` +
      `OpenAI-compatible proxy and does not implement Matthew's ` +
      `browser-side tools. Answer without it.`,
  });

  try {
    await fetch(`${apiBase}/api/submit_tool_result`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        token: sessionToken,
        thread_id: threadId,
        tool_call_id: call.toolCallId,
        content,
      }),
    });
  } catch {
    // Best effort. If this fails the stream stalls, which is exactly what
    // happened before it existed — there is nothing better to fall back to.
  }
}

export async function handleStreaming(
  threadId: string,
  accessToken: string,
  sessionToken: string,
  apiBase: string,
  model: string,
  allowedTools?: string[] | null,
  includeUsage = false,
): Promise<Response> {
  // A tool call is not recognisable until its closing tag arrives, so when
  // tools are in play the whole reply is read before anything is emitted.
  // Streaming content out and retracting it once a call turns up is not
  // expressible in OpenAI's wire format.
  if (allowedTools) {
    return streamBuffered(
      threadId,
      accessToken,
      sessionToken,
      apiBase,
      model,
      allowedTools,
      includeUsage,
    );
  }

  const built = await buildStreamUrl(threadId, accessToken, apiBase);
  if ("error" in built) return built.error;

  const upstream = await fetch(built.url);

  if (!upstream.ok || !upstream.body) {
    const bodyText = await upstream.text().catch(() => "");
    return new Response(
      JSON.stringify({
        error: {
          message: `Failed to connect to Matthew SSE (status ${upstream.status}): ${bodyText.slice(0, 300)}`,
        },
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const envelope = {
    id: newCompletionId(),
    object: "chat.completion.chunk",
    created: nowSeconds(),
    model,
  };
  const chunk = (choices: unknown[]): string => formatOpenAISSE({ ...envelope, choices });
  const usage = newUsage();

  let controller: ReadableStreamDefaultController | null = null;
  let closed = false;
  const pendingToolCalls: MatthewToolCall[] = [];

  const emit = (payload: string): void => {
    if (!closed) controller?.enqueue(encoder.encode(payload));
  };

  function finish(): void {
    if (closed) return;
    emit(chunk([{ delta: {}, finish_reason: "stop", index: 0 }]));
    if (includeUsage) emit(usageChunk(envelope, usage));
    emit("data: [DONE]\n\n");
    closed = true;
    controller?.close();
  }

  const sse = createSseReader({
    onText(text) {
      emit(chunk([{ delta: { content: text, role: "assistant" }, finish_reason: null, index: 0 }]));
    },
    onPromptTokens(count) {
      usage.prompt += count;
    },
    onCompletionTokens(count) {
      usage.completion += count;
    },
    onToolCall(call) {
      pendingToolCalls.push(call);
    },
    onError(raw) {
      emit(chunk([{ delta: { content: `\n[Error: ${raw}]` }, finish_reason: "stop", index: 0 }]));
      emit("data: [DONE]\n\n");
      closed = true;
      controller?.close();
    },
    onComplete() {
      finish();
    },
  });

  const stream = new ReadableStream({
    async pull(activeController) {
      controller = activeController;

      try {
        const { done, value } = await reader.read();

        if (done) {
          sse.flush();
          finish();
          return;
        }

        sse.push(decoder.decode(value, { stream: true }));

        // Not awaited: what we owe Matthew is a refusal, and blocking the
        // reader on it would introduce the very stall this removes.
        for (const call of pendingToolCalls.splice(0)) {
          void declineToolCall(apiBase, accessToken, sessionToken, threadId, call);
        }
      } catch (err) {
        activeController.error(err);
      }
    },
    cancel() {
      void reader.cancel();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/**
 * Walk a whole Matthew SSE body in one go. A convenience over the shared
 * reader for callers that already hold the complete text.
 */
export function collectSseBody(sseBody: string): {
  text: string;
  usage: StreamUsage;
  toolCalls: MatthewToolCall[];
} {
  let text = "";
  const usage = newUsage();
  const toolCalls: MatthewToolCall[] = [];

  const sse = createSseReader({
    onText: (chunk) => {
      text += chunk;
    },
    onPromptTokens: (count) => {
      usage.prompt += count;
    },
    onCompletionTokens: (count) => {
      usage.completion += count;
    },
    onToolCall: (call) => {
      toolCalls.push(call);
    },
  });

  sse.push(sseBody);
  sse.flush();

  return { text, usage, toolCalls };
}

/**
 * Read Matthew's stream to the end and hand back its text. Shared by the
 * non-streaming path and by streaming-with-tools, which both need the
 * complete reply before they can answer.
 */
async function readWholeReply(
  threadId: string,
  accessToken: string,
  sessionToken: string,
  apiBase: string,
): Promise<{ text: string; usage: StreamUsage } | { error: Response }> {
  const built = await buildStreamUrl(threadId, accessToken, apiBase);
  if ("error" in built) return built;

  const upstream = await fetch(built.url);

  if (!upstream.ok) {
    const bodyText = await upstream.text().catch(() => "");
    return {
      error: new Response(
        JSON.stringify({
          error: {
            message: `Failed to connect to Matthew SSE (status ${upstream.status}): ${bodyText.slice(0, 300)}`,
          },
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      ),
    };
  }

  // Read incrementally rather than awaiting the whole body. If Matthew
  // asks for a tool result partway through, the body never completes until
  // it is answered — `upstream.text()` would wait forever.
  if (!upstream.body) {
    const { text, usage } = collectSseBody(await upstream.text());
    return { text, usage };
  }

  let text = "";
  const usage = newUsage();
  const pendingToolCalls: MatthewToolCall[] = [];

  const sse = createSseReader({
    onText: (chunk) => {
      text += chunk;
    },
    onPromptTokens: (count) => {
      usage.prompt += count;
    },
    onCompletionTokens: (count) => {
      usage.completion += count;
    },
    onToolCall: (call) => {
      pendingToolCalls.push(call);
    },
  });

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    sse.push(decoder.decode(value, { stream: true }));

    // Awaited, unlike the streaming path: this one buffers the whole reply
    // anyway, and nothing more arrives until the call is answered.
    for (const call of pendingToolCalls.splice(0)) {
      await declineToolCall(apiBase, accessToken, sessionToken, threadId, call);
    }

    if (sse.finished) break;
  }

  sse.flush();

  return { text, usage };
}

/** Emit an already-complete reply as a short OpenAI SSE stream. */
async function streamBuffered(
  threadId: string,
  accessToken: string,
  sessionToken: string,
  apiBase: string,
  model: string,
  allowedTools: string[],
  includeUsage: boolean,
): Promise<Response> {
  const reply = await readWholeReply(threadId, accessToken, sessionToken, apiBase);
  if ("error" in reply) return reply.error;

  const { content, toolCalls } = parseToolCalls(reply.text, allowedTools);
  const envelope = {
    id: newCompletionId(),
    object: "chat.completion.chunk",
    created: nowSeconds(),
    model,
  };

  const parts: string[] = [
    formatOpenAISSE({
      ...envelope,
      choices: [{ delta: { role: "assistant" }, finish_reason: null, index: 0 }],
    }),
  ];

  if (content) {
    parts.push(
      formatOpenAISSE({
        ...envelope,
        choices: [{ delta: { content }, finish_reason: null, index: 0 }],
      }),
    );
  }

  if (toolCalls.length > 0) {
    parts.push(
      formatOpenAISSE({
        ...envelope,
        choices: [
          { delta: { tool_calls: toolCallDeltas(toolCalls) }, finish_reason: null, index: 0 },
        ],
      }),
    );
  }

  parts.push(
    formatOpenAISSE({
      ...envelope,
      choices: [
        { delta: {}, finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop", index: 0 },
      ],
    }),
  );

  if (includeUsage) parts.push(usageChunk(envelope, reply.usage));

  parts.push("data: [DONE]\n\n");

  return new Response(parts.join(""), {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function handleNonStreaming(
  threadId: string,
  accessToken: string,
  sessionToken: string,
  apiBase: string,
  model: string,
  allowedTools?: string[] | null,
): Promise<Response> {
  const reply = await readWholeReply(threadId, accessToken, sessionToken, apiBase);
  if ("error" in reply) return reply.error;

  const { content, toolCalls } = allowedTools
    ? parseToolCalls(reply.text, allowedTools)
    : { content: reply.text, toolCalls: [] as OpenAIToolCall[] };

  const message: Record<string, unknown> = { role: "assistant", content };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  return new Response(
    JSON.stringify({
      id: newCompletionId(),
      object: "chat.completion",
      created: nowSeconds(),
      model,
      choices: [{
        message,
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
        index: 0,
      }],
      usage: usageBlock(reply.usage),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

export function formatOpenAISSE(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}
