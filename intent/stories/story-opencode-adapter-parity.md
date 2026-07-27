---
id: story-opencode-adapter-parity
type: story
title: Reduce the OpenCode plugin to a thin adapter, unchanged behavior
status: draft
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

- [ ] `index.ts` exports (`MatthewOAuthPlugin`, `authorizeMicrosoft`,
      `exchangeViaMatthew`, and their types) are unchanged
- [ ] the `config.provider.matthew` shape produced by the plugin is
      byte-for-byte the same as before the refactor
- [ ] the OAuth login flow (browser open → paste `localStorage.user` →
      account saved to `~/.config/opencode/matthew-accounts.json`) still
      works end to end against a real CMU login
- [ ] `src/plugin.ts` no longer contains SSE parsing or thread-message
      construction directly — it delegates to `src/core/`

## Notes

This is the regression-safety story: the whole point of the split
([[arch-core-adapter-split]]) is that existing OpenCode users notice
nothing. If anything here changes observable behavior, that's a bug, not a
refactor.
