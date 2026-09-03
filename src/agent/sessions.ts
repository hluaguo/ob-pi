/**
 * Chat session persistence — pi's way, linear mode.
 *
 * pi persists every completed message to an append-only JSONL file
 * (`AgentSession._handleAgentEvent` → `sessionManager.appendMessage`). pi's
 * entries carry `id`/`parentId` for in-place tree branching; Ob Pi doesn't
 * branch, so entries are purely linear — same shape, no tree fields:
 *
 *   {"type":"session","version":1,"id":"…","created":"…","model":"…"}
 *   {"type":"message","timestamp":"…","message":{…AgentMessage…}}
 *
 * Files live in the vault under `.ob-pi/sessions/<id>.jsonl` (vault-native:
 * synced, inspectable, portable) instead of ~/.pi/agent/sessions (cwd-based).
 * Restoring a session sets `agent.state.messages` directly — the Agent is
 * stateless about persistence, exactly like pi's split of AgentSession/TUI.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";

/** Vault-adapter surface the persistor needs (obsidian-free). */
export interface SessionFileBridge {
	appendLine(path: string, line: string): Promise<void>;
	readFile(path: string): Promise<string | null>;
	listSessionPaths(): Promise<string[]>;
}

export interface SessionHeader {
	type: "session";
	version: 1;
	id: string;
	created: string;
	model?: string;
}

export interface SessionMessageEntry {
	type: "message";
	timestamp: string;
	message: AgentMessage;
}

export type SessionEntry = SessionHeader | SessionMessageEntry;

let counter = 0;
export function newSessionId(): string {
	const date = new Date();
	const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
	return `${stamp}-${(counter++).toString(36)}`;
}

/** Roles that participate in the LLM context (same set pi persists). */
export function isPersistableRole(role: string): boolean {
	return role === "user" || role === "assistant" || role === "toolResult";
}

export class ChatSessionPersistor {
	private bridge: SessionFileBridge;
	private path: string | null = null;
	/** Serialize appends; entries must land in conversation order. */
	private queue: Promise<void> = Promise.resolve();

	constructor(bridge: SessionFileBridge) {
		this.bridge = bridge;
	}

	get sessionPath(): string | null {
		return this.path;
	}

	async newSession(model?: string): Promise<void> {
		this.path = `${SessionFileBridgePaths.dir}/${newSessionId()}.jsonl`;
		const header: SessionHeader = {
			type: "session",
			version: 1,
			id: this.path,
			created: new Date().toISOString(),
			model,
		};
		const previous = this.queue;
		this.queue = previous.then(() => this.bridge.appendLine(this.path!, JSON.stringify(header)));
		await this.queue;
	}

	/** Fire-and-forget append, order-preserving (pi persists on message_end). */
	appendMessage(message: AgentMessage): void {
		if (!this.path || !isPersistableRole(message.role)) return;
		const entry: SessionMessageEntry = {
			type: "message",
			timestamp: new Date().toISOString(),
			message,
		};
		this.queue = this.queue
			.then(() => this.bridge.appendLine(this.path!, JSON.stringify(entry)))
			.catch((error) => console.error("[ob-pi] session append failed:", error));
	}

	/** Most recent session with its messages, or null when none exist. */
	async loadLatest(): Promise<{ path: string; messages: AgentMessage[] } | null> {
		const paths = (await this.bridge.listSessionPaths()).sort(); // name = timestamp: last is newest
		for (let i = paths.length - 1; i >= 0; i--) {
			const raw = await this.bridge.readFile(paths[i]);
			if (raw === null) continue;
			const messages = parseSessionFile(raw);
			if (messages.length > 0) {
				this.path = paths[i];
				return { path: paths[i], messages };
			}
		}
		return null;
	}
}

export function parseSessionFile(raw: string): AgentMessage[] {
	const messages: AgentMessage[] = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		try {
			const entry = JSON.parse(line) as SessionEntry;
			if (entry.type === "message" && isPersistableRole(entry.message.role)) {
				messages.push(entry.message);
			}
		} catch {
			// Torn last line (crash mid-append): pi keeps the file readable; skip.
		}
	}
	return messages;
}

/** Path helpers live outside the bridge so main.ts can stay thin. */
export const SessionFileBridgePaths = {
	dir: ".ob-pi/sessions",
};
