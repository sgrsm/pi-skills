import assert from "node:assert/strict";
import test from "node:test";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	initTheme,
	keyHint,
	ToolExecutionComponent,
	type AgentToolResult,
	type ExtensionAPI,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Container, Text, stripTerminalSequences, visibleWidth, type Component } from "@earendil-works/pi-tui";
import gitInspectExtension, { formatGitFailure } from "./index.ts";

// Built-in theme only; no terminal, personal settings, or live Git output.
initTheme("dark", false);
const theme = { fg: (_color: string, text: string) => text };
const PREVIEW_LINES = 5;

function registerTool(hidden: () => boolean = () => false): ToolDefinition<any, any, any> {
	let tool: ToolDefinition<any, any, any> | undefined;
	gitInspectExtension({ registerTool(value) { tool = value; } } as ExtensionAPI,
		{ hideToolOutputEnabled: hidden });
	assert.ok(tool?.renderResult);
	return tool;
}

function result(text: string, details: unknown = undefined): AgentToolResult<unknown> {
	return { content: [{ type: "text", text }], details };
}

function render(tool: ToolDefinition<any, any, any>, value: AgentToolResult<unknown>,
	expanded = false, lastComponent?: Component, isPartial = false, isError = false): Component {
	return tool.renderResult!(value, { expanded, isPartial }, theme as any,
		{ lastComponent, isPartial, isError, expanded, state: {} } as any);
}

function plain(lines: string[]): string[] {
	return lines.map((line) => stripTerminalSequences(line).trimEnd());
}

function syntheticLines(count: number, prefix = "RESULT"): string {
	return Array.from({ length: count }, (_, i) => `${prefix}_${i}`).join("\n");
}

test("visible Git results have a five-visual-line head preview and complete expanded text", () => {
	const tool = registerTool();
	const value = result(syntheticLines(DEFAULT_MAX_LINES));
	const snapshot = structuredClone(value);
	const collapsed = render(tool, value);
	const lines = plain(collapsed.render(100));
	assert.equal(lines.length, PREVIEW_LINES + 1);
	assert.deepEqual(lines.slice(0, PREVIEW_LINES), syntheticLines(PREVIEW_LINES).split("\n"));
	assert.match(lines.at(-1)!, /1995 more lines.*to expand/);
	assert.ok(lines.at(-1)!.includes(stripTerminalSequences(keyHint("app.tools.expand", "to expand"))));

	const expanded = render(tool, value, true, collapsed);
	assert.deepEqual(expanded.render(100), new Text((value.content[0] as { text: string }).text, 0, 0).render(100));
	assert.deepEqual(value, snapshot, "rendering must not change model-facing content or details");
});

test("small and multiple-text-block Git results stay complete without an expansion hint", () => {
	const tool = registerTool();
	const value = { content: [
		{ type: "text", text: "first\nsecond" },
		{ type: "image", data: "synthetic", mimeType: "image/png" },
		{ type: "text", text: "" },
		{ type: "text", text: "third" },
	], details: undefined } as AgentToolResult<unknown>;
	const collapsed = render(tool, value);
	assert.deepEqual(plain(collapsed.render(30)), ["first", "second", "third"]);
	assert.deepEqual(render(tool, value, true, collapsed).render(30), new Text("first\nsecond\nthird", 0, 0).render(30));
});

test("collapsed Git results bound long wrapped lines including ANSI, tabs, and Unicode across resize", () => {
	const tool = registerTool();
	for (const text of ["x".repeat(DEFAULT_MAX_BYTES - 1024), "\u001b[31m界🙂e\u0301\t\u001b[0m".repeat(800)]) {
		const value = result(text);
		const collapsed = render(tool, value);
		for (const width of [8, 20, 73, 8]) {
			const lines = collapsed.render(width);
			assert.equal(lines.length, PREVIEW_LINES + 1, `bounded at width ${width}`);
			assert.deepEqual(lines.slice(0, PREVIEW_LINES), new Text(text, 0, 0).render(width).slice(0, PREVIEW_LINES));
			assert.ok(lines.every((line) => visibleWidth(line) <= width), `every row fits width ${width}`);
		}
		collapsed.invalidate();
		assert.equal(collapsed.render(20).length, PREVIEW_LINES + 1);
		assert.deepEqual(render(tool, value, true, collapsed).render(20), new Text(text, 0, 0).render(20));
	}
});

