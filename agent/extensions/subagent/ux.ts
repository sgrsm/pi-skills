import { isFailedResult, isRunningResult } from "./resultState.ts";

const PARENT_ESCALATION_TOOL_NAME = "escalate_to_parent";

export interface EscalationOption {
	label: string;
	description?: string;
}

export interface ParentEscalationDetails {
	requestType: "clarify" | "approval";
	question: string;
	options: EscalationOption[];
	allowCustom: boolean;
	customPrompt?: string;
	reason?: string;
}

export interface ParentEscalationResolution {
	occurrenceIndex: number;
	agent: string;
	task: string;
	escalation: ParentEscalationDetails;
	answer: string | null;
	answerType: "option" | "custom" | "cancelled";
	selectedIndex?: number;
}

export type AgentScopeLike = "user" | "project" | "both";

export interface MessageLike {
	role?: string;
	toolName?: string;
	toolCallId?: string;
	content?: Array<Record<string, any>>;
	details?: unknown;
	isError?: boolean;
	timestamp?: number;
}

export interface SingleResultLike {
	agent: string;
	task: string;
	exitCode: number;
	messages: MessageLike[];
	parentEscalations: ParentEscalationDetails[];
	step?: number;
	stopReason?: string;
	errorMessage?: string;
	stderr?: string;
	agentSource?: "user" | "project" | "unknown";
	model?: string;
	usage?: unknown;
}

export interface SubagentDetailsLike {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScopeLike;
	projectAgentsDir: string | null;
	results: SingleResultLike[];
	parentEscalationResolutions?: ParentEscalationResolution[];
}

export interface ParentClarifyUi {
	select(title: string, options: string[]): Promise<string | undefined>;
	editor(title: string, initialValue?: string): Promise<string | undefined>;
}

export type ThemeFg = (color: any, text: string) => string;

type ActivityStatus = "running" | "done" | "failed" | "escalated" | "waiting on parent/user";

interface ActivityNode {
	label: string;
	status: ActivityStatus;
	task?: string;
	children: ActivityNode[];
}

interface ParentEscalationOccurrence {
	occurrenceIndex: number;
	result: SingleResultLike;
	escalation: ParentEscalationDetails;
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null;
}

function normalizeText(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length > 0 ? normalized : undefined;
}

function normalizeEscalationOptions(value: unknown): EscalationOption[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((option) => ({
			label: normalizeText(isRecord(option) ? option.label : undefined) ?? "",
			description: normalizeText(isRecord(option) ? option.description : undefined),
		}))
		.filter((option) => option.label.length > 0);
}

function trimPreview(text: string, max = 140): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length <= max) return normalized;
	return `${normalized.slice(0, Math.max(1, max - 1))}…`;
}

function parseParentEscalationDetails(value: unknown): ParentEscalationDetails | null {
	if (!isRecord(value)) return null;
	const requestType = value.requestType === "approval" ? "approval" : value.requestType === "clarify" ? "clarify" : null;
	const question = normalizeText(value.question);
	if (!requestType || !question) return null;
	const options = normalizeEscalationOptions(value.options);
	const allowCustom = value.allowCustom !== false;
	return {
		requestType,
		question,
		options,
		allowCustom,
		customPrompt: typeof value.customPrompt === "string" ? value.customPrompt : undefined,
		reason: normalizeText(value.reason),
	};
}

function getParentEscalationFromMessage(message: MessageLike): ParentEscalationDetails | null {
	if (!isRecord(message) || message.role !== "toolResult" || message.toolName !== PARENT_ESCALATION_TOOL_NAME) return null;
	return parseParentEscalationDetails(message.details);
}

export function parseSubagentDetails(value: unknown): SubagentDetailsLike | null {
	if (!isRecord(value)) return null;
	const mode = value.mode === "parallel" || value.mode === "chain" || value.mode === "single" ? value.mode : null;
	if (!mode || !Array.isArray(value.results)) return null;
	const agentScope: AgentScopeLike = value.agentScope === "project" || value.agentScope === "both" ? value.agentScope : "user";
	const resolutions = Array.isArray(value.parentEscalationResolutions)
		? (value.parentEscalationResolutions.filter(isRecord) as ParentEscalationResolution[])
		: undefined;
	return {
		mode,
		agentScope,
		projectAgentsDir: typeof value.projectAgentsDir === "string" ? value.projectAgentsDir : null,
		results: value.results.filter(isRecord) as SingleResultLike[],
		...(resolutions && resolutions.length > 0 ? { parentEscalationResolutions: resolutions } : {}),
	};
}

