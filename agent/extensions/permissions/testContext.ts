import {
	ModelRegistry,
	SessionManager,
	type BuildSystemPromptOptions,
	type ExtensionCommandContext,
	type ExtensionContext,
	type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";

type TestNotifyType = Parameters<ExtensionUIContext["notify"]>[1];

type BaseContextOptions = {
	cwd: string;
	sessionId?: string;
	mode?: ExtensionContext["mode"];
	hasUI?: boolean;
	theme?: ExtensionUIContext["theme"];
	isProjectTrusted?: boolean;
	onNotify?: (message: string, type?: TestNotifyType) => void;
	onSelect?: () => Promise<string | undefined>;
	onEditor?: () => Promise<string | undefined>;
	onSetStatus?: (key: string, value: string | undefined) => void;
};

export type TestExtensionCommandContext = ExtensionCommandContext & {
	statuses: Map<string, string>;
	notifications: string[];
	selectCalls: number;
};

const DEFAULT_THEME = {
	fg(_color: string, text: string) {
		return text;
	},
	bold(text: string) {
		return text;
	},
} as unknown as ExtensionUIContext["theme"];

function createModelRegistry(): ExtensionContext["modelRegistry"] {
	return new ModelRegistry({} as ConstructorParameters<typeof ModelRegistry>[0]);
}

function createUiContext(options: BaseContextOptions): ExtensionUIContext {
	const theme = options.theme ?? DEFAULT_THEME;
	const select = options.onSelect ?? (async () => undefined);
	const editor = options.onEditor ?? (async () => undefined);
	const setStatus = options.onSetStatus ?? (() => {});
	const notify = options.onNotify ?? (() => {});

	return {
		select: async (_title, _choices, _opts) => select(),
		confirm: async (_title, _message, _opts) => false,
		input: async (_title, _placeholder, _opts) => undefined,
		notify(message, type) {
			notify(message, type);
		},
		onTerminalInput: () => () => {},
		setStatus(key, value) {
			setStatus(key, value);
		},
		setWorkingMessage() {},
		setWorkingVisible() {},
		setWorkingIndicator() {},
		setHiddenThinkingLabel() {},
		setWidget(_key, _content, _widgetOptions) {},
		setFooter() {},
		setHeader() {},
		setTitle() {},
		async custom<T>(_factory: Parameters<ExtensionUIContext["custom"]>[0], _options?: Parameters<ExtensionUIContext["custom"]>[1]): Promise<T> {
			return undefined as T;
		},
		pasteToEditor() {},
		setEditorText() {},
		getEditorText: () => "",
		editor: async (_title, _prefill) => editor(),
		addAutocompleteProvider() {},
		setEditorComponent() {},
		getEditorComponent: () => undefined,
		theme,
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: false, error: "UI not available" }),
		getToolsExpanded: () => false,
		setToolsExpanded() {},
	};
}

export function createTestExtensionContext(options: BaseContextOptions): ExtensionContext {
	const cwd = options.cwd;
	return {
		cwd,
		hasUI: options.hasUI ?? true,
		mode: options.mode ?? "tui",
		ui: createUiContext(options),
		sessionManager: SessionManager.inMemory(cwd, { id: options.sessionId ?? "test-session" }),
		modelRegistry: createModelRegistry(),
		model: undefined,
		thinkingLevel: undefined,
		isIdle: () => true,
		isProjectTrusted: () => options.isProjectTrusted ?? true,
		signal: undefined,
		abort() {},
		hasPendingMessages: () => false,
		shutdown() {},
		getContextUsage: () => undefined,
		compact() {},
		getSystemPrompt: () => "",
	};
}

export function createTestExtensionCommandContext(
	options: Omit<BaseContextOptions, "onNotify" | "onSelect" | "onSetStatus"> & { selectChoice?: string },
): TestExtensionCommandContext {
	const statuses = new Map<string, string>();
	const notifications: string[] = [];
	let ctx!: TestExtensionCommandContext;

	const base = createTestExtensionContext({
		...options,
		onNotify(message) {
			notifications.push(message);
		},
		onSelect: async () => {
			ctx.selectCalls += 1;
			return options.selectChoice;
		},
		onSetStatus(key, value) {
			if (value === undefined) statuses.delete(key);
			else statuses.set(key, value);
		},
	});

	ctx = {
		...base,
		getSystemPromptOptions: (): BuildSystemPromptOptions => ({ cwd: options.cwd }),
		waitForIdle: async () => {},
		newSession: async () => ({ cancelled: false }),
		fork: async () => ({ cancelled: false }),
		navigateTree: async () => ({ cancelled: false }),
		switchSession: async () => ({ cancelled: false }),
		reload: async () => {},
		statuses,
		notifications,
		selectCalls: 0,
	};

	return ctx;
}
