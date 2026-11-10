import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { handleMatthewImages } from "./images.js";

/** A stand-in for Matthew's thread, stream, and artifact endpoints. */
async function startFakeMatthew(
  options: { images?: Array<{ kind: string }> } = {},
): Promise<{ base: string; sentMessage(): string; close(): Promise<void> }> {
  let sentMessage = "";

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = req.url ?? "";
      const bearerOk = req.headers.authorization === "Bearer access-token";

      if (url.startsWith("/api/thread_sse_message")) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const raw = Buffer.concat(chunks).toString("utf-8");
        sentMessage = raw.match(/name="message"\r?\n\r?\n([\s\S]*?)\r?\n--/)?.[1] ?? "";
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ new_thread: { thread_actual_id: "thread-1" } }));
        return;
      }

      if (url.startsWith("/api/thread_sse_ticket")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ticket: "ticket-1" }));
        return;
      }

      if (url.startsWith("/api/thread_sse_response_stream")) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ message: "Here it is." })}\n\n`);
        res.write("event: complete\ndata: {}\n\n");
        res.end();
        return;
      }

      if (url.startsWith("/api/artifacts/image-sources")) {
        if (!bearerOk) {
          res.writeHead(401);
          res.end();
          return;
        }
        const host = req.headers.host ?? "";
        const images = (options.images ?? [{ kind: "generated" }]).map((image) => ({
          kind: image.kind,
          url: `http://${host}/files/apple.jpg`,
        }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ images }));
        return;
      }

      if (url === "/files/apple.jpg") {
        res.writeHead(200, { "Content-Type": "image/jpeg" });
        res.end("JPEG-BYTES");
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
    base: `http://127.0.0.1:${port}`,
    sentMessage: () => sentMessage,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("returns the generated image URL and sends the prompt", async () => {
  const fake = await startFakeMatthew();
  try {
    const response = await handleMatthewImages(
      { prompt: "a red apple" },
      "access-token",
      "session-token",
      "assistant-1",
      fake.base,
    );
    const body = (await response.json()) as { data: Array<{ url: string }> };

    assert.equal(response.status, 200);
    assert.equal(fake.sentMessage(), "a red apple");
    assert.match(body.data[0]?.url ?? "", /\/files\/apple\.jpg$/);
  } finally {
    await fake.close();
  }
});

test("returns base64 when response_format is b64_json", async () => {
  const fake = await startFakeMatthew();
  try {
    const response = await handleMatthewImages(
      { prompt: "a red apple", response_format: "b64_json" },
      "access-token",
      "session-token",
      "assistant-1",
      fake.base,
    );
    const body = (await response.json()) as { data: Array<{ b64_json: string }> };

    assert.equal(response.status, 200);
    assert.equal(Buffer.from(body.data[0]?.b64_json ?? "", "base64").toString(), "JPEG-BYTES");
  } finally {
    await fake.close();
  }
});

test("fails with 502 when the thread produced no generated image", async () => {
  const fake = await startFakeMatthew({ images: [{ kind: "upload" }] });
  try {
    const response = await handleMatthewImages(
      { prompt: "a red apple" },
      "access-token",
      "session-token",
      "assistant-1",
      fake.base,
    );

    assert.equal(response.status, 502);
  } finally {
    await fake.close();
  }
});

test("rejects a missing prompt and n other than 1 before calling Matthew", async () => {
  const noPrompt = await handleMatthewImages({}, "a", "s", "assistant-1", "http://127.0.0.1:1");
  assert.equal(noPrompt.status, 400);

  const many = await handleMatthewImages(
    { prompt: "x", n: 2 },
    "a",
    "s",
    "assistant-1",
    "http://127.0.0.1:1",
  );
  assert.equal(many.status, 400);
});
