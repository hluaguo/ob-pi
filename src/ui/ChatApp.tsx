/**
 * ChatApp — assistant-ui primitives styled in the Pi idiom.
 *
 * No bubbles: user turns are `❯ text`, assistant turns are plain markdown
 * (rendered by Obsidian's MarkdownRenderer), tool activity is dim monospace
 * lines, status line under the composer. All styling in styles.css.
 */
import { memo, useContext, useEffect, useRef, useSyncExternalStore, createContext } from "react";
import {
	AssistantRuntimeProvider,
	ComposerPrimitive,
	MessagePrimitive,
	ThreadPrimitive,
	useExternalMessageConverter,
	useExternalStoreRuntime,
	type ThreadMessageLike,
} from "@assistant-ui/react";
import { MarkdownRenderer } from "obsidian";
import type { ObChatStore, ObMessage } from "./store";

// ---------------------------------------------------------------------------
// Conversion: ObMessage → assistant-ui ThreadMessageLike

const convert = (message: ObMessage): ThreadMessageLike => {
	if (message.role === "user") {
		return { role: "user", content: [{ type: "text", text: message.text }], id: message.id };
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
};

// ---------------------------------------------------------------------------
// Obsidian app/component context (avoids re-creating message components per render)

const ObsidianContext = createContext<{
	app: import("obsidian").App;
	component: import("obsidian").Component;
} | null>(null);

// ---------------------------------------------------------------------------
// Markdown via Obsidian (assistant content), plain text (user content)

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
	const icon = props.isError ? "×" : done ? "·" : "·";
	const suffix = !done ? "…" : "";
	return (
		<div className="ob-pi-turn ob-pi-tool" data-error={props.isError ? "true" : undefined}>
			{icon} {props.toolName}
			{suffix}
		</div>
	);
};

// ---------------------------------------------------------------------------
// Composer + chrome

const Composer = () => (
	<ComposerPrimitive.Root className="ob-pi-composer">
		<ComposerPrimitive.Input className="ob-pi-input" rows={1} autoFocus placeholder="Ask anything. Enter to send." />
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
);

// ---------------------------------------------------------------------------
// Root

export interface ChatAppProps {
	store: ObChatStore;
	app: import("obsidian").App;
	component: import("obsidian").Component;
	onNewChat: () => void;
}

export function ChatApp(props: ChatAppProps) {
	const snapshot = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot);
	const obsidian = { app: props.app, component: props.component };

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
			if (!text.trim()) return;
			await props.store.send(text);
		},
		onCancel: async () => props.store.stop(),
	});

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<ObsidianContext.Provider value={obsidian}>
			<ThreadPrimitive.Root className="ob-pi-chat">
				<div className="ob-pi-header">
					<span className="ob-pi-header-model">{snapshot.statusText}</span>
					<button
						className="ob-pi-btn"
						title="New conversation"
						onClick={props.onNewChat}
						disabled={snapshot.isRunning}
					>
						＋
					</button>
				</div>
				<ThreadPrimitive.Viewport className="ob-pi-transcript" autoScroll>
					<ThreadPrimitive.Empty>
						<div className="ob-pi-empty">Ask about your notes, ideas, anything.</div>
					</ThreadPrimitive.Empty>
					<ThreadPrimitive.Messages
						components={{ UserMessage: UserMessage, AssistantMessage: AssistantMessage }}
					/>
				</ThreadPrimitive.Viewport>
				<Composer />
				<div className="ob-pi-status" data-running={snapshot.isRunning ? "true" : undefined}>
					{snapshot.isRunning ? "thinking…" : snapshot.statusText}
				</div>
			</ThreadPrimitive.Root>
			</ObsidianContext.Provider>
		</AssistantRuntimeProvider>
	);
}
