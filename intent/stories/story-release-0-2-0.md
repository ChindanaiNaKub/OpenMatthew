---
id: story-release-0-2-0
type: story
title: Release 0.2.0 and reframe the project around universal use
status: done
parent: project-extract-core
serves: []
priority: p1
code: [README.md, CHANGELOG.md, package.json, index.ts, src/constants.ts, src/plugin.ts]
---

## What changes

Cuts the 0.2.0 release. The README led with "OpenCode plugin for CMU
Matthew AI", which stopped being what this is once the standalone server
landed, so it now leads with the universal path and treats OpenCode as one
client among several. Adds a CHANGELOG, since a release that changes what
the package *is* needs its changes written down somewhere a user will find
them.

Also clears out code the earlier work left behind.

## Acceptance

- [x] version is `0.2.0` and the package description no longer says the
      project is only for OpenCode
- [x] the README leads with the any-platform path and documents the server,
      `npm run creds`, `/v1/models`, CORS, and the ignored-`model` caveat
- [x] `CHANGELOG.md` records what changed, including the breaking removals
- [x] dead code is gone and the tree still typechecks, tests, and builds
- [x] `npm pack` ships no test files, and both bins resolve

## Notes

Removed as dead: `src/plugin/server.ts` (209 lines, imported by nothing —
a local OAuth callback listener for a flow that cannot run, since Azure AD
rejects `localhost` as a redirect URI), and `src/oauth/microsoft.ts`
(`authorizeMicrosoft` was an unused import in `plugin.ts`;
`exchangeViaMatthew` was exported publicly but called nowhere and described
an authorization-code exchange this project never performs). Both were
public exports, so this is breaking, hence the minor bump rather than a
patch.

Also closed the model-list duplication flagged as debt in
[[story-openai-wire-compat]]: the OpenCode plugin now builds its provider
config from `src/core/models.ts` instead of its own hardcoded copy, so the
two lists cannot drift. This does change OpenCode's advertised models by
adding `gpt-5.5`, `gpt-5.4`, and `gpt-5.4-mini`, which is a deliberate
improvement rather than the byte-identical parity
[[story-opencode-adapter-parity]] originally asked for.

The README documented a `MATTHEW_OAUTH_CLIENT_ID` environment variable that
no code ever read. Dropped.

Not done here: the package is still named `opencode-matthew-auth`, which
now undersells it. Renaming means republishing under a new name and
orphaning existing installs, so it needs a human decision.
