import { exec } from "node:child_process";
import type { Plugin, Hooks } from "@opencode-ai/plugin";
import {
  MATTHEW_PROVIDER_ID,
  MATTHEW_API_BASE,
  MATTHEW_CLIENT_ID,
  MATTHEW_OAUTH_CALLBACK,
} from "./constants.js";
import {
  authorizeMicrosoftPKCE,
  exchangeWithMicrosoft,
  exchangeViaMatthew,
} from "./oauth/microsoft.js";
import { startOAuthListener } from "./plugin/server.js";
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
 * Fully automatic OAuth flow:
 * 1. Opens Microsoft SSO login in browser (with PKCE + localhost redirect)
 * 2. User logs in with CMU Account + MFA
 * 3. Browser auto-redirects to localhost, plugin captures the code
 * 4. Plugin exchanges code for Matthew access token
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
          label: "Login with CMU Account",

          async authorize() {
            const { url, codeVerifier } = authorizeMicrosoftPKCE(clientId);

            const listener = await startOAuthListener();
            openBrowser(url);

            return {
              url,
              instructions:
                "Login with your CMU Account via Microsoft SSO. " +
                "The browser will redirect back automatically after login.",
              method: "auto" as const,

              async callback() {
                try {
                  const callbackUrl = await listener.waitForCallback();
                  const code = callbackUrl.searchParams.get("code");
                  const error = callbackUrl.searchParams.get("error");

                  if (error || !code) {
                    const desc =
                      callbackUrl.searchParams.get("error_description") ||
                      error ||
                      "No authorization code";
                    console.error(`[matthew] OAuth failed: ${desc}`);
                    return { type: "failed" as const };
                  }

                  // Strategy 1: Exchange via Matthew's backend
                  let accessToken: string | null = null;
                  const matthewResult = await exchangeViaMatthew(code);
                  if (matthewResult.type === "success") {
                    accessToken = matthewResult.accessToken;
                  }

                  // Strategy 2: Exchange directly with Microsoft using PKCE
                  if (!accessToken) {
                    const msResult = await exchangeWithMicrosoft(
                      code,
                      codeVerifier,
                      clientId,
                    );
                    if (msResult.type === "success") {
                      accessToken = msResult.accessToken;
                    } else {
                      console.error(
                        `[matthew] Token exchange failed: ${msResult.error}`,
                      );
                      return { type: "failed" as const };
                    }
                  }

                  const storage = (await loadAccounts()) ?? {
                    version: 1 as const,
                    accounts: [],
                    activeIndex: 0,
                  };

                  storage.accounts.push({
                    accessToken,
                    addedAt: Date.now(),
                    lastUsed: Date.now(),
                  });
                  storage.activeIndex = storage.accounts.length - 1;
                  await saveAccounts(storage);

                  return {
                    type: "success" as const,
                    refresh: accessToken,
                    access: accessToken,
                    expires: Date.now() + 3600 * 1000,
                  };
                } catch (err) {
                  console.error("[matthew] OAuth error:", err);
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
