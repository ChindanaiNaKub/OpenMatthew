---
id: story-tool-call-shim
type: story
title: Emulate OpenAI tool calling so agent platforms can actually act
status: done
parent: project-extract-core
serves: []
priority: p1
code: [src/core/tools.ts, src/core/tools.test.ts, src/core/chat.ts, src/core/chat.test.ts, index.ts, README.md, CHANGELOG.md]
---

## What changes

Today the server is a chat endpoint wearing an agent-platform costume.
`OpenAIChatRequest` is `{model, messages, stream}` — a `tools` array in the
request is dropped on the floor and nothing in the response path can ever
emit `tool_calls`. So Hermes Agent, thclaws and Cursor all *connect*,
answer questions, and then fail the first time they try to read a file or
run a command. Hermes' own docs describe exactly this failure: without tool
support "the model outputs tool calls as plain text instead of executing
them."

Matthew's API has no tool slot and never will — it takes a string and
returns a string. So the shim lives here: render the tool schemas into the
prompt, ask for a specific textual protocol back, and parse that protocol
into OpenAI `tool_calls` on the way out. The agent never learns the
difference.

After this, a tool-using agent pointed at the server can complete a real
loop: request with `tools` → response with `tool_calls` and
`finish_reason: "tool_calls"` → follow-up request carrying the assistant's
call and a `role: "tool"` result → response that reads the result.

## Acceptance

- [x] a request carrying `tools` reaches Matthew with the tool schemas and
      the output protocol described in the prompt text
- [x] a reply containing a tool call comes back as OpenAI `tool_calls`
      (`function.name`, `function.arguments` as a JSON *string*, an `id`)
      with `finish_reason: "tool_calls"`, in both streaming and
      non-streaming mode
- [x] a reply with no tool call is unchanged from today — plain content,
      `finish_reason: "stop"`
- [x] the parser accepts more than one shape, because a prompted model will
      not obey one exactly: `<tool_call>` tags, a fenced ```json block, and
      a bare JSON object
- [x] several tool calls in one reply come back as several entries with
      ascending `index`
- [x] `tool_choice: "none"` suppresses injection and parsing entirely;
      `"required"` and a named function are demanded in the prompt
- [x] the round trip continues: `role: "tool"` messages and assistant
      messages carrying `tool_calls` serialize back into the transcript in
      the same protocol, so the model can see its own call and the result
- [x] `content` arrays (`[{type: "text", text: "..."}]`) flatten to text
      instead of reaching Matthew as `[object Object]`
- [x] README documents the shim, its protocol, and that it is prompted
      emulation rather than native tool calling

## Notes

**Why the protocol is `<tool_call>` tags.** Three candidate shapes were on
the table: OpenAI's own JSON, a fenced code block, and the Hermes-style
`<tool_call>` tag pair. Tags won because they are unambiguous to *find* in
prose — a model that wraps its call in explanation still leaves the tags
intact, whereas a bare JSON object has to be told apart from a JSON object
the model is legitimately discussing. The parser accepts the other two
shapes anyway, since a prompted model obeys a format roughly, not exactly.
Naming it the same thing vLLM's `--tool-call-parser hermes` produces is a
small bonus: it is a format models have seen.

**Streaming is buffered when tools are present.** A tool call cannot be
recognised until its closing tag arrives, so a request carrying `tools`
reads Matthew's whole stream before emitting anything. Requests without
`tools` stream token-by-token exactly as before. This trades first-token
latency in agent mode for the ability to work at all; the alternative,
streaming content out and retracting it once a tool call turns up, is not
expressible in the OpenAI wire format.

**This will be less reliable than native tool calling.** Matthew injects
its own persona prompt server-side (see the `MATTHEW_OVERRIDE_SYSTEM`
handling), the requested model is ignored, and a prompted model sometimes
narrates its tool call instead of emitting it. Agents that retry on a
malformed step will cope; agents that hard-fail may not. Honest
documentation is part of the acceptance for that reason.

**Content-part flattening is folded in** rather than split out. It is the
same request path and the same clients — Cursor and Hermes both send
`content` as an array once tool messages are in play, so a shim that
handles `tool_calls` but not array content still breaks on the second turn.

**Per-platform setup notes went into the README too** — Hermes Agent's
`config.yaml`, thclaws' `oai/*` slot, and the tunnel Cursor needs because
its backend cannot reach loopback. Strictly wider than the acceptance
above, kept because shipping the shim while leaving "so how do I point
Cursor at it" unanswered would have been a strange place to stop.

**Not yet verified against a real Matthew account.** Everything here is
tested against the fake, which enforces Matthew's protocol but not its
model's behaviour. The open question is how often a real reply obeys the
tag protocol — that is a prompt-tuning problem, and the honest answer needs
a live agent loop. If the failure rate is high, the next lever is the
system-prompt override, not the parser.

Follows from the client survey in [[story-document-server-integration]];
the platforms named there are the ones this unblocks.
