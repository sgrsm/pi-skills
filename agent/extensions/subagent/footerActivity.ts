export interface SubagentFooterActivitySnapshot {
	runningByDepth: number[];
	queuedByDepth: number[];
}

type ToolCallActivity = {
	runningSubagents: number;
	unfinishedTasks: number;
	nestedRunningByDepth: number[];
	nestedQueuedByDepth: number[];
};

function normalizeNonNegativeInteger(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.floor(value));
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null;
}

function hasRequestedTaskShape(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return (
		typeof value.agent === "string" &&
		value.agent.trim().length > 0 &&
		typeof value.task === "string" &&
		value.task.trim().length > 0
	);
}

export function countInitialSubagentTasks(params: unknown): number {
	if (!isRecord(params)) return 0;
	if (Array.isArray(params.chain) && params.chain.length > 0) {
		return params.chain.filter(hasRequestedTaskShape).length;
	}
	if (Array.isArray(params.tasks) && params.tasks.length > 0) {
		return params.tasks.filter(hasRequestedTaskShape).length;
	}
	return hasRequestedTaskShape(params) ? 1 : 0;
}

function isRunningResult(value: unknown): boolean {
	return isRecord(value) && value.exitCode === -1;
}

function isFinishedResult(value: unknown): boolean {
	return isRecord(value) && typeof value.exitCode === "number" && value.exitCode !== -1;
}

function parseFooterActivitySnapshot(value: unknown): SubagentFooterActivitySnapshot | null {
	if (!isRecord(value) || !Array.isArray(value.runningByDepth) || !Array.isArray(value.queuedByDepth)) return null;
	return {
		runningByDepth: trimTrailingZeros(value.runningByDepth.map((item) => normalizeNonNegativeInteger(Number(item)))),
		queuedByDepth: trimTrailingZeros(value.queuedByDepth.map((item) => normalizeNonNegativeInteger(Number(item)))),
	};
}

function parseSubagentDetails(value: unknown): { results: unknown[]; footerActivity?: SubagentFooterActivitySnapshot } | null {
	if (!isRecord(value)) return null;
	const mode = value.mode === "parallel" || value.mode === "chain" || value.mode === "single" ? value.mode : null;
	if (!mode || !Array.isArray(value.results)) return null;
	const footerActivity = parseFooterActivitySnapshot(value.footerActivity);
	return { results: value.results, ...(footerActivity ? { footerActivity } : {}) };
}

function getToolResultsByCallId(messages: unknown[]): Map<string, Record<string, any>> {
	const results = new Map<string, Record<string, any>>();
	for (const message of messages) {
		if (!isRecord(message) || message.role !== "toolResult") continue;
		const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId : undefined;
		if (!toolCallId || message.toolName !== "subagent") continue;
		results.set(toolCallId, message);
	}
	return results;
}

function addAtDepth(target: number[], depth: number, value: number): void {
	const normalizedDepth = normalizeNonNegativeInteger(depth);
	const normalizedValue = normalizeNonNegativeInteger(value);
	if (normalizedDepth <= 0 || normalizedValue === 0) return;
	while (target.length < normalizedDepth) target.push(0);
	target[normalizedDepth - 1] += normalizedValue;
}

function addShifted(target: number[], source: number[], shift: number): void {
	for (let index = 0; index < source.length; index++) {
		addAtDepth(target, index + 1 + shift, source[index] ?? 0);
	}
}

function mergeActivity(target: SubagentFooterActivitySnapshot, source: SubagentFooterActivitySnapshot): void {
	for (let index = 0; index < source.runningByDepth.length; index++) {
		addAtDepth(target.runningByDepth, index + 1, source.runningByDepth[index] ?? 0);
	}
	for (let index = 0; index < source.queuedByDepth.length; index++) {
		addAtDepth(target.queuedByDepth, index + 1, source.queuedByDepth[index] ?? 0);
	}
}

function getResultMessages(result: unknown): unknown[] {
	return isRecord(result) && Array.isArray(result.messages) ? result.messages : [];
}

