import assert from "node:assert/strict";
import test from "node:test";
import {
	SubagentFooterActivityTracker,
	countInitialSubagentTasks,
	formatSubagentRuntimeActivityStatus,
	getNestedSubagentFooterActivity,
} from "./footerActivity.ts";

test("footer runtime activity status hides idle activity", () => {
	assert.equal(formatSubagentRuntimeActivityStatus({ runningByDepth: [], queuedByDepth: [] }), null);
	assert.equal(formatSubagentRuntimeActivityStatus({ runningByDepth: [0, 0], queuedByDepth: [0] }), null);
});

test("footer runtime activity status formats direct running only", () => {
	assert.equal(formatSubagentRuntimeActivityStatus({ runningByDepth: [4], queuedByDepth: [] }), "r:4");
});

test("footer activity tracker queues exclude currently running tasks", () => {
	const tracker = new SubagentFooterActivityTracker();

	assert.deepEqual(tracker.snapshot(), { runningByDepth: [], queuedByDepth: [] });
	assert.equal(tracker.markToolCallActive("call-a", 9), true);
	assert.equal(tracker.startTask("call-a"), true);
	assert.equal(tracker.startTask("call-a"), true);
	assert.equal(tracker.startTask("call-a"), true);
	assert.equal(tracker.startTask("call-a"), true);

	assert.deepEqual(tracker.snapshot(), { runningByDepth: [4], queuedByDepth: [5] });
	assert.equal(formatSubagentRuntimeActivityStatus(tracker.snapshot()), "r:4|q:5");
});

test("footer activity tracker aggregates simultaneous subagent tool calls by depth", () => {
	const tracker = new SubagentFooterActivityTracker();
	tracker.markToolCallActive("call-a", 3);
	tracker.markToolCallActive("call-b", 4);
	tracker.startTask("call-a");
	tracker.startTask("call-b");
	tracker.startTask("call-b");
	tracker.setNestedActivity("call-a", { runningByDepth: [0, 0, 2], queuedByDepth: [0, 4] });
	tracker.setNestedActivity("call-b", { runningByDepth: [0, 3], queuedByDepth: [0, 0, 5] });

	assert.equal(formatSubagentRuntimeActivityStatus(tracker.snapshot()), "r:3→3→2|q:4→4→5");
});

test("footer runtime activity status preserves interior zeros and trims trailing zeros", () => {
	assert.equal(
		formatSubagentRuntimeActivityStatus({ runningByDepth: [2, 0, 4, 0], queuedByDepth: [0, 4, 5, 0] }),
		"r:2→0→4|q:0→4→5",
	);
});

test("nested subagent footer activity uses child-reported running and queued activity", () => {
	const nestedParallelDetails = {
		mode: "parallel",
		agentScope: "user",
		projectAgentsDir: null,
		results: Array.from({ length: 7 }, (_, index) => ({
			agent: `worker-${index}`,
			task: "go",
			exitCode: -1,
			messages: [],
		})),
		footerActivity: { runningByDepth: [3], queuedByDepth: [4] },
	};
	const topDetails = {
		mode: "parallel",
		agentScope: "user",
		projectAgentsDir: null,
		results: [
			{
				agent: "parent-a",
				task: "parent-a",
				exitCode: -1,
				messages: [
					{
						role: "assistant",
						content: [
							{
								type: "toolCall",
								id: "nested-a",
								name: "subagent",
								arguments: {
									tasks: Array.from({ length: 7 }, (_, index) => ({ agent: `worker-${index}`, task: "go" })),
								},
							},
						],
					},
					{
						role: "toolResult",
						toolCallId: "nested-a",
						toolName: "subagent",
						details: nestedParallelDetails,
					},
				],
			},
		],
	};

	assert.deepEqual(getNestedSubagentFooterActivity(topDetails), { runningByDepth: [0, 3], queuedByDepth: [0, 4] });
});

test("nested subagent footer activity can produce requested nested example", () => {
	const tracker = new SubagentFooterActivityTracker();
	tracker.markToolCallActive("call-a", 4);
	tracker.startTask("call-a");
	tracker.startTask("call-a");
	tracker.setNestedActivity("call-a", { runningByDepth: [0, 3], queuedByDepth: [0, 4] });

	assert.equal(formatSubagentRuntimeActivityStatus(tracker.snapshot()), "r:2→3|q:2→4");
});

test("countInitialSubagentTasks counts requested work by mode", () => {
	assert.equal(countInitialSubagentTasks({ agent: "worker", task: "do one thing" }), 1);
	assert.equal(
		countInitialSubagentTasks({
			tasks: [
				{ agent: "scout", task: "inspect" },
				{ agent: "planner", task: "plan" },
			],
		}),
		2,
	);
	assert.equal(
		countInitialSubagentTasks({
			chain: [
				{ agent: "scout", task: "inspect" },
				{ agent: "planner", task: "plan from {previous}" },
			],
		}),
		2,
	);
	assert.equal(
		countInitialSubagentTasks({ chain: [], tasks: [{ agent: "worker", task: "fallback" }] }),
		1,
	);
	assert.equal(countInitialSubagentTasks({ agent: "", task: "missing agent" }), 0);
	assert.equal(countInitialSubagentTasks({}), 0);
});

test("subagent footer source no longer contains the old depth indicator", async () => {
	const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./index.ts", import.meta.url), "utf8"));
	assert.doesNotMatch(source, /d:\$\{/);
	assert.doesNotMatch(source, /formatSubagentConcurrencyTaskStatus/);
});
