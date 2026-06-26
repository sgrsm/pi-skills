import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	formatParentEscalationSummary,
	formatSubagentActivityTree,
	getMaxSubagentRelativeDepth,
	getParentEscalationsFromMessage,
	resolveInteractiveParentClarifications,
	type MessageLike,
	type ParentClarifyUi,
	type ParentEscalationDetails,
	type SingleResultLike,
	type SubagentDetailsLike,
} from "./ux.ts";

const TASK_PREVIEW_WIDTH = 100;
const COMPACT_LABEL_TASK_GAP = 2;
const COMPACT_TASK_STATUS_GAP = 3;
const COMPACT_STATUS_COLUMN = 96;

function taskPreview(text: string, width = TASK_PREVIEW_WIDTH): string {
	if (width <= 0) return "";
	const normalized = text.replace(/\s+/g, " ").trim();
	const preview = normalized.length <= width ? normalized : width === 1 ? "…" : `${normalized.slice(0, width - 1)}…`;
	return preview.padEnd(width);
}

interface CompactRowExpectation {
	prefix: string;
	agent: string;
	task: string;
	status: string;
}

function compactRows(rows: CompactRowExpectation[]): string[] {
	const maxLabelWidth = Math.max(0, ...rows.map((row) => visibleWidth(`${row.prefix}${row.agent}`)));
	const statusColumn = Math.max(COMPACT_STATUS_COLUMN, maxLabelWidth + COMPACT_LABEL_TASK_GAP + COMPACT_TASK_STATUS_GAP);
	return rows.map((row) => {
		const label = `${row.prefix}${row.agent}`;
		const taskWidth = Math.max(0, statusColumn - visibleWidth(label) - COMPACT_LABEL_TASK_GAP - COMPACT_TASK_STATUS_GAP);
		return `${label}${" ".repeat(COMPACT_LABEL_TASK_GAP)}${taskPreview(row.task, taskWidth)}${" ".repeat(COMPACT_TASK_STATUS_GAP)}${row.status}`;
	});
}

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
			"   └─ subagents · parallel · 1 done, 1 waiting on parent/user · scope: user",
			...compactRows([
				{ prefix: "      ├─ ", agent: "scout", task: "gather context", status: "done" },
				{ prefix: "      └─ ", agent: "planner", task: "suggest review angles", status: "waiting on parent/user" },
				{ prefix: "         └─ ", agent: "escalate_to_parent", task: "Need parent decision", status: "waiting on parent/user" },
			]),
		].join("\n"),
	);
});

test("parallel activity tree uses compact running view with stable task descriptions", () => {
	const details: SubagentDetailsLike = {
		mode: "parallel",
		agentScope: "user",
		projectAgentsDir: null,
		results: [
			makeResult({
				agent: "scout",
				task: "Inspect core/src/main/java/com/fiftyhz/sxp/smb/modules/module5_4_1 for Kafka producer config",
				exitCode: -1,
			}),
			makeResult({
				agent: "scout",
				task: "Inspect core/src/main/java/com/fiftyhz/sxp/smb/modules/module5_7 for Kafka producer config",
				exitCode: -1,
			}),
		],
	};

	const tree = formatSubagentActivityTree(details, (_color, text) => text);
	assert.equal(
		tree,
		[
			"subagents · parallel · 2 running · scope: user",
			...compactRows([
				{
					prefix: "├─ ",
					agent: "scout",
					task: "Inspect core/src/main/java/com/fiftyhz/sxp/smb/modules/module5_4_1 for Kafka producer config",
					status: "running",
				},
				{
					prefix: "└─ ",
					agent: "scout",
					task: "Inspect core/src/main/java/com/fiftyhz/sxp/smb/modules/module5_7 for Kafka producer config",
					status: "running",
				},
			]),
		].join("\n"),
	);
});

