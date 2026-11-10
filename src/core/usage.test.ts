import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createUsageTrackingStream } from "./usage.js";
import type { StoredUsage } from "./usage.js";

async function readUsage(dir: string): Promise<StoredUsage | null> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      return JSON.parse(await fs.readFile(join(dir, "matthew-usage.json"), "utf-8")) as StoredUsage;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  return null;
}

test("estimates completion tokens from a data line split across network chunks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "matthew-usage-"));
  const previous = process.env.OPENCODE_CONFIG_DIR;
  process.env.OPENCODE_CONFIG_DIR = dir;
  try {
    const text = "x".repeat(400);
    const line = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
    const cut = Math.floor(line.length / 2);
    const encoder = new TextEncoder();
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(line.slice(0, cut)));
        controller.enqueue(encoder.encode(line.slice(cut)));
        controller.close();
      },
    });

    await new Response(createUsageTrackingStream(source, "gpt-5.2")).text();

    const usage = await readUsage(dir);
    assert.equal(usage?.totalUsage.completion_tokens, 100);
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_CONFIG_DIR;
    else process.env.OPENCODE_CONFIG_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
