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

type CustomOptions = Parameters<ExtensionUIContext["custom"]>[1];
type DialogComponent = Component & { dispose?(): void };

/**
 * Public renderer fixture for contract tests and explicit host diagnostics.
 * custom() completion is a test adapter, not an actual host-method invocation.
 * Compare it with the host close path after upgrades; see TDR-0003.
 */
export function createUi(mode: "fullscreen" | "regular", presentation: "current-dock" | "custom-overlay-probe" = "current-dock") {
	const bindings = new KeybindingsManager(TUI_KEYBINDINGS);
	const h = createDialogHarness();
	clarifyExtension(h.pi, { loadModeState: () => ({ enabled: true }) });
	const ctx = h.context(undefined, "tui");
	const toolCtx: ExtensionToolContext = { ...ctx, tools: [], executeTool: async () => { throw new Error("no nested execution in this fixture"); } };
	const writes: string[] = [];
	let input: (data: string) => void = () => { throw new Error("terminal not started"); };
	const terminal = {
		columns: 80, rows: 24, kittyProtocolActive: false,
		start(onInput) { input = onInput; },
		stop() {}, async drainInput() {}, write(data) { writes.push(data); }, moveBy() {},
		hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {},
		clearScreen() {}, setTitle() {}, setProgress() {},
	} satisfies Terminal;
	const tui = mode === "fullscreen"
		? new TuiAltScreen(terminal, false, undefined, { wheelScrollLines: 3 })
		: new TuiMainScreen(terminal);
	const editor = new Text("Main editor", 0, 0);
	const editorContainer = new Container();
	editorContainer.addChild(editor);
	const transcript = new ScrollView(new Text("Transcript\n".repeat(100), 0, 0), { primary: true, follow: "end", scrollbar: "hidden" });
	// Simplified Pi 1.0 fixed-dock composition built with public layout APIs.
	const dock = new VStack([
		{ component: editorContainer, shrink: 1, minSize: 3 },
		{ component: new Text("Footer\nStats\nStatus", 0, 0), shrink: 1, minSize: 0 },
	]);
	if (tui instanceof TuiAltScreen) tui.setLayoutRoot(new VStack([
		{ component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
		{ component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
	]));
	else { tui.addChild(new Text("Transcript", 0, 0)); tui.addChild(editorContainer); }
	tui.setFocus(editor);
	const dialogs: Array<{ component: DialogComponent; options: CustomOptions; handle?: OverlayHandle; doneCalls: number }> = [];
	ctx.ui.custom = <T>(factory: Parameters<ExtensionUIContext["custom"]>[0], options?: CustomOptions): Promise<T> => new Promise((resolve, reject) => {
		// Probe the proposed custom-overlay approach without modifying runtime code.
		if (presentation === "custom-overlay-probe") options = {
			overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", margin: 1 },
		};
		let component: DialogComponent | undefined;
		let closed = false;
		const record = { options, doneCalls: 0 } as typeof dialogs[number];
		const done = (value: unknown) => {
			record.doneCalls++;
			if (closed) return;
			closed = true;
			if (options?.overlay) tui.hideOverlay();
			else { editorContainer.clear(); editorContainer.addChild(editor); tui.setFocus(editor); }
			resolve(value as T);
			component?.dispose?.();
		};
		Promise.resolve(factory(tui, ctx.ui.theme, bindings as Parameters<Parameters<ExtensionUIContext["custom"]>[0]>[2], done)).then((value) => {
			if (closed) return;
			component = value;
			record.component = component;
			if (options?.overlay) {
				const overlayOptions = typeof options.overlayOptions === "function" ? options.overlayOptions() : options.overlayOptions;
				record.handle = tui.showOverlay(component, overlayOptions);
			} else { editorContainer.clear(); editorContainer.addChild(component); tui.setFocus(component); }
			dialogs.push(record);
			tui.renderNow();
		}).catch(reject);
	});
	tui.start();
	tui.renderNow();
	return {
		...h, ctx, toolCtx, terminal, tui, transcript, editor, dialogs, writes,
		input(data: string) { input(data); tui.renderNow(); },
		async open(controller: AbortController, options = choices, allowCustom = false) {
			const previousCount = dialogs.length;
			const result = h.tools.get("clarify")!.execute("ui-test", { question, options, allowCustom, customPrompt: "line one\nline two" }, controller.signal, undefined, toolCtx);
			await flushDialogs();
			assert.equal(dialogs.length, previousCount + 1, "exactly one fresh selector installed");
			return { result, dialog: dialogs.at(-1)! };
		},
	};
}

export function lines(dialog: { component: DialogComponent; handle?: OverlayHandle }, fallbackWidth = 80) {
	return dialog.component.render(dialog.handle?.getBounds()?.width ?? fallbackWidth).map(stripVTControlCharacters);
}
export function contextStart(dialog: Parameters<typeof lines>[0]): number {
	const status = lines(dialog).find((line) => /Context \d+-\d+\/40/.test(line));
	assert.ok(status, "long question has context position");
	return Number(/Context (\d+)-/.exec(status)![1]);
}

export const scrollingInputs = [
	["PageDown", "\x1b[6~", "\x1b[H", 1],
	["PageUp", "\x1b[5~", "\x1b[F", -1],
	["Home", "\x1b[H", "\x1b[F", -1],
	["End", "\x1b[F", "\x1b[H", 1],
	["wheel", "\x1b[<65;10;10M", "\x1b[H", 1],
] as const;

