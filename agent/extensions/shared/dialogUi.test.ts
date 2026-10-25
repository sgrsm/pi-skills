import assert from "node:assert/strict";
import test from "node:test";
import { ExtensionSelectorComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { stripVTControlCharacters } from "node:util";
import { CURSOR_MARKER, visibleWidth, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { boundedDialogDetails, fitEditorDialogLines, permissionDialogTitle, showCancellableCustom, showCancellableEditor, showPermissionSelect } from "./dialogUi.ts";
import { createDialogHarness, expectRequestCount } from "./dialogTestHarness.ts";

for (const completion of ["abort-before-install", "synchronous-result", "factory-abort", "throw"] as const) {
	test(`custom UI ${completion} closes/disposes once without host installation`, async () => {
		const h = createDialogHarness();
		const controller = new AbortController();
		let disposals = 0;
		const result = showCancellableCustom<string>(h.context(undefined, "tui").ui, controller.signal, (_tui, _theme, _kb, done) => {
			if (completion === "throw") throw new Error("factory error");
			if (completion === "synchronous-result") { done("answer"); done("late"); }
			if (completion === "factory-abort") controller.abort();
			return { render: () => [], invalidate() {}, dispose() { disposals++; } };
		});
		if (completion === "abort-before-install") controller.abort();
		if (completion === "throw") await assert.rejects(result, /factory error/);
		else if (completion === "synchronous-result") assert.equal(await result, "answer");
		else await assert.rejects(result, { name: "AbortError" });
		assert.equal(h.requests.length, 1);
		assert.equal(h.requests[0]!.component, undefined);
		assert.equal(h.requests[0]!.doneCalls, completion === "throw" ? 0 : 1);
		assert.equal(disposals, completion === "throw" ? 0 : 1);
	});
}

test("custom UI forwards typed host options unchanged and defaults to none", async () => {
	const h = createDialogHarness();
	const options = { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", margin: 1 } } as const;
	const withOptions = showCancellableCustom<string>(h.context(undefined, "tui").ui, new AbortController().signal,
		(_tui, _theme, _kb, done) => { done("with"); return { render: () => [], invalidate() {} }; }, options);
	const without = showCancellableCustom<string>(h.context(undefined, "tui").ui, new AbortController().signal,
		(_tui, _theme, _kb, done) => { done("without"); return { render: () => [], invalidate() {} }; });
	assert.deepEqual([await withOptions, await without], ["with", "without"]);
	assert.equal(h.requests[0]!.options, options, "the caller's options object reaches host custom() untouched");
	assert.equal(h.requests[1]!.options, undefined);
});

test("overlay custom UI aborted after the factory but before installation never installs or double-completes", async () => {
	const h = createDialogHarness();
	const controller = new AbortController();
	let disposals = 0;
	const result = showCancellableCustom<string>(h.context(undefined, "tui").ui, controller.signal,
		() => { controller.abort(); return { render: () => [], invalidate() {}, dispose() { disposals++; } }; }, { overlay: true });
	await assert.rejects(result, { name: "AbortError" });
	assert.equal(h.requests[0]!.component, undefined);
	assert.deepEqual([h.requests[0]!.options, h.requests[0]!.doneCalls, disposals], [{ overlay: true }, 1, 1]);
});

test("already aborted custom UI does not create any host request", async () => {
	const h = createDialogHarness();
	const controller = new AbortController();
	controller.abort();
	assert.throws(() => showCancellableCustom(h.context().ui, controller.signal, () => { throw new Error("must not create"); }), { name: "AbortError" });
	assert.equal(h.requests.length, 0);
});

test("TUI editor retains multiline prefill and ignores external-editor shortcut", async () => {
	const h = createDialogHarness();
	const ctx = h.context(undefined, "tui");
	// A terminal restart from an uncancellable external editor must not be possible.
	const custom = ctx.ui.custom;
	ctx.ui.custom = (factory) => custom((tui, theme, _kb, done) => factory(tui, theme, { matches: (data: string, action: string) => data === "\x07" && action === "app.editor.external" } as any, done));
	const result = showCancellableEditor(ctx, new AbortController().signal, "Instructions", "line one\nline two");
	await expectRequestCount(h.requests, 1);
	const component = h.requests[0]!.component!;
	component.handleInput!("\x07");
	assert.equal(h.requests[0]!.doneCalls, 0);
	assert.match(h.notifications.at(-1) ?? "", /External editor.*disabled/i);
	component.handleInput!("\r");
	assert.equal(await result, "line one\nline two");
});

test("TUI approval details use a non-coalescing notification before the compact selector", async () => {
	const h = createDialogHarness();
	const ctx = h.context(undefined, "tui");
	const order: string[] = [];
	const select = ctx.ui.select;
	ctx.ui.notify = (text, type) => { assert.equal(type, "warning"); order.push(text); };
	ctx.ui.select = (title, choices, options) => { order.push(title); return select(title, choices, options); };
	const result = showPermissionSelect(ctx, new AbortController().signal, "Full target and scope details", "Compact title", ["Deny"]);
	await expectRequestCount(h.requests, 1);
	assert.deepEqual(order, ["Full target and scope details", "Compact title"]);
	h.requests[0]!.answer("Deny");
	assert.equal(await result, "Deny");
});

test("compact permission titles are bounded and leave all choices visible in narrow host docks", () => {
	initTheme("dark", false);
	const choices = ["Allow once", "Allow for current session", "Deny", "Custom instructions"];
	for (const kind of ["file mutation", "git mutation", "dependencies"]) {
		const title = permissionDialogTitle(kind, `very-long-target/${"界".repeat(300)}`);
		for (const width of [80, 40, 30]) {
			const selector = new ExtensionSelectorComponent(title, choices, () => {}, () => {});
			try {
				const lines = selector.render(width).map(stripVTControlCharacters);
				assert.ok(lines.length <= 21, `${width} columns: ${lines.length} dock lines`);
				for (const choice of choices) assert.ok(lines.join("\n").includes(choice));
			} finally { selector.dispose(); }
		}
	}
	assert.equal(boundedDialogDetails("x".repeat(9000)).length, 8000);
	assert.equal(boundedDialogDetails("short"), "short");
	const cut = boundedDialogDetails("x".repeat(9000)).indexOf("\n[TRUNCATED");
	const withEmojiAtCut = boundedDialogDetails("x".repeat(cut - 1) + "😀" + "x".repeat(9000));
	assert.ok(withEmojiAtCut.length <= 8000);
	assert.equal(withEmojiAtCut.split("\n")[0], "x".repeat(cut - 1), "truncation cannot split the emoji surrogate pair");
});

// ---- Cancellable editor: dock by default, bounded overlay on request ----

const editorTitle = `Custom instructions\n\n${Array.from({ length: 40 }, (_, i) => `Context line ${i + 1}`).join("\n")}`;
const editorPrefill = Array.from({ length: 30 }, (_, i) => `prefill line ${i + 1} 界 😀`).join("\n");

/** Install an editor through the harness, optionally on a terminal with a specific size. */
async function openEditor(rows: number, columns: number, options?: Parameters<typeof showCancellableEditor>[4], prefill = editorPrefill, layout?: Parameters<typeof showCancellableEditor>[5]) {
	const h = createDialogHarness();
	const ctx = h.context(undefined, "tui");
	const custom = ctx.ui.custom;
	ctx.ui.custom = ((factory: any, opts: any) => custom((tui: any, theme: any, kb: any, done: any) =>
		factory({ ...tui, terminal: { ...tui.terminal, rows, columns } }, theme, kb, done), opts)) as typeof ctx.ui.custom;
	const result = showCancellableEditor(ctx, new AbortController().signal, editorTitle, prefill, options, layout);
	await expectRequestCount(h.requests, 1);
	const request = h.requests[0]!;
	const component = request.component as Component & { focused?: boolean; handleMouse?(event: TuiMouseEvent): unknown };
	component.focused = true;
	return { h, ctx, request, component, result, render: (width = columns) => component.render(width) };
}
const wheelEvent = (type: TuiMouseEvent["type"]): TuiMouseEvent => ({
	type, button: type === "wheel" ? "none" : "left", x: 3, y: 3, screenX: 3, screenY: 3, width: 80, height: 24,
	shift: false, alt: false, ctrl: false, ...(type === "wheel" ? { wheelDelta: 3 } : {}),
});

test("the editor requests the host default presentation unless options are supplied, and RPC ignores them", async () => {
	const dock = await openEditor(24, 80);
	assert.equal(dock.request.options, undefined, "shared default stays the dock: no host presentation options");
	assert.equal(dock.component.handleMouse, undefined, "the dock component adds no pointer handling");
	dock.component.handleInput!("\x1b");
	assert.equal(await dock.result, undefined);

	const options = { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%" } } as const;
	const overlay = await openEditor(24, 80, options);
	assert.equal(overlay.request.options, options, "the caller's options reach host custom() untouched");
	overlay.component.handleInput!("\x1b");
	assert.equal(await overlay.result, undefined);

	const h = createDialogHarness();
	const rpc = showCancellableEditor(h.context(undefined, "rpc"), new AbortController().signal, "Title", "prefill", options);
	await expectRequestCount(h.requests, 1);
	assert.deepEqual([h.requests[0]!.method, h.requests[0]!.options], ["input", undefined], "RPC still uses the basic input dialog");
	h.requests[0]!.answer("typed");
	assert.equal(await rpc, "typed");
});

test("an inline editor layout bounds output and wheel input without changing host options", async () => {
	const { component, request, render, result } = await openEditor(24, 80, undefined, editorPrefill, { maxRows: () => 6 });
	assert.equal(request.options, undefined, "layout is not forwarded as host presentation options");
	assert.ok(render().length <= 6);
	assert.ok(render().some((line) => line.includes(CURSOR_MARKER)), "cursor remains in the bounded editor");
	assert.deepEqual(component.handleMouse?.(wheelEvent("wheel")), { handled: true, render: false });
	assert.equal(component.handleMouse?.(wheelEvent("click")), undefined);
	component.handleInput!("\r");
	assert.equal(await result, editorPrefill);
});

test("host custom options cannot carry a handle callback that would hide the overlay", () => {
	const h = createDialogHarness();
	const signal = new AbortController().signal;
	// @ts-expect-error onHandle is rejected: completion goes through the host callback only.
	void showCancellableEditor(h.context(undefined, "rpc"), signal, "t", "", { overlay: true, onHandle() {} }).catch(() => {});
	// @ts-expect-error onHandle is rejected for custom components too.
	void showCancellableCustom(h.context(undefined, "rpc").ui, signal, () => ({ render: () => [], invalidate() {} }), { overlay: true, onHandle() {} }).catch(() => {});
});

for (const [columns, rows] of [[80, 24], [60, 14], [40, 10], [30, 8], [20, 6], [20, 5], [12, 4], [8, 3], [8, 2], [5, 1], [80, 1], [3, 30]] as const) {
	test(`overlay editor output fits ${columns}x${rows} and always keeps the cursor line`, async () => {
		const { component, render, request } = await openEditor(rows, columns, { overlay: true });
		const lines = render();
		assert.ok(lines.length <= rows, `${lines.length} lines within ${rows} rows`);
		for (const line of lines) assert.ok(visibleWidth(line.replaceAll(CURSOR_MARKER, "")) <= columns, "line fits the width");
		const cursorLine = lines.findIndex((line) => line.includes(CURSOR_MARKER));
		assert.notEqual(cursorLine, -1, "the hardware cursor marker is rendered");
		assert.ok(cursorLine >= 0 && cursorLine < Math.min(lines.length, rows), "the cursor row is inside the rendered rows");
		if (columns >= 30) assert.match(stripVTControlCharacters(lines.join("\n")), /line 30/, "the end of the text, where the cursor is, is shown");
		if (rows >= 14 && columns >= 40) {
			const text = stripVTControlCharacters(lines.join("\n"));
			assert.match(text, /Custom instructions/, "title visible when there is room");
			assert.match(text, /submit/, "hints visible when there is room");
			assert.match(text, /cancel/);
		}
		component.handleInput!("\x1b");
		assert.equal(request.doneCalls, 1);
	});
}

for (const options of [undefined, { overlay: true }] as const) {
	test(`${options ? "overlay" : "dock"} editor title and hints follow a theme change after the first render`, async () => {
		const h = createDialogHarness();
		const ctx = h.context(undefined, "tui");
		const custom = ctx.ui.custom;
		let palette = "A";
		const theme = { fg: (color: string, text: string) => `<${palette}:${color}>${text}</${palette}>`, bg: (_c: string, text: string) => text, bold: (text: string) => text };
		ctx.ui.custom = ((factory: any, opts: any) => custom((tui: any, _theme: any, kb: any, done: any) => factory(tui, theme, kb, done), opts)) as typeof ctx.ui.custom;
		void showCancellableEditor(ctx, new AbortController().signal, "Title", "text", options);
		await expectRequestCount(h.requests, 1);
		const component = h.requests[0]!.component as Component;
		const colored = (text: string) => component.render(80).filter((line) => line.includes(text)).join("\n");
		assert.match(colored("Title"), /<A:accent>/);
		assert.match(colored("submit"), /<A:dim>/);
		palette = "B";
		component.invalidate();
		assert.match(colored("Title"), /<B:accent>/, "title re-colored");
		assert.match(colored("submit"), /<B:dim>/, "hints re-colored");
	});
}

test("overlay editor consumes only wheel input and leaves other pointer gestures to the host", async () => {
	const { component, request } = await openEditor(24, 80, { overlay: true });
	assert.deepEqual(component.handleMouse?.(wheelEvent("wheel")), { handled: true, render: false });
	for (const type of ["press", "drag", "release", "click", "move"] as const) assert.equal(component.handleMouse?.(wheelEvent(type)), undefined, type);
	component.handleInput!("\x1b");
	assert.equal(request.doneCalls, 1);
});

test("overlay editor accepts bracketed paste, expands large pastes on submit and ignores late input", async () => {
	const { component, result, request } = await openEditor(24, 80, { overlay: true }, "");
	component.handleInput!("\x1b[200~first\r\nsecond\x1b[201~");
	const large = Array.from({ length: 15 }, (_, i) => `row ${i}`).join("\n");
	component.handleInput!(`\x1b[200~${large}\x1b[201~`);
	assert.match(stripVTControlCharacters(component.render(80).join("\n")), /\[paste #1 \+15 lines\]/, "large paste is shown as a marker");
	component.handleInput!("\r");
	assert.equal(await result, `first\nsecond${large}`);
	component.handleInput!("\r");
	assert.equal(request.doneCalls, 1);
});

test("editor dialog fitting sheds chrome in order and windows the editor around its cursor line last", () => {
	const title = ["t1", "t2", "t3"];
	const editor = ["top", "a", `b${CURSOR_MARKER}`, "c", "bottom"];
	const hints = ["hint one", "hint two"];
	assert.deepEqual(fitEditorDialogLines(20, 40, title, editor, hints), [...title, "", ...editor, ...hints], "everything fits");
	assert.deepEqual(fitEditorDialogLines(10, 40, title, editor, hints), ["t1", "t2 …", "", ...editor, ...hints], "title is cut and marked");
	assert.deepEqual(fitEditorDialogLines(9, 40, title, editor, hints), ["t1 …", "", ...editor, ...hints]);
	assert.deepEqual(fitEditorDialogLines(7, 40, title, editor, hints), ["t1 …", ...editor, "hint one"], "spacer and second hint line go before the title is lost");
	assert.deepEqual(fitEditorDialogLines(6, 40, title, editor, hints), ["t1 …", ...editor], "hints go next");
	assert.deepEqual(fitEditorDialogLines(5, 40, title, editor, hints), editor, "then the title");
	assert.deepEqual(fitEditorDialogLines(3, 40, title, editor, hints), ["a", `b${CURSOR_MARKER}`, "c"], "the editor is windowed around the cursor");
	assert.deepEqual(fitEditorDialogLines(1, 40, title, editor, hints), [`b${CURSOR_MARKER}`]);
	assert.deepEqual(fitEditorDialogLines(0, 40, title, editor, hints), [`b${CURSOR_MARKER}`], "non-positive heights degrade to one row");
	assert.deepEqual(fitEditorDialogLines(2, 40, title, ["x", `y${CURSOR_MARKER}`], hints), ["x", `y${CURSOR_MARKER}`]);
	assert.deepEqual(fitEditorDialogLines(2, 40, title, [`x${CURSOR_MARKER}`, "y", "z"], hints), [`x${CURSOR_MARKER}`, "y"], "a cursor at the top keeps the top");
	assert.deepEqual(fitEditorDialogLines(2, 40, title, ["x", "y", `z${CURSOR_MARKER}`], hints), ["y", `z${CURSOR_MARKER}`], "a cursor at the bottom keeps the bottom");
});