test("single activity tree uses compact running view", () => {
	const details: SubagentDetailsLike = {
		mode: "single",
		agentScope: "user",
		projectAgentsDir: null,
		results: [
			makeResult({
				agent: "worker",
				task: "Implement the agreed refactoring for Kafka producer wiring",
				exitCode: -1,
			}),
		],
	};

	const tree = formatSubagentActivityTree(details, (_color, text) => text);
	assert.equal(
		tree,
		[
			"subagents · 1 running · scope: user",
			...compactRows([
				{ prefix: "└─ ", agent: "worker", task: "Implement the agreed refactoring for Kafka producer wiring", status: "running" },
			]),
		].join("\n"),
	);
});

test("running activity rows use stable task descriptions instead of child output", () => {
	const details: SubagentDetailsLike = {
		mode: "parallel",
		agentScope: "user",
		projectAgentsDir: null,
		results: [
			makeResult({
				agent: "scout",
				task: "Inspect core/src/main/java/com/example/Alpha.java for import issues",
				exitCode: -1,
				messages: [{ role: "assistant", content: [{ type: "text", text: "read core/src/main/java/com/example/Alpha.java\nlines 1-120" }] }],
			}),
			makeResult({
				agent: "reviewer-readonly",
				task: "Review core/src/main/java/com/example/Beta.java for wildcard imports",
				exitCode: -1,
			}),
		],
	};

	const tree = formatSubagentActivityTree(details, (_color, text) => text);
	assert.equal(
		tree,
		[
			"subagents · parallel · 2 running · scope: user",
			...compactRows([
				{ prefix: "├─ ", agent: "scout", task: "Inspect core/src/main/java/com/example/Alpha.java for import issues", status: "running" },
				{ prefix: "└─ ", agent: "reviewer-readonly", task: "Review core/src/main/java/com/example/Beta.java for wildcard imports", status: "running" },
			]),
		].join("\n"),
	);
});

test("compact activity tree uses provided width to keep statuses on the same line", () => {
	const width = 100;
	const details: SubagentDetailsLike = {
		mode: "chain",
		agentScope: "user",
		projectAgentsDir: null,
		results: [
			makeResult({
				agent: "worker",
				task: "Implement the requested test refactor for module5_7. Scope: do not change production code. Refactor tests only.",
				exitCode: -1,
			}),
		],
	};

	const tree = formatSubagentActivityTree(details, (_color, text) => text, {
		chain: [
			{
				agent: "worker",
				task: "Implement the requested test refactor for module5_7. Scope: do not change production code. Refactor tests only.",
			},
			{
				agent: "reviewer-readonly",
				task: "Review the implementation diff from the previous step for correctness. Focus on checked-in module5_7 tests.",
			},
		],
	}, width);
	const lines = tree.split("\n");
	const statusColumns = lines.slice(1).map((line) => Math.max(line.indexOf("running"), line.indexOf("waiting")));

	assert.ok(lines.every((line) => visibleWidth(line) <= width));
	assert.ok(statusColumns.every((column) => column === statusColumns[0]));
	assert.match(lines[1], /^├─ worker  Implement the requested test refactor/);
	assert.match(lines[1], /…\s+running$/);
	assert.match(lines[2], /…\s+waiting$/);
});

