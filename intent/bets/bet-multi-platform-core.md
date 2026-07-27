---
id: bet-multi-platform-core
type: bet
title: Universal OpenAI-compatible server over per-platform adapters
status: draft
parent: mission
priority: p1
---

## The bet

I believe most agent platforms — including ones we've never heard of, like
Hermes Agent or thclaws — already know how to talk to a custom OpenAI-compatible
`chat/completions` endpoint, because that's the path of least resistance every
LLM tooling ecosystem converges on. So instead of researching and writing a
bespoke adapter for each agent platform's plugin API (which we'd have to
reverse-engineer one at a time, the way we did for OpenCode), I'm extracting
the Matthew auth + chat logic that's currently tangled into the OpenCode
plugin into a platform-agnostic core, and standing up a standalone local
server that speaks OpenAI's `chat/completions` shape. Any platform that
accepts a custom base URL + API key gets Matthew support for free. The
existing OpenCode plugin becomes the first adapter on top of that core, not
the thing everything else has to imitate.

## What would kill it

- A platform we actually want to support (Hermes Agent, thclaws, or another)
  turns out not to support custom OpenAI base URLs at all, and requires a
  native plugin/extension to integrate — meaning the server approach doesn't
  reach it and we have to write a bespoke adapter anyway.
- The OpenAI `chat/completions` shape turns out to be too lossy for how these
  platforms actually drive agents (e.g. they need tool-calling semantics or
  multi-turn thread state that a stateless proxy can't represent).

## What I'm giving up

Platform-native UX. A real OpenCode-style plugin can hook into the host's own
login flow, config UI, and model picker; a standalone server can't — the user
has to run a local process and manually paste a base URL + token into
whatever platform they're using, once per platform, unless we later add a
thin native adapter on top of the core for that specific integration.
