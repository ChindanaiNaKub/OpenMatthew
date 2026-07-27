import { exec } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Plugin, Hooks } from "@opencode-ai/plugin";
import {
  MATTHEW_PROVIDER_ID,
  MATTHEW_API_BASE,
  MATTHEW_LOGIN_URL,
} from "./constants.js";
import { MATTHEW_MODELS } from "./core/models.js";
import { loadAccounts, saveAccounts } from "./core/storage.js";
import type { OpenAIChatRequest } from "./core/chat.js";
import { handleMatthewChat } from "./core/chat.js";
import {
  wrapResponseWithUsageTracking,
  fetchMatthewUsage,
} from "./core/usage.js";
import { estimateTokens, checkBudget, formatBudget } from "./core/tokens.js";

function getOpenCodeConfigDir(): string {
  if (process.env.OPENCODE_CONFIG_DIR) {
    return process.env.OPENCODE_CONFIG_DIR;
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgConfig, "opencode");
}

/**
 * OpenCode's provider config wants more per-model detail than the core
 * list carries. Everything except `reasoning` is identical across
 * Matthew's models, and it's all free to CMU students.
 */
function openCodeModelConfig(): Record<string, Record<string, unknown>> {
  const models: Record<string, Record<string, unknown>> = {};
  for (const model of MATTHEW_MODELS) {
    models[model.id] = {
      name: model.name,
      attachment: true,
      reasoning: model.reasoning,
      temperature: true,
      tool_call: true,
      cost: { input: 0, output: 0 },
      limit: { context: 128000, output: 16384 },
    };
  }
  return models;
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

export const MatthewOAuthPlugin: Plugin = async () => {
  const matthewApiBase =
    process.env.MATTHEW_API_BASE || MATTHEW_API_BASE;

  return {
    async config(config) {
      config.provider = config.provider ?? {};
      const existing = config.provider[MATTHEW_PROVIDER_ID] ?? {};

      const defaultModels = openCodeModelConfig();

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
              defaultAssistantId, matthewApiBase, "OpenCode",
            );
          }

          const headers = new Headers(request.headers);
          headers.set("Authorization", `Bearer ${accessToken}`);

          const response = await fetch(new Request(request, { headers }), init);

          // Track token usage from SSE streaming responses
          const modelId = url.searchParams.get("model") ?? undefined;
          return wrapResponseWithUsageTracking(response, modelId);
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
            openBrowser(MATTHEW_LOGIN_URL);

            return {
              url: MATTHEW_LOGIN_URL,
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

                  const configDir = getOpenCodeConfigDir();
                  const storage = (await loadAccounts(configDir)) ?? {
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
                  await saveAccounts(configDir, storage);

                  const combined = JSON.stringify({ accessToken, sessionToken, defaultAssistantId });

                  // Try to fetch dashboard usage and warn if near limits
                  try {
                    const usage = await fetchMatthewUsage(accessToken);
                    if (usage && (usage.contextUsed || usage.responseUsed)) {
                      const status = checkBudget(
                        usage.contextUsed ?? 0,
                        usage.responseUsed ?? 0,
                      );
                      console.log(formatBudget(status));
                    }
                  } catch {
                    // Dashboard usage fetch is best-effort
                  }

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

    // ── Token-saving hooks ─────────────────────────────────────────

    "chat.params": async (input, output) => {
      const msgJson = JSON.stringify(input.message);
      const approx = estimateTokens(msgJson);

      // Log rough token count for visibility
      console.log(
        `[matthew] Request: model=${input.model?.id ?? "unknown"}, ` +
          `msgTokens≈${approx.toLocaleString()}`,
      );

      // Optimal code-generation settings
      output.temperature = 0.2;
      output.topP = 0.95;

      // Force OpenAI-compatible APIs to include usage in SSE stream
      if (typeof output.options === "object" && output.options !== null) {
        const opts = output.options as Record<string, unknown>;
        opts.stream_options = { include_usage: true };
      }

      // Attempt to inject a stronger system prompt if the backend allows it.
      // Matthew's server may ignore or override this, but it's worth trying.
      if (process.env.MATTHEW_OVERRIDE_SYSTEM !== "0") {
        const customSystem =
          process.env.MATTHEW_SYSTEM_PROMPT ??
          "You are a world-class software engineer. " +
            "Be concise, precise, and prioritize correctness over verbosity. " +
            "When editing code, output only the changed sections (diff-style) " +
            "instead of rewriting entire files unless asked.";

        if (typeof output.options === "object" && output.options !== null) {
          // OpenAI-compatible body path
          const opts = output.options as Record<string, unknown>;
          if (Array.isArray(opts.messages)) {
            const msgs = opts.messages as Array<Record<string, unknown>>;
            const hasSystem = msgs.some((m) => m.role === "system");
            if (!hasSystem) {
              msgs.unshift({ role: "system", content: customSystem });
            } else {
              // Replace the first system message
              const idx = msgs.findIndex((m) => m.role === "system");
              if (idx !== -1) msgs[idx] = { role: "system", content: customSystem };
            }
          } else if (typeof opts.system === "string") {
            opts.system = customSystem;
          }
        }
      }
    },

    "chat.message": async (_input, output) => {
      const text = output.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as { text?: string }).text ?? "")
        .join("");
      const approx = estimateTokens(text);
      if (approx > 8000) {
        console.warn(
          `[matthew] Large user message (~${approx.toLocaleString()} tokens). ` +
            `Consider splitting the request or using \`@file\` references.`,
        );
      }
    },
  } satisfies Hooks;
};