function getNestedActivityFromMessages(messages: unknown[]): SubagentFooterActivitySnapshot {
	const activity: SubagentFooterActivitySnapshot = { runningByDepth: [], queuedByDepth: [] };
	const toolResults = getToolResultsByCallId(messages);
	const seenToolCalls = new Set<string>();

	for (const message of messages) {
		if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const part of message.content) {
			if (!isRecord(part) || part.type !== "toolCall" || part.name !== "subagent") continue;
			const callId = typeof part.id === "string" ? part.id : "";
			const seenKey = callId || JSON.stringify(part.arguments ?? {});
			if (seenToolCalls.has(seenKey)) continue;
			seenToolCalls.add(seenKey);

			const requestedTasks = countInitialSubagentTasks(part.arguments);
			const resultMessage = callId ? toolResults.get(callId) : undefined;
			const nestedDetails = resultMessage ? parseSubagentDetails(resultMessage.details) : null;

			if (nestedDetails) {
				if (nestedDetails.footerActivity && hasSnapshotActivity(nestedDetails.footerActivity)) {
					mergeActivity(activity, nestedDetails.footerActivity);
				} else {
					const running = nestedDetails.results.filter(isRunningResult).length;
					const finished = nestedDetails.results.filter(isFinishedResult).length;
					const knownTasks = Math.max(requestedTasks, nestedDetails.results.length);
					const queued = Math.max(0, knownTasks - finished - running);
					addAtDepth(activity.runningByDepth, 1, running);
					addAtDepth(activity.queuedByDepth, 1, queued);

					for (const result of nestedDetails.results) {
						const childActivity = getNestedActivityFromMessages(getResultMessages(result));
						addShifted(activity.runningByDepth, childActivity.runningByDepth, 1);
						addShifted(activity.queuedByDepth, childActivity.queuedByDepth, 1);
					}
				}
			} else {
				addAtDepth(activity.queuedByDepth, 1, requestedTasks);
			}
		}
	}

	return activity;
}

export function getNestedSubagentFooterActivity(detailsValue: unknown): SubagentFooterActivitySnapshot {
	const details = parseSubagentDetails(detailsValue);
	const activity: SubagentFooterActivitySnapshot = { runningByDepth: [], queuedByDepth: [] };
	if (!details) return activity;
	for (const result of details.results) {
		const nestedActivity = getNestedActivityFromMessages(getResultMessages(result));
		addShifted(activity.runningByDepth, nestedActivity.runningByDepth, 1);
		addShifted(activity.queuedByDepth, nestedActivity.queuedByDepth, 1);
	}
	return activity;
}

function trimTrailingZeros(values: number[]): number[] {
	let end = values.length;
	while (end > 0 && values[end - 1] === 0) end--;
	return values.slice(0, end);
}

function hasAnyActivity(values: number[]): boolean {
	return values.some((value) => value > 0);
}

function formatCountsByDepth(values: number[]): string | null {
	const trimmed = trimTrailingZeros(values.map(normalizeNonNegativeInteger));
	if (!hasAnyActivity(trimmed)) return null;
	return trimmed.join("→");
}

export function formatSubagentRuntimeActivityStatus(activity: SubagentFooterActivitySnapshot): string | null {
	const parts: string[] = [];
	const running = formatCountsByDepth(activity.runningByDepth);
	const queued = formatCountsByDepth(activity.queuedByDepth);
	if (running) parts.push(`r:${running}`);
	if (queued) parts.push(`q:${queued}`);
	return parts.length > 0 ? parts.join("|") : null;
}

function hasSnapshotActivity(activity: SubagentFooterActivitySnapshot): boolean {
	return hasAnyActivity(activity.runningByDepth) || hasAnyActivity(activity.queuedByDepth);
}

export class SubagentFooterActivityTracker {
	private readonly activityByToolCallId = new Map<string, ToolCallActivity>();

