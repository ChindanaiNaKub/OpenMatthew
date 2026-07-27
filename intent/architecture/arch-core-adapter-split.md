---
id: arch-core-adapter-split
type: architecture
title: Platform-agnostic core, thin adapters per host
status: draft
parent: bet-multi-platform-core
code: [src/**, index.ts]
---

## The decision

Split the codebase into three layers:

- `src/core/` — Azure AD auth, Matthew thread/SSE client, and the
  normalization to OpenAI's `chat/completions` request/response shape.
  No import of `@opencode-ai/plugin` or any host SDK. Account storage lives
  here too, but with a caller-supplied namespace/path instead of a
  hardcoded `~/.config/opencode/...` default.
- `src/server/` — a standalone HTTP server built on `src/core/` that speaks
  OpenAI's `chat/completions` API. This is the integration point for any
  platform we haven't written a native adapter for.
- `src/adapters/opencode/` — the existing `Plugin`/`Hooks` implementation,
  rewritten as a thin wrapper over `src/core/`. Re-exported from the package
  root (`index.ts`) exactly as today, so current consumers see no change.

## Why, over the alternative

The alternative was writing a bespoke adapter per target platform (Hermes
Agent, thclaws, ...) against each one's actual plugin/extension API. Rejected
because we don't know those APIs yet, and reverse-engineering each one the
way we did OpenCode's is slow and only pays off for that one platform.
Building against the OpenAI `chat/completions` spec — which we control and
which most agent tooling already speaks — pays off for every platform at
once, known or not.

## What this makes hard

Any platform that wants first-class UX — native login flow, model picker,
config UI wired into the host itself, the way the OpenCode adapter has —
still needs its own adapter written against that platform's real API. The
standalone server gets Matthew working everywhere, but only at the level of
"paste a base URL and token," not "click login." That's deliberately
deferred until a specific platform is worth that investment.