test("visible partial and error Git results are previewed and remain fully diagnosable when expanded", () => {
	const tool = registerTool();
	for (const isPartial of [true, false]) for (const isError of [true, false]) {
		const text = syntheticLines(30, isError ? "DIAGNOSTIC" : "PARTIAL");
		const value = result(text); // Host error/partial results may have no details.
		const collapsed = render(tool, value, false, undefined, isPartial, isError);
		assert.equal(collapsed.render(80).length, PREVIEW_LINES + 1);
		assert.deepEqual(plain(collapsed.render(80)).slice(0, PREVIEW_LINES), text.split("\n").slice(0, PREVIEW_LINES));
		assert.deepEqual(render(tool, value, true, collapsed, isPartial, isError).render(80), new Text(text, 0, 0).render(80));
	}
});

test("collapsed previews keep success/process-cap and error truncation notices discoverable", () => {
	const tool = registerTool();
	const outputNotice = "[Output truncated: visible output is limited to 50KB or 2,000 lines; Git was stopped after 512KB stdout or 64KB stderr. Refine the Git inspection request for a smaller result.]";
	const failure = formatGitFailure("status", {
		exitCode: 128, signal: null, stdout: Buffer.alloc(0),
		stderr: Buffer.from(syntheticLines(DEFAULT_MAX_LINES + 100, "FAILURE")),
		outputCapped: false, timedOut: false, aborted: false,
	});
	for (const [text, details, label] of [
		[`${syntheticLines(40)}\n\n${outputNotice}`, { truncated: true, processOutputCapped: true }, "Output truncated"],
		[failure.message, undefined, "Error output truncated"],
	] as const) {
		const value = result(text, details);
		const snapshot = structuredClone(value);
		const collapsed = render(tool, value, false, undefined, false, label.startsWith("Error"));
		for (const width of [30, 80, 160]) {
			const lines = plain(collapsed.render(width));
			assert.equal(lines.length, PREVIEW_LINES + 2, "preview, expansion hint, and one bounded notice");
			assert.ok(lines.some((line) => line.includes(label)), `notice is discoverable at ${width}`);
			assert.ok(collapsed.render(width).every((line) => visibleWidth(line) <= width));
		}
		assert.deepEqual(render(tool, value, true, collapsed).render(80), new Text(text, 0, 0).render(80));
		assert.deepEqual(value, snapshot);
	}
});

test("partial truncation metadata without a text footer still produces a bounded warning", () => {
	const tool = registerTool();
	for (const text of ["partial output", syntheticLines(30)]) {
		const collapsed = render(tool, result(text, { truncated: true }), false, undefined, true);
		assert.match(plain(collapsed.render(80)).join("\n"), /Output truncated/);
		assert.ok(collapsed.render(20).length <= PREVIEW_LINES + 2);
	}
	const smallNotice = "partial\n\n[Output truncated: process cap.]";
	assert.deepEqual(plain(render(tool, result(smallNotice, { truncated: true })).render(80)), smallNotice.split("\n"),
		"a fully visible footer needs no duplicate warning");
});