function getParentEscalationKey(escalation: ParentEscalationDetails): string {
	return JSON.stringify({
		requestType: escalation.requestType,
		question: escalation.question,
		options: escalation.options,
		allowCustom: escalation.allowCustom,
		customPrompt: escalation.customPrompt,
		reason: escalation.reason,
	});
}

function getParentEscalationsFromSubagentDetails(value: unknown): ParentEscalationDetails[] {
	const details = parseSubagentDetails(value);
	if (!details) return [];
	const escalations: ParentEscalationDetails[] = [];
	for (const result of details.results) {
		const seenInResult = new Set<string>();
		const addForResult = (escalation: ParentEscalationDetails) => {
			const key = getParentEscalationKey(escalation);
			if (seenInResult.has(key)) return;
			seenInResult.add(key);
			escalations.push(escalation);
		};

		const directEscalations = Array.isArray(result.parentEscalations) ? result.parentEscalations : [];
		for (const escalationValue of directEscalations) {
			const escalation = parseParentEscalationDetails(escalationValue);
			if (escalation) addForResult(escalation);
		}
		const messages = Array.isArray(result.messages) ? result.messages : [];
		for (const message of messages) {
			for (const escalation of getParentEscalationsFromMessage(message)) {
				addForResult(escalation);
			}
		}
	}
	return escalations;
}

export function getParentEscalationsFromMessage(message: MessageLike): ParentEscalationDetails[] {
	const directEscalation = getParentEscalationFromMessage(message);
	if (directEscalation) return [directEscalation];
	if (isRecord(message) && message.role === "toolResult" && message.toolName === "subagent") {
		return getParentEscalationsFromSubagentDetails(message.details);
	}
	return [];
}

function formatEscalationOptions(options: EscalationOption[], allowCustom: boolean): string[] {
	const lines = options.map((option, index) => {
		const suffix = option.description ? ` — ${option.description}` : "";
		return `${index + 1}. ${option.label}${suffix}`;
	});
	if (allowCustom) lines.push(`${options.length + 1}. Custom instructions`);
	return lines;
}

function getParentEscalationOccurrences(results: SingleResultLike[]): ParentEscalationOccurrence[] {
	const occurrences: ParentEscalationOccurrence[] = [];
	for (const result of results) {
		const escalations = Array.isArray(result.parentEscalations) ? result.parentEscalations : [];
		for (const escalation of escalations) {
			occurrences.push({ occurrenceIndex: occurrences.length, result, escalation });
		}
	}
	return occurrences;
}

export function buildEscalationChoiceLabel(index: number, label: string): string {
	return `${index + 1}. ${label}`;
}

export function buildParentClarifyTitle(occurrence: ParentEscalationOccurrence): string {
	const { result, escalation } = occurrence;
	const lines = [`Subagent ${result.agent} requested clarification.`, "", escalation.question];
	if (escalation.reason) lines.push("", `Reason: ${escalation.reason}`);
	lines.push("", `Original delegated task: ${trimPreview(result.task, 220)}`);
	if (escalation.options.length > 0 || escalation.allowCustom) lines.push("", "Options:");
	for (let i = 0; i < escalation.options.length; i++) {
		const option = escalation.options[i];
		const suffix = option.description ? ` — ${option.description}` : "";
		lines.push(`${i + 1}. ${option.label}${suffix}`);
	}
	if (escalation.allowCustom) lines.push(`${escalation.options.length + 1}. Custom instructions`);
	return lines.join("\n");
}

export function formatParentEscalationResolution(resolution: ParentEscalationResolution): string {
	if (resolution.answerType === "cancelled") return "User cancelled the top-level clarification.";
	if (resolution.answerType === "custom") return `User provided custom instructions: ${resolution.answer ?? ""}`;
	const prefix = resolution.selectedIndex ? `${resolution.selectedIndex}. ` : "";
	return `User selected: ${prefix}${resolution.answer ?? ""}`;
}

