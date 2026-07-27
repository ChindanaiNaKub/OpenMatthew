---
id: mission
type: mission
title: Agent-first, beginner-friendly access to CMU Matthew AI
status: draft
---

## Why this exists

OpenMatthew turns a CMU student's free Matthew AI account into a model an
AI coding agent can actually use. Today that only works if you already know
OpenCode's plugin config format well enough to hand-edit JSON. If this
repo stopped existing, CMU students would lose the only bridge between AI
quota they already have (through their university) and the agentic coding
tools they actually want to use — and the people most likely to want that
bridge (students new to agent tooling) are the ones least able to build it
themselves. The work here is making that bridge easy enough for a beginner
to set up, and portable enough to plug into agent platforms beyond
OpenCode — Hermes Agent, thclaws, and others — instead of being locked to
one host.

## What this is not

- an official CMU or Matthew AI product — this is unaffiliated,
  community-maintained, and used at the account holder's own risk
- a new agent platform — it authenticates and adapts an existing model
  API, it doesn't build the agent runtime itself
- a general-purpose OAuth/auth library — the Azure AD flow here is
  specific to Matthew's tenant and API shape, not a reusable auth framework
