import assert from "node:assert/strict";
import test from "node:test";
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
 * Audit characterizations for deferred 0003, not acceptance tests declaring the
 * defects intentional. Revisit these expectations when the host/extension is fixed.
 * Public host routing plus faithful custom() mounting/completion; no private imports.
 */
function createUi(mode: "fullscreen" | "regular", presentation: "current-dock" | "custom-overlay-probe" = "current-dock") {
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

function lines(dialog: { component: DialogComponent; handle?: OverlayHandle }, fallbackWidth = 80) {
	return dialog.component.render(dialog.handle?.getBounds()?.width ?? fallbackWidth).map(stripVTControlCharacters);
}
function contextStart(dialog: Parameters<typeof lines>[0]): number {
	const status = lines(dialog).find((line) => /Context \d+-\d+\/40/.test(line));
	assert.ok(status, "long question has context position");
	return Number(/Context (\d+)-/.exec(status)![1]);
}

const scrollingInputs = [
	["PageDown", "\x1b[6~", "\x1b[H", 1],
	["PageUp", "\x1b[5~", "\x1b[F", -1],
	["Home", "\x1b[H", "\x1b[F", -1],
	["End", "\x1b[F", "\x1b[H", 1],
	["wheel", "\x1b[<65;10;10M", "\x1b[H", 1],
] as const;

for (const [name, key, initialKey, direction] of scrollingInputs) {
	test(`deferred 0003: current fullscreen dock loses ${name} to the transcript`, async (t) => {
		const h = createUi("fullscreen");
		const abort = new AbortController();
		t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
		const { result, dialog } = await h.open(abort);
		assert.equal(dialog.options?.overlay, undefined, "current selector is dock-mounted");
		dialog.component.handleInput!(initialKey);
		h.transcript.scrollTo(30);
		h.tui.renderNow();
		const before = contextStart(dialog);
		const transcriptBefore = h.transcript.scrollTop;
		h.input(key);
		assert.equal(contextStart(dialog), before, "known defect: question receives no scroll input");
		assert.notEqual(h.transcript.scrollTop, transcriptBefore, "actual host viewport consumed the input");
		abort.abort();
		assert.equal((await result).details.answerType, "cancelled");
		assert.equal(dialog.doneCalls, 1);
	});

	test(`0003 host control: focused custom overlay routes ${name} to clarify`, async (t) => {
		const h = createUi("fullscreen", "custom-overlay-probe");
		const abort = new AbortController();
		t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
		const { result, dialog } = await h.open(abort);
		assert.equal(dialog.handle?.isFocused(), true);
		dialog.component.handleInput!(initialKey);
		h.tui.renderNow();
		const before = contextStart(dialog);
		const transcriptBefore = h.transcript.scrollTop;
		// This component has no handleMouse: wheel control exercises the host's
		// raw-SGR fallback, not normalized mouse support in the extension.
		h.input(key);
		assert.ok(direction * (contextStart(dialog) - before) > 0, "overlay fixes this route in isolation");
		assert.equal(h.transcript.scrollTop, transcriptBefore);
		abort.abort();
		assert.equal((await result).details.answerType, "cancelled");
	});
}

for (const mode of ["fullscreen", "regular"] as const) {
	test(`deferred 0003: current ${mode} selector emits mouse-mode toggles while the renderer is active`, async (t) => {
		const h = createUi(mode);
		const abort = new AbortController();
		t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
		if (mode === "fullscreen") {
			const hostStart = h.writes.join("");
			assert.ok(hostStart.includes("\x1b[?1000h") && hostStart.includes("\x1b[?1006h"), "host enabled its mouse tracking before the interaction");
		}
		h.writes.length = 0; // Now isolate clarify interaction writes from host start/stop.
		const { result, dialog } = await h.open(abort);
		assert.ok(h.writes.join("").includes("\x1b[?1000h\x1b[?1006h"));
		abort.abort();
		assert.equal((await result).details.answerType, "cancelled");
		assert.ok(h.writes.join("").includes("\x1b[?1000l\x1b[?1006l"));
		assert.equal(dialog.doneCalls, 1);
	});
}

test("0003 control: current regular-mode selector remains keyboard-complete", async (t) => {
	const h = createUi("regular");
	const abort = new AbortController();
	t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
	const { result, dialog } = await h.open(abort);
	const start = contextStart(dialog);
	h.input("\x1b[<65;10;10M");
	assert.equal(contextStart(dialog), start + 3, "regular-mode raw SGR wheel path also works in the fake terminal");
	h.input("\x1b[6~");
	assert.ok(contextStart(dialog) > start);
	h.input("\x1b[F");
	assert.match(lines(dialog).join("\n"), /Context line 40/);
	h.input("\x1b[H");
	assert.equal(contextStart(dialog), 1);
	h.input("\x1b[B");
	assert.match(lines(dialog).join("\n"), /Second description/);
	h.input("\r");
	assert.equal((await result).details.selectedIndex, 2);
	assert.equal(dialog.doneCalls, 1);
	assert.equal(h.tui.getFocusedComponent(), h.editor);
});

test("deferred 0003: fullscreen fixed dock clips the existing selector help", async (t) => {
	const h = createUi("fullscreen");
	const abort = new AbortController();
	t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
	const { result } = await h.open(abort);
	assert.ok(h.tui instanceof TuiAltScreen);
	const screen = h.tui.getScreenLines().map(stripVTControlCharacters).join("\n");
	assert.match(screen, /Clarify/);
	assert.match(screen, /→ 1\. First/);
	assert.doesNotMatch(screen, /navigate • Enter select • Esc cancel/, "known defect: bottom help was clipped");
	abort.abort();
	await result;
});

test("0003 host blocker: search stacked above custom overlay leaves a cancelled selector mounted", async (t) => {
	const h = createUi("fullscreen", "custom-overlay-probe");
	const abort = new AbortController();
	t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
	const { result, dialog } = await h.open(abort);
	h.input("\x1b[102;6u"); // Actual host transcript-search action, no private calls.
	assert.notEqual(h.tui.getFocusedComponent(), dialog.component, "search takes focus");
	abort.abort();
	assert.equal((await result).details.answerType, "cancelled");
	h.tui.renderNow();
	assert.ok(dialog.handle?.getBounds(), "known host defect: it popped search instead of the owned selector");
	assert.equal(h.tui.getFocusedComponent(), dialog.component);
	h.input("\x1b"); // The settled completion callback cannot dismiss the stale selector.
	assert.ok(dialog.handle?.getBounds(), "cancelled dialog is a dead modal");
	assert.equal(dialog.doneCalls, 1);
});

test("0003 host blocker: abort before custom overlay installation pops an unrelated overlay", async (t) => {
	const h = createUi("fullscreen", "custom-overlay-probe");
	const abort = new AbortController();
	t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
	const other = h.tui.showOverlay(new Text("Unrelated overlay", 0, 0));
	h.tui.renderNow();
	assert.ok(other.getBounds());
	const custom = h.ctx.ui.custom;
	h.ctx.ui.custom = (factory, options) => custom((tui, theme, kb, done) => {
		const component = factory(tui, theme, kb, done);
		abort.abort(); // Between factory return and host installation.
		return component;
	}, options);
	const result = await h.tools.get("clarify")!.execute("pre-install", {
		question, options: choices, allowCustom: false,
	}, abort.signal, undefined, h.toolCtx);
	assert.equal(result.details.answerType, "cancelled");
	assert.equal(h.dialogs.length, 0, "owned overlay never installed");
	assert.equal(other.getBounds(), undefined, "known host defect: pre-install close popped someone else's overlay");
});
