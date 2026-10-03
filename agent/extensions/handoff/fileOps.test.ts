import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { NestedToolCalls } from "@earendil-works/pi-ai";
import { buildCurrentSessionContext, buildHandoffDocument, extractFileOps } from "./index.ts";

const timestamp = 1;

// Unknown inputs deliberately include malformed saved records as well as valid host shapes.
function assistant(calls: unknown[]): AgentMessage {
	return {
		role: "assistant", content: calls, timestamp,
		api: "openai-responses", provider: "test", model: "test", stopReason: "toolUse",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	} as AgentMessage;
}

function direct(name: string, args: unknown): unknown {
	return { type: "toolCall", id: "direct", name, arguments: args };
}

function nested(name: string, args: unknown, status = "ok", id = "script/1"): unknown {
	return { id, name, arguments: args, status };
}

function result(nestedCalls?: unknown, isError = false): AgentMessage {
	return { role: "toolResult", toolName: "codemode", toolCallId: "script", content: [],
		timestamp, isError, ...(nestedCalls === undefined ? {} : { nestedCalls }) } as AgentMessage;
}

function document(body: string, messages: AgentMessage[]): string {
	return buildHandoffDocument({ title: "Test", slug: "test", createdAt: "2026-01-01", cwd: "/synthetic",
		body, fileOps: extractFileOps(messages) });
}

function assertIncomplete(messages: AgentMessage[]): void {
	const output = document("## Goal\n- Continue.", messages);
	assert.match(output, /File lists may be incomplete/);
}

test("collector accepts the public host NestedToolCalls shape without fixture casts", () => {
	const record: NestedToolCalls = { complete: true, calls: [
		{ id: "script/1/1", name: "read", arguments: { path: "typed-read.ts" }, status: "ok", durationMs: 1 },
		{ id: "script/2", name: "write", arguments: { path: "typed-write.ts" }, status: "error", error: "mock error" },
	] };
	assert.deepEqual(extractFileOps([result(record)]), { readFiles: ["typed-read.ts"], modifiedFiles: ["typed-write.ts"] });
});

test("collector combines nested read/grep/edit/write with direct calls and tagged summaries", () => {
	const messages = [
		assistant([direct("read", { path: "@src/shared.ts" }), direct("edit", { path: "src/direct.ts" }),
			direct("grep", { path: "src/direct-read.ts" }), direct("write", { path: "src/direct-write.ts" }),
			direct("codemode", { code: "not executed" })]),
		result({ complete: true, calls: [
			nested("read", { path: "src/nested-read.ts" }), nested("grep", { path: "src/nested-search.ts" }),
			nested("edit", { path: "src/nested-edit.ts" }), nested("write", { path: "src/nested-write.ts" }),
			nested("read", { path: "src/shared.ts" }), nested("edit", { path: "src/direct.ts" }),
		] }),
		{ role: "compactionSummary", summary: "<read-files>\n@src/compacted.ts\n</read-files>\n<modified-files>\nsrc/direct.ts\n</modified-files>", tokensBefore: 10, timestamp },
		{ role: "branchSummary", summary: "<read-files>\nsrc/shared.ts\n</read-files>\n<modified-files>\nsrc/summarized.ts\n</modified-files>", fromId: "old", timestamp },
	] as AgentMessage[];
	assert.deepEqual(extractFileOps(messages), {
		readFiles: ["src/compacted.ts", "src/direct-read.ts", "src/nested-read.ts", "src/nested-search.ts", "src/shared.ts"],
		modifiedFiles: ["src/direct-write.ts", "src/direct.ts", "src/nested-edit.ts", "src/nested-write.ts", "src/summarized.ts"],
	});
	const output = document("## Goal\n- Continue.", messages);
	for (const path of [...extractFileOps(messages).readFiles, ...extractFileOps(messages).modifiedFiles]) {
		assert.ok(output.includes(`- ${path} —`), path);
	}
	assert.doesNotMatch(output, /File lists may be incomplete/);
});

test("normalization and deduplication match direct calls, including read-and-modified overlap", () => {
	const messages = [assistant([direct("read", { path: "@src/a.ts" })]), result({ complete: true, calls: [
		nested("read", { path: "@src/a.ts" }), nested("write", { path: "@src/a.ts" }),
		nested("read", { path: "  src/z.ts  " }), nested("read", { path: "src/z.ts" }),
		nested("grep", { path: "." }), nested("read", { path: "./" }), nested("read", { path: "  " }),
	] })];
	assert.deepEqual(extractFileOps(messages), { readFiles: ["src/a.ts", "src/z.ts"], modifiedFiles: ["src/a.ts"] });
	const output = document("", messages);
	assert.equal(output.split("- src/a.ts —").length - 1, 1);
	assert.match(output, /src\/a\.ts — read and modified/);
});

test("failed and unfinished nested calls remain recorded attempts regardless of parent error or nested id", () => {
	const messages = [result({ complete: false, calls: [
		nested("read", { path: "attempted-read.ts" }, "error", "script/1"),
		nested("edit", { path: "attempted-edit.ts" }, "error", "script/2/1"),
		nested("write", { path: "unfinished-write.ts" }, "unfinished", "script/3/1/1"),
	] }, true)];
	const ops = extractFileOps(messages);
	assert.deepEqual(ops.readFiles, ["attempted-read.ts"]);
	assert.deepEqual(ops.modifiedFiles, ["attempted-edit.ts", "unfinished-write.ts"]);
	assertIncomplete(messages);
});

