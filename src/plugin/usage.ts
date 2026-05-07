import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  MATTHEW_API_BASE,
  MATTHEW_PROVIDER_ID,
} from "../constants.js";
import { estimateTokens } from "./tokens.js";

export interface UsageStats {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface UsageRecord {
  timestamp: number;
  model?: string;
  usage: UsageStats;
}

export interface StoredUsage {
  version: 1;
  totalUsage: UsageStats;
  history: UsageRecord[];
}

function getConfigDir(): string {
  if (process.env.OPENCODE_CONFIG_DIR) {
    return process.env.OPENCODE_CONFIG_DIR;
  }
  const xdgConfig =
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgConfig, "opencode");
}

function getUsagePath(): string {
  return join(getConfigDir(), "matthew-usage.json");
}

function getUsageLogPath(): string {
  return join(getConfigDir(), "matthew-usage.log");
}

export async function loadUsage(): Promise<StoredUsage | null> {
  try {
    const path = getUsagePath();
    const content = await fs.readFile(path, "utf-8");
    const data = JSON.parse(content) as StoredUsage;
    if (data.version !== 1 || !data.totalUsage || !Array.isArray(data.history)) {
      return null;
    }
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

export async function saveUsage(usage: StoredUsage): Promise<void> {
  const path = getUsagePath();
  const configDir = dirname(path);
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path, JSON.stringify(usage, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export async function recordUsage(
  record: UsageRecord,
): Promise<void> {
  const usage = (await loadUsage()) ?? {
    version: 1 as const,
    totalUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    history: [],
  };

  usage.totalUsage.prompt_tokens += record.usage.prompt_tokens;
  usage.totalUsage.completion_tokens += record.usage.completion_tokens;
  usage.totalUsage.total_tokens += record.usage.total_tokens;
  usage.history.push(record);

  // Keep last 1000 records to avoid unbounded growth
  if (usage.history.length > 1000) {
    usage.history = usage.history.slice(-1000);
  }

  await saveUsage(usage);

  const line =
    `[${MATTHEW_PROVIDER_ID}] Usage: +${record.usage.prompt_tokens} prompt / +${record.usage.completion_tokens} completion tokens (total: ${usage.totalUsage.total_tokens})`;

  // Write to plain-text log for easy tail/cat
  try {
    const logPath = getUsageLogPath();
    const entry = `${new Date(record.timestamp).toISOString()}  ${line}\n`;
    await fs.appendFile(logPath, entry, { encoding: "utf-8" });
  } catch {
    // Best-effort logging
  }

  // Use console.error for visibility — many IDEs surface stderr more prominently
  console.error(line);
}

/**
 * Try to extract usage from a single SSE data payload string.
 * Handles both OpenAI-style `usage` and Matthew's potential custom formats.
 */
export function extractUsageFromData(data: string): UsageStats | null {
  const trimmed = data.trim();
  if (!trimmed) return null;

  // Remove "data: " prefix if present
  const jsonStr = trimmed.startsWith("data:")
    ? trimmed.slice(5).trim()
    : trimmed;

  if (!jsonStr || jsonStr === "[DONE]") return null;

  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    // OpenAI standard format
    if (parsed.usage && typeof parsed.usage === "object") {
      const u = parsed.usage as Record<string, unknown>;
      const prompt =
        (u.prompt_tokens as number) ??
        (u.input_tokens as number) ??
        0;
      const completion =
        (u.completion_tokens as number) ??
        (u.output_tokens as number) ??
        0;
      const total =
        (u.total_tokens as number) ||
        (prompt + completion);

      if (prompt > 0 || completion > 0 || total > 0) {
        return {
          prompt_tokens: prompt,
          completion_tokens: completion,
          total_tokens: total || prompt + completion,
        };
      }
    }

    // Matthew custom format: look for tokens/context/response fields
    const prompt =
      (parsed.prompt_tokens as number) ??
      (parsed.context_tokens as number) ??
      (parsed.input_tokens as number) ??
      0;
    const completion =
      (parsed.completion_tokens as number) ??
      (parsed.response_tokens as number) ??
      (parsed.output_tokens as number) ??
      0;
    const total =
      (parsed.total_tokens as number) ||
      (prompt + completion);

    if (prompt > 0 || completion > 0 || total > 0) {
      return {
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: total || prompt + completion,
      };
    }
  } catch {
    // Not valid JSON, ignore
  }

  return null;
}

/**
 * Wrap a ReadableStream to intercept SSE chunks and extract usage data.
 * Returns a new stream that is identical to the source for the consumer.
 */
export function createUsageTrackingStream(
  source: ReadableStream<Uint8Array>,
  model?: string,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = "";
  let foundUsage: UsageStats | null = null;
  let responseText = "";

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const reader = source.getReader();

      function push() {
        reader.read().then(({ done, value }) => {
          if (done) {
            // Process any remaining data in buffer
            if (buffer.trim()) {
              const lines = buffer.split("\n");
              for (const line of lines) {
                if (line.startsWith("data:")) {
                  const usage = extractUsageFromData(line);
                  if (usage) foundUsage = usage;
                }
              }
            }

            if (foundUsage) {
              recordUsage({
                timestamp: Date.now(),
                model,
                usage: foundUsage,
              }).catch(() => {});
            } else if (responseText.length > 0) {
              // Fallback: estimate completion tokens from response text
              const estimatedCompletion = estimateTokens(responseText);
              if (estimatedCompletion > 0) {
                recordUsage({
                  timestamp: Date.now(),
                  model,
                  usage: {
                    prompt_tokens: 0, // unknown from stream
                    completion_tokens: estimatedCompletion,
                    total_tokens: estimatedCompletion,
                  },
                }).catch(() => {});
              }
            }

            controller.close();
            return;
          }

          // Pass the chunk through unchanged
          controller.enqueue(value);

          // Also parse it for usage and accumulate text
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          // Extract text content from SSE data lines for fallback estimation
          const textLines = chunk.split("\n");
          for (const tl of textLines) {
            if (tl.startsWith("data:")) {
              const dataStr = tl.slice(5).trim();
              if (dataStr && dataStr !== "[DONE]") {
                try {
                  const parsed = JSON.parse(dataStr) as Record<string, unknown>;
                  const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
                  if (choices && choices[0]) {
                    const delta = choices[0].delta as Record<string, unknown> | undefined;
                    const content = delta?.content as string | undefined;
                    if (content) responseText += content;
                  }
                } catch {
                  // Ignore non-JSON or malformed lines
                }
              }
            }
          }

          const lines = buffer.split("\n");
          // Keep the last partial line in buffer
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data:")) {
              const usage = extractUsageFromData(line);
              if (usage) foundUsage = usage;
            }
          }

          push();
        }).catch((err) => {
          controller.error(err);
        });
      }

      push();
    },

    cancel() {
      source.cancel().catch(() => {});
    },
  });
}

