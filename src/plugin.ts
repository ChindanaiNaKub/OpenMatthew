import { exec } from "node:child_process";
import type { Plugin, Hooks } from "@opencode-ai/plugin";
import {
  MATTHEW_PROVIDER_ID,
  MATTHEW_API_BASE,
  OAUTH_REDIRECT_URI,
} from "./constants.js";
import { authorizeCmu, exchangeCmu } from "./oauth/cmu.js";
import { startOAuthListener } from "./plugin/server.js";
import {
  loadAccounts,
  saveAccounts,
  type AccountStorage,
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

function getClientId(): string {
  const id = process.env.CMU_OAUTH_CLIENT_ID;
  if (!id) {
    throw new Error(
      "CMU_OAUTH_CLIENT_ID environment variable is required. " +
        "Register your app at https://oauth.cmu.ac.th to obtain one.",
    );
  }
  return id;
}

function getClientSecret(): string {
  const secret = process.env.CMU_OAUTH_CLIENT_SECRET;
  if (!secret) {
    throw new Error(
      "CMU_OAUTH_CLIENT_SECRET environment variable is required. " +
        "Register your app at https://oauth.cmu.ac.th to obtain one.",
    );
  }
  return secret;
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

/**
 * Main OpenCode plugin for CMU Matthew AI authentication.
 *
 * Provides OAuth-based login with CMU accounts and routes
 * LLM requests through the Matthew AI platform.
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

          return fetch(
            new Request(request, { headers }),
            init,
          );
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
            const clientId = getClientId();
            const { url, state } = authorizeCmu(clientId);

            const listener = await startOAuthListener();

            openBrowser(url);

            return {
              url,
              instructions:
                "Login with your CMU Account (@cmu.ac.th) to access Matthew AI.",
              method: "auto" as const,

              async callback() {
                try {
                  const callbackUrl = await listener.waitForCallback();
                  const code = callbackUrl.searchParams.get("code");

                  if (!code) {
                    return { type: "failed" as const };
                  }

                  const result = await exchangeCmu(
                    code,
                    getClientId(),
                    getClientSecret(),
                  );

                  if (result.type === "failed") {
                    return { type: "failed" as const };
                  }

                  const storage = (await loadAccounts()) ?? {
                    version: 1 as const,
                    accounts: [],
                    activeIndex: 0,
                  };

                  const existingIdx = storage.accounts.findIndex(
                    (a) => a.email === result.email,
                  );

                  const account = {
                    email: result.email,
                    firstName: result.firstName,
                    lastName: result.lastName,
                    accessToken: result.accessToken,
                    addedAt: Date.now(),
                    lastUsed: Date.now(),
                  };

                  if (existingIdx >= 0) {
                    storage.accounts[existingIdx] = account;
                    storage.activeIndex = existingIdx;
                  } else {
                    storage.accounts.push(account);
                    storage.activeIndex = storage.accounts.length - 1;
                  }

                  await saveAccounts(storage);

                  return {
                    type: "success" as const,
                    refresh: result.accessToken,
                    access: result.accessToken,
                    expires: Date.now() + 3600 * 1000,
                  };
                } catch {
                  return { type: "failed" as const };
                } finally {
                  await listener.close().catch(() => {});
                }
              },
            };
          },
        },
      ],
    },
  } satisfies Hooks;
};
