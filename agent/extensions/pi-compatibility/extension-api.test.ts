import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEventBus, type ExtensionAPI, type ToolAnnotations } from "@earendil-works/pi-coding-agent";
import clarifyExtension from "../clarify/index.ts";
import gitInspectExtension from "../git-inspect/index.ts";
import subagentExtension from "../subagent/index.ts";
import webSearchExtension from "../web-search/index.ts";
import permissionsExtension from "../permissions/index.ts";
import { createTestExtensionCommandContext } from "../permissions/testContext.ts";
import { withTestScratchFixture } from "../permissions/testScratch.ts";

type RegisteredToolMetadata = {
	name: unknown;
	description?: unknown;
	promptSnippet?: unknown;
	promptGuidelines?: unknown;
	exposure?: unknown;
	defaultActive?: unknown;
	annotations?: ToolAnnotations;
};

type ToolExtension = (pi: ExtensionAPI) => void;
const testClarifyExtension: ToolExtension = (pi) => clarifyExtension(pi, { loadModeState: () => ({ enabled: true }) });

const promptMetadataExtensions: Array<{ name: string; register: ToolExtension }> = [
	{ name: "clarify", register: testClarifyExtension },
	{ name: "git-inspect", register: gitInspectExtension },
	{ name: "subagent", register: subagentExtension },
	{ name: "web-search", register: webSearchExtension },
];

function captureRegisteredTools(register: ToolExtension): RegisteredToolMetadata[] {
	const tools: RegisteredToolMetadata[] = [];
	const pi = {
		events: createEventBus(),
		registerTool(tool: RegisteredToolMetadata) {
			tools.push(tool);
		},
		registerCommand() {},
		on() { return () => {}; },
	} as unknown as ExtensionAPI;

	register(pi);
	return tools;
}

