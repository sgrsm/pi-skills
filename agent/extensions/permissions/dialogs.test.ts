import assert from "node:assert/strict";
import test from "node:test";
import permissionsExtension from "./index.ts";
import { createDialogHarness, expectRequestCount, flushDialogs } from "../shared/dialogTestHarness.ts";

for (const kind of ["file", "git", "package"] as const) {
	for (const choice of ["Allow once", "Allow for current session", "Deny", "Custom instructions"]) {
		test(`${kind}: nested permission requests queue the entire ${choice} exchange`, { timeout: 3000 }, async () => {
			const h = createDialogHarness();
			permissionsExtension(h.pi);
			const ctx = h.context();
			const first = h.permission(kind, "first", ctx);
			await expectRequestCount(h.requests, 1);
			const second = h.permission(kind, "second", ctx);
			await expectRequestCount(h.requests, 1);
			h.requests[0]!.answer(choice);
			if (choice === "Custom instructions") {
				await expectRequestCount(h.requests, 2);
				assert.equal(h.requests[1]!.method, "input", "RPC instructions must use a cancellable host dialog");
				h.requests[1]!.answer("Use a safer path");
				assert.match((await first)?.reason ?? "", /Custom instructions: Use a safer path/);
			} else {
				assert.equal(Boolean(await first), choice === "Deny");
			}
			if (choice === "Allow for current session") {
				assert.equal(await second, undefined);
				assert.equal(h.requests.length, 1, "eligible queued duplicate must reuse the scoped grant");
			} else {
				await expectRequestCount(h.requests, choice === "Custom instructions" ? 3 : 2);
				h.requests.at(-1)!.answer("Deny");
				assert.equal((await second)?.block, true);
			}
		});
	}

	test(`${kind}: queued grants do not cover another operation or manager`, { timeout: 3000 }, async () => {
		const h = createDialogHarness();
		permissionsExtension(h.pi);
		const ctx = h.context();
		const first = h.permission(kind, "first", ctx);
		await expectRequestCount(h.requests, 1);
		const second = h.permission(kind, "second", ctx, true);
		await expectRequestCount(h.requests, 1);
		h.requests[0]!.answer("Allow for current session");
		assert.equal(await first, undefined);
		await expectRequestCount(h.requests, 2);
		h.requests[1]!.answer("Deny");
		assert.equal((await second)?.block, true);
	});

	test(`${kind}: session grants cannot skip a queued request for a different target/repository/project`, { timeout: 3000 }, async () => {
		const h = createDialogHarness();
		permissionsExtension(h.pi);
		const ctx = h.context();
		const first = h.permission(kind, "first", ctx);
		await expectRequestCount(h.requests, 1);
		const other = kind === "file"
			? h.emit("tool_call", { toolName: "write", toolCallId: "parent/1", parentToolCallId: "parent", input: { path: "/synthetic/different-target/file.txt" } }, ctx)
			: h.permission(kind, "other", h.context(undefined, "rpc", "/synthetic/other-project"));
		await expectRequestCount(h.requests, 1);
		h.requests[0]!.answer("Allow for current session");
		await first;
		await expectRequestCount(h.requests, 2);
		h.requests[1]!.answer("Deny");
		assert.equal((await other)?.block, true);
	});

	for (const phase of ["queued", "displayed", "instructions"] as const) {
		test(`${kind}: abort while ${phase} fails closed and releases the queue`, { timeout: 3000 }, async () => {
			const h = createDialogHarness();
			permissionsExtension(h.pi);
			const controller = new AbortController();
			const ctx = h.context(controller.signal);
			const first = h.permission(kind, "first", ctx);
			await expectRequestCount(h.requests, 1);
			const secondController = new AbortController();
			const second = h.permission(kind, "second", h.context(secondController.signal));
			await expectRequestCount(h.requests, 1);
			if (phase === "instructions") {
				h.requests[0]!.answer("Custom instructions");
				await expectRequestCount(h.requests, 2);
				assert.equal(h.requests[1]!.method, "input");
			}
			if (phase === "queued") {
				secondController.abort();
				assert.equal((await second)?.block, true);
				assert.equal(h.requests.length, 1);
				h.requests[0]!.answer("Deny");
				await first;
			} else {
				controller.abort();
				assert.equal((await first)?.block, true);
				assert.equal(h.requests[phase === "instructions" ? 1 : 0]!.signal?.aborted, true);
				await expectRequestCount(h.requests, phase === "instructions" ? 3 : 2);
				const notifications = h.notifications.length;
				h.requests[0]!.answer("Allow for current session"); // late answer must have no effect
				await flushDialogs();
				assert.equal(h.notifications.length, notifications);
				h.requests.at(-1)!.answer("Deny");
				assert.equal((await second)?.block, true);
			}
		});
	}
}