test("compact activity tree keeps status column aligned without padding before task text", () => {
	const scoutTask = "Inspect alpha config";
	const reviewerTask = "Review beta config";
	const baseDetails: SubagentDetailsLike = {
		mode: "parallel",
		agentScope: "user",
		projectAgentsDir: null,
		results: [
			makeResult({ agent: "scout", task: scoutTask, exitCode: -1 }),
			makeResult({ agent: "scout", task: "Inspect gamma config", exitCode: -1 }),
		],
	};
	const expandedDetails: SubagentDetailsLike = {
		...baseDetails,
		results: [
			makeResult({ agent: "scout", task: scoutTask, exitCode: -1 }),
			makeResult({ agent: "reviewer-readonly", task: reviewerTask, exitCode: -1 }),
			makeResult({ agent: "scout", task: "Inspect gamma config", exitCode: -1 }),
		],
	};

	const baseLines = formatSubagentActivityTree(baseDetails, (_color, text) => text).split("\n");
	const expandedLines = formatSubagentActivityTree(expandedDetails, (_color, text) => text).split("\n");
	const baseStatusColumn = baseLines[1].indexOf("running");
	const expandedStatusColumns = expandedLines.slice(1).map((line) => line.indexOf("running"));

	assert.ok(expandedStatusColumns.every((column) => column === expandedStatusColumns[0]));
	assert.equal(expandedStatusColumns[0], baseStatusColumn);
	assert.match(expandedLines[1], /^├─ scout  Inspect alpha config/);
});

test("running activity rows truncate long task descriptions to a fixed width", () => {
	const longTask = "x".repeat(100);
	const details: SubagentDetailsLike = {
		mode: "single",
		agentScope: "user",
		projectAgentsDir: null,
		results: [
			makeResult({
				agent: "worker",
				task: longTask,
				exitCode: -1,
				messages: [{ role: "assistant", content: [{ type: "text", text: "child output should not replace task" }] }],
			}),
		],
	};

	const tree = formatSubagentActivityTree(details, (_color, text) => text);
	assert.equal(
		tree,
		[
			"subagents · 1 running · scope: user",
			...compactRows([{ prefix: "└─ ", agent: "worker", task: longTask, status: "running" }]),
		].join("\n"),
	);
});

test("nested running parallel subagent keeps group in compact view", () => {
	const details: SubagentDetailsLike = {
		mode: "single",
		agentScope: "user",
		projectAgentsDir: null,
		results: [
			makeResult({
				agent: "worker",
				task: "Align bean method names for semantics",
				exitCode: -1,
				messages: [
					{
						role: "assistant",
						content: [
							{
								type: "toolCall",
								id: "nested-scouts",
								name: "subagent",
								arguments: {
									tasks: [
										{
											agent: "scout",
											task: "Inspect core/src/main/java/com/fiftyhz/sxp/smb/modules/module5_7 for Kafka producer config",
										},
										{ agent: "scout", task: "Doing other stuff" },
									],
									agentScope: "user",
								},
							},
						],
					},
				],
			}),
		],
	};

	const tree = formatSubagentActivityTree(details, (_color, text) => text);
	const expectedRows = compactRows([
		{ prefix: "└─ ", agent: "worker", task: "Align bean method names for semantics", status: "running" },
		{
			prefix: "      ├─ ",
			agent: "scout",
			task: "Inspect core/src/main/java/com/fiftyhz/sxp/smb/modules/module5_7 for Kafka producer config",
			status: "running",
		},
		{ prefix: "      └─ ", agent: "scout", task: "Doing other stuff", status: "running" },
	]);
	assert.equal(
		tree,
		[
			"subagents · 1 running · scope: user",
			expectedRows[0],
			"   └─ subagents · parallel · 2 running · scope: user",
			expectedRows[1],
			expectedRows[2],
		].join("\n"),
	);
});

