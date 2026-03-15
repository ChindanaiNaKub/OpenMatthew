# OpenMatthew

OpenCode plugin for CMU Matthew AI authentication — access GPT-5.2, GPT-4.1 and more using your Chiang Mai University credentials.

## What is this?

This is an [OpenCode](https://opencode.ai) plugin that enables authentication against [Matthew AI](https://matthew.cmu.ac.th), Chiang Mai University's generative AI platform. It allows you to use Matthew's AI models (GPT-5.2, GPT-5 Mini, GPT-4.1, GPT-4o, GPT-4o Mini) directly from OpenCode using your CMU account.

Inspired by [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth).

## Prerequisites

- [OpenCode](https://opencode.ai) installed
- A CMU Account (`@cmu.ac.th`)

No additional credentials or registration needed — the plugin uses Matthew's existing OAuth configuration.

## Installation

Add the plugin to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
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
  },
  "plugin": ["opencode-matthew-auth"]
}
```

## Usage

1. Start OpenCode
2. Run `opencode auth login` and select **"Login with CMU Account (Microsoft SSO)"**
3. Your browser will open the Microsoft SSO login page (CMU tenant)
4. Authenticate with your CMU Account
5. After login, you'll be redirected to matthew.cmu.ac.th — copy the `code` parameter from the URL and paste it into OpenCode
6. Select a Matthew AI model (e.g., `matthew/gpt-5.2`) and start coding

## How it works

### Authentication Flow

```
User → opencode auth login
  → Browser opens Microsoft SSO (CMU Azure AD tenant)
  → User logs in with CMU Account
  → Redirect to matthew.cmu.ac.th?code=...
  → User pastes code into OpenCode
  → Plugin calls matthew.cmu.ac.th/api/oauth_callback
  → Matthew backend exchanges code for access token
  → Token stored locally, ready to use
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