for (const reason of ["shutdown", "reload"] as const) {
	test(`${reason} cancels displayed and queued permissions, ignores late answers, and permits a fresh session`, { timeout: 3000 }, async () => {
		const h = createDialogHarness();
		permissionsExtension(h.pi);
		const ctx = h.context();
		const first = h.permission("file", "first", ctx);
		await expectRequestCount(h.requests, 1);
		const second = h.permission("file", "second", ctx);
		await expectRequestCount(h.requests, 1);
		await h.emit("session_shutdown", { reason }, ctx);
		assert.equal((await first)?.block, true);
		assert.equal((await second)?.block, true);
		assert.equal(h.requests[0]!.signal?.aborted, true);
		h.requests[0]!.answer("Allow for current session");
		await h.emit("session_start", { reason: "reload" }, h.context());
		const fresh = h.permission("file", "fresh", h.context());
		await expectRequestCount(h.requests, 2);
		h.requests[1]!.answer("Deny");
		assert.equal((await fresh)?.block, true);
	});
}

test("queued requests re-check /permissions off; no-UI and P0 denials never wait for the dialog lock", { timeout: 3000 }, async () => {
	const h = createDialogHarness();
	permissionsExtension(h.pi);
	const ctx = h.context();
	const first = h.permission("file", "first", ctx);
	await expectRequestCount(h.requests, 1);
	const second = h.permission("file", "second", ctx);
	await expectRequestCount(h.requests, 1);
	const noUi = await h.permission("file", "headless", { ...ctx, hasUI: false });
	assert.equal(noUi?.block, true);
	const p0 = await h.emit("tool_call", { toolName: "bash", input: { command: "rm -rf /" } }, { ...ctx, cwd: process.cwd() });
	assert.match(p0?.reason ?? "", /P0_DELETE_CRITICAL_TARGET/);
	await h.commands.get("permissions").handler("off", ctx);
	h.requests[0]!.answer("Allow once");
	assert.equal(await first, undefined);
	assert.equal(await second, undefined);
	assert.equal(h.requests.length, 1);
});

for (const kind of ["git", "package"] as const) {
	test(`${kind}: shutdown during request analysis settles without further stale API calls`, { timeout: 3000 }, async () => {
		const h = createDialogHarness();
		permissionsExtension(h.pi);
		let calls = 0;
		let execSignal: AbortSignal | undefined;
		let lateResult!: (value: any) => void;
		h.pi.exec = async (_command, _args, options) => {
			calls++;
			execSignal = options?.signal;
			return new Promise((resolve) => { lateResult = resolve; });
		};
		const ctx = h.context();
		const pending = h.permission(kind, "analysis", ctx);
		await flushDialogs();
		assert.equal(calls, 1);
		assert.equal(h.requests.length, 0);
		await h.emit("session_shutdown", { reason: "reload" }, ctx);
		assert.equal((await pending)?.block, true);
		assert.equal(execSignal?.aborted, true);
		lateResult({ code: 0, stdout: "/synthetic/project", stderr: "", killed: false });
		await flushDialogs();
		assert.equal(calls, 1);
		assert.equal(h.requests.length, 0);
	});
}

for (const mode of ["rpc", "tui"] as const) {
	test(`${mode}: hidden scopes cannot be approved after permission detail truncation`, { timeout: 3000 }, async () => {
		const h = createDialogHarness();
		permissionsExtension(h.pi);
		const ctx = h.context(undefined, mode, process.cwd());
		const paths = Array.from({ length: 40 }, (_, index) => `/synthetic/outside/${"d".repeat(200)}/${index}.txt`);
		paths.push("/synthetic/final/secret.txt");
		const command = `tee ${paths.join(" ")}`;
		const first = h.emit("tool_call", { toolName: "bash", toolCallId: "large", input: { command } }, ctx);
		await expectRequestCount(h.requests, 1);
		const details = mode === "rpc" ? h.requests[0]!.title : h.notifications[0]!;
		assert.ok(details.length <= 8000);
		assert.ok(!details.includes("/synthetic/final/secret.txt"), "regression must exercise a hidden trailing target");
		assert.deepEqual(h.requests[0]!.choices, ["Deny", "Custom instructions"]);
		assert.match(details, /TRUNCATED/);
		h.requests[0]!.answer("Allow for current session"); // even an invalid client reply must not grant hidden scopes
		assert.equal((await first)?.block, true);
		const next = h.emit("tool_call", { toolName: "bash", toolCallId: "next", input: { command: "tee /synthetic/final/secret.txt" } }, ctx);
		await expectRequestCount(h.requests, 2);
		h.requests[1]!.answer("Deny");
		assert.equal((await next)?.block, true);
	});
}

