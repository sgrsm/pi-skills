import assert from "node:assert/strict";
import test from "node:test";
import { formatProgramStatus, visibleWidth } from "@earendil-works/pi-tui";
import {
	askParentClarification,
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
									mode: "parallel",
									items: [
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
				agent: "reviewer",
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
				{ prefix: "└─ ", agent: "reviewer", task: "Review core/src/main/java/com/example/Beta.java for wildcard imports", status: "running" },
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
		mode: "chain",
		items: [
			{
				agent: "worker",
				task: "Implement the requested test refactor for module5_7. Scope: do not change production code. Refactor tests only.",
			},
			{
				agent: "reviewer",
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
			makeResult({ agent: "reviewer", task: reviewerTask, exitCode: -1 }),
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
		mode: "chain",
		items: [
			{ agent: "worker", task: "Implement finding-5 refactor in monthly-balancing" },
			{ agent: "scout", task: "Verify generated config/tests" },
			{ agent: "reviewer", task: "Review final diff and risks" },
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
				{ prefix: "└─ ", agent: "reviewer", task: "Review final diff and risks", status: "waiting" },
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
		notify: failOnNotify,
	};

	const resolutions = await resolveInteractiveParentClarifications(ui, results, "rpc");
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
		notify: failOnNotify,
	};

	const resolutions = await resolveInteractiveParentClarifications(ui, results, "rpc");
	assert.match(editorTitle, /Custom instructions/);
	assert.match(editorTitle, /How should the delegated task proceed\?/);
	assert.equal(editorInitialValue, "Add extra guidance here");
	assert.equal(resolutions[0]?.answerType, "custom");
	assert.equal(resolutions[0]?.answer, "Prefer the structured option and keep the existing API.");

	const summary = formatParentEscalationSummary(results, resolutions);
	assert.match(summary, /Top-level clarification result: User provided custom instructions: Prefer the structured option and keep the existing API\./);
});

const failOnNotify: ParentClarifyUi["notify"] = (message, type) => {
	throw new Error(`unexpected notify (${type ?? "default"}): ${message}`);
};

const TUI_SELECT_TITLE = "Subagent clarification\nSee request details above.";
const TUI_CUSTOM_TITLE = "Subagent custom instructions\nSee request details above.";
const SENTINELS = {
	agent: "agent-sentinel-7f3",
	question: "QUESTION-SENTINEL-91a",
	reason: "REASON-SENTINEL-4bc",
	task: "TASK-SENTINEL-d02",
	descA: "DESC-A-SENTINEL-5e8",
	descB: "DESC-B-SENTINEL-c17",
};

function makeSentinelEscalation(overrides: Partial<ParentEscalationDetails> = {}): ParentEscalationDetails {
	return {
		requestType: "clarify",
		question: SENTINELS.question,
		reason: SENTINELS.reason,
		options: [
			{ label: "Path A", description: SENTINELS.descA },
			{ label: "Path B", description: SENTINELS.descB },
		],
		allowCustom: true,
		...overrides,
	};
}

function makeSentinelResult(escalation: ParentEscalationDetails): SingleResultLike {
	return makeResult({ agent: SENTINELS.agent, task: SENTINELS.task, parentEscalations: [escalation] });
}

interface FakeUiCalls {
	events: string[];
	notifications: Array<{ message: string; type?: string }>;
	selects: Array<{ title: string; options: string[] }>;
	editors: Array<{ title: string; initialValue?: string }>;
}

function makeFakeUi(
	selectReply: (options: string[]) => string | undefined,
	editorReply: () => string | undefined = () => {
		throw new Error("editor should not be used");
	},
): { ui: ParentClarifyUi; calls: FakeUiCalls } {
	const calls: FakeUiCalls = { events: [], notifications: [], selects: [], editors: [] };
	const ui: ParentClarifyUi = {
		notify(message, type) {
			calls.events.push("notify");
			calls.notifications.push({ message, type });
		},
		async select(title, options) {
			calls.events.push("select");
			calls.selects.push({ title, options });
			return selectReply(options);
		},
		async editor(title, initialValue) {
			calls.events.push("editor");
			calls.editors.push({ title, initialValue });
			return editorReply();
		},
	};
	return { ui, calls };
}

function assertDetailsSentinels(details: string): void {
	for (const sentinel of [SENTINELS.agent, SENTINELS.question, SENTINELS.reason, SENTINELS.task, SENTINELS.descA, SENTINELS.descB]) {
		assert.ok(details.includes(sentinel), `details should include ${sentinel}`);
	}
	assert.match(details, /1\. Path A/);
	assert.match(details, /2\. Path B/);
	assert.match(details, /3\. Custom instructions/);
}

function assertNoSentinels(text: string | undefined): void {
	for (const sentinel of Object.values(SENTINELS)) {
		assert.ok(!(text ?? "").includes(sentinel), `unexpected ${sentinel} in ${text}`);
	}
}

test("TUI direct selection notifies details once as a warning before a static select title", async () => {
	const escalation = makeSentinelEscalation();
	const { ui, calls } = makeFakeUi(() => "2. Path B");

	const resolutions = await resolveInteractiveParentClarifications(ui, [makeSentinelResult(escalation)], "tui");

	assert.deepEqual(calls.events, ["notify", "select"]);
	assert.equal(calls.notifications.length, 1);
	assert.equal(calls.notifications[0].type, "warning");
	assertDetailsSentinels(calls.notifications[0].message);
	assert.equal(calls.selects[0].title, TUI_SELECT_TITLE);
	assert.deepEqual(calls.selects[0].options, ["1. Path A", "2. Path B", "3. Custom instructions"]);
	assert.deepEqual(resolutions, [
		{
			occurrenceIndex: 0,
			agent: SENTINELS.agent,
			task: SENTINELS.task,
			escalation,
			answer: "Path B",
			answerType: "option",
			selectedIndex: 2,
		},
	]);
	assertNoSentinels(resolutions[0].answer ?? undefined);
});

test("TUI direct custom editor notifies details once before a static editor title", async () => {
	const escalation = makeSentinelEscalation({ options: [], customPrompt: "prefill text" });
	const { ui, calls } = makeFakeUi(
		() => {
			throw new Error("select should not be used");
		},
		() => "  my custom answer  ",
	);

	const resolution = await askParentClarification(ui, { occurrenceIndex: 3, result: makeSentinelResult(escalation), escalation }, "tui");

	assert.deepEqual(calls.events, ["notify", "editor"]);
	assert.equal(calls.notifications[0].type, "warning");
	for (const sentinel of [SENTINELS.agent, SENTINELS.question, SENTINELS.reason, SENTINELS.task]) {
		assert.ok(calls.notifications[0].message.includes(sentinel));
	}
	assert.match(calls.notifications[0].message, /1\. Custom instructions/);
	assert.equal(calls.editors[0].title, TUI_SELECT_TITLE);
	assert.equal(calls.editors[0].initialValue, "prefill text");
	assert.equal(resolution?.answerType, "custom");
	assert.equal(resolution?.answer, "my custom answer");
	assert.equal(resolution?.occurrenceIndex, 3);
});

test("TUI custom option notifies once, before select, then opens static custom editor", async () => {
	const escalation = makeSentinelEscalation({ customPrompt: "prefill" });
	const { ui, calls } = makeFakeUi(
		() => "3. Custom instructions",
		() => "\n  go custom \n",
	);

	const resolutions = await resolveInteractiveParentClarifications(ui, [makeSentinelResult(escalation)], "tui");

	assert.deepEqual(calls.events, ["notify", "select", "editor"]);
	assert.equal(calls.notifications.length, 1);
	assert.equal(calls.notifications[0].type, "warning");
	assertDetailsSentinels(calls.notifications[0].message);
	assert.equal(calls.selects[0].title, TUI_SELECT_TITLE);
	assert.equal(calls.editors[0].title, TUI_CUSTOM_TITLE);
	assert.equal(calls.editors[0].initialValue, "prefill");
	assert.equal(resolutions[0].answerType, "custom");
	assert.equal(resolutions[0].answer, "go custom");
	assertNoSentinels(resolutions[0].answer ?? undefined);
});

test("TUI titles never interpolate agent names or request content", async () => {
	const escalation = makeSentinelEscalation();
	const { ui, calls } = makeFakeUi(() => "3. Custom instructions", () => "x");

	await resolveInteractiveParentClarifications(ui, [makeSentinelResult(escalation)], "tui");

	for (const title of [calls.selects[0].title, calls.editors[0].title]) {
		const frame = formatProgramStatus({ state: "blocked", kind: "question", message: title });
		const encoded = /:msg=([^\x1b]+)/.exec(frame)?.[1];
		assert.ok(encoded);
		const message = Buffer.from(encoded, "base64").toString("utf8");
		assertNoSentinels(message);
		assert.equal(message, title.replace(/\n/g, " "));
	}
	assert.ok(!calls.selects[0].title.includes("Path A"));
	assert.ok(!calls.editors[0].title.includes("Path A"));
});

test("TUI notification is emitted per actionable occurrence", async () => {
	const escalation = makeSentinelEscalation();
	const { ui, calls } = makeFakeUi(() => "1. Path A");

	const resolutions = await resolveInteractiveParentClarifications(
		ui,
		[makeSentinelResult(escalation), makeSentinelResult(escalation)],
		"tui",
	);

	assert.deepEqual(calls.events, ["notify", "select", "notify", "select"]);
	assert.deepEqual(resolutions.map((resolution) => resolution.occurrenceIndex), [0, 1]);
});

test("TUI selector cancellation still shows details once and resolves as cancelled", async () => {
	const escalation = makeSentinelEscalation();
	const { ui, calls } = makeFakeUi(() => undefined);

	const resolutions = await resolveInteractiveParentClarifications(ui, [makeSentinelResult(escalation)], "tui");

	assert.deepEqual(calls.events, ["notify", "select"]);
	assert.equal(calls.notifications.length, 1);
	assert.equal(resolutions[0].answerType, "cancelled");
	assert.equal(resolutions[0].answer, null);
	assert.equal(resolutions[0].selectedIndex, undefined);
});

test("TUI editor cancellation and blank answers resolve as cancelled", async () => {
	for (const reply of [undefined, "   \n "]) {
		const direct = makeSentinelEscalation({ options: [] });
		const directUi = makeFakeUi(() => undefined, () => reply);
		const directResolution = await askParentClarification(
			directUi.ui,
			{ occurrenceIndex: 0, result: makeSentinelResult(direct), escalation: direct },
			"tui",
		);
		assert.deepEqual(directUi.calls.events, ["notify", "editor"]);
		assert.equal(directResolution?.answerType, "cancelled");
		assert.equal(directResolution?.answer, null);

		const withOptions = makeSentinelEscalation();
		const customUi = makeFakeUi(() => "3. Custom instructions", () => reply);
		const customResolution = await askParentClarification(
			customUi.ui,
			{ occurrenceIndex: 0, result: makeSentinelResult(withOptions), escalation: withOptions },
			"tui",
		);
		assert.deepEqual(customUi.calls.events, ["notify", "select", "editor"]);
		assert.equal(customResolution?.answerType, "cancelled");
		assert.equal(customResolution?.answer, null);
	}
});

test("TUI mode asks nothing and notifies nothing without UI, for approval, or for non-actionable clarifications", async () => {
	const { ui, calls } = makeFakeUi(() => {
		throw new Error("select should not be used");
	});
	const approval = makeSentinelEscalation({ requestType: "approval" });
	const empty = makeSentinelEscalation({ options: [], allowCustom: false });

	assert.deepEqual(await resolveInteractiveParentClarifications(null, [makeSentinelResult(makeSentinelEscalation())], "tui"), []);
	assert.deepEqual(await resolveInteractiveParentClarifications(undefined, [makeSentinelResult(makeSentinelEscalation())], "tui"), []);
	assert.deepEqual(await resolveInteractiveParentClarifications(ui, [makeSentinelResult(approval), makeSentinelResult(empty)], "tui"), []);
	assert.equal(await askParentClarification(null, { occurrenceIndex: 0, result: makeSentinelResult(approval), escalation: approval }, "tui"), null);
	assert.equal(await askParentClarification(ui, { occurrenceIndex: 0, result: makeSentinelResult(approval), escalation: approval }, "tui"), null);
	assert.equal(await askParentClarification(ui, { occurrenceIndex: 0, result: makeSentinelResult(empty), escalation: empty }, "tui"), null);
	assert.deepEqual(calls.events, []);
});

test("non-TUI mode keeps rich titles and never notifies", async () => {
	const escalation = makeSentinelEscalation({ customPrompt: "prefill" });
	const calls: { select: string[]; editor: string[] } = { select: [], editor: [] };
	const ui: ParentClarifyUi = {
		notify: failOnNotify,
		async select(title) {
			calls.select.push(title);
			return "3. Custom instructions";
		},
		async editor(title, initialValue) {
			calls.editor.push(title);
			assert.equal(initialValue, "prefill");
			return "rpc answer";
		},
	};

	for (const mode of ["rpc", "json", "print"]) {
		calls.select.length = 0;
		calls.editor.length = 0;
		const resolutions = await resolveInteractiveParentClarifications(ui, [makeSentinelResult(escalation)], mode);
		assert.equal(resolutions[0].answer, "rpc answer");
		assertDetailsSentinels(calls.select[0]);
		assert.match(calls.select[0], new RegExp(`Subagent ${SENTINELS.agent} requested clarification\\.`));
		assert.ok(calls.editor[0].startsWith("Custom instructions\n\n"));
		assertDetailsSentinels(calls.editor[0]);
	}
});

test("non-TUI direct editor keeps the rich title and never notifies", async () => {
	const escalation = makeSentinelEscalation({ options: [] });
	const titles: string[] = [];
	const ui: ParentClarifyUi = {
		notify: failOnNotify,
		async select() {
			throw new Error("select should not be used");
		},
		async editor(title) {
			titles.push(title);
			return "answer";
		},
	};

	const resolutions = await resolveInteractiveParentClarifications(ui, [makeSentinelResult(escalation)], "rpc");

	assert.equal(resolutions[0].answerType, "custom");
	assert.ok(titles[0].includes(SENTINELS.question));
	assert.ok(titles[0].includes(SENTINELS.task));
});
