import type { Usage } from "@earendil-works/pi-ai";

/**
 * Pi's Usage plus presentation-only fields. `contextTokens` intentionally tracks
 * the most recent direct assistant response, rather than the aggregate total.
 */
export interface UsageStats extends Usage {
	contextTokens: number;
	turns: number;
}

interface OptionalUsageReportCounts {
	cacheWrite1h: number;
	reasoning: number;
}

const optionalUsageReportCounts = new WeakMap<object, OptionalUsageReportCounts>();

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
	optionalUsageReportCounts.set(stats, { cacheWrite1h: 0, reasoning: 0 });
	return stats;
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function addNumber(target: object, key: string, value: unknown): void {
	const amount = finiteNumber(value);
	if (amount !== undefined) (target as Record<string, number>)[key] += amount;
}

function getOptionalReportCounts(value: object): OptionalUsageReportCounts {
	let counts = optionalUsageReportCounts.get(value);
	if (!counts) {
		const usage = value as Partial<Usage>;
		counts = {
			cacheWrite1h: finiteNumber(usage.cacheWrite1h) !== undefined ? 1 : 0,
			reasoning: finiteNumber(usage.reasoning) !== undefined ? 1 : 0,
		};
		optionalUsageReportCounts.set(value, counts);
	}
	return counts;
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

	const targetOptionalCounts = getOptionalReportCounts(stats);
	const sourceOptionalCounts = getOptionalReportCounts(value as object);
	const cacheWrite1h = finiteNumber(usage.cacheWrite1h);
	if (sourceOptionalCounts.cacheWrite1h > 0 && cacheWrite1h !== undefined) {
		stats.cacheWrite1h = (stats.cacheWrite1h ?? 0) + cacheWrite1h;
		targetOptionalCounts.cacheWrite1h += sourceOptionalCounts.cacheWrite1h;
	}
	const reasoning = finiteNumber(usage.reasoning);
	if (sourceOptionalCounts.reasoning > 0 && reasoning !== undefined) {
		stats.reasoning = (stats.reasoning ?? 0) + reasoning;
		targetOptionalCounts.reasoning += sourceOptionalCounts.reasoning;
	}

	if (cost && typeof cost === "object") {
		addNumber(stats.cost, "input", cost.input);
		addNumber(stats.cost, "output", cost.output);
		addNumber(stats.cost, "cacheRead", cost.cacheRead);
		addNumber(stats.cost, "cacheWrite", cost.cacheWrite);
		addNumber(stats.cost, "total", cost.total);
	}
	return true;
}