export async function askParentClarification(
	ui: ParentClarifyUi | null | undefined,
	occurrence: ParentEscalationOccurrence,
): Promise<ParentEscalationResolution | null> {
	if (!ui || occurrence.escalation.requestType !== "clarify") return null;
	const { result, escalation, occurrenceIndex } = occurrence;
	if (escalation.options.length === 0 && !escalation.allowCustom) return null;

	const base: Omit<ParentEscalationResolution, "answer" | "answerType" | "selectedIndex"> = {
		occurrenceIndex,
		agent: result.agent,
		task: result.task,
		escalation,
	};

	if (escalation.options.length === 0) {
		const customAnswer = await ui.editor(buildParentClarifyTitle(occurrence), escalation.customPrompt ?? "");
		const trimmed = customAnswer?.trim();
		return {
			...base,
			answer: trimmed || null,
			answerType: trimmed ? "custom" : "cancelled",
		};
	}

	const choiceLabels = escalation.options.map((option, index) => buildEscalationChoiceLabel(index, option.label));
	const customChoiceLabel = escalation.allowCustom
		? buildEscalationChoiceLabel(escalation.options.length, "Custom instructions")
		: undefined;
	const selectOptions = customChoiceLabel ? [...choiceLabels, customChoiceLabel] : [...choiceLabels];
	const selected = await ui.select(buildParentClarifyTitle(occurrence), selectOptions);

	if (selected === undefined) {
		return {
			...base,
			answer: null,
			answerType: "cancelled",
		};
	}

	if (selected === customChoiceLabel) {
		const customAnswer = await ui.editor(`Custom instructions\n\n${buildParentClarifyTitle(occurrence)}`, escalation.customPrompt ?? "");
		const trimmed = customAnswer?.trim();
		return {
			...base,
			answer: trimmed || null,
			answerType: trimmed ? "custom" : "cancelled",
		};
	}

	const selectedIndex = choiceLabels.indexOf(selected);
	const selectedOption = escalation.options[selectedIndex];
	if (!selectedOption) return null;
	return {
		...base,
		answer: selectedOption.label,
		answerType: "option",
		selectedIndex: selectedIndex + 1,
	};
}

export async function resolveInteractiveParentClarifications(
	ui: ParentClarifyUi | null | undefined,
	results: SingleResultLike[],
): Promise<ParentEscalationResolution[]> {
	if (!ui) return [];
	const resolutions: ParentEscalationResolution[] = [];
	for (const occurrence of getParentEscalationOccurrences(results)) {
		const resolution = await askParentClarification(ui, occurrence);
		if (resolution) resolutions.push(resolution);
	}
	return resolutions;
}

export function formatParentEscalationSummary(
	results: SingleResultLike[],
	resolutions: ParentEscalationResolution[] = [],
): string {
	const occurrences = getParentEscalationOccurrences(results);
	const resolutionByOccurrence = new Map(resolutions.map((resolution) => [resolution.occurrenceIndex, resolution]));
	const interactiveCount = resolutions.length;
	const unresolvedCount = occurrences.filter((occurrence) => {
		const resolution = resolutionByOccurrence.get(occurrence.occurrenceIndex);
		return !resolution || occurrence.escalation.requestType !== "clarify" || resolution.answerType === "cancelled";
	}).length;
	const lines = ["Subagent requested parent input before continuing."];

	if (interactiveCount > 0) {
		lines.push("Available clarification request(s) were asked using the top-level interactive clarify UI.");
	}
	if (unresolvedCount > 0) {
		lines.push("Ask the user at the top level for unresolved item(s), then decide whether to rerun the delegated task or handle the follow-up directly.");
	} else {
		lines.push("Use the top-level answer below, then decide whether to rerun the delegated task or handle the follow-up directly.");
	}

	for (const occurrence of occurrences) {
		const { result, escalation } = occurrence;
		const resolution = resolutionByOccurrence.get(occurrence.occurrenceIndex);
		lines.push("");
		lines.push(`## Escalation from ${result.agent}`);
		lines.push(`Type: ${escalation.requestType}`);
		lines.push(`Question: ${escalation.question}`);
		if (escalation.reason) lines.push(`Reason: ${escalation.reason}`);
		if (resolution) lines.push(`Top-level clarification result: ${formatParentEscalationResolution(resolution)}`);
		const optionLines = formatEscalationOptions(escalation.options, escalation.allowCustom);
		if (optionLines.length > 0) {
			lines.push("Options:");
			lines.push(...optionLines);
		}
		lines.push(`Original delegated task: ${trimPreview(result.task, 220)}`);
	}

	return lines.join("\n");
}

