---
id: story-model-selection
type: story
title: Make the model parameter mean something, without mutating accounts by surprise
status: done
parent: project-survive-real-session
serves: []
priority: p2
code: [src/core/models.ts, src/core/models.test.ts, src/core/chat.ts, src/server/index.ts, README.md]
---

## What changes

Two related fictions in the same area:

1. `model` in a request was discarded outright. A client picking
   `gpt-4o-mini` to save quota silently got whatever the user's assistant
   was on. Documented honestly, but still the most confusing thing about
   the product.
2. `/v1/models` served a hardcoded list mirroring the frontend bundle. It
   had already gone stale once — it predated `gpt-5.5`, `gpt-5.4` and
   `gpt-5.4-mini` — and described every model as OpenAI's, when Matthew
   reports a `provider` field with other values.

Both turned out to be solvable. `GET /api/available_models` returns the
live list. `PATCH /api/update_default_llm {token, model, assist_id}`
changes the model.

## Acceptance

- [x] `/v1/models` returns Matthew's live list when the request carries a
      token, and the static list when it does not
- [x] an unreachable or broken `available_models` falls back rather than
      erroring, so a model picker never breaks on it
- [x] `model` is honoured when `MATTHEW_ALLOW_MODEL_SWITCH=1`
- [x] with the flag unset, no request mutates anything — verified by a test
      asserting zero PATCHes, not by inspection
- [x] a switch already made is not repeated on every request
- [x] a rejected or unreachable switch does not fail the request
- [x] the README states plainly that switching changes account state, and
      what that costs

## Notes

**Why opt-in.** `update_default_llm` does not scope to a request. It
changes the default assistant, so the user's browser session follows
whatever their agent last asked for. A proxy quietly rewriting someone's
account settings is a surprise, and surprises about account state are the
kind you cannot take back. Off by default; the README says what turning it
on costs.

**`assist_id` is assumed to be the assistant id we already hold** — the
`daid` from `localStorage.user.defaultAssistant`, the same value that goes
in `aid` on every message. The bundle calls it `e.id` on an assistant
object. Those are very likely the same identifier, but **this has not been
checked against a live account**, and it is the one thing in this story
that could be wrong. If it is, the switch silently no-ops: `selectModel`
returns false and the reply still arrives from the old model.

**The memo only knows about switches this process made.** Changing the
model in the Matthew web UI will not invalidate it, so the first request
after that may run on the previous model. Re-reading the assistant before
every request would cost a round trip on the hot path to close a gap that
costs one request.

**`reasoning` is not reported by `available_models`.** The static list
carries it; live entries are marked false rather than guessed from the id.
It is unused by the OpenAI shape either way.