function subtractUsage(stats: UsageStats, value: UsageStats): void {
	stats.input -= value.input;
	stats.output -= value.output;
	stats.cacheRead -= value.cacheRead;
	stats.cacheWrite -= value.cacheWrite;
	stats.totalTokens -= value.totalTokens;

	const targetOptionalCounts = getOptionalReportCounts(stats);
	const sourceOptionalCounts = getOptionalReportCounts(value);
	if (sourceOptionalCounts.cacheWrite1h > 0 && value.cacheWrite1h !== undefined) {
		stats.cacheWrite1h = (stats.cacheWrite1h ?? 0) - value.cacheWrite1h;
		targetOptionalCounts.cacheWrite1h -= sourceOptionalCounts.cacheWrite1h;
		if (targetOptionalCounts.cacheWrite1h <= 0) delete stats.cacheWrite1h;
	}
	if (sourceOptionalCounts.reasoning > 0 && value.reasoning !== undefined) {
		stats.reasoning = (stats.reasoning ?? 0) - value.reasoning;
		targetOptionalCounts.reasoning -= sourceOptionalCounts.reasoning;
		if (targetOptionalCounts.reasoning <= 0) delete stats.reasoning;
	}

	stats.cost.input -= value.cost.input;
	stats.cost.output -= value.cost.output;
	stats.cost.cacheRead -= value.cost.cacheRead;
	stats.cost.cacheWrite -= value.cost.cacheWrite;
	stats.cost.total -= value.cost.total;
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

/** Creates a fresh billable total and never mutates middleware-provided usage. */
export function mergeBillableUsage(...values: unknown[]): Usage | undefined {
	const total = createUsageStats();
	for (const value of values) addUsage(total, value);
	return toBillableUsage(total);
}

export function aggregateUsageStats(results: Iterable<{ usage: UsageStats }>): UsageStats {
	const total = createUsageStats();
	for (const result of results) {
		addUsage(total, result.usage);
		total.turns += result.usage.turns;
	}
	return total;
}

/**
 * Tracks provisional terminal-tool usage until a toolResult message finalizes it.
 * Each ID has an occurrence queue so sequential or concurrent ID reuse does not
 * permanently suppress later calls.
 */
export class ChildUsageAccumulator {
	readonly usage: UsageStats;
	private readonly toolOccurrences = new Map<string, ToolUsageOccurrence[]>();

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

	/** A finalized toolResult is authoritative, including an explicit missing usage. */
	addToolResultUsage(toolCallId: unknown, value: unknown): boolean {
		if (!isToolCallId(toolCallId)) return false;
		const occurrences = this.toolOccurrences.get(toolCallId) ?? [];
		const pending = occurrences.find((occurrence) => occurrence.endSeen && !occurrence.finalSeen);
		if (pending) {
			this.replaceToolContribution(pending, value);
			pending.finalSeen = true;
			this.removeOccurrence(toolCallId, pending);
			return true;
		}

		const occurrence: ToolUsageOccurrence = { endSeen: false, finalSeen: true };
		this.replaceToolContribution(occurrence, value);
		occurrences.push(occurrence);
		this.toolOccurrences.set(toolCallId, occurrences);
		return true;
	}

	/** Terminal events are fallback-only and remain pending for a final message. */
	addTerminalToolResultUsage(toolCallId: unknown, value: unknown): boolean {
		if (!isToolCallId(toolCallId)) return false;
		const occurrences = this.toolOccurrences.get(toolCallId) ?? [];
		const finalFirst = occurrences.find((occurrence) => occurrence.finalSeen && !occurrence.endSeen);
		if (finalFirst) {
			finalFirst.endSeen = true;
			this.removeOccurrence(toolCallId, finalFirst);
			return false;
		}

		const occurrence: ToolUsageOccurrence = { endSeen: true, finalSeen: false };
		this.replaceToolContribution(occurrence, value);
		occurrences.push(occurrence);
		this.toolOccurrences.set(toolCallId, occurrences);
		return occurrence.contribution !== undefined;
	}

	addCompactionUsage(value: unknown): boolean {
		return addUsage(this.usage, value);
	}

	private replaceToolContribution(occurrence: ToolUsageOccurrence, value: unknown): void {
		if (occurrence.contribution) subtractUsage(this.usage, occurrence.contribution);
		const contribution = createUsageStats();
		occurrence.contribution = addUsage(contribution, value) ? contribution : undefined;
		if (occurrence.contribution) addUsage(this.usage, occurrence.contribution);
	}

	private removeOccurrence(toolCallId: string, occurrence: ToolUsageOccurrence): void {
		const occurrences = this.toolOccurrences.get(toolCallId);
		if (!occurrences) return;
		const index = occurrences.indexOf(occurrence);
		if (index >= 0) occurrences.splice(index, 1);
		if (occurrences.length === 0) this.toolOccurrences.delete(toolCallId);
	}
}

interface ToolUsageOccurrence {
	endSeen: boolean;
	finalSeen: boolean;
	contribution?: UsageStats;
}

function isToolCallId(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

/** Per-execution usage references, snapshotted only when execution throws. */
export class UsageRecoveryScope {
	private readonly usages = new Set<UsageStats>();

	register(usage: UsageStats): void {
		this.usages.add(usage);
	}

	snapshot(): Usage | undefined {
		return mergeBillableUsage(...this.usages);
	}
}

/** Queues recovery snapshots by host tool-call ID and consumes each exactly once. */
export class FailedUsageRecoveryStore {
	private readonly pending = new Map<string, Usage[]>();

	clear(toolCallId: string): void {
		this.pending.delete(toolCallId);
	}

	stage(toolCallId: string, usage: Usage | undefined): void {
		if (!usage) return;
		const queue = this.pending.get(toolCallId) ?? [];
		queue.push(usage);
		this.pending.set(toolCallId, queue);
	}

	consume(toolCallId: string): Usage | undefined {
		const queue = this.pending.get(toolCallId);
		if (!queue) return undefined;
		const usage = queue.shift();
		if (queue.length === 0) this.pending.delete(toolCallId);
		return usage;
	}

	size(): number {
		return this.pending.size;
	}
}
