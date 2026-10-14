import assert from "node:assert/strict";
import test from "node:test";
import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";
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

