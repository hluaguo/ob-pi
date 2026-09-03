/**
 * PiChatAgent — wires the minimal pi stack into one chat agent.
 *
 * Layers used from the pi monorepo (see docs/research/pi-sdk-packages.md):
 * - `@earendil-works/pi-ai`            → model catalog + provider streaming + auth
 * - `@earendil-works/pi-agent-core`    → the Agent loop (tools, steering, events)
 *
 * Deliberately NOT used: `@earendil-works/pi-coding-agent` (CLI/TUI/jiti/coding
 * tools — far too heavy for a plugin bundle).
 */
import { Agent, type AgentEvent, type AgentTool, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { defaultProviderAuthContext, type Model, type Models } from "@earendil-works/pi-ai";
import { PiAuthStore, DEFAULT_PI_AUTH_PATH } from "./auth";
import { createVaultTools, type VaultBridge } from "./tools";
import {
	createSelfTools,
	formatSystemPrompt,
	type MemoryBridge,
} from "./skills";

export interface PiChatAgentConfig {
	/** Provider-scoped model id, e.g. "anthropic/claude-sonnet-4-5". Empty = first available. */
	modelId: string;
	systemPrompt: string;
	thinkingLevel: ThinkingLevel;
	enableVaultTools: boolean;
	enableSelfTools: boolean;
	vault: VaultBridge;
	/** Skills/memory bridge; enables self-growth tools when provided. */
	memory: MemoryBridge | null;
}

/** Resolve "<provider>/<model>" against the runtime model catalog. */
export function resolveModelId(models: Models, modelId: string): Model<any> | undefined {
	const [provider, id] = modelId.split("/");
	if (!provider || !id) return undefined;
	return models.getModel(provider, id);
}

export class PiChatAgent {
	readonly models: Models;
	readonly agent: Agent;

	/** Recompute system prompt from base + memory + skill index. */
	refreshSystemPrompt: () => Promise<void> = async () => {};

	private constructor(models: Models, agent: Agent) {
		this.models = models;
		this.agent = agent;
	}

	private static async buildSystemPrompt(config: PiChatAgentConfig): Promise<string> {
		if (!config.memory) return config.systemPrompt;
		const [memory, skills] = await Promise.all([config.memory.readMemory(), config.memory.listSkills()]);
		return formatSystemPrompt(config.systemPrompt, memory, skills);
	}

	/**
	 * Build the model runtime and agent. `getAvailable()` is sync-safe here:
	 * static builtin providers only check whether auth is configured (file or
	 * env) — no network calls.
	 */
	static async create(config: PiChatAgentConfig): Promise<PiChatAgent> {
		const authStore = new PiAuthStore(DEFAULT_PI_AUTH_PATH);
		const models = builtinModels({
			credentials: authStore,
			authContext: defaultProviderAuthContext(),
		});

		const available = await models.getAvailable();
		if (available.length === 0) {
			throw new Error(
				"No models available. Ob Pi reads credentials from the pi CLI " +
					"(~/.pi/agent/auth.json) or environment variables (e.g. ANTHROPIC_API_KEY).",
			);
		}

		const model = resolveModelId(models, config.modelId) ?? available[0];

		const tools: AgentTool<any>[] = [];
		if (config.enableVaultTools) tools.push(...createVaultTools(config.vault));
		if (config.enableSelfTools && config.memory) {
			tools.push(...createSelfTools(config.memory, () => self.refreshSystemPrompt()));
		}

		const agent = new Agent({
			streamFn: (m, context, options) => models.stream(m, context, options),
			initialState: {
				model,
				systemPrompt: await PiChatAgent.buildSystemPrompt(config),
				thinkingLevel: config.thinkingLevel,
				tools,
			},
		});

		const self = {
			refreshSystemPrompt: async (): Promise<void> => {
				agent.state.systemPrompt = await PiChatAgent.buildSystemPrompt(config);
			},
		};

		const chat = new PiChatAgent(models, agent);
		chat.refreshSystemPrompt = self.refreshSystemPrompt;
		return chat;
	}

	/** Models the user could actually run right now (auth configured). */
	async availableModels(): Promise<readonly Model<any>[]> {
		return this.models.getAvailable();
	}

	setModel(model: Model<any>): void {
		this.agent.state.model = model;
	}

	setSystemPrompt(systemPrompt: string): void {
		this.agent.state.systemPrompt = systemPrompt;
	}

	setThinkingLevel(level: ThinkingLevel): void {
		this.agent.state.thinkingLevel = level;
	}

	setVaultTools(vault: VaultBridge, enabled: boolean): void {
		const self = this.agent.state.tools.filter((tool) => !tool.name.startsWith("skill_") && tool.name !== "memory_write");
		this.agent.state.tools = enabled ? [...self, ...createVaultTools(vault)] : self;
	}

	/** Send a user message. Resolves when the run fully settles. */
	async prompt(text: string): Promise<void> {
		await this.agent.prompt(text);
	}

	subscribe(listener: (event: AgentEvent) => void): () => void {
		return this.agent.subscribe(listener);
	}

	get isStreaming(): boolean {
		return this.agent.state.isStreaming;
	}

	/** Abort the current run. Queued (steering/follow-up) messages are dropped. */
	stop(): void {
		this.agent.abort();
		this.agent.clearAllQueues();
	}

	/** Clear transcript and start over. */
	reset(): void {
		this.agent.reset();
	}
}
