---
id: story-openai-wire-compat
type: story
title: Make the server survive contact with real OpenAI clients
status: done
parent: project-extract-core
serves: []
priority: p1
code: [src/core/**, src/server/**, README.md]
---

## What changes

The server answers `POST /v1/chat/completions` and that's genuinely all it
does. Three gaps will break real agent platforms (Hermes Agent, thclaws,
anything pointed at a custom OpenAI base URL) on first contact:

1. **The conversation is thrown away.** `handleMatthewChat` does
   `messages.reverse().find(m => m.role === "user")` — it forwards the last
   user message and silently discards the system prompt and every prior
   turn. Agent platforms carry their instructions in the system prompt and
   their context in the history, so this doesn't degrade multi-turn, it
   guts it. Fixed by serializing the whole conversation into the message
   sent to Matthew, since every request opens a fresh Matthew thread.
2. **No `GET /v1/models`.** Many OpenAI clients enumerate models before
   they'll let you pick one; against this server they get a 404 and show an
   empty or broken model list.
3. **The advertised model list is stale and the `model` parameter is a
   lie.** Matthew ties the model to the *assistant* (`aid` is always
   `defaultAssistant.daid`), so the requested model is ignored entirely.
   The list also predates `gpt-5.5`, `gpt-5.4`, and `gpt-5.4-mini`.

## Acceptance

- [x] a request carrying a system prompt and prior turns reaches Matthew
      with all of it, not just the final user message
- [x] `GET /v1/models` returns the model list in OpenAI's
      `{object: "list", data: [...]}` shape
- [x] the model list matches the eight ids Matthew's own frontend ships
      (`gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.2`, `gpt-5-mini`,
      `gpt-4.1`, `gpt-4o`, `gpt-4o-mini`)
- [x] the README says plainly that the requested model is ignored and the
      real model comes from your Matthew default assistant, rather than
      implying model switching works
- [x] responses carry the `id`/`object`/`created` envelope, so clients and
      SDKs that validate it don't reject every reply
- [x] the server answers CORS preflight and sends CORS headers, so a
      browser-based platform UI can reach it at all

## Notes

Two further gaps surfaced while building this and are folded in above
rather than left for a client to discover: responses were missing the
`id`/`object`/`created` envelope that OpenAI SDKs validate, and there was
no CORS handling at all, which blocks browser-based platform UIs before a
request ever reaches us.

Known debt: `src/plugin.ts` still carries its own hardcoded model list, so
there are now two lists that can drift apart. Left alone deliberately —
wiring OpenCode to `src/core/models.ts` would change the plugin's config
shape, and the OpenCode path is explicitly not a priority right now.

Model selection is not fixable from here without a way to map a model id to
an assistant configured for it — `/api/assistants` may expose enough to do
that later, but pretending it works today is worse than documenting that it
doesn't.

All three gaps were found by reading Matthew's frontend bundle, the same
way the ticket bug was — see [[matthew-api-source-of-truth]] reasoning in
[[story-openai-compat-server]].
