# Research: sessions (persistence) and skills/memory ("grow itself")

> Design decisions + verified shapes from `@earendil-works/pi-agent-core` 0.84.4.

## Sessions — pi's way, linear mode

**How pi does it** (`pi-coding-agent`): `AgentSession._handleAgentEvent` listens for
`message_end` and appends every completed message to a `SessionManager`-backed JSONL
file (user/assistant/toolResult via `appendMessage`, extension payloads via
`appendCustomMessageEntry`). Entries carry `id`/`parentId` for in-place tree
branching (`/tree`, fork). Compaction summarizes context but the full history stays
in the file.

**Ob Pi** keeps the mechanism, drops the tree (no branching UI):

```
{"type":"session","version":1,"id":"…","created":"…","model":"…"}   ← header line
{"type":"message","timestamp":"…","message":{…AgentMessage…}}       ← one per message_end
```

- Stored **vault-native** under `.ob-pi/sessions/<ts-id>.jsonl` (synced, inspectable,
  portable) instead of `~/.pi/agent/sessions` (cwd-based, CLI-owned).
- Same persist point: the store's `message_end` handler calls
  `persistor.appendMessage()` — order preserved via a promise queue; torn last lines
  (crash mid-append) are skipped on read. Verified by test.
- Restore = set `agent.state.messages = parsed[]` (Agent is persistence-agnostic,
  exactly pi's AgentSession/TUI split) + `store.hydrate()` for the UI. Tool statuses
  rebuild from `toolResult` messages (`toolCallId` → `isError`).
- On startup we behave like `pi -c`: continue the most recent non-empty session.
  `/new` starts a fresh file. Session switching/branching = future work (would adopt
  pi's `id`/`parentId` fields if ever needed).

Why not `pi-agent-core`'s `JsonlSessionRepo`: the v4 lane-based `Session`/`SessionRepo`
APIs require implementing their `FileSystem` abstraction and manage ~/.pi-style
layouts — more surface than a 100-line linear writer for a no-branch vault store.
Revisit if session branching lands.

## Skills + memory — the "grow itself" loop

pi grows via extensions (`.pi/extensions/*.ts`, jiti), skills (`SKILL.md` folders),
and context files (`AGENTS.md`). Code execution in a vault app is out of scope;
instructions are not. So Ob Pi ports the **instruction layer** to the vault:

```
.ob-pi/MEMORY.md          freeform memory, injected verbatim into the system prompt
.ob-pi/skills/<name>.md   frontmatter (name, description) + markdown instructions
```

- System prompt composition (pi-format): base prompt + `# Memory` block + the
  `<available_skills>` index (name + description only — progressive disclosure).
- Tools close the loop: `skill_read` (load on demand), `skill_write` (create/update),
  `memory_write` (replace/append). After any write, `refreshSystemPrompt()` updates
  `agent.state.systemPrompt` — the next turn sees the new self.
- The `MemoryBridge` interface keeps `src/agent/` obsidian-free (same pattern as
  `VaultBridge`); implemented in `main.ts` over `vault.create/modify/cachedRead`.
- Skill names validate `[a-z0-9][a-z0-9-]*` (they become file names).
- Verified shapes: pi's `Skill` = `{ name, description, content, filePath }`;
  `formatSkillsForSystemPrompt` emits the `<available_skills>` XML block we mirror.

## In-UI control (the non-TUI part)

Since there's no terminal, pi's `/commands` become first-class UI:

- **Slash menu**: assistant-ui composer trigger popover (`char="/"`,
  `unstable_useSlashCommandAdapter` — `commands: {id,label,description,execute}`,
  items render via `Unstable_TriggerPopoverItems`, selection via `.Action onExecute`).
  Typed `/x` inputs are also intercepted in `onNew` if the popover was bypassed.
- Commands: `/help`, `/new`, `/model [query]`, `/thinking [level]`, `/skills`,
  `/memory` (opens the note in a tab when it exists).
- **Model quick-switcher**: header label opens a filterable picker (fuzzy-ish
  substring), `Enter` picks the top hit; selection persists to settings and calls
  `agent.setModel`.
- Command feedback renders as dim `system`-role lines in the transcript (assistant-ui
  `SystemMessage` component) — never sent to the model, matching pi's custom-message
  spirit without polluting LLM context.