	markToolCallActive(toolCallId: string, unfinishedTasks: number): boolean {
		const normalizedTasks = normalizeNonNegativeInteger(unfinishedTasks);
		const current = this.activityByToolCallId.get(toolCallId);
		const next: ToolCallActivity = {
			runningSubagents: current?.runningSubagents ?? 0,
			unfinishedTasks: Math.max(normalizedTasks, current?.runningSubagents ?? 0),
			nestedRunningByDepth: current?.nestedRunningByDepth ?? [],
			nestedQueuedByDepth: current?.nestedQueuedByDepth ?? [],
		};

		if (
			current &&
			current.runningSubagents === next.runningSubagents &&
			current.unfinishedTasks === next.unfinishedTasks &&
			current.nestedRunningByDepth === next.nestedRunningByDepth &&
			current.nestedQueuedByDepth === next.nestedQueuedByDepth
		) {
			return false;
		}
		this.activityByToolCallId.set(toolCallId, next);
		return true;
	}

	startTask(toolCallId: string): boolean {
		const current = this.activityByToolCallId.get(toolCallId) ?? {
			runningSubagents: 0,
			unfinishedTasks: 0,
			nestedRunningByDepth: [],
			nestedQueuedByDepth: [],
		};
		const nextRunning = current.runningSubagents + 1;
		this.activityByToolCallId.set(toolCallId, {
			...current,
			runningSubagents: nextRunning,
			unfinishedTasks: Math.max(current.unfinishedTasks, nextRunning),
		});
		return true;
	}

	finishTask(toolCallId: string): boolean {
		const current = this.activityByToolCallId.get(toolCallId);
		if (!current) return false;
		const next: ToolCallActivity = {
			...current,
			runningSubagents: Math.max(0, current.runningSubagents - 1),
			unfinishedTasks: Math.max(0, current.unfinishedTasks - 1),
		};
		if (next.runningSubagents === 0 && next.unfinishedTasks === 0 && !this.hasNestedActivity(next)) {
			this.activityByToolCallId.delete(toolCallId);
		} else {
			this.activityByToolCallId.set(toolCallId, next);
		}
		return true;
	}

	setNestedActivity(toolCallId: string, nestedActivity: SubagentFooterActivitySnapshot): boolean {
		const current = this.activityByToolCallId.get(toolCallId) ?? {
			runningSubagents: 0,
			unfinishedTasks: 0,
			nestedRunningByDepth: [],
			nestedQueuedByDepth: [],
		};
		const nextRunning = trimTrailingZeros(nestedActivity.runningByDepth.map(normalizeNonNegativeInteger));
		const nextQueued = trimTrailingZeros(nestedActivity.queuedByDepth.map(normalizeNonNegativeInteger));
		if (arraysEqual(current.nestedRunningByDepth, nextRunning) && arraysEqual(current.nestedQueuedByDepth, nextQueued)) {
			return false;
		}
		this.activityByToolCallId.set(toolCallId, {
			...current,
			nestedRunningByDepth: nextRunning,
			nestedQueuedByDepth: nextQueued,
		});
		return true;
	}

	clearToolCall(toolCallId: string): boolean {
		return this.activityByToolCallId.delete(toolCallId);
	}

	clear(): boolean {
		const changed = this.activityByToolCallId.size > 0;
		this.activityByToolCallId.clear();
		return changed;
	}

	snapshot(): SubagentFooterActivitySnapshot {
		const snapshot: SubagentFooterActivitySnapshot = { runningByDepth: [], queuedByDepth: [] };
		for (const activity of this.activityByToolCallId.values()) {
			addAtDepth(snapshot.runningByDepth, 1, activity.runningSubagents);
			addAtDepth(snapshot.queuedByDepth, 1, Math.max(0, activity.unfinishedTasks - activity.runningSubagents));
			mergeActivity(snapshot, {
				runningByDepth: activity.nestedRunningByDepth,
				queuedByDepth: activity.nestedQueuedByDepth,
			});
		}
		snapshot.runningByDepth = trimTrailingZeros(snapshot.runningByDepth);
		snapshot.queuedByDepth = trimTrailingZeros(snapshot.queuedByDepth);
		return snapshot;
	}

	private hasNestedActivity(activity: ToolCallActivity): boolean {
		return hasSnapshotActivity({
			runningByDepth: activity.nestedRunningByDepth,
			queuedByDepth: activity.nestedQueuedByDepth,
		});
	}
}

function arraysEqual(left: number[], right: number[]): boolean {
	if (left.length !== right.length) return false;
	return left.every((value, index) => value === right[index]);
}
