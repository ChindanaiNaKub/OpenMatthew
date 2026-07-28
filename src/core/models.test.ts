import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import {
  fetchAvailableModels,
  modelSwitchEnabled,
  resetSelectedModels,
  selectModel,
  toOpenAIModelList,
} from "./models.js";

interface FakeMatthew {
  base: string;
  patches(): Array<Record<string, unknown>>;
  close(): Promise<void>;
}

async function startFake(
  options: { models?: unknown; modelsStatus?: number; patchStatus?: number } = {},
): Promise<FakeMatthew> {
  const patches: Array<Record<string, unknown>> = [];

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = req.url ?? "";

      if (url.startsWith("/api/available_models")) {
        if (options.modelsStatus && options.modelsStatus !== 200) {
          res.writeHead(options.modelsStatus);
          res.end("{}");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models: options.models ?? [] }));
        return;
      }

      if (url.startsWith("/api/update_default_llm")) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        patches.push({
          method: req.method,
          auth: req.headers.authorization,
          ...(JSON.parse(Buffer.concat(chunks).toString("utf-8")) as Record<string, unknown>),
        });
        res.writeHead(options.patchStatus ?? 200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
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
    patches: () => patches,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("reads the live model list", async () => {
  const fake = await startFake({
    models: [
      { id: "gpt-5.5", name: "GPT-5.5", provider: "openai" },
      { id: "claude-x", name: "Claude X", provider: "anthropic" },
    ],
  });
  try {
    const models = await fetchAvailableModels("token", fake.base);

    assert.deepEqual(
      models?.map((m) => m.id),
      ["gpt-5.5", "claude-x"],
    );
    assert.equal(models?.[1]?.name, "Claude X");
  } finally {
    await fake.close();
  }
});

// The static list is the fallback everywhere, so a failure here has to be
// a null rather than a throw — otherwise an unreachable Matthew turns a
// model picker into an error page.
test("returns null rather than throwing when the list is unavailable", async () => {
  const fake = await startFake({ modelsStatus: 500 });
  try {
    assert.equal(await fetchAvailableModels("token", fake.base), null);
  } finally {
    await fake.close();
  }
  assert.equal(await fetchAvailableModels("token", "http://127.0.0.1:1"), null);
});

test("returns null for an empty or malformed list", async () => {
  const empty = await startFake({ models: [] });
  try {
    assert.equal(await fetchAvailableModels("token", empty.base), null);
  } finally {
    await empty.close();
  }

  const junk = await startFake({ models: [{ name: "no id" }, 42] });
  try {
    assert.equal(await fetchAvailableModels("token", junk.base), null);
  } finally {
    await junk.close();
  }
});

test("renders a live list in the OpenAI shape", () => {
  const list = toOpenAIModelList([{ id: "claude-x" }]);

  assert.equal(list.object, "list");
  assert.deepEqual(list.data, [
    { id: "claude-x", object: "model", created: 0, owned_by: "cmu-matthew" },
  ]);
});

test("switching is off unless explicitly enabled", () => {
  const original = process.env.MATTHEW_ALLOW_MODEL_SWITCH;
  try {
    delete process.env.MATTHEW_ALLOW_MODEL_SWITCH;
    assert.equal(modelSwitchEnabled(), false);
    process.env.MATTHEW_ALLOW_MODEL_SWITCH = "0";
    assert.equal(modelSwitchEnabled(), false);
    process.env.MATTHEW_ALLOW_MODEL_SWITCH = "1";
    assert.equal(modelSwitchEnabled(), true);
    process.env.MATTHEW_ALLOW_MODEL_SWITCH = "true";
    assert.equal(modelSwitchEnabled(), true);
  } finally {
    if (original === undefined) delete process.env.MATTHEW_ALLOW_MODEL_SWITCH;
    else process.env.MATTHEW_ALLOW_MODEL_SWITCH = original;
  }
});

test("PATCHes the assistant onto the requested model", async () => {
  resetSelectedModels();
  const fake = await startFake();
  try {
    const ok = await selectModel("gpt-4o-mini", "access", "session", "aid-1", fake.base);

    assert.equal(ok, true);
    assert.deepEqual(fake.patches(), [
      {
        method: "PATCH",
        auth: "Bearer access",
        token: "session",
        model: "gpt-4o-mini",
        assist_id: "aid-1",
      },
    ]);
  } finally {
    await fake.close();
  }
});

// One PATCH per request would double the round trips on the hot path.
test("does not repeat a switch it already made", async () => {
  resetSelectedModels();
  const fake = await startFake();
  try {
    await selectModel("gpt-4o", "access", "session", "aid-1", fake.base);
    await selectModel("gpt-4o", "access", "session", "aid-1", fake.base);
    assert.equal(fake.patches().length, 1);

    await selectModel("gpt-5.5", "access", "session", "aid-1", fake.base);
    assert.equal(fake.patches().length, 2);
  } finally {
    await fake.close();
  }
});

// "default" is the placeholder the server uses when the credential blob
// carried no assistant id. PATCHing it would address someone else's
// assistant or none at all.
test("refuses to switch without a real assistant id", async () => {
  resetSelectedModels();
  const fake = await startFake();
  try {
    assert.equal(await selectModel("gpt-4o", "access", "session", "default", fake.base), false);
    assert.equal(await selectModel("gpt-4o", "access", "session", "", fake.base), false);
    assert.deepEqual(fake.patches(), []);
  } finally {
    await fake.close();
  }
});

// A failed switch must not fail the request — the reply still arrives, it
// just comes from the model the assistant was already on.
test("reports a rejected switch without throwing", async () => {
  resetSelectedModels();
  const fake = await startFake({ patchStatus: 403 });
  try {
    assert.equal(await selectModel("gpt-4o", "access", "session", "aid-1", fake.base), false);
  } finally {
    await fake.close();
  }
  assert.equal(await selectModel("gpt-4o", "access", "session", "aid-1", "http://127.0.0.1:1"), false);
});
