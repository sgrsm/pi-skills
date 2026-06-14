import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeMcpNotifyType, truncateMcpToolContent } from "./mcpConnector.ts";

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

test("small MCP text output and image blocks are preserved", () => {
	const content = [
		{ type: "text" as const, text: "short result" },
		imageBlock,
		{ type: "text" as const, text: "more text" },
	];

	assert.deepEqual(truncateMcpToolContent(content, { maxLines: 10, maxBytes: 1024 }), content);
});

test("large MCP text output is truncated with a visible raw-result marker while images are preserved", () => {
	const content = [
		{ type: "text" as const, text: "line 1\nline 2" },
		imageBlock,
		{ type: "text" as const, text: "line 3\nline 4" },
	];

	const truncated = truncateMcpToolContent(content, { maxLines: 2, maxBytes: 1024 });

	assert.deepEqual(truncated[0], { type: "text", text: "line 1\nline 2" });
	assert.deepEqual(truncated[1], imageBlock);
	assert.equal(truncated.some((block) => block.type === "text" && block.text.includes("line 3")), false);

	const marker = truncated.at(-1);
	assert.equal(marker?.type, "text");
	assert.match(marker?.type === "text" ? marker.text : "", /MCP text output truncated/);
	assert.match(marker?.type === "text" ? marker.text : "", /Full output is preserved in tool details\.rawResult/);
});