function hasParentEscalations(result: SingleResultLike): boolean {
	return Array.isArray(result.parentEscalations) && result.parentEscalations.length > 0;
}

function getResultActivityStatus(result: SingleResultLike): ActivityStatus {
	if (hasParentEscalations(result)) return "waiting on parent/user";
	if (isRunningResult(result)) return "running";
	if (isFailedResult(result)) return "failed";
	return "done";
}

function getAggregateActivityStatus(results: SingleResultLike[]): ActivityStatus {
	if (results.some(hasParentEscalations)) return "waiting on parent/user";
	if (results.some((result) => isRunningResult(result))) return "running";
	if (results.some((result) => isFailedResult(result))) return "failed";
	return "done";
}

function getSubagentRootLabel(details: SubagentDetailsLike): string {
	if (details.mode === "single") {
		const agent = details.results.length === 1 ? details.results[0].agent : "single";
		return `subagent ${agent}`;
	}
	if (details.mode === "chain") return `subagent chain (${details.results.length} step${details.results.length === 1 ? "" : "s"})`;
	return `subagent parallel (${details.results.length} task${details.results.length === 1 ? "" : "s"})`;
}

export function getSubagentCallLabel(args: Record<string, any>): string {
	if (Array.isArray(args.chain) && args.chain.length > 0) return `subagent chain (${args.chain.length} step${args.chain.length === 1 ? "" : "s"})`;
	if (Array.isArray(args.tasks) && args.tasks.length > 0) return `subagent parallel (${args.tasks.length} task${args.tasks.length === 1 ? "" : "s"})`;
	if (typeof args.agent === "string" && args.agent.trim()) return `subagent ${args.agent.trim()}`;
	return "subagent";
}

function getMaxSubagentRelativeDepthFromMessages(messages: MessageLike[]): number {
	const toolResults = getToolResultsByCallId(messages);
	const seenToolCalls = new Set<string>();
	let maxDepth = 0;

	for (const message of messages) {
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const part of message.content) {
			if (part.type !== "toolCall" || part.name !== "subagent") continue;
			const callId = typeof part.id === "string" ? part.id : undefined;
			if (callId) {
				if (seenToolCalls.has(callId)) continue;
				seenToolCalls.add(callId);
			}

			const resultMessage = callId ? toolResults.get(callId) : undefined;
			const nestedDetails = resultMessage && isRecord(resultMessage) ? parseSubagentDetails(resultMessage.details) : null;
			maxDepth = Math.max(maxDepth, nestedDetails ? getMaxSubagentRelativeDepth(nestedDetails) : 1);
		}
	}

	return maxDepth;
}

export function getMaxSubagentRelativeDepth(details: SubagentDetailsLike): number {
	if (!Array.isArray(details.results) || details.results.length === 0) return 1;
	return Math.max(
		1,
		...details.results.map((result) => 1 + getMaxSubagentRelativeDepthFromMessages(Array.isArray(result.messages) ? result.messages : [])),
	);
}

function buildRequestedTaskActivityNodes(args: Record<string, any>): ActivityNode[] {
	if (Array.isArray(args.chain) && args.chain.length > 0) {
		return args.chain.filter(isRecord).map((step, index) => ({
			label: `step ${index + 1}: ${typeof step.agent === "string" ? step.agent : "unknown"}`,
			status: "running" as const,
			task: typeof step.task === "string" ? step.task.replace(/\{previous\}/g, "").trim() : undefined,
			children: [],
		}));
	}
	if (Array.isArray(args.tasks) && args.tasks.length > 0) {
		return args.tasks.filter(isRecord).map((task) => ({
			label: typeof task.agent === "string" ? task.agent : "unknown",
			status: "running" as const,
			task: typeof task.task === "string" ? task.task : undefined,
			children: [],
		}));
	}
	if (typeof args.agent === "string" && typeof args.task === "string") {
		return [{ label: args.agent, status: "running" as const, task: args.task, children: [] }];
	}
	return [];
}

