import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { collectSseBody, handleMatthewChat, serializeConversation } from "./chat.js";

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
  submittedToolResult(): Record<string, unknown> | null;
  close(): Promise<void>;
}

async function startFakeMatthew(
  options: {
    ticketStatus?: number;
    reply?: string[];
    /** Emitted as Matthew's own `ptoken`/`ctoken` events. */
    usage?: { prompt: number; completion: number };
    /**
     * Emit one of Matthew's own tool calls and — like the real thing —
     * send nothing further until a result is submitted. A client that
     * ignores the call hangs here, which is the bug under test.
     */
    toolCall?: { name: string; tool_call_id: string; arguments?: unknown };
  } = {},
): Promise<FakeMatthew> {
  let sentFields: Record<string, string> = {};
  let streamUrl = "";
  let submittedToolResult: Record<string, unknown> | null = null;
  let onToolResult: (() => void) | null = null;
  const toolResultArrived = new Promise<void>((resolve) => {
    onToolResult = resolve;
  });

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

      if (url.startsWith("/api/submit_tool_result")) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        submittedToolResult = JSON.parse(
          Buffer.concat(chunks).toString("utf-8"),
        ) as Record<string, unknown>;
        onToolResult?.();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
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

        if (options.toolCall) {
          res.write(`event: tool_call\ndata: ${JSON.stringify(options.toolCall)}\n\n`);
          await toolResultArrived;
        }

        for (const chunk of options.reply ?? ["Hel", "lo"]) {
          res.write(`data: ${JSON.stringify({ message: chunk })}\n\n`);
        }
        if (options.usage) {
          // Bare integers on their own events, the way Matthew sends them.
          res.write(`event: ptoken\ndata: ${options.usage.prompt}\n\n`);
          res.write(`event: ctoken\ndata: ${options.usage.completion}\n\n`);
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
    submittedToolResult: () => submittedToolResult,
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

// Matthew streams token counts as `ptoken`/`ctoken` events carrying bare
// integers. They used to fall through the reader, which is why every reply
// claimed zero tokens.
test("reports the token counts Matthew streamed", async () => {
  const fake = await startFakeMatthew({ usage: { prompt: 120, completion: 45 } });
  try {
    const body = (await chat(fake, {
      model: "gpt-5.2",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    }).then((r) => r.json())) as {
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      choices: Array<{ message: { content: string } }>;
    };

    assert.deepEqual(body.usage, {
      prompt_tokens: 120,
      completion_tokens: 45,
      total_tokens: 165,
    });
    // The counts must not be mistaken for reply text.
    assert.equal(body.choices[0]?.message.content, "Hello");
  } finally {
    await fake.close();
  }
});

test("sends a usage chunk when the client asks for one", async () => {
  const fake = await startFakeMatthew({ usage: { prompt: 10, completion: 3 } });
  try {
    const text = await chat(fake, {
      model: "gpt-5.2",
      messages: [{ role: "user", content: "hi" }],
      stream_options: { include_usage: true },
    }).then((r) => r.text());

    const usageLine = text
      .split("\n")
      .filter((l) => l.startsWith("data: {"))
      .map((l) => JSON.parse(l.slice(6)) as { usage?: unknown; choices: unknown[] })
      .find((c) => c.usage);

    assert.deepEqual(usageLine?.usage, {
      prompt_tokens: 10,
      completion_tokens: 3,
      total_tokens: 13,
    });
    // Empty choices, so clients that ignore usage see no phantom delta.
    assert.deepEqual(usageLine?.choices, []);
  } finally {
    await fake.close();
  }
});

test("omits the usage chunk when the client did not ask", async () => {
  const fake = await startFakeMatthew({ usage: { prompt: 10, completion: 3 } });
  try {
    const text = await chat(fake, {
      model: "gpt-5.2",
      messages: [{ role: "user", content: "hi" }],
    }).then((r) => r.text());

    assert.doesNotMatch(text, /"usage"/);
    assert.match(text, /"content":"Hel"/);
  } finally {
    await fake.close();
  }
});

test("reports usage on the buffered tool path too", async () => {
  const fake = await startFakeMatthew({
    reply: ['<tool_call>{"name":"run","arguments":{}}</tool_call>'],
    usage: { prompt: 7, completion: 2 },
  });
  try {
    const text = await chat(fake, {
      model: "gpt-5.2",
      messages: [{ role: "user", content: "go" }],
      tools: [{ type: "function", function: { name: "run" } }],
      stream_options: { include_usage: true },
    }).then((r) => r.text());

    assert.match(text, /"total_tokens":9/);
    assert.match(text, /"finish_reason":"tool_calls"/);
  } finally {
    await fake.close();
  }
});

// An SSE frame can be split across reads. If the event name is forgotten
// in between, a bare integer gets parsed as though it were reply text.
test("keeps the event name across a split frame", () => {
  const { text, usage } = collectSseBody(
    'data: {"message":"hi"}\n\nevent: ptoken\ndata: 99\n\nevent: ctoken\ndata: 1\n\n',
  );

  assert.equal(text, "hi");
  assert.deepEqual(usage, { prompt: 99, completion: 1 });
});

test("ignores a token count that is not a number", () => {
  const { usage } = collectSseBody("event: ptoken\ndata: not-a-number\n\n");
  assert.deepEqual(usage, { prompt: 0, completion: 0 });
});

// Matthew's own tools (run_data_analysis, generate_document) arrive as a
// `tool_call` event and it sends nothing further until the result is
// posted back. We cannot run them, but silence hangs the stream — the fake
// withholds the rest of the reply, so this test times out if we regress.
test("answers Matthew's own tool calls instead of hanging", async () => {
  const fake = await startFakeMatthew({
    toolCall: {
      name: "run_data_analysis",
      tool_call_id: "tc-1",
      arguments: { file_id: "f-1", code: "print(1)" },
    },
  });
  try {
    const text = await chat(fake, {
      model: "gpt-5.2",
      messages: [{ role: "user", content: "analyse this" }],
    }).then((r) => r.text());

    const submitted = fake.submittedToolResult();
    assert.equal(submitted?.tool_call_id, "tc-1");
    assert.equal(submitted?.thread_id, "thread-1");
    assert.equal(submitted?.token, "session-token");
    assert.match(String(submitted?.content), /cannot run/);
    assert.match(String(submitted?.content), /run_data_analysis/);

    // And the reply that followed still reached the client.
    assert.match(text, /"content":"Hel"/);
    assert.match(text, /data: \[DONE\]/);
  } finally {
    await fake.close();
  }
});

test("answers a tool call on the non-streaming path too", async () => {
  const fake = await startFakeMatthew({
    toolCall: { name: "generate_document", tool_call_id: "tc-2" },
  });
  try {
    const body = (await chat(fake, {
      model: "gpt-5.2",
      messages: [{ role: "user", content: "write a doc" }],
      stream: false,
    }).then((r) => r.json())) as { choices: Array<{ message: { content: string } }> };

    assert.equal(fake.submittedToolResult()?.tool_call_id, "tc-2");
    assert.equal(body.choices[0]?.message.content, "Hello");
  } finally {
    await fake.close();
  }
});

test("does not treat a tool call as reply text", () => {
  const { text, toolCalls } = collectSseBody(
    'event: tool_call\ndata: {"name":"generate_document","tool_call_id":"x"}\n\n' +
      'data: {"message":"done"}\n\n',
  );

  assert.equal(text, "done");
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0]?.name, "generate_document");
});
