# Research: Obsidian plugin API (verified via obsidianmd developer docs)

> Sources: obsidianmd/obsidian-developer-docs and obsidianmd/obsidian-sample-plugin
> (via Context7). Everything below is used somewhere in `src/`.

## Plugin anatomy

Release artifacts: **`main.js`** (CJS bundle), **`manifest.json`**, optional `styles.css`,
installed under `<vault>/.obsidian/plugins/<plugin-id>/`.

```json
// manifest.json
{
  "id": "ob-pi", "name": "Ob Pi", "version": "0.1.0",
  "minAppVersion": "1.6.0", "description": "…", "author": "…",
  "isDesktopOnly": true          // ← REQUIRED for us: Node/Electron APIs in src/agent/
}
```

```ts
export default class ObPiPlugin extends Plugin {
  async onload(): Promise<void>;   // register everything
  onunload(): void;                // release resources; do NOT detach leaves
}
```

Plugin extends `Component`: `registerView`, `addCommand`, `addRibbonIcon`,
`addSettingTab`, `registerEvent`, `registerDomEvent`, `registerInterval` are all
auto-cleaned on unload. `loadData()/saveData()` persist JSON to
`<plugin-dir>/data.json`.

## Sidebar view (the core integration)

```ts
const VIEW_TYPE = "ob-pi-chat";

// onload:
this.registerView(VIEW_TYPE, (leaf) => new PiChatView(leaf, this));

// open/reveal:
const leaves = workspace.getLeavesOfType(VIEW_TYPE);
if (leaves.length > 0) leaf = leaves[0];
else {
  leaf = workspace.getRightLeaf(false);           // right sidebar
  await leaf.setViewState({ type: VIEW_TYPE, active: true });
}
await workspace.revealLeaf(leaf);                 // also un-collapses the sidebar

class PiChatView extends ItemView {
  getViewType(): string; getDisplayText(): string; getIcon(): string; // lucide name, e.g. "message-square"
  async onOpen(): Promise<void>;  async onClose(): Promise<void>;
  // this.contentEl: empty HTMLElement for our UI; this.app; this (Component) for lifecycle
}
```

Community-guideline detail: **do not detach leaves in `onunload`** — Obsidian persists
workspace layout and restores the view on next load.

## Commands, ribbon, settings

```ts
this.addCommand({ id, name, callback: () => {} });
this.addCommand({ id, name, checkCallback: (checking: boolean) => boolean }); // greyed when false
this.addRibbonIcon("message-square", "tooltip", (evt) => {});                  // left bar
this.addSettingTab(new MyTab(this.app, this));

class MyTab extends PluginSettingTab {
  display(): void {                       // called each time the tab opens
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("…").setDesc("…").setHeading()           // chainable
      .addText(cb).addToggle(cb).addDropdown(cb).addTextArea(cb); // cb receives component
  }
}
```

Dropdowns are populated synchronously; for async model lists we fill options from a
promise and set the value once resolved (see `src/settings.ts`).

## Markdown rendering (assistant output)

```ts
import { MarkdownRenderer } from "obsidian";
await MarkdownRenderer.render(app, markdown, targetEl, sourcePath, component);
// static, async; sourcePath "" = don't resolve internal links; component = lifecycle owner
```

`renderMarkdown()` (instance method variant) is obsolete — use the static `render()`.
During streaming we set `textContent` cheaply and upgrade to markdown on `message_end`
(see `src/ui/chat.ts`).

## Workspace bits we may use later

- `workspace.getActiveFile(): TFile | null` — current note (for "chat about this note").
- `workspace.on("file-open", (file) => {})` — active file changed.
- `vault.getMarkdownFiles(): TFile[]`, `vault.cachedRead(file): Promise<string>`,
  `vault.getAbstractFileByPath(path): TAbstractFile | null` — used by the vault bridge.
- `Notice(message)` — non-intrusive toasts.

## Toolchain (from obsidian-sample-plugin)

- Node ≥ 18, TypeScript (strict), **esbuild** bundler.
- `esbuild.config.mjs`: `bundle`, `format: "cjs"`, `target: "es2022"`-ish,
  `external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules]`,
  outfile `main.js`; copy `manifest.json` / `versions.json` / `styles.css` next to it.
- `versions.json` maps plugin version → minimum Obsidian version.
- Plugins are loaded via `require()` → output must be CommonJS (this constraint drives
  the whole bundling strategy in docs/research/integration.md).
