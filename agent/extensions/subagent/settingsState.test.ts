import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import {
	extractSubagentAgentDefaults,
	loadSubagentExecutionSettings,
	mergeSubagentAgentDefaults,
} from "./settingsState.ts";

const PI_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

function writeJson(filePath: string, value: unknown): void {
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function withIsolatedSettingsFiles<T>(fn: (paths: { agentDir: string; cwd: string }) => T): T {
	const root = mkdtempSync(path.join(tmpdir(), "pi-subagent-settings-"));
	const previousAgentDir = process.env[PI_AGENT_DIR_ENV];
	const agentDir = path.join(root, "agent");
	const cwd = path.join(root, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	process.env[PI_AGENT_DIR_ENV] = agentDir;
	try {
		return fn({ agentDir, cwd });
	} finally {
		if (previousAgentDir === undefined) delete process.env[PI_AGENT_DIR_ENV];
		else process.env[PI_AGENT_DIR_ENV] = previousAgentDir;
		rmSync(root, { recursive: true, force: true });
	}
}

test("extractSubagentAgentDefaults reads object and string forms", () => {
	const extracted = extractSubagentAgentDefaults({
		subagents: {
			agentDefaults: {
				scout: "anthropic/claude-haiku-4-5",
				planner: {
					model: "anthropic/claude-sonnet-4-5",
					thinking: "high",
				},
				invalid: 42,
			},
		},
	});

	assert.deepEqual(extracted, {
		scout: { model: "anthropic/claude-haiku-4-5" },
		planner: { model: "anthropic/claude-sonnet-4-5", thinking: "high" },
	});
});

test("mergeSubagentAgentDefaults merges per field so project settings can override only thinking", () => {
	const merged = mergeSubagentAgentDefaults(
		{
			planner: { model: "anthropic/claude-sonnet-4-5" },
			worker: { model: "anthropic/claude-sonnet-4-5", thinking: "medium" },
		},
		{
			planner: { thinking: "high" },
			worker: { thinking: "high" },
		},
	);

	assert.deepEqual(merged, {
		planner: { model: "anthropic/claude-sonnet-4-5", thinking: "high" },
		worker: { model: "anthropic/claude-sonnet-4-5", thinking: "high" },
	});
});

test("extractSubagentAgentDefaults treats null as an explicit clear", () => {
	const extracted = extractSubagentAgentDefaults({
		subagents: {
			agentDefaults: {
				reviewer: null,
			},
		},
	});

	assert.deepEqual(extracted, {
		reviewer: {},
	});
});

test("mergeSubagentAgentDefaults treats an empty override as a clear", () => {
	const merged = mergeSubagentAgentDefaults(
		{
			reviewer: { model: "anthropic/claude-sonnet-4-5", thinking: "high" },
		},
		{
			reviewer: {},
		},
	);

	assert.deepEqual(merged, {});
});

test("loadSubagentExecutionSettings ignores project settings when project trust is not enabled", () => {
	withIsolatedSettingsFiles(({ agentDir, cwd }) => {
		writeJson(path.join(agentDir, "settings.json"), {
			subagents: {
				maxParallelTasks: 10,
				maxConcurrency: 5,
				maxDelegationDepth: 4,
				inheritedApprovalScopes: { scout: "all" },
				agentDefaults: { scout: { model: "global/model", thinking: "low" } },
			},
		});
		writeJson(path.join(cwd, CONFIG_DIR_NAME, "settings.json"), {
			subagents: {
				maxParallelTasks: 2,
				maxConcurrency: 1,
				maxDelegationDepth: 0,
				inheritedApprovalScopes: { scout: "none", worker: "all" },
				agentDefaults: {
					scout: { model: "project/model", thinking: "high" },
					planner: "project/planner",
				},
			},
		});

		const settings = loadSubagentExecutionSettings(cwd, { projectTrusted: false });

		assert.deepEqual(settings.limits, {
			maxParallelTasks: 10,
			maxConcurrency: 5,
			maxDelegationDepth: 4,
		});
		assert.deepEqual(settings.sources, {
			maxParallelTasks: "global",
			maxConcurrency: "global",
			maxDelegationDepth: "global",
		});
		assert.deepEqual(settings.inheritedApprovalScopes, { scout: "all" });
		assert.deepEqual(settings.agentDefaults, { scout: { model: "global/model", thinking: "low" } });
	});
});

test("loadSubagentExecutionSettings defaults to untrusted project settings when no context is supplied", () => {
	withIsolatedSettingsFiles(({ cwd }) => {
		writeJson(path.join(cwd, CONFIG_DIR_NAME, "settings.json"), {
			subagents: {
				maxParallelTasks: 1,
				maxConcurrency: 1,
			},
		});

		const settings = loadSubagentExecutionSettings(cwd);

		assert.deepEqual(settings.limits, {
			maxParallelTasks: 8,
			maxConcurrency: 5,
			maxDelegationDepth: null,
		});
		assert.deepEqual(settings.sources, {
			maxParallelTasks: "default",
			maxConcurrency: "default",
			maxDelegationDepth: "default",
		});
	});
});

test("loadSubagentExecutionSettings applies trusted project settings over global settings", () => {
	withIsolatedSettingsFiles(({ agentDir, cwd }) => {
		writeJson(path.join(agentDir, "settings.json"), {
			subagents: {
				maxParallelTasks: 10,
				maxConcurrency: 5,
				maxDelegationDepth: 4,
				inheritedApprovalScopes: { scout: "all" },
				agentDefaults: {
					scout: { model: "global/model", thinking: "low" },
					worker: { model: "global/worker", thinking: "medium" },
				},
			},
		});
		writeJson(path.join(cwd, CONFIG_DIR_NAME, "settings.json"), {
			subagents: {
				maxParallelTasks: 7,
				maxConcurrency: 6,
				maxDelegationDepth: 1,
				inheritedApprovalScopes: { scout: "none", worker: "read-only" },
				agentDefaults: {
					scout: { model: "project/model", thinking: "high" },
					planner: "project/planner",
				},
			},
		});

		const settings = loadSubagentExecutionSettings(cwd, { projectTrusted: true });

		assert.deepEqual(settings.limits, {
			maxParallelTasks: 7,
			maxConcurrency: 6,
			maxDelegationDepth: 1,
		});
		assert.deepEqual(settings.sources, {
			maxParallelTasks: "project",
			maxConcurrency: "project",
			maxDelegationDepth: "project",
		});
		assert.deepEqual(settings.inheritedApprovalScopes, { scout: "none", worker: "read-only" });
		assert.deepEqual(settings.agentDefaults, {
			scout: { model: "project/model", thinking: "high" },
			worker: { model: "global/worker", thinking: "medium" },
			planner: { model: "project/planner" },
		});
	});
});
