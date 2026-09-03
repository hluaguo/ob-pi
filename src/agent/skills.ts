/**
 * Skills + memory: the "grow itself" layer, vault-native.
 *
 * pi lets the agent gain capabilities through skills and context files. We port
 * the idea to the vault instead of ~/.pi: the agent can persist reusable
 * instructions and memory about the user as notes under `.ob-pi/`, and those
 * feed back into its own system prompt (progressive disclosure, pi-style):
 *
 *   .ob-pi/MEMORY.md            freeform memory, injected verbatim
 *   .ob-pi/skills/<name>.md     frontmatter (name, description) + instructions
 *
 * The model sees name+description up front; full content loads on demand via
 * the skill_read tool. skill_write/memory_write let it grow itself — safely:
 * notes, not code.
 */
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";

export interface SkillMeta {
	name: string;
	description: string;
}

/** Narrow vault surface for skills/memory — keeps src/agent/ obsidian-free. */
export interface MemoryBridge {
	readMemory(): Promise<string | null>;
	writeMemory(text: string): Promise<void>;
	listSkills(): Promise<SkillMeta[]>;
	readSkill(name: string): Promise<string | null>;
	writeSkill(name: string, description: string, content: string): Promise<string>;
}

const readSchema = Type.Object({
	name: Type.String({ description: "Skill name (file base name under .ob-pi/skills/)." }),
});

const writeSchema = Type.Object({
	name: Type.String({
		description: "Skill name, lowercase letters/digits/hyphens. Used as the file name.",
	}),
	description: Type.String({
		description: "One line: when should this skill be used? Shown in the skill index.",
	}),
	content: Type.String({ description: "Full skill instructions in markdown." }),
});

const memorySchema = Type.Object({
	content: Type.String({
		description:
			"Full new memory text (replaces existing). Stable facts about the user, " +
			"preferences, project context. Markdown.",
	}),
	operation: Type.Optional(
		Type.Union([Type.Literal("replace"), Type.Literal("append")], {
			description: "replace (default) overwrites MEMORY.md; append adds a new paragraph first.",
		}),
	),
});

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function skillFilePath(name: string): string {
	return `.ob-pi/skills/${name}.md`;
}

/** pi-format skill index for the system prompt (adapted: skill_read instead of file paths). */
export function formatSkillsIndex(skills: SkillMeta[]): string {
	if (skills.length === 0) return "";
	const lines = [
		"The following skills provide specialized instructions for specific tasks.",
		"Read the full skill with the skill_read tool when the task matches its description.",
		"",
		"<available_skills>",
	];
	for (const skill of skills) {
		lines.push(`  <skill name="${skill.name}">\n    ${skill.description}\n  </skill>`);
	}
	lines.push("</available_skills>");
	return lines.join("\n");
}

export function formatSystemPrompt(base: string, memory: string | null, skills: SkillMeta[]): string {
	let prompt = base.trim();
	if (memory && memory.trim()) {
		prompt += `\n\n# Memory\nThings you already know about the user and their vault:\n\n${memory.trim()}`;
	}
	const index = formatSkillsIndex(skills);
	if (index) prompt += `\n\n${index}`;
	return prompt;
}

export function createSelfTools(
	bridge: MemoryBridge,
	onChange: () => void | Promise<void>,
): AgentTool<any>[] {
	const skillRead: AgentTool<typeof readSchema> = {
		name: "skill_read",
		label: "Skill read",
		description: "Read the full instructions of one skill from the user's skill library.",
		parameters: readSchema,
		execute: async (_id, params) => {
			const content = await bridge.readSkill(params.name);
			if (content === null) {
				return { content: [{ type: "text", text: `Skill not found: ${params.name}` }], details: {} };
			}
			return { content: [{ type: "text", text: content }], details: { name: params.name } };
		},
	};

	const skillWrite: AgentTool<typeof writeSchema> = {
		name: "skill_write",
		label: "Skill write",
		description:
			"Create or update a skill: reusable instructions the assistant loads when a task matches. " +
			"Use when the user says things like \"remember how I like X done\" or asks to teach you a workflow.",
		parameters: writeSchema,
		execute: async (_id, params) => {
			const name = params.name.trim();
			if (!SKILL_NAME_RE.test(name)) {
				return {
					content: [{ type: "text", text: `Invalid skill name "${name}" (use lowercase letters, digits, hyphens).` }],
					details: {},
				};
			}
			const path = await bridge.writeSkill(name, params.description.trim(), params.content);
			await onChange();
			return {
				content: [{ type: "text", text: `Skill saved to ${path}. It is now in your skill index.` }],
				details: { path },
			};
		},
	};

	const memoryWrite: AgentTool<typeof memorySchema> = {
		name: "memory_write",
		label: "Memory write",
		description:
			"Persist lasting facts about the user (preferences, context, decisions) to memory. " +
			"Use for durable knowledge, not conversation detail.",
		parameters: memorySchema,
		execute: async (_id, params) => {
			if (params.operation === "append") {
				const existing = (await bridge.readMemory()) ?? "";
				await bridge.writeMemory(
					existing.trim() ? `${existing.trimEnd()}\n\n${params.content.trim()}` : params.content.trim(),
				);
			} else {
				await bridge.writeMemory(params.content.trim());
			}
			await onChange();
			return {
				content: [{ type: "text", text: "Memory updated. It is part of your system prompt now." }],
				details: {},
			};
		},
	};

	return [skillRead, skillWrite, memoryWrite];
}
