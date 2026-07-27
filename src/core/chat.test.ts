import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { handleMatthewChat, serializeConversation } from "./chat.js";

/**
 * A stand-in for Matthew that enforces the parts of its protocol we
 * actually depend on: the Bearer token, the ticket exchange, and the SSE
 * framing. It records the requests it saw so tests can assert on what we
 * sent, not just what we got back.
 */
interface FakeMatthew {
  server: Server;
  base: string;
  sentMessage(): string;
  sentFields(): Record<string, string>;
  streamUrl(): string;
  close(): Promise<void>;
}

async function startFakeMatthew(
  options: { ticketStatus?: number } = {},
): Promise<FakeMatthew> {
  let sentFields: Record<string, string> = {};
  let streamUrl = "";

  const server = createServer((req, res) => {
    void (async () => {
      const url = req.url ?? "";

      if (url.startsWith("/api/thread_sse_message")) {
        if (req.headers.authorization !== "Bearer access-token") {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "bad token" }));
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const raw = Buffer.concat(chunks).toString("utf-8");
        // Pull the form-data parts we care about out of the raw body.
        sentFields = {};
        for (const match of raw.matchAll(
          /name="([^"]+)"\r?\n\r?\n([\s\S]*?)\r?\n--/g,
        )) {
          sentFields[match[1] as string] = match[2] as string;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ new_thread: { thread_actual_id: "thread-1" } }));
        return;
      }

      if (url.startsWith("/api/thread_sse_ticket")) {
        if (options.ticketStatus && options.ticketStatus !== 200) {
          res.writeHead(options.ticketStatus, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "nope" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ticket: "ticket-1" }));
        return;
      }

      if (url.startsWith("/api/thread_sse_response_stream")) {
        streamUrl = url;
        // The real endpoint authenticates by ticket only — no header, since
        // the frontend drives it with EventSource, which cannot set them.
        if (!url.includes("ticket=ticket-1")) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Authentication token is required" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write('data: {"message":"Hel"}\n\n');
        res.write('data: {"message":"lo"}\n\n');
        res.write("event: complete\ndata: {}\n\n");
        res.end();
        return;
      }

      res.writeHead(404);
      res.end();
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    server,
    base: `http://127.0.0.1:${port}`,
    sentMessage: () => sentFields.message ?? "",
    sentFields: () => sentFields,
    streamUrl: () => streamUrl,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function chat(fake: FakeMatthew, body: Parameters<typeof handleMatthewChat>[0]) {
  return handleMatthewChat(body, "access-token", "session-token", "aid-1", fake.base);
}

test("streams a reply back in OpenAI SSE shape", async () => {
  const fake = await startFakeMatthew();
  try {
    const response = await chat(fake, {
      model: "gpt-5.2",
      messages: [{ role: "user", content: "hi" }],
    });
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.match(text, /"content":"Hel"/);
    assert.match(text, /"content":"lo"/);
    assert.match(text, /"finish_reason":"stop"/);
    assert.match(text, /data: \[DONE\]/);
  } finally {
    await fake.close();
  }
});

test("collects the full reply when stream is false", async () => {
  const fake = await startFakeMatthew();
  try {
    const response = await chat(fake, {
      model: "gpt-5.2",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    });
    const body = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    assert.equal(response.status, 200);
    assert.equal(body.choices[0]?.message.content, "Hello");
  } finally {
    await fake.close();
  }
});

// The stream endpoint stopped accepting the access token on 2026-07-27 and
// now requires a ticket. Reverting that fix must fail loudly here.
test("authenticates the stream with a ticket, not the token", async () => {
  const fake = await startFakeMatthew();
  try {
    await chat(fake, { model: "gpt-5.2", messages: [{ role: "user", content: "hi" }] })
      .then((r) => r.text());

    assert.match(fake.streamUrl(), /ticket=ticket-1/);
  } finally {
    await fake.close();
  }
});

test("reports an expired session when the ticket exchange 401s", async () => {
  const fake = await startFakeMatthew({ ticketStatus: 401 });
  try {
    const response = await chat(fake, {
      model: "gpt-5.2",
      messages: [{ role: "user", content: "hi" }],
    });
    const body = (await response.json()) as { error: { message: string } };

    assert.equal(response.status, 502);
    assert.match(body.error.message, /expired/);
  } finally {
    await fake.close();
  }
});

test("sends the session token and assistant id Matthew expects", async () => {
  const fake = await startFakeMatthew();
  try {
    await chat(fake, { model: "gpt-5.2", messages: [{ role: "user", content: "hi" }] })
      .then((r) => r.text());

    assert.equal(fake.sentFields().token, "session-token");
    assert.equal(fake.sentFields().aid, "aid-1");
    assert.equal(fake.sentFields().thread_id, "newchat");
  } finally {
    await fake.close();
  }
});

// The whole conversation has to travel in the message body: every request
// opens a fresh Matthew thread, so anything omitted here is lost outright.
test("forwards the system prompt and prior turns, not just the last message", async () => {
  const fake = await startFakeMatthew();
  try {
    await chat(fake, {
      model: "gpt-5.2",
      messages: [
        { role: "system", content: "You are a pirate." },
        { role: "user", content: "what is 2+2" },
        { role: "assistant", content: "four, matey" },
        { role: "user", content: "and 3+3?" },
      ],
    }).then((r) => r.text());

    const sent = fake.sentMessage();
    assert.match(sent, /You are a pirate\./);
    assert.match(sent, /what is 2\+2/);
    assert.match(sent, /four, matey/);
    assert.match(sent, /and 3\+3\?/);
  } finally {
    await fake.close();
  }
});

// Strict clients and the official SDKs validate this envelope and reject
// chunks without it, so a missing id/object/created breaks them outright.
test("wraps streamed chunks in the OpenAI id/object/created envelope", async () => {
  const fake = await startFakeMatthew();
  try {
    const text = await chat(fake, {
      model: "gpt-5.2",
      messages: [{ role: "user", content: "hi" }],
    }).then((r) => r.text());

    const first = JSON.parse(
      text.split("\n").find((l) => l.startsWith("data: {"))!.slice(6),
    ) as { id: string; object: string; created: number };

    assert.equal(first.object, "chat.completion.chunk");
    assert.match(first.id, /^chatcmpl-/);
    assert.ok(first.created > 0);
  } finally {
    await fake.close();
  }
});

test("wraps the non-streamed reply in the same envelope", async () => {
  const fake = await startFakeMatthew();
  try {
    const body = (await chat(fake, {
      model: "gpt-5.2",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    }).then((r) => r.json())) as { id: string; object: string; created: number };

    assert.equal(body.object, "chat.completion");
    assert.match(body.id, /^chatcmpl-/);
    assert.ok(body.created > 0);
  } finally {
    await fake.close();
  }
});

test("sends a lone user message verbatim", () => {
  assert.equal(serializeConversation([{ role: "user", content: "just this" }]), "just this");
});

test("survives an empty message list", () => {
  assert.equal(serializeConversation([]), "");
});
