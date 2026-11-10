#!/usr/bin/env node
import { createInterface } from "node:readline";

/**
 * Interactive helper: paste the raw `localStorage.user` blob copied from
 * matthew.cmu.ac.th, get back the base64 bearer token the standalone
 * server expects. Removes the manual JSON-reshape-then-base64 step.
 */

interface RawMatthewUser {
  access_token?: string;
  token?: string;
  defaultAssistant?: { daid?: string };
}

async function readPastedLine(): Promise<string> {
  if (process.stdin.isTTY) {
    console.log("Paste the value you copied from `copy(localStorage.user)`, then press Enter:\n");
  }
  const rl = createInterface({ input: process.stdin });
  const line = await new Promise<string>((resolve) => {
    rl.once("line", resolve);
  });
  rl.close();
  return line;
}

async function main(): Promise<void> {
  const raw = (await readPastedLine()).trim();

  if (!raw) {
    console.error("No input received.");
    process.exitCode = 1;
    return;
  }

  let user: RawMatthewUser;
  try {
    user = JSON.parse(raw) as RawMatthewUser;
  } catch {
    console.error(
      "That doesn't look like valid JSON. Make sure you pasted the full output of copy(localStorage.user), not just part of it.",
    );
    process.exitCode = 1;
    return;
  }

  const accessToken = user.access_token;
  const sessionToken = user.token;
  const assistantId = user.defaultAssistant?.daid;

  if (!accessToken || !sessionToken) {
    console.error(
      "Missing access_token or token in the pasted JSON — this doesn't look like a Matthew login blob.",
    );
    process.exitCode = 1;
    return;
  }

  const credentials = JSON.stringify({ accessToken, sessionToken, assistantId });
  const encoded = Buffer.from(credentials, "utf-8").toString("base64");

  console.log("\nYour bearer token (use this as the API key / Authorization header):\n");
  console.log(encoded);
  console.log("\nExample:\n");
  console.log(
    `curl http://127.0.0.1:4141/v1/chat/completions \\\n` +
      `  -H "Authorization: Bearer ${encoded}" \\\n` +
      `  -H "Content-Type: application/json" \\\n` +
      `  -d '{"model":"matthew/gpt-6.1-sol","messages":[{"role":"user","content":"Hello"}]}'`,
  );
}

main();
