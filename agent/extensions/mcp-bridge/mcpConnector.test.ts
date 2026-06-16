import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { FOOTER_STATUS_KEYS } from "../shared/footerStatus.ts";
import { createMcpConnector, formatMcpFooterStatus, formatMcpToolErrorMessage, normalizeMcpNotifyType, truncateMcpToolContent } from "./mcpConnector.ts";

const imageBlock = { type: "image" as const, data: "base64-image-data", mimeType: "image/png" };

test("MCP notification types are normalized to Pi-supported notification values", () => {
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

test("aggregate MCP footer colors the label like active connectors when any connector is enabled", () => {
	const footerStatus = formatMcpFooterStatus(
		[
			{ name: "alpha", displayName: "Alpha MCP", enabled: false },
			{ name: "zeta", displayName: "Zeta MCP", enabled: true },
		],
		{ fg: (color: string, text: string) => `<${color}>${text}</${color}>` },
	);

	assert.equal(footerStatus, "<accent>mcp: </accent><dim>alpha</dim><dim>, </dim><accent>zeta</accent>");
});

test("aggregate MCP footer separates multiple connector display names with comma-space", async () => {
	const tempDir = mkdtempSync(join(tmpdir(), "pi-mcp-footer-test-"));
	let activeTools: string[] = [];
	const sessionStartHandlers: Array<(event: unknown, ctx: unknown) => unknown> = [];
	const pi = {
		appendEntry() {},
		getActiveTools: () => activeTools,
		on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
			if (event === "session_start") sessionStartHandlers.push(handler);
		},
		registerCommand() {},
		registerTool() {},
		setActiveTools(names: string[]) {
			activeTools = names;
		},
	};
	const writeConfig = (name: string) => {
		const filePath = join(tempDir, `${name}.json`);
		writeFileSync(filePath, `${JSON.stringify({ type: "streamable-http", url: `http://127.0.0.1:1/${name}`, enabled: false }, null, 2)}\n`);
		return pathToFileURL(filePath);
	};

	try {
		await createMcpConnector(pi as never, {
			connectorName: "zeta",
			extensionName: "zeta-mcp",
			displayName: "Zeta MCP",
			toolPrefix: "zeta_",
			configUrl: writeConfig("zeta"),
		});
		await createMcpConnector(pi as never, {
			connectorName: "alpha",
			extensionName: "alpha-mcp",
			displayName: "Alpha MCP",
			toolPrefix: "alpha_",
			configUrl: writeConfig("alpha"),
		});

		const statuses = new Map<string, string | undefined>();
		const ctx = {
			sessionManager: { getBranch: () => [] },
			ui: {
				setStatus: (key: string, value: string | undefined) => statuses.set(key, value),
				theme: { fg: (_color: string, text: string) => text },
			},
		};
		for (const handler of sessionStartHandlers) {
			await handler(undefined, ctx);
		}

		const footerStatus = statuses.get(FOOTER_STATUS_KEYS.mcp) ?? "";
		assert.equal(footerStatus, "mcp: alpha, zeta");
		assert.doesNotMatch(footerStatus, / · /);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
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
