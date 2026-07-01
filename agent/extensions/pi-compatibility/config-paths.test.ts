import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runtimeFiles = [
	"../clarify/index.ts",
	"../web-search/index.ts",
	"../handoff/index.ts",
	"../subagent/agents.ts",
	"../subagent/settingsState.ts",
	"../subagent/index.ts",
] as const;

const hardcodedConfigPathLiteral = /(["'`])(?:~\/)?\.pi(?:\/[^"'`]+)?\1/;

const legacyAgentDirEnvFiles = [
	"../clarify/index.ts",
	"../web-search/index.ts",
] as const;

test("runtime extensions avoid hardcoded .pi path literals in config-sensitive code", () => {
	for (const relativePath of runtimeFiles) {
		const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
		assert.equal(
			hardcodedConfigPathLiteral.test(source),
			false,
			`${relativePath} should use CONFIG_DIR_NAME/getAgentDir helpers instead of hardcoded .pi literals`,
		);
	}
});

test("runtime extensions avoid direct PI_CODING_AGENT_DIR fallbacks when getAgentDir is available", () => {
	for (const relativePath of legacyAgentDirEnvFiles) {
		const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
		assert.equal(
			/\bPI_CODING_AGENT_DIR\b/.test(source),
			false,
			`${relativePath} should use getAgentDir() instead of reading PI_CODING_AGENT_DIR directly`,
		);
	}
});
