/**
 * Ob Pi — minimal AI side chat for Obsidian, powered by the pi agent stack.
 *
 * This file is the Obsidian harness and deliberately stays thin: lifecycle,
 * commands, ribbon, view registration, settings persistence. Everything
 * agent-shaped lives in src/agent/, everything chat-shaped in src/ui/.
 */
import { Plugin, WorkspaceLeaf, Notice, TFile, TAbstractFile } from "obsidian";
import { PiChatView, VIEW_TYPE_OB_PI } from "./view";
import { DEFAULT_SETTINGS, ObPiSettingTab, type ObPiSettings } from "./settings";
import { PiChatAgent, resolveModelId } from "./agent/client";
import { ObChatStore } from "./ui/store";
import type { MemoryBridge, SkillMeta } from "./agent/skills";
import { ChatSessionPersistor, SessionFileBridgePaths, type SessionFileBridge } from "./agent/sessions";
import type { VaultBridge } from "./agent/tools";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

const OB_PI_DIR = ".ob-pi";
const MEMORY_PATH = `${OB_PI_DIR}/MEMORY.md`;
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export default class ObPiPlugin extends Plugin {
	settings: ObPiSettings = { ...DEFAULT_SETTINGS };
	readonly store: ObChatStore = new ObChatStore();
	private readonly sessions: ChatSessionPersistor = new ChatSessionPersistor(this.sessionFileBridge());
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
			callback: () => this.newConversation(),
		});

		this.addCommand({
			id: "stop",
			name: "Stop generating",
			checkCallback: (checking) => {
				if (!this.chatAgent?.isStreaming) return false;
				if (!checking) this.store.stop();
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
				enableSelfTools: true,
				vault: this.vaultBridge(),
				memory: this.memoryBridge(),
			});
			this.store.attach(this.chatAgent, this.sessions);
			await this.restoreOrStartSession();
			this.refreshStatus();
			return this.chatAgent;
		} catch (error) {
			this.agentError = error instanceof Error ? error.message : String(error);
			this.store.setStatus(this.agentError);
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

	/** Skills/memory under the hidden .ob-pi/ folder — the agent grows itself here. */
	private memoryBridge(): MemoryBridge {
		const { vault } = this.app;
		const ensureDir = async (path: string): Promise<void> => {
			try {
				await vault.createFolder(path);
			} catch {
				/* already exists */
			}
		};
		const write = async (path: string, data: string): Promise<void> => {
			await ensureDir(path.substring(0, path.lastIndexOf("/")) || OB_PI_DIR);
			const existing = vault.getAbstractFileByPath(path);
			if (existing instanceof TFile) {
				await vault.modify(existing, data);
			} else {
				await vault.create(path, data);
			}
		};
		const read = async (path: string): Promise<string | null> => {
			const file = vault.getAbstractFileByPath(path);
			return file instanceof TFile ? vault.cachedRead(file) : null;
		};
		const parseSkill = (raw: string, name: string): SkillMeta => {
			const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
			const frontmatter = match?.[1] ?? "";
			const description = /^description:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() ?? "(no description)";
			return { name, description };
		};
		return {
			readMemory: () => read(MEMORY_PATH),
			writeMemory: (text) => write(MEMORY_PATH, text.trim() + "\n"),
			listSkills: async () => {
				const folder = vault.getAbstractFileByPath(`${OB_PI_DIR}/skills`);
				if (folder && "children" in folder) {
					return (folder as { children: TAbstractFile[] }).children
						.filter((child): child is TFile => child instanceof TFile && child.path.endsWith(".md"))
						.map(async (file) => parseSkill(await vault.cachedRead(file), file.basename))
						.reduce<Promise<SkillMeta[]>>(
							async (acc, promise) => [...(await acc), await promise],
							Promise.resolve([]),
						);
				}
				return [];
			},
			readSkill: async (name) => {
				if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) return null;
				return read(`${OB_PI_DIR}/skills/${name}.md`);
			},
			writeSkill: async (name, description, content) => {
				const path = `${OB_PI_DIR}/skills/${name}.md`;
				await write(path, `---\nname: ${name}\ndescription: ${description}\n---\n${content.trim()}\n`);
				return path;
			},
		};
	}

	/** pi -c behavior: continue the most recent session, else start a fresh one. */
	private async restoreOrStartSession(): Promise<void> {
		const agent = this.chatAgent;
		if (!agent) return;
		const latest = await this.sessions.loadLatest();
		if (latest && latest.messages.length > 0) {
			agent.agent.state.messages = latest.messages;
			this.store.hydrate(latest.messages);
			this.store.setStatus(`${this.statusText()} · resumed`);
			setTimeout(() => this.refreshStatus(), 4000);
		} else {
			await this.sessions.newSession(this.statusText());
		}
	}

	private sessionFileBridge(): SessionFileBridge {
		const adapter = this.app.vault.adapter;
		return {
			appendLine: async (path, line) => {
				await adapter.append(path, line + "\n");
			},
			readFile: async (path) => {
				try {
					return await adapter.read(path);
				} catch {
					return null;
				}
			},
			listSessionPaths: async () => {
				const folder = this.app.vault.getAbstractFileByPath(SessionFileBridgePaths.dir);
				if (folder && "children" in folder) {
					return (folder as { children: TFile[] }).children
						.filter((file) => file.path.endsWith(".jsonl"))
						.map((file) => file.path);
				}
				return [];
			},
		};
	}

	// ------------------------------------------------------------------
	// Slash commands (in-UI control, pi-idiom)

	/** Execute a slash command; feedback lands in the transcript as a meta line. */
	async runCommand(input: string): Promise<void> {
		try {
			const feedback = await this.runCommandInner(input);
			if (feedback) this.store.meta(feedback);
		} catch (error) {
			this.store.meta(`Error: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async runCommandInner(input: string): Promise<string | null> {
		const [raw, ...args] = input.trim().split(/\s+/);
		const command = raw.toLowerCase();
		const agent = await this.ensureAgent();

		switch (command) {
			case "/help":
				return [
					"Commands:",
					"· /new — new conversation",
					"· /model [name] — switch model (opens picker without an argument)",
					"· /thinking [level] — off…max",
					"· /skills — list your skill library",
					"· /memory — open the memory note",
					"The assistant can also grow itself: ask it to remember preferences " +
						"(memory_write) or save reusable workflows (skill_write). They live in .ob-pi/.",
					"Tip: type / for the command menu.",
				].join("\n");
			case "/new":
				this.newConversation();
				return "New conversation.";
			case "/model": {
				const models = await this.getAvailableModelOptions();
				if (args.length > 0) {
					const query = args.join(" ").toLowerCase();
					const hit = models.find((m) => m.value.toLowerCase().includes(query));
					if (!hit) return `No model matching "${query}". Available:\n${models.map((m) => `· ${m.value}`).join("\n")}`;
					await this.selectModel(hit.value);
					return `Model → ${hit.value}`;
				}
				this.view?.openModelPicker();
				return null;
			}
			case "/thinking": {
				if (!agent) return this.agentError ?? "Agent unavailable";
				const level = args[0]?.toLowerCase() as ThinkingLevel | undefined;
				if (!level) {
					return `Thinking: ${this.settings.thinkingLevel}. Levels: ${THINKING_LEVELS.join(", ")}.`;
				}
				if (!THINKING_LEVELS.includes(level as (typeof THINKING_LEVELS)[number])) {
					return `Unknown level "${level}". Levels: ${THINKING_LEVELS.join(", ")}.`;
				}
				this.settings.thinkingLevel = level;
				await this.saveSettings();
				agent.setThinkingLevel(level);
				return `Thinking → ${level}`;
			}
			case "/skills": {
				const skills = agent ? await this.memoryBridge().listSkills() : [];
				if (skills.length === 0) {
					return "No skills yet. Ask the assistant to save one (skill_write), or create notes in .ob-pi/skills/.";
				}
				return `Skills:\n${skills.map((s) => `· ${s.name} — ${s.description}`).join("\n")}`;
			}
			case "/memory": {
				const file = this.app.vault.getAbstractFileByPath(MEMORY_PATH);
				if (file instanceof TFile) {
					await this.app.workspace.getLeaf("tab").openFile(file);
					return null;
				}
				return "No memory yet. Tell the assistant something to remember, or create .ob-pi/MEMORY.md.";
			}
			default:
				return `Unknown command "${command}". Try /help.`;
		}
	}

	async selectModel(modelId: string): Promise<void> {
		this.settings.modelId = modelId;
		await this.saveSettings();
		await this.applyModel();
	}

	// ------------------------------------------------------------------
	// Chat surface used by the view and commands

	async send(text: string): Promise<void> {
		const agent = await this.ensureAgent();
		if (!agent) {
			new Notice(`Ob Pi: ${this.agentError ?? "agent unavailable"}`);
			return;
		}
		try {
			await this.store.send(text);
		} catch (error) {
			new Notice(`Ob Pi: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	stop(): void {
		this.store.stop();
	}

	newConversation(): void {
		void (async () => {
			const agent = await this.ensureAgent();
			if (!agent) return;
			agent.reset();
			this.store.reset();
			await this.sessions.newSession(this.statusText());
		})();
	}

	statusText(): string {
		if (this.agentError) return this.agentError;
		const model = this.chatAgent?.agent.state.model;
		return model ? `${model.provider}/${model.id}` : "no model";
	}

	private refreshStatus(): void {
		this.store.setStatus(this.statusText());
	}

	async getAvailableModelOptions(): Promise<{ value: string; label: string }[]> {
		const agent = await this.ensureAgent();
		if (!agent) return [];
		const models = await agent.availableModels();
		return models.map((model) => ({
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
		}
	}

	async applyModel(): Promise<void> {
		const agent = this.chatAgent;
		if (!agent) return;
		const model = resolveModelId(agent.models, this.settings.modelId);
		if (model) agent.setModel(model);
		this.refreshStatus();
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
