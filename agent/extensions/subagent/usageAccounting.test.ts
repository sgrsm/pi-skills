import assert from "node:assert/strict";
import test from "node:test";
import type { Usage } from "@earendil-works/pi-ai";
import {
	ChildUsageAccumulator,
	FailedUsageRecoveryStore,
	UsageRecoveryScope,
	aggregateUsageStats,
	createUsageStats,
	mergeBillableUsage,
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

test("aggregates every canonical Pi Usage field while retaining display context separately", () => {
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

test("final nested tool messages replace terminal fallback usage and can remove it", () => {
	const accumulator = new ChildUsageAccumulator();
	accumulator.addTerminalToolResultUsage("replace", toolUsage(3));
	assert.equal(accumulator.addToolResultUsage("replace", toolUsage(7)), true);
	accumulator.addTerminalToolResultUsage("remove", toolUsage(11));
	assert.equal(accumulator.addToolResultUsage("remove", undefined), true);

	assert.deepEqual(toBillableUsage(accumulator.usage), toolUsage(7));
});

test("final replacement preserves optional-field presence only for surviving reports", () => {
	const removed = new ChildUsageAccumulator();
	removed.addTerminalToolResultUsage("removed-optionals", usage({ cacheWrite1h: 5, reasoning: 6 }));
	removed.addToolResultUsage("removed-optionals", toolUsage(2));
	const removedUsage = toBillableUsage(removed.usage);
	assert.ok(removedUsage);
	assert.equal("cacheWrite1h" in removedUsage, false);
	assert.equal("reasoning" in removedUsage, false);

	const retainedZero = new ChildUsageAccumulator();
	retainedZero.addCompactionUsage(usage({ cacheWrite1h: 0, reasoning: 0 }));
	retainedZero.addTerminalToolResultUsage("retained-optionals", usage({ cacheWrite1h: 5, reasoning: 6 }));
	retainedZero.addToolResultUsage("retained-optionals", toolUsage(2));
	const retainedUsage = toBillableUsage(retainedZero.usage);
	assert.ok(retainedUsage);
	assert.equal(retainedUsage.cacheWrite1h, 0);
	assert.equal(retainedUsage.reasoning, 0);
});

test("nested final-message-first ordering and ID reuse do not double count", () => {
	const accumulator = new ChildUsageAccumulator();
	accumulator.addToolResultUsage("reused", toolUsage(2));
	assert.equal(accumulator.addTerminalToolResultUsage("reused", toolUsage(99)), false);
	accumulator.addTerminalToolResultUsage("reused", toolUsage(3));
	accumulator.addToolResultUsage("reused", toolUsage(5));

	assert.deepEqual(toBillableUsage(accumulator.usage), mergeBillableUsage(toolUsage(2), toolUsage(5)));
});

test("nested concurrent occurrences with one ID retain source-ordered authoritative finals", () => {
	const accumulator = new ChildUsageAccumulator();
	accumulator.addTerminalToolResultUsage("shared", toolUsage(20));
	accumulator.addTerminalToolResultUsage("shared", toolUsage(10));
	accumulator.addToolResultUsage("shared", toolUsage(2));
	accumulator.addToolResultUsage("shared", toolUsage(4));

	assert.deepEqual(toBillableUsage(accumulator.usage), mergeBillableUsage(toolUsage(2), toolUsage(4)));
});

test("merges recovered failed usage with earlier middleware usage without mutation", () => {
	const existing = usage({ cacheWrite1h: 3, reasoning: 4 });
	const recovered = usage({ input: 1, output: 2, totalTokens: 3, cacheWrite1h: 5, reasoning: 6 });
	const existingBefore = structuredClone(existing);
	const recoveredBefore = structuredClone(recovered);

	assert.deepEqual(mergeBillableUsage(existing, recovered), {
		input: 11,
		output: 22,
		cacheRead: 60,
		cacheWrite: 80,
		cacheWrite1h: 8,
		reasoning: 10,
		totalTokens: 103,
		cost: { input: 2, output: 4, cacheRead: 6, cacheWrite: 8, total: 20 },
	});
	assert.deepEqual(mergeBillableUsage(createUsageStats(), toolUsage(9)), toolUsage(9), "zero-valued middleware usage is retained and merged");
	assert.deepEqual(existing, existingBefore);
	assert.deepEqual(recovered, recoveredBefore);
});

test("recovery scopes snapshot completed child work only and recovery queues clean up per ID", () => {
	const scope = new UsageRecoveryScope();
	assert.equal(scope.snapshot(), undefined, "pre-execution failures have no usage");
	const first = createUsageStats();
	const second = createUsageStats();
	const firstAccumulator = new ChildUsageAccumulator(first);
	const secondAccumulator = new ChildUsageAccumulator(second);
	firstAccumulator.addAssistantUsage(toolUsage(2));
	secondAccumulator.addAssistantUsage(toolUsage(3));
	scope.register(first);
	scope.register(second);

	const store = new FailedUsageRecoveryStore();
	store.stage("first", scope.snapshot());
	store.stage("second", toolUsage(7));
	assert.deepEqual(store.consume("second"), toolUsage(7), "concurrent IDs remain independent");
	assert.deepEqual(store.consume("first"), mergeBillableUsage(toolUsage(2), toolUsage(3)));
	assert.equal(store.consume("first"), undefined);
	assert.equal(store.size(), 0);
});

test("aggregates successful parallel, chain, and escalation result usage and omits empty usage", () => {
	const direct = createUsageStats();
	const nested = createUsageStats();
	const directAccumulator = new ChildUsageAccumulator(direct);
	const nestedAccumulator = new ChildUsageAccumulator(nested);
	directAccumulator.addAssistantUsage(usage({ input: 2, totalTokens: 2 }));
	nestedAccumulator.addToolResultUsage("child", usage({ input: 3, totalTokens: 3 }));

	const total = aggregateUsageStats([{ usage: direct }, { usage: nested }]);
	assert.deepEqual(toBillableUsage(total), {
		input: 5,
		output: 40,
		cacheRead: 60,
		cacheWrite: 80,
		totalTokens: 5,
		cost: { input: 2, output: 4, cacheRead: 6, cacheWrite: 8, total: 20 },
	});
	assert.equal(toBillableUsage(createUsageStats()), undefined);
});
