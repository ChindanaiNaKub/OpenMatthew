---
id: story-openai-compat-server
type: story
title: Standalone OpenAI-compatible server for non-OpenCode platforms
status: draft
parent: project-extract-core
serves: []
priority: p1
code: [src/server/**]
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
- [ ] non-streaming requests (`stream: false`) also work
- [ ] the server takes the Matthew token per-request (not baked in at
      startup), resolving the open question in
      [[project-extract-core]] in favor of multi-caller support
- [ ] a bin entry / npm script starts the server (e.g. `npm run serve` or a
      `bin` field in `package.json`)

## Notes

Reuses the exact SSE parsing and OpenAI-shape formatting already proven out
in the current `handleStreaming`/`handleNonStreaming` — this story is
mostly plumbing an HTTP server around the extracted core, not new protocol
logic.
