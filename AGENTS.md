# AGENTS.md

## Cursor Cloud specific instructions

### Repository Overview

**opencode-matthew-auth** is an OpenCode plugin for CMU Matthew AI authentication. It authenticates users via Microsoft Azure AD (CMU tenant) and proxies requests to the Matthew AI platform at matthew.cmu.ac.th.

### Tech Stack

- TypeScript (ESM, strict mode), Node.js >= 20
- `@opencode-ai/plugin` SDK

### Key Discovery: Authentication

Matthew uses **Microsoft Azure AD** for authentication, NOT CMU OAuth (`oauth.cmu.ac.th`). The OAuth parameters were extracted from the Matthew JS bundle (`main.cfe9534d.js`):

- **Tenant ID**: `cf81f1df-de59-4c29-91da-a2dfd04aa751`
- **Client ID**: `5bedd6e5-ae10-4b96-abca-5c887092a70c`
- **Scope**: `api://cmu/Mis.Account.Read.Me.Basicinfo`
- **Redirect URI**: `https://matthew.cmu.ac.th`

Token exchange happens server-side at `POST /api/oauth_callback` with `{code: "<auth_code>"}`.

### Common Commands

- `npm run typecheck` — type-check
- `npm run build` — compile to `dist/`
- `npm run lint` — alias for typecheck

### Gotchas

- The tenant ID `cf81f1df-de59-4c29-91da-a2dfd04aa751` looks similar to `cf8f1fdf-de69-...` in screenshots. Always extract from source code, not screenshots.
- The `CMU_OAUTH_CLIENT_ID` / `CMU_OAUTH_CLIENT_SECRET` env vars are NOT needed. Matthew does not use CMU OAuth.
- Matthew's API uses Bearer token auth. Chat uses SSE streaming via `/api/thread_sse_response_stream?thread_id=...&token=...`.
