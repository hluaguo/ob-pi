# Ob Pi

Minimal AI side chat for [Obsidian](https://obsidian.md), powered by the
[pi](https://github.com/badlogic/pi-mono) agent stack — the same provider layer the
`pi` CLI uses, embedded in your vault.

```
❯ summarize my meeting notes from yesterday
· vault_search meeting
· vault_read meetings/2025-09-02.md
Here's what you agreed…
```

## Style

Pi-idiom minimal: no bubbles, no chrome. One column, a `❯` for your words, dim
metadata lines for tool calls, markdown for answers. Your theme's fonts and colors.

## Features

- Right-sidebar chat view (ribbon icon or command palette → "Ob Pi: Open chat")
- Streaming markdown responses
- All builtin pi providers — credentials from the pi CLI (`~/.pi/agent/auth.json`)
  or environment variables, never re-entered
- Vault tools the agent can use: `vault_search`, `vault_read`
- Model picker, system prompt, thinking level, tools toggle in settings
- Esc aborts generation; "New conversation" resets

## Requirements

- Obsidian desktop (recent build — Electron with Node ≥ 22 recommended)
- A pi credential: either run `pi` once and log in, or export a provider API key
  (e.g. `ANTHROPIC_API_KEY`) into the environment Obsidian starts from

## Build

```bash
npm install
npm run build     # → dist/ (main.js, manifest.json, styles.css)
npm run dev       # watch mode
```

Copy `dist/*` to `<vault>/.obsidian/plugins/ob-pi/` and enable the plugin.

## Docs

- [AGENTS.md](AGENTS.md) — project guide for humans and agents
- [docs/research/](docs/research/) — verified API research:
  - [pi-sdk-packages.md](docs/research/pi-sdk-packages.md) — which pi layers we use and why
  - [pi-ai-api.md](docs/research/pi-ai-api.md) — models, providers, auth
  - [pi-agent-core-api.md](docs/research/pi-agent-core-api.md) — Agent loop, tools, events
  - [obsidian-plugin-api.md](docs/research/obsidian-plugin-api.md) — views, settings, markdown
  - [integration.md](docs/research/integration.md) — ESM→CJS, Electron renderer, strategy

## License

MIT
