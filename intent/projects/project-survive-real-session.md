---
id: project-survive-real-session
type: project
title: Survive a real work session
status: active
parent: goal-any-platform-access
serves: []
priority: p1
code: [src/core/**, src/server/**]
---

## What this is

[[project-extract-core]] got Matthew reachable from any OpenAI client.
Reachable is not the same as usable for an afternoon's work. This project
is the difference: an agent loop that runs for an hour without the user
babysitting it, on a quota that does not evaporate.

The scope came out of reading Matthew's frontend bundle on 2026-07-28,
which found five things we had wrong or were leaving on the table:

1. **No refresh token exists.** Zero hits for `refresh_token` in the
   bundle; a 401 opens the login modal. Silent renewal is not available at
   any price, so expiry has to become predictable instead of surprising.
2. **Usage is streamed and we drop it.** `ptoken`/`ctoken` SSE events carry
   the counts. The README's claim that Matthew "strips or reformats" usage
   was simply wrong.
3. **`tool_call` events exist and we ignore them.** Matthew has a native
   tool channel (`submit_tool_result`) for its own tools. Ignoring the
   event probably stalls the stream rather than degrading gracefully.
4. **Model switching is possible.** `PATCH /api/update_default_llm` and
   `GET /api/available_models`, both of which we assumed did not exist.
5. **Threads are addressable.** `thread_messages_tid` means conversation
   reuse is reachable, and with it the biggest quota win available.

## Done when

- a session's expiry is visible before it bites, not after
- token counts reported to clients are Matthew's real numbers
- an assistant with native tools does not hang the stream
- the `model` parameter either works or is documented as inert, with no
  third state where it silently mutates the user's account
- an agent loop does not resend its whole history every turn

## Acceptance

- [ ] no code path reports a token count it invented
- [ ] every SSE event Matthew emits is either handled or explicitly
      ignored with a stated reason
- [ ] nothing mutates the user's Matthew account without opt-in

## Notes

Filed as GitHub issues #18–#27. The bundle read is the reason several of
these are now known to be cheap; before it, three of them looked
impossible. That is the second time reading the bundle has overturned an
assumption — see [[matthew-api-source-of-truth]].

Deliberately not in scope: embeddings. Matthew shows no sign of an
embeddings endpoint, so Cursor's codebase indexing is out of reach
regardless of what we build.
