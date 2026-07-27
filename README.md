# OpenMatthew

> **Disclaimer:** This is an unofficial, community-made project. It is not affiliated with, endorsed by, or supported by Chiang Mai University or the Matthew AI team. Use it with your own CMU account at your own discretion. The authors take no responsibility for any account suspension or policy violations that may result from its use.

Use your CMU [Matthew AI](https://matthew.cmu.ac.th) account from any tool that speaks the OpenAI API: OpenCode, Hermes Agent, thclaws, Cursor, or your own scripts.

Matthew is Chiang Mai University's generative AI platform, free to students and staff. It has its own API that nothing else knows how to talk to. OpenMatthew translates it, so your CMU quota works wherever you already write code.

Inspired by [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth).

## Two ways to use it

| | Best for |
|---|---|
| [**Local server**](#any-openai-compatible-platform) | Any platform with a custom OpenAI base URL setting. One server, any client. |
| [**OpenCode plugin**](#opencode) | OpenCode users who want login and model picking built into the app. |

Both need a CMU account (`@cmu.ac.th`) and nothing else. No registration, no API key to request.

---

## Any OpenAI-compatible platform

A small local server that speaks `chat/completions`. Point any OpenAI client at it.

> **Status:** verified end to end against a real CMU account. Still young, so expect rough edges.

**1. Start the server.** It stays running in this terminal, so leave it alone once it boots.

```bash
npm run serve
# OpenMatthew server listening on http://127.0.0.1:4141
```

**2. Get your token.** In a *second* terminal:

```bash
npm run creds
```

It waits for you to paste something. Log in at [matthew.cmu.ac.th](https://matthew.cmu.ac.th), press `F12` to open DevTools, go to the **Console** tab, and run:

```js
copy(localStorage.user)
```

Paste that into the terminal running `npm run creds` and press Enter. It prints a bearer token with your credentials already reshaped and encoded.

**3. Point your platform at it.** In its custom OpenAI settings:

| Setting | Value |
|---------|-------|
| Base URL | `http://127.0.0.1:4141/v1` |
| API key | the token from step 2 |

Or call it directly:

```bash
curl http://127.0.0.1:4141/v1/chat/completions \
  -H "Authorization: Bearer <token from npm run creds>" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.2","messages":[{"role":"user","content":"Hello"}]}'
```

### What the server handles

| | |
|---|---|
| `POST /v1/chat/completions` | Streaming and non-streaming |
| `GET /v1/models` | The model list, no auth needed. Many clients probe this before you've entered a key. |
| CORS and preflight | So browser-based platform UIs can reach it |
| System prompts and history | The whole conversation is forwarded, not only your last message |

### The model you ask for is ignored

Matthew picks the model from your **assistant**, and its chat API carries no model field at all. Whatever your default assistant is set to on [matthew.cmu.ac.th](https://matthew.cmu.ac.th) answers every request, regardless of what you put in `model`. Change it in Matthew's own settings.

Every request opens a fresh Matthew thread, so conversation history lives in what your client sends rather than on Matthew's side.

### When something breaks

Matthew's API is undocumented and changes without notice. To find out whether it moved:

```bash
npm run check-api
```

This reads Matthew's own frontend bundle, which is the only authoritative description of the protocol, and reports which assumptions no longer hold.

---

## OpenCode

<details open>
<summary><b>For humans</b></summary>

**Option A: let an LLM do it**

Paste this into any coding agent:

```
Install the opencode-matthew-auth plugin and add the Matthew AI model definitions to ~/.config/opencode/opencode.json by following: https://raw.githubusercontent.com/ChindanaiNaKub/OpenMatthew/main/README.md
```

**Option B: set it up yourself**

1. Add the plugin to `~/.config/opencode/opencode.json`:

   ```json
   {
     "plugin": ["opencode-matthew-auth"]
   }
   ```

2. Log in:

   ```bash
   opencode auth login
   ```

3. Pick **"Login with CMU Account"**. Your browser opens matthew.cmu.ac.th. Log in with your CMU account and MFA.

4. Press `F12`, open the **Console** tab, and run:

   ```js
   copy(localStorage.user)
   ```

5. Back in OpenCode, press `Ctrl+V` to paste. Then:

   ```bash
   opencode run "Hello" --model=matthew/gpt-5.2
   ```

The plugin registers the models for you, so no `provider` block is needed.

</details>

<details>
<summary><b>For LLM agents</b></summary>

1. Edit `~/.config/opencode/opencode.json`. This path works on all platforms; on Windows `~` resolves to the user home directory (e.g. `C:\Users\YourName`).

2. Add `"opencode-matthew-auth"` to the `plugin` array.

3. The plugin's `config` hook registers `provider.matthew` and its models automatically. Adding them by hand is optional and only needed to override a name or limit.

4. Tell the user to run `opencode auth login` and choose "Login with CMU Account". The login needs a browser and a copy-paste from DevTools, so it cannot be automated.

Verify with:

```bash
opencode run "Hello" --model=matthew/gpt-5.2
```

</details>

### Bookmarklet

Skips the DevTools console step. Make a bookmark named "Copy Matthew Token" and use this as the URL:

```
javascript:void(navigator.clipboard.writeText(localStorage.user).then(()=>alert('Copied! Paste into OpenCode.')))
```

After logging into Matthew, click it and paste.

### Token usage tracking

OpenCode's panel often shows `0 tokens` for Matthew, because Matthew strips or reformats the `usage` field in its SSE stream and the plugin cannot write data back into OpenCode's UI. So the plugin records usage itself:

- Prints a line after each response, like `[matthew] Usage: +120 prompt / +45 completion tokens (total: 165)`
- Accumulates totals in `~/.config/opencode/matthew-usage.json`
- `npm run usage` prints the running total
- Fetches your dashboard quota on login and warns past 80% of either limit

This applies to the OpenCode plugin. The standalone server does not track usage.

### Stretching your quota

The plugin sets `temperature = 0.2` and `topP = 0.95` on every request, estimates the token count before sending, and warns when a single message passes roughly 8k tokens.

It also tries to replace Matthew's system prompt with a terser one. Matthew injects a hardcoded persona server-side that makes the model introduce itself and answer conservatively, which costs you context tokens and tends to produce long explanations and whole-file rewrites. CMU controls that prompt, so the override may not take. Set `MATTHEW_OVERRIDE_SYSTEM=0` to stop trying, or `MATTHEW_SYSTEM_PROMPT` to supply your own.

What helps most is on your side of the request:

1. **Ask for the output format you want.** "Output only a unified diff, no explanation" beats "fix this file".
2. **Use a cheap model for cheap work.** `gpt-4o-mini` handles explanations, refactors, and regex.
3. **Split large tasks into sequenced prompts** rather than one 10k-token request.
4. **Reference files with `@file`** instead of pasting code, which duplicates tokens.
5. **Start a new thread for a new topic.** Old context rides along otherwise.

---

## Available models

These are the ids Matthew's frontend ships. Remember that [the requested model is ignored](#the-model-you-ask-for-is-ignored); your assistant decides.

| Model | Reasoning |
|-------|-----------|
| `gpt-5.5` | Yes. Current flagship. |
| `gpt-5.4` | Yes |
| `gpt-5.4-mini` | Yes |
| `gpt-5.2` | Yes |
| `gpt-5-mini` | Yes |
| `gpt-4.1` | No. Strongest non-reasoning model. |
| `gpt-4o` | No |
| `gpt-4o-mini` | No. Lightest. |

In OpenCode these are prefixed, as in `matthew/gpt-5.2`.

## How it works

Logging in is a copy-paste rather than a redirect because Azure AD only accepts `https://matthew.cmu.ac.th` as a redirect URI and rejects `localhost`. So you log into Matthew normally, and OpenMatthew borrows the session your browser already has.

```
You log into matthew.cmu.ac.th (Microsoft SSO + MFA)
  → Matthew stores the session in localStorage
  → you copy it (console or bookmarklet)
  → OpenMatthew stores it locally and sends it as a Bearer token
```

Sending a message takes three calls, because Matthew's stream is authenticated separately:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/thread_sse_message` | POST | Send the message, get a thread id |
| `/api/thread_sse_ticket` | POST | Trade the access token for a short-lived stream ticket |
| `/api/thread_sse_response_stream` | GET (SSE) | Read the reply, authenticated by `ticket` |

That last one takes no `Authorization` header. Matthew's frontend opens it with an `EventSource`, which cannot set headers, so the ticket travels in the URL instead.

Two tokens come out of `localStorage.user` and both are needed: `token` (a UUID) goes in the message form data, and `access_token` (a JWT) goes in `Authorization` headers.

## Configuration

All optional.

| Variable | Description |
|----------|-------------|
| `MATTHEW_API_BASE` | Override the Matthew API base URL |
| `PORT` | Server port (default `4141`) |
| `OPENCODE_CONFIG_DIR` | Where the plugin stores accounts and usage (default `~/.config/opencode`) |
| `MATTHEW_CONTEXT_LIMIT` | Context token budget (default 9M) |
| `MATTHEW_RESPONSE_LIMIT` | Response token budget (default 3M) |
| `MATTHEW_OVERRIDE_SYSTEM` | `0` to disable system-prompt injection |
| `MATTHEW_SYSTEM_PROMPT` | Custom system prompt override |

## Development

```bash
npm install
npm run typecheck
npm test           # 17 tests, no network needed
npm run build
npm run check-api  # check the live API for drift (needs network)
```

## License

MIT
