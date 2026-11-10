import { exec } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { Credential, Model, Plugin, Provider } from "@opencode/plugin";
import {
  MATTHEW_PROVIDER_ID,
  MATTHEW_API_BASE,
  MATTHEW_LOGIN_URL,
} from "./constants.js";
import { MATTHEW_MODELS } from "./core/models.js";
import { loadAccounts, saveAccounts } from "./core/storage.js";
import {
  wrapResponseWithUsageTracking,
  fetchMatthewUsage,
} from "./core/usage.js";
import { estimateTokens, checkBudget, formatBudget } from "./core/tokens.js";
import { startMatthewServer } from "./server/index.js";

const SYSTEM_PROMPT =
  "You are a world-class software engineer. " +
  "Be concise, precise, and prioritize correctness over verbosity. " +
  "When editing code, output only the changed sections (diff-style) " +
  "instead of rewriting entire files unless asked.";

function getOpenCodeConfigDir(): string {
  if (process.env.OPENCODE_CONFIG_DIR) {
    return process.env.OPENCODE_CONFIG_DIR;
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgConfig, "opencode");
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

interface StoredAccess {
  accessToken: string;
  sessionToken: string;
  defaultAssistantId?: string;
}

function parseAccess(access: string): StoredAccess {
  try {
    return JSON.parse(access) as StoredAccess;
  } catch {
    return { accessToken: access, sessionToken: access };
  }
}

export default Plugin.define({
  id: "matthew",
  async setup(ctx) {
    const matthewApiBase = process.env.MATTHEW_API_BASE || MATTHEW_API_BASE;
    const server = await startMatthewServer({ port: 0, apiBase: matthewApiBase });
    const providerID = Provider.ID.make(MATTHEW_PROVIDER_ID);

    await ctx.integration.transform((editor) => {
      editor.method.update({
        integrationID: MATTHEW_PROVIDER_ID,
        method: { id: "login", type: "oauth", label: "Login with CMU Account" },
        async authorize() {
          openBrowser(MATTHEW_LOGIN_URL);

          return {
            url: MATTHEW_LOGIN_URL,
            instructions:
              "1. Login to matthew.cmu.ac.th with your CMU Account\n" +
              "2. After login, press F12 → Console tab → paste this:\n" +
              "   copy(localStorage.user)\n" +
              "3. Come back here and paste it",
            mode: "code" as const,
            async callback(input: string) {
              const raw = input.trim();
              if (!raw) throw new Error("No login data pasted");

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

              if (!accessToken || !sessionToken) throw new Error("Login data is incomplete");

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

              try {
                const usage = await fetchMatthewUsage(accessToken);
                if (usage && (usage.contextUsed || usage.responseUsed)) {
                  const status = checkBudget(usage.contextUsed ?? 0, usage.responseUsed ?? 0);
                  console.log(formatBudget(status));
                }
              } catch {
                // Dashboard usage fetch is best-effort
              }

              return {
                type: "oauth",
                methodID: "login",
                access: JSON.stringify({ accessToken, sessionToken, defaultAssistantId }),
                refresh: JSON.stringify({ accessToken, sessionToken, defaultAssistantId }),
                expires: Date.now() + 3600 * 1000,
              } as Credential.OAuth;
            },
          };
        },
      });
    });

    await ctx.provider.transform((editor) => {
      editor.add({
        info: {
          ...Provider.Info.empty(providerID),
          integrationID: MATTHEW_PROVIDER_ID as never,
          name: "CMU Matthew AI",
          activation: "enabled",
          package: "@opencode/ai/providers/openai-compatible",
          settings: { baseURL: `http://127.0.0.1:${server.port}/v1` },
        },
        models: MATTHEW_MODELS.map((model) => ({
          ...Model.Info.default(providerID, Model.ID.make(model.id)),
          name: model.name,
          limit: { context: 128000, output: 16384 },
        })),
      });
    });

    await ctx.session.hook(
      "model.request",
      async (event) => {
        const connection = await ctx.integration.connection.active(MATTHEW_PROVIDER_ID);
        const credential = connection && (await ctx.integration.connection.resolve(connection));
        if (!credential || credential.type !== "oauth") return;

        const { accessToken, sessionToken, defaultAssistantId } = parseAccess(credential.access);
        const blob = { accessToken, sessionToken, assistantId: defaultAssistantId };
        event.headers.Authorization = `Bearer ${Buffer.from(JSON.stringify(blob)).toString("base64")}`;
      },
      { providerID: MATTHEW_PROVIDER_ID },
    );

    await ctx.session.hook(
      "context",
      (event) => {
        event.options.temperature = 0.2;
        event.options.topP = 0.95;

        if (process.env.MATTHEW_OVERRIDE_SYSTEM !== "0") {
          event.system.push({
            type: "text",
            text: process.env.MATTHEW_SYSTEM_PROMPT ?? SYSTEM_PROMPT,
          });
        }
      },
      { providerID: MATTHEW_PROVIDER_ID },
    );

    await ctx.session.hook(
      "http.response",
      (event) => {
        event.response = wrapResponseWithUsageTracking(event.response, event.model.id);
      },
      { providerID: MATTHEW_PROVIDER_ID },
    );

    await ctx.session.hook(
      "prompt",
      (event) => {
        const approx = estimateTokens(event.prompt.text);
        if (approx > 8000) {
          console.warn(
            `[matthew] Large user message (~${approx.toLocaleString()} tokens). ` +
              `Consider splitting the request or using \`@file\` references.`,
          );
        }
      },
    );

    return () => server.close();
  },
});
