import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const prod = process.argv[2] === "production";

const banner = `/*
Obsidian loads main.js as CommonJS from the plugin directory.
This bundle is ESM sources (pi stack is ESM-only) compiled to CJS by esbuild.
Node built-ins stay external: Obsidian desktop (Electron) provides them.
*/
`;

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtins,
	],
	format: "cjs",
	target: "es2022",
	platform: "node",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	minify: prod,
	outfile: "dist/main.js",
	banner: { js: banner },
});

function copyStatic() {
	mkdirSync("dist", { recursive: true });
	copyFileSync("manifest.json", join("dist", "manifest.json"));
	copyFileSync("versions.json", join("dist", "versions.json"));
	copyFileSync("styles.css", join("dist", "styles.css"));
}

if (prod) {
	await context.rebuild();
	copyStatic();
	await context.dispose();
	process.exit(0);
} else {
	await context.watch();
	copyStatic();
}
