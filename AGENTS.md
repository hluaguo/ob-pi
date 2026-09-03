# AGENTS.md — Ob Pi

Minimal AI side chat for Obsidian, powered by the pi agent stack (`@earendil-works/pi-ai`
+ `@earendil-works/pi-agent-core`). Read `docs/research/` before changing architecture;
it documents every API this project relies on, verified against pi **0.84.4**.

## What this is

A right-sidebar chat view ("ItemView") in the style of the pi TUI: no bubbles, no
chrome — one column of text, a `❯` prompt, dim tool/status metadata, markdown answers.
The agent can search and read vault notes through small custom tools.

## Repository layout

```
src/
  main.ts          Obsidian harness: lifecycle, commands, ribbon, view registration,
                   settings persistence, VaultBridge implementation. Stays thin.
  view.tsx         PiChatView (ItemView) — owns the leaf, mounts the React app.
  settings.ts      ObPiSettings interface, defaults, PluginSettingTab.
  ui/
    store.ts       ObChatStore: framework-free transcript store; the single
                   subscriber to AgentEvents (useSyncExternalStore-compatible).
    ChatApp.tsx    React app: assistant-ui primitives in Pi idiom; markdown via
                   Obsidian MarkdownRenderer inside the Text part component.
  agent/
    client.ts      PiChatAgent: builtinModels() + Agent wiring, model/system-prompt/
                   tool setters. The only place both worlds meet.
    auth.ts        PiAuthStore: read-only CredentialStore over ~/.pi/agent/auth.json.
    tools.ts       createVaultTools(): vault_search / vault_read behind VaultBridge.
    skills.ts      Vault skills + memory (self-growth tools, system-prompt composition).
    sessions.ts    ChatSessionPersistor: pi-format linear JSONL under .ob-pi/sessions/.
docs/research/     Verified API research: pi packages, pi-ai, pi-agent-core,
                   assistant-ui, Obsidian plugin API, sessions/skills, integration.
esbuild.config.mjs ESM sources → CJS main.js (see "Build" below).
manifest.json      Plugin manifest (isDesktopOnly: true — required, we use Node APIs).
styles.css         Only theme CSS variables; no hard-coded colors.
```

## Commands

```
npm run dev         esbuild watch → dist/main.js (+ copies manifest/versions/styles)
npm run build       tsc -noEmit && esbuild production → dist/
npm run typecheck   tsc -noEmit
```

Install into a vault for testing: copy `dist/*` to
`<vault>/.obsidian/plugins/ob-pi/`, enable "Ob Pi" in Community plugins.
`manifest.json` must stay at repo root; the build copies it to `dist/`.

## Hard constraints

1. **Entry point is `src/main.ts`, bundled to `main.js` (CJS).** Obsidian `require()`s
   it. Never change `format: "cjs"` or add dependencies using **top-level await** —
   the build will fail, and that failure is load-bearing.
2. **Only these pi packages**: `@earendil-works/pi-ai` and
   `@earendil-works/pi-agent-core`. Never add `pi-coding-agent` (19 MB, TLA, TUI,
   jiti — see docs/research/pi-sdk-packages.md).
3. **`external` list in esbuild is sacred**: `obsidian`, `electron`, `@codemirror/*`,
   `@lezer/*`, node builtins. Everything else bundles.
4. **`src/agent/` must not import `obsidian`.** Vault access flows through the
   `VaultBridge` interface (implemented in `main.ts`). Keeps the agent layer
   testable and the layering clean.
5. **Desktop only.** Node builtins (`fs/promises`, `os`, `path`) and `process.env`
   are fine; anything else mobile-unsafe needs `isDesktopOnly` anyway.
6. **Read-only credentials.** `PiAuthStore` may read `~/.pi/agent/auth.json` but never
   writes it — the file is owned by the pi CLI.
7. **UI stack**: React 19 + `@assistant-ui/react` unstyled primitives (see
   docs/research/assistant-ui.md). Do not add `@assistant-ui/react-markdown` —
   text parts render through Obsidian's `MarkdownRenderer`. Do not create message
   components inline in JSX props (remounts kill streaming performance); pass
   `app`/`component` via `ObsidianContext`.
8. **Store layering**: `ObChatStore` (src/ui/store.ts) is the single subscriber to
   agent events and imports neither react nor obsidian. Components read snapshots
   via `useSyncExternalStore` — never hold agent references in components.
9. **Vault data lives in `.ob-pi/`** (hidden folder): skills, memory, sessions.
   The agent may write there via its tools; nothing else writes to the vault.
10. **Sessions are linear**: pi-format JSONL without `id`/`parentId`. Restore sets
   `agent.state.messages`; UI restore goes through `store.hydrate()` (never
   re-persists). Persist only on `message_end`, only user/assistant/toolResult.

## pi idiom (UI rules)

- No bubbles, no avatars, no timestamps. Turns are typographic, not boxed.
- User turns: accent `❯` + plain text. Assistant turns: plain markdown.
- Tool activity: one dim monospace line (`· vault_read…` → `· vault_read`).
- Status line: dim monospace (`provider/model`), accent while streaming.
- Colors/fonts only via Obsidian CSS variables (`--text-faint`, `--font-monospace`, …).
- Silence is a feature: no toasts for things the transcript already shows; `Notice`
  only for errors the user must act on.

## Conventions

- TypeScript strict; target ES2022; `verbatimModuleSyntax` — use `import type`.
- Tabs, matching Obsidian sample-plugin style.
- Public APIs of the pi stack change quickly (0.x): when upgrading versions, re-read
  `node_modules/@earendil-works/*/dist/*.d.ts` and diff against docs/research/.
- `ThinkingLevel` (with `"off"`) comes from **pi-agent-core**, not pi-ai.

## Architecture in one paragraph

`PiChatAgent.create()` builds `builtinModels()` (all builtin providers, auth from the
pi CLI's auth.json or env vars), picks the first available or configured model, and
constructs `new Agent({ streamFn: models.stream, initialState: { model, systemPrompt,
thinkingLevel, tools } })` with vault tools, plus skill/memory tools whose writes
recompose the system prompt. `ObChatStore` subscribes to agent events, keeps a
snapshot, and persists completed messages to `.ob-pi/sessions/*.jsonl` (pi format,
linear); on startup the latest session restores into `agent.state.messages`. The
React view converts snapshots into assistant-ui's runtime (`onNew` → `store.send` →
`agent.prompt()`, which resolves when the run settles). Slash commands and the model
picker mutate settings/agent live.

## Ideas backlog

- Session persistence (serialize `agent.state.messages` to a note or data.json;
  or adopt `pi-agent-core`'s harness session utilities).
- "Chat about this note": inject active file on `file-open`.
- Steering UI (`agent.steer()` while streaming).
- Custom `models.json` provider loading via `models.setProvider()`.
- Insert-last-response command writing back into the active note.
