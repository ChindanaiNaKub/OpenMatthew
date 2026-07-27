---
id: story-credential-paste-helper
type: story
title: Interactive paste-and-go credential helper for the standalone server
status: done
parent: project-extract-core
serves: []
priority: p1
code: [src/server/creds.ts, package.json, README.md]
---

## What changes

Getting the standalone server's bearer token used to mean manually
reshaping the pasted `localStorage.user` JSON (renaming `access_token` →
`accessToken`, `token` → `sessionToken`, digging out `defaultAssistant.daid`)
and base64-encoding it by hand — confirmed confusing in practice: a real
user hit exactly this friction twice in a row, including expecting
`npm run serve`'s own terminal to accept pasted input. `src/server/creds.ts`
(`npm run creds` / `openmatthew-creds`) does that reshaping for you: paste
the raw `copy(localStorage.user)` output, get back a ready-to-use bearer
token and a working `curl` example.

## Acceptance

- [x] `npm run creds` prompts for pasted input, and given a valid
      `localStorage.user`-shaped JSON blob, prints a bearer token that
      decodes back to `{accessToken, sessionToken, assistantId}`
- [x] empty input, invalid JSON, and JSON missing `access_token`/`token`
      each fail with a specific, non-crashing error message
- [x] the README's standalone-server section leads with `npm run creds`
      instead of manual JSON-reshaping + `base64`

## Notes

Directly serves the mission's "beginner-friendly" half — the multi-platform
bet chain otherwise only proves the "any platform" half. Worth revisiting
whether a `problem`/`user` artifact should sit under this now that there's
a concrete, observed instance of someone hitting the friction (see the open
inbox item on bet-multi-platform-core's coverage gap).
