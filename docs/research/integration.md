# Research: Integrating the pi stack inside Obsidian

The crossing point of the two research tracks: what changes when pi's ESM-only,
Node-first packages run inside Obsidian's Electron renderer as a CJS plugin bundle.
All of this is validated by our build (`npm run build` passes).

## 1. Module systems

- pi packages are **ESM-only** (`"type": "module"`, `exports` with `import` only;
  `require()` of them fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` — verified).
- Obsidian loads plugin `main.js` through **CommonJS `require()`**.
- Bridge: esbuild bundles the ESM graph and emits **`format: "cjs"`**. This works
  (1.86 MB minified output, verified) **provided no top-level await** reaches the
  output — `pi-ai` and `pi-agent-core` are TLA-free, which is exactly why we skip
  `pi-coding-agent` (its dist *does* contain TLA in `core/*.js`).
- `import.meta` count in the two packages' dists is non-zero; esbuild shims it fine
  in cjs output, but if a future version breaks the build, that's the first suspect.

## 2. Runtime environment

Obsidian desktop = Electron renderer **with Node integration** (plugins `require()`
node builtins all the time). Our esbuild config keeps `...builtinModules` external, so:

- `node:fs/promises` (auth file read), `node:os`, `node:path` → provided by Electron.
- `process.env` → available (needed by `defaultProviderAuthContext()` for env API keys).
- `manifest.isDesktopOnly: true` is therefore mandatory — mobile has no Node.
- Engine note: `pi-agent-core` declares `engines.node >= 22.19`. That's advisory at
  runtime (npm engine-strict is off), but target **recent Obsidian** (Electron ≥ 36
  ships Node ≥ 22). If older Obsidian support is needed, test early — modern JS
  features in pi deps are the risk.

## 3. Bundle size

- Production `main.js`: **~1.9 MB minified** (pi-ai includes SDK clients for ~40
  providers; the AWS/Google/OpenAI SDKs dominate). Acceptable for an Obsidian plugin.
- If it ever matters: most providers are behind `./api/*.lazy` wrappers, so a follow-up
  could externalize + lazy-load rare providers. Not worth it at 1.9 MB.

## 4. Auth strategy

Ob Pi is a **passive consumer** of pi credentials:

```
~/.pi/agent/auth.json   ← owned by the pi CLI (pi /login)
        ↑ read-only, via our PiAuthStore (src/agent/auth.ts)
pi-ai Models (builtinModels({ credentials, authContext }))
        ↑ env-var fallback handled by ProviderAuth envVars + process.env
Ob Pi
```

- We implement `CredentialStore` (read/list/modify/delete); writes throw — the file
  stays CLI-owned, avoiding concurrent-writer problems (the CLI uses file locking).
- `auth.json` format (verified): `{ "<providerId>": { "type": "api_key", "key": "…" } }`
  (or OAuth credential objects with refresh fields; read works the same).
- No-credentials UX: `getAvailable()` returns `[]` → `PiChatAgent.create` throws a
  clear message surfaced via `Notice` + chat status line.

## 5. Tools: vault, not filesystem

pi's builtin read/bash tools act on a raw cwd — wrong and dangerous for a vault app
(the vault *is* on disk, but the agent should see notes, not run shell). Instead:

```
Obsidian Vault API ──<VaultBridge interface>── createVaultTools() ── AgentTool[]
     (src/main.ts)              (src/agent/tools.ts)
```

- `VaultBridge` (listNotePaths / readNote / resolvePath) is plain TS — the agent layer
  never imports `obsidian`, keeping it testable and portable.
- Tools are enabled/disabled at runtime by reassigning `agent.state.tools`.
- `execute` throws on failure; results are text blocks with hard size caps
  (context-window hygiene done by us, not the SDK).

## 6. UI event flow

```
Agent.prompt() ──▶ AgentEvent stream ──▶ ChatUI.onAgentEvent()
   │                                        │ user turn: "❯ text" plain
   │                                        │ streaming: textContent updates (cheap)
   │                                        │ message_end: MarkdownRenderer.render()
   │                                        └ tool lines: dim "· toolName…"
   └ resolves when run settles (incl. awaited agent_end listeners)
```

No re-render loops: transcript is append-only; the single streaming element is mutated
in place and upgraded to markdown once.

## 7. Alternatives considered (and why not)

| Option | Verdict |
|---|---|
| Bundle full `pi-coding-agent` | 19 MB, TLA breaks cjs output, jiti/TUI pointless here. ❌ |
| Spawn `pi --mode rpc` subprocess (JSON-RPC) | Clean isolation, works without bundling pi at all; but requires pi installed on user's machine, breaks desktop-only guarantee, and complicates streaming auth. Revisit if we ever want the *coding* agent inside a vault. Deferred. |
| `pi-client` (remote CBOR sessions) | For talking to a *remote* pi server — interesting future "connect to your own agent" feature. Not now. |
| Raw fetch + OpenAI SDK | Reinvents model catalog/auth across 40 providers — the whole reason pi-ai exists. ❌ |

## 8. Known sharp edges

1. **TLA discipline**: never add a dep with top-level await to the plugin bundle;
   the esbuild cjs build will fail loudly (good).
2. **Two `ThinkingLevel` types** (pi-ai vs pi-agent-core, the latter includes `"off"`).
3. **Dynamic model catalogs**: builtin static catalogs need no network; custom
   `models.json` catalogs are a pi-CLI concept — `builtinModels()` doesn't load them.
   If needed later, parse `~/.pi/agent/models.json` ourselves and `setProvider()`.
4. **Obsidian internals**: never import from `obsidian-mobile` or use undocumented
   internals; stick to `obsidian` d.ts.
