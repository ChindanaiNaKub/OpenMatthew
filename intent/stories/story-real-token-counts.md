---
id: story-real-token-counts
type: story
title: Report the token counts Matthew actually streams
status: done
parent: project-survive-real-session
serves: []
priority: p1
code: [src/core/chat.ts, src/core/chat.test.ts, README.md]
---

## What changes

Every non-streaming reply carried `usage: {prompt_tokens: 0,
completion_tokens: 0, total_tokens: 0}` — a hardcoded lie. Streamed
replies carried no usage at all. Clients drive context bars, cost display
and budget warnings off that field, so all of them showed nothing.

The README explained this as Matthew stripping the `usage` field. That was
wrong. Matthew never puts usage in a payload; it emits `ptoken` and
`ctoken` SSE events carrying bare integers, which the frontend accumulates.
Our reader only understood `message`, `complete` and `error`, so the counts
fell through.

## Acceptance

- [x] non-streaming replies report Matthew's real prompt and completion
      counts
- [x] `stream_options: {include_usage: true}` produces a usage chunk before
      `[DONE]`, with empty `choices`
- [x] a client that does not ask for usage sees no extra chunk
- [x] the buffered tool-calling path reports usage too
- [x] a token count is never mistaken for reply text, and a malformed one
      is ignored rather than counted
- [x] the README no longer claims Matthew strips usage

## Notes

**The event name now persists across reads.** It used to be a local inside
`pull()`, reset on every chunk from the socket. An SSE frame split across
two reads — `event: ctoken` in one, `data: 42` in the next — would lose the
event name and fall into the branch that parses data as reply text. With
only `message` events that was invisible, since the fallthrough branch was
the right one anyway. Adding events where the name carries meaning made it
a real bug, so it is hoisted.

**Usage chunks are opt-in, matching OpenAI.** A chunk with empty `choices`
appearing unrequested breaks clients that assume every chunk has a delta.
Clients that want usage ask for it.

**The OpenCode plugin still estimates.** `src/core/usage.ts` has its own
estimator and guesses at four possible dashboard endpoints, none of which
appear in the bundle. Pointing it at these real numbers is a separate
change to a separate consumer — tracked in the issue, not done here.