function namesTool(text: string, toolName: string): boolean {
	const escapedName = toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(^|[^A-Za-z0-9_])${escapedName}($|[^A-Za-z0-9_])`).test(text);
}

test("workflow tools are model-only when available, hidden and inactive otherwise", () => {
	const tools = [testClarifyExtension, subagentExtension].flatMap(captureRegisteredTools);
	assert.deepEqual(tools.map((tool) => tool.name).sort(), ["clarify", "escalate_to_parent", "subagent"]);
	assert.equal(tools.find((tool) => tool.name === "clarify")!.exposure, "model-only", "the enabled clarify fixture is model-only");
	for (const tool of tools) {
		assert.ok(tool.exposure === "model-only" || tool.exposure === "hidden", String(tool.name));
		if (tool.exposure === "hidden") assert.equal(tool.defaultActive, false, String(tool.name));
	}
});

test("workflow tool metadata explains direct model calls and prohibits codemode invocation", () => {
	const tools = [testClarifyExtension, subagentExtension].flatMap(captureRegisteredTools);
	for (const tool of tools) {
		const name = String(tool.name);
		assert.match(String(tool.description), new RegExp(`Call ${name} directly as a model tool`), name);
		assert.match(String(tool.description), /model-only/, name);
		assert.match(String(tool.promptSnippet), new RegExp(`Call ${name} directly`), name);
		const guidance = (tool.promptGuidelines as string[]).join("\n");
		assert.match(guidance, new RegExp(`Call ${name} directly as a model tool`), name);
		assert.ok(guidance.includes(`Do not invoke tools.${name}() from codemode`), name);
		assert.match(guidance, new RegExp(`call ${name} through another tool`), name);
	}
	const subagentGuidance = tools.find((tool) => tool.name === "subagent")!.promptGuidelines as string[];
	assert.match(subagentGuidance.join("\n"), /one direct subagent call with mode="parallel" and multiple items/);
});

test("inspection and retrieval hints preserve existing direct and nested-callable exposure", async () => {
	await withTestScratchFixture(async (fixture) => {
		const agentDir = join(fixture.root, "agent");
		await fixture.mkdir(agentDir);
		const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		try {
			const git = captureRegisteredTools(gitInspectExtension).find((tool) => tool.name === "git_inspect")!;
			const web = captureRegisteredTools(webSearchExtension).find((tool) => tool.name === "web_search")!;
			for (const tool of [git, web]) {
				assert.ok(tool);
				// Pi's direct exposure is declared and nested-callable while active.
				assert.equal(tool.exposure ?? "direct", "direct", String(tool.name));
				assert.equal(tool.defaultActive ?? true, true, String(tool.name));
			}
			assert.deepEqual(git.annotations, { readOnlyHint: true, openWorldHint: false });
			assert.deepEqual(web.annotations, { readOnlyHint: true, openWorldHint: true });
		} finally {
			if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
		}
	});
});

test("parent-tagged built-in events retain concrete permission guards, not generic custom/MCP approval", async () => {
	await withTestScratchFixture(async (fixture) => {
		const handlers = new Map<string, (event: any, ctx: any) => any>();
		const commands = new Map<string, { handler: (args: string, ctx: any) => unknown }>();
		const ownerPath = fileURLToPath(new URL("../permissions/index.ts", import.meta.url));
		permissionsExtension({
			events: createEventBus(),
			registerTool() {},
			registerCommand(name: string, command: { handler: (args: string, ctx: any) => unknown }) { commands.set(name, command); },
			on(name: string, handler: (event: any, ctx: any) => any) {
				handlers.set(name, handler);
				return () => {};
			},
			// Deliberately misleading hints must not bypass the concrete Bash guard.
			getAllTools: () => [{ name: "bash", annotations: { readOnlyHint: true, openWorldHint: false }, sourceInfo: { path: ownerPath } }],
			exec: async () => { throw new Error("No command may execute in event-only tests"); },
		} as unknown as ExtensionAPI, {
			systemTempDir: fixture.sessionTemp,
			home: fixture.fakeHome,
			bashOperations: { exec: async () => { throw new Error("No Bash may execute in event-only tests"); } },
		});
		const ctx = createTestExtensionCommandContext({ cwd: fixture.project, hasUI: false });
		const guard = handlers.get("tool_call")!;
		const guardedCalls = [
			{ toolName: "write", input: { path: join(fixture.protectedDir, "outside.txt"), content: "fixture" } },
			{ toolName: "edit", input: { path: join(fixture.protectedDir, "outside.txt"), oldText: "old", newText: "new" } },
			{ toolName: "bash", input: { command: `touch ${join(fixture.protectedDir, "outside.txt")}` } },
		];
		for (const [index, call] of guardedCalls.entries()) {
			const direct = await guard({ type: "tool_call", toolCallId: `direct-${index}`, ...call }, ctx);
			const nested = await guard({ type: "tool_call", toolCallId: `codemode-call/${index}`, parentToolCallId: "codemode-call", ...call }, ctx);
			assert.equal(nested?.block, true, call.toolName);
			assert.match(nested.reason, /no interactive UI/);
			assert.deepEqual(nested, direct, "nested calls must use the same ordinary guard");
		}
		// Characterizes the documented unclassified surface; no tool is executed.
		for (const toolName of ["custom_mutation", "mcp__synthetic__mutation", "codemode", "git_inspect", "web_search"]) {
			assert.equal(await guard({ type: "tool_call", toolCallId: "codemode-call/unguarded", parentToolCallId: "codemode-call",
				toolName, input: { path: join(fixture.protectedDir, "outside.txt"), command: "rm ." } }, ctx), undefined);
		}
		await commands.get("permissions")!.handler("off", ctx);
		const catastrophic = await guard({ type: "tool_call", toolCallId: "codemode-call/p0", parentToolCallId: "codemode-call",
			toolName: "bash", input: { command: "rm ." } }, ctx);
		assert.equal(catastrophic?.block, true);
		assert.match(catastrophic.reason, /P0_DELETE_CRITICAL_TARGET/);
		assert.equal(ctx.selectCalls, 0, "no prompts or actual mutation are needed");
	});
});

test("each registered custom tool names itself in every flat prompt metadata entry", () => {
	for (const extension of promptMetadataExtensions) {
		const registeredTools = captureRegisteredTools(extension.register);
		assert.ok(registeredTools.length > 0, `${extension.name} should register at least one tool`);

		for (const metadata of registeredTools) {
			assert.ok(typeof metadata.name === "string", `${extension.name} registered tool should have a string name`);
			const toolName = metadata.name;

			assert.ok(typeof metadata.promptSnippet === "string", `${toolName} should have a promptSnippet`);
			assert.ok(namesTool(metadata.promptSnippet, toolName), `${toolName} promptSnippet should name ${toolName}`);

			assert.ok(Array.isArray(metadata.promptGuidelines), `${toolName} should have promptGuidelines`);
			assert.ok(metadata.promptGuidelines.length > 0, `${toolName} should have promptGuidelines`);
			for (const [index, guideline] of metadata.promptGuidelines.entries()) {
				assert.ok(typeof guideline === "string", `${toolName} guideline ${index + 1} should be a string`);
				assert.ok(namesTool(guideline, toolName), `${toolName} guideline ${index + 1} should name ${toolName}`);
			}
		}
	}
});
