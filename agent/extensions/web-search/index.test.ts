import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import webSearchExtension from "./index.ts";
import { withTestScratchFixture } from "../permissions/testScratch.ts";

function lineCount(text: string): number {
	if (!text) return 0;
	return text.endsWith("\n") ? text.slice(0, -1).split("\n").length : text.split("\n").length;
}

test("web_search preserves minimal read-only open-world hints through availability re-registration", async () => {
	await withTestScratchFixture(async (fixture) => {
		const agentDir = join(fixture.root, "agent");
		await fixture.mkdir(agentDir);
		const statePath = join(agentDir, "web-search.json");
		await fixture.writeFile(statePath, JSON.stringify({ enabled: false }));
		const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		const tools: ToolDefinition<any, any, any>[] = [];
		const handlers = new Map<string, (event: any, ctx: any) => unknown>();
		let activeTools = ["read", "late_fixture"];
		try {
			webSearchExtension({
				registerCommand() {},
				registerTool(tool: ToolDefinition<any, any, any>) { tools.push(tool); },
				on(name: string, handler: (event: any, ctx: any) => unknown) {
					handlers.set(name, handler);
					return () => {};
				},
				getActiveTools: () => activeTools,
				setActiveTools(names: string[]) { activeTools = names; },
			} as Partial<ExtensionAPI> as ExtensionAPI);
			assert.equal(tools.length, 1);
			await assert.rejects(tools[0].execute("disabled-search", { query: "fixture" }, undefined, undefined, {} as any), /disabled/);

			for (const enabled of [true, false, true]) {
				await writeFile(await fixture.assertMutationTarget(statePath), JSON.stringify({ enabled }), { mode: 0o600 });
				await handlers.get("session_start")!({}, { hasUI: false });
			}
			assert.equal(tools.length, 4, "each changed availability should re-register");
			assert.deepEqual(tools.map((tool) => tool.exposure), ["hidden", "direct", "hidden", "direct"]);
			assert.deepEqual(tools.map((tool) => tool.defaultActive), [false, true, false, true]);
			for (const tool of tools) {
				assert.equal(tool.name, "web_search");
				assert.deepEqual(tool.annotations, { readOnlyHint: true, openWorldHint: true });
				assert.equal(tool.execute, tools[0].execute, "availability must preserve execution");
				assert.equal(tool.parameters, tools[0].parameters, "availability must preserve the schema");
			}
			assert.deepEqual(activeTools, ["read", "late_fixture", "web_search"]);
		} finally {
			if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
		}
	});
});