test("reused result components clear stale previews, warnings, empty/partial results, and hidden errors", () => {
	let hidden = false;
	const tool = registerTool(() => hidden);
	const initial = new Container();
	initial.addChild(new Text("STALE_CHILD", 0, 0));
	let previous: Component = initial;
	const scenarios = [
		{ value: result(syntheticLines(30)), expanded: false, partial: true, error: false, hidden: false },
		{ value: result("FINAL_OUTPUT"), expanded: true, partial: false, error: false, hidden: false },
		{ value: result(`${syntheticLines(40)}\n\n[Output truncated: process cap.]`, { truncated: true }), expanded: false, partial: false, error: false, hidden: false },
		{ value: result("DIAGNOSTIC"), expanded: false, partial: false, error: true, hidden: false },
		{ value: result("DIAGNOSTIC"), expanded: true, partial: false, error: true, hidden: true },
		{ value: { content: [], details: undefined }, expanded: true, partial: true, error: false, hidden: false },
		{ value: result("   \n\t"), expanded: false, partial: false, error: false, hidden: false },
		{ value: result("VISIBLE_AGAIN"), expanded: false, partial: false, error: false, hidden: false },
	];
	for (const scenario of scenarios) {
		hidden = scenario.hidden;
		const component = render(tool, scenario.value, scenario.expanded, previous, scenario.partial, scenario.error);
		assert.equal(component, previous, "reuse the host result slot's Container");
		const fresh = render(tool, scenario.value, scenario.expanded, undefined, scenario.partial, scenario.error);
		assert.deepEqual(component.render(80), fresh.render(80), "reused components must equal fresh rendering");
		assert.doesNotMatch(plain(component.render(80)).join("\n"), /STALE_CHILD/);
		if (hidden || !scenario.value.content.length) assert.deepEqual(component.render(80), []);
		previous = component;
	}
});

test("explicit hiding wins over expansion for all partial/error result states", () => {
	const tool = registerTool(() => true);
	for (const expanded of [false, true]) for (const isPartial of [false, true]) for (const isError of [false, true]) {
		const value = result(`${syntheticLines(30)}\n\n[Error output truncated: limit.]`);
		assert.deepEqual(render(tool, value, expanded, new Text("OLD_RESULT", 0, 0), isPartial, isError).render(80), []);
	}
});

test("public Pi tool rows preserve preview/expansion and hiding across partial, error, and reused slots", () => {
	let hidden = false;
	const tool = registerTool(() => hidden);
	const contexts: Array<{ expanded: boolean; isPartial: boolean; isError: boolean }> = [];
	const components: Component[] = [];
	const row = new ToolExecutionComponent("git_inspect", "synthetic-git-row", { operation: "status" }, {}, {
		...tool,
		renderResult(...args: Parameters<NonNullable<typeof tool.renderResult>>) {
			const [value, options, activeTheme, context] = args;
			contexts.push({ expanded: options.expanded, isPartial: options.isPartial, isError: context.isError });
			const component = tool.renderResult!(value, options, activeTheme, context);
			components.push(component);
			return component;
		},
	}, { requestRender() {} } as any, "/synthetic/repository");
	row.updateResult({ ...result(syntheticLines(24)), isError: false }, true);
	assert.equal(plain(row.render(80)).filter((line) => line.includes("RESULT_")).length, PREVIEW_LINES);
	assert.match(plain(row.render(80)).join("\n"), /to expand/);
	assert.deepEqual(contexts.at(-1), { expanded: false, isPartial: true, isError: false });
	row.setExpanded(true);
	assert.equal(plain(row.render(80)).filter((line) => line.includes("RESULT_")).length, 24);
	row.updateResult({ ...result(syntheticLines(24, "ERROR")), isError: true });
	assert.match(plain(row.render(80)).join("\n"), /ERROR_23/);
	assert.deepEqual(contexts.at(-1), { expanded: true, isPartial: false, isError: true });
	row.setExpanded(false);
	assert.equal(plain(row.render(80)).filter((line) => line.includes("ERROR_")).length, PREVIEW_LINES);
	hidden = true;
	row.invalidate();
	row.setExpanded(true);
	assert.match(plain(row.render(80)).join("\n"), /git_inspect status/);
	assert.doesNotMatch(plain(row.render(80)).join("\n"), /ERROR_|to expand/);
	hidden = false;
	row.invalidate();
	assert.match(plain(row.render(80)).join("\n"), /ERROR_23/);
	row.updateResult({ content: [], isError: false }, true);
	assert.doesNotMatch(plain(row.render(80)).join("\n"), /ERROR_|to expand/);
	assert.ok(components.every((component) => component === components[0]), "public host passes the same result slot back for reuse");
});