test("completed nested subagent flattens child rows in compact view", () => {
	const details: SubagentDetailsLike = {
		mode: "single",
		agentScope: "user",
		projectAgentsDir: null,
		results: [
			makeResult({
				agent: "worker",
				task: "Review producers",
				exitCode: -1,
				messages: [
					{
						role: "assistant",
						content: [
							{
								type: "toolCall",
								id: "nested-scout",
								name: "subagent",
								arguments: { agent: "scout", task: "Inspect config tests", agentScope: "user" },
							},
						],
					},
					{
						role: "toolResult",
						toolCallId: "nested-scout",
						toolName: "subagent",
						details: {
							mode: "single",
							agentScope: "user",
							projectAgentsDir: null,
							results: [makeResult({ agent: "scout", task: "Inspect config tests" })],
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
			"subagents · 1 running · scope: user",
			...compactRows([
				{ prefix: "└─ ", agent: "worker", task: "Review producers", status: "running" },
				{ prefix: "   └─ ", agent: "scout", task: "Inspect config tests", status: "done" },
			]),
		].join("\n"),
	);
});

test("running chain uses compact view and flattens nested subagent rows", () => {
	const details: SubagentDetailsLike = {
		mode: "chain",
		agentScope: "user",
		projectAgentsDir: null,
		results: [
			makeResult({
				agent: "worker",
				step: 1,
				task: "Implement finding-5 refactor in monthly-balancing",
				exitCode: -1,
				messages: [
					{
						role: "assistant",
						content: [
							{
								type: "toolCall",
								id: "nested-scout",
								name: "subagent",
								arguments: { agent: "scout", task: "Inspect monthly-balancing module5_7 persistence" },
							},
						],
					},
					{
						role: "toolResult",
						toolCallId: "nested-scout",
						toolName: "subagent",
						details: {
							mode: "single",
							agentScope: "user",
							projectAgentsDir: null,
							results: [makeResult({ agent: "scout", task: "Inspect monthly-balancing module5_7 persistence" })],
						},
					},
				],
			}),
		],
	};

	const tree = formatSubagentActivityTree(details, (_color, text) => text, {
		chain: [
			{ agent: "worker", task: "Implement finding-5 refactor in monthly-balancing" },
			{ agent: "scout", task: "Verify generated config/tests" },
			{ agent: "reviewer-readonly", task: "Review final diff and risks" },
		],
	});
	assert.equal(
		tree,
		[
			"subagents · chain · 1 running, 2 waiting · scope: user",
			...compactRows([
				{ prefix: "├─ ", agent: "worker", task: "Implement finding-5 refactor in monthly-balancing", status: "running" },
				{ prefix: "│  └─ ", agent: "scout", task: "Inspect monthly-balancing module5_7 persistence", status: "done" },
				{ prefix: "├─ ", agent: "scout", task: "Verify generated config/tests", status: "waiting" },
				{ prefix: "└─ ", agent: "reviewer-readonly", task: "Review final diff and risks", status: "waiting" },
			]),
		].join("\n"),
	);
});

test("max subagent relative depth counts pending nested subagent calls", () => {
	const details: SubagentDetailsLike = {
		mode: "single",
		agentScope: "user",
		projectAgentsDir: null,
		results: [
			makeResult({
				exitCode: -1,
				messages: [
					{
						role: "assistant",
						content: [
							{
								type: "toolCall",
								id: "nested-subagent",
								name: "subagent",
								arguments: { agent: "planner", task: "drill deeper" },
							},
						],
					},
				],
			}),
		],
	};

	assert.equal(getMaxSubagentRelativeDepth(details), 2);
});

test("max subagent relative depth follows the deepest completed nested branch", () => {
	const details: SubagentDetailsLike = {
		mode: "single",
		agentScope: "user",
		projectAgentsDir: null,
		results: [
			makeResult({
				messages: [
					{
						role: "assistant",
						content: [
							{
								type: "toolCall",
								id: "nested-subagent",
								name: "subagent",
								arguments: { agent: "planner", task: "delegate again" },
							},
						],
					},
					{
						role: "toolResult",
						toolCallId: "nested-subagent",
						toolName: "subagent",
						details: {
							mode: "single",
							agentScope: "user",
							projectAgentsDir: null,
							results: [
								makeResult({
									agent: "planner",
									task: "delegate again",
									messages: [
										{
											role: "assistant",
											content: [
												{
													type: "toolCall",
													id: "deepest-subagent",
													name: "subagent",
													arguments: { agent: "scout", task: "one more level" },
												},
											],
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

	assert.equal(getMaxSubagentRelativeDepth(details), 3);
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
