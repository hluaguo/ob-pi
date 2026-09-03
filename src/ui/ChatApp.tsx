/**
 * ChatApp — assistant-ui primitives styled in the Pi idiom.
 *
 * No bubbles: user turns are `❯ text`, assistant turns are plain markdown
 * (rendered by Obsidian's MarkdownRenderer), tool activity is dim monospace
 * lines, command feedback is dim `system` messages. Slash commands via the
 * composer trigger popover; model quick-switcher in the header.
 */
import {
	memo,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { MarkdownRenderer } from "obsidian";
import {
	AssistantRuntimeProvider,
	ComposerPrimitive,
	MessagePrimitive,
	ThreadPrimitive,
	unstable_useSlashCommandAdapter,
	useExternalMessageConverter,
	useExternalStoreRuntime,
	type ThreadMessageLike,
} from "@assistant-ui/react";
import type { ObChatStore, ObMessage } from "./store";

// ---------------------------------------------------------------------------
// Conversion: ObMessage → assistant-ui ThreadMessageLike

function convert(message: ObMessage): ThreadMessageLike {
	if (message.role === "user") {
		return { role: "user", content: [{ type: "text", text: message.text }], id: message.id };
	}
	if (message.kind === "meta") {
		return { role: "system", content: [{ type: "text", text: message.text }], id: message.id };
	}
	const content: Array<
		| { type: "text"; text: string }
		| {
				type: "tool-call";
				toolCallId: string;
				toolName: string;
				argsText: string;
				args: {};
				result?: string;
				isError?: boolean;
		  }
	> = [];
	if (message.text) content.push({ type: "text", text: message.text });
	for (const tool of message.tools) {
		content.push({
			type: "tool-call",
			toolCallId: tool.toolCallId,
			toolName: tool.toolName,
			argsText: "",
			args: {},
			result: tool.status === "done" ? "done" : undefined,
			isError: tool.status === "error" ? true : undefined,
		});
	}
	return { role: "assistant", content, id: message.id };
}

// ---------------------------------------------------------------------------
// Obsidian app/component context (stable message component identities)

const ObsidianContext = createContext<{
	app: import("obsidian").App;
	component: import("obsidian").Component;
} | null>(null);

const ObsidianMarkdown = memo(function ObsidianMarkdown(props: {
	app: import("obsidian").App;
	component: import("obsidian").Component;
	text?: string;
}) {
	const text = props.text ?? "";
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const host = ref.current;
		if (!host) return;
		host.empty();
		if (!text) return;
		void MarkdownRenderer.render(props.app, text, host, "", props.component);
	}, [text, props.app, props.component]);
	return <div className="ob-pi-md" ref={ref} />;
});

const PlainText = (props: { text?: string }) => (
	<span className="ob-pi-user-text">{props.text ?? ""}</span>
);

// ---------------------------------------------------------------------------
// Messages

const UserMessage = () => (
	<MessagePrimitive.Root className="ob-pi-turn ob-pi-user">
		<span className="ob-pi-prompt">❯</span>
		<MessagePrimitive.Parts components={{ Text: PlainText }} />
	</MessagePrimitive.Root>
);

const AssistantMessage = () => {
	const ctx = useContext(ObsidianContext);
	return (
		<MessagePrimitive.Root className="ob-pi-turn ob-pi-assistant">
			<MessagePrimitive.Parts
				components={{
					Text: (part) =>
						ctx ? <ObsidianMarkdown app={ctx.app} component={ctx.component} text={part.text} /> : null,
					tools: { Fallback: ToolLine },
				}}
			/>
		</MessagePrimitive.Root>
	);
};

type ToolFallbackProps = {
	toolName: string;
	argsText: string;
	result?: unknown;
	isError?: boolean;
};

const ToolLine = (props: ToolFallbackProps) => {
	const done = props.result !== undefined;
	return (
		<div className="ob-pi-turn ob-pi-tool" data-error={props.isError ? "true" : undefined}>
			· {props.toolName}
			{done ? "" : "…"}
		</div>
	);
};

