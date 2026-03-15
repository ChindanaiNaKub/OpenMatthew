# AGENTS.md

## Cursor Cloud specific instructions

### Repository Overview

This is **opencode-matthew-auth**, an OpenCode plugin that provides CMU OAuth authentication for the [Matthew AI](https://matthew.cmu.ac.th) platform at Chiang Mai University. It is modeled after [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth).

### Tech Stack

- TypeScript (ESM, strict mode)
- Node.js >= 20
- `@opencode-ai/plugin` SDK for the plugin interface

### Services

| Service | Required | Notes |
|---------|----------|-------|
| OpenCode | Yes | The plugin host; plugin is loaded by OpenCode at runtime |
| CMU OAuth (oauth.cmu.ac.th) | Yes | External auth provider; requires Client ID and Secret |
| Matthew AI (matthew.cmu.ac.th) | Yes | The AI backend; CMU account required |

### Common Commands

See `package.json` scripts. Key commands:

- `npm run typecheck` — type-check without emitting
- `npm run build` — compile to `dist/`
- `npm run lint` — alias for typecheck (no separate linter configured)

### Environment Variables

The plugin requires `CMU_OAUTH_CLIENT_ID` and `CMU_OAUTH_CLIENT_SECRET` at runtime. These are obtained by registering an OAuth app at oauth.cmu.ac.th. They are **not** needed for build/typecheck.

### Development Notes

- The build output goes to `dist/` (ESM, with declarations and source maps).
- The OAuth callback server listens on port 51122 (configurable via `OPENCODE_MATTHEW_OAUTH_BIND`).
- Account credentials are stored in `~/.config/opencode/matthew-accounts.json`.
