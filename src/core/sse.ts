/**
 * Line-oriented reader for Matthew's SSE stream.
 *
 * Matthew multiplexes several kinds of message over one stream, and which
 * one a `data:` line is depends entirely on the `event:` line before it.
 * `message` carries a JSON envelope, `ptoken`/`ctoken` carry bare
 * integers, and `tool_call` carries a call the *client* is expected to
 * execute and answer. Reading data lines without tracking the event name
 * cannot tell them apart.
 *
 * Both response paths share this: the incremental one, which forwards text
 * as it arrives, and the buffered one, which needs the whole reply before
 * it can answer. Duplicating the state machine across the two is how the
 * `tool_call` and token events came to be handled in one and not the
 * other.
 */

/**
 * A call Matthew wants run client-side. Its own tools only — the frontend
 * implements `run_data_analysis` and `generate_document` locally and posts
 * the result back to `/api/submit_tool_result`.
 */
export interface MatthewToolCall {
  name: string;
  toolCallId: string;
  arguments: Record<string, unknown>;
}

export interface SseHandlers {
  onText?(text: string): void;
  onPromptTokens?(count: number): void;
  onCompletionTokens?(count: number): void;
  onToolCall?(call: MatthewToolCall): void;
  /** Raw payload of an `error` event, which is not always JSON. */
  onError?(raw: string): void;
  onComplete?(): void;
}

/**
 * Events we knowingly discard, listed so the next reader can tell a
 * decision from an oversight:
 *
 * - `web_sources` — citations for a browsing answer. No OpenAI field
 *   carries them; inlining them would corrupt the reply text.
 * - `tool` — a progress label ("Working...") for Matthew's own UI.
 * - `progress`, `document_ready` — UI affordances with no wire equivalent.
 * - `alert` — server-side notices, likely including quota warnings. Worth
 *   surfacing, but it belongs with mapping errors onto OpenAI's shapes
 *   rather than here.
 */
const IGNORED_EVENTS = new Set([
  "web_sources",
  "tool",
  "progress",
  "document_ready",
  "alert",
]);

export interface SseReader {
  /** Feed a decoded chunk. Complete lines are dispatched; a partial tail is held. */
  push(chunk: string): void;
  /** Dispatch a held tail with no trailing newline. */
  flush(): void;
  /** True once `complete` or `error` has been seen. */
  readonly finished: boolean;
}

export function createSseReader(handlers: SseHandlers): SseReader {
  let buffer = "";
  let currentEvent = "";
  let finished = false;

  function parseCount(data: string): number | null {
    const count = Number.parseInt(data, 10);
    if (!Number.isFinite(count) || count < 0) return null;
    return count;
  }

  function handleLine(rawLine: string): void {
    if (finished) return;

    const line = rawLine.trimEnd();

    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim();
      return;
    }

    if (!line.startsWith("data:")) {
      // A blank line ends the frame. Any other field (`id:`, `retry:`) is
      // unused and must not clear the event name.
      if (line === "") currentEvent = "";
      return;
    }

    const data = line.slice(5).trim();
    const event = currentEvent;
    currentEvent = "";

    switch (event) {
      case "complete":
        finished = true;
        handlers.onComplete?.();
        return;

      case "error":
        finished = true;
        handlers.onError?.(data || "Stream error");
        return;

      case "ptoken": {
        const count = parseCount(data);
        if (count !== null) handlers.onPromptTokens?.(count);
        return;
      }

      case "ctoken": {
        const count = parseCount(data);
        if (count !== null) handlers.onCompletionTokens?.(count);
        return;
      }

      case "tool_call": {
        if (!data) return;
        try {
          const parsed = JSON.parse(data) as {
            name?: unknown;
            tool_call_id?: unknown;
            arguments?: unknown;
          };
          if (typeof parsed.name !== "string" || typeof parsed.tool_call_id !== "string") {
            return;
          }
          handlers.onToolCall?.({
            name: parsed.name,
            toolCallId: parsed.tool_call_id,
            arguments:
              parsed.arguments && typeof parsed.arguments === "object"
                ? (parsed.arguments as Record<string, unknown>)
                : {},
          });
        } catch {
          // A tool call we cannot parse is one we cannot answer either.
        }
        return;
      }

      case "":
      case "message": {
        if (!data) return;
        try {
          const parsed = JSON.parse(data) as { message?: string };
          if (parsed.message) handlers.onText?.(parsed.message);
        } catch {
          // skip non-JSON
        }
        return;
      }

      default:
        if (!IGNORED_EVENTS.has(event)) {
          // An event Matthew added since this was written. Silence is the
          // safe response — the alternative is corrupting the reply with
          // a payload we do not understand.
        }
    }
  }

  return {
    push(chunk: string): void {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    },
    flush(): void {
      if (!buffer) return;
      const tail = buffer;
      buffer = "";
      handleLine(tail);
    },
    get finished() {
      return finished;
    },
  };
}
