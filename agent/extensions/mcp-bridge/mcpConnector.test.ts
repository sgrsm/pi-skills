import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import test from "node:test";
import { formatMcpToolErrorMessage, normalizeMcpNotifyType, truncateMcpToolContent } from "./mcpConnector.ts";

const imageBlock = { type: "image" as const, data: "base64-image-data", mimeType: "image/png" };

test("MCP notification types are normalized to Pi 0.79 supported values", () => {
	assert.equal(normalizeMcpNotifyType("success"), "info");
	assert.equal(normalizeMcpNotifyType("info"), "info");
	assert.equal(normalizeMcpNotifyType("warning"), "warning");
	assert.equal(normalizeMcpNotifyType("error"), "error");
	assert.equal(normalizeMcpNotifyType(undefined), undefined);
});

test("MCP bridge no longer passes success directly to ctx.ui.notify", () => {
	const source = readFileSync(new URL("./mcpConnector.ts", import.meta.url), "utf8");
	assert.equal(/\.notify\([\s\S]*?,\s*"success"\s*\)/.test(source), false);
});

test("small MCP text output and image blocks are preserved without truncation metadata", async () => {
	const content = [
		{ type: "text" as const, text: "short result" },
		imageBlock,
		{ type: "text" as const, text: "more text" },
	];

	const result = await truncateMcpToolContent(content, { maxLines: 10, maxBytes: 1024 });

	assert.deepEqual(result.content, content);
	assert.equal(result.truncation, undefined);
	assert.equal(result.fullTextOutputPath, undefined);
});

test("large MCP text output is truncated with a temp-file marker while images are preserved", async () => {
	const content = [
		{ type: "text" as const, text: "line 1\nline 2" },
		imageBlock,
		{ type: "text" as const, text: "line 3\nline 4" },
	];

	const result = await truncateMcpToolContent(content, { maxLines: 2, maxBytes: 1024 });
	const { content: truncated, fullTextOutputPath } = result;

	assert.deepEqual(truncated[0], { type: "text", text: "line 1\nline 2" });
	assert.deepEqual(truncated[1], imageBlock);
	assert.equal(truncated.some((block) => block.type === "text" && block.text.includes("line 3")), false);

	const marker = truncated.at(-1);
	assert.equal(marker?.type, "text");
	assert.match(marker?.type === "text" ? marker.text : "", /MCP text output truncated/);
	assert.match(marker?.type === "text" ? marker.text : "", /Full text output saved to:/);
	assert.doesNotMatch(marker?.type === "text" ? marker.text : "", /details\.rawResult/);
	assert.equal(typeof fullTextOutputPath, "string");
	assert.match(marker?.type === "text" ? marker.text : "", new RegExp(fullTextOutputPath!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	assert.equal(readFileSync(fullTextOutputPath!, "utf8"), "line 1\nline 2\nline 3\nline 4");
	assert.equal(result.truncation?.truncated, true);

	rmSync(dirname(fullTextOutputPath!), { recursive: true, force: true });
});

test("small MCP error output keeps existing text and image formatting", async () => {
	const content = [
		{ type: "text" as const, text: "small error" },
		imageBlock,
		{ type: "text" as const, text: "more context" },
	];

	const message = await formatMcpToolErrorMessage(content, { maxLines: 10, maxBytes: 1024 });

	assert.equal(message, "small error\n[image/png image]\nmore context");
	assert.doesNotMatch(message, /MCP text output truncated/);
});

test("large MCP error text is truncated with the temp-file marker before throwing", async () => {
	const content = [
		{ type: "text" as const, text: "error line 1\nerror line 2" },
		imageBlock,
		{ type: "text" as const, text: "error line 3\nerror line 4" },
	];

	const message = await formatMcpToolErrorMessage(content, { maxLines: 2, maxBytes: 1024 });

	assert.match(message, /^error line 1\nerror line 2\n\[image\/png image\]/);
	assert.doesNotMatch(message, /error line 3/);
	assert.match(message, /MCP text output truncated/);
	assert.match(message, /Full text output saved to:/);

	const fullTextOutputPath = message.match(/Full text output saved to: ([^\]]+)/)?.[1];
	assert.equal(typeof fullTextOutputPath, "string");
	assert.equal(readFileSync(fullTextOutputPath!, "utf8"), "error line 1\nerror line 2\nerror line 3\nerror line 4");

	rmSync(dirname(fullTextOutputPath!), { recursive: true, force: true });
});
