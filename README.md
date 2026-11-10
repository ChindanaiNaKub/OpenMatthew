# OpenMatthew

> Unofficial, community project. Not affiliated with Chiang Mai University or the Matthew AI team. Use your own CMU account at your own risk.

Use your CMU [Matthew AI](https://matthew.cmu.ac.th) account from any app that speaks the OpenAI API. OpenMatthew runs on your computer and translates between the two.

## Quick start

You need Node.js 20 or newer, and git.

1. Get the code and install it:

   ```bash
   git clone https://github.com/ChindanaiNaKub/OpenMatthew
   cd OpenMatthew
   npm install
   ```

2. Start the server. Leave this terminal open:

   ```bash
   npm run serve
   ```

3. In a second terminal, get your token:

   ```bash
   npm run creds
   ```

   Log in at [matthew.cmu.ac.th](https://matthew.cmu.ac.th). Press `F12`, open the **Console** tab, and run `copy(localStorage.user)`. Paste the result into the terminal and press Enter. Copy the token it prints.

4. In your app, set:

   | Setting | Value |
   |---------|-------|
   | Base URL | `http://127.0.0.1:4141/v1` |
   | API key | the token from step 3 |
   | Model | `gpt-6.1-sol` |

The token logs in as you. Keep it private, and do not paste it into an AI chat.

## Let an AI agent do the setup

Paste this into a coding agent. It stops before the token step, so your token stays with you:

```
Set up OpenMatthew on this computer. Repo: https://github.com/ChindanaiNaKub/OpenMatthew

1. Clone it, run `npm install`, then start `npm run serve` in the background.
2. Check that http://127.0.0.1:4141/v1/models returns a JSON model list.
3. Stop there. Tell me to run `npm run creds` myself. Do not ask me to paste my token into this chat.
```

## Connect your app

- **Any OpenAI-compatible app:** use the settings in step 4 above.
- **Hermes Agent:** in `~/.hermes/config.yaml`, set `provider: custom`, `base_url: http://127.0.0.1:4141/v1`, and your token as `api_key`.

## Images

`POST /v1/images/generations` returns an image URL, or base64 with `"response_format": "b64_json"`:

```bash
curl http://127.0.0.1:4141/v1/images/generations \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "a red apple on a white background"}'
```

- Your default assistant must have **Image generation (GPT-Image-2.5)** on. Otherwise the server returns a 502.
- Matthew allows 15 images per day. Each call counts.
- Only `n: 1` is supported. `size` and `model` are ignored.

## Models

These are the model ids Matthew ships:

| Model | Reasoning |
|-------|-----------|
| `gpt-6.1-sol` | Yes. Newest flagship. |
| `gpt-6-sol` | Yes |
| `gpt-6-luna` | No. Fast and efficient. |
| `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.2`, `gpt-5-mini` | Yes |
| `gpt-4.1`, `gpt-4o`, `gpt-4o-mini` | No |

Matthew ignores the model you request. Your default assistant answers every request. Change the assistant on matthew.cmu.ac.th.

## Limits

- **The OpenCode plugin targets OpenCode v2.** It runs on `@opencode/plugin`. Older OpenCode v1 releases do not load it.
- **Tool calls are emulated.** The server writes tool schemas into the prompt and parses the reply. It is less reliable than a native tool API.
- **Matthew's API is undocumented.** When something breaks, run `npm run check-api`. It reads Matthew's own frontend bundle and reports changed assumptions.

## Configuration

All optional.

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default `4141`) |
| `MATTHEW_API_BASE` | Override the Matthew API base URL |

## Development

```bash
npm install
npm test           # unit tests, no network needed
npm run build
npm run check-api  # check the live API for drift (needs network)
```

## License

MIT
