/**
 * Settings: persisted in the plugin's data.json via loadData/saveData.
 */
import { App, PluginSettingTab, Setting } from "obsidian";
import type ObPiPlugin from "./main";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export interface ObPiSettings {
	/** Provider-scoped model id, e.g. "anthropic/claude-sonnet-4-5". */
	modelId: string;
	systemPrompt: string;
	thinkingLevel: ThinkingLevel;
	enableVaultTools: boolean;
}

export const DEFAULT_SETTINGS: ObPiSettings = {
	modelId: "",
	systemPrompt:
		"You are a concise thinking partner embedded in the user's note vault. " +
		"Answer directly, without filler. Use the provided vault tools when the " +
		"question involves the user's notes.",
	thinkingLevel: "off",
	enableVaultTools: true,
};

export class ObPiSettingTab extends PluginSettingTab {
	private readonly plugin: ObPiPlugin;

	constructor(app: App, plugin: ObPiPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Model").setHeading();

		const modelSetting = new Setting(containerEl)
			.setName("Default model")
			.setDesc("Models with configured credentials (pi CLI auth file or environment).");

		const dropdown = modelSetting.addDropdown((dropdown) => {
			this.plugin
				.getAvailableModelOptions()
				.then((options) => {
					if (options.length === 0) {
						dropdown.addOption("", "No models available — check credentials");
					}
					for (const option of options) {
						dropdown.addOption(option.value, option.label);
					}
					dropdown.setValue(this.plugin.settings.modelId || options[0]?.value || "");
				})
				.catch(() => {
					dropdown.addOption("", "Failed to load models");
				});
			dropdown.onChange(async (value) => {
				this.plugin.settings.modelId = value;
				await this.plugin.saveSettings();
				void this.plugin.applyModel();
			});
		});
		void dropdown;

		new Setting(containerEl).setName("Behavior").setHeading();

		new Setting(containerEl)
			.setName("System prompt")
			.setDesc("Sent with every request.")
			.addTextArea((text) =>
				text
					.setValue(this.plugin.settings.systemPrompt)
					.onChange(async (value) => {
						this.plugin.settings.systemPrompt = value;
						await this.plugin.saveSettings();
						this.plugin.applySystemPrompt();
					})
					.inputEl.setAttr("rows", 4),
			);

		new Setting(containerEl)
			.setName("Thinking level")
			.setDesc("Reasoning effort, where the model supports it.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						off: "off",
						minimal: "minimal",
						low: "low",
						medium: "medium",
						high: "high",
					})
					.setValue(this.plugin.settings.thinkingLevel)
					.onChange(async (value) => {
						this.plugin.settings.thinkingLevel = value as ThinkingLevel;
						await this.plugin.saveSettings();
						this.plugin.applyThinkingLevel();
					}),
			);

		new Setting(containerEl)
			.setName("Vault tools")
			.setDesc("Let the assistant search and read notes in this vault.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.enableVaultTools).onChange(async (value) => {
					this.plugin.settings.enableVaultTools = value;
					await this.plugin.saveSettings();
					this.plugin.applyVaultTools();
				}),
			);
	}
}
