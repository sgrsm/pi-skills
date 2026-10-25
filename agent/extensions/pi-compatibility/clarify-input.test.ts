import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import { CURSOR_MARKER, Text, TuiAltScreen, visibleWidth, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { clarifyDockHeight } from "../clarify/selector.ts";
import { flushDialogs } from "../shared/dialogTestHarness.ts";
import { showCancellableCustom } from "../shared/dialogUi.ts";
import { contextStart, createUi, lines, screen, scrollingInputs, SEARCH_KEY } from "./clarifyUiFixture.ts";

// Clarify replaces the normal editor slot with a bounded panel below the transcript.
// These tests use the public fullscreen/regular renderers with fake terminals.
// Lifecycle assertions go through a copied custom() adapter that mirrors Pi 1.4's close path; the
// bounded actual-host subprocess in clarify-host.test.ts covers the real InteractiveMode.
/** Collapse whitespace so assertions survive wrapping at any width. */
const flat = (text: string[]) => text.join(" ").replace(/\s+/g, " ");
const plain = (line: string) => stripVTControlCharacters(line.replace(/\x1b_pi:[^\x07]*\x07/g, "")).trimEnd();
const cleanup = (t: test.TestContext, h: ReturnType<typeof createUi>, abort: AbortController) =>
	t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
const mouseModes = /\x1b\[\?100[0236][hl]/;
const wheel = (x = 10, y = 10, button = 65) => `\x1b[<${button};${x};${y}M`;
const manyOptions = Array.from({ length: 30 }, (_, i) => ({ label: `Option number ${i + 1}`, description: `Description ${i + 1}` }));
const longDescription = Array.from({ length: 10 }, (_, i) => `Detail sentence ${i + 1} explains consequences.`).join(" ");

for (const mode of ["fullscreen", "regular"] as const) {
	for (const completion of ["selection", "escape", "abort"] as const) {
		test(`${mode} clarify never touches host mouse modes and restores focus after ${completion}`, async (t) => {
			const h = createUi(mode);
			const abort = new AbortController();
			cleanup(t, h, abort);
			h.writes.length = 0; // Exclude renderer startup/shutdown mouse-mode writes.
			const { result, dialog } = await h.open(abort);
			assert.notEqual(dialog.options?.overlay, true, "selector uses the editor slot");
			assert.equal(dialog.handle, undefined, "no overlay is mounted");
			assert.equal(h.tui.getFocusedComponent(), dialog.component);
			assert.doesNotMatch(h.writes.join(""), mouseModes, "opening clarify must leave mouse reporting alone");
			if (completion === "selection") h.input("\r");
			else if (completion === "escape") h.input("\x1b");
			else abort.abort();
			assert.equal((await result).details.answerType, completion === "selection" ? "option" : "cancelled");
			h.tui.renderNow();
			assert.equal(dialog.doneCalls, 1);
			assert.equal(dialog.mounted, false, "panel removed by host completion");
			assert.equal(h.tui.getFocusedComponent(), h.editor);
			assert.doesNotMatch(h.writes.join(""), mouseModes, "closing clarify must leave mouse reporting alone");
			if (mode === "fullscreen") {
				h.transcript.scrollTo(30);
				h.tui.renderNow();
				const before = h.transcript.scrollTop;
				h.input(wheel());
				assert.ok(h.transcript.scrollTop > before, "wheel input must still scroll the transcript after the dialog closes");
			}
		});
	}
}

for (const [name, key, initialKey, direction] of scrollingInputs) {
	test(`fullscreen dock routes ${name} to the question, not the transcript`, async (t) => {
		const h = createUi("fullscreen");
		const abort = new AbortController();
		cleanup(t, h, abort);
		const { result, dialog } = await h.open(abort);
		h.input(initialKey);
		h.transcript.scrollTo(30);
		h.tui.renderNow();
		const before = contextStart(dialog);
		const transcriptBefore = h.transcript.scrollTop;
		h.input(key);
		assert.ok(direction * (contextStart(dialog) - before) > 0, "question must receive the scrolling input");
		assert.equal(h.transcript.scrollTop, transcriptBefore, "transcript must not consume dialog input");
		abort.abort();
		assert.equal((await result).details.answerType, "cancelled");
		assert.equal(dialog.doneCalls, 1);
	});
}

test("wheel uses the normalized delta: the configured line count, and the host's Alt multiplier", async (t) => {
	const h = createUi("fullscreen");
	const abort = new AbortController();
	cleanup(t, h, abort);
	const { dialog } = await h.open(abort);
	const start = contextStart(dialog);
	h.wheel(); // fixture wheelScrollLines: 3
	assert.equal(contextStart(dialog), start + 3);
	h.wheel(64);
	assert.equal(contextStart(dialog), start);

	// SGR button bit 8 is the Alt modifier; the host multiplies the delta and the selector must follow it.
	const alt = createUi("fullscreen");
	const altAbort = new AbortController();
	cleanup(t, alt, altAbort);
	const altDialog = (await alt.open(altAbort)).dialog;
	const seen: TuiMouseEvent[] = [];
	const handleMouse = altDialog.component.handleMouse!.bind(altDialog.component);
	altDialog.component.handleMouse = (event) => { seen.push(event); return handleMouse(event); };
	const before = contextStart(altDialog);
	alt.wheel(65, true);
	assert.equal(seen.length, 1);
	assert.deepEqual([seen[0]!.alt, seen[0]!.wheelDelta], [true, 15], "the host delivers an Alt-multiplied delta");
	assert.equal(contextStart(altDialog) - before, 15, "the question scrolls by exactly that delta");
});

for (const boundary of ["top", "bottom"] as const) {
	test(`wheel at the ${boundary} boundary stays consumed by the dialog`, async (t) => {
		const h = createUi("fullscreen");
		const abort = new AbortController();
		cleanup(t, h, abort);
		const { dialog } = await h.open(abort);
		if (boundary === "bottom") h.input("\x1b[F");
		const questionBefore = contextStart(dialog);
		h.transcript.scrollTo(30);
		h.tui.renderNow();
		const transcriptBefore = h.transcript.scrollTop;
		for (let i = 0; i < 3; i++) h.wheel(boundary === "top" ? 64 : 65);
		assert.equal(contextStart(dialog), questionBefore, "no further question scrolling is possible");
		assert.equal(h.transcript.scrollTop, transcriptBefore, "boundary wheel must not leak to the transcript");
	});
}

test("pointer events over the dialog are consumed; wheel outside the dialog still reaches the transcript", async (t) => {
	const h = createUi("fullscreen", { rows: 40 });
	const abort = new AbortController();
	cleanup(t, h, abort);
	const { dialog } = await h.open(abort, [{ label: "Only" }], false, "Short question");
	const bounds = h.bounds(dialog)!;
	assert.ok(bounds.row > 1, "short panel is below the transcript");
	h.transcript.scrollTo(30);
	h.tui.renderNow();
	const before = h.transcript.scrollTop;
	h.input(`\x1b[<0;${bounds.col + 2};${bounds.row + 2}M`); // press inside
	h.input(`\x1b[<0;${bounds.col + 2};${bounds.row + 2}m`); // release inside
	assert.equal(dialog.doneCalls, 0, "a click inside does not complete or dismiss the dialog");
	assert.equal(h.transcript.scrollTop, before);
	h.input(wheel(5, 1)); // pointer above the dialog bounds
	assert.notEqual(h.transcript.scrollTop, before, "pointer over the transcript keeps normal wheel behavior");
});

for (const handling of ["handled", "unhandled", "raw-only"] as const) {
	// Renderer-routing control with independent public components, not Clarify itself.
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

test("selector actions follow the injected keybindings, not raw key bytes", async (t) => {
	const h = createUi("fullscreen", { userBindings: {
		"tui.select.pageDown": "ctrl+d", "tui.select.pageUp": "ctrl+u",
		"tui.select.down": "ctrl+n", "tui.select.up": "ctrl+p",
		"tui.select.confirm": "ctrl+y", "tui.select.cancel": "ctrl+x",
	} });
	const abort = new AbortController();
	cleanup(t, h, abort);
	const { result, dialog } = await h.open(abort);
	assert.match(flat(lines(dialog)), /ctrl\+p\/ctrl\+n navigate/i, "help names the configured up and down keys separately");
	const start = contextStart(dialog);
	h.input("\x1b[6~"); // default PageDown is no longer bound by this selector
	assert.equal(contextStart(dialog), start);
	h.input("\x04"); // ctrl+d
	assert.ok(contextStart(dialog) > start);
	h.input("\r");
	h.input("\x1b");
	assert.equal(dialog.doneCalls, 0, "default Enter/Escape are unbound");
	h.input("\x0e"); // ctrl+n selects the second option
	assert.match(lines(dialog).join("\n"), /→ 2\. Second/);
	h.input("\x19"); // ctrl+y
	const answer = await result;
	assert.equal(answer.details.selectedIndex, 2);
	assert.equal(dialog.doneCalls, 1);
});

test("regular-mode clarify is keyboard-complete with no mouse toggles", async (t) => {
	const h = createUi("regular");
	const abort = new AbortController();
	cleanup(t, h, abort);
	h.writes.length = 0;
	const { result, dialog } = await h.open(abort);
	const start = contextStart(dialog);
	assert.doesNotMatch(lines(dialog).join("\n"), /wheel/, "regular mode leaves the wheel to the terminal");
	h.input("\x1b[6~");
	assert.ok(contextStart(dialog) > start);
	h.input("\x1b[F");
	assert.match(lines(dialog).join("\n"), /Context line 40/);
	h.input("\x1b[5~");
	h.input("\x1b[H");
	assert.equal(contextStart(dialog), 1);
	h.input("\x1b[B");
	assert.match(lines(dialog).join("\n"), /Second description/);
	h.input("\r");
	assert.equal((await result).details.selectedIndex, 2);
	assert.equal(dialog.doneCalls, 1);
	assert.equal(h.tui.getFocusedComponent(), h.editor);
	assert.doesNotMatch(h.writes.join(""), mouseModes);
});

// Layout: the inline component bounds its natural height; the host may clip the dock on tiny terminals.
const sizes = [[80, 24], [120, 40], [80, 12], [40, 10], [30, 8], [24, 6], [20, 5], [12, 4], [8, 3], [5, 2], [1, 1], [80, 1], [3, 30]] as const;
for (const [columns, rows] of sizes) {
	test(`dock layout stays inside ${columns}x${rows} with wide characters and long text`, async (t) => {
		const h = createUi("fullscreen", { columns, rows });
		const abort = new AbortController();
		cleanup(t, h, abort);
		const wide = Array.from({ length: 30 }, (_, i) => `界 line ${i} 😀 ${"漢字".repeat(12)}`).join("\n");
		const { dialog } = await h.open(abort, [
			{ label: `First ${"界".repeat(40)}`, description: "Long 😀 description 界界界 ".repeat(30) },
			...manyOptions.slice(0, 9),
		], true, wide);
		const rendered = dialog.component.render(columns);
		assert.ok(rendered.length <= clarifyDockHeight(rows), "component respects its own height budget");
		for (const line of rendered) assert.ok(visibleWidth(line) <= columns, `line fits width ${columns}`);
		const text = screen(h);
		assert.ok(text.length <= rows);
		for (const line of text) assert.ok(visibleWidth(line) <= columns);
		if (rows >= 8) {
			const bounds = h.bounds(dialog);
			assert.ok(bounds, "panel actually appears in the composed screen");
			assert.ok(bounds.row + rendered.length <= rows, "all panel rows fit before the footer");
			assert.deepEqual(text.slice(bounds.row, bounds.row + rendered.length).map((line) => line.trimEnd()),
				rendered.map((line) => stripVTControlCharacters(line).trimEnd()), "no panel content is clipped by host layout");
		}
		// Below ~8 columns even the arrow prefix cannot be shown; bounds are still enforced above.
		if (columns >= 8 && rows >= 8) {
			assert.ok(text.some((line) => line.includes("→")), "selected option stays visible");
			h.input("\x1b[B");
			assert.ok(screen(h).some((line) => line.includes("→")), "selected option still visible after navigation");
		}
	});
}

test("help and context status remain visible at 80x24 and in a narrow terminal", async (t) => {
	for (const [columns, rows] of [[80, 24], [40, 14]] as const) {
		const h = createUi("fullscreen", { columns, rows });
		const abort = new AbortController();
		cleanup(t, h, abort);
		await h.open(abort);
		const text = flat(screen(h));
		assert.match(text, /↑\/↓/);
		assert.match(text, /Enter select/);
		assert.match(text, /Esc cancel/);
		assert.match(text, /Context \d+-\d+\/40/);
		abort.abort();
		await flushDialogs();
	}
});

test("height-only and width-only resizes re-budget the layout without leaving stale lines", async (t) => {
	const h = createUi("fullscreen");
	const abort = new AbortController();
	cleanup(t, h, abort);
	const { dialog } = await h.open(abort, [{ label: "A" }, { label: "B" }], false);
	const height = () => dialog.component.render(h.terminal.columns).length;
	const tall = height();
	assert.equal(tall, clarifyDockHeight(24), "40-line question fills the available height");
	h.input("\x1b[6;5~");
	const scrolled = contextStart(dialog);
	h.resize(80, 12); // height only, same width: a width-keyed cache would be stale
	assert.equal(height(), clarifyDockHeight(12));
	assert.ok(screen(h).length <= 12);
	h.resize(40, 12); // width only
	assert.equal(h.bounds(dialog)!.width, 40, "width follows the terminal on resize");
	for (const line of screen(h)) assert.ok(visibleWidth(line) <= 40);
	h.resize(80, 24);
	assert.equal(height(), tall);
	assert.ok(contextStart(dialog) >= 1 && contextStart(dialog) <= scrolled + 2, "scroll position stays clamped and usable");
	h.resize(80, 3);
	assert.equal(height(), clarifyDockHeight(3));
	h.input("\x1b[B");
	assert.ok(lines(dialog).some((line) => line.includes("→ 2. B")), "tiny panel keeps the selected option even if host chrome clips the dock");
	h.resize(80, 24);
	assert.match(screen(h).join("\n"), /navigate/);
});

test("many choices keep the selected option visible and wrap around", async (t) => {
	const h = createUi("fullscreen", { rows: 18 });
	const abort = new AbortController();
	cleanup(t, h, abort);
	const { result, dialog } = await h.open(abort, manyOptions, true, "Pick one");
	assert.match(screen(h).join("\n"), /→ 1\. Option number 1\b/);
	h.input("\x1b[A"); // wraps to the last (custom) choice
	assert.match(screen(h).join("\n"), /→ 31\. Custom instructions/);
	assert.match(screen(h).join("\n"), /\(31\/31\)/);
	for (let i = 0; i < 31; i++) h.input("\x1b[B");
	assert.match(screen(h).join("\n"), /→ 31\. Custom instructions/);
	h.input("\x1b[B");
	assert.match(screen(h).join("\n"), /→ 1\. Option number 1\b/);
	for (let i = 0; i < 17; i++) h.input("\x1b[B");
	assert.match(screen(h).join("\n"), /→ 18\. Option number 18\b/);
	assert.match(screen(h).join("\n"), /Description 18/);
	h.input("\r");
	assert.equal((await result).details.selectedIndex, 18);
	assert.equal(dialog.doneCalls, 1);
});

test("description detail is not capped: every row that fits is shown, otherwise it is marked", async (t) => {
	const h = createUi("fullscreen", { columns: 120, rows: 40 });
	const abort = new AbortController();
	cleanup(t, h, abort);
	const { dialog } = await h.open(abort, [{ label: "Detailed", description: longDescription }], false, "Short question");
	const text = flat(screen(h));
	for (let i = 1; i <= 10; i++) assert.match(text, new RegExp(`Detail sentence ${i} explains`), `sentence ${i} visible (fits)`);
	assert.doesNotMatch(text, /…/);
	const rowsUsed = h.bounds(dialog)!.height;
	assert.ok(rowsUsed > 8 && rowsUsed <= 16, "panel grows only within its compact cap");
	h.resize(60, 14);
	const clipped = flat(screen(h));
	assert.match(clipped, /Detail sentence 1 explains/);
	assert.match(clipped, /↳/);
	assert.match(clipped, /…/, "clipping is marked");
	assert.ok(h.bounds(dialog)!.height <= clarifyDockHeight(14));
});

test("repeated interactions use fresh state and leave no stale panel or focus", async (t) => {
	const h = createUi("fullscreen");
	const abort = new AbortController();
	cleanup(t, h, abort);
	for (const completion of ["escape", "selection", "abort", "selection"] as const) {
		const controller = completion === "abort" ? new AbortController() : abort;
		const { result, dialog } = await h.open(controller);
		assert.equal(contextStart(dialog), 1, "fresh scroll state each time");
		h.input("\x1b[F");
		assert.ok(contextStart(dialog) > 1);
		if (completion === "escape") h.input("\x1b");
		else if (completion === "selection") h.input("\r");
		else controller.abort();
		assert.ok(["option", "cancelled"].includes((await result).details.answerType));
		h.tui.renderNow();
		assert.equal(dialog.doneCalls, 1);
		assert.equal(dialog.mounted, false);
		assert.equal(h.tui.getFocusedComponent(), h.editor);
	}
	assert.equal(h.dialogs.length, 4);
	assert.equal(new Set(h.dialogs.map((dialog) => dialog.component)).size, 4, "every interaction gets a fresh component");
});

// ---- Lifecycle matrix (queued/displayed cancellation, stacking, installation timing, shutdown) ----

test("queued cancellation never installs and leaves the displayed selector usable", async (t) => {
	const h = createUi("fullscreen");
	const abort = new AbortController();
	cleanup(t, h, abort);
	const { result, dialog } = await h.open(abort);
	const queued = new AbortController();
	const second = h.start(queued);
	await flushDialogs();
	assert.equal(h.dialogs.length, 1, "FIFO: second selector waits");
	queued.abort();
	assert.equal((await second).details.answerType, "cancelled");
	assert.equal(h.dialogs.length, 1);
	assert.equal(h.tui.getFocusedComponent(), dialog.component);
	h.input("\r");
	assert.equal((await result).details.answerType, "option");
});

test("FIFO: the second selector installs only after the first completes", async (t) => {
	const h = createUi("fullscreen");
	const abort = new AbortController();
	cleanup(t, h, abort);
	const { result, dialog } = await h.open(abort);
	const second = h.start(abort);
	await flushDialogs();
	assert.equal(h.dialogs.length, 1);
	h.input("\x1b[B");
	h.input("\r");
	assert.equal((await result).details.selectedIndex, 2);
	await flushDialogs();
	assert.equal(h.dialogs.length, 2, "second selector installed after the first exchange completed");
	assert.equal(dialog.mounted, false);
	assert.equal(h.tui.getFocusedComponent(), h.dialogs[1]!.component);
	h.input("\x1b");
	assert.equal((await second).details.answerType, "cancelled");
});

for (const stacking of ["search above", "unrelated overlay above", "unrelated overlay below"] as const) {
	test(`displayed cancellation with ${stacking} removes the panel and characterizes host focus`, async (t) => {
		const h = createUi("fullscreen");
		const abort = new AbortController();
		cleanup(t, h, abort);
		const unrelated = new Text("Unrelated overlay", 0, 0);
		const other = stacking === "unrelated overlay below" ? h.tui.showOverlay(unrelated, { anchor: "top-left", width: 20 }) : undefined;
		h.tui.renderNow();
		const { result, dialog } = await h.open(abort);
		let remaining: { getBounds(): unknown; isFocused(): boolean } | undefined = other;
		let expectedFocus: unknown = other ? unrelated : h.editor;
		if (stacking === "search above") {
			h.input("\x1b[102;6u");
			expectedFocus = h.tui.getFocusedComponent();
			assert.notEqual(expectedFocus, dialog.component, "search must be above the dialog");
		} else if (stacking === "unrelated overlay above") {
			remaining = h.tui.showOverlay(unrelated, { anchor: "top-left", width: 20 });
			h.tui.renderNow();
			expectedFocus = unrelated;
		}
		abort.abort();
		assert.equal((await result).details.answerType, "cancelled");
		h.tui.renderNow();
		assert.equal(dialog.doneCalls, 1);
		assert.equal(dialog.mounted, false, "owned panel removed, not left mounted");
		if (remaining) assert.ok(remaining.getBounds(), "unrelated overlay survived");
		assert.equal(h.tui.getFocusedComponent(), other ? expectedFocus : h.editor, "Pi restores the editor when a panel closes under an overlay");
		if (stacking === "unrelated overlay above") {
			// The unrelated overlay stays mounted but loses focus; late dialog input cannot complete again.
			dialog.component.handleInput?.("\r");
			await flushDialogs();
			assert.equal(dialog.doneCalls, 1);
		}
	});
}

for (const timing of ["inside the factory", "in a microtask before installation"] as const) {
	test(`cancellation ${timing} preserves an unrelated overlay and never mounts the selector`, async (t) => {
		const h = createUi("fullscreen");
		const abort = new AbortController();
		cleanup(t, h, abort);
		const unrelated = new Text("Unrelated overlay", 0, 0);
		const other = h.tui.showOverlay(unrelated);
		h.tui.renderNow();
		const custom = h.ctx.ui.custom;
		h.ctx.ui.custom = (factory, options) => custom((tui, theme, kb, done) => {
			const component = factory(tui, theme, kb, done);
			if (timing === "inside the factory") abort.abort();
			else queueMicrotask(() => abort.abort());
			return component;
		}, options);
		const result = await h.start(abort);
		assert.equal(result.details.answerType, "cancelled");
		h.tui.renderNow();
		assert.equal(h.dialogs.length, 0, "never-installed selector must not mount");
		assert.ok(other.getBounds(), "unrelated overlay survives");
		assert.equal(h.tui.getFocusedComponent(), unrelated);
	});

	test(`overlay cancellation ${timing} disposes the never-installed component exactly once`, async (t) => {
		const h = createUi("fullscreen");
		t.after(() => h.tui.stop({ preserveScreen: true }));
		const abort = new AbortController();
		let disposals = 0;
		const result = showCancellableCustom<string>(h.ctx.ui, abort.signal, () => {
			if (timing === "inside the factory") abort.abort();
			else queueMicrotask(() => abort.abort());
			return { render: () => ["x"], invalidate() {}, dispose() { disposals++; } };
		}, { overlay: true });
		await assert.rejects(result, { name: "AbortError" });
		assert.equal(h.dialogs.length, 0);
		assert.equal(disposals, 1);
	});
}

test("synchronous completion inside the factory is not mounted and cannot double-complete", async (t) => {
	const h = createUi("fullscreen");
	t.after(() => h.tui.stop({ preserveScreen: true }));
	const unrelated = new Text("Unrelated overlay", 0, 0);
	const other = h.tui.showOverlay(unrelated);
	h.tui.renderNow();
	let disposals = 0;
	const answer = await showCancellableCustom<string>(h.ctx.ui, new AbortController().signal, (_tui, _theme, _kb, done) => {
		done("early"); done("late");
		return { render: () => ["x"], invalidate() {}, dispose() { disposals++; } };
	}, { overlay: true });
	assert.equal(answer, "early");
	h.tui.renderNow();
	assert.equal(h.dialogs.length, 0);
	assert.ok(other.getBounds());
	assert.equal(h.tui.getFocusedComponent(), unrelated);
	assert.equal(disposals, 1);
});

for (const reason of ["shutdown", "reload"] as const) {
	test(`session ${reason} cancels the displayed and queued selectors and a fresh interaction still works`, async (t) => {
		const h = createUi("fullscreen");
		const abort = new AbortController();
		cleanup(t, h, abort);
		const { result, dialog } = await h.open(abort);
		const second = h.start(abort);
		await flushDialogs();
		await h.emit("session_shutdown", { reason }, h.ctx);
		assert.equal((await result).details.answerType, "cancelled");
		assert.equal((await second).details.answerType, "cancelled");
		h.tui.renderNow();
		assert.equal(h.dialogs.length, 1, "queued selector never installed");
		assert.equal(dialog.doneCalls, 1);
		assert.equal(dialog.mounted, false);
		assert.equal(h.tui.getFocusedComponent(), h.editor);
		dialog.component.handleInput?.("\r");
		await flushDialogs();
		assert.equal(dialog.doneCalls, 1, "late input cannot complete a settled dialog again");
	});
}

test("late input and late abort after completion are ignored (exactly-once)", async (t) => {
	const h = createUi("fullscreen");
	const abort = new AbortController();
	cleanup(t, h, abort);
	const { result, dialog } = await h.open(abort);
	h.input("\r");
	assert.equal((await result).details.answerType, "option");
	dialog.component.handleInput?.("\r");
	dialog.component.handleInput?.("\x1b");
	abort.abort();
	await flushDialogs();
	assert.equal(dialog.doneCalls, 1);
	assert.equal(h.tui.getFocusedComponent(), h.editor);
});

test("the custom-answer exchange stays serialized: inline selector, then inline editor, then result", async (t) => {
	const h = createUi("fullscreen");
	const abort = new AbortController();
	cleanup(t, h, abort);
	const { result, dialog } = await h.open(abort, [{ label: "First" }], true);
	h.input("\x1b[B");
	h.input("\r");
	await flushDialogs();
	h.tui.renderNow();
	assert.equal(dialog.mounted, false, "selector panel closed before the editor");
	assert.equal(h.dialogs.length, 2);
	const editor = h.dialogs[1]!;
	assert.notEqual(editor.options?.overlay, true, "the answer editor uses the same inline presentation");
	assert.equal(editor.handle, undefined);
	assert.equal(h.tui.getFocusedComponent(), editor.component);
	const answer = h.start(abort); // a second question waits for the editor exchange to finish
	await flushDialogs();
	assert.equal(h.dialogs.length, 2);
	h.input("\r"); // submit the prefilled multiline answer
	const done = await result;
	assert.equal(done.details.answerType, "custom");
	assert.equal(done.details.answer, "line one\nline two");
	h.tui.renderNow();
	assert.equal(editor.mounted, false, "editor panel removed by host completion");
	await flushDialogs();
	assert.equal(h.dialogs.length, 3, "queued question installs after the exchange");
	h.input("\x1b");
	assert.equal((await answer).details.answerType, "cancelled");
	assert.equal(h.tui.getFocusedComponent(), h.editor);
});

// ---- Stage-by-stage focus: the whole displayed exchange (selector, then editor) with search stacked ----

test("answer editor cancelled under search characterizes the host focus limitation", async (t) => {
	const h = createUi("fullscreen");
	const abort = new AbortController();
	cleanup(t, h, abort);
	const { result, dialog } = await h.openEditor(abort);
	h.input(SEARCH_KEY);
	const search = h.tui.getFocusedComponent();
	assert.notEqual(search, dialog.component);
	assert.notEqual(search, h.editor);
	abort.abort();
	assert.equal((await result).details.answerType, "cancelled");
	h.tui.renderNow();
	assert.equal(dialog.doneCalls, 1);
	assert.equal(dialog.mounted, false, "owned editor panel removed, not left mounted");
	assert.equal(h.tui.getFocusedComponent(), h.editor, "known Pi inline limitation: editor takes focus while search stays visible");
	h.input(SEARCH_KEY); // close the unfocused search with its shortcut
	assert.equal(h.tui.getFocusedComponent(), h.editor, "closing search then restores the main editor");
});

test("search opened before the exchange is restored after it, and never owns the keyboard while a dialog is displayed", async (t) => {
	const h = createUi("fullscreen");
	const abort = new AbortController();
	cleanup(t, h, abort);
	h.input(SEARCH_KEY);
	const search = h.tui.getFocusedComponent();
	assert.notEqual(search, h.editor);
	const { result, selector, dialog } = await h.openEditor(abort);
	assert.equal(selector.mounted, false, "selector panel already closed");
	assert.equal(h.tui.getFocusedComponent(), dialog.component, "the editor, not the search below it, owns the keyboard while displayed");
	h.input("\r");
	assert.equal((await result).details.answerType, "custom");
	h.tui.renderNow();
	assert.equal(h.tui.getFocusedComponent(), search, "after the exchange, focus returns to the search that was open before it");
	h.input("\x1b");
	assert.equal(h.tui.getFocusedComponent(), h.editor);
});

test("between selector and editor the focus never lands on the main editor while search is open below", async (t) => {
	const h = createUi("fullscreen");
	const abort = new AbortController();
	cleanup(t, h, abort);
	h.input(SEARCH_KEY);
	const search = h.tui.getFocusedComponent();
	const focusTrail: unknown[] = [];
	const setFocus = h.tui.setFocus.bind(h.tui);
	h.tui.setFocus = (component) => { setFocus(component); focusTrail.push(h.tui.getFocusedComponent()); };
	const { result } = await h.openEditor(abort);
	assert.ok(!focusTrail.includes(h.editor), "the main editor was never focused during the exchange");
	abort.abort();
	await result;
	h.tui.renderNow();
	assert.ok(!focusTrail.includes(h.editor), "nor after it ended");
	assert.equal(h.tui.getFocusedComponent(), search);
});

test("search opened before the selector installs: dialog isolates focus and scroll, and Escape restores the search", async (t) => {
	const h = createUi("fullscreen");
	const abort = new AbortController();
	cleanup(t, h, abort);
	h.input(SEARCH_KEY);
	const search = h.tui.getFocusedComponent();
	assert.notEqual(search, h.editor);
	h.transcript.scrollTo(30);
	h.tui.renderNow();
	const transcriptBefore = h.transcript.scrollTop;
	const { result, dialog } = await h.open(abort);
	assert.equal(h.tui.getFocusedComponent(), dialog.component, "the newly installed dialog takes focus from the search");
	assert.notEqual(h.tui.getFocusedComponent(), search);
	h.input("\x1b[H");
	const start = contextStart(dialog);
	h.input("\x1b[6;5~");
	assert.ok(contextStart(dialog) > start, "Ctrl+PageDown reaches the panel");
	const afterKey = contextStart(dialog);
	h.wheel();
	assert.ok(contextStart(dialog) > afterKey, "wheel reaches the dialog");
	h.input("\x1b[F");
	for (let i = 0; i < 3; i++) h.wheel(); // at the bottom boundary
	assert.equal(h.transcript.scrollTop, transcriptBefore, "neither keys nor wheel (even at a boundary) leak to the transcript beneath");
	h.input("\x1b");
	assert.equal((await result).details.answerType, "cancelled");
	h.tui.renderNow();
	assert.equal(dialog.mounted, false);
	assert.equal(h.tui.getFocusedComponent(), search, "Escape closes only the dialog and restores the search");
	h.input("\x1b");
	assert.equal(h.tui.getFocusedComponent(), h.editor);
});

test("the host's search shortcut still toggles search beneath a displayed dialog without moving dialog focus", async (t) => {
	// The host handles its search shortcut before passing input to the inline panel.
	const h = createUi("fullscreen");
	const abort = new AbortController();
	cleanup(t, h, abort);
	h.input(SEARCH_KEY);
	const { result, dialog } = await h.open(abort);
	h.input(SEARCH_KEY); // closes the search below the dialog
	assert.equal(h.tui.getFocusedComponent(), dialog.component, "the dialog keeps focus");
	h.input("\x1b");
	assert.equal((await result).details.answerType, "cancelled");
	h.tui.renderNow();
	assert.equal(h.tui.getFocusedComponent(), h.editor, "with the search gone, focus returns to the main editor");
});

// ---- The answer editor panel: bounds, cursor, paste, pointer ----

const editorSizes = [[80, 24], [120, 40], [80, 12], [40, 10], [30, 8], [20, 6], [20, 5], [12, 4], [8, 3], [8, 2], [5, 1], [80, 1], [3, 30]] as const;
for (const [columns, rows] of editorSizes) {
	test(`answer editor panel stays inside ${columns}x${rows}, keeps the cursor visible and the footer when it fits`, async (t) => {
		const h = createUi("fullscreen", { columns, rows });
		const abort = new AbortController();
		cleanup(t, h, abort);
		const { dialog } = await h.openEditor(abort);
		for (const char of "界x") h.input(char);
		const rendered = dialog.component.render(columns);
		assert.ok(rendered.length <= clarifyDockHeight(rows), "editor output is bounded before host layout");
		for (const line of rendered) assert.ok(visibleWidth(line.replaceAll(CURSOR_MARKER, "")) <= columns);
		const text = screen(h);
		for (const line of text) assert.ok(visibleWidth(line) <= columns);
		if (rows < 8) return; // Pi may clip the whole editor slot behind host chrome at these sizes.
		const bounds = h.bounds(dialog);
		assert.ok(bounds, "answer panel actually appears on screen");
		assert.ok(bounds.row + rendered.length <= rows, "answer panel fits before the footer");
		assert.deepEqual(text.slice(bounds.row, bounds.row + rendered.length).map((line) => line.trimEnd()),
			rendered.map(plain), "the editor is not clipped");
		const cursor = h.cursor();

		assert.ok(cursor, "the hardware cursor is positioned");
		assert.ok(cursor.row >= bounds.row && cursor.row < bounds.row + bounds.height, `cursor row ${cursor.row} inside rows ${bounds.row}..${bounds.row + bounds.height - 1}`);
		assert.ok(cursor.col >= bounds.col && cursor.col <= bounds.col + bounds.width, "cursor column inside the panel");
		if (columns >= 8) assert.match(text[cursor.row]!, /line two|界x|x/, "the cursor row shows the text being edited");
		const flatText = flat(text);
		if (rows >= 14 && columns >= 40) {
			assert.match(flatText, /Custom instructions/);
			assert.match(flatText, /enter submit/i);
			assert.match(flatText, /cancel/);
			// The second hint is optional in the compact panel.
		}
	});
}

test("answer editor: resizing re-budgets the panel and keeps the cursor inside it", async (t) => {
	const h = createUi("fullscreen");
	const abort = new AbortController();
	cleanup(t, h, abort);
	const { dialog } = await h.openEditor(abort);
	for (const [columns, rows] of [[80, 12], [30, 6], [80, 24], [20, 4], [80, 24]] as const) {
		h.resize(columns, rows);
		assert.ok(dialog.component.render(columns).length <= clarifyDockHeight(rows));
		if (rows >= 8) {
			const bounds = h.bounds(dialog);
			assert.ok(bounds, "resized panel is visible");
			assert.ok(bounds.row + bounds.height <= rows, `${columns}x${rows} bounds`);
			const cursor = h.cursor()!;
			assert.ok(cursor.row >= bounds.row && cursor.row < bounds.row + bounds.height, `${columns}x${rows} cursor row`);
		}
	}
});

test("answer editor: typing, bracketed paste and submit work through the real renderer and expand large pastes", async (t) => {
	const h = createUi("fullscreen");
	const abort = new AbortController();
	cleanup(t, h, abort);
	const { result } = await h.openEditor(abort);
	h.input("\x1b[200~ pasted\x1b[201~");
	h.input("\x1b[200~" + Array.from({ length: 12 }, (_, i) => `big ${i}`).join("\n") + "\x1b[201~");
	assert.match(flat(screen(h)), /\[paste #1 \+12 lines\]/, "large paste collapses to a marker on screen");
	h.input("!");
	h.input("\r");
	const answer = await result;
	assert.equal(answer.details.answerType, "custom");
	assert.equal(answer.details.answer, `line one\nline two pasted${Array.from({ length: 12 }, (_, i) => `big ${i}`).join("\n")}!`);
});

test("answer editor: escape cancels it and restores the main editor; the external-editor key is inert", async (t) => {
	const h = createUi("fullscreen");
	const abort = new AbortController();
	cleanup(t, h, abort);
	const { result, dialog } = await h.openEditor(abort);
	h.input("\x07"); // ctrl+g, app.editor.external
	assert.equal(dialog.doneCalls, 0);
	assert.match(h.notifications.at(-1) ?? "", /External editor.*disabled/i);
	h.input("\x1b");
	assert.equal((await result).details.answerType, "cancelled");
	h.tui.renderNow();
	assert.equal(dialog.mounted, false);
	assert.equal(h.tui.getFocusedComponent(), h.editor);
});

test("answer editor: wheel over it never scrolls the transcript, even over its borders; outside it still does", async (t) => {
	const h = createUi("fullscreen", { rows: 40 });
	const abort = new AbortController();
	cleanup(t, h, abort);
	const { dialog } = await h.openEditor(abort, "Short question");
	const bounds = h.bounds(dialog)!;
	assert.ok(bounds.row > 1, "the editor panel is below the transcript");
	h.transcript.scrollTo(30);
	h.tui.renderNow();
	const before = h.transcript.scrollTop;
	for (const y of [bounds.row + 1, bounds.row + bounds.height]) for (const button of [64, 65]) h.input(wheel(bounds.col + 3, y, button));
	assert.equal(h.transcript.scrollTop, before, "wheel input over the editor panel is consumed");
	h.input(wheel(5, 1));
	assert.notEqual(h.transcript.scrollTop, before, "wheel above the panel keeps normal transcript behavior");
});

// ---- Non-wheel pointer gestures follow the host default over the selector ----

const sgr = (button: number, x: number, y: number, release = false) => `\x1b[<${button};${x};${y}${release ? "m" : "M"}`;

test("dragging over the selector selects the dialog text, not the transcript beneath it", async (t) => {
	const h = createUi("fullscreen", { rows: 40 });
	const abort = new AbortController();
	cleanup(t, h, abort);
	const { dialog } = await h.open(abort, [{ label: "Only" }], false, "Short question about selection");
	const text = screen(h);
	const row = text.findIndex((line) => line.includes("Short question about selection"));
	assert.ok(row >= 0 && text.some((line) => line.includes("Transcript")), "dialog rows and transcript rows are both on screen");
	const col = text[row]!.indexOf("Short");
	h.input(sgr(0, col + 1, row + 1));
	h.input(sgr(32, col + 14, row + 1));
	h.input(sgr(0, col + 14, row + 1, true));
	assert.ok(h.tui instanceof TuiAltScreen && h.tui.hasActiveSelection(), "the host started a text selection");
	assert.equal(await (h.tui as TuiAltScreen).copyActiveSelectionToClipboard(), true);
	assert.match(h.copied[0]!, /^Short question/, "the selection is the dialog text");
	assert.doesNotMatch(h.copied[0]!, /Transcript/, "no transcript text is selected beneath the dialog");
	assert.equal(dialog.doneCalls, 0, "selecting does not dismiss or complete the dialog");
	assert.match(screen(h).join("\n"), /Short question about selection/);
});

test("clicking a link in the question follows the host's link activation and keeps the dialog open", async (t) => {
	const h = createUi("fullscreen", { rows: 40 });
	const abort = new AbortController();
	cleanup(t, h, abort);
	const url = "https://example.com/docs";
	const linked = `See \x1b]8;;${url}\x07the docs\x1b]8;;\x07 for details`;
	const { dialog } = await h.open(abort, [{ label: "Only" }], false, linked);
	const text = screen(h);
	const row = text.findIndex((line) => line.includes("the docs"));
	assert.ok(row >= 0, "link text is on screen");
	const col = text[row]!.indexOf("the docs");
	h.input(sgr(0, col + 2, row + 1));
	h.input(sgr(0, col + 2, row + 1, true));
	assert.deepEqual(h.openedUrls, [url], "the host default opened the link");
	assert.equal(dialog.doneCalls, 0);
});

test("a click or drag that does nothing special still never completes, dismisses or scrolls the dialog", async (t) => {
	const h = createUi("fullscreen", { rows: 40 });
	const abort = new AbortController();
	cleanup(t, h, abort);
	const { dialog } = await h.open(abort, [{ label: "Only" }], false, "Short question");
	const bounds = h.bounds(dialog)!;
	const before = screen(h).join("\n");
	h.input(sgr(0, bounds.col + 2, bounds.row + 2));
	h.input(sgr(0, bounds.col + 2, bounds.row + 2, true));
	h.input(sgr(2, bounds.col + 2, bounds.row + 2));
	h.input(sgr(2, bounds.col + 2, bounds.row + 2, true));
	assert.equal(dialog.doneCalls, 0);
	assert.equal(screen(h).join("\n"), before, "the dialog content is unchanged");
	assert.equal(h.tui.getFocusedComponent(), dialog.component);
});

test("TUI selector uses the inline presentation; RPC/no-UI paths are unchanged", async () => {
	const ui = createUi("fullscreen");
	try {
		const rpc = { ...ui.toolCtx, mode: "rpc" as const };
		const controller = new AbortController();
		const result = ui.tools.get("clarify")!.execute("rpc", { question: "Q", options: [{ label: "A" }], allowCustom: false }, controller.signal, undefined, rpc);
		await flushDialogs();
		assert.equal(ui.dialogs.length, 0, "RPC never installs a terminal component");
		assert.equal(ui.requests.at(-1)?.method, "select");
		controller.abort();
		assert.equal((await result).details.answerType, "cancelled");
	} finally { ui.tui.stop({ preserveScreen: true }); }
});

// Renderer sanity: the panel's text is plain-width safe even without the host clipping it.
test("rendered selector lines carry no raw mouse or cursor control sequences", async (t) => {
	const h = createUi("fullscreen");
	const abort = new AbortController();
	cleanup(t, h, abort);
	const { dialog } = await h.open(abort);
	const raw = dialog.component.render(h.bounds(dialog)!.width).join("\n");
	assert.equal(stripVTControlCharacters(raw).includes("\x1b"), false);
	assert.doesNotMatch(raw, /\x1b\[\?100/);
});

// Adapter-faithfulness controls. The adapter mirrors Pi 1.4 showExtensionCustom():
// an overlay interaction completes by hiding its own handle, never the topmost overlay.
// These are copied-adapter checks; clarify-host.test.ts independently exercises the real host.
// See host-contract-coverage.md for the distinction and practical limits.
const overlayOptions = { overlay: true } as const;
const probeComponent = (label: string) => ({
	label, disposed: 0, render: () => [label], invalidate() {}, dispose() { this.disposed++; },
});

test("adapter lifecycle contract (Pi 1.4 close path): normal mounted completion removes the owned overlay and disposes once", async (t) => {
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
	test(`adapter lifecycle contract (Pi 1.4 close path): completion ${timing} preserves an unrelated overlay`, async (t) => {
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

test("adapter lifecycle contract (Pi 1.4 close path): cancelled owned overlay leaves stacked search focused", async (t) => {
	const h = createUi("fullscreen");
	const abort = new AbortController();
	t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
	const result = showCancellableCustom<string>(h.ctx.ui, abort.signal, () => probeComponent("owned"), { overlay: true });
	await flushDialogs();
	const dialog = h.dialogs.at(-1)!;
	assert.ok(dialog.handle?.getBounds(), "this control mounts an actual overlay");
	h.input(SEARCH_KEY);
	const search = h.tui.getFocusedComponent();
	assert.notEqual(search, dialog.component);
	abort.abort();
	await assert.rejects(result, { name: "AbortError" });
	h.tui.renderNow();
	assert.equal(dialog.handle?.getBounds(), undefined, "only the owned overlay was removed");
	assert.equal(h.tui.getFocusedComponent(), search, "overlay-mode completion preserves search focus");
	assert.equal(dialog.doneCalls, 1);
});

test("adapter lifecycle contract (Pi 1.4 close path): abort before installation preserves unrelated overlays", async (t) => {
	const h = createUi("fullscreen");
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

test("adapter lifecycle contract (Pi 1.4 close path): showCancellableCustom pre-install abort disposes once and preserves unrelated overlay", async (t) => {
	const h = createUi("fullscreen");
	const abort = new AbortController();
	t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
	const unrelated = new Text("Unrelated overlay", 0, 0);
	const other = h.tui.showOverlay(unrelated);
	h.tui.renderNow();
	const before = other.getBounds();
	assert.ok(before);
	assert.equal(h.tui.getFocusedComponent(), unrelated, "unrelated overlay starts focused");
	const component = probeComponent("retained");
	const result = showCancellableCustom<string>(h.ctx.ui, abort.signal, () => { abort.abort(); return component; }, { overlay: true });
	await assert.rejects(result, (error) => error === abort.signal.reason);
	h.tui.renderNow();
	assert.equal(component.disposed, 1, "wrapper must dispose the retained component exactly once");
	assert.equal(h.dialogs.length, 0, "aborted interaction must not mount a dialog");
	assert.deepEqual(other.getBounds(), before, "unrelated overlay bounds must be unchanged");
	assert.equal(h.tui.getFocusedComponent(), unrelated, "unrelated overlay must keep focus");
});



