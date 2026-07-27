# Changelog

## 0.2.0

OpenMatthew started as an OpenCode plugin. It now works with any tool that
speaks the OpenAI API, and OpenCode is one client among several.

### Added

- **A standalone server** (`npm run serve`, or the `openmatthew-serve` bin).
  Speaks `POST /v1/chat/completions` with streaming and non-streaming, so
  any platform with a custom OpenAI base URL setting can use a CMU Matthew
  account without needing a Matthew-specific plugin.
- **`npm run creds`**, which turns the `localStorage.user` blob you copy out
  of Matthew into a ready-to-use bearer token. Previously this meant
  renaming JSON fields and base64-encoding them by hand.
- **`GET /v1/models`**, unauthenticated, because many clients enumerate
  models before you've entered a key and show an empty picker without it.
- **CORS and preflight handling**, without which browser-based platform UIs
  fail before reaching the server.
- **`npm run check-api`**, a drift check that reads Matthew's frontend
  bundle and reports which of our assumptions about its undocumented API no
  longer hold.
- **A test suite.** 17 tests covering the message transform, ticket
  authentication, response envelope, CORS, and error paths, against a fake
  Matthew that enforces the real protocol. There were no tests before, and
  `npm test` matched no files.
- Three models Matthew had added since the last release: `gpt-5.5`,
  `gpt-5.4`, and `gpt-5.4-mini`.
- **Token usage tracking and budget warnings** for the OpenCode plugin.
  OpenCode's panel shows `0 tokens` for Matthew because Matthew strips the
  `usage` field from its stream, so the plugin records usage itself, keeps a
  running total in `~/.config/opencode/matthew-usage.json`, prints it with
  `npm run usage`, and warns when you pass 80% of your dashboard quota.
  Ships alongside token estimation, pre-flight size warnings, and an
  optional system-prompt override (`MATTHEW_SYSTEM_PROMPT`,
  `MATTHEW_OVERRIDE_SYSTEM`).

### Fixed

- **Reading replies was broken.** Matthew changed
  `/api/thread_sse_response_stream` to require a short-lived ticket from
  `/api/thread_sse_ticket` and stopped accepting the access token. Sending a
  message still worked, so messages were charged against your quota and the
  reply never came back. This affected the OpenCode plugin too.
- **System prompts and conversation history were discarded.** Only the last
  user message reached Matthew, so multi-turn conversations lost their
  context and agent instructions were dropped outright.
- **Responses were missing the `id`, `object`, and `created` fields.** The
  OpenAI SDKs validate these and reject payloads without them.
- Stream failures reported "Failed to connect to Matthew SSE" and swallowed
  the status and body. They now include what Matthew actually said, and a
  401 says your session expired.

### Changed

- The OpenCode plugin registers its models through the shared core list, so
  the two can no longer drift apart.
- Matthew's protocol and account storage moved to `src/core/`, which has no
  OpenCode dependency. The plugin is now a thin adapter over it.
- The README leads with the universal path and documents that **the model
  you request is ignored**: Matthew resolves the model from your assistant,
  and its chat API has no model field.

### Removed

- `src/plugin/server.ts`, a local OAuth callback listener that nothing
  imported. Azure AD rejects `localhost` as a redirect URI, so the flow it
  implemented could never run.
- `authorizeMicrosoft` and `exchangeViaMatthew`, along with the Azure AD
  constants they used. They described an authorization-code flow this
  project does not perform, and nothing called them. **Breaking** if you
  imported them directly, though they never worked.
- The `MATTHEW_OAUTH_CLIENT_ID` environment variable from the docs. It was
  never read.

## 0.1.0

Initial release. OpenCode plugin for CMU Matthew AI authentication.
