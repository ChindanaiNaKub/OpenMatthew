---
id: story-opencode-adapter-parity
type: story
title: Reduce the OpenCode plugin to a thin adapter, unchanged behavior
status: active
parent: project-extract-core
serves: []
priority: p1
code: [src/plugin.ts, index.ts]
---

## What changes

`src/plugin.ts` stops containing the Matthew chat/auth logic directly and
instead calls into `src/core/` (from [[story-extract-matthew-core]]) for
everything except the `@opencode-ai/plugin` `Hooks`/`Plugin` wiring itself:
`config.provider` shape, the `auth.methods` login flow, and OpenCode's
config-dir storage path. `index.ts`'s exports stay exactly as they are
today.

## Acceptance

- [x] `index.ts` exports (`MatthewOAuthPlugin`, `authorizeMicrosoft`,
      `exchangeViaMatthew`, and their types) are unchanged
- [x] the `config.provider.matthew` shape produced by the plugin is
      byte-for-byte the same as before the refactor
- [ ] the OAuth login flow (browser open → paste `localStorage.user` →
      account saved to `~/.config/opencode/matthew-accounts.json`) still
      works end to end against a real CMU login
- [x] `src/plugin.ts` no longer contains SSE parsing or thread-message
      construction directly — it delegates to `src/core/`

## Notes

This is the regression-safety story: the whole point of the split
([[arch-core-adapter-split]]) is that existing OpenCode users notice
nothing. If anything here changes observable behavior, that's a bug, not a
refactor.

Turned out to be mostly a verification pass, not new work: the delegation
to `src/core/` already happened as a byproduct of
[[story-extract-matthew-core]]. Confirmed here rather than redone:
`git diff` against the pre-refactor commit shows `index.ts` and the
`config(config)` hook body untouched, and `grep` for
SSE/thread-message code in `plugin.ts` returns nothing.

The live-login criterion is unticked for the same reason as
[[story-openai-compat-server]]'s streamed-response criterion: no CMU
credentials or browser in this sandboxed session. Queued in the inbox as
one combined manual smoke test covering both.
