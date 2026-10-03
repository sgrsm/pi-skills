import assert from "node:assert/strict";
import test from "node:test";
import clarifyExtension, { renderClarifyOptionLines, styleClarifyOptionLine } from "./index.ts";
import { createDialogHarness, expectRequestCount, flushDialogs } from "../shared/dialogTestHarness.ts";

test("clarify is model-only and sequential; two calls cannot overlap", { timeout: 3000 }, async () => {
	const h = createDialogHarness();
	clarifyExtension(h.pi, { loadModeState: () => ({ enabled: true }) });
	assert.equal(h.tools.get("clarify")!.exposure, "model-only");
	assert.equal(h.tools.get("clarify")!.executionMode, "sequential");
	const ctx = h.context();
	const first = h.clarify("first", ctx);
	await expectRequestCount(h.requests, 1);
	const second = h.clarify("second", ctx);
	await expectRequestCount(h.requests, 1);
	h.requests[0]!.answer("1. First");
	assert.equal((await first).details.answerType, "option");
	await expectRequestCount(h.requests, 2);
	h.requests[1]!.answer();
	assert.equal((await second).details.answerType, "cancelled");
});

for (const mode of ["tui", "rpc"] as const) {
	for (const phase of ["queued", "selector", "editor", "editor-only"] as const) {
		test(`clarify ${mode}: cancellation while ${phase} settles exactly once`, { timeout: 3000 }, async () => {
			const h = createDialogHarness();
			clarifyExtension(h.pi, { loadModeState: () => ({ enabled: true }) });
			const controller = new AbortController();
			const ctx = h.context(undefined, mode);
			const first = h.clarify("first", ctx, controller.signal, phase === "editor-only" ? [] : undefined);
			await expectRequestCount(h.requests, 1);
			const queuedController = new AbortController();
			const second = h.clarify("second", ctx, queuedController.signal);
			await expectRequestCount(h.requests, 1);
			if (phase === "editor") {
				if (mode === "tui") {
					h.requests[0]!.component!.handleInput!("\x1b[B");
					h.requests[0]!.component!.handleInput!("\x1b[B");
					h.requests[0]!.component!.handleInput!("\r");
				} else h.requests[0]!.answer("3. Custom instructions");
				await expectRequestCount(h.requests, 2);
			}
			if (phase === "queued") {
				queuedController.abort();
				assert.equal((await second).details.answerType, "cancelled");
				controller.abort();
			} else {
				controller.abort();
				await expectRequestCount(h.requests, phase === "editor" ? 3 : 2);
				queuedController.abort();
			}
			const result = await first;
			assert.equal(result.details.answerType, "cancelled");
			assert.equal(result.content[0]?.type === "text" && result.content[0].text, "User cancelled the clarification.");
			assert.equal((await second).details.answerType, "cancelled");
			if (mode === "tui") {
				for (const request of h.requests) assert.equal(request.doneCalls, 1);
				// Late input after abort cannot complete a custom UI a second time.
				h.requests[0]!.component?.handleInput?.("\r");
				await flushDialogs();
				assert.equal(h.requests[0]!.doneCalls, 1);
			} else {
				assert.equal(h.requests[0]!.signal?.aborted, true);
				if (phase === "editor" || phase === "editor-only") assert.equal(h.requests[phase === "editor" ? 1 : 0]!.method, "input");
			}
		});
	}
}

for (const reason of ["shutdown", "reload"] as const) {
	test(`clarify ${reason} settles both calls and prevents stale UI`, { timeout: 3000 }, async () => {
		const h = createDialogHarness();
		clarifyExtension(h.pi, { loadModeState: () => ({ enabled: true }) });
		const ctx = h.context(undefined, "tui");
		const first = h.clarify("first", ctx);
		await expectRequestCount(h.requests, 1);
		const second = h.clarify("second", ctx);
		await expectRequestCount(h.requests, 1);
		await h.emit("session_shutdown", { reason }, ctx);
		assert.equal((await first).details.answerType, "cancelled");
		assert.equal((await second).details.answerType, "cancelled");
		assert.equal(h.requests.length, 1);
		assert.equal(h.requests[0]!.doneCalls, 1);
	});
}

const theme = {
	fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
};

test("styleClarifyOptionLine keeps unselected options on the accent color", () => {
	assert.equal(styleClarifyOptionLine("  1. keep", false, theme), "<accent>  1. keep</accent>");
});

test("styleClarifyOptionLine makes the selected option fixed blue and bold", () => {
	assert.equal(
		styleClarifyOptionLine("→ 2. try", true, theme),
		"\x1b[38;2;0;102;204m\x1b[1m→ 2. try\x1b[22m\x1b[39m",
	);
});

test("renderClarifyOptionLines inverts the old clarify selector emphasis", () => {
	const lines = renderClarifyOptionLines(
		[
			{ value: "keep", label: "1. keep #0066CC" },
			{ value: "try", label: "2. try #00D7FF" },
		],
		"try",
		80,
		theme,
	);

	assert.deepEqual(lines, [
		"<accent>  1. keep #0066CC</accent>",
		"\x1b[38;2;0;102;204m\x1b[1m→ 2. try #00D7FF\x1b[22m\x1b[39m",
	]);
});