function getToolResultsByCallId(messages: MessageLike[]): Map<string, MessageLike> {
	const toolResults = new Map<string, MessageLike>();
	for (const message of messages) {
		if (!isRecord(message) || message.role !== "toolResult" || typeof message.toolCallId !== "string") continue;
		toolResults.set(message.toolCallId, message);
	}
	return toolResults;
}

function buildResultActivityNode(result: SingleResultLike): ActivityNode {
	const agent = typeof result.agent === "string" && result.agent ? result.agent : "unknown";
	const label = result.step ? `step ${result.step}: ${agent}` : agent;
	return {
		label,
		status: getResultActivityStatus(result),
		task: typeof result.task === "string" ? result.task : undefined,
		children: buildNestedActivityNodes(Array.isArray(result.messages) ? result.messages : []),
	};
}

function buildNestedActivityNodes(messages: MessageLike[]): ActivityNode[] {
	const toolResults = getToolResultsByCallId(messages);
	const nodes: ActivityNode[] = [];
	const seenToolCalls = new Set<string>();

	for (const message of messages) {
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const part of message.content) {
			if (part.type !== "toolCall") continue;
			const callId = typeof part.id === "string" ? part.id : undefined;
			if (callId) {
				if (seenToolCalls.has(callId)) continue;
				seenToolCalls.add(callId);
			}

			if (part.name === "subagent") {
				const resultMessage = callId ? toolResults.get(callId) : undefined;
				const nestedDetails = resultMessage && isRecord(resultMessage) ? parseSubagentDetails(resultMessage.details) : null;
				const status: ActivityStatus = nestedDetails
					? getAggregateActivityStatus(nestedDetails.results)
					: resultMessage && isRecord(resultMessage) && resultMessage.isError
						? "failed"
						: resultMessage
							? "done"
							: "running";
				nodes.push({
					label: getSubagentCallLabel(part.arguments ?? {}),
					status,
					children: nestedDetails
						? nestedDetails.results.map(buildResultActivityNode)
						: buildRequestedTaskActivityNodes(part.arguments ?? {}),
				});
				continue;
			}

			if (part.name === PARENT_ESCALATION_TOOL_NAME) {
				const question = normalizeText(part.arguments?.question) ?? "ask parent";
				const resultMessage = callId ? toolResults.get(callId) : undefined;
				nodes.push({
					label: PARENT_ESCALATION_TOOL_NAME,
					status: resultMessage ? "waiting on parent/user" : "escalated",
					task: question,
					children: [],
				});
			}
		}
	}

	return nodes;
}

function formatActivityStatus(status: ActivityStatus, themeFg: ThemeFg): string {
	const color =
		status === "done" ? "success" : status === "failed" ? "error" : status === "running" ? "warning" : "accent";
	return themeFg(color, `[${status}]`);
}

function renderActivityNode(
	node: ActivityNode,
	themeFg: ThemeFg,
	prefix = "",
	isLast = true,
	isRoot = false,
): string[] {
	const connector = isRoot ? "" : themeFg("muted", `${prefix}${isLast ? "└─ " : "├─ "}`);
	const task = node.task ? themeFg("dim", `: ${trimPreview(node.task, 90)}`) : "";
	const line = `${connector}${themeFg("accent", node.label)}${task} ${formatActivityStatus(node.status, themeFg)}`;
	const childPrefix = isRoot ? "" : `${prefix}${isLast ? "   " : "│  "}`;
	const lines = [line];
	for (let i = 0; i < node.children.length; i++) {
		lines.push(...renderActivityNode(node.children[i], themeFg, childPrefix, i === node.children.length - 1));
	}
	return lines;
}

export function formatSubagentActivityTree(details: SubagentDetailsLike, themeFg: ThemeFg): string {
	const root: ActivityNode = {
		label: getSubagentRootLabel(details),
		status: getAggregateActivityStatus(details.results),
		children: details.results.map(buildResultActivityNode),
	};
	return renderActivityNode(root, themeFg, "", true, true).join("\n");
}
