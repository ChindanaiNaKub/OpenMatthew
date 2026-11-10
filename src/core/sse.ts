/**
 * Incremental parser for `text/event-stream` text. Feed it chunks as they
 * arrive. `onEvent` runs once per non-empty `data:` line, with the event
 * name that line belongs to ("" when none was given).
 */
export function createSseParser(onEvent: (event: string, data: string) => void) {
  let pending = "";
  let event = "";

  function line(text: string): void {
    if (text.startsWith("event:")) {
      event = text.slice(6).trim();
      return;
    }
    if (!text.startsWith("data:")) {
      // An event with no data line still counts, as a bare `event: error` does.
      if (event) onEvent(event, "");
      event = "";
      return;
    }
    const data = text.slice(5).trim();
    if (!data) return;
    const name = event;
    event = "";
    onEvent(name, data);
  }

  return {
    push(chunk: string): void {
      const lines = (pending + chunk).split("\n");
      pending = lines.pop() ?? "";
      for (const text of lines) line(text);
    },
    end(): void {
      if (pending) line(pending);
      pending = "";
    },
  };
}
