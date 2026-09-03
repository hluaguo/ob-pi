/**
 * ObChatStore — the bridge between pi's AgentEvent stream and any UI.
 *
 * Framework-free on purpose: React/assistant-ui read it via useSyncExternalStore,
 * but it imports nothing from obsidian or react. The agent layer (src/agent/)
 * stays UI-agnostic; this is the single subscriber to agent events and the
 * owner of the transcript the UI renders.
 */
import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { PiChatAgent } from "../agent/client";
import type { ChatSessionPersistor } from "../agent/sessions";

export type ToolStatus = "running" | "done" | "error";

export type ObPart =
	| { type: "tool"; toolCallId: string; toolName: string; status: ToolStatus };

export interface ObMessage {
	id: string;
	role: "user" | "assistant";
	/** "meta" = local UI feedback (command output), never sent to the model. */
	kind: "chat" | "meta";
	/** Assistant text, recomputed from the agent's content blocks on every update. */
	text: string;
	/** Tool calls, in execution order (rendered after the text block). */
	tools: ObPart[];
}

export interface ObChatSnapshot {
	messages: readonly ObMessage[];
	isRunning: boolean;
	statusText: string;
}

let idCounter = 0;
const nextId = () => `ob-${Date.now().toString(36)}-${idCounter++}`;

export class ObChatStore {
	private agent: PiChatAgent | null = null;
	private persistor: ChatSessionPersistor | null = null;
	private messages: ObMessage[] = [];
	private running = false;
	private status = "";
	private listeners = new Set<() => void>();
	private snapshot: ObChatSnapshot = { messages: this.messages, isRunning: false, statusText: "" };
	/** Id of the assistant message currently being streamed, if any. */
	private currentAssistantId: string | null = null;

	/** Wire to a (lazily created) agent; the store owns the single subscription. */
	attach(agent: PiChatAgent, persistor?: ChatSessionPersistor): void {
		this.agent = agent;
		if (persistor) this.persistor = persistor;
		agent.subscribe((event) => this.onAgentEvent(event));
		this.emit();
	}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	getSnapshot = (): ObChatSnapshot => this.snapshot;

	setStatus(text: string): void {
		if (this.status === text) return;
		this.status = text;
		this.emit();
	}

	async send(text: string): Promise<void> {
		const agent = this.agent;
		if (!agent) throw new Error(this.status || "Agent unavailable");
		if (agent.isStreaming) throw new Error("Still generating — stop it first");
		this.push({ id: nextId(), role: "user", kind: "chat", text, tools: [] });
		await agent.prompt(text);
	}

	/** Local UI feedback (command output). Rendered dim, never sent to the model. */
	meta(text: string): void {
		this.push({ id: nextId(), role: "assistant", kind: "meta", text, tools: [] });
		this.emit();
	}

	/** True if the input is a slash command (never sent to the model). */
	isCommand(text: string): boolean {
		return /^\/\w+/.test(text.trim());
	}

	stop(): void {
		this.agent?.stop();
	}

	/** New conversation: clears transcript and agent state. */
	reset(): void {
		this.agent?.reset();
		this.currentAssistantId = null;
		this.messages = [];
		this.running = false;
		this.emit();
	}

	// ------------------------------------------------------------------
	// Agent event → store state

	/** Rebuild UI messages from a restored transcript (no re-persistence). */
	hydrate(messages: readonly AgentMessage[]): void {
		this.messages = [];
		this.currentAssistantId = null;
		const resultStatus = new Map<string, "done" | "error">();
		for (const message of messages) {
			if (message.role === "user") {
				this.push({ id: nextId(), role: "user", kind: "chat", text: textOfUser(message), tools: [] });
			} else if (message.role === "assistant") {
				const tools = (message.content as Array<{ type: string; id?: string; name?: string }>)
					.filter((block) => block.type === "toolCall")
					.map((block) => ({
						type: "tool" as const,
						toolCallId: block.id ?? nextId(),
						toolName: block.name ?? "tool",
						status: resultStatus.get(block.id ?? "") ?? ("done" as const),
					}));
				this.push({
					id: nextId(),
					role: "assistant",
					kind: "chat",
					text: textOfAssistant(message),
					tools,
				});
			} else if (message.role === "toolResult") {
				const result = message as { toolCallId?: string; isError?: boolean };
				resultStatus.set(result.toolCallId ?? "", result.isError ? "error" : "done");
			}
		}
		this.emit();
	}

	private onAgentEvent(event: AgentEvent): void {
		switch (event.type) {
			case "agent_start":
				this.running = true;
				break;
			case "agent_end":
				this.running = false;
				this.currentAssistantId = null;
				break;
			case "message_start":
				if (event.message.role === "assistant") this.ensureAssistant();
				break;
			case "message_update":
				if (event.message.role === "assistant") {
					const target = this.ensureAssistant();
					target.text = textOfAssistant(event.message);
				}
				break;
			case "message_end":
				// pi persists here: every completed message lands in the session file.
				this.persistor?.appendMessage(event.message);
				if (event.message.role === "assistant") {
					const target = this.ensureAssistant();
					target.text = textOfAssistant(event.message);
				}
				break;
			case "tool_execution_start": {
				const target = this.ensureAssistant();
				target.tools.push({
					type: "tool",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					status: "running",
				});
				break;
			}
			case "tool_execution_end": {
				const target = this.currentAssistant() ?? this.ensureAssistant();
				const tool = target.tools.find((t) => t.toolCallId === event.toolCallId);
				if (tool) tool.status = event.isError ? "error" : "done";
				break;
			}
		}
		this.emit();
	}

	private currentAssistant(): ObMessage | undefined {
		if (!this.currentAssistantId) return undefined;
		return this.messages.find((m) => m.id === this.currentAssistantId);
	}

	private ensureAssistant(): ObMessage {
		const existing = this.currentAssistant();
		if (existing) return existing;
		const created: ObMessage = { id: nextId(), role: "assistant", kind: "chat", text: "", tools: [] };
		this.currentAssistantId = created.id;
		this.push(created);
		return created;
	}

	private push(message: ObMessage): void {
		this.messages = [...this.messages, message];
	}

	private emit(): void {
		this.snapshot = { messages: this.messages, isRunning: this.running, statusText: this.status };
		for (const listener of this.listeners) listener();
	}
}

function textOfAssistant(message: {
	content: ReadonlyArray<{ type: string; text?: string }>;
}): string {
	return message.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("");
}

function textOfUser(message: { content: string | ReadonlyArray<{ type: string; text?: string }> }): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("");
}