/**
 * Wrap a fetch Response to track usage from its SSE stream or JSON body.
 */
export function wrapResponseWithUsageTracking(
  response: Response,
  model?: string,
): Response {
  if (!response.body) return response;

  const contentType = response.headers.get("content-type") || "";
  const isSse =
    contentType.includes("text/event-stream") ||
    contentType.includes("application/octet-stream"); // some proxies mislabel

  if (isSse) {
    const trackedBody = createUsageTrackingStream(response.body, model);
    return new Response(trackedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  // Handle non-streaming JSON responses
  if (contentType.includes("application/json")) {
    const clone = response.clone();
    clone
      .text()
      .then((text: string) => {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        const usage =
          extractUsageFromData(JSON.stringify(parsed)) ??
          (parsed.usage && typeof parsed.usage === "object"
            ? extractUsageFromData(
                JSON.stringify({ usage: parsed.usage }),
              )
            : null);
        if (usage) {
          recordUsage({ timestamp: Date.now(), model, usage }).catch(
            () => {},
          );
        } else {
          // Fallback: estimate from response content
          const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
          const msg = choices?.[0]?.message as Record<string, unknown> | undefined;
          const content = msg?.content as string | undefined;
          if (content) {
            const estimated = estimateTokens(content);
            recordUsage({
              timestamp: Date.now(),
              model,
              usage: {
                prompt_tokens: 0,
                completion_tokens: estimated,
                total_tokens: estimated,
              },
            }).catch(() => {});
          }
        }
      })
      .catch(() => {});
  }

  return response;
}

/**
 * Fetch current usage quota from Matthew's dashboard API if available.
 */
export async function fetchMatthewUsage(
  accessToken: string,
): Promise<{
  contextUsed?: number;
  contextLimit?: number;
  responseUsed?: number;
  responseLimit?: number;
} | null> {
  const possibleEndpoints = [
    `${MATTHEW_API_BASE}/api/user/usage`,
    `${MATTHEW_API_BASE}/api/me/usage`,
    `${MATTHEW_API_BASE}/api/creator/usage`,
    `${MATTHEW_API_BASE}/api/dashboard/usage`,
  ];

  for (const url of possibleEndpoints) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });

      if (response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        return {
          contextUsed:
            (data.context_used as number) ??
            (data.contextTokens as number) ??
            (data.context as number) ??
            undefined,
          contextLimit:
            (data.context_limit as number) ??
            (data.contextLimit as number) ??
            undefined,
          responseUsed:
            (data.response_used as number) ??
            (data.responseTokens as number) ??
            (data.response as number) ??
            undefined,
          responseLimit:
            (data.response_limit as number) ??
            (data.responseLimit as number) ??
            undefined,
        };
      }
    } catch {
      // Try next endpoint
    }
  }

  return null;
}

/**
 * Print current accumulated usage to the console.
 */
export async function printUsageSummary(): Promise<void> {
  const usage = await loadUsage();
  if (!usage) {
    console.error(`[${MATTHEW_PROVIDER_ID}] No usage recorded yet.`);
    return;
  }

  console.error(`[${MATTHEW_PROVIDER_ID}] Accumulated token usage:`);
  console.error(`  Prompt tokens:     ${usage.totalUsage.prompt_tokens.toLocaleString()}`);
  console.error(`  Completion tokens: ${usage.totalUsage.completion_tokens.toLocaleString()}`);
  console.error(`  Total tokens:      ${usage.totalUsage.total_tokens.toLocaleString()}`);
  console.error(`  Requests tracked:  ${usage.history.length}`);
}
