/**
 * Vault tools for the agent loop.
 *
 * The agent core is environment-agnostic: instead of pi's built-in read/bash
 tools (which work on the raw filesystem), we register small custom tools
 backed by Obsidian's Vault API through a narrow bridge interface. This keeps
 `src/agent/` free of `obsidian` imports and easy to unit-test.
 */
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";

export interface VaultSearchHit {
	path: string;
	snippet: string;
}

/** Narrow surface of Obsidian's vault/caching APIs the tools need. */
export interface VaultBridge {
	/** All markdown note paths in the vault, e.g. "notes/idea.md". */
	listNotePaths(): Promise<string[]>;
	/** Read a note's full (cached) content. Throws if unreadable. */
	readNote(path: string): Promise<string>;
	/** Resolve a possibly-ambiguous path to an existing note path, or null. */
	resolvePath(path: string): Promise<string | null>;
}

const MAX_READ_CHARS = 12_000;
const MAX_LINE_CHARS = 240;

function clip(text: string, max: number): string {
	if (text.length <= max) return text;
	return text.slice(0, max) + `… [truncated ${text.length - max} chars]`;
}

function firstMatchingLine(content: string, query: string): string {
	for (const line of content.split("\n")) {
		if (line.toLowerCase().includes(query)) {
			return clip(line.trim(), MAX_LINE_CHARS);
		}
	}
	return "(no direct line match — match in title)";
}

const searchSchema = Type.Object({
	query: Type.String({ description: "Text to search for." }),
	limit: Type.Optional(
		Type.Number({ description: "Max results to return (default 8, max 25)." }),
	),
});

const readSchema = Type.Object({
	path: Type.String({ description: "Vault-relative note path, e.g. \"notes/idea.md\"." }),
});

export function createVaultTools(vault: VaultBridge): AgentTool<any>[] {
	const searchTool: AgentTool<typeof searchSchema> = {
		name: "vault_search",
		label: "Vault search",
		description:
			"Search the user's Obsidian vault. Matches case-insensitively against note titles and content. " +
			"Returns note paths with a matching snippet. Use before vault_read to locate notes.",
		parameters: searchSchema,
		execute: async (_toolCallId, params) => {
			const query = params.query.trim().toLowerCase();
			if (!query) {
				return { content: [{ type: "text", text: "Empty query." }], details: {} };
			}
			const limit = Math.min(Math.max(params.limit ?? 8, 1), 25);

			const paths = await vault.listNotePaths();
			const hits: VaultSearchHit[] = [];
			for (const path of paths) {
				const inTitle = path.toLowerCase().includes(query);
				let content = "";
				if (!inTitle) {
					try {
						content = (await vault.readNote(path)).toLowerCase();
					} catch {
						continue;
					}
					if (!content.includes(query)) continue;
				}
				let snippet = "(matched in title)";
				if (!inTitle) {
					try {
						snippet = firstMatchingLine(await vault.readNote(path), query);
					} catch {
						/* title match only */
					}
				}
				hits.push({ path, snippet });
				if (hits.length >= limit) break;
			}

			const text =
				hits.length === 0
					? `No notes match "${params.query}".`
					: hits
							.map((hit, index) => `${index + 1}. ${hit.path}\n   ${hit.snippet}`)
							.join("\n");
			return {
				content: [{ type: "text", text: clip(text, MAX_READ_CHARS) }],
				details: { count: hits.length },
			};
		},
	};

	const readTool: AgentTool<typeof readSchema> = {
		name: "vault_read",
		label: "Vault read",
		description:
			"Read the full content of one note from the user's Obsidian vault by path. " +
			"Use vault_search first if you don't know the exact path.",
		parameters: readSchema,
		execute: async (_toolCallId, params) => {
			const resolved = await vault.resolvePath(params.path);
			if (!resolved) {
				return {
					content: [{ type: "text", text: `Note not found: ${params.path}` }],
					details: {},
				};
			}
			const content = await vault.readNote(resolved);
			return {
				content: [{ type: "text", text: clip(content, MAX_READ_CHARS) }],
				details: { path: resolved, length: content.length },
			};
		},
	};

	return [searchTool, readTool];
}
