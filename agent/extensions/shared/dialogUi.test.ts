import assert from "node:assert/strict";
import test from "node:test";
import { ExtensionSelectorComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { stripVTControlCharacters } from "node:util";
import { boundedDialogDetails, permissionDialogTitle, showCancellableCustom, showCancellableEditor, showPermissionSelect } from "./dialogUi.ts";
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
