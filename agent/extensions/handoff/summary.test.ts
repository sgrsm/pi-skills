import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { buildHandoffDocument, summarizeCurrentSession } from "./index.ts";

function context(model: boolean, complete?: (...args: any[]) => any): ExtensionContext {
	const entry = (id: string, parentId: string | null, message: unknown) => ({
		type: "message", id, parentId, timestamp: "2026-01-01T00:00:00.000Z", message,
	});
	const entries = [
		entry("user", null, { role: "user", content: "Continue", timestamp: 1 }),
		entry("script", "user", { role: "assistant", timestamp: 2, content: [
			{ type: "toolCall", id: "script", name: "codemode", arguments: {} },
			{ type: "toolCall", id: "direct", name: "read", arguments: { path: "direct.ts" } },
		], api: "openai-responses", provider: "test", model: "test", stopReason: "toolUse" }),
		entry("result", "script", { role: "toolResult", toolName: "codemode", toolCallId: "script", timestamp: 3,
			content: [], isError: false, nestedCalls: { complete: false, calls: [
				{ id: "script/1", name: "read", arguments: { path: "nested-read.ts" }, status: "ok" },
				{ id: "script/2", name: "grep", arguments: { path: "nested-search.ts" }, status: "ok" },
				{ id: "script/3", name: "edit", arguments: { path: "nested-edit.ts" }, status: "error" },
				{ id: "script/4/1", name: "write", arguments: { path: "nested-write.ts" }, status: "ok" },
				{ id: "script/5", name: "read", argumentsBytes: 9000, status: "ok" },
			] } }),
	] as SessionEntry[];
	return { cwd: "/synthetic", model: model ? { id: "test", provider: "test" } : undefined,
		signal: new AbortController().signal, modelRegistry: { complete },
		sessionManager: { getEntries: () => entries, getLeafId: () => "result",
			getSessionName: () => "Test", getSessionFile: () => undefined } } as unknown as ExtensionContext;
}

function render(summary: Awaited<ReturnType<typeof summarizeCurrentSession>>): string {
	return buildHandoffDocument({ title: "Test", slug: "test", createdAt: "2026-01-01", cwd: "/synthetic",
		body: summary.body, fileOps: summary.fileOps });
}

test("mocked model summary receives the same nested operations as the no-model fallback", async () => {
	let prompt = "";
	const options: any[] = [];
	const ctx = context(true, async (_model, input, actualOptions) => {
		prompt = input.messages[0].content[0].text;
		options.push(actualOptions);
		return { content: [{ type: "text", text: "<title>Test</title><body>## Goal\n- Continue.</body>" }] };
	});
	const modelSummary = await summarizeCurrentSession(ctx, undefined);
	const fallback = await summarizeCurrentSession(context(false), undefined);
	assert.equal(modelSummary.usedFallback, false);
	assert.equal(fallback.usedFallback, true);
	assert.deepEqual(modelSummary.fileOps, fallback.fileOps);
	for (const path of ["direct.ts", "nested-read.ts", "nested-search.ts", "nested-edit.ts", "nested-write.ts"]) {
		assert.ok(prompt.includes(`- ${path}`), path);
		assert.ok(render(modelSummary).includes(`- ${path} —`), path);
		assert.ok(render(fallback).includes(`- ${path} —`), path);
	}
	assert.match(prompt, /File lists may be incomplete/);
	assert.match(render(modelSummary), /File lists may be incomplete/);
	assert.equal(render(fallback).split("File lists may be incomplete").length - 1, 1);
	assert.equal(options[0].signal, ctx.signal);
	assert.equal(options[0].cacheRetention, "none");
	await summarizeCurrentSession(ctx, undefined);
	assert.notEqual(options[0].sessionId, options[1].sessionId);
});

test("mocked model selection remains lean while incomplete records are disclosed in the final document", async () => {
	const summary = await summarizeCurrentSession(context(true, async () => ({ content: [
		{ type: "text", text: "<body>## Relevant Files\n- nested-edit.ts — check attempted change\n\n## Progress\n- Continue.</body>" },
	] })), undefined);
	const output = render(summary);
	assert.equal(summary.usedFallback, false);
	assert.match(output, /- nested-edit\.ts — check attempted change/);
	assert.doesNotMatch(output, /- nested-read\.ts —/);
	assert.equal(output.split("File lists may be incomplete").length - 1, 1);
});

test("complete nested records do not add an incompleteness notice to the model prompt or document", async () => {
	let prompt = "";
	const ctx = context(true, async (_model, input) => {
		prompt = input.messages[0].content[0].text;
		return { content: [{ type: "text", text: "<body>## Goal\n- Continue.</body>" }] };
	});
	const entry = ctx.sessionManager.getEntries()[2];
	assert.ok(entry?.type === "message" && entry.message.role === "toolResult");
	assert.ok(entry.message.nestedCalls);
	entry.message.nestedCalls = { complete: true, calls: entry.message.nestedCalls.calls.slice(0, 4) };
	const summary = await summarizeCurrentSession(ctx, undefined);
	assert.match(prompt, /- nested-read\.ts/);
	assert.doesNotMatch(prompt, /File lists may be incomplete/);
	assert.doesNotMatch(render(summary), /File lists may be incomplete/);
});

test("model-echoed notice is not duplicated and a suffixed Relevant Files heading is preserved", async () => {
	const notice = render(await summarizeCurrentSession(context(false), undefined)).split("\n")
		.find((line) => line.startsWith("> File lists may be incomplete"));
	assert.ok(notice);
	const body = `## Relevant Files (lean)\n${notice}\n\n- nested-read.ts — inspect current work`;
	const summary = await summarizeCurrentSession(context(true, async () => ({ content: [
		{ type: "text", text: `<body>${body}</body>` },
	] })), undefined);
	const output = render(summary);
	assert.ok(output.includes(body));
	assert.equal(output.split("File lists may be incomplete").length - 1, 1);
	const withoutEcho = buildHandoffDocument({ title: "Test", slug: "test", createdAt: "2026", cwd: "/synthetic",
		body: body.replace(`${notice}\n\n`, ""), fileOps: summary.fileOps });
	assert.match(withoutEcho, /## Relevant Files \(lean\)\n\n> File lists may be incomplete/);
});

for (const mode of ["error", "empty"] as const) {
	test(`${mode} model response falls back with nested operations and one incomplete-record notice`, async () => {
		const summary = await summarizeCurrentSession(context(true, async () => {
			if (mode === "error") throw new Error("mock failure");
			return { content: [] };
		}), undefined);
		assert.equal(summary.usedFallback, true);
		assert.deepEqual(summary.fileOps, (await summarizeCurrentSession(context(false), undefined)).fileOps);
		const output = render(summary);
		assert.match(output, /- nested-write\.ts — modified in session/);
		assert.equal(output.split("File lists may be incomplete").length - 1, 1);
	});
}
