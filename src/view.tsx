/**
 * PiChatView — the right-sidebar ItemView hosting the React chat app.
 */
import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import type ObPiPlugin from "./main";
import { ChatApp } from "./ui/ChatApp";

export const VIEW_TYPE_OB_PI = "ob-pi-chat";

export class PiChatView extends ItemView {
	private readonly plugin: ObPiPlugin;
	private reactRoot: Root | null = null;

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
		this.contentEl.empty();
		this.contentEl.addClass("ob-pi-container");
		this.reactRoot = createRoot(this.contentEl);
		this.reactRoot.render(
			<ChatApp
				store={this.plugin.store}
				app={this.app}
				component={this}
				onNewChat={() => this.plugin.newConversation()}
			/>,
		);
	}

	async onClose(): Promise<void> {
		// React 19: unmount is sync; flush pending work so MarkdownRenderer
		// children aren't ripped out of a detached tree mid-effect.
		this.reactRoot?.unmount();
		this.reactRoot = null;
		this.contentEl.empty();
	}

	notify(event: string): void {
		new Notice(`Ob Pi: ${event}`);
	}
}
