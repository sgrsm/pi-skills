import assert from "node:assert/strict";
import test from "node:test";
import { resolveSessionSubagentApprovalState } from "./index.ts";
import { formatSubagentStatusLabel } from "./statusLabel.ts";

test("ask-mode footer labels distinguish ordinary and write-capable session approval", () => {
	assert.equal(
		`subagents: ${formatSubagentStatusLabel("ask", { askModeApproved: false, writeCapableApproved: false })}`,
		"subagents: ask",
	);
	assert.equal(
		`subagents: ${formatSubagentStatusLabel("ask", { askModeApproved: true, writeCapableApproved: false })}`,
		"subagents: ask (approved)",
	);
	assert.equal(
		`subagents: ${formatSubagentStatusLabel("ask", { askModeApproved: true, writeCapableApproved: true })}`,
		"subagents: ask (approved write)",
	);
});

test("resolved write-capable approval also carries ordinary ask-mode approval", () => {
	const state = resolveSessionSubagentApprovalState([
		{ type: "custom", customType: "subagent-session-approval", data: { writeCapableApproved: true } },
	]);

	assert.deepEqual(state, { askModeApproved: true, writeCapableApproved: true });
	assert.equal(formatSubagentStatusLabel("ask", state), "ask (approved write)");
});

test("auto footer label ignores persisted session approval because write permission is inherent", () => {
	assert.equal(
		`subagents: ${formatSubagentStatusLabel("auto", { askModeApproved: true, writeCapableApproved: true })}`,
		"subagents: auto",
	);
});

test("session approval state retains legacy entries and supports scoped approval cancellation", () => {
	const state = resolveSessionSubagentApprovalState([
		{ type: "custom", customType: "subagent-session-approval" },
		{ type: "custom", customType: "subagent-session-approval", data: { writeCapableApproved: true } },
	]);
	assert.deepEqual(state, { askModeApproved: true, writeCapableApproved: true });
	assert.equal(formatSubagentStatusLabel("ask", state), "ask (approved write)");

	const cancelled = resolveSessionSubagentApprovalState([
		{ type: "custom", customType: "subagent-session-approval", data: { askModeApproved: false, writeCapableApproved: false } },
	]);
	assert.deepEqual(cancelled, { askModeApproved: false, writeCapableApproved: false });
	assert.equal(formatSubagentStatusLabel("ask", cancelled), "ask");
});
