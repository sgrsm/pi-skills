import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import type { ExtensionToolContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { Container, KeybindingsManager, TUI_KEYBINDINGS, ScrollView, Text, TuiAltScreen, TuiMainScreen, VStack, type Component, type OverlayHandle, type Terminal } from "@earendil-works/pi-tui";
import clarifyExtension from "../clarify/index.ts";
import { createDialogHarness, flushDialogs } from "../shared/dialogTestHarness.ts";

const question = Array.from({ length: 40 }, (_, i) => `Context line ${String(i + 1).padStart(2, "0")}`).join("\n");
const choices = [
	{ label: "First", description: "First description with 界 and emoji 😀. ".repeat(30) },
	{ label: "Second", description: "Second description" },
];

type ChoiceInput = { label: string; description?: string };
type CustomOptions = Parameters<ExtensionUIContext["custom"]>[1];
export type UiOptions = {
	columns?: number; rows?: number;
	/** User keybinding overrides, injected through the factory like the host's KeybindingsManager. */
	userBindings?: ConstructorParameters<typeof KeybindingsManager>[1];
};
type DialogComponent = Component & { dispose?(): void };

/**
 * Public renderer fixture for contract and positive acceptance tests.
 * custom() installation/completion is a test adapter, not an actual host-method invocation.
 * It mirrors Pi 1.4 InteractiveMode.showExtensionCustom(): an overlay completes with its own
 * handle.hide(), while inline interactions form an editor-slot stack. Production Clarify is inline;
 * the adapter honors either presentation. Compare it with the host close path after
 * upgrades; the bounded subprocess in clarify-host.test.ts exercises the actual host method.
 * Coverage and practical limits are documented in host-contract-coverage.md.
 */
export function createUi(mode: "fullscreen" | "regular", uiOptions: UiOptions = {}) {
	// The host's definitions also carry app actions; the one the answer editor intercepts is mirrored here.
	const bindings = new KeybindingsManager(
		{ ...TUI_KEYBINDINGS, "app.editor.external": { defaultKeys: "ctrl+g", description: "Open external editor" } } as typeof TUI_KEYBINDINGS,
		uiOptions.userBindings,
	);
	const h = createDialogHarness();
	clarifyExtension(h.pi, { loadModeState: () => ({ enabled: true }) });
	const ctx = h.context(undefined, "tui");
	const toolCtx: ExtensionToolContext = { ...ctx, tools: [], executeTool: async () => { throw new Error("no nested execution in this fixture"); } };
	const writes: string[] = [];
	let terminalInput: (data: string) => void = () => { throw new Error("terminal not started"); };
	let notifyResize: () => void = () => {};
	const size = { columns: uiOptions.columns ?? 80, rows: uiOptions.rows ?? 24 };
	const terminal = {
		get columns() { return size.columns; }, get rows() { return size.rows; }, kittyProtocolActive: false,
		start(onInput, onResize) { terminalInput = onInput; notifyResize = onResize; },
		stop() {}, async drainInput() {}, write(data) { writes.push(data); }, moveBy() {},
		hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {},
		clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {},
	} satisfies Terminal;
	// Clipboard and URL activation are captured, never performed: the host's own default gestures can
	// be observed (selection text, link click) without touching the system clipboard or a browser.
	const copied: string[] = [];
	const openedUrls: string[] = [];
	const tui = mode === "fullscreen"
		? new TuiAltScreen(terminal, false, undefined, {
			wheelScrollLines: 3,
			copySelection: async (text) => { copied.push(text); return true; },
			openUrl: (url) => { openedUrls.push(url); },
		})
		: new TuiMainScreen(terminal);
	const editor = new Text("Main editor", 0, 0);
	const editorContainer = new Container();
	editorContainer.addChild(editor);
	const transcript = new ScrollView(new Text("Transcript\n".repeat(100), 0, 0), { primary: true, follow: "end", scrollbar: "hidden" });
	// Simplified host fixed-dock composition built with public layout APIs.
	const dock = new VStack([
		{ component: editorContainer, shrink: 1, minSize: 3 },
		{ component: new Text("Footer\nStats\nStatus", 0, 0), shrink: 1, minSize: 0 },
	]);
	const root = new VStack([
		{ component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
		{ component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
	]);
	if (tui instanceof TuiAltScreen) tui.setLayoutRoot(root);
	else { tui.addChild(new Text("Transcript", 0, 0)); tui.addChild(editorContainer); }
	tui.setFocus(editor);
	const dialogs: Array<{ component: DialogComponent; options: CustomOptions; handle?: OverlayHandle; mounted: boolean; doneCalls: number }> = [];
	const inline: DialogComponent[] = [];
	const showTop = () => {
		const top = inline.at(-1) ?? editor;
		editorContainer.clear(); editorContainer.addChild(top); tui.setFocus(top);
		tui.requestRender();
	};
	ctx.ui.custom = <T>(factory: Parameters<ExtensionUIContext["custom"]>[0], options?: CustomOptions): Promise<T> => new Promise((resolve, reject) => {
		let component: DialogComponent | undefined;
		let closed = false;
		let overlayHandle: OverlayHandle | undefined;
		const record = { options, mounted: false, doneCalls: 0 } as typeof dialogs[number];
		const done = (value: unknown) => {
			record.doneCalls++;
			if (closed) return;
			closed = true;
			record.mounted = false;
			if (options?.overlay) overlayHandle?.hide();
			else {
				const index = component ? inline.indexOf(component) : -1;
				if (index >= 0) {
					inline.splice(index, 1);
					if (index === inline.length) showTop();
				}
			}
			resolve(value as T);
			try { component?.dispose?.(); } catch { /* the host ignores dispose errors */ }
		};
		Promise.resolve(factory(tui, ctx.ui.theme, bindings as Parameters<Parameters<ExtensionUIContext["custom"]>[0]>[2], done)).then((value) => {
			if (closed) return;
			component = value;
			record.component = component;
			record.mounted = true;
			if (options?.overlay) {
				const overlayOptions = typeof options.overlayOptions === "function" ? options.overlayOptions() : options.overlayOptions;
				overlayHandle = tui.showOverlay(component, overlayOptions);
				record.handle = overlayHandle;
				options?.onHandle?.(overlayHandle);
			} else { inline.push(component); showTop(); }
			dialogs.push(record);
			tui.renderNow();
		}).catch(reject);
	});
	const start = (controller: AbortController, options: ChoiceInput[] = choices, allowCustom = false, questionText = question) =>
		h.tools.get("clarify")!.execute("ui-test", { question: questionText, options, allowCustom, customPrompt: "line one\nline two" }, controller.signal, undefined, toolCtx);
	tui.start();
	tui.renderNow();
	/** Start a clarify call and wait until its selector is installed. */
	const open = async (controller: AbortController, options: ChoiceInput[] = choices, allowCustom = false, questionText = question) => {
		const previousCount = dialogs.length;
		const result = start(controller, options, allowCustom, questionText);
		await flushDialogs();
		assert.equal(dialogs.length, previousCount + 1, "exactly one fresh selector installed");
		return { result, dialog: dialogs.at(-1)! };
	};
	const input = (data: string) => { terminalInput(data); tui.renderNow(); };
	return {
		...h, ctx, toolCtx, terminal, tui, transcript, editor, dialogs, writes, copied, openedUrls, start, bindings,
		input,
		/** Locate the first rendered panel line; a fully clipped panel has no screen bounds. */
		bounds(dialog: typeof dialogs[number]) {
			if (!dialog.mounted) return undefined;
			if (dialog.handle) return dialog.handle.getBounds();
			const rendered = dialog.component.render(size.columns).map(stripVTControlCharacters);
			const text = tui instanceof TuiAltScreen ? tui.getScreenLines().map(stripVTControlCharacters) : [];
			const row = text.findIndex((line) => line.trimEnd() === rendered[0]?.trimEnd());
			return row < 0 ? undefined : { row, col: 0, width: size.columns, height: rendered.length };
		},
		wheel(button = 65, alt = false) {
			const text = tui instanceof TuiAltScreen ? tui.getScreenLines().map(stripVTControlCharacters) : [];
			const row = text.findIndex((line) => /Context \d+-\d+|→|Custom instructions/.test(line));
			assert.ok(row >= 0, "a panel row is visible for wheel hit-testing");
			terminalInput(`\x1b[<${button | (alt ? 8 : 0)};2;${row + 1}M`);
			tui.renderNow();
		},
		resize(columns: number, rows: number) { size.columns = columns; size.rows = rows; notifyResize(); tui.renderNow(); },
		/** Hardware cursor cell (zero-based) of the most recent frame that positioned it. */
		cursor(): { row: number; col: number } | undefined {
			const matches = [...writes.join("").matchAll(/\x1b\[(\d+);(\d+)H\x1b\[\?25[hl]/g)];
			const last = matches.at(-1);
			return last ? { row: Number(last[1]) - 1, col: Number(last[2]) - 1 } : undefined;
		},
		/** Start a clarify call and wait until its selector is installed. */
		open,
		/** Start a clarify call, choose "Custom instructions" and wait until the answer editor is installed. */
		async openEditor(controller: AbortController, questionText = question) {
			const { result, dialog: selector } = await open(controller, [{ label: "First" }], true, questionText);
			const previousCount = dialogs.length;
			input("\x1b[B");
			input("\r");
			await flushDialogs();
			assert.equal(dialogs.length, previousCount + 1, "exactly one fresh answer editor installed");
			return { result, selector, dialog: dialogs.at(-1)! };
		},
	};
}

export function lines(dialog: { component: DialogComponent; handle?: OverlayHandle }, fallbackWidth = 80) {
	return dialog.component.render(dialog.handle?.getBounds()?.width ?? fallbackWidth).map(stripVTControlCharacters);
}
/** Composed fullscreen screen text after the public renderer laid out the transcript and dock. */
export function screen(h: { tui: unknown }): string[] {
	assert.ok(h.tui instanceof TuiAltScreen);
	return h.tui.getScreenLines().map(stripVTControlCharacters);
}
export function contextStart(dialog: Parameters<typeof lines>[0]): number {
	const status = lines(dialog).find((line) => /Context \d+-\d+\/40/.test(line));
	assert.ok(status, "long question has context position");
	return Number(/Context (\d+)-/.exec(status)![1]);
}

/** Default `tui.altScreen.search` binding (verified against the actual host in clarify-host.test.ts). */
export const SEARCH_KEY = "\x1b[102;6u";

export const scrollingInputs = [
	["Ctrl+PageDown", "\x1b[6;5~", "\x1b[H", 1],
	["Ctrl+PageUp", "\x1b[5;5~", "\x1b[F", -1],
	["Home", "\x1b[H", "\x1b[F", -1],
	["End", "\x1b[F", "\x1b[H", 1],
] as const;

