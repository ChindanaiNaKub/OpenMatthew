/**
 * Platform-agnostic Matthew chat client.
 * Transforms an OpenAI-format chat/completions request into calls against
 * Matthew's thread-based API (FormData + SSE), and normalizes the response
 * back into OpenAI's chat/completions shape. No host-platform dependency.
 */

export interface OpenAIMessage {
  role: string;
  content: string;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
}

export async function handleMatthewChat(
  body: OpenAIChatRequest,
  accessToken: string,
  sessionToken: string,
  assistantId: string,
  apiBase: string,
  clientName = "OpenMatthew",
): Promise<Response> {
  const lastUserMsg = [...body.messages]
    .reverse()
    .find((m) => m.role === "user");
  const messageText = lastUserMsg?.content || "";

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

export async function handleStreaming(
  threadId: string,
  accessToken: string,
  apiBase: string,
  model: string,
): Promise<Response> {
  const sseUrl = `${apiBase}/api/thread_sse_response_stream?thread_id=${threadId}&token=${accessToken}`;
  const upstream = await fetch(sseUrl);

  if (!upstream.ok || !upstream.body) {
    return new Response(
      JSON.stringify({ error: { message: "Failed to connect to Matthew SSE" } }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const encoder = new TextEncoder();

  function enqueueFinish(controller: ReadableStreamDefaultController) {
    controller.enqueue(encoder.encode(formatOpenAISSE({
      choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
      model,
    })));
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
            controller.enqueue(encoder.encode(formatOpenAISSE({
              choices: [{ delta: { content: `\n[Error: ${errMsg}]` }, finish_reason: "stop", index: 0 }],
              model,
            })));
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
                controller.enqueue(encoder.encode(formatOpenAISSE({
                  choices: [{
                    delta: { content: data.message, role: "assistant" },
                    finish_reason: null,
                    index: 0,
                  }],
                  model,
                })));
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
  const sseUrl = `${apiBase}/api/thread_sse_response_stream?thread_id=${threadId}&token=${accessToken}`;
  const upstream = await fetch(sseUrl);

  if (!upstream.ok) {
    return new Response(
      JSON.stringify({ error: { message: "Failed to connect to Matthew SSE" } }),
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
      choices: [{
        message: { role: "assistant", content: fullContent },
        finish_reason: "stop",
        index: 0,
      }],
      model,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

export function formatOpenAISSE(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}
