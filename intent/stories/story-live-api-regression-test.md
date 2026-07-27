---
id: story-live-api-regression-test
type: story
title: Commit tests for the Matthew protocol, and detect API drift early
status: draft
parent: project-extract-core
serves: []
priority: p2
code: [src/core/**, package.json]
---

## What changes

Two gaps this project shipped with, both exposed by the ticket-auth bug in
[[story-openai-compat-server]]:

1. **No committed tests at all.** `npm test` points at
   `dist/**/*.test.js`, which matches nothing. Every check during this work
   was a throwaway script in a scratchpad directory, so none of it protects
   the next change.
2. **Nothing notices when Matthew's API drifts.** The stream endpoint
   silently changed to require a ticket; we only found out because a human
   hit a 401 by hand. The simulated backend didn't catch it because a
   simulation only encodes what you already believe.

So: commit the simulated-backend test as a real test, and add a separate,
explicitly-network-dependent check that fetches Matthew's live frontend
bundle and asserts the endpoints and parameters we depend on still appear
in it.

## Acceptance

- [ ] `npm test` runs real tests and fails if the OpenAI-shape transform
      (thread create → ticket → SSE → `chat/completions`) breaks
- [ ] the simulated backend enforces the ticket exchange, so reverting the
      ticket fix makes the suite fail
- [ ] a separate command (not part of `npm test`, since it needs network
      and will break when CMU is down) fetches
      `matthew.cmu.ac.th/static/js/main.*.js` and reports whether
      `thread_sse_ticket`, `thread_sse_message`, and the `ticket=` stream
      parameter are still present
- [ ] the drift check discovers the bundle filename rather than hardcoding
      it — it changed from `main.cfe9534d.js` to `main.fa03f287.js` between
      AGENTS.md being written and this work

## Notes

Deliberately keeping the drift check out of `npm test`: it depends on a
third party being up and on a bundle we don't control, so wiring it into
the normal test path would make the suite flaky for a failure mode that
isn't ours. It's a diagnostic to run when something breaks, and a candidate
for a scheduled run later.
