import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSubagentPolicy, resolveDelegatedApprovalScopeForPolicy } from "./index.ts";

function readOnlyParallelSummary(taskCount: number) {
	return {
		requestMode: "parallel" as const,
		requestedTasks: Array.from({ length: taskCount }, (_, index) => ({
			agent: "scout",
			task: `Inspect area ${index + 1}`,
		})),
		requestedAgents: ["scout"],
		taskCount,
		writeCapableAgents: [],
		projectAgents: [],
		unknownAgents: [],
	};
}

test("auto mode does not add a hard 3-agent cap beyond execution limits", () => {
	const decision = evaluateSubagentPolicy(
		"auto",
		readOnlyParallelSummary(5),
		false,
		"Audit this codebase",
		false,
		"none",
		false,
	);

	assert.equal(decision.action, "allow");
});

test("auto mode requires approval for non-explicit write-capable agents", () => {
	const summary = {
		...readOnlyParallelSummary(2),
		requestedTasks: [
			{ agent: "worker", task: "Implement part A" },
			{ agent: "worker", task: "Implement part B" },
		],
		requestedAgents: ["worker"],
		writeCapableAgents: ["worker"],
	};

	assert.equal(
		evaluateSubagentPolicy("auto", summary, false, "Improve this module", true, "none", false).action,
		"ask",
	);
	assert.equal(
		evaluateSubagentPolicy("auto", summary, false, "Improve this module", false, "none", false).action,
		"block",
	);
});

test("manual, ask, and auto pass read-only nested delegation approval to allowed child calls", () => {
	assert.equal(resolveDelegatedApprovalScopeForPolicy("manual", true, "none", false), "read-only");
	assert.equal(resolveDelegatedApprovalScopeForPolicy("ask", true, "none", false), "read-only");
	assert.equal(resolveDelegatedApprovalScopeForPolicy("ask", false, "none", true), "read-only");
	assert.equal(resolveDelegatedApprovalScopeForPolicy("auto", false, "none", false), "read-only");
	assert.equal(resolveDelegatedApprovalScopeForPolicy("auto", true, "none", false), "read-only");
});

test("inherited nested delegation approval still takes precedence", () => {
	assert.equal(resolveDelegatedApprovalScopeForPolicy("auto", false, "all", false), "all");
	assert.equal(resolveDelegatedApprovalScopeForPolicy("ask", true, "all", false), "all");
	assert.equal(resolveDelegatedApprovalScopeForPolicy("manual", false, "read-only", false), "read-only");
	assert.equal(resolveDelegatedApprovalScopeForPolicy("manual", false, "none", false), "none");
});

test("manual mode allows explicit requests and blocks non-explicit top-level requests", () => {
	assert.equal(
		evaluateSubagentPolicy("manual", readOnlyParallelSummary(4), true, "Use subagents to audit this", false, "none", false)
			.action,
		"allow",
	);
	assert.equal(
		evaluateSubagentPolicy("manual", readOnlyParallelSummary(4), false, "Audit this", true, "none", false).action,
		"block",
	);
});