test("ordinary results and script text/details are not scanned for guessed paths", () => {
	const ordinary = result();
	Object.assign(ordinary, { content: [{ type: "text", text: 'read(path="guessed.ts")' }],
		details: { nestedCalls: { calls: [nested("edit", { path: "guessed.ts" })] } } });
	assert.deepEqual(extractFileOps([assistant([direct("codemode", { code: 'await tools.read({path:"guessed.ts"})' })]), ordinary]),
		{ readFiles: [], modifiedFiles: [] });
});

test("malformed direct and nested arguments do not crash or invent paths", () => {
	const invalid = [undefined, null, false, 4, "path.ts", [], { path: 4 }, { path: null }, { path: {} }, {}];
	const messages = [assistant([null, {}, ...invalid.map((args) => direct("read", args))]),
		result({ complete: false, calls: [null, false, {}, ...invalid.map((args) => nested("write", args)),
			nested("bash", { path: "not-a-file-op.ts" }), nested("read", { file: "no-path.ts" }),
			nested("read", { path: "valid.ts" })] })];
	const ops = extractFileOps(messages);
	assert.deepEqual(ops.readFiles, ["valid.ts"]);
	assert.deepEqual(ops.modifiedFiles, []);
	assertIncomplete(messages);
});

test("omitted arguments and dropped records produce a notice without recovering paths from error text", () => {
	for (const calls of [[], [{ id: "script/1", name: "edit", status: "error", argumentsBytes: 9000, error: "missing.ts" }]]) {
		const messages = [result({ complete: false, calls })];
		const ops = extractFileOps(messages);
		assert.deepEqual(ops.readFiles, []);
		assert.deepEqual(ops.modifiedFiles, []);
		assertIncomplete(messages);
	}
});

test("malformed nested containers are ignored conservatively", () => {
	for (const record of [null, false, "bad", {}, { complete: false }, { complete: false, calls: {} }]) {
		const messages = [result(record)];
		assert.doesNotThrow(() => extractFileOps(messages));
		assert.deepEqual(extractFileOps(messages).readFiles, []);
		assert.deepEqual(extractFileOps(messages).modifiedFiles, []);
		assertIncomplete(messages);
	}
});

test("partial nested records disclose missing arguments, missing completeness, and unfinished calls", () => {
	for (const record of [
		{ complete: true, calls: [{ id: "script/1", name: "read", status: "ok", argumentsBytes: 9000 }] },
		{ calls: [nested("read", { path: "known.ts" })] },
		{ complete: true, calls: [nested("edit", { path: "known.ts" }, "unfinished")] },
	]) assertIncomplete([result(record)]);
});

test("incomplete record notices survive model-written Relevant Files sections without replacing file selection", () => {
	const messages = [result({ complete: false, calls: [nested("read", { path: "candidate.ts" })] })];
	const body = "## Goal\n- Continue.\n\n## Relevant Files\n- chosen.ts — selected by model\n\n## Progress\n- Working.";
	const output = document(body, messages);
	assert.match(output, /File lists may be incomplete/);
	assert.match(output, /- chosen.ts — selected by model/);
	assert.doesNotMatch(output, /- candidate.ts —/);
	assert.equal(output.split("## Relevant Files").length - 1, 1);
	assert.equal(output.split("File lists may be incomplete").length - 1, 1);
});

test("complete model-written file selection and fallback's twelve-file cap stay unchanged", () => {
	const messages = [result({ complete: true, calls: Array.from({ length: 20 }, (_, index) =>
		nested("read", { path: `file-${String(index).padStart(2, "0")}.ts` })) })];
	const body = "## Relevant Files\n- selected.ts — selected by model";
	assert.ok(document(body, messages).includes(body));
	assert.doesNotMatch(document(body, messages), /File lists may be incomplete/);
	const output = document("", messages);
	assert.equal((output.match(/ — read in session/g) ?? []).length, 12);
	assert.match(output, /file-11\.ts/);
	assert.doesNotMatch(output, /file-12\.ts/);
});

test("active session projection excludes abandoned nested calls and their incomplete flag", () => {
	const entry = (id: string, parentId: string | null, message: AgentMessage) => ({
		type: "message" as const, id, parentId, timestamp: "2026-01-01T00:00:00.000Z", message,
	});
	const entries = [
		entry("root", null, { role: "user", content: "Continue", timestamp }),
		entry("selected-call", "root", assistant([direct("read", { path: "selected-direct.ts" })])),
		entry("selected-result", "selected-call", result({ complete: true, calls: [nested("edit", { path: "selected-nested.ts" })] })),
		entry("abandoned-call", "root", assistant([direct("write", { path: "abandoned-direct.ts" })])),
		entry("abandoned-result", "abandoned-call", result({ complete: false, calls: [nested("write", { path: "abandoned-nested.ts" })] })),
	];
	const current = buildCurrentSessionContext({ getEntries: () => entries, getLeafId: () => "selected-result" });
	assert.deepEqual(extractFileOps(current.messages), { readFiles: ["selected-direct.ts"], modifiedFiles: ["selected-nested.ts"] });
	assert.doesNotMatch(document("", current.messages), /abandoned|File lists may be incomplete/);
});
