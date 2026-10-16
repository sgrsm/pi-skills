import assert from "node:assert/strict";
import test from "node:test";
import { Text, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { flushDialogs } from "../shared/dialogTestHarness.ts";
import { showCancellableCustom } from "../shared/dialogUi.ts";
import { contextStart, createUi, lines, scrollingInputs } from "./clarifyUiFixture.ts";

// Working routes are contract regressions. Outstanding TDR-20261009-1201 requirements
// are positive acceptance checks in clarify-input.diagnostic.ts.
for (const completion of ["selection", "escape", "abort"] as const) {
	test(`fullscreen clarify preserves host mouse modes and transcript scrolling after ${completion}`, async (t) => {
		const h = createUi("fullscreen");
		const abort = new AbortController();
		t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
		h.writes.length = 0; // Exclude renderer startup/shutdown mouse-mode writes.
		const { result, dialog } = await h.open(abort);
		assert.equal(dialog.options?.overlay, undefined);
		assert.doesNotMatch(h.writes.join(""), /\x1b\[\?100[0236][hl]/, "opening clarify must leave host mouse modes alone");
		if (completion === "selection") h.input("\r");
		else if (completion === "escape") h.input("\x1b");
		else abort.abort();
		assert.equal((await result).details.answerType, completion === "selection" ? "option" : "cancelled");
		assert.equal(dialog.doneCalls, 1);
		assert.equal(h.tui.getFocusedComponent(), h.editor);
		assert.doesNotMatch(h.writes.join(""), /\x1b\[\?100[0236][hl]/, "closing clarify must leave host mouse modes alone");
		h.transcript.scrollTo(30);
		h.tui.renderNow();
		const before = h.transcript.scrollTop;
		h.input("\x1b[<65;10;10M");
		assert.ok(h.transcript.scrollTop > before, "wheel input must still scroll the transcript after the dialog closes");
	});
}

for (const [name, key, initialKey, direction] of scrollingInputs) {
	if (name === "Home" || name === "End") {
		test(`fullscreen dock routes ${name} to clarify without moving the transcript`, async (t) => {
			const h = createUi("fullscreen");
			const abort = new AbortController();
			t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
			const { result, dialog } = await h.open(abort);
			assert.equal(dialog.options?.overlay, undefined);
			dialog.component.handleInput!(initialKey);
			h.transcript.scrollTo(30);
			h.tui.renderNow();
			const before = contextStart(dialog);
			const transcriptBefore = h.transcript.scrollTop;
			h.input(key);
			assert.ok(direction * (contextStart(dialog) - before) > 0);
			assert.equal(h.transcript.scrollTop, transcriptBefore);
			abort.abort();
			assert.equal((await result).details.answerType, "cancelled");
			assert.equal(dialog.doneCalls, 1);
		});
	}

	// Wheel routing is covered by independent host-contract probes below.
	if (name === "wheel") continue;
	test(`focused custom overlay keyboard control: routes ${name} to clarify`, async (t) => {
		const h = createUi("fullscreen", "custom-overlay-probe");
		const abort = new AbortController();
		t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
		const { result, dialog } = await h.open(abort);
		assert.equal(dialog.handle?.isFocused(), true);
		dialog.component.handleInput!(initialKey);
		h.tui.renderNow();
		const before = contextStart(dialog);
		const transcriptBefore = h.transcript.scrollTop;
		h.input(key);
		assert.ok(direction * (contextStart(dialog) - before) > 0, "focused overlay must own this keyboard route");
		assert.equal(h.transcript.scrollTop, transcriptBefore);
		abort.abort();
		assert.equal((await result).details.answerType, "cancelled");
	});
}

// Renderer-routing controls, not a proposed Clarify presentation or lifecycle fix.
// Direct showOverlay() lets these probes avoid the copied custom() completion adapter.
for (const handling of ["handled", "unhandled", "raw-only"] as const) {
	test(`fullscreen overlay wheel contract: ${handling}`, (t) => {
		const h = createUi("fullscreen");
		const mouseEvents: TuiMouseEvent[] = [];
		const rawInputs: string[] = [];
		const probe: Component = {
			render: () => ["Wheel routing probe", "", ""],
			invalidate() {},
			handleInput: (data) => { rawInputs.push(data); },
			handleMouse: handling === "raw-only" ? undefined : (event) => {
				mouseEvents.push(event);
				return handling === "handled" ? { handled: true } : undefined;
			},
		};
		h.transcript.scrollTo(30);
		const handle = h.tui.showOverlay(probe, { row: 2, col: 4, width: 24 });
		t.after(() => { handle.hide(); h.tui.stop({ preserveScreen: true }); });
		h.tui.renderNow();
		assert.equal(handle.isFocused(), true);
		const bounds = handle.getBounds();
		assert.ok(bounds, "the probe must be mounted and rendered before mouse hit-testing");
		assert.ok(bounds.width > 2 && bounds.height > 2);
		const screenX = bounds.col + 1;
		const screenY = bounds.row + 1;
		const before = h.transcript.scrollTop;
		// Overlay bounds are zero-based; raw SGR coordinates are one-based.
		h.input(`\x1b[<65;${screenX + 1};${screenY + 1}M`);
		assert.deepEqual(rawInputs, [], "wheel events must not fall back to raw overlay input");
		assert.deepEqual(mouseEvents, handling === "raw-only" ? [] : [{
			type: "wheel", button: "none", x: 1, y: 1, screenX, screenY,
			width: bounds.width, height: bounds.height,
			shift: false, alt: false, ctrl: false, wheelDelta: 3,
		}]);
		assert.equal(h.transcript.scrollTop, before + (handling === "handled" ? 0 : 3),
			"only handled normalized wheel input may suppress transcript fallback");
	});
}

test("regular-mode clarify remains keyboard-complete", async (t) => {
	const h = createUi("regular");
	const abort = new AbortController();
	t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
	h.writes.length = 0;
	const { result, dialog } = await h.open(abort);
	assert.deepEqual(h.writes.join("").match(/\x1b\[\?100[0236][hl]/g), ["\x1b[?1000h", "\x1b[?1006h"]);
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
	assert.deepEqual(h.writes.join("").match(/\x1b\[\?100[0236][hl]/g), [
		"\x1b[?1000h", "\x1b[?1006h", "\x1b[?1000l", "\x1b[?1006l",
	], "regular-mode mouse setup and cleanup remain unchanged");
});

// Adapter-faithfulness controls. The adapter mirrors Pi 1.3 showExtensionCustom():
// an overlay interaction completes by hiding its own handle, never the topmost overlay.
// These are copied-adapter checks; the version-checked actual-host probe in
// TDR-20261009-1201 is the independent evidence for the real host method.
const overlayOptions = { overlay: true } as const;
const probeComponent = (label: string) => ({
	label, disposed: 0, render: () => [label], invalidate() {}, dispose() { this.disposed++; },
});

test("adapter lifecycle contract (Pi 1.3 close path): normal mounted completion removes the owned overlay and disposes once", async (t) => {
	const h = createUi("fullscreen");
	t.after(() => h.tui.stop({ preserveScreen: true }));
	const component = probeComponent("owned");
	let complete!: (value: string) => void;
	const result = h.ctx.ui.custom<string>((_tui, _theme, _kb, done) => { complete = done; return component; }, overlayOptions);
	await flushDialogs();
	assert.ok(h.dialogs.at(-1)?.handle?.getBounds(), "owned overlay mounted");
	complete("first"); complete("second");
	assert.equal(await result, "first");
	h.tui.renderNow();
	assert.equal(h.dialogs.at(-1)?.handle?.getBounds(), undefined);
	assert.equal(h.tui.getFocusedComponent(), h.editor);
	assert.equal(component.disposed, 1);
});

for (const timing of ["inside the factory", "in a microtask before installation"] as const) {
	test(`adapter lifecycle contract (Pi 1.3 close path): completion ${timing} preserves an unrelated overlay`, async (t) => {
		const h = createUi("fullscreen");
		t.after(() => h.tui.stop({ preserveScreen: true }));
		const unrelated = new Text("Unrelated overlay", 0, 0);
		const other = h.tui.showOverlay(unrelated);
		h.tui.renderNow();
		assert.equal(h.tui.getFocusedComponent(), unrelated, "unrelated overlay starts focused");
		const component = probeComponent("never-installed");
		const result = h.ctx.ui.custom<string>((_tui, _theme, _kb, done) => {
			if (timing === "inside the factory") done("early");
			else queueMicrotask(() => done("early"));
			return component;
		}, overlayOptions);
		assert.equal(await result, "early");
		h.tui.renderNow();
		assert.equal(h.dialogs.length, 0, "never-installed interaction must not mount");
		assert.ok(other.getBounds(), "unrelated overlay must survive");
		assert.equal(h.tui.getFocusedComponent(), unrelated, "unrelated overlay must keep focus");
		assert.equal(component.disposed, 0, "the raw host skips disposal of a never-installed component");
	});
}

test("adapter lifecycle contract (Pi 1.3 close path): cancelled owned overlay is removed while stacked search keeps focus", async (t) => {
	const h = createUi("fullscreen", "custom-overlay-probe");
	const abort = new AbortController();
	t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
	const { result, dialog } = await h.open(abort);
	h.input("\x1b[102;6u");
	const search = h.tui.getFocusedComponent();
	assert.notEqual(search, dialog.component, "search must actually be above the custom overlay");
	abort.abort();
	assert.equal((await result).details.answerType, "cancelled");
	h.tui.renderNow();
	assert.equal(dialog.handle?.getBounds(), undefined, "owned overlay must no longer be mounted");
	assert.equal(h.tui.getFocusedComponent(), search, "unrelated search must retain focus");
	assert.equal(dialog.doneCalls, 1);
});

test("adapter lifecycle contract (Pi 1.3 close path): abort before installation preserves unrelated overlays", async (t) => {
	const h = createUi("fullscreen", "custom-overlay-probe");
	const abort = new AbortController();
	t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
	const unrelated = new Text("Unrelated overlay", 0, 0);
	const other = h.tui.showOverlay(unrelated);
	h.tui.renderNow();
	assert.ok(other.getBounds());
	assert.equal(h.tui.getFocusedComponent(), unrelated, "unrelated overlay starts focused");
	const custom = h.ctx.ui.custom;
	h.ctx.ui.custom = (factory, options) => custom((tui, theme, kb, done) => {
		const component = factory(tui, theme, kb, done);
		abort.abort();
		return component;
	}, options);
	const result = await h.tools.get("clarify")!.execute("pre-install", {
		question: "Which option?", options: [{ label: "First" }, { label: "Second" }], allowCustom: false,
	}, abort.signal, undefined, h.toolCtx);
	assert.equal(result.details.answerType, "cancelled");
	assert.equal(h.dialogs.length, 0);
	assert.ok(other.getBounds(), "unrelated overlay must survive pre-install cancellation");
	assert.equal(h.tui.getFocusedComponent(), unrelated, "unrelated overlay must keep focus");
});

test("adapter lifecycle contract (Pi 1.3 close path): showCancellableCustom pre-install abort disposes once and preserves unrelated overlay", async (t) => {
	const h = createUi("fullscreen", "custom-overlay-probe");
	const abort = new AbortController();
	t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
	const unrelated = new Text("Unrelated overlay", 0, 0);
	const other = h.tui.showOverlay(unrelated);
	h.tui.renderNow();
	const before = other.getBounds();
	assert.ok(before);
	assert.equal(h.tui.getFocusedComponent(), unrelated, "unrelated overlay starts focused");
	const component = probeComponent("retained");
	const result = showCancellableCustom<string>(h.ctx.ui, abort.signal, () => { abort.abort(); return component; });
	await assert.rejects(result, (error) => error === abort.signal.reason);
	h.tui.renderNow();
	assert.equal(component.disposed, 1, "wrapper must dispose the retained component exactly once");
	assert.equal(h.dialogs.length, 0, "aborted interaction must not mount a dialog");
	assert.deepEqual(other.getBounds(), before, "unrelated overlay bounds must be unchanged");
	assert.equal(h.tui.getFocusedComponent(), unrelated, "unrelated overlay must keep focus");
});
