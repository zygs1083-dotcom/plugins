# Freebuff

Signs in to [Freebuff](https://freebuff.com) and makes requests to its free models in OpenCode and magpie. Provider id: `freebuff`.

## ⚠️ Important Warnings

**This plugin is experimental and comes with significant risks:**

1. **Third-party client restrictions**: Freebuff's server is designed to refuse third-party clients. This plugin mimics the official Freebuff CLI to pass server-side checks, including:
   - Using fixed agent IDs and system prompt prefixes
   - Generating per-install device keys and signing requests
   - Following the session admission protocol

2. **Terms of service**: Using this plugin may violate Freebuff's terms of service. Freebuff explicitly blocks third-party clients in its free tier to protect its ad-supported model.

3. **Account risks**: Your Freebuff account may be suspended or banned for using this plugin. **Use only on an account you can afford to lose.**

4. **No guarantees**: Freebuff can change its protocol or detection logic at any time, breaking this plugin without notice.

5. **Ethical concerns**: This plugin bypasses restrictions Freebuff deliberately implemented. The legitimate options are:
   - Using the official Freebuff CLI
   - Using Freebuff's BYOK or paid API (if available)
   - Requesting official third-party integration support

**By installing this plugin, you accept all these risks.**

## How it works

The plugin implements Freebuff's authentication and session protocol:

1. **Device sign-in**: Browser-based device code flow (`/api/auth/cli/code` + polling)
2. **Credential storage**: Token saved in OS keychain (like the official CLI)
3. **Session admission**: Requests session before each chat (`/api/v1/freebuff/session`)
4. **Device signing**: Each request signed with Ed25519 device key
5. **Model catalog**: Fetches account-specific model handles (`/api/v1/freebuff/models`)

## Install

```sh
magpie plugin add @magpie-community/opencode-freebuff-auth
magpie plugin login freebuff
```

## Signing in

**Freebuff device sign-in** — Opens the browser for device authorization. The plugin:
- Generates a fingerprint ID (hardware-based or random fallback)
- Requests a device code from `freebuff.com/api/auth/cli/code`
- Opens the login page in your browser
- Polls for completion
- Stores the token in the OS keychain

The sign-in is kept where OpenCode keeps auth (`auth.json`); magpie keeps plugin sign-ins in `~/.config/magpie/plugin-auth.json`.

**Token storage**: Like the official CLI, the token is moved to your OS keychain:
- macOS: Keychain Access, service `freebuff-magpie-plugin`
- Linux: Secret Service API (gnome-keyring, KWallet)
- Windows: Credential Manager

**No refresh logic**: Freebuff tokens don't expire on a schedule. When a request fails with 401/403, you'll need to sign in again.

## Models

The plugin fetches Freebuff's server-driven model catalog, which includes account-specific model "handles" (not raw model IDs). Models available depend on your account's region and access tier (full vs limited).

Common models (as of 2026-10):
- `mimo/mimo-v2.6-flash-fast` (default)
- `deepseek/deepseek-v4-flash`
- `z-ai/glm-5.3-flash`
- `openai/gpt-6-luna`
- `google/gemini-3.8-flash` (paid plans only)
- `openai/gpt-6.1-sol` (free in US, paid elsewhere)

Use models as `freebuff/<handle>`, for example `freebuff/mimo-v2.6-flash-fast`.

## Requests

Chat completions go to `https://www.codebuff.com/api/v1/chat/completions` in OpenAI format, with:
- Session admission before each chat
- Device-signed headers on catalog, session, and chat requests
- Account-specific model handles (rotated by the server)
- Agent metadata mimicking the official CLI

Ads are not fetched or displayed (server-side enforcement is unclear from public code).

## Limitations

- **No web search or browser tools** (CLI-only features)
- **Session-bound**: Each conversation requires an active session with heartbeats
- **Rate limits**: Set by Freebuff (daily hour allowances, per-model multipliers)
- **Regional restrictions**: Limited mode outside full-access countries
- **Locked models**: Some models require paid plans

## Troubleshooting

- **403 free_mode_invalid_agent_model**: Server rejected the agent/model pair. Try updating the plugin.
- **410 session_expired**: Session ended. The plugin will request a new one.
- **429 rate limits**: Out of daily hours or hit per-model rate limits.
- **Device key errors**: Delete `device-key.json` from the plugin's config directory and retry.

## License

MIT
