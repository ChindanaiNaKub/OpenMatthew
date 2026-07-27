---
id: project-extract-core
type: project
title: Extract platform-agnostic core and standalone server
status: active
parent: goal-any-platform-access
serves: []
priority: p1
code: [src/**, index.ts, package.json]
---

## Shape

`src/plugin.ts` currently mixes the generic Matthew client (auth, thread/SSE
chat, OpenAI-shape normalization) with OpenCode-specific glue (`Plugin`/
`Hooks`, `config.provider`, the auth-method callback flow), and
`src/plugin/storage.ts` hardcodes OpenCode's config directory. This project
pulls the generic parts into `src/core/`, adds `src/server/` as a standalone
OpenAI-compatible HTTP server on top of it, and reduces `src/plugin.ts` to a
thin adapter over the core — with the package's existing exports and
OpenCode behavior unchanged.

## Done when

- [ ] `src/core/` exists with the Matthew auth + chat client and account
      storage, and has zero imports from `@opencode-ai/plugin`
- [ ] a standalone server under `src/server/` serves `POST
      /v1/chat/completions` (streaming and non-streaming) against a real
      Matthew token, backed by `src/core/`
- [ ] `src/plugin.ts` is rewritten as a thin adapter over `src/core/`, and
      `index.ts`'s exports and existing OpenCode plugin behavior are
      unchanged (config shape, login flow, model list)
- [ ] README documents the standalone server as the integration path for
      platforms other than OpenCode

## Open questions

- How should the server take the Matthew token from the caller — a header
  per request, or one token at server startup? Affects whether one server
  instance can serve multiple accounts.
- Does storage need multi-account support in the core, or is that an
  OpenCode-adapter-only concept? `AccountStorage` currently supports
  multiple accounts with an `activeIndex`; unclear if the standalone server
  needs that at all.
