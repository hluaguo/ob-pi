/**
 * Ob Pi — minimal AI side chat for Obsidian, powered by the pi agent stack.
 *
 * This file is the Obsidian harness and deliberately stays thin: lifecycle,
 * commands, ribbon, view registration, settings persistence. Everything
 * agent-shaped lives in src/agent/, everything chat-shaped in src/ui/.
 */
import { Plugin, WorkspaceLeaf, Notice, TFile } from "obsidian";
import { PiChatView, VIEW_TYPE_OB_PI } from "./view";
import { DEFAULT_SETTINGS, ObPiSettingTab, type ObPiSettings } from "./settings";
import { PiChatAgent, resolveModelId } from "./agent/client";
import type { VaultBridge } from "./agent/tools";
import type { Model } from "@earendil-works/pi-ai";

export default class ObPiPlugin extends Plugin {
	settings: ObPiSettings = { ...DEFAULT_SETTINGS };
	private chatAgent: PiChatAgent | null = null;
	private agentError: string | null = null;
	private view: PiChatView | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_OB_PI, (leaf) => {
			this.view = new PiChatView(leaf, this);
			return this.view;
		});

		this.addRibbonIcon("message-square", "Open Ob Pi chat", () => void this.activateView());

		this.addCommand({
			id: "open-chat",
			name: "Open chat",
			callback: () => void this.activateView(),
		});

		this.addCommand({
			id: "new-conversation",
			name: "New conversation",
			callback: () => {
				this.chatAgent?.reset();
				this.view?.getChat()?.clear();
			},
		});

		this.addCommand({
			id: "stop",
			name: "Stop generating",
			checkCallback: (checking) => {
				if (!this.chatAgent?.isStreaming) return false;
				if (!checking) this.stop();
				return true;
			},
		});

		this.addSettingTab(new ObPiSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			void this.ensureAgent();
		});
	}

	onunload(): void {
		// Intentionally do not detach the view leaf: Obsidian persists layout.
		this.chatAgent?.stop();
		this.chatAgent = null;
	}

	// ------------------------------------------------------------------
	// Agent lifecycle

	/** Lazily create the agent; surfaces errors in the chat instead of throwing. */
	private async ensureAgent(): Promise<PiChatAgent | null> {
		if (this.chatAgent) return this.chatAgent;
		if (this.agentError) return null;
		try {
			this.chatAgent = await PiChatAgent.create({
				modelId: this.settings.modelId,
				systemPrompt: this.settings.systemPrompt,
				thinkingLevel: this.settings.thinkingLevel,
				enableVaultTools: this.settings.enableVaultTools,
				vault: this.vaultBridge(),
			});
			this.chatAgent.subscribe((event) => {
				this.view?.getChat()?.onAgentEvent(event);
			});
			return this.chatAgent;
		} catch (error) {
			this.agentError = error instanceof Error ? error.message : String(error);
			new Notice(`Ob Pi: ${this.agentError}`);
			return null;
		}
	}

	private vaultBridge(): VaultBridge {
		const { vault } = this.app;
		return {
			listNotePaths: async () => vault.getMarkdownFiles().map((file) => file.path),
			readNote: (path) => vault.cachedRead(vault.getAbstractFileByPath(path) as TFile),
			resolvePath: async (path) => {
				const file = vault.getAbstractFileByPath(path);
				if (file instanceof TFile) return file.path;
				// Tolerate missing extension.
				const withMd = vault.getAbstractFileByPath(`${path}.md`);
				return withMd instanceof TFile ? withMd.path : null;
			},
		};
	}

	// ------------------------------------------------------------------
	// Chat surface used by the view and commands

	async send(text: string): Promise<void> {
		const agent = await this.ensureAgent();
		if (!agent) {
			new Notice(`Ob Pi: ${this.agentError ?? "agent unavailable"}`);
			return;
		}
		if (agent.isStreaming) {
			new Notice("Ob Pi: still generating — Esc to stop");
			return;
		}
		try {
			await agent.prompt(text);
		} catch (error) {
			new Notice(`Ob Pi: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	stop(): void {
		this.chatAgent?.stop();
	}

	statusText(): string {
		if (this.agentError) return this.agentError;
		const model = this.chatAgent?.agent.state.model;
		const modelLabel = model ? `${model.provider}/${model.id}` : "no model";
		return modelLabel;
	}

	async getAvailableModelOptions(): Promise<{ value: string; label: string }[]> {
		const agent = await this.ensureAgent();
		if (!agent) return [];
		const models = await agent.availableModels();
		return models.map((model: Model<any>) => ({
			value: `${model.provider}/${model.id}`,
			label: `${model.provider} · ${model.id}`,
		}));
	}

	// ------------------------------------------------------------------
	// Settings plumbing

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		await this.ensureAgent();

		const existing = workspace.getLeavesOfType(VIEW_TYPE_OB_PI);
		let leaf: WorkspaceLeaf | null;
		if (existing.length > 0) {
			leaf = existing[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW_TYPE_OB_PI, active: true });
		}
		if (leaf) {
			await workspace.revealLeaf(leaf);
			this.view?.getChat()?.focus();
		}
	}

	async applyModel(): Promise<void> {
		const agent = this.chatAgent;
		if (!agent) return;
		const model = resolveModelId(agent.models, this.settings.modelId);
		if (model) agent.setModel(model);
	}

	applySystemPrompt(): void {
		this.chatAgent?.setSystemPrompt(this.settings.systemPrompt);
	}

	applyThinkingLevel(): void {
		this.chatAgent?.setThinkingLevel(this.settings.thinkingLevel);
	}

	applyVaultTools(): void {
		this.chatAgent?.setVaultTools(this.vaultBridge(), this.settings.enableVaultTools);
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<ObPiSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...data };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