const MetaLine = () => (
	<MessagePrimitive.Root className="ob-pi-turn ob-pi-meta">
		<MessagePrimitive.Parts components={{ Text: (part) => <>{part.text}</> }} />
	</MessagePrimitive.Root>
);

// ---------------------------------------------------------------------------
// Slash commands

const SLASH_COMMANDS = [
	{ id: "help", label: "/help", description: "Show commands" },
	{ id: "new", label: "/new", description: "New conversation" },
	{ id: "model", label: "/model", description: "Switch model" },
	{ id: "thinking", label: "/thinking", description: "Set thinking level (off…max)" },
	{ id: "skills", label: "/skills", description: "List your skill library" },
	{ id: "memory", label: "/memory", description: "Open the memory note" },
];

export interface ChatAppProps {
	store: ObChatStore;
	app: import("obsidian").App;
	component: import("obsidian").Component;
	onNewChat: () => void;
	/** Execute a slash command; feedback lands in the transcript as meta lines. */
	runCommand: (text: string) => Promise<void>;
	loadModels: () => Promise<{ value: string; label: string }[]>;
	selectModel: (value: string) => Promise<void>;
	/** Imperative handle so the plugin can open the picker from /model. */
	onReady?: (api: { openModelPicker: () => void }) => void;
}

