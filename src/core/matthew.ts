/**
 * The calls every Matthew endpoint shares: opening a thread, reading its
 * reply, and the HTTP responses built from them. Chat and image generation
 * both go through here.
 */

import { createSseParser } from "./sse.js";
import type { UsageStats } from "./usage.js";

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(status: number, message: string): Response {
  return jsonResponse(status, { error: { message } });
}

export function sseResponse(body: string | ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/** Post one message as a fresh thread and return its id. */
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
    return { error: errorResponse(msgResponse.status, await msgResponse.text()) };
  }

  const msgText = await msgResponse.text();
  let msgData: Record<string, unknown>;
  try {
    msgData = JSON.parse(msgText);
  } catch {
    return { error: errorResponse(502, `Matthew returned non-JSON: ${msgText.substring(0, 200)}`) };
  }

  const newThread = msgData.new_thread as Record<string, unknown> | undefined;
  const threadId =
    (newThread?.thread_actual_id as string) ||
    (msgData.thread_actual_id as string) ||
    (msgData.thread_id as string);

  if (!threadId) {
    return {
      error: errorResponse(
        500,
        `No thread_id. Matthew response: ${JSON.stringify(msgData).substring(0, 300)}`,
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
      error: errorResponse(
        502,
        `Failed to obtain Matthew stream ticket (status ${ticketResponse.status})${hint}: ${detail.slice(0, 300)}`,
      ),
    };
  }

  const { ticket } = (await ticketResponse.json()) as { ticket?: string };

  if (!ticket) {
    return { error: errorResponse(502, "Matthew returned no stream ticket") };
  }

  return {
    url:
      `${apiBase}/api/thread_sse_response_stream?thread_id=${encodeURIComponent(threadId)}` +
      `&ticket=${encodeURIComponent(ticket)}`,
  };
}

export async function openReplyStream(
  threadId: string,
  accessToken: string,
  apiBase: string,
): Promise<{ body: ReadableStream<Uint8Array> } | { error: Response }> {
  const built = await buildStreamUrl(threadId, accessToken, apiBase);
  if ("error" in built) return built;

  const upstream = await fetch(built.url);
  if (!upstream.ok || !upstream.body) {
    const bodyText = await upstream.text().catch(() => "");
    return {
      error: errorResponse(
        502,
        `Failed to connect to Matthew SSE (status ${upstream.status}): ${bodyText.slice(0, 300)}`,
      ),
    };
  }

  return { body: upstream.body };
}

export interface ReplyHandlers {
  onText(text: string): void;
  onError(message: string): void;
  onEnd(): void;
}

/**
 * Reads Matthew's reply events and reports text, errors and the end of the
 * reply through `handlers`. Token counts are kept for `usage()`.
 */
export function createReplyParser(handlers: ReplyHandlers) {
  const counts: { prompt?: number; completion?: number } = {};
  let done = false;

  const sse = createSseParser((event, data) => {
    if (done) return;
    if (event === "complete") {
      done = true;
      handlers.onEnd();
    } else if (event === "error") {
      done = true;
      handlers.onError(data || "Stream error");
    } else if (event === "ptoken" || event === "ctoken") {
      const value = Number(data);
      if (!data || !Number.isFinite(value)) return;
      if (event === "ptoken") counts.prompt = value;
      else counts.completion = value;
    } else if (event === "" || event === "message") {
      try {
        const { message } = JSON.parse(data) as { message?: string };
        if (message) handlers.onText(message);
      } catch {
        // skip non-JSON
      }
    }
  });

  return {
    get done(): boolean {
      return done;
    },
    push(text: string): void {
      sse.push(text);
    },
    end(): void {
      sse.end();
      if (!done) {
        done = true;
        handlers.onEnd();
      }
    },
    usage(): UsageStats | null {
      if (counts.prompt === undefined && counts.completion === undefined) return null;
      const prompt = counts.prompt ?? 0;
      const completion = counts.completion ?? 0;
      return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
    },
  };
}

/** Read Matthew's stream to the end and hand back its text, with its token counts. */
export async function readWholeReply(
  threadId: string,
  accessToken: string,
  apiBase: string,
): Promise<{ text: string; usage: UsageStats | null } | { error: Response }> {
  const opened = await openReplyStream(threadId, accessToken, apiBase);
  if ("error" in opened) return opened;

  let text = "";
  const reply = createReplyParser({
    onText: (chunk) => {
      text += chunk;
    },
    onError: (message) => {
      text += `\n[Error: ${message}]`;
    },
    onEnd: () => {},
  });
  reply.push(await new Response(opened.body).text());
  reply.end();

  return { text, usage: reply.usage() };
}
