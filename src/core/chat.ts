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

  const opened = await openThread(messageBody, accessToken, sessionToken, assistantId, apiBase, clientName);
  if ("error" in opened) return opened.error;
  const threadId = opened.threadId;

  if (body.stream === false) {
    return handleNonStreaming(threadId, accessToken, apiBase, body.model, allowedTools);
  }

  return handleStreaming(threadId, accessToken, apiBase, body.model, allowedTools);
}

/**
 * Post one message as a fresh thread and return its id. Shared by chat and
 * image generation, since both start a thread the same way.
 */
export async function openThread(
  message: string,
  accessToken: string,
  sessionToken: string,
  assistantId: string,
  apiBase: string,
  clientName: string,
): Promise<{ threadId: string } | { error: Response }> {
  const formData = new FormData();
  formData.append("token", sessionToken);
  formData.append("message", message);
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
    return {
      error: new Response(
        JSON.stringify({ error: { message: errorText } }),
        { status: msgResponse.status, headers: { "Content-Type": "application/json" } },
      ),
    };
  }

  const msgText = await msgResponse.text();
  let msgData: Record<string, unknown>;
  try {
    msgData = JSON.parse(msgText);
  } catch {
    return {
      error: new Response(
        JSON.stringify({ error: { message: `Matthew returned non-JSON: ${msgText.substring(0, 200)}` } }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      ),
    };
  }

  const newThread = msgData.new_thread as Record<string, unknown> | undefined;
  const threadId =
    (newThread?.thread_actual_id as string) ||
    (msgData.thread_actual_id as string) ||
    (msgData.thread_id as string);

  if (!threadId) {
    return {
      error: new Response(
        JSON.stringify({ error: { message: `No thread_id. Matthew response: ${JSON.stringify(msgData).substring(0, 300)}` } }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      ),
    };
  }

  return { threadId };
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
  let buffer = "";
  const encoder = new TextEncoder();
  const completionId = newCompletionId();
  const created = nowSeconds();

  const chunk = (choices: unknown[]): string =>
    formatOpenAISSE({
      id: completionId,
      object: "chat.completion.chunk",
      created,
      model,
      choices,
    });

  function enqueueFinish(controller: ReadableStreamDefaultController) {
    controller.enqueue(encoder.encode(chunk([
      { delta: {}, finish_reason: "stop", index: 0 },
    ])));
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    controller.close();
  }

  let currentEvent = "";

  const source = {
    async pull(controller: ReadableStreamDefaultController): Promise<void> {
      try {
        const { done, value } = await reader.read();

        if (done) {
          enqueueFinish(controller);
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let emitted = false;

        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
            continue;
          }

          if (currentEvent === "complete") {
            enqueueFinish(controller);
            return;
          }

          if (currentEvent === "error") {
            const jsonStr = line.startsWith("data:") ? line.slice(5).trim() : "";
            const errMsg = jsonStr ? jsonStr : "Stream error";
            controller.enqueue(encoder.encode(chunk([
              { delta: { content: `\n[Error: ${errMsg}]` }, finish_reason: "stop", index: 0 },
            ])));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }

          if (!line.startsWith("data:")) {
            currentEvent = "";
            continue;
          }

          const jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;

          if (currentEvent === "" || currentEvent === "message") {
            try {
              const data = JSON.parse(jsonStr) as { message?: string };
              if (data.message) {
                emitted = true;
                controller.enqueue(encoder.encode(chunk([
                  {
                    delta: { content: data.message, role: "assistant" },
                    finish_reason: null,
                    index: 0,
                  },
                ])));
              }
            } catch {
              // skip non-JSON
            }
          }

          currentEvent = "";
        }

        // A chunk with only event lines emits nothing, and the stream never pulls again.
        if (!emitted) return source.pull(controller);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      reader.cancel();
    },
  };

  const stream = new ReadableStream(source);

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/** Concatenate the `message` fields out of a whole Matthew SSE body. */
function collectSseText(sseBody: string): string {
  let fullContent = "";

  for (const line of sseBody.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const data = JSON.parse(line.slice(5).trim()) as { message?: string };
      if (data.message) fullContent += data.message;
    } catch {
      // skip
    }
  }

  return fullContent;
}

/**
 * Read Matthew's stream to the end and hand back its text. Shared by the
 * non-streaming path and by streaming-with-tools, which both need the
 * complete reply before they can answer.
 */
export async function readWholeReply(
  threadId: string,
  accessToken: string,
  apiBase: string,
): Promise<{ text: string } | { error: Response }> {
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

  return { text: collectSseText(await upstream.text()) };
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
    "data: [DONE]\n\n",
  );

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
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

export function formatOpenAISSE(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}
