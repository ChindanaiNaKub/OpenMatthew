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
  sessionToken: string,
  assistantId: string,
  apiBase: string,
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

        let accessToken = "";
        let sessionToken = "";
        let defaultAssistantId = "default";

        try {
          const parsed = JSON.parse(auth.access) as {
            accessToken: string;
            sessionToken: string;
            defaultAssistantId?: string;
          };
          accessToken = parsed.accessToken;
          sessionToken = parsed.sessionToken;
          defaultAssistantId = parsed.defaultAssistantId || "default";
        } catch {
          accessToken = auth.access;
          sessionToken = auth.access;
        }

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
            return handleMatthewChat(
              body, accessToken, sessionToken,
              defaultAssistantId, matthewApiBase,
            );
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
                "   copy(localStorage.user)\n" +
                "3. Come back here and Ctrl+V to paste",
              method: "code" as const,

              async callback(input: string) {
                try {
                  const raw = input.trim();
                  if (!raw) return { type: "failed" as const };

                  let accessToken: string;
                  let sessionToken: string;
                  let defaultAssistantId: string | undefined;
                  let userName: string | undefined;
                  let userNameTh: string | undefined;

                  if (raw.startsWith("{")) {
                    const user = JSON.parse(raw) as Record<string, unknown>;
                    accessToken = user.access_token as string;
                    sessionToken = user.token as string;
                    const da = user.defaultAssistant as Record<string, unknown> | undefined;
                    defaultAssistantId = da?.daid as string | undefined;
                    const ui = user.user_info as Record<string, unknown> | undefined;
                    userName = ui?.firstname_EN as string | undefined;
                    userNameTh = ui?.firstname_TH as string | undefined;
                  } else {
                    accessToken = raw;
                    sessionToken = raw;
                  }

                  if (!accessToken || !sessionToken) {
                    return { type: "failed" as const };
                  }

                  const storage = (await loadAccounts()) ?? {
                    version: 1 as const,
                    accounts: [],
                    activeIndex: 0,
                  };

                  storage.accounts.push({
                    accessToken,
                    sessionToken,
                    defaultAssistantId,
                    userName,
                    userNameTh,
                    addedAt: Date.now(),
                    lastUsed: Date.now(),
                  });
                  storage.activeIndex = storage.accounts.length - 1;
                  await saveAccounts(storage);

                  const combined = JSON.stringify({ accessToken, sessionToken, defaultAssistantId });

                  return {
                    type: "success" as const,
                    refresh: combined,
                    access: combined,
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
