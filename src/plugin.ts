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

/**
 * Main OpenCode plugin for CMU Matthew AI authentication.
 *
 * Auth flow:
 * 1. Opens matthew.cmu.ac.th login in browser
 * 2. User logs in with CMU Account + MFA
 * 3. After login, user copies token (F12 → Console → short command)
 * 4. Pastes token into OpenCode
 */
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

          const isMatthewRequest =
            url.hostname.includes("matthew.cmu.ac.th") ||
            url.origin === matthewApiBase;

          if (!isMatthewRequest) {
            return fetch(input, init);
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

                  if (!token) {
                    return { type: "failed" as const };
                  }

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