test("RPC approvals carry full bounded scopes in the select request, not just notifications", async () => {
	const h = createDialogHarness();
	permissionsExtension(h.pi);
	const request = h.permission("file", "a-long-specific-target-name", h.context());
	await expectRequestCount(h.requests, 1);
	assert.match(h.requests[0]!.title, /\/synthetic\/outside\/a-long-specific-target-name\.txt/);
	assert.match(h.requests[0]!.title, /session scope: \/synthetic\/outside/);
	h.requests[0]!.answer("Deny");
	await request;
});

for (const choice of ["Keep", "Clear permissions"]) {
	test(`/permissions queues with fresh grant details before ${choice}`, { timeout: 3000 }, async () => {
		const h = createDialogHarness();
		permissionsExtension(h.pi);
		const ctx = h.context();
		const first = h.permission("file", "first", ctx);
		await expectRequestCount(h.requests, 1);
		h.requests[0]!.answer("Allow for current session");
		await first;
		const pending = h.permission("file", "second", ctx, true); // edit grant is not yet present
		await expectRequestCount(h.requests, 2);
		const command = h.commands.get("permissions").handler("", ctx);
		await expectRequestCount(h.requests, 2);
		h.requests[1]!.answer("Allow for current session");
		await pending;
		await expectRequestCount(h.requests, 3);
		assert.match(h.requests[2]!.title, /edit: \/synthetic\/outside/);
		h.requests[2]!.answer(choice);
		await command;
		const next = h.permission("file", "next", ctx, true);
		await flushDialogs();
		if (choice === "Keep") { assert.equal(h.requests.length, 3); assert.equal(await next, undefined); }
		else { await expectRequestCount(h.requests, 4); h.requests[3]!.answer("Deny"); assert.equal((await next)?.block, true); }
	});
}

test("/permissions abort while queued opens no dialog and does not clear grants", { timeout: 3000 }, async () => {
	const h = createDialogHarness();
	permissionsExtension(h.pi);
	const ctx = h.context();
	const first = h.permission("file", "first", ctx);
	await expectRequestCount(h.requests, 1);
	h.requests[0]!.answer("Allow for current session");
	await first;
	const active = h.permission("file", "edit", ctx, true);
	await expectRequestCount(h.requests, 2);
	const controller = new AbortController();
	const command = h.commands.get("permissions").handler("", h.context(controller.signal));
	await expectRequestCount(h.requests, 2);
	controller.abort();
	await command;
	h.requests[1]!.answer("Deny");
	await active;
	assert.equal(await h.permission("file", "next", ctx), undefined);
	assert.equal(h.requests.length, 2);
});

test("TUI permissions keep the custom editor exchange locked, with balanced disposal", { timeout: 3000 }, async () => {
	const h = createDialogHarness();
	permissionsExtension(h.pi);
	const controller = new AbortController();
	const ctx = h.context(controller.signal, "tui");
	const first = h.permission("file", "first", ctx);
	await expectRequestCount(h.requests, 1);
	const second = h.permission("file", "second", h.context(undefined, "tui"));
	h.requests[0]!.answer("Custom instructions");
	await expectRequestCount(h.requests, 2);
	assert.equal(h.requests[1]!.method, "custom");
	controller.abort();
	assert.equal((await first)?.block, true);
	assert.equal(h.requests[1]!.doneCalls, 1);
	await expectRequestCount(h.requests, 3);
	h.requests[2]!.answer("Deny");
	await second;
});

test("dialog rejection releases the queue without granting permissions", { timeout: 3000 }, async () => {
	const h = createDialogHarness();
	permissionsExtension(h.pi);
	const ctx = h.context();
	const failingCtx = { ...ctx, ui: { ...ctx.ui, select: async () => { throw new Error("dialog failed"); } } };
	await assert.rejects(h.permission("file", "failed", failingCtx), /dialog failed/);
	const next = h.permission("file", "next", ctx);
	await expectRequestCount(h.requests, 1);
	h.requests[0]!.answer("Deny");
	assert.equal((await next)?.block, true);
});
