import assert from "node:assert/strict";
import test from "node:test";
import { createEventBus, discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import clarifyExtension from "../clarify/index.ts";
import permissionsExtension from "../permissions/index.ts";
import { createDialogHarness, expectRequestCount } from "../shared/dialogTestHarness.ts";
import { withTestScratchFixture } from "../permissions/testScratch.ts";

for (const firstTool of ["permissions", "clarify"] as const) {
	test(`${firstTool} and the other interactive extension share one FIFO`, { timeout: 3000 }, async () => {
		const h = createDialogHarness();
		permissionsExtension(h.pi);
		clarifyExtension(h.pi, { loadModeState: () => ({ enabled: true }) });
		const ctx = h.context();
		const first = firstTool === "permissions" ? h.permission("file", "first", ctx) : h.clarify("first", ctx);
		await expectRequestCount(h.requests, 1);
		const second = firstTool === "permissions" ? h.clarify("second", ctx) : h.permission("file", "second", ctx);
		await expectRequestCount(h.requests, 1);
		h.requests[0]!.answer(firstTool === "permissions" ? "Custom instructions" : "3. Custom instructions");
		await expectRequestCount(h.requests, 2);
		assert.equal(h.requests[1]!.method, "input");
		h.requests[1]!.answer("Do it safely");
		await first;
		await expectRequestCount(h.requests, 3);
		h.requests[2]!.answer();
		await second;
	});
}

for (const owner of ["permissions", "clarify"]) {
	test(`public Pi loader shares FIFO with ${owner} first and replaces it on reload on the same event bus`, { timeout: 5000 }, async () => {
		await withTestScratchFixture(async (fixture) => {
			const events = createEventBus();
			const order = owner === "permissions" ? ["permissions", "clarify"] : ["clarify", "permissions"];
			const clarifySource = fileURLToPath(new URL("../clarify/index.ts", import.meta.url));
			const clarifyEntry = join(fixture.root, "clarify-test.ts");
			await fixture.writeFile(clarifyEntry, `import clarify from ${JSON.stringify(clarifySource)};\nexport default (pi) => clarify(pi, { loadModeState: () => ({ enabled: true }) });\n`);
			const paths = order.map((name) => name === "clarify" ? clarifyEntry : fileURLToPath(new URL(`../${name}/index.ts`, import.meta.url)));
			const h = createDialogHarness();
			const ctx = h.context();
			async function load() {
				const result = await discoverAndLoadExtensions(paths, fixture.project, fixture.sessionTemp, events);
				assert.deepEqual(result.errors, []);
				result.runtime.getActiveTools = () => ["clarify", "bash", "write", "edit"];
				result.runtime.setActiveTools = () => {};
				for (const extension of result.extensions) {
					for (const handler of extension.handlers.get("session_start") ?? []) await handler({ type: "session_start", reason: "reload" }, ctx);
				}
				return result;
			}
			const loaded = await load();
			const permission = loaded.extensions.find((extension) => extension.path.endsWith("/permissions/index.ts"))!;
			const clarify = loaded.extensions.find((extension) => extension.path === clarifyEntry)!;
			const event = { type: "tool_call", toolName: "write", toolCallId: "parent/0", parentToolCallId: "parent", input: { path: "/synthetic/outside/first.txt" } } as const;
			const first = permission.handlers.get("tool_call")![0]!(event as any, ctx);
			await expectRequestCount(h.requests, 1);
			const second = clarify.tools.get("clarify")!.definition.execute("second", { question: "Question?", options: [{ label: "First" }] }, undefined, undefined, ctx as any);
			await expectRequestCount(h.requests, 1);
			for (const extension of loaded.extensions) {
				for (const handler of extension.handlers.get("session_shutdown") ?? []) await handler({ type: "session_shutdown", reason: "reload" }, ctx);
			}
			loaded.runtime.invalidate(); // the public runtime seam used by Runner.invalidate()
			assert.equal(((await first) as { block?: boolean } | undefined)?.block, true);
			assert.equal(((await second).details as { answerType: string }).answerType, "cancelled");
			assert.equal(h.requests[0]!.signal?.aborted, true);
			const fresh = await load();
			const freshPermission = fresh.extensions.find((extension) => extension.path.endsWith("/permissions/index.ts"))!;
			const third = freshPermission.handlers.get("tool_call")![0]!(event as any, h.context());
			await expectRequestCount(h.requests, 2);
			h.requests[0]!.answer("Allow for current session"); // retired response must not grant in the new runtime
			h.requests[1]!.answer("Deny");
			assert.equal(((await third) as { block?: boolean } | undefined)?.block, true);
			for (const extension of fresh.extensions) {
				for (const handler of extension.handlers.get("session_shutdown") ?? []) await handler({ type: "session_shutdown", reason: "quit" }, ctx);
			}
			fresh.runtime.invalidate();
		});
	});
}
