import { test } from "node:test";
import assert from "node:assert/strict";
import {
  credentialExpiry,
  decodeCredentials,
  encodeCredentials,
} from "./credentials.js";

test("round-trips the credentials blob the bearer carries", () => {
  const encoded = encodeCredentials({
    accessToken: "access",
    sessionToken: "session",
    assistantId: "aid-1",
  });

  assert.deepEqual(decodeCredentials(encoded), {
    accessToken: "access",
    sessionToken: "session",
    assistantId: "aid-1",
  });
});

test("reads the expiry from a JWT access token", () => {
  const payload = Buffer.from(JSON.stringify({ exp: 1_800_000_000 })).toString("base64url");
  const token = `header.${payload}.signature`;

  assert.equal(credentialExpiry(token), 1_800_000_000_000);
});

test("falls back to one hour for an opaque token", () => {
  const before = Date.now();
  const expires = credentialExpiry("opaque-token");
  const after = Date.now();

  assert.ok(expires >= before + 3_600_000);
  assert.ok(expires <= after + 3_600_000);
});

test("falls back when the token is not a claim set", () => {
  const before = Date.now();
  const expires = credentialExpiry("a.b.c");

  assert.ok(expires >= before + 3_600_000);
});
