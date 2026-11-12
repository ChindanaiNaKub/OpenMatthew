import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveUsage } from "../core/usage.js";
import { createMatthewServer } from "./index.js";

async function withServer(
  run: (base: string) => Promise<void>,
): Promise<void> {
  const server = createMatthewServer({ apiBase: "http://127.0.0.1:1" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("GET /v1/models returns the OpenAI list shape", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/models`);
    const body = (await response.json()) as {
      object: string;
      data: Array<{ id: string; object: string }>;
    };

    assert.equal(response.status, 200);
    assert.equal(body.object, "list");
    assert.ok(body.data.length >= 8);
    assert.equal(body.data[0]?.object, "model");

    const ids = body.data.map((m) => m.id);
    for (const expected of ["gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-5.5", "gpt-4o"]) {
      assert.ok(ids.includes(expected), `missing model ${expected}`);
    }
  });
});

// Clients often probe /v1/models before they have been given a key.
test("GET /v1/models does not require credentials", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/models`);
    assert.equal(response.status, 200);
  });
});

test("chat/completions rejects a missing Authorization header", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.2", messages: [] }),
    });

    assert.equal(response.status, 401);
  });
});

test("chat/completions rejects a malformed body", async () => {
  await withServer(async (base) => {
    const credentials = Buffer.from(
      JSON.stringify({ accessToken: "a", sessionToken: "b" }),
    ).toString("base64");

    const response = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials}`,
        "Content-Type": "application/json",
      },
      body: "not json",
    });

    assert.equal(response.status, 400);
  });
});

// A browser-based platform UI never reaches our handler without these —
// the preflight fails first.
test("answers CORS preflight so browser clients can connect", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization",
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.match(response.headers.get("access-control-allow-headers") ?? "", /Authorization/i);
  });
});

test("sends CORS headers on normal responses too", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/models`);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
  });
});

test("unknown routes 404", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/nope`);
    assert.equal(response.status, 404);
  });
});

test("GET /v1/usage reports recorded totals and requires a key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "matthew-usage-"));
  const previous = process.env.OPENCODE_CONFIG_DIR;
  process.env.OPENCODE_CONFIG_DIR = dir;
  try {
    await withServer(async (base) => {
      const noKey = await fetch(`${base}/v1/usage`);
      assert.equal(noKey.status, 401);

      const empty = (await fetch(`${base}/v1/usage`, {
        headers: { Authorization: "Bearer key" },
      }).then((response) => response.json())) as {
        object: string;
        total: unknown;
        requests: number;
      };
      assert.equal(empty.object, "usage");
      assert.deepEqual(empty.total, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
      assert.equal(empty.requests, 0);

      await saveUsage({
        version: 1,
        totalUsage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
        history: [{
          timestamp: 1,
          usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
        }],
      });

      const body = (await fetch(`${base}/v1/usage`, {
        headers: { Authorization: "Bearer key" },
      }).then((response) => response.json())) as { total: unknown; requests: number };
      assert.deepEqual(body.total, { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 });
      assert.equal(body.requests, 1);
    });
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_CONFIG_DIR;
    else process.env.OPENCODE_CONFIG_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
