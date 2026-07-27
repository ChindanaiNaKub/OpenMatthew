---
id: story-openai-compat-server
type: story
title: Standalone OpenAI-compatible server for non-OpenCode platforms
status: active
parent: project-extract-core
serves: []
priority: p1
code: [src/server/**, package.json]
---

## What changes

A new `src/server/` exposes `POST /v1/chat/completions` (streaming and
non-streaming, matching the OpenAI shape) over HTTP, built entirely on
`src/core/` from [[story-extract-matthew-core]]. Any platform that supports
a custom OpenAI base URL — Hermes Agent, thclaws, or anything else — can
point at this server plus a Matthew token and get real responses, without
us writing anything specific to that platform.

## Acceptance

- [ ] running the server locally and sending it a `chat/completions`
      request with a real Matthew token returns a real streamed response
- [x] non-streaming requests (`stream: false`) also work
- [x] the server takes the Matthew token per-request (not baked in at
      startup), resolving the open question in
      [[project-extract-core]] in favor of multi-caller support
- [x] a bin entry / npm script starts the server (e.g. `npm run serve` or a
      `bin` field in `package.json`)

## Notes

Reuses the exact SSE parsing and OpenAI-shape formatting already proven out
in the current `handleStreaming`/`handleNonStreaming` — this story is
mostly plumbing an HTTP server around the extracted core, not new protocol
logic.

Credentials travel as `Authorization: Bearer <base64 of
{accessToken, sessionToken, assistantId}>` — the same combined blob the
OpenCode adapter already produces on login, just base64-wrapped so it's a
clean header value. Falls back to using the raw bearer value as both
access and session token if it isn't that JSON shape, matching the
OpenCode adapter's existing fallback behavior.

Verified streaming, non-streaming, and missing-auth (401) end to end
against a simulated Matthew backend
(`/tmp/.../scratchpad/verify-server.mjs`, not committed — throwaway check)
that reproduces the real API's response shapes. The first criterion above
is unticked because it specifically asks for a *real* Matthew token, which
this sandboxed session has no CMU credentials to obtain — queued in the
inbox for a human smoke test. Story stays active until that's confirmed.
