import assert from "node:assert/strict";
import test from "node:test";
import type { Usage } from "@earendil-works/pi-ai";
import {
	ChildUsageAccumulator,
	aggregateUsageStats,
	createUsageStats,
	toBillableUsage,
} from "./usageAccounting.ts";

function usage(overrides: Partial<Usage> = {}): Usage {
	const { cost: costOverrides, ...usageOverrides } = overrides;
	return {
		input: 10,
		output: 20,
		cacheRead: 30,
		cacheWrite: 40,
		totalTokens: 100,
		cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10, ...costOverrides },
		...usageOverrides,
	};
}

function toolUsage(input: number): Usage {
	return usage({
		input,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input,
		cost: { input, output: 0, cacheRead: 0, cacheWrite: 0, total: input },
	});
}

test("aggregates every canonical Pi Usage field while retaining display context and turns separately", () => {
	const accumulator = new ChildUsageAccumulator();
	accumulator.addAssistantUsage(usage({ cacheWrite1h: 7, reasoning: 8 }));
	accumulator.addAssistantUsage(usage({ input: 1, totalTokens: 5, cacheWrite1h: 2, reasoning: 3 }));

	assert.deepEqual(toBillableUsage(accumulator.usage), {
		input: 11,
		output: 40,
		cacheRead: 60,
		cacheWrite: 80,
		cacheWrite1h: 9,
		reasoning: 11,
		totalTokens: 105,
		cost: { input: 2, output: 4, cacheRead: 6, cacheWrite: 8, total: 20 },
	});
	assert.equal(accumulator.usage.contextTokens, 5, "display context remains the latest direct assistant total");
	assert.equal(accumulator.usage.turns, 2);
});

test("adds finalized nested tool-result and compaction message_end usage", () => {
	const accumulator = new ChildUsageAccumulator();
	assert.equal(accumulator.addToolResultUsage(toolUsage(3)), true);
	assert.equal(accumulator.addCompactionUsage(toolUsage(7)), true);
	assert.deepEqual(toBillableUsage(accumulator.usage), toolUsage(10));
});

test("preserves explicit optional zero fields from canonical reports", () => {
	const accumulator = new ChildUsageAccumulator();
	accumulator.addToolResultUsage({
		input: 1,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cacheWrite1h: 0,
		reasoning: 0,
		totalTokens: 1,
		cost: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, total: 1 },
	});

	assert.deepEqual(toBillableUsage(accumulator.usage), {
		...toolUsage(1),
		cacheWrite1h: 0,
		reasoning: 0,
	});
});

test("aggregates successful single, parallel, chain, and escalation result usage and omits empty usage", () => {
	const single = createUsageStats();
	const parallel = createUsageStats();
	const chain = createUsageStats();
	const escalation = createUsageStats();
	new ChildUsageAccumulator(single).addAssistantUsage(toolUsage(2));
	new ChildUsageAccumulator(parallel).addToolResultUsage(toolUsage(3));
	new ChildUsageAccumulator(chain).addCompactionUsage(toolUsage(5));
	new ChildUsageAccumulator(escalation).addAssistantUsage(toolUsage(7));

	const total = aggregateUsageStats([{ usage: single }, { usage: parallel }, { usage: chain }, { usage: escalation }]);
	assert.deepEqual(toBillableUsage(total), toolUsage(17));
	assert.equal(toBillableUsage(createUsageStats()), undefined);
});
