import assert from "node:assert/strict";
import test from "node:test";
import {
	ProjectAgentConfirmationPolicyCoverage,
	buildApprovalPrompt,
	buildProjectAgentConfirmationDetails,
	evaluateSubagentPolicy,
	resolveDelegatedApprovalScopeForPolicy,
	shouldPolicyApprovalCoverProjectAgentConfirmation,
	shouldPromptForProjectAgentConfirmation,
} from "./index.ts";

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

function readOnlySingleSummary() {
	return {
		...readOnlyParallelSummary(1),
		requestMode: "single" as const,
		requestedTasks: [{ agent: "scout", task: "Inspect one area" }],
	};
}

function unknownParallelSummary() {
	return {
		...readOnlyParallelSummary(2),
		requestedTasks: [
			{ agent: "missing-agent", task: "Review area A" },
			{ agent: "missing-agent", task: "Review area B" },
		],
		requestedAgents: ["missing-agent"],
		unknownAgents: ["missing-agent"],
	};
}

function projectParallelSummary() {
	return {
		...readOnlyParallelSummary(2),
		requestedTasks: [
			{ agent: "repo-reviewer", task: "Review repo area A" },
			{ agent: "repo-reviewer", task: "Review repo area B" },
		],
		requestedAgents: ["repo-reviewer"],
		projectAgents: ["repo-reviewer"],
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

test("auto mode allows non-explicit read-only single-agent delegation", () => {
	const decision = evaluateSubagentPolicy(
		"auto",
		readOnlySingleSummary(),
		false,
		"Inspect auth flow",
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

test("ask session approval follows auto-equivalent guardrails", () => {
	assert.equal(
		evaluateSubagentPolicy("ask", readOnlyParallelSummary(5), false, "Audit this codebase", false, "none", true).action,
		"allow",
	);
	assert.equal(
		evaluateSubagentPolicy("ask", readOnlySingleSummary(), false, "Inspect auth", false, "none", true).action,
		"allow",
	);
});

test("non-explicit project-local agents require approval in auto-equivalent policy", () => {
	const projectSummary = projectParallelSummary();

	assert.equal(evaluateSubagentPolicy("auto", projectSummary, false, "Audit this", true, "none", false).action, "ask");
	assert.equal(evaluateSubagentPolicy("auto", projectSummary, false, "Audit this", false, "none", false).action, "block");
});

test("non-explicit project-local policy approval covers the same-call project confirmation", () => {
	const projectSummary = projectParallelSummary();
	const decision = evaluateSubagentPolicy("auto", projectSummary, false, "Audit this", true, "none", false);
	const projectAgentsRequested = [{ name: "repo-reviewer", dir: "/work/repo/.pi/agents" }];
	const details = buildProjectAgentConfirmationDetails(projectAgentsRequested);

	assert.equal(decision.action, "ask");
	assert.equal(shouldPolicyApprovalCoverProjectAgentConfirmation(projectSummary, false, decision), true);
	assert.ok(details);
	assert.equal(shouldPromptForProjectAgentConfirmation(true, projectAgentsRequested, true), false);

	const prompt = buildApprovalPrompt("auto", projectSummary, decision.reason, "Audit this", false, details);
	assert.match(prompt, /Project-local agent confirmation/);
	assert.match(prompt, /Agents: repo-reviewer/);
	assert.match(prompt, /Source: \/work\/repo\/\.pi\/agents/);
	assert.match(prompt, /repo-controlled/);
});

test("project confirmation coverage is consumed for one tool call only", () => {
	const coverage = new ProjectAgentConfirmationPolicyCoverage();

	coverage.setCovered("call-1", true);
	assert.equal(coverage.consume("call-2"), false);
	assert.equal(coverage.consume("call-1"), true);
	assert.equal(coverage.consume("call-1"), false);

	coverage.setCovered("call-1", true);
	coverage.setCovered("call-1", false);
	assert.equal(coverage.consume("call-1"), false);
});

test("explicit project-local requests still use the project confirmation path", () => {
	const projectSummary = projectParallelSummary();
	const explicitDecision = evaluateSubagentPolicy(
		"auto",
		projectSummary,
		true,
		"Use subagents with repo-reviewer",
		true,
		"none",
		false,
	);
	const projectAgentsRequested = [{ name: "repo-reviewer", dir: "/work/repo/.pi/agents" }];

	assert.equal(explicitDecision.action, "allow");
	assert.equal(
		shouldPolicyApprovalCoverProjectAgentConfirmation(projectSummary, true, {
			action: "ask",
			reason: "Nested delegation exceeds inherited read-only approval (project-local agents: repo-reviewer).",
		}),
		false,
	);
	assert.equal(shouldPromptForProjectAgentConfirmation(true, projectAgentsRequested, false), true);
});

test("ask session approval does not auto-allow future project-local calls", () => {
	const projectSummary = projectParallelSummary();
	const decision = evaluateSubagentPolicy("ask", projectSummary, false, "Audit this", true, "none", true);

	assert.equal(decision.action, "ask");
	assert.match(decision.reason, /Project-local agents require approval/);
});

test("unknown agents are blocked before non-explicit approval paths", () => {
	const summary = unknownParallelSummary();
	const decisions = [
		evaluateSubagentPolicy("ask", summary, false, "Audit this", true, "none", false),
		evaluateSubagentPolicy("ask", summary, false, "Audit this", true, "none", true),
		evaluateSubagentPolicy("auto", summary, false, "Audit this", true, "none", false),
		evaluateSubagentPolicy("auto", summary, false, "Audit this", true, "read-only", false),
	];

	for (const decision of decisions) {
		assert.equal(decision.action, "block");
		assert.match(decision.reason, /unknown requested agents cannot be used/);
	}
});

test("unknown agents are blocked before explicit or inherited allow paths", () => {
	const summary = unknownParallelSummary();
	const decisions = [
		evaluateSubagentPolicy("manual", summary, true, "Use subagents with missing-agent", true, "none", false),
		evaluateSubagentPolicy("ask", summary, true, "Use subagents with missing-agent", true, "none", false),
		evaluateSubagentPolicy("auto", summary, false, "Audit this", true, "all", false),
	];

	for (const decision of decisions) {
		assert.equal(decision.action, "block");
		assert.match(decision.reason, /unknown requested agents cannot be used/);
	}
});

test("off mode keeps its existing block reason for unknown agents", () => {
	const decision = evaluateSubagentPolicy(
		"off",
		unknownParallelSummary(),
		true,
		"Use subagents with missing-agent",
		true,
		"all",
		true,
	);

	assert.equal(decision.action, "block");
	assert.match(decision.reason, /off mode disables subagents completely/);
});
