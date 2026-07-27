---
id: goal-any-platform-access
type: goal
title: Matthew AI usable from any agent platform, not just OpenCode
status: draft
parent: bet-multi-platform-core
measure: A platform with zero Matthew-specific code (just a custom OpenAI base URL + token field) can complete a real chat round-trip against Matthew through the standalone server, and the existing OpenCode plugin still passes its current behavior unchanged.
priority: p1
---

## Outcome

Someone using Hermes Agent, thclaws, or any other tool that lets you point at
a custom OpenAI-compatible endpoint can use their CMU Matthew account from
it today, without us having written a line of code specific to that
platform. OpenCode users notice nothing different.

## How I'll know

Run the standalone server locally, point a generic OpenAI-compatible client
(curl, or any tool with a "custom base URL" field) at it with a real Matthew
token, and get a real streamed response back. Separately, the existing
OpenCode plugin's exports, config shape, and login flow are unchanged —
current users upgrade without editing their `opencode.json`.

## Not this

Not building native plugins for Hermes Agent or thclaws specifically — that's
only worth doing later, and only for a platform that turns out not to
support custom OpenAI base URLs.
