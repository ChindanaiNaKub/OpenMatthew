---
id: story-extract-matthew-core
type: story
title: Pull Matthew auth + chat client into a platform-agnostic core
status: done
parent: project-extract-core
serves: []
priority: p1
code: [src/core/**, src/oauth/**, src/plugin.ts]
---

## What changes

`handleMatthewChat`/`handleStreaming`/`handleNonStreaming`/`formatOpenAISSE`
move out of `src/plugin.ts` into `src/core/`, alongside the already-generic
`src/oauth/microsoft.ts` logic and `src/plugin/storage.ts`'s account
storage. Storage stops defaulting to `~/.config/opencode/...` and instead
takes the config directory as a parameter (OpenCode's adapter passes
`~/.config/opencode`; the server passes something else). Nothing in
`src/core/` imports `@opencode-ai/plugin`.

## Acceptance

- [x] `grep -r "@opencode-ai/plugin" src/core/` returns nothing
- [x] `loadAccounts`/`saveAccounts`/`clearAccounts` take a config dir
      argument instead of reading `OPENCODE_CONFIG_DIR` internally
- [x] the Matthew chat transform (thread create → SSE stream → OpenAI
      `chat/completions` shape) is unit-testable without constructing an
      OpenCode `Plugin` object
- [x] `npm run typecheck` and `npm run build` pass

## Notes

`storage.ts`'s `OPENCODE_CONFIG_DIR` env var read moved to `plugin.ts` as
`getOpenCodeConfigDir()` — the core function no longer knows the env var
exists, exactly as planned.

`handleMatthewChat` sent a hardcoded `"OpenCode"` client-name field to
Matthew's API. Extracting it verbatim would have made the core silently
platform-specific again, so it's now a `clientName` parameter (default
`"OpenMatthew"`); the OpenCode adapter passes `"OpenCode"` explicitly to
keep its behavior byte-for-byte unchanged.
