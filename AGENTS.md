# AGENTS.md

## Cursor Cloud specific instructions

### Repository Overview

**opencode-matthew-auth** is an OpenCode plugin for CMU Matthew AI authentication. It authenticates users via Microsoft Azure AD (CMU tenant) and proxies requests to the Matthew AI platform at matthew.cmu.ac.th.

### Tech Stack

- TypeScript (ESM, strict mode), Node.js >= 20
- `@opencode-ai/plugin` SDK

### Key Discovery: Authentication

Matthew uses **Microsoft Azure AD** for authentication, NOT CMU OAuth (`oauth.cmu.ac.th`). Parameters extracted from Matthew's JS bundle:

- **Tenant ID**: `cf81f1df-de59-4c29-91da-a2dfd04aa751`
- **Client ID**: `5bedd6e5-ae10-4b96-abca-5c887092a70c`
- **Scope**: `api://cmu/Mis.Account.Read.Me.Basicinfo`
- **Redirect URI**: `https://matthew.cmu.ac.th` (Azure AD only allows this, localhost is rejected)

### Key Discovery: Dual Token System

Matthew uses two different tokens stored in `localStorage.user`:
- `token` (36 chars, UUID): used in FormData for API calls
- `access_token` (345 chars, JWT): used in Authorization headers and SSE stream URLs

### Key Discovery: API Format

Matthew does NOT use OpenAI-compatible API. The plugin transforms requests:
- OpenCode sends: `POST /v1/chat/completions` (OpenAI format)
- Plugin transforms to: `POST /api/thread_sse_message` (FormData) + `GET /api/thread_sse_response_stream` (SSE)
- The `thread_actual_id` is nested inside `new_thread` in the response
- End-of-stream is signaled via SSE named event `event: complete`

### Common Commands

- `npm run typecheck` — type-check
- `npm run build` — compile to `dist/`
- `npm run lint` — alias for typecheck

### Gotchas

- Tenant ID `cf81f1df-de59-4c29-91da-a2dfd04aa751` looks similar to `cf8f1fdf-de69-...` in screenshots. Always extract from the JS bundle, not screenshots.
- Azure AD rejects `http://localhost` as redirect_uri for this app. A fully automatic OAuth flow requires CMU IT to register localhost.
- Matthew's SSE uses named events (`complete`, `error`, `ptoken`, `ctoken`, `tool`, `tool_call`, `alert`), not just `data:` lines.
- Each new chat creates a new thread via `thread_id: "newchat"`. The `defaultAssistant.daid` from the user object is needed for the `aid` field.
