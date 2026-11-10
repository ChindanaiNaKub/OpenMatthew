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
  options: { ticketStatus?: number; reply?: string[]; usage?: boolean; raw?: string } = {},
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
        if (options.raw !== undefined) {
          res.end(options.raw);
          return;
        }
        for (const chunk of options.reply ?? ["Hel", "lo"]) {
          res.write(`data: ${JSON.stringify({ message: chunk })}\n\n`);
        }
        if (options.usage) {
          await new Promise((resolve) => setTimeout(resolve, 30));
          res.write("event: ptoken\ndata: 12.0\n\n");
          await new Promise((resolve) => setTimeout(resolve, 30));
          res.write("event: ctoken\ndata: 5.0\n\n");
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
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

// Usage events arrive in their own network chunks, after the text. A stream
// that only pulls again on message text never reaches the close.
test("ends the stream when usage events arrive after the reply", async () => {
  const fake = await startFakeMatthew({ usage: true });
  let timer: NodeJS.Timeout | undefined;
  try {
    const response = await chat(fake, {
      model: "gpt-5.2",
      messages: [{ role: "user", content: "hi" }],
    });
    const text = await Promise.race([
      response.text(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("stream never ended")), 5000);
      }),
    ]);

    assert.match(text, /"content":"lo"/);
    assert.match(text, /data: \[DONE\]/);
  } finally {
    clearTimeout(timer);
    await fake.close();
  }
});

test("keeps a final SSE line that has no trailing newline", async () => {
  const fake = await startFakeMatthew({
    raw: 'data: {"message":"Hel"}\n\ndata: {"message":"lo"}',
  });
  try {
    const response = await chat(fake, {
      model: "gpt-5.2",
      messages: [{ role: "user", content: "hi" }],
    });
    const text = await response.text();

    assert.match(text, /"content":"Hel"/);
    assert.match(text, /"content":"lo"/);
  } finally {
    await fake.close();
  }
});

test("a blank line ends an event name, so the next message is kept", async () => {
  const fake = await startFakeMatthew({
    raw: 'event: ptoken\ndata:\n\ndata: {"message":"lo"}\n\nevent: complete\ndata: {}\n\n',
  });
  try {
    const response = await chat(fake, {
      model: "gpt-5.2",
      messages: [{ role: "user", content: "hi" }],
    });
    const text = await response.text();

    assert.match(text, /"content":"lo"/);
  } finally {
    await fake.close();
  }
});

