import assert from "node:assert/strict";
import test from "node:test";
import { extractSubagentAgentDefaults, mergeSubagentAgentDefaults } from "./settingsState.ts";

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
