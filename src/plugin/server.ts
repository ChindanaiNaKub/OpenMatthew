import { createServer } from "node:http";
import { OAUTH_CALLBACK_PORT, OAUTH_REDIRECT_URI } from "../constants.js";

export interface OAuthListener {
  waitForCallback(): Promise<URL>;
  close(): Promise<void>;
}

const redirectUri = new URL(OAUTH_REDIRECT_URI);
const callbackPath = redirectUri.pathname || "/";

const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Authentication Successful</title>
    <style>
      :root {
        --bg: #FAFAFA;
        --card-bg: #FFFFFF;
        --text-primary: #1F2937;
        --text-secondary: #6B7280;
        --success: #10B981;
        --border: #E5E7EB;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #111827;
          --card-bg: #1F2937;
          --text-primary: #F9FAFB;
          --text-secondary: #9CA3AF;
          --success: #34D399;
          --border: #374151;
        }
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        background: var(--bg);
        color: var(--text-primary);
        padding: 1rem;
      }
      .card {
        background: var(--card-bg);
        border-radius: 16px;
        padding: 3rem 2rem;
        width: 100%;
        max-width: 400px;
        text-align: center;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        border: 1px solid var(--border);
      }
      .icon-wrapper {
        width: 64px;
        height: 64px;
        background: rgba(16, 185, 129, 0.1);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 1.5rem;
      }
      .icon { width: 32px; height: 32px; color: var(--success); }
      h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 0.5rem; }
      p { color: var(--text-secondary); font-size: 0.95rem; line-height: 1.5; margin: 0 0 2rem; }
      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: var(--text-primary);
        color: var(--card-bg);
        font-weight: 500;
        padding: 0.75rem 1.5rem;
        border-radius: 8px;
        border: none;
        cursor: pointer;
        width: 100%;
        box-sizing: border-box;
        font-size: 0.95rem;
      }
      .btn:hover { opacity: 0.9; }
      .sub-text { margin-top: 1rem; font-size: 0.8rem; color: var(--text-secondary); }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="icon-wrapper">
        <svg class="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h1>All set!</h1>
      <p>You've successfully authenticated with CMU Matthew AI. You can now return to OpenCode.</p>
      <button class="btn" onclick="window.close()">Close this tab</button>
      <div class="sub-text">If the button doesn't work, please close this tab manually.</div>
    </div>
  </body>
</html>`;

/**
 * Start a lightweight HTTP server to receive the CMU OAuth callback.
 */
export async function startOAuthListener(
  timeoutMs = 5 * 60 * 1000,
): Promise<OAuthListener> {
  const port = OAUTH_CALLBACK_PORT;
  const origin = `${redirectUri.protocol}//${redirectUri.host}`;

  let settled = false;
  let resolveCallback: (url: URL) => void;
  let rejectCallback: (error: Error) => void;
  let timeoutHandle: ReturnType<typeof setTimeout>;

  const callbackPromise = new Promise<URL>((resolve, reject) => {
    resolveCallback = (url: URL) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve(url);
    };
    rejectCallback = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      reject(error);
    };
  });

  timeoutHandle = setTimeout(() => {
    rejectCallback(new Error("Timed out waiting for OAuth callback"));
  }, timeoutMs);
  timeoutHandle.unref?.();

  const server = createServer((request, response) => {
    if (!request.url) {
      response.writeHead(400, { "Content-Type": "text/plain" });
      response.end("Invalid request");
      return;
    }

    const url = new URL(request.url, origin);
    if (url.pathname !== callbackPath) {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(SUCCESS_HTML);

    resolveCallback(url);

    setImmediate(() => {
      server.close();
    });
  });

  const bindAddress =
    process.env.OPENCODE_MATTHEW_OAUTH_BIND || "127.0.0.1";

  await new Promise<void>((resolve, reject) => {
    const handleError = (error: NodeJS.ErrnoException) => {
      server.off("error", handleError);
      if (error.code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${port} is already in use. Please terminate the process or try again.`,
          ),
        );
        return;
      }
      reject(error);
    };
    server.once("error", handleError);
    server.listen(port, bindAddress, () => {
      server.off("error", handleError);
      resolve();
    });
  });

  server.on("error", (error) => {
    rejectCallback(error instanceof Error ? error : new Error(String(error)));
  });

  return {
    waitForCallback: () => callbackPromise,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (
            error &&
            (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
          ) {
            reject(error);
            return;
          }
          if (!settled) {
            rejectCallback(new Error("OAuth listener closed before callback"));
          }
          resolve();
        });
      }),
  };
}
