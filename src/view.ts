/**
 * PiChatView — the right-sidebar ItemView hosting the chat.
 */
import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type ObPiPlugin from "./main";
import { ChatUI } from "./ui/chat";

export const VIEW_TYPE_OB_PI = "ob-pi-chat";

export class PiChatView extends ItemView {
	private readonly plugin: ObPiPlugin;
	private chat: ChatUI | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ObPiPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_OB_PI;
	}

	getDisplayText(): string {
		return "Ob Pi";
	}

	getIcon(): string {
		return "message-square";
	}

	async onOpen(): Promise<void> {
		this.chat = new ChatUI(this.contentEl, {
			app: this.app,
			component: this,
			statusText: () => this.plugin.statusText(),
			onSubmit: (text) => void this.plugin.send(text),
			onAbort: () => this.plugin.stop(),
		});
		this.chat.focus();
	}

	async onClose(): Promise<void> {
		this.chat = null;
		this.contentEl.empty();
	}

	getChat(): ChatUI | null {
		return this.chat;
	}

	notify(event: string): void {
		new Notice(`Ob Pi: ${event}`);
	}
}
