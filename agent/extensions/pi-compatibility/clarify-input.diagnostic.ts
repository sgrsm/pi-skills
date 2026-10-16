import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { TuiAltScreen } from "@earendil-works/pi-tui";
import { contextStart, createUi, scrollingInputs } from "./clarifyUiFixture.ts";

// Positive acceptance checks for open TDR-20261009-1201, run via diagnose:pi-host.
// The public renderer is real; custom() installation is a test adapter, so adapter
// lifecycle assertions (clarify-input.test.ts) alone cannot prove a host correction.
for (const [name, key, initialKey, direction] of scrollingInputs) {
	if (name === "Home" || name === "End") continue; // Positive contract tests cover these working routes.
	test(`TDR-20261009-1201: fullscreen dock routes ${name} to the question, not the transcript`, async (t) => {
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

// Fullscreen ownership is now a contract regression in clarify-input.test.ts.
// Removing regular-mode mouse toggles remains outside the scoped runtime fix.
test("TDR-20261009-1201: regular clarify does not take over terminal mouse modes", async (t) => {
	const h = createUi("regular");
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

test("TDR-20261009-1201: fullscreen clarify keeps navigation help visible at 80x24", async (t) => {
	const h = createUi("fullscreen");
	const abort = new AbortController();
	t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
	await h.open(abort);
	assert.ok(h.tui instanceof TuiAltScreen);
	assert.match(h.tui.getScreenLines().map(stripVTControlCharacters).join("\n"), /navigate • Enter select • Esc cancel/);
});
