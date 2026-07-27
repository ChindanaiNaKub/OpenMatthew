---
id: story-document-server-integration
type: story
title: Document the standalone server as the any-platform integration path
status: done
parent: project-extract-core
serves: []
priority: p2
code: [README.md]
---

## What changes

The README currently only documents the OpenCode plugin install path. It
gains a section explaining `src/server/` — how to run it (`npm run serve` /
`openmatthew-serve`), how to build the bearer credential (base64 of
`{accessToken, sessionToken, assistantId}`), and that any platform with a
custom OpenAI base URL setting (Hermes Agent, thclaws, or anything else)
can point at it.

## Acceptance

- [x] README has a section describing the standalone server as the
      integration path for platforms other than OpenCode
- [x] it documents how to start the server and the exact credential format
      the `Authorization` header expects
- [x] it's honest that this path hasn't been smoke-tested against a real
      Matthew account yet (see the two open inbox items), not presented as
      fully verified

## Notes

Uncovered while wrapping up [[project-extract-core]] — its "Done when"
already called for this, it just hadn't been split into its own story yet.
