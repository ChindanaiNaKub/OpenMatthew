# OpenMatthew

OpenCode plugin for CMU Matthew AI authentication — access GPT-4o using your Chiang Mai University credentials.

## What is this?

This is an [OpenCode](https://opencode.ai) plugin that enables authentication against [Matthew AI](https://matthew.cmu.ac.th), Chiang Mai University's generative AI platform. It allows you to use Matthew's AI models (GPT-4o, GPT-4o-mini) directly from OpenCode using your CMU account.

## Prerequisites

- [OpenCode](https://opencode.ai) installed
- A CMU Account (`@cmu.ac.th`)
- CMU OAuth application credentials (Client ID & Secret) — register at [oauth.cmu.ac.th](https://oauth.cmu.ac.th)

## Installation

Add the plugin to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "matthew": {
      "name": "CMU Matthew AI",
      "models": {
        "gpt-4o": {
          "name": "GPT-4o"
        },
        "gpt-4o-mini": {
          "name": "GPT-4o Mini"
        }
      }
    }
  },
  "plugin": [
    "opencode-matthew-auth"
  ]
}
```

## Configuration

Set the following environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `CMU_OAUTH_CLIENT_ID` | Yes | Your CMU OAuth application client ID |
| `CMU_OAUTH_CLIENT_SECRET` | Yes | Your CMU OAuth application client secret |
| `MATTHEW_API_BASE` | No | Override the Matthew API base URL (default: `https://matthew.cmu.ac.th`) |
| `OPENCODE_MATTHEW_OAUTH_BIND` | No | Override the OAuth callback bind address (default: `127.0.0.1`) |

## Usage

1. Start OpenCode
2. Run `opencode auth login` and select "Login with CMU Account"
3. Your browser will open the CMU OAuth login page
4. Authenticate with your CMU Account
5. Select a Matthew AI model (e.g., `matthew/gpt-4o`) and start coding

## How it works

1. **Authentication**: Uses CMU OAuth (`oauth.cmu.ac.th`) authorization code flow to authenticate users with their university credentials.
2. **Provider Registration**: Registers a `matthew` provider in OpenCode with GPT-4o and GPT-4o-mini models.
3. **Request Proxying**: Intercepts requests to the Matthew provider and injects the CMU access token for authentication.

## CMU OAuth Flow

```
User → opencode auth login → CMU OAuth (oauth.cmu.ac.th)
  → Browser login with CMU Account
  → Callback to localhost:51122
  → Exchange code for access token
  → Fetch user info from CMU API
  → Store credentials locally
```

## Available Models

| Model | Description |
|-------|-------------|
| `matthew/gpt-4o` | GPT-4o — high performance, supports images and tool calls |
| `matthew/gpt-4o-mini` | GPT-4o Mini — lighter model, lower token usage |

## Development

```bash
# Install dependencies
npm install

# Type-check
npm run typecheck

# Build
npm run build
```

## License

MIT
