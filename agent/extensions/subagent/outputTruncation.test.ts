import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { truncateSubagentVisibleOutput } from "./outputTruncation.ts";

test("subagent visible output is unchanged below truncation limits", async () => {
	const output = "short answer\nwith a second line";

	const result = await truncateSubagentVisibleOutput(output, { maxLines: 10, maxBytes: 1024 });

	assert.equal(result.text, output);
	assert.equal(result.truncated, false);
	assert.equal(result.fullOutputPath, undefined);
});

test("subagent visible output applies line limits and saves full output to a temp file", async () => {
	const output = ["line 1", "line 2", "line 3", "line 4"].join("\n");

	const result = await truncateSubagentVisibleOutput(output, { maxLines: 2, maxBytes: 1024 });
	try {
		assert.equal(result.truncated, true);
		assert.ok(result.fullOutputPath, "expected full output temp path");
		assert.equal(result.text.startsWith("line 1\nline 2\n\n[Output truncated by 2 line limit:"), true);
		assert.match(result.text, /showing 2 of 4 lines/);
		assert.match(result.text, /Full output saved to: /);
		assert.match(result.text, new RegExp(`${result.fullOutputPath!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]$`));
		assert.equal(await readFile(result.fullOutputPath!, "utf8"), output);
	} finally {
		if (result.fullOutputPath) await rm(path.dirname(result.fullOutputPath), { recursive: true, force: true });
	}
});

test("subagent visible output applies byte limits without partial lines and saves full output", async () => {
	const output = "abcdef\nsecond line";

	const result = await truncateSubagentVisibleOutput(output, { maxLines: 10, maxBytes: 5 });
	try {
		assert.equal(result.truncated, true);
		assert.ok(result.fullOutputPath, "expected full output temp path");
		assert.equal(result.text.startsWith("[Output truncated by 5B byte limit:"), true);
		assert.match(result.text, /showing 0 of 2 lines/);
		assert.equal(await readFile(result.fullOutputPath!, "utf8"), output);
	} finally {
		if (result.fullOutputPath) await rm(path.dirname(result.fullOutputPath), { recursive: true, force: true });
	}
});
