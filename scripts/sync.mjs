#!/usr/bin/env node
/**
 * Link (or copy) the built plugin into an Obsidian vault for local testing.
 *
 *   node scripts/sync.mjs /path/to/vault        # symlink dist → vault (live rebuilds)
 *   node scripts/sync.mjs /path/to/vault copy   # plain copy instead of symlink
 *
 * After syncing: reload the plugin in Obsidian (disable/enable, or run
 * "Reload app without saving"). With a symlink, `npm run dev` + Hot-Reload
 * gives a full rebuild-and-reload loop.
 */
import { cpSync, existsSync, mkdirSync, symlinkSync, statSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "../dist");
const PLUGIN_ID = "ob-pi";

const vault = process.argv[2];
const mode = process.argv[3] === "copy" ? "copy" : "link";

if (!vault) {
	console.error("Usage: node scripts/sync.mjs <vault-path> [copy]");
	process.exit(1);
}
if (!existsSync(join(dist, "main.js"))) {
	console.error("dist/main.js not found — run `npm run build` (or `npm run dev`) first.");
	process.exit(1);
}

const pluginDir = join(resolve(vault), ".obsidian", "plugins", PLUGIN_ID);
mkdirSync(dirname(pluginDir), { recursive: true });

try {
	statSync(pluginDir);
	rmSync(pluginDir, { recursive: true }); // replace previous install
} catch {
	// did not exist
}

if (mode === "copy") {
	cpSync(dist, pluginDir, { recursive: true });
	console.log(`Copied dist/ → ${pluginDir}`);
} else {
	symlinkSync(dist, pluginDir, "dir");
	console.log(`Linked ${dist} → ${pluginDir}`);
}

console.log(`
Next steps in Obsidian:
  1. Settings → Community plugins → turn off Restricted mode (first time only)
  2. Enable "Ob Pi" under Installed plugins
  3. Open the chat: ribbon icon or command "Ob Pi: Open chat"

Reload after a rebuild: toggle the plugin, or Ctrl+P → "Reload app without saving".
`);
