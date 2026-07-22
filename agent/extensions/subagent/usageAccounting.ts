import type { Usage } from "@earendil-works/pi-ai";

/**
 * Pi's Usage plus presentation-only fields. `contextTokens` intentionally tracks
 * the most recent direct assistant response, rather than the aggregate total.
 */
export interface UsageStats extends Usage {
	contextTokens: number;
	turns: number;
}

export function createUsageStats(): UsageStats {
	const stats: UsageStats = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		contextTokens: 0,
		turns: 0,
	};
	return stats;
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function addNumber(target: object, key: string, value: unknown): void {
	const amount = finiteNumber(value);
	if (amount !== undefined) (target as Record<string, number>)[key] += amount;
}

/** Adds a canonical Pi usage object without conflating it with display context. */
export function addUsage(stats: UsageStats, value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	const usage = value as Partial<Usage>;
	const cost = usage.cost;
	const isUsage =
		finiteNumber(usage.input) !== undefined ||
		finiteNumber(usage.output) !== undefined ||
		finiteNumber(usage.cacheRead) !== undefined ||
		finiteNumber(usage.cacheWrite) !== undefined ||
		finiteNumber(usage.totalTokens) !== undefined ||
		finiteNumber(usage.cacheWrite1h) !== undefined ||
		finiteNumber(usage.reasoning) !== undefined ||
		(cost !== undefined && typeof cost === "object");
	if (!isUsage) return false;

	addNumber(stats, "input", usage.input);
	addNumber(stats, "output", usage.output);
	addNumber(stats, "cacheRead", usage.cacheRead);
	addNumber(stats, "cacheWrite", usage.cacheWrite);
	addNumber(stats, "totalTokens", usage.totalTokens);

	const cacheWrite1h = finiteNumber(usage.cacheWrite1h);
	if (cacheWrite1h !== undefined) stats.cacheWrite1h = (stats.cacheWrite1h ?? 0) + cacheWrite1h;
	const reasoning = finiteNumber(usage.reasoning);
	if (reasoning !== undefined) stats.reasoning = (stats.reasoning ?? 0) + reasoning;

	if (cost && typeof cost === "object") {
		addNumber(stats.cost, "input", cost.input);
		addNumber(stats.cost, "output", cost.output);
		addNumber(stats.cost, "cacheRead", cost.cacheRead);
		addNumber(stats.cost, "cacheWrite", cost.cacheWrite);
		addNumber(stats.cost, "total", cost.total);
	}
	return true;
}

/** Returns the canonical usage only when the work incurred token or monetary usage. */
export function toBillableUsage(stats: UsageStats): Usage | undefined {
	const values = [
		stats.input,
		stats.output,
		stats.cacheRead,
		stats.cacheWrite,
		stats.totalTokens,
		stats.cacheWrite1h,
		stats.reasoning,
		stats.cost.input,
		stats.cost.output,
		stats.cost.cacheRead,
		stats.cost.cacheWrite,
		stats.cost.total,
	];
	if (!values.some((value) => typeof value === "number" && value !== 0)) return undefined;
	return {
		input: stats.input,
		output: stats.output,
		cacheRead: stats.cacheRead,
		cacheWrite: stats.cacheWrite,
		totalTokens: stats.totalTokens,
		cost: { ...stats.cost },
		...(stats.cacheWrite1h !== undefined ? { cacheWrite1h: stats.cacheWrite1h } : {}),
		...(stats.reasoning !== undefined ? { reasoning: stats.reasoning } : {}),
	};
}

export function aggregateUsageStats(results: Iterable<{ usage: UsageStats }>): UsageStats {
	const total = createUsageStats();
	for (const result of results) {
		addUsage(total, result.usage);
		total.turns += result.usage.turns;
	}
	return total;
}

/** Aggregates canonical usage from completed child JSON events. */
export class ChildUsageAccumulator {
	readonly usage: UsageStats;

	constructor(usage: UsageStats = createUsageStats()) {
		this.usage = usage;
	}

	addAssistantUsage(value: unknown): boolean {
		this.usage.turns++;
		const added = addUsage(this.usage, value);
		if (added) {
			const totalTokens = finiteNumber((value as Partial<Usage>).totalTokens);
			if (totalTokens !== undefined) this.usage.contextTokens = totalTokens;
		}
		return added;
	}

	addToolResultUsage(value: unknown): boolean {
		return addUsage(this.usage, value);
	}

	addCompactionUsage(value: unknown): boolean {
		return addUsage(this.usage, value);
	}
}
