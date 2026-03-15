import { exec } from "node:child_process";
import type { Plugin, Hooks } from "@opencode-ai/plugin";
import {
  MATTHEW_PROVIDER_ID,
  MATTHEW_API_BASE,
  MATTHEW_CLIENT_ID,
} from "./constants.js";
import {
  authorizeMicrosoft,
  exchangeViaMatthew,
} from "./oauth/microsoft.js";
import {
  loadAccounts,
  saveAccounts,
} from "./plugin/storage.js";

const MATTHEW_MODELS = {
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
 * Uses Microsoft Azure AD (CMU tenant) SSO via the Matthew web app's
 * login flow, then proxies LLM requests through the Matthew AI platform.
 */
export const MatthewOAuthPlugin: Plugin = async () => {
  const matthewApiBase =
    process.env.MATTHEW_API_BASE || MATTHEW_API_BASE;
  const clientId =
    process.env.MATTHEW_OAUTH_CLIENT_ID || MATTHEW_CLIENT_ID;

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
          label: "Login with CMU Account (Microsoft SSO)",

          async authorize() {
            const { url } = authorizeMicrosoft(clientId);

            openBrowser(url);

            return {
              url,
              instructions:
                "Login with your CMU Account via Microsoft SSO.\n" +
                "After login, you'll be redirected to matthew.cmu.ac.th.\n" +
                "Copy the 'code' parameter from the URL and paste it here.",
              method: "code" as const,

              async callback(codeInput: string) {
                try {
                  let code = codeInput.trim();

                  if (code.startsWith("http")) {
                    const parsedUrl = new URL(code);
                    code = parsedUrl.searchParams.get("code") || code;
                  }

                  if (!code) {
                    return { type: "failed" as const };
                  }

                  const result = await exchangeViaMatthew(code);

                  if (result.type === "failed") {
                    console.error(
                      `[matthew] Token exchange failed: ${result.error}`,
                    );
                    return { type: "failed" as const };
                  }

                  const storage = (await loadAccounts()) ?? {
                    version: 1 as const,
                    accounts: [],
                    activeIndex: 0,
                  };

                  const account = {
                    accessToken: result.accessToken,
                    addedAt: Date.now(),
                    lastUsed: Date.now(),
                  };

                  storage.accounts.push(account);
                  storage.activeIndex = storage.accounts.length - 1;
                  await saveAccounts(storage);

                  return {
                    type: "success" as const,
                    refresh: result.accessToken,
                    access: result.accessToken,
                    expires: Date.now() + 3600 * 1000,
                  };
                } catch (err) {
                  console.error("[matthew] OAuth error:", err);
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
