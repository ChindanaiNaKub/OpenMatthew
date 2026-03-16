import { exec } from "node:child_process";
import type { Plugin, Hooks } from "@opencode-ai/plugin";
import {
  MATTHEW_PROVIDER_ID,
  MATTHEW_API_BASE,
  MATTHEW_CLIENT_ID,
  MATTHEW_REDIRECT_URI,
} from "./constants.js";
import { authorizeMicrosoft } from "./oauth/microsoft.js";
import {
  loadAccounts,
  saveAccounts,
} from "./plugin/storage.js";

const MATTHEW_MODELS = {
  "gpt-5.2": {
    name: "GPT-5.2",
    attachment: true,
    reasoning: true,
    temperature: true,
    tool_call: true,
    cost: { input: 0, output: 0 },
    limit: { context: 128000, output: 16384 },
  },
  "gpt-5-mini": {
    name: "GPT-5 Mini",
    attachment: true,
    reasoning: true,
    temperature: true,
    tool_call: true,
    cost: { input: 0, output: 0 },
    limit: { context: 128000, output: 16384 },
  },
  "gpt-4.1": {
    name: "GPT-4.1",
    attachment: true,
    reasoning: false,
    temperature: true,
    tool_call: true,
    cost: { input: 0, output: 0 },
    limit: { context: 128000, output: 16384 },
  },
  "gpt-4o": {
    name: "GPT-4o",
    attachment: true,
    reasoning: false,
    temperature: true,
    tool_call: true,
    cost: { input: 0, output: 0 },
    limit: { context: 128000, output: 16384 },
  },
  "gpt-4o-mini": {
    name: "GPT-4o Mini",
    attachment: true,
    reasoning: false,
    temperature: true,
    tool_call: true,
    cost: { input: 0, output: 0 },
    limit: { context: 128000, output: 16384 },
  },
} as const;

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

interface OpenAIMessage {
  role: string;
  content: string;
}

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
}

/**
 * Transform an OpenAI-format chat/completions request into Matthew's API.
 * Matthew uses a thread-based system with FormData + SSE streaming.
 */
async function handleMatthewChat(
  body: OpenAIChatRequest,
  accessToken: string,
  apiBase: string,
): Promise<Response> {
  const lastUserMsg = [...body.messages]
    .reverse()
    .find((m) => m.role === "user");
  const messageText = lastUserMsg?.content || "";

  const formData = new FormData();
  formData.append("token", accessToken);
  formData.append("message", messageText);
  formData.append("thread_id", "newchat");
  formData.append("tid", "newchat");
  formData.append("aid", "default");
  formData.append("uname", "OpenCode");
  formData.append("uname_th", "OpenCode");

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

  const msgData = (await msgResponse.json()) as {
    thread_actual_id?: string;
    thread_id?: string;
  };
  const threadId = msgData.thread_actual_id || msgData.thread_id;

  if (!threadId) {
    return new Response(
      JSON.stringify({ error: { message: "No thread_id returned from Matthew" } }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  if (body.stream === false) {
    return handleNonStreaming(threadId, accessToken, apiBase, body.model);
  }

  return handleStreaming(threadId, accessToken, apiBase, body.model);
}

async function handleStreaming(
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

  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();

        if (done) {
          const doneChunk = formatOpenAISSE({
            choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
            model,
          });
          controller.enqueue(new TextEncoder().encode(doneChunk));
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;

          try {
            const data = JSON.parse(jsonStr) as { message?: string };
            if (data.message) {
              const chunk = formatOpenAISSE({
                choices: [{
                  delta: { content: data.message, role: "assistant" },
                  finish_reason: null,
                  index: 0,
                }],
                model,
              });
              controller.enqueue(new TextEncoder().encode(chunk));
            }
          } catch {
            // skip non-JSON SSE lines
          }
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

async function handleNonStreaming(
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

function formatOpenAISSE(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export const MatthewOAuthPlugin: Plugin = async () => {
  const matthewApiBase =
    process.env.MATTHEW_API_BASE || MATTHEW_API_BASE;

  return {
    async config(config) {
      config.provider = config.provider ?? {};
      const existing = config.provider[MATTHEW_PROVIDER_ID] ?? {};

      const defaultModels: Record<string, Record<string, unknown>> = {};
      for (const [id, def] of Object.entries(MATTHEW_MODELS)) {
        defaultModels[id] = { ...def };
      }

      config.provider[MATTHEW_PROVIDER_ID] = {
        ...existing,
        api: existing.api ?? matthewApiBase,
        name: existing.name ?? "CMU Matthew AI",
        models: {
          ...defaultModels,
          ...(existing.models ?? {}),
        },
      };
    },

    auth: {
      provider: MATTHEW_PROVIDER_ID,

      async loader(getAuth, provider) {
        const auth = await getAuth();

        if (auth.type !== "oauth") {
          return {};
        }

        const accessToken = auth.access;

        const customFetch: typeof fetch = async (input, init) => {
          const request =
            input instanceof Request ? input : new Request(input, init);
          const url = new URL(request.url);

          const isChatCompletions =
            url.pathname.includes("/chat/completions");
          const isMatthewRequest =
            url.hostname.includes("matthew.cmu.ac.th") ||
            url.origin === matthewApiBase;

          if (!isMatthewRequest && !isChatCompletions) {
            return fetch(input, init);
          }

          if (isChatCompletions) {
            const bodyText = await request.text();
            const body = JSON.parse(bodyText) as OpenAIChatRequest;
            return handleMatthewChat(body, accessToken, matthewApiBase);
          }

          const headers = new Headers(request.headers);
          headers.set("Authorization", `Bearer ${accessToken}`);
          return fetch(new Request(request, { headers }), init);
        };

        return {
          apiKey: accessToken,
          fetch: customFetch,
        };
      },

      methods: [
        {
          type: "oauth" as const,
          label: "Login with CMU Account",

          async authorize() {
            openBrowser(MATTHEW_REDIRECT_URI);

            return {
              url: MATTHEW_REDIRECT_URI,
              instructions:
                "1. Login to matthew.cmu.ac.th with your CMU Account\n" +
                "2. After login, press F12 → Console tab → paste this:\n" +
                "   copy(JSON.parse(localStorage.user).access_token)\n" +
                "3. Come back here and Ctrl+V to paste the token",
              method: "code" as const,

              async callback(tokenInput: string) {
                try {
                  let token = tokenInput.trim();
                  if (!token) return { type: "failed" as const };

                  if (token.startsWith('"') && token.endsWith('"')) {
                    token = token.slice(1, -1);
                  }

                  const storage = (await loadAccounts()) ?? {
                    version: 1 as const,
                    accounts: [],
                    activeIndex: 0,
                  };

                  storage.accounts.push({
                    accessToken: token,
                    addedAt: Date.now(),
                    lastUsed: Date.now(),
                  });
                  storage.activeIndex = storage.accounts.length - 1;
                  await saveAccounts(storage);

                  return {
                    type: "success" as const,
                    refresh: token,
                    access: token,
                    expires: Date.now() + 3600 * 1000,
                  };
                } catch (err) {
                  console.error("[matthew] Auth error:", err);
                  return { type: "failed" as const };
                }
              },
            };
          },
        },
      ],
    },
  } satisfies Hooks;
};