test("web_search runtime bounds visible output while persisting complete formatted output and compact details", async () => {
	const stateDir = await mkdtemp(`${tmpdir()}/pi-web-search-state-`);
	const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
	const originalBaseUrl = process.env.PI_SEARXNG_URL;
	const originalFetch = globalThis.fetch;
	const tools = new Map<string, ToolDefinition<any, any, any>>();
	let fullOutputPath: string | undefined;
	const answer = `ANSWER_SECRET ${"🙂".repeat(13_000)}`;
	const infoboxes = [
		{ title: "INFOBOX_SECRET title 1", content: "INFOBOX_SECRET content 1", url: "https://info.example/1" },
		{ title: "INFOBOX_SECRET title 2", content: "INFOBOX_SECRET content 2", url: "https://info.example/2" },
		{ title: "INFOBOX_SECRET title 3", content: "INFOBOX_SECRET content 3", url: "https://info.example/3" },
	];
	const results = [
		{
			title: "RESULT_SECRET title 1",
			content: "RESULT_SECRET snippet 1",
			url: "https://result.example/1",
			engine: "test-engine",
			category: "general",
			publishedDate: "2026-01-02",
		},
		{ title: "RESULT_SECRET title 2", content: "RESULT_SECRET snippet 2", url: "https://result.example/2" },
		{ title: "RESULT_SECRET title 3", content: "RESULT_SECRET snippet 3", url: "https://result.example/3" },
	];
	const suggestions = Array.from({ length: 6 }, (_, index) => `SUGGESTION_SECRET ${index + 1}`);
	const expectedFormattedResponse = [
		"Query: bounded unicode query",
		"Source: https://search.example",
		"Mode: JSON API",
		"",
		"Direct answers:",
		`- ${answer}`,
		"",
		"Infoboxes:",
		"- INFOBOX_SECRET title 1: INFOBOX_SECRET content 1",
		"  URL: https://info.example/1",
		"- INFOBOX_SECRET title 2: INFOBOX_SECRET content 2",
		"  URL: https://info.example/2",
		"",
		"Results (1):",
		"1. RESULT_SECRET title 1",
		"   Meta: test-engine | general | 2026-01-02",
		"   URL: https://result.example/1",
		"   Snippet: RESULT_SECRET snippet 1",
		"",
		"Suggestions: SUGGESTION_SECRET 1, SUGGESTION_SECRET 2, SUGGESTION_SECRET 3, SUGGESTION_SECRET 4, SUGGESTION_SECRET 5",
	].join("\n");

	process.env.PI_CODING_AGENT_DIR = stateDir;
	process.env.PI_SEARXNG_URL = "https://search.example";
	globalThis.fetch = async () => new Response(JSON.stringify({ answers: [answer], infoboxes, results, suggestions }), {
		status: 200,
		headers: { "content-type": "application/json" },
	});

	try {
		webSearchExtension({
			registerCommand() {},
			registerTool(tool: ToolDefinition<any, any, any>) {
				tools.set(tool.name, tool);
			},
			on() { return () => {}; },
			getActiveTools() { return []; },
			setActiveTools() {},
		} as Partial<ExtensionAPI> as ExtensionAPI);

		const webSearchTool = tools.get("web_search");
		assert.ok(webSearchTool, "web_search should be registered");
		const result = await webSearchTool.execute(
			"web-search-test",
			{ query: "bounded unicode query", limit: 1 },
			undefined,
			undefined,
			{} as any,
		);
		const visibleText = (result.content[0] as { type: "text"; text: string }).text;
		const details = result.details as Record<string, unknown>;
		fullOutputPath = details.fullOutputPath as string;
		const serializedDetails = JSON.stringify(details);

		assert.ok(Buffer.byteLength(expectedFormattedResponse, "utf8") > DEFAULT_MAX_BYTES);
		assert.equal(details.truncated, true);
		assert.ok(fullOutputPath, "truncated output should report its persisted path");
		assert.match(visibleText, /Output truncated: head preview/);
		assert.match(visibleText, new RegExp(fullOutputPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		assert.ok(lineCount(visibleText) <= DEFAULT_MAX_LINES);
		assert.ok(Buffer.byteLength(visibleText, "utf8") <= DEFAULT_MAX_BYTES);
		assert.equal(await readFile(fullOutputPath, "utf8"), expectedFormattedResponse);

		assert.deepEqual(details.counts, {
			answers: 1,
			infoboxes: 3,
			results: 3,
			visibleResults: 1,
			suggestions: 6,
		});
		assert.equal(details.query, "bounded unicode query");
		assert.equal(details.baseUrl, "https://search.example");
		assert.equal(details.mode, "json");
		for (const property of ["answers", "infoboxes", "results", "suggestions"]) {
			assert.equal(property in details, false, `details must omit raw ${property}`);
		}
		assert.equal(serializedDetails.includes("\"content\""), false, "details and truncation metadata must omit preview content");
		for (const rawPayloadMarker of ["ANSWER_SECRET", "INFOBOX_SECRET", "RESULT_SECRET", "SUGGESTION_SECRET"]) {
			assert.equal(serializedDetails.includes(rawPayloadMarker), false, `details must omit ${rawPayloadMarker}`);
		}
		assert.ok(Buffer.byteLength(serializedDetails, "utf8") < 2_000, "details should remain compact near the output byte limit");

	} finally {
		if (fullOutputPath) await rm(dirname(fullOutputPath), { recursive: true, force: true });
		globalThis.fetch = originalFetch;
		if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
		if (originalBaseUrl === undefined) delete process.env.PI_SEARXNG_URL;
		else process.env.PI_SEARXNG_URL = originalBaseUrl;
		await rm(stateDir, { recursive: true, force: true });
	}
});