export function ChatApp(props: ChatAppProps) {
	const snapshot = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot);
	const obsidian = { app: props.app, component: props.component };

	// -- slash command popover ------------------------------------------------
	const dispatchCommand = useCallback(
		(commandId: string) => {
			void props.runCommand(`/${commandId}`);
		},
		[props],
	);
	const slash = unstable_useSlashCommandAdapter({
		commands: SLASH_COMMANDS.map((command) => ({
			...command,
			execute: () => dispatchCommand(command.id),
		})),
		removeOnExecute: true,
	});

	// -- model quick-switcher ---------------------------------------------------
	const [pickerOpen, setPickerOpen] = useState(false);
	const [models, setModels] = useState<{ value: string; label: string }[]>([]);
	const [filter, setFilter] = useState("");
	const filterRef = useRef<HTMLInputElement>(null);

	const openPicker = useCallback(() => {
		setPickerOpen(true);
		setFilter("");
		props
			.loadModels()
			.then(setModels)
			.catch(() => setModels([]));
	}, [props]);

	useEffect(() => {
		if (pickerOpen) filterRef.current?.focus();
	}, [pickerOpen]);

	// Imperative handle for /model with no argument.
	const apiRef = useRef({ openModelPicker: openPicker });
	apiRef.current = { openModelPicker: openPicker };
	useEffect(() => {
		props.onReady?.({ openModelPicker: () => apiRef.current.openModelPicker() });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const filteredModels = models.filter(
		(model) =>
			!filter ||
			model.value.toLowerCase().includes(filter.toLowerCase()) ||
			model.label.toLowerCase().includes(filter.toLowerCase()),
	);

	const converted = useExternalMessageConverter({
		callback: convert,
		messages: [...snapshot.messages],
		isRunning: snapshot.isRunning,
		joinStrategy: "concat-content",
	});

	const runtime = useExternalStoreRuntime({
		messages: converted,
		isRunning: snapshot.isRunning,
		onNew: async (message) => {
			const text = message.content
				.filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
				.map((part) => part.text)
				.join("");
			const trimmed = text.trim();
			if (!trimmed) return;
			if (trimmed.startsWith("/") && props.store.isCommand(trimmed)) {
				await props.runCommand(trimmed);
				return;
			}
			await props.store.send(trimmed);
		},
		onCancel: async () => props.store.stop(),
	});

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<ObsidianContext.Provider value={obsidian}>
				<ThreadPrimitive.Root className="ob-pi-chat">
					<div className="ob-pi-header">
						<button
							className="ob-pi-header-model ob-pi-btn"
							title="Switch model"
							onClick={openPicker}
						>
							{snapshot.statusText}
						</button>
						<button
							className="ob-pi-btn"
							title="New conversation"
							onClick={props.onNewChat}
							disabled={snapshot.isRunning}
						>
							＋
						</button>
					</div>

					{pickerOpen && (
						<div className="ob-pi-picker-backdrop" onClick={() => setPickerOpen(false)}>
							<div className="ob-pi-picker" onClick={(event) => event.stopPropagation()}>
								<input
									ref={filterRef}
									className="ob-pi-picker-filter"
									placeholder="Filter models…"
									value={filter}
									onChange={(event) => setFilter(event.currentTarget.value)}
									onKeyDown={(event) => {
										if (event.key === "Escape") setPickerOpen(false);
										if (event.key === "Enter" && filteredModels[0]) {
											void props.selectModel(filteredModels[0].value);
											setPickerOpen(false);
										}
									}}
								/>
								<div className="ob-pi-picker-list">
									{filteredModels.map((model) => (
										<button
											key={model.value}
											className="ob-pi-picker-item"
											onClick={() => {
												void props.selectModel(model.value);
												setPickerOpen(false);
											}}
										>
											{model.label}
										</button>
									))}
									{filteredModels.length === 0 && (
										<div className="ob-pi-picker-empty">No matching models.</div>
									)}
								</div>
							</div>
						</div>
					)}

					<ThreadPrimitive.Viewport className="ob-pi-transcript" autoScroll>
						<ThreadPrimitive.Empty>
							<div className="ob-pi-empty">
								Ask about your notes, ideas, anything.
								<br />
								<span className="ob-pi-meta-hint">Type / for commands.</span>
							</div>
						</ThreadPrimitive.Empty>
						<ThreadPrimitive.Messages
							components={{
								UserMessage: UserMessage,
								AssistantMessage: AssistantMessage,
								SystemMessage: MetaLine,
							}}
						/>
					</ThreadPrimitive.Viewport>

					<ComposerPrimitive.Unstable_TriggerPopoverRoot>
						<ComposerPrimitive.Unstable_TriggerPopover
							char="/"
							adapter={slash.adapter}
							className="ob-pi-slash"
						>
							<ComposerPrimitive.Unstable_TriggerPopover.Action
								onExecute={slash.action.onExecute}
								removeOnExecute={slash.action.removeOnExecute}
							/>
							<ComposerPrimitive.Unstable_TriggerPopoverItems className="ob-pi-slash-items">
								{(items) => (
									<>
										{items.map((item) => (
											<ComposerPrimitive.Unstable_TriggerPopoverItem
												key={item.id}
												item={item}
												className="ob-pi-slash-item"
											>
												<span className="ob-pi-slash-label">{item.label}</span>
												<span className="ob-pi-slash-desc">{item.description}</span>
											</ComposerPrimitive.Unstable_TriggerPopoverItem>
										))}
									</>
								)}
							</ComposerPrimitive.Unstable_TriggerPopoverItems>
						</ComposerPrimitive.Unstable_TriggerPopover>
						<ComposerPrimitive.Root
						className="ob-pi-composer"
						onKeyDown={(event) => {
							// Esc stops generation (the popover intercepts Esc when open).
							if (event.key === "Escape" && snapshot.isRunning) {
								props.store.stop();
							}
						}}
					>
						<ComposerPrimitive.Input
							className="ob-pi-input"
							rows={1}
							autoFocus
							placeholder="Ask anything. / for commands."
						/>
						<div className="ob-pi-composer-actions">
							<ThreadPrimitive.If running={false}>
								<ComposerPrimitive.Send className="ob-pi-btn" title="Send (Enter)">
									↵
								</ComposerPrimitive.Send>
							</ThreadPrimitive.If>
							<ThreadPrimitive.If running>
								<ComposerPrimitive.Cancel className="ob-pi-btn ob-pi-btn-stop" title="Stop (Esc)">
									■
								</ComposerPrimitive.Cancel>
							</ThreadPrimitive.If>
						</div>
					</ComposerPrimitive.Root>
					</ComposerPrimitive.Unstable_TriggerPopoverRoot>

					<div className="ob-pi-status" data-running={snapshot.isRunning ? "true" : undefined}>
						{snapshot.isRunning ? "thinking…" : snapshot.statusText}
					</div>
				</ThreadPrimitive.Root>
			</ObsidianContext.Provider>
		</AssistantRuntimeProvider>
	);
}
