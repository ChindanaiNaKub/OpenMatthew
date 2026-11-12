import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import {
  MATTHEW_PROVIDER_ID,
  getApiBase,
  getConfigDir,
} from "../constants.js";
import { createSseParser } from "./sse.js";
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

function getUsagePath(): string {
  return join(getConfigDir(), "matthew-usage.json");
}

function getUsageLogPath(): string {
  return join(getConfigDir(), "matthew-usage.log");
}

export async function loadUsage(): Promise<StoredUsage | null> {
  try {
    const data = JSON.parse(await fs.readFile(getUsagePath(), "utf-8")) as StoredUsage;
    if (data.version !== 1 || !data.totalUsage || !Array.isArray(data.history)) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export async function saveUsage(usage: StoredUsage): Promise<void> {
  const path = getUsagePath();
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify(usage, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export async function recordUsage(record: UsageRecord): Promise<void> {
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

/** Record usage in the background. A failed write must not reach the response. */
function track(usage: UsageStats, model?: string): void {
  recordUsage({ timestamp: Date.now(), model, usage }).catch(() => {});
}

/** Token counts from an OpenAI-style `usage` object, or a Matthew-style top-level payload. */
function usageFromPayload(payload: Record<string, unknown>): UsageStats | null {
  const source =
    payload.usage && typeof payload.usage === "object"
      ? (payload.usage as Record<string, unknown>)
      : payload;
  const prompt = (source.prompt_tokens ?? source.context_tokens ?? source.input_tokens ?? 0) as number;
  const completion = (source.completion_tokens ?? source.response_tokens ?? source.output_tokens ?? 0) as number;
  const total = (source.total_tokens as number) || prompt + completion;

  if (prompt > 0 || completion > 0 || total > 0) {
    return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total || prompt + completion };
  }
  return null;
}

/**
 * Try to extract usage from a single SSE data payload string.
 * Handles both OpenAI-style `usage` and Matthew's potential custom formats.
 */
export function extractUsageFromData(data: string): UsageStats | null {
  const json = data.trim().replace(/^data:/, "").trim();
  if (!json || json === "[DONE]") return null;

  try {
    return usageFromPayload(JSON.parse(json) as Record<string, unknown>);
  } catch {
    // Not valid JSON, ignore
    return null;
  }
}

/** Completion-only usage estimated from reply text, for when the upstream sent no counts. */
function estimatedUsage(text: string): UsageStats | null {
  const completion = estimateTokens(text);
  if (completion <= 0) return null;
  return { prompt_tokens: 0, completion_tokens: completion, total_tokens: completion };
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
  const reader = source.getReader();
  let foundUsage: UsageStats | null = null;
  let responseText = "";

  const sse = createSseParser((_event, data) => {
    const usage = extractUsageFromData(data);
    if (usage) foundUsage = usage;

    if (data === "[DONE]") return;
    try {
      const choices = (JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }).choices;
      const content = choices?.[0]?.delta?.content;
      if (content) responseText += content;
    } catch {
      // Ignore non-JSON or malformed lines
    }
  });

  return new ReadableStream<Uint8Array>({
    start(controller) {
      function push() {
        reader.read().then(({ done, value }) => {
          if (done) {
            sse.end();
            const usage = foundUsage ?? estimatedUsage(responseText);
            if (usage) track(usage, model);
            controller.close();
            return;
          }

          // Pass the chunk through unchanged
          controller.enqueue(value);
          sse.push(decoder.decode(value, { stream: true }));
          push();
        }).catch((err) => {
          controller.error(err);
        });
      }

      push();
    },

    cancel() {
      reader.cancel().catch(() => {});
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

  if (contentType.includes("application/json")) {
    response.clone().json().then((parsed) => {
      const payload = parsed as Record<string, unknown>;
      const choices = payload.choices as Array<{ message?: { content?: string } }> | undefined;
      const usage = usageFromPayload(payload) ?? estimatedUsage(choices?.[0]?.message?.content ?? "");
      if (usage) track(usage, model);
    }).catch(() => {});
  }

  return response;
}

/**
 * Fetch current usage quota from Matthew's dashboard API if available.
 */
export async function fetchMatthewUsage(
  accessToken: string,
  apiBase = getApiBase(),
): Promise<{
  contextUsed?: number;
  contextLimit?: number;
  responseUsed?: number;
  responseLimit?: number;
} | null> {
  const possibleEndpoints = [
    `${apiBase}/api/user/usage`,
    `${apiBase}/api/me/usage`,
    `${apiBase}/api/creator/usage`,
    `${apiBase}/api/dashboard/usage`,
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

export interface UsageSummary {
  total: UsageStats;
  requests: number;
}

/** The accumulated totals, without the raw history. */
export async function usageSummary(): Promise<UsageSummary> {
  const usage = await loadUsage();
  return {
    total: usage?.totalUsage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    requests: usage?.history.length ?? 0,
  };
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
