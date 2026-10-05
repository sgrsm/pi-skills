import assert from "node:assert/strict";
import test from "node:test";
import { contextStart, createUi, lines, scrollingInputs } from "./clarifyUiFixture.ts";

// Working routes are contract regressions. Outstanding TDR-0003 requirements
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

	test(`focused custom overlay control: routes ${name} to clarify`, async (t) => {
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

