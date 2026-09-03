# Research: `@earendil-works/pi-agent-core` API (v0.84.4)

> Verified against `dist/*.d.ts` of the installed package. This is the layer that makes
> Ob Pi a real agent (tools, multi-turn, steering), not just a chat completion wrapper.

## Agent — stateful wrapper around the loop

```ts
import { Agent } from "@earendil-works/pi-agent-core";

const agent = new Agent({
  streamFn: (model, context, options) => models.stream(model, context, options), // required
  initialState: { model, systemPrompt, thinkingLevel, tools },   // Partial<AgentState>
  // optional, all verified in dist/agent.d.ts:
  convertToLlm?, transformContext?, getApiKey?, onPayload?, onResponse?,
  beforeToolCall?, afterToolCall?, shouldStopAfterTurn?,
  prepareNextTurn(WithContext)?, steeringMode?, followUpMode?,
  sessionId?, thinkingBudgets?, transport?, maxRetryDelayMs?, toolExecution?,
});
```

Key members (verified):

```ts
agent.subscribe(listener: (event: AgentEvent, signal: AbortSignal) => void | Promise<void>): () => void;
agent.state: AgentState;          // assign state.model / state.tools / state.messages
agent.prompt(input: string, images?): Promise<void>;   // resolves when run settles
agent.steer(message); agent.followUp(message);         // queue mid-run
agent.abort(): void; agent.waitForIdle(): Promise<void>;
agent.reset(): void;                                   // clears transcript + queues
agent.isStreaming (via state)
```

`AgentState`:

```ts
interface AgentState {
  systemPrompt: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;      // agent-core's own union: "off"|"minimal"|…|"max"
  tools: AgentTool<any>[];           // setter copies the array
  messages: AgentMessage[];          // setter copies the array
  readonly isStreaming: boolean;
  readonly streamingMessage?: AgentMessage;
  readonly pendingToolCalls: ReadonlySet<string>;
  readonly errorMessage?: string;
}
```

⚠️ Note: `ThinkingLevel` **exported by pi-agent-core** includes `"off"` and is a different
type from pi-ai's `ThinkingLevel` (`"minimal"`…`"max"`, no `"off"`). Import it from
`pi-agent-core` (this bit us once — see `src/settings.ts`).

## Events (what the UI subscribes to)

```ts
type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId; toolName; args }
  | { type: "tool_execution_update"; toolCallId; toolName; args; partialResult }
  | { type: "tool_execution_end"; toolCallId; toolName; result; isError };
```

Streaming text deltas arrive as `message_update` with
`assistantMessageEvent.type === "text_delta"` (or read `message.content` text blocks,
which accumulate — what Ob Pi does).

## Custom tools

```ts
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";

const tool: AgentTool<typeof schema> = {
  name: "vault_search",
  label: "Vault search",               // human-readable, for UI
  description: "…",
  parameters: Type.Object({ query: Type.String() }),
  async execute(toolCallId, params, signal?, onUpdate?) {
    return { content: [{ type: "text", text: "…" }], details: { /* any */ } };
  },
  executionMode?: "sequential" | "parallel",   // optional override
  prepareArguments?: (raw: unknown) => Static<typeof schema>,
};
```

- `execute` should **throw** on failure (the loop converts it to an error tool result).
- `params` is validated against the typebox schema before the call; type the tool with
  `AgentTool<typeof schema>` to get typed params (a bare `AgentTool<any>` gives `unknown`).
- Enable them by assigning `agent.state.tools = [tool]`.
- pi-coding-agent's `defineTool()` helper is just sugar for this — not needed.

## Low-level loop (for reference)

`agentLoop(prompts, context, config, signal, streamFn)` / `agentLoopContinue(...)` /
`runAgentLoop(...)` return `EventStream<AgentEvent, AgentMessage[]>`. The `Agent` class
wraps this with queues and lifecycle; plugins should use `Agent`, not the raw loop.

## What agent-core does NOT do

- No model/provider catalog, no auth (that's pi-ai — pass a `streamFn`).
- No sessions persistence, extensions, skills, prompt templates (that's pi-coding-agent).
- No built-in tools in the default state — tools are whatever you put in `state.tools`.
  (read/bash/edit/write implementations exist under `dist/harness/tools/` if you ever
  want raw-fs tools; Ob Pi intentionally doesn't use them.)
