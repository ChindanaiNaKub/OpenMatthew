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
| `/api/thread_sse_response_stream` | GET (SSE) | Stream AI response |
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

## Token Usage Tracking

OpenCode's right panel may show `0 tokens` for Matthew because the platform does not always expose usage metadata in the standard OpenAI format. This plugin now **automatically intercepts and records token usage** from every SSE streaming response:

- **Console logging**: After each response completes, usage is printed to the OpenCode output panel  
  Example: `[matthew] Usage: +120 prompt / +45 completion tokens (total: 165)`
- **Local storage**: Accumulated usage is saved to `~/.config/opencode/matthew-usage.json`
- **Manual check**: Run `npm run usage` (inside the plugin folder or your project) to print accumulated totals
- **Dashboard parity**: The plugin also attempts to fetch your Matthew dashboard quota (context/response limits) on login

### Why OpenCode shows 0 tokens

Matthew proxies requests to OpenAI but sometimes strips or reformats the `usage` field from the SSE stream. Because the plugin cannot inject data back into OpenCode's UI message object, it logs and stores the usage externally instead.

## Token Saving & Optimization

The plugin now includes several mechanisms to stretch your Matthew quota:

### Automatic Optimizations

- **`temperature = 0.2`, `topP = 0.95`** — set automatically on every request for deterministic, efficient code generation
- **System prompt injection** — attempts to override Matthew's default persona with a concise engineer prompt (may be ignored by the backend, but worth trying)
- **Pre-flight token estimation** — logs approximate token count before each request so you can see context bloat
- **Large-message warnings** — warns when a single message exceeds ~8k tokens, suggesting you split the request or use `@file` references
- **Budget warnings on login** — fetches your dashboard quota and warns if you're above 80% of either context (9M) or response (3M) limits

### Environment Tuning

| Variable | Default | Description |
|----------|---------|-------------|
| `MATTHEW_CONTEXT_LIMIT` | `9000000` | Your Matthew context token cap |
| `MATTHEW_RESPONSE_LIMIT` | `3000000` | Your Matthew response token cap |
| `MATTHEW_OVERRIDE_SYSTEM` | `1` | Set to `0` to disable system-prompt injection |
| `MATTHEW_SYSTEM_PROMPT` | *(see code)* | Custom system prompt string |

### Why Matthew says "I am Matthew" (and why it feels less smart)

Matthew's backend injects a **hardcoded system prompt** that forces the model to identify as "Matthew, CMU's AI assistant." This persona prompt:

1. **Consumes context tokens** before your actual prompt even starts
2. **Constrains reasoning** — the model is instructed to be helpful, friendly, and *conservative*, which often means verbose explanations and hesitant code changes
3. **Cannot be fully overridden** by the client — CMU controls this server-side

Top-tier agent harnesses (Cursor, Claude Code, Devin, etc.) do **not** do this. Instead they use:

| Technique | What top agents do | What Matthew does |
|-----------|-------------------|-------------------|
| **System prompt** | "You are a senior engineer. Be terse. Output diffs only." | "You are Matthew, CMU AI..." |
| **Context management** | Embedding-based file relevance, lazy loading, auto-summary | Sends full conversation history |
| **Multi-step reasoning** | Plan → Execute → Review loops with hidden scratchpad | Single-turn responses |
| **Tool use** | File read/write, terminal, search, LSP integration | Basic chat only |
| **Model routing** | Simple task → `gpt-4o-mini`, complex → `o1` | Same model for everything |
| **Output format** | Unified diff, JSON patches, structured edits | Full-file rewrites |

### What *you* can do to make Matthew smarter

Since the plugin cannot change Matthew's backend, optimize **your side** of the interaction:

1. **Be explicit about output format**
   - Bad: *"fix this file"*
   - Good: *"Output only a unified diff. Do not explain the changes."*

2. **Use the cheapest model for simple tasks**
   - `matthew/gpt-4o-mini` for explanations, refactoring, regex
   - `matthew/gpt-4.1` or `matthew/gpt-5.2` only for architecture/design/debugging

3. **Break large tasks into small, sequenced prompts**
   - Instead of one 10k-token mega-prompt, ask: *(1) plan → (2) implement step A → (3) implement step B*
   - This also triggers Matthew's reasoning mode on `gpt-5.2`

4. **Reference files with `@file` instead of pasting code**
   - OpenCode handles file inclusion automatically; pasting duplicates tokens

5. **Start fresh threads for unrelated topics**
   - Context window carries old conversation. New thread = clean slate = lower tokens

6. **Set `MATTHEW_SYSTEM_PROMPT` env var**
   - Even if Matthew's backend prepends its own prompt, some models blend or override later system messages:
   ```bash
   export MATTHEW_SYSTEM_PROMPT="You are a terse senior engineer. Never introduce yourself. Output diffs only."
   ```

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `MATTHEW_OAUTH_CLIENT_ID` | No | Override the Azure AD client ID |
| `MATTHEW_API_BASE` | No | Override the Matthew API base URL |
| `MATTHEW_CONTEXT_LIMIT` | No | Context token budget (default 9M) |
| `MATTHEW_RESPONSE_LIMIT` | No | Response token budget (default 3M) |
| `MATTHEW_OVERRIDE_SYSTEM` | No | `0` to disable system-prompt injection |
| `MATTHEW_SYSTEM_PROMPT` | No | Custom system prompt override |

## Development

```bash
npm install        # Install dependencies
npm run typecheck  # Type-check
npm run build      # Build to dist/
```

## License

MIT