test("reports an error event the same way when the reply is buffered", async () => {
  const raw =
    'data: {"message":"Hel"}\n\nevent: error\ndata: {"message":"boom"}\n\n';
  const fake = await startFakeMatthew({ raw });
  try {
    const streamed = await (
      await chat(fake, { model: "gpt-5.2", messages: [{ role: "user", content: "hi" }] })
    ).text();
    const buffered = await (
      await chat(fake, {
        model: "gpt-5.2",
        stream: false,
        messages: [{ role: "user", content: "hi" }],
      })
    ).json() as { choices: [{ message: { content: string } }] };

    assert.match(streamed, /\[Error: .*boom/);
    assert.match(buffered.choices[0].message.content, /\[Error: .*boom/);
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

// Clients that use tools send `content` as a list of parts. Before this it
// reached Matthew as "[object Object]".
test("flattens content given as a list of parts", () => {
  const sent = serializeConversation([
    { role: "system", content: [{ type: "text", text: "Be terse." }] },
    { role: "user", content: [{ type: "text", text: "first" }, { type: "text", text: "second" }] },
  ]);

  assert.match(sent, /Be terse\./);
  assert.match(sent, /first\nsecond/);
  assert.doesNotMatch(sent, /\[object Object\]/);
});

// The second turn of a tool loop: the model has to see the call it made
// and the result that came back, or it answers the original question again.
test("replays a completed tool turn back into the transcript", () => {
  const sent = serializeConversation([
    { role: "user", content: "what is in a.ts" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "read_file", arguments: '{"path":"a.ts"}' },
        },
      ],
    },
    { role: "tool", tool_call_id: "call_1", content: "export const x = 1" },
  ]);

  assert.match(sent, /<tool_call>/);
  assert.match(sent, /"name":"read_file"/);
  // The result is labelled with the tool's name, which only the assistant
  // turn knows — the tool message carries an id.
  assert.match(sent, /Tool result \(read_file\): export const x = 1/);
  assert.match(sent, /Continue, using the tool result above\./);
});

test("sends the tool schemas to Matthew as prompt text", async () => {
  const fake = await startFakeMatthew();
  try {
    await chat(fake, {
      model: "gpt-5.2",
      messages: [{ role: "user", content: "read a.ts" }],
      tools: [
        {
          type: "function",
          function: {
            name: "read_file",
            description: "Read a file.",
            parameters: { type: "object", properties: { path: { type: "string" } } },
          },
        },
      ],
    }).then((r) => r.text());

    const sent = fake.sentMessage();
    assert.match(sent, /read_file/);
    assert.match(sent, /Read a file\./);
    assert.match(sent, /<tool_call>/);
    assert.match(sent, /read a\.ts/);
  } finally {
    await fake.close();
  }
});

test("returns a tool call as OpenAI tool_calls when not streaming", async () => {
  const fake = await startFakeMatthew({
    reply: ['<tool_call>{"name":"read_file",', '"arguments":{"path":"a.ts"}}</tool_call>'],
  });
  try {
    const body = (await chat(fake, {
      model: "gpt-5.2",
      messages: [{ role: "user", content: "read a.ts" }],
      stream: false,
      tools: [{ type: "function", function: { name: "read_file" } }],
    }).then((r) => r.json())) as {
      choices: Array<{
        finish_reason: string;
        message: { content: string | null; tool_calls?: Array<{ function: { name: string; arguments: string } }> };
      }>;
    };

    const choice = body.choices[0]!;
    assert.equal(choice.finish_reason, "tool_calls");
    assert.equal(choice.message.content, null);
    assert.equal(choice.message.tool_calls?.[0]?.function.name, "read_file");
    assert.deepEqual(JSON.parse(choice.message.tool_calls![0]!.function.arguments), {
      path: "a.ts",
    });
  } finally {
    await fake.close();
  }
});

test("returns a tool call as tool_calls deltas when streaming", async () => {
  const fake = await startFakeMatthew({
    reply: ['<tool_call>{"name":"read_file","arguments":{"path":"a.ts"}}</tool_call>'],
  });
  try {
    const text = await chat(fake, {
      model: "gpt-5.2",
      messages: [{ role: "user", content: "read a.ts" }],
      tools: [{ type: "function", function: { name: "read_file" } }],
    }).then((r) => r.text());

    assert.match(text, /"tool_calls"/);
    assert.match(text, /"name":"read_file"/);
    assert.match(text, /"finish_reason":"tool_calls"/);
    assert.match(text, /data: \[DONE\]/);
    // The raw protocol must not leak out as assistant content as well.
    assert.doesNotMatch(text, /"content":"<tool_call>/);
  } finally {
    await fake.close();
  }
});

// Offering tools must not change what an ordinary answer looks like.
test("answers normally when the reply carries no tool call", async () => {
  const fake = await startFakeMatthew();
  try {
    const body = (await chat(fake, {
      model: "gpt-5.2",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
      tools: [{ type: "function", function: { name: "read_file" } }],
    }).then((r) => r.json())) as {
      choices: Array<{ finish_reason: string; message: { content: string } }>;
    };

    assert.equal(body.choices[0]?.finish_reason, "stop");
    assert.equal(body.choices[0]?.message.content, "Hello");
  } finally {
    await fake.close();
  }
});

test("neither injects nor parses when tool_choice is none", async () => {
  const fake = await startFakeMatthew({
    reply: ['<tool_call>{"name":"read_file","arguments":{}}</tool_call>'],
  });
  try {
    const body = (await chat(fake, {
      model: "gpt-5.2",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
      tool_choice: "none",
      tools: [{ type: "function", function: { name: "read_file" } }],
    }).then((r) => r.json())) as {
      choices: Array<{ finish_reason: string; message: { content: string; tool_calls?: unknown } }>;
    };

    assert.doesNotMatch(fake.sentMessage(), /## Available tools/);
    assert.equal(body.choices[0]?.finish_reason, "stop");
    assert.equal(body.choices[0]?.message.tool_calls, undefined);
  } finally {
    await fake.close();
  }
});
