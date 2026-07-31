import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { truncateWebSearchVisibleOutput } from "./outputTruncation.ts";

function lineCount(text: string): number {
	if (!text) return 0;
	return text.endsWith("\n") ? text.slice(0, -1).split("\n").length : text.split("\n").length;
}

function assertVisibleTextIsBounded(text: string): void {
	assert.ok(lineCount(text) <= DEFAULT_MAX_LINES, `expected at most ${DEFAULT_MAX_LINES} lines`);
	assert.ok(Buffer.byteLength(text, "utf8") <= DEFAULT_MAX_BYTES, `expected at most ${DEFAULT_MAX_BYTES} bytes`);
}

async function removeFullOutput(result: { fullOutputPath?: string }): Promise<void> {
	if (result.fullOutputPath) await rm(dirname(result.fullOutputPath), { recursive: true, force: true });
}

test("web-search visible output is unchanged below Pi truncation limits", async () => {
	const output = "Query: Pi\n\nResults (1):\n1. Small result";

	const result = await truncateWebSearchVisibleOutput(output);

	assert.equal(result.text, output);
	assert.equal(result.truncated, false);
	assert.equal(result.truncation, undefined);
	assert.equal(result.fullOutputPath, undefined);
	assertVisibleTextIsBounded(result.text);
});

test("web-search truncates output exceeding Pi's 2,000-line limit and persists the exact full output", async () => {
	const output = Array.from({ length: DEFAULT_MAX_LINES + 1 }, (_, index) => `result ${index + 1}`).join("\n");

	const result = await truncateWebSearchVisibleOutput(output);
	try {
		assert.equal(result.truncated, true);
		assert.ok(result.fullOutputPath, "expected the full-output temp path");
		assert.match(result.text, /Output truncated: head preview/);
		assert.match(result.text, /Full formatted output saved to: /);
		assert.match(result.text, new RegExp(result.fullOutputPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		assert.equal(await readFile(result.fullOutputPath, "utf8"), output);
		assert.ok(result.truncation, "expected compact truncation metadata");
		assert.equal("content" in result.truncation, false, "metadata must not retain preview content");
		assert.ok(Buffer.byteLength(JSON.stringify(result.truncation), "utf8") < 1_000);
		assertVisibleTextIsBounded(result.text);
	} finally {
		await removeFullOutput(result);
	}
});

test("web-search truncates output exceeding Pi's 50 KB limit under the line limit", async () => {
	const output = Array.from({ length: 100 }, () => "x".repeat(600)).join("\n");
	assert.ok(lineCount(output) < DEFAULT_MAX_LINES);
	assert.ok(Buffer.byteLength(output, "utf8") > DEFAULT_MAX_BYTES);

	const result = await truncateWebSearchVisibleOutput(output);
	try {
		assert.equal(result.truncated, true);
		assert.ok(result.fullOutputPath, "expected the full-output temp path");
		assert.equal(await readFile(result.fullOutputPath, "utf8"), output);
		assertVisibleTextIsBounded(result.text);
	} finally {
		await removeFullOutput(result);
	}
});

test("web-search handles one line longer than Pi's byte limit without exceeding visible limits", async () => {
	const output = "x".repeat(DEFAULT_MAX_BYTES + 1);

	const result = await truncateWebSearchVisibleOutput(output);
	try {
		assert.equal(result.truncated, true);
		assert.ok(result.fullOutputPath, "expected the full-output temp path");
		assert.match(result.text, /^\[Output truncated: head preview/);
		assert.equal(await readFile(result.fullOutputPath, "utf8"), output);
		assert.ok(result.truncation, "expected compact truncation metadata");
		assert.equal("content" in result.truncation, false, "metadata must not retain preview content");
		assertVisibleTextIsBounded(result.text);
	} finally {
		await removeFullOutput(result);
	}
});

test("web-search removes a newly-created temp directory when its queued write fails", async () => {
	const tempDir = await mkdtemp(join(tmpdir(), "pi-web-search-write-failure-"));
	const failure = new Error("simulated queued write failure");

	try {
		await assert.rejects(
			truncateWebSearchVisibleOutput("x".repeat(DEFAULT_MAX_BYTES + 1), {
				persistence: {
					createTempDir: async () => tempDir,
					writeFile: async () => { throw failure; },
				},
			}),
			(error: unknown) => error === failure,
		);
		await assert.rejects(stat(tempDir), { code: "ENOENT" });
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
});
