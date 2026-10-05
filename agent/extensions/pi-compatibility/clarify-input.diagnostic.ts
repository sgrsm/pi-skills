import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { Text, TuiAltScreen } from "@earendil-works/pi-tui";
import { contextStart, createUi, scrollingInputs } from "./clarifyUiFixture.ts";

// Positive acceptance checks for open TDR-0003, run via diagnose:pi-host.
// The public renderer is real; custom() installation/close is a test adapter.
// Reconstruct the actual-host scratch probe in TDR-0003 after host upgrades:
// these adapter lifecycle assertions alone cannot prove a host correction.
for (const [name, key, initialKey, direction] of scrollingInputs) {
	if (name === "Home" || name === "End") continue; // Positive contract tests cover these working routes.
	test(`TDR-0003: fullscreen dock routes ${name} to the question, not the transcript`, async (t) => {
		t.diagnostic(`Pi ${VERSION}; public fullscreen renderer, fake terminal`);
		const h = createUi("fullscreen");
		const abort = new AbortController();
		t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
		const { dialog } = await h.open(abort);
		dialog.component.handleInput!(initialKey);
		h.transcript.scrollTo(30);
		h.tui.renderNow();
		const before = contextStart(dialog);
		const transcriptBefore = h.transcript.scrollTop;
		h.input(key);
		t.diagnostic(JSON.stringify({ questionBefore: before, questionAfter: contextStart(dialog),
			transcriptBefore, transcriptAfter: h.transcript.scrollTop }));
		assert.ok(direction * (contextStart(dialog) - before) > 0, "question must receive scrolling input");
		assert.equal(h.transcript.scrollTop, transcriptBefore, "transcript must not consume dialog input");
	});
}

for (const mode of ["fullscreen", "regular"] as const) {
	test(`TDR-0003: ${mode} clarify does not take over terminal mouse modes`, async (t) => {
		const h = createUi(mode);
		const abort = new AbortController();
		t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
		h.writes.length = 0; // Exclude renderer startup/shutdown writes.
		const { result, dialog } = await h.open(abort);
		abort.abort();
		assert.equal((await result).details.answerType, "cancelled");
		assert.equal(dialog.doneCalls, 1);
		const writes = h.writes.join("");
		assert.ok(!writes.includes("\x1b[?1000h") && !writes.includes("\x1b[?1006h") &&
			!writes.includes("\x1b[?1000l") && !writes.includes("\x1b[?1006l"),
			"the extension must leave mouse reporting ownership to the renderer/terminal");
	});
}

test("TDR-0003: fullscreen clarify keeps navigation help visible at 80x24", async (t) => {
	const h = createUi("fullscreen");
	const abort = new AbortController();
	t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
	await h.open(abort);
	assert.ok(h.tui instanceof TuiAltScreen);
	assert.match(h.tui.getScreenLines().map(stripVTControlCharacters).join("\n"), /navigate • Enter select • Esc cancel/);
});

test("TDR-0003: adapter contract removes the cancelled owned overlay while preserving search", async (t) => {
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

test("TDR-0003: adapter contract preserves unrelated overlays on abort before installation", async (t) => {
	const h = createUi("fullscreen", "custom-overlay-probe");
	const abort = new AbortController();
	t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
	const other = h.tui.showOverlay(new Text("Unrelated overlay", 0, 0));
	h.tui.renderNow();
	assert.ok(other.getBounds());
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
});
