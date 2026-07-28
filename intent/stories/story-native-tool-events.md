---
id: story-native-tool-events
type: story
title: Answer Matthew's own tool calls instead of hanging on them
status: done
parent: project-survive-real-session
serves: []
priority: p1
code: [src/core/sse.ts, src/core/sse.test.ts, src/core/chat.ts, src/core/chat.test.ts, README.md]
---

## What changes

Matthew has a native tool channel we did not know about. Its stream emits a
`tool_call` event, the browser runs the tool locally, and posts the result
to `/api/submit_tool_result`. Two tools use it: `run_data_analysis` and
`generate_document`.

Our reader understood `message`, `complete` and `error` and discarded
everything else, so a `tool_call` was silently dropped. Matthew sends
nothing further until the call is answered, so an assistant with these
tools enabled would produce a stream that stops mid-reply and never
finishes — no output, no error, just a hang until something times out.

We cannot run a browser tool. But saying so unblocks the stream, and a
model told "the client cannot run this, answer without it" can still
produce a useful reply.

## Acceptance

- [x] a `tool_call` event is answered with `submit_tool_result` carrying
      the right `tool_call_id`, thread id and session token
- [x] the reply that follows the tool call still reaches the client
- [x] this holds on the non-streaming path as well, which previously could
      not have worked at all — it awaited the whole body, and the body does
      not complete until the call is answered
- [x] a tool call is never mistaken for reply text
- [x] a call missing its id is dropped rather than answered with a
      malformed submission
- [x] every other event Matthew emits is either handled or in a named
      ignore list with a stated reason

## Notes

**The state machine moved to `src/core/sse.ts`.** There were two readers —
incremental and buffered — and the token-count handling had already been
written into both. Adding `tool_call` to both would have doubled the
duplication, and the buffered path needed restructuring anyway.

**The buffered path now reads incrementally.** It used to `await
upstream.text()`, which cannot work when the body does not complete until
we answer. It reads chunk by chunk, answers calls as they arrive, and stops
at `complete`.

**Refusals are fired without awaiting on the streaming path, and awaited on
the buffered one.** Streaming must not block the reader on a request whose
answer it does not need. The buffered path is already waiting, and nothing
more arrives until Matthew has its result, so awaiting is free there.

**The stall is now proven, not assumed.** The fake withholds the rest of
the reply until a result is submitted, exactly as Matthew does, so the test
times out if this regresses. Before this story the stall was a plausible
reading of the bundle — the frontend returns early for tool names it does
not implement, which suggested but did not prove that an unanswered call
blocks.

**Not done here:** exposing these tools through the OpenAI `tools`
interface so a client could actually run them. That is a bigger question
about whether Matthew's tool set is fixed per assistant, tracked in its own
issue. `alert` events are also still ignored; they likely carry quota
warnings, which belongs with mapping errors onto OpenAI shapes.
