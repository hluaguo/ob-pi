# Research: assistant-ui (React chat primitives)

> Verified against `@assistant-ui/react` **0.15.17** (React 18/19) via Context7 docs
> and installed package types. Added 0.15.x to Ob Pi on 2025-09-03.

## What it is

Headless ("primitives") + styled React components for chat UX: thread management,
streaming state, composer (input/send/stop), auto-scroll viewport, markdown parts,
tool-call rendering. We use **unstyled primitives only** and style them in Pi idiom.

## Why it fits Ob Pi

- The hard parts we would otherwise hand-roll are solved for free:
  **auto-scroll viewport** (pin-to-bottom while streaming, respects user scroll-up),
  composer with Enter-to-send + Shift+Enter newline, running/idle button states,
  message list keyed by id.
- `useExternalStoreRuntime` connects **any** backend — pi-agent-core in our case.
  We never touch their model/streaming layer.

## Packages

| Package | Used for |
|---|---|
| `react`, `react-dom` (19.x) | runtime |
| `@assistant-ui/react` (0.15.17) | primitives + external store runtime |
| ~~`@assistant-ui/react-markdown`~~ | **not used** — we render text parts with Obsidian's `MarkdownRenderer` instead (keeps remark/mdast out of the bundle, native vault rendering) |

Transitive deps (radix-ui, zustand, zod, react-textarea-autosize) are bundled;
bundle went 1.8 MB → 2.7 MB minified.

## The external-store adapter (our integration point)

```tsx
const converted = useExternalMessageConverter({
  callback: (ob: ObMessage): ThreadMessageLike => ({ role, content, id }),
  messages,          // our store's array (stable identity per change)
  isRunning,
  joinStrategy: "concat-content",
});

const runtime = useExternalStoreRuntime({
  messages: converted,          // ThreadMessageLike[]
  isRunning,                    // gates composer + shows running state
  onNew: async (appendMessage) => { /* extract text → agent.prompt() */ },
  onCancel: async () => agent.stop(),
});

<AssistantRuntimeProvider runtime={runtime}>…primitives…</AssistantRuntimeProvider>
```

`ThreadMessageLike` content parts we use: `{ type: "text", text }` and
`{ type: "tool-call", toolCallId, toolName, argsText, args, result?, isError? }`.
A tool-call with `result === undefined` renders as "running".

## Primitives we use

```
ThreadPrimitive.Root            layout container
ThreadPrimitive.Viewport        auto-scroll transcript (autoScroll prop)
ThreadPrimitive.Empty           empty-state hint
ThreadPrimitive.Messages        maps messages → { UserMessage, AssistantMessage }
MessagePrimitive.Root           per-message wrapper
MessagePrimitive.Parts          renders content parts via components config:
                                  { Text, tools: { Fallback } }
ComposerPrimitive.Root/Input/Send/Cancel
ThreadPrimitive.If running={bool}   conditional render (send ↔ stop button)
```

## Sharp edges learned

1. **Don't create message components inline** (`AssistantMessage: () => <…/>`) — new
   component identity per render = full remount = markdown re-render on every delta.
   Pass `app`/`component` through React context instead (done, `ObsidianContext`).
2. `ThreadPrimitive.Viewport autoScroll` is **boolean** (not a string mode).
3. `ThreadMessageLike["content"]` is **readonly** — build a mutable local array with an
   explicit union type, then return it.
4. Text components receive the part as props (`{ text }`), not children.
5. Memoize the markdown component (`memo` + `text` dep) so streaming re-renders only
   touch the growing message.

## Layering (unchanged principle)

```
PiChatAgent (pi events) → ObChatStore (plain TS, subscribable snapshot)
                              → useSyncExternalStore → useExternalMessageConverter
                              → useExternalStoreRuntime → primitives → DOM
```

`ObChatStore` imports no react/obsidian; `ChatApp.tsx` imports no pi packages.
Only `MarkdownRenderer` reaches into Obsidian, from the text-part component.
