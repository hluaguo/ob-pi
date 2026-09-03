/**
 * ChatUI — the minimal, Pi-idiom transcript + input, plain DOM.
 *
 * Pi idiom (see AGENTS.md): no bubbles, no chrome. One column of text.
 * User turns get a dim "❯" prompt character; assistant turns are plain
 * markdown; tool activity is a single dim line; everything else is silence.
 */
import { MarkdownRenderer, type App, type Component } from "obsidian";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";

export interface ChatUIOptions {
	app: App;
	component: Component;
	/** Shown in the status line while idle. */
	statusText: () => string;
	onSubmit: (text: string) => void;
	onAbort: () => void;
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
	const node = document.createElement(tag);
	if (cls) node.className = cls;
	if (text !== undefined) node.textContent = text;
	return node;
}

function textOf(content: AssistantMessage["content"]): string {
	return content
		.filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
		.map((block) => block.text)
		.join("");
}

export class ChatUI {
	readonly containerEl: HTMLElement;
	private readonly transcriptEl: HTMLElement;
	private readonly inputEl: HTMLTextAreaElement;
	private readonly statusEl: HTMLElement;
	private readonly options: ChatUIOptions;
	private activeToolLines = new Map<string, HTMLElement>();

	constructor(containerEl: HTMLElement, options: ChatUIOptions) {
		this.options = options;
		this.containerEl = containerEl;
		containerEl.empty();
		containerEl.addClass("ob-pi-chat");

		this.transcriptEl = el("div", "ob-pi-transcript");
		this.statusEl = el("div", "ob-pi-status", options.statusText());
		this.inputEl = document.createElement("textarea");
		this.inputEl.className = "ob-pi-input";
		this.inputEl.rows = 1;
		this.inputEl.placeholder = "Ask anything. Enter to send, Shift+Enter for a new line, Esc to stop.";

		containerEl.appendChild(this.transcriptEl);
		containerEl.appendChild(this.statusEl);
		containerEl.appendChild(this.inputEl);

		this.inputEl.addEventListener("keydown", (event) => {
			if (event.key === "Escape") {
				this.options.onAbort();
				return;
			}
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				this.submit();
			}
		});
		this.inputEl.addEventListener("input", () => this.autoGrow());
	}

	private autoGrow(): void {
		this.inputEl.style.height = "auto";
		this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, 240)}px`;
	}

	private submit(): void {
		const text = this.inputEl.value.trim();
		if (!text) return;
		this.inputEl.value = "";
		this.autoGrow();
		this.options.onSubmit(text);
	}

	focus(): void {
		this.inputEl.focus();
	}

	setStatus(text: string): void {
		this.statusEl.textContent = text;
		this.statusEl.toggleClass("is-streaming", text.endsWith("…"));
	}

	/** Entry point for the Agent event stream. Renders everything. */
	onAgentEvent(event: AgentEvent): void {
		switch (event.type) {
			case "agent_start":
				this.setStatus("thinking…");
				break;
			case "agent_end":
				this.activeToolLines.clear();
				this.setStatus(this.options.statusText());
				break;
			case "message_start":
				if ((event.message as UserMessage).role === "user") {
					this.renderUser(textOfUser(event.message as UserMessage));
				}
				break;
			case "message_update": {
				if (event.message.role !== "assistant") break;
				const text = textOf(event.message.content);
				this.streamAssistant(text);
				break;
			}
			case "message_end":
				if (event.message.role === "assistant") {
					this.renderAssistant(textOf(event.message.content));
				}
				break;
			case "tool_execution_start":
				this.renderToolLine(event.toolCallId, event.toolName);
				break;
			case "tool_execution_end": {
				const line = this.activeToolLines.get(event.toolCallId);
				if (line) {
					line.setText(`${event.isError ? "×" : "·"} ${event.toolName}`);
					this.activeToolLines.delete(event.toolCallId);
				}
				break;
			}
		}
		this.scrollToEnd();
	}

	private scrollToEnd(): void {
		this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
	}

	private renderUser(text: string): void {
		const turn = el("div", "ob-pi-turn ob-pi-user");
		turn.appendChild(el("span", "ob-pi-prompt", "❯"));
		const body = el("span", "ob-pi-user-text");
		body.setText(text);
		turn.appendChild(body);
		this.transcriptEl.appendChild(turn);
	}

	private streamingEl: HTMLElement | null = null;

	private streamAssistant(text: string): void {
		if (!this.streamingEl) {
			this.streamingEl = el("div", "ob-pi-turn ob-pi-assistant is-streaming");
			const body = el("div", "ob-pi-md");
			this.streamingEl.appendChild(body);
			this.transcriptEl.appendChild(this.streamingEl);
		}
		// Cheap plain-text while streaming; upgraded to markdown on message_end.
		const body = this.streamingEl.firstElementChild as HTMLElement;
		body.setText(text);
	}

	private renderAssistant(text: string): void {
		if (this.streamingEl) {
			const body = this.streamingEl.firstElementChild as HTMLElement;
			this.renderMarkdown(body, text);
			this.streamingEl.removeClass("is-streaming");
			this.streamingEl = null;
		} else if (text) {
			const turn = el("div", "ob-pi-turn ob-pi-assistant");
			turn.appendChild(el("div", "ob-pi-md"));
			this.transcriptEl.appendChild(turn);
			this.renderMarkdown(turn.firstElementChild as HTMLElement, text);
		}
	}

	private renderMarkdown(target: HTMLElement, markdown: string): void {
		target.empty();
		if (!markdown) return;
		void MarkdownRenderer.render(
			this.options.app,
			markdown,
			target,
			"", // no source path: internal links in chat output are not resolved
			this.options.component,
		);
	}

	private renderToolLine(toolCallId: string, toolName: string): void {
		const line = el("div", "ob-pi-turn ob-pi-tool", `· ${toolName}…`);
		this.activeToolLines.set(toolCallId, line);
		this.transcriptEl.appendChild(line);
	}

	clear(): void {
		this.transcriptEl.empty();
		this.streamingEl = null;
		this.activeToolLines.clear();
		this.setStatus(this.options.statusText());
	}
}

function textOfUser(message: UserMessage): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
		.map((block) => block.text)
		.join("");
}
