import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import clarifyExtension from "../clarify/index.ts";
import gitInspectExtension from "../git-inspect/index.ts";
import subagentExtension from "../subagent/index.ts";
import webSearchExtension from "../web-search/index.ts";

type RegisteredToolMetadata = {
	name: unknown;
	promptSnippet?: unknown;
	promptGuidelines?: unknown;
	exposure?: unknown;
};

type ToolExtension = (pi: ExtensionAPI) => void;

const promptMetadataExtensions: Array<{ name: string; register: ToolExtension }> = [
	{ name: "clarify", register: clarifyExtension },
	{ name: "git-inspect", register: gitInspectExtension },
	{ name: "subagent", register: subagentExtension },
	{ name: "web-search", register: webSearchExtension },
];

function captureRegisteredTools(register: ToolExtension): RegisteredToolMetadata[] {
	const tools: RegisteredToolMetadata[] = [];
	const pi = {
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

test("clarification, delegation, and escalation tools are model-only", () => {
	const tools = [clarifyExtension, subagentExtension].flatMap(captureRegisteredTools);
	assert.deepEqual(tools.map((tool) => tool.name).sort(), ["clarify", "escalate_to_parent", "subagent"]);
	for (const tool of tools) assert.equal(tool.exposure, "model-only", String(tool.name));
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
