# Research: The pi monorepo — which packages to use

> Verified against `@earendil-works/*` version **0.84.4** (all packages versioned in lockstep).

The pi stack is a monorepo published as several npm packages. The full CLI package
`@earendil-works/pi-coding-agent` (19 MB unpacked) *contains* the others and is what
`pi` runs from. For an Obsidian plugin we deliberately depend on the **lower layers only**.

## Layer map (bottom → top)

| Package | What it is | Key deps | Use in Ob Pi |
|---|---|---|---|
| `@earendil-works/pi-protocol` | Transport-neutral CBOR protocol for remote pi sessions | typebox | not needed |
| `@earendil-works/pi-ai` | **Unified LLM API**: model catalogs, provider streaming, auth/credentials | openai, @anthropic-ai/sdk, @google/genai, @aws-sdk/client-bedrock-runtime, proxy agents | ✅ core |
| `@earendil-works/pi-agent-core` | **The agent loop**: `Agent` class, tools, steering/follow-up queues, compaction helpers | diff, yaml, ignore, typebox, pi-ai | ✅ core |
| `@earendil-works/pi-client` | Client for remote pi sessions (framed CBOR) | pi-protocol | optional alternative |
| `@earendil-works/pi-tui` | Terminal UI components | — | not needed |
| `@earendil-works/pi-coding-agent` | Full CLI/SDK: coding tools (read/bash/edit/write), extensions (jiti), sessions, TUI modes | heavy (cross-spawn, proper-lockfile, undici, jiti…) | ❌ never bundle |

## Why not `pi-coding-agent`

- 19 MB dist, pulls ~100 transitive deps incl. the TUI, jiti extension loader, coding tools.
- Its dist contains **top-level await** (incompatible with esbuild `format: cjs`, which
  Obsidian's plugin loader effectively requires).
- Its built-in tools act on a raw filesystem cwd — wrong abstraction for a vault app;
  we register our own tools over Obsidian's Vault API instead (see `src/agent/tools.ts`).

## Subpath exports that matter

`pi-ai` package.json `exports`:

```
"."               → dist/index.js        (types, Context, auth, models runtime, utils)
"./compat"        → legacy global API (stream/complete/getModel — deprecated)
"./providers/*"   → e.g. "./providers/all"  ← builtinProviders()/builtinModels()
"./api/*"         → per-provider stream implementations (lazy)
```

`pi-agent-core` exports: `"."` (Agent, agentLoop, types), `"./node"`, `"./session/testing"`.

## Decision

```
ob-pi  →  @earendil-works/pi-agent-core (loop, tools, events)
              └── @earendil-works/pi-ai (models, providers, auth, streaming)
```

Anything the CLI does above that layer (extensions, skills, TUI, coding tools,
session files) is either re-implemented thin (vault tools) or out of scope.
