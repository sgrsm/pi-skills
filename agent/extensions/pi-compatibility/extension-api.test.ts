import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scopedExtensionFiles = [
	"../clarify/index.ts",
	"../web-search/index.ts",
	"../subagent/index.ts",
] as const;

test("custom tools throw from execute failures instead of returning isError: true", () => {
	for (const relativePath of scopedExtensionFiles) {
		const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
		assert.equal(
			/\breturn\s*{[\s\S]*?\bisError\s*:\s*true\b[\s\S]*?};/.test(source),
			false,
			`${relativePath} should throw Error from execute() instead of returning isError: true`,
		);
	}
});

test("escalate_to_parent prompt metadata names the tool for flat prompt composition", () => {
	const source = readFileSync(new URL("../subagent/index.ts", import.meta.url), "utf8");
	const snippetMatch = source.match(
		/name:\s*PARENT_ESCALATION_TOOL_NAME,[\s\S]*?promptSnippet:\s*"((?:[^"\\]|\\.)*)",\s*promptGuidelines:/,
	);
	assert.ok(snippetMatch, "escalate_to_parent promptSnippet should be present");
	assert.match(snippetMatch[1], /\bescalate_to_parent\b/, "promptSnippet should name escalate_to_parent");

	const guidelinesMatch = source.match(
		/name:\s*PARENT_ESCALATION_TOOL_NAME,[\s\S]*?promptGuidelines:\s*\[([\s\S]*?)\],\s*parameters:\s*ParentEscalationParams/,
	);
	assert.ok(guidelinesMatch, "escalate_to_parent promptGuidelines should be present");

	const guidelines = Array.from(guidelinesMatch[1].matchAll(/"((?:[^"\\]|\\.)*)"/g), (match) => match[1]);
	assert.ok(guidelines.length > 0, "escalate_to_parent should have promptGuidelines");
	for (const guideline of guidelines) {
		assert.match(guideline, /\bescalate_to_parent\b/, `guideline should name escalate_to_parent: ${guideline}`);
	}
});
