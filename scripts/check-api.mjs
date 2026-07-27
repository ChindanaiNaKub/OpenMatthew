#!/usr/bin/env node
/**
 * Drift check against the live Matthew API.
 *
 * Matthew publishes no API docs, so the only authoritative description of
 * its protocol is the frontend bundle it ships. This fetches that bundle
 * and reports whether the endpoints and parameters we depend on are still
 * in it.
 *
 * Deliberately NOT part of `npm test`: it needs network and depends on a
 * third party being up, so wiring it into the normal suite would make it
 * flaky for a failure that isn't ours. Run it when something breaks, or
 * periodically.
 *
 * This exists because on 2026-07-27 the response-stream endpoint silently
 * stopped accepting the access token and began requiring a short-lived
 * ticket. Nothing caught it until a request failed by hand.
 */

const BASE = process.env.MATTHEW_API_BASE || "https://matthew.cmu.ac.th";

// Each expectation is something our client actively relies on.
const EXPECTATIONS = [
  {
    pattern: /api\/thread_sse_message/,
    label: "thread_sse_message endpoint (sending a message)",
  },
  {
    pattern: /api\/thread_sse_ticket/,
    label: "thread_sse_ticket endpoint (stream authentication)",
  },
  {
    pattern: /api\/thread_sse_response_stream/,
    label: "thread_sse_response_stream endpoint (reading the reply)",
  },
  {
    pattern: /ticket=\$\{encodeURIComponent/,
    label: "stream URL still authenticates by ticket, not by token",
  },
  {
    pattern: /i\.append\("aid"/,
    label: "message still carries the assistant id (aid) field",
  },
];

async function main() {
  console.log(`Checking ${BASE} for API drift...\n`);

  const indexHtml = await fetch(BASE).then((r) => r.text());

  // The bundle filename is content-hashed and changes between deploys —
  // it moved from main.cfe9534d.js to main.fa03f287.js during this project,
  // so it has to be discovered rather than hardcoded.
  const match = indexHtml.match(/\/static\/js\/main\.[a-z0-9]+\.js/);
  if (!match) {
    console.error("FAIL: could not find the main JS bundle in the page.");
    console.error("The frontend's structure changed; this check needs updating.");
    process.exitCode = 1;
    return;
  }

  const bundleUrl = `${BASE}${match[0]}`;
  console.log(`Bundle: ${match[0]}`);

  const bundle = await fetch(bundleUrl).then((r) => r.text());
  console.log(`Size:   ${(bundle.length / 1_000_000).toFixed(1)} MB\n`);

  let failures = 0;
  for (const { pattern, label } of EXPECTATIONS) {
    const ok = pattern.test(bundle);
    console.log(`${ok ? "ok  " : "DRIFT"}  ${label}`);
    if (!ok) failures++;
  }

  console.log();
  if (failures > 0) {
    console.error(
      `${failures} expectation(s) no longer hold. Matthew's API has changed —\n` +
        `read the bundle to find the new shape before guessing at fixes:\n` +
        `  curl -s ${bundleUrl} > /tmp/main.js\n` +
        `  grep -o '.\\{700\\}thread_sse_response_stream.\\{400\\}' /tmp/main.js`,
    );
    process.exitCode = 1;
    return;
  }

  console.log("No drift detected — the API still matches what this client expects.");
}

main().catch((err) => {
  console.error("Check failed to run:", err.message);
  process.exitCode = 1;
});
