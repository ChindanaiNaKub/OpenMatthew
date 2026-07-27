# OpenMatthew

> **Disclaimer:** This is an unofficial, community-made project. It is not affiliated with, endorsed by, or supported by Chiang Mai University or the Matthew AI team. Use it with your own CMU account at your own discretion. The authors take no responsibility for any account suspension or policy violations that may result from its use.

OpenCode plugin for CMU Matthew AI authentication — access GPT-5.2, GPT-4.1 and more using your Chiang Mai University credentials.

## What is this?

This is an [OpenCode](https://opencode.ai) plugin that enables authentication against [Matthew AI](https://matthew.cmu.ac.th), Chiang Mai University's generative AI platform. It allows you to use Matthew's AI models (GPT-5.2, GPT-5 Mini, GPT-4.1, GPT-4o, GPT-4o Mini) directly from OpenCode using your CMU account.

Inspired by [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth).

## Prerequisites

- [OpenCode](https://opencode.ai) installed
- A CMU Account (`@cmu.ac.th`)

No additional credentials or registration needed — the plugin uses Matthew's existing OAuth configuration.

## Installation

<details open>
<summary><b>For Humans</b></summary>

**Option A: Let an LLM do it**

Paste this into any LLM agent (Claude Code, OpenCode, Cursor, etc.):

```
Install the opencode-matthew-auth plugin and add the Matthew AI model definitions to ~/.config/opencode/opencode.json by following: https://raw.githubusercontent.com/ChindanaiNaKub/OpenMatthew/main/README.md
```

**Option B: Manual setup**

1. **Add the plugin** to `~/.config/opencode/opencode.json`:

   ```json
   {
     "plugin": ["opencode-matthew-auth"]
   }
   ```

2. **Login** with your CMU account:

   ```bash
   opencode auth login
   ```

3. **Add models** — copy the [full configuration](#available-models) below, or manually add to your `opencode.json`:

   ```json
   {
     "provider": {
       "matthew": {
         "name": "CMU Matthew AI",
         "models": {
           "gpt-5.2": { "name": "GPT-5.2" },
           "gpt-5-mini": { "name": "GPT-5 Mini" },
           "gpt-4.1": { "name": "GPT-4.1" },
           "gpt-4o": { "name": "GPT-4o" },
           "gpt-4o-mini": { "name": "GPT-4o Mini" }
         }
       }
     }
   }
   ```

4. **Use it:**

   ```bash
   opencode run "Hello" --model=matthew/gpt-5.2
   ```

</details>

<details>
<summary><b>For LLM Agents</b></summary>

### Step-by-Step Instructions

1. Edit the OpenCode configuration file at `~/.config/opencode/opencode.json`

   > **Note**: This path works on all platforms. On Windows, `~` resolves to your user home directory (e.g., `C:\Users\YourName`).

2. Add `"opencode-matthew-auth"` to the `plugin` array

3. Add the model definitions from the [Available Models](#available-models) section under `provider.matthew`

4. Set `provider` to `"matthew"` and choose a model

### Verification

```bash
opencode run "Hello" --model=matthew/gpt-5.2
```

</details>

---

## Usage

1. Run `opencode auth login` → select **"Login with CMU Account"**
2. Browser opens matthew.cmu.ac.th → login with your CMU Account (+ MFA)
3. After login, press `F12` → **Console** tab → paste this and press Enter:
   ```js
   copy(localStorage.user)
   ```
4. Go back to OpenCode and press `Ctrl+V` to paste
5. Done! Select a model like `matthew/gpt-5.2` and start coding

### Pro tip: Bookmarklet (one-time setup)

Drag this link to your bookmarks bar to skip the console step next time:

```
javascript:void(navigator.clipboard.writeText(localStorage.user).then(()=>alert('Copied! Paste into OpenCode.')))
```

Create a bookmark, name it "Copy Matthew Token", and paste the above as the URL. After logging into Matthew, just click the bookmark → paste into OpenCode.

## Using Matthew from other agent platforms

The OpenCode plugin above is the most polished way to use Matthew, but the
underlying client isn't tied to OpenCode. `src/server/` runs a small
standalone HTTP server that speaks OpenAI's `chat/completions` API — any
platform that lets you point at a custom OpenAI-compatible base URL (Hermes
Agent, thclaws, or anything else) can use your Matthew account through it,
without needing a Matthew-specific plugin written for that platform.

> **Status:** verified end to end against a real CMU account — a live token
> streams real replies through the server. Still young, so expect rough
> edges, but the path works.

**1. Run the server** (in its own terminal — it stays running, you don't
type into it):

```bash
npm run serve
# OpenMatthew server listening on http://127.0.0.1:4141
```

**2. Get your token.** In a *second* terminal, run the credentials helper:

```bash
npm run creds
```

It will ask you to paste something. Go log in at `https://matthew.cmu.ac.th`
with your CMU account, open DevTools (F12) → **Console**, run
`copy(localStorage.user)`, then paste that into the terminal running
`npm run creds` and press Enter. It prints a ready-to-use bearer token —
that's your credentials, reshaped and base64-encoded automatically.

**3. Point your platform at it** — configure its custom OpenAI settings:

| Setting | Value |
|---------|-------|
| Base URL | `http://127.0.0.1:4141/v1` |
| API key | the token `npm run creds` printed |

Or call it directly:

```bash
curl http://127.0.0.1:4141/v1/chat/completions \
  -H "Authorization: Bearer <token from npm run creds>" \
  -H "Content-Type: application/json" \
  -d '{"model":"matthew/gpt-5.2","messages":[{"role":"user","content":"Hello"}]}'
```

### What the server supports

| | |
|---|---|
| `POST /v1/chat/completions` | streaming and non-streaming |
| `GET /v1/models` | model list, no auth required — many clients probe this before you've configured a key |
| CORS + preflight | so browser-based platform UIs can connect |
| Multi-turn & system prompts | the full conversation is forwarded, not just your last message |

**The `model` you request is ignored.** Matthew ties the model to your
*assistant*, not to the request — the chat API carries no model field at
all. Whatever your default assistant is set to on
[matthew.cmu.ac.th](https://matthew.cmu.ac.th) is what answers, no matter
what you put in `model`. Change it in Matthew's own settings, not here.

Every request opens a fresh Matthew thread, so conversation state lives in
the messages your client sends rather than on Matthew's side.

### When something breaks

Matthew's API is undocumented and changes without notice. To check whether
it has drifted out from under this client:

```bash
npm run check-api
```

It reads Matthew's own frontend bundle — the only authoritative description
of the protocol — and reports which of our assumptions no longer hold.

## How it works

### Authentication Flow

```
User → opencode auth login
  → Browser opens matthew.cmu.ac.th
  → User logs in with CMU Account (Microsoft SSO + MFA)
  → Token saved in browser localStorage
  → User copies token (console or bookmarklet)
  → Pastes into OpenCode → stored locally
```

### Key Technical Details

- **Auth provider**: Microsoft Azure AD (tenant: `cf81f1df-de59-4c29-91da-a2dfd04aa751`)
- **OAuth method**: Authorization Code flow (code-based, no PKCE needed from client side)
- **Token exchange**: Handled by Matthew's backend at `/api/oauth_callback`
- **API auth**: Bearer token (`Authorization: Bearer <token>`)
- **Chat API**: SSE streaming via `/api/thread_sse_response_stream`

### Matthew API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/oauth_callback` | POST | Exchange auth code for access token |
| `/api/thread_sse_message` | POST | Send a message to a thread |
| `/api/thread_sse_ticket` | POST | Exchange the access token for a short-lived stream ticket |
| `/api/thread_sse_response_stream` | GET (SSE) | Stream AI response (authenticated by `ticket`, not the token) |
| `/api/assistants` | GET | List available AI assistants |
| `/api/apps` | GET | List available apps |

## Available Models

| Model | Description |
|-------|-------------|
| `matthew/gpt-5.2` | GPT-5.2 — newest reasoning model for complex tasks |
| `matthew/gpt-5-mini` | GPT-5 Mini — reasoning small model for everyday tasks |
| `matthew/gpt-4.1` | GPT-4.1 — smartest non-reasoning model |
| `matthew/gpt-4o` | GPT-4o — high performance, supports images and tool calls |
| `matthew/gpt-4o-mini` | GPT-4o Mini — lighter model, lower token usage |

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `MATTHEW_OAUTH_CLIENT_ID` | No | Override the Azure AD client ID |
| `MATTHEW_API_BASE` | No | Override the Matthew API base URL |

## Development

```bash
npm install        # Install dependencies
npm run typecheck  # Type-check
npm run build      # Build to dist/
```

## License

MIT
