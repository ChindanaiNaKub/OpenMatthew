import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse, Server } from "node:http";
import { getApiBase } from "../constants.js";
import { handleMatthewChat } from "../core/chat.js";
import type { OpenAIChatRequest } from "../core/chat.js";
import { decodeCredentials } from "../core/credentials.js";
import type { MatthewCredentials } from "../core/credentials.js";
import { handleMatthewImages } from "../core/images.js";
import type { OpenAIImageRequest } from "../core/images.js";
import { toOpenAIModelList } from "../core/models.js";

/**
 * Standalone OpenAI-compatible server over the Matthew core.
 * Any platform that supports a custom OpenAI base URL + API key can point
 * at this instead of needing a bespoke Matthew integration.
 *
 * The Matthew credentials (access token, session token, assistant id) are
 * carried per-request as the API key, not configured once at server
 * startup — so one running server can serve multiple callers/accounts.
 * The key is the same `{accessToken, sessionToken, defaultAssistantId}`
 * blob the OpenCode adapter already produces on login, base64-encoded so
 * it survives as a Bearer token.
 */

export interface ServerOptions {
  port?: number;
  host?: string;
  apiBase?: string;
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

function parseCredentials(authHeader: string | undefined): MatthewCredentials | null {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const raw = match?.[1]?.trim();
  if (!raw) return null;

  // A bare token that is not a credentials blob serves as both tokens.
  return decodeCredentials(raw) ?? { accessToken: raw, sessionToken: raw };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Permissive CORS, because a browser-based platform UI cannot reach this
 * server at all without it — the preflight fails before our handler ever
 * runs. Safe enough here: the server binds to loopback by default and holds
 * no credentials of its own, since callers supply their own token per
 * request.
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", ...CORS_HEADERS });
  res.end(payload);
}

async function pipeWebResponse(webResponse: Response, res: ServerResponse): Promise<void> {
  const headers: Record<string, string> = {};
  webResponse.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(webResponse.status, { ...headers, ...CORS_HEADERS });

  if (!webResponse.body) {
    res.end();
    return;
  }

  const reader = webResponse.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    res.end();
  }
}

export function createMatthewServer(options: ServerOptions = {}): Server {
  const apiBase = options.apiBase || getApiBase();

  return createServer((req, res) => {
    void (async () => {
      if (!req.url) {
        sendJson(res, 400, { error: { message: "Invalid request" } });
        return;
      }

      if (req.method === "OPTIONS") {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      // The `/v1` prefix is optional, so routes are matched without it.
      const path = url.pathname.replace(/^\/v1(?=\/)/, "");

      // Many OpenAI clients enumerate models before letting you pick one,
      // and show an empty or broken picker if this 404s. It needs no auth:
      // the list is static, and requiring a token here just breaks clients
      // that probe the endpoint before they are configured.
      if (req.method === "GET" && path === "/models") {
        sendJson(res, 200, toOpenAIModelList());
        return;
      }

      const isChatCompletions = path === "/chat/completions";
      const isImageGenerations = path === "/images/generations";

      if (req.method !== "POST" || !(isChatCompletions || isImageGenerations)) {
        sendJson(res, 404, { error: { message: "Not found" } });
        return;
      }

      const credentials = parseCredentials(req.headers.authorization);
      if (!credentials) {
        sendJson(res, 401, { error: { message: "Missing or invalid Authorization header" } });
        return;
      }

      let body: OpenAIChatRequest & OpenAIImageRequest;
      try {
        body = JSON.parse(await readBody(req)) as OpenAIChatRequest & OpenAIImageRequest;
      } catch {
        sendJson(res, 400, { error: { message: "Invalid JSON body" } });
        return;
      }

      try {
        const assistantId = credentials.assistantId || "default";
        const webResponse = isImageGenerations
          ? await handleMatthewImages(body, credentials.accessToken, credentials.sessionToken, assistantId, apiBase)
          : await handleMatthewChat(body, credentials.accessToken, credentials.sessionToken, assistantId, apiBase);
        await pipeWebResponse(webResponse, res);
      } catch (err) {
        sendJson(res, 500, {
          error: { message: err instanceof Error ? err.message : "Unknown error" },
        });
      }
    })();
  });
}

export function startMatthewServer(options: ServerOptions = {}): Promise<RunningServer> {
  const port = options.port ?? Number(process.env.PORT || 4141);
  const host = options.host || "127.0.0.1";
  const server = createMatthewServer(options);

  return new Promise((resolve, reject) => {
    const handleError = (error: Error) => {
      server.off("error", handleError);
      reject(error);
    };
    server.once("error", handleError);
    server.listen(port, host, () => {
      server.off("error", handleError);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({
        port: actualPort,
        close: () =>
          new Promise((res, rej) => {
            server.close((error) => (error ? rej(error) : res()));
          }),
      });
    });
  });
}
