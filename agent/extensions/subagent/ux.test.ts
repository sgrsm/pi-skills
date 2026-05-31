import assert from "node:assert/strict";
import test from "node:test";
import {
	formatParentEscalationSummary,
	formatSubagentActivityTree,
	getParentEscalationsFromMessage,
	resolveInteractiveParentClarifications,
	type MessageLike,
	type ParentClarifyUi,
	type ParentEscalationDetails,
	type SingleResultLike,
	type SubagentDetailsLike,
} from "./ux.ts";

function makeResult(overrides: Partial<SingleResultLike> = {}): SingleResultLike {
	return {
		agent: "reviewer",
		task: "review agent/extensions/subagent/index.ts",
		exitCode: 0,
		messages: [],
		parentEscalations: [],
		...overrides,
	};
}

test("nested subagent tool results surface escalations recursively", () => {
	const escalation: ParentEscalationDetails = {
		requestType: "clarify",
		question: "Need parent decision",
		options: [{ label: "Option A" }, { label: "Option B" }],
		allowCustom: true,
	};
	const nestedMessage: MessageLike = {
		role: "toolResult",
		toolName: "subagent",
		details: {
			mode: "single",
			agentScope: "user",
			projectAgentsDir: null,
			results: [
				makeResult({
					agent: "reviewer",
					task: "delegate nested review",
					messages: [
						{
							role: "toolResult",
							toolName: "subagent",
							details: {
								mode: "single",
								agentScope: "user",
								projectAgentsDir: null,
								results: [makeResult({ agent: "planner", task: "ask for direction", parentEscalations: [escalation] })],
							},
						},
					],
				}),
			],
		},
	};

	assert.deepEqual(getParentEscalationsFromMessage(nestedMessage), [
		{
			requestType: "clarify",
			question: "Need parent decision",
			options: [
				{ label: "Option A", description: undefined },
				{ label: "Option B", description: undefined },
			],
			allowCustom: true,
			customPrompt: undefined,
			reason: undefined,
		},
	]);
});

test("activity tree renders nested subagent hierarchy and escalation status", () => {
	const escalation: ParentEscalationDetails = {
		requestType: "clarify",
		question: "Need parent decision",
		options: [{ label: "Option A" }, { label: "Option B" }],
		allowCustom: true,
	};
	const details: SubagentDetailsLike = {
		mode: "single",
		agentScope: "user",
		projectAgentsDir: null,
		results: [
			makeResult({
				exitCode: -1,
				parentEscalations: [escalation],
				messages: [
					{
						role: "assistant",
						content: [
							{
								type: "toolCall",
								id: "nested-subagent",
								name: "subagent",
								arguments: {
									tasks: [
										{ agent: "scout", task: "gather context" },
										{ agent: "planner", task: "suggest review angles" },
									],
								},
							},
						],
					},
					{
						role: "toolResult",
						toolCallId: "nested-subagent",
						toolName: "subagent",
						details: {
							mode: "parallel",
							agentScope: "user",
							projectAgentsDir: null,
							results: [
								makeResult({ agent: "scout", task: "gather context" }),
								makeResult({
									agent: "planner",
									task: "suggest review angles",
									parentEscalations: [escalation],
									messages: [
										{
											role: "assistant",
											content: [
												{
													type: "toolCall",
													id: "escalation-call",
													name: "escalate_to_parent",
													arguments: { question: "Need parent decision" },
												},
											],
										},
										{
											role: "toolResult",
											toolCallId: "escalation-call",
											toolName: "escalate_to_parent",
											details: escalation,
										},
									],
								}),
							],
						},
					},
				],
			}),
		],
	};

	const tree = formatSubagentActivityTree(details, (_color, text) => text);
	assert.equal(
		tree,
		[
			"subagent reviewer [waiting on parent/user]",
			"└─ reviewer: review agent/extensions/subagent/index.ts [waiting on parent/user]",
			"   └─ subagent parallel (2 tasks) [waiting on parent/user]",
			"      ├─ scout: gather context [done]",
			"      └─ planner: suggest review angles [waiting on parent/user]",
			"         └─ escalate_to_parent: Need parent decision [waiting on parent/user]",
		].join("\n"),
	);
});

test("interactive clarify resolutions use top-level select UI and feed the escalation summary", async () => {
	const escalation: ParentEscalationDetails = {
		requestType: "clarify",
		question: "Which path should I take?",
		options: [
			{ label: "Path A", description: "Keep the current flow" },
			{ label: "Path B", description: "Switch to the new flow" },
		],
		allowCustom: true,
		reason: "The delegated task needs product direction.",
	};
	const results = [makeResult({ parentEscalations: [escalation] })];

	let selectTitle = "";
	let selectOptions: string[] = [];
	const ui: ParentClarifyUi = {
		async select(title, options) {
			selectTitle = title;
			selectOptions = options;
			return "2. Path B";
		},
		async editor() {
			throw new Error("editor should not be used for a direct option selection");
		},
	};

	const resolutions = await resolveInteractiveParentClarifications(ui, results);
	assert.deepEqual(selectOptions, ["1. Path A", "2. Path B", "3. Custom instructions"]);
	assert.match(selectTitle, /Subagent reviewer requested clarification\./);
	assert.match(selectTitle, /Which path should I take\?/);
	assert.match(selectTitle, /Reason: The delegated task needs product direction\./);
	assert.deepEqual(resolutions, [
		{
			occurrenceIndex: 0,
			agent: "reviewer",
			task: "review agent/extensions/subagent/index.ts",
			escalation,
			answer: "Path B",
			answerType: "option",
			selectedIndex: 2,
		},
	]);

	const summary = formatParentEscalationSummary(results, resolutions);
	assert.match(summary, /Available clarification request\(s\) were asked using the top-level interactive clarify UI\./);
	assert.match(summary, /Top-level clarification result: User selected: 2\. Path B/);
	assert.match(summary, /Use the top-level answer below, then decide whether to rerun the delegated task or handle the follow-up directly\./);
});

test("interactive clarify resolutions collect custom instructions through the top-level editor", async () => {
	const escalation: ParentEscalationDetails = {
		requestType: "clarify",
		question: "How should the delegated task proceed?",
		options: [{ label: "Use default behavior" }],
		allowCustom: true,
		customPrompt: "Add extra guidance here",
	};
	const results = [makeResult({ parentEscalations: [escalation] })];

	let editorTitle = "";
	let editorInitialValue = "";
	const ui: ParentClarifyUi = {
		async select() {
			return "2. Custom instructions";
		},
		async editor(title, initialValue) {
			editorTitle = title;
			editorInitialValue = initialValue ?? "";
			return "Prefer the structured option and keep the existing API.";
		},
	};

	const resolutions = await resolveInteractiveParentClarifications(ui, results);
	assert.match(editorTitle, /Custom instructions/);
	assert.match(editorTitle, /How should the delegated task proceed\?/);
	assert.equal(editorInitialValue, "Add extra guidance here");
	assert.equal(resolutions[0]?.answerType, "custom");
	assert.equal(resolutions[0]?.answer, "Prefer the structured option and keep the existing API.");

	const summary = formatParentEscalationSummary(results, resolutions);
	assert.match(summary, /Top-level clarification result: User provided custom instructions: Prefer the structured option and keep the existing API\./);
});
