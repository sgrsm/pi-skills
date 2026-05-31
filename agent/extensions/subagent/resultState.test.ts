import assert from "node:assert/strict";
import test from "node:test";
import { getFailureDiagnosticOutput, getResultOutput, isFailedResult, isRunningResult } from "./resultState.ts";

test("running placeholder results are not treated as failures", () => {
	const running = { exitCode: -1 };

	assert.equal(isRunningResult(running), true);
	assert.equal(isFailedResult(running), false);
});

test("terminal results keep failure semantics", () => {
	assert.equal(isFailedResult({ exitCode: 1 }), true);
	assert.equal(isFailedResult({ exitCode: 0, stopReason: "error" }), true);
	assert.equal(isFailedResult({ exitCode: 0, stopReason: "aborted" }), true);
	assert.equal(isFailedResult({ exitCode: 0, stopReason: "end" }), false);
});

test("parallel summary counts exclude running placeholders from failures", () => {
	const results = [
		{ exitCode: -1 },
		{ exitCode: 0, stopReason: "end" },
		{ exitCode: 1 },
		{ exitCode: 0, stopReason: "aborted" },
	];

	const running = results.filter((result) => isRunningResult(result)).length;
	const successCount = results.filter((result) => !isRunningResult(result) && !isFailedResult(result)).length;
	const failCount = results.filter((result) => !isRunningResult(result) && isFailedResult(result)).length;

	assert.deepEqual({ running, successCount, failCount }, { running: 1, successCount: 1, failCount: 2 });
});

test('running result output falls back to "(running...)" when no text is available', () => {
	assert.equal(getResultOutput({ exitCode: -1 }), "(running...)");
});

test("running result output prefers partial text over placeholder", () => {
	assert.equal(getResultOutput({ exitCode: -1, finalOutput: "Still working" }), "Still working");
});

test("failure diagnostic output includes both error message and stderr without duplication", () => {
	assert.equal(
		getFailureDiagnosticOutput({ errorMessage: "spawn failed", stderr: "spawn failed\nstack" }),
		"spawn failed\n\nspawn failed\nstack",
	);
	assert.equal(getFailureDiagnosticOutput({ errorMessage: "boom", stderr: "boom" }), "boom");
});
