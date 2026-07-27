/**
 * Platform-agnostic Matthew chat client.
 * Transforms an OpenAI-format chat/completions request into calls against
 * Matthew's thread-based API (FormData + SSE), and normalizes the response
 * back into OpenAI's chat/completions shape. No host-platform dependency.
 */

import { randomUUID } from "node:crypto";

export interface OpenAIMessage {
  role: string;
  content: string;
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
    return last.content;
  }

  const transcript = messages.slice(0, lastIndex).map((message) => {
    const label =
      message.role === "system"
        ? "Instructions"
        : message.role === "assistant"
          ? "Assistant"
          : "User";
    return `${label}: ${message.content}`;
  });

  const trailer =
    last?.role === "user"
      ? `User: ${last.content}\n\nRespond to the final User message above.`
      : `${last?.role === "assistant" ? "Assistant" : "Instructions"}: ${last?.content ?? ""}\n\nContinue.`;

  return [...transcript, trailer].join("\n\n");
}

export async function handleMatthewChat(
  body: OpenAIChatRequest,
  accessToken: string,
  sessionToken: string,
  assistantId: string,
  apiBase: string,
  clientName = "OpenMatthew",
): Promise<Response> {
  const messageText = serializeConversation(body.messages ?? []);

  const formData = new FormData();
  formData.append("token", sessionToken);
  formData.append("message", messageText);
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
    return handleNonStreaming(threadId, accessToken, apiBase, body.model);
  }

  return handleStreaming(threadId, accessToken, apiBase, body.model);
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
): Promise<Response> {
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

  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();

        if (done) {
          enqueueFinish(controller);
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let currentEvent = "";

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
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      reader.cancel();
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

export async function handleNonStreaming(
  threadId: string,
  accessToken: string,
  apiBase: string,
  model: string,
): Promise<Response> {
  const built = await buildStreamUrl(threadId, accessToken, apiBase);
  if ("error" in built) return built.error;

  const upstream = await fetch(built.url);

  if (!upstream.ok) {
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

  const text = await upstream.text();
  let fullContent = "";

  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const data = JSON.parse(line.slice(5).trim()) as { message?: string };
      if (data.message) fullContent += data.message;
    } catch {
      // skip
    }
  }

  return new Response(
    JSON.stringify({
      id: newCompletionId(),
      object: "chat.completion",
      created: nowSeconds(),
      model,
      choices: [{
        message: { role: "assistant", content: fullContent },
        finish_reason: "stop",
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
