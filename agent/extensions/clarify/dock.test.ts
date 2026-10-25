import assert from "node:assert/strict";
import test from "node:test";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { clarifyDockHeight } from "./selector.ts";
import { createUi, contextStart, screen } from "../pi-compatibility/clarifyUiFixture.ts";

test("Clarify uses the editor slot for both stages and leaves conversation visible", async (t) => {
	const h = createUi("fullscreen");
	const abort = new AbortController();
	t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
	const { result: selectorResult, dialog: selector } = await h.open(abort);
	assert.notEqual(selector.options?.overlay, true);
	assert.equal(selector.handle, undefined);
	assert.equal(h.tui.getFocusedComponent(), selector.component);
	assert.ok(selector.component.render(80).length <= clarifyDockHeight(24));
	assert.ok(screen(h).some((line) => line.includes("Transcript")));
	abort.abort();
	await selectorResult;

	const editorAbort = new AbortController();
	t.after(() => editorAbort.abort());
	const { result, dialog } = await h.openEditor(editorAbort);
	assert.notEqual(dialog.options?.overlay, true);
	assert.equal(dialog.handle, undefined);
	const rendered = dialog.component.render(80);
	assert.ok(rendered.length <= clarifyDockHeight(24));
	assert.ok(rendered.some((line) => line.includes(CURSOR_MARKER)), "cursor is inside the panel");
	assert.ok(screen(h).some((line) => line.includes("Transcript")));
	h.input("\r");
	assert.equal((await result).details.answerType, "custom");
	assert.equal(h.tui.getFocusedComponent(), h.editor);
});

test("ordinary dock layouts prefer readable question context over decorative chrome", async (t) => {
	const h = createUi("fullscreen");
	const abort = new AbortController();
	t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
	const question = ["Question line one", "Question line two", "Question line three", "Question line four"].join("\n");
	const options = ["First", "Second", "Third"].map((label) => ({ label, description: "Trade-off detail. ".repeat(8) }));
	const { dialog } = await h.open(abort, options, true, question);
	const text = dialog.component.render(80).join("\n");
	assert.match(text, /Question line one/);
	assert.match(text, /Question line two/);
	assert.match(text, /Question line three/);
});

test("docked question paging leaves fullscreen PageUp/PageDown to the conversation", async (t) => {
	const h = createUi("fullscreen");
	const abort = new AbortController();
	t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
	const { dialog } = await h.open(abort);
	const start = contextStart(dialog);
	const transcriptBefore = h.transcript.scrollTop;
	h.input("\x1b[5~");
	assert.equal(contextStart(dialog), start, "PageUp does not change the question");
	assert.notEqual(h.transcript.scrollTop, transcriptBefore, "PageUp scrolls the conversation");
	const scrolledTranscript = h.transcript.scrollTop;
	h.input("\x1b[6;5~"); // Ctrl+PageDown, the editor paging binding
	assert.ok(contextStart(dialog) > start, "keyboard paging can reach the middle of the question");
	assert.equal(h.transcript.scrollTop, scrolledTranscript);
});

for (const [columns, rows] of [[80, 24], [120, 40], [40, 12], [30, 8], [12, 4], [3, 1]] as const) {
	test(`both docked stages respect a compact budget at ${columns}x${rows}`, async (t) => {
		const h = createUi("fullscreen", { columns, rows });
		const abort = new AbortController();
		t.after(() => { abort.abort(); h.tui.stop({ preserveScreen: true }); });
		const { dialog } = await h.openEditor(abort);
		const rendered = dialog.component.render(columns);
		assert.ok(rendered.length <= clarifyDockHeight(rows));
		assert.ok(rendered.some((line) => line.includes(CURSOR_MARKER)));
		for (const line of rendered) assert.ok(visibleWidth(line.replaceAll(CURSOR_MARKER, "")) <= columns);
		assert.ok(clarifyDockHeight(rows) <= Math.max(1, Math.floor(rows / 2)));
		assert.ok(clarifyDockHeight(rows) <= 16, "large terminals still get a compact panel");
	});
}
