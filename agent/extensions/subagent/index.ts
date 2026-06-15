/**
 * Subagent Tool - Delegate tasks to specialized agents
 *
 * Spawns a separate `pi` process for each subagent invocation,
 * giving it an isolated context window.
 *
 * Supports three modes:
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *   - Chain: { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }
 *
 * Uses JSON mode to capture structured output from subagents.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message, ToolResultMessage } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	getMarkdownTheme,
	getSettingsListTheme,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text, type AutocompleteItem, type SettingItem, SettingsList } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { clearLegacyFooterStatus, FOOTER_STATUS_KEYS } from "../shared/footerStatus.ts";
import { type AgentConfig, type AgentDiscoveryResult, type AgentScope, discoverAgents } from "./agents.ts";
import {
	loadSubagentPolicyState,
	normalizeSubagentPolicyMode,
	saveSubagentPolicyState,
	type SubagentPolicyMode,
} from "./policyState.ts";
import { truncateSubagentVisibleOutput } from "./outputTruncation.ts";
import {
	SUBAGENT_MAX_CONCURRENCY_LIMIT,
	SUBAGENT_MAX_PARALLEL_TASKS_LIMIT,
	formatSubagentSettingsSource,
	loadSubagentExecutionSettings,
	mergeSubagentAgentDefaults,
	resetSubagentExecutionSettings,
	saveSubagentExecutionSettings,
	type LoadedSubagentExecutionSettings,
	type SubagentDelegationApprovalScope,
	type SubagentExecutionSettings,
} from "./settingsState.ts";
import {
	getFailureDiagnosticOutput as getFailureDiagnosticOutputForState,
	getResultOutput as getResultOutputForState,
	isFailedResult,
	isRunningResult,
} from "./resultState.ts";
import {
	formatParentEscalationSummary as formatParentEscalationSummaryFromUx,
	formatSubagentActivityTree as formatSubagentActivityTreeFromUx,
	getMaxSubagentRelativeDepth as getMaxSubagentRelativeDepthFromUx,
	getParentEscalationsFromMessage as getParentEscalationsFromMessageFromUx,
	getSubagentCallLabel as getSubagentCallLabelFromUx,
	resolveInteractiveParentClarifications as resolveInteractiveParentClarificationsFromUx,
} from "./ux.ts";

const COMMON_CONCURRENCY_CHOICES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 24, 32] as const;
const COMMON_MAX_TASK_CHOICES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 24, 32, 48, 64] as const;
const COLLAPSED_ITEM_COUNT = 10;
const SUBAGENT_TERMINATION_GRACE_MS = 5000;
const AUTO_MODE_MAX_NON_EXPLICIT_AGENTS = 3;
const AUTO_MODE_ALLOW_WRITE_CAPABLE_AGENTS = false;
const SUBAGENT_STATUS_KEY = FOOTER_STATUS_KEYS.subagents;
const SUBAGENT_INHERITED_APPROVAL_ENV = "PI_SUBAGENT_INHERITED_APPROVAL";
const SUBAGENT_INHERITED_APPROVAL_SCOPE_ENV = "PI_SUBAGENT_INHERITED_APPROVAL_SCOPE";
const SUBAGENT_PARENT_ESCALATION_ENV = "PI_SUBAGENT_PARENT_ESCALATION";
const SUBAGENT_DEPTH_ENV = "PI_SUBAGENT_DEPTH";
const SUBAGENT_WORKFLOW_MODEL_ENV = "PI_SUBAGENT_WORKFLOW_MODEL";
const SUBAGENT_WORKFLOW_THINKING_ENV = "PI_SUBAGENT_WORKFLOW_THINKING";
const SUBAGENT_SESSION_APPROVAL_CUSTOM_TYPE = "subagent-session-approval";
const PARENT_ESCALATION_TOOL_NAME = "escalate_to_parent";
const activeSubagentRelativeDepthByToolCallId = new Map<string, number>();
const APPROVAL_OPTION_ALLOW_ONCE = "Allow once";
const APPROVAL_OPTION_ALLOW_SESSION = "Allow for current session";
const APPROVAL_OPTION_DENY = "Deny";
const THINKING_LEVEL_VALUES = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
const EXPLICIT_SUBAGENT_PATTERNS = [
	/\bsub-?agents?\b/i,
	/\bmulti-agent\b/i,
	/\bdelegate\b/i,
	/\bdelegation\b/i,
	/\bfan\s*out\b/i,
	/\bmultiple\s+(?:sub-?agents?|agents?|reviewers?)\b/i,
	/\b(?:parallel|paralleliz(?:e|ed|ing)|parallelis(?:e|ed|ing))\b[\s\S]{0,40}\b(?:sub-?agents?|agents?|reviewers?)\b/i,
	/\b(?:sub-?agents?|agents?|reviewers?)\b[\s\S]{0,40}\b(?:in\s+parallel|parallel(?:ly)?)\b/i,
	/\bspawn\b[\s\S]{0,24}\bagents?\b/i,
	/\b(?:run|use|launch)\b[\s\S]{0,24}\b(?:sub-?agents?|agents?)\b/i,
];
const SIMPLE_PR_REVIEW_PATTERN = /\b(review|reviewing|inspect|check|analyze)\b[\s\S]{0,120}\b(pr|pull request|diff|changes?)\b/i;

type ThinkingLevel = (typeof THINKING_LEVEL_VALUES)[number];

type SubagentRequestMode = "single" | "parallel" | "chain";

type RequestedTask = {
	agent: string;
	task: string;
	cwd?: string;
	model?: string;
	thinking?: ThinkingLevel;
};

type WorkflowModelLock = {
	model?: string;
	thinking?: ThinkingLevel;
};

interface SubagentRequestSummary {
	requestMode: SubagentRequestMode;
	requestedTasks: RequestedTask[];
	requestedAgents: string[];
	taskCount: number;
	writeCapableAgents: string[];
	projectAgents: string[];
	unknownAgents: string[];
}

type SubagentPolicyDecision = {
	action: "allow" | "ask" | "block";
	reason: string;
};

type DelegationApprovalScope = SubagentDelegationApprovalScope;

type SubagentSessionApprovalState = {
	askModeApproved: boolean;
};

interface EscalationOption {
	label: string;
	description?: string;
}

interface ParentEscalationDetails {
	requestType: "clarify" | "approval";
	question: string;
	options: EscalationOption[];
	allowCustom: boolean;
	customPrompt?: string;
	reason?: string;
}

interface ParentEscalationResolution {
	occurrenceIndex: number;
	agent: string;
	task: string;
	escalation: ParentEscalationDetails;
	answer: string | null;
	answerType: "option" | "custom" | "cancelled";
	selectedIndex?: number;
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null;
}

function normalizeText(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length > 0 ? normalized : undefined;
}

function normalizeNonEmptyString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

function normalizeThinkingLevel(value: unknown): ThinkingLevel | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return THINKING_LEVEL_VALUES.includes(normalized as ThinkingLevel) ? (normalized as ThinkingLevel) : undefined;
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

function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function notifyCommand(
	ctx: ExtensionCommandContext,
	message: string,
	type: "info" | "warning" | "error" = "info",
): void {
	if (ctx.hasUI) ctx.ui.notify(message, type);
	else console.log(message);
}

export function canOpenSubagentConfigUi(ctx: { mode: string }): boolean {
	return ctx.mode === "tui";
}

function trimPreview(text: string, max = 140): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length <= max) return normalized;
	return `${normalized.slice(0, Math.max(1, max - 1))}…`;
}

function getUserContentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(isRecord)
		.map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : ""))
		.filter(Boolean)
		.join("\n");
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

function getParentEscalationFromMessage(message: Message): ParentEscalationDetails | null {
	if (!isRecord(message) || message.role !== "toolResult" || message.toolName !== PARENT_ESCALATION_TOOL_NAME) return null;
	return parseParentEscalationDetails(message.details);
}

function getLatestUserPromptText(ctx: ExtensionContext): string {
	const entries = ctx.sessionManager.getBranch();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "user") continue;
		return getUserContentText(entry.message.content);
	}
	return "";
}

function formatRequestedTaskTarget(task: RequestedTask): string {
	const overrides = [
		task.model ? `model=${task.model}` : undefined,
		task.thinking ? `thinking=${task.thinking}` : undefined,
	].filter((value): value is string => Boolean(value));
	return overrides.length > 0 ? `${task.agent} [${overrides.join(", ")}]` : task.agent;
}

function getInheritedWorkflowModelLock(): WorkflowModelLock {
	const model = normalizeNonEmptyString(process.env[SUBAGENT_WORKFLOW_MODEL_ENV]);
	if (!model) return {};
	const thinking = normalizeThinkingLevel(process.env[SUBAGENT_WORKFLOW_THINKING_ENV]);
	return thinking ? { model, thinking } : { model };
}

function resolveWorkflowModelLock(ctx: ExtensionContext, currentThinkingLevel: ThinkingLevel): WorkflowModelLock {
	const inherited = getInheritedWorkflowModelLock();
	if (inherited.model) return inherited;
	if (!ctx.model) return {};
	return {
		model: `${ctx.model.provider}/${ctx.model.id}`,
		thinking: currentThinkingLevel,
	};
}

function resolveEffectiveSubagentModelSelection(
	request: RequestedTask,
	agent: AgentConfig,
	executionSettings: LoadedSubagentExecutionSettings,
	workflowModelLock: WorkflowModelLock,
): WorkflowModelLock {
	const configuredDefault = executionSettings.agentDefaults[normalizeAgentNameForScopeLookup(request.agent)] ?? {};
	return {
		model:
			normalizeNonEmptyString(request.model) ??
			normalizeNonEmptyString(configuredDefault.model) ??
			normalizeNonEmptyString(agent.model) ??
			normalizeNonEmptyString(workflowModelLock.model),
		thinking:
			normalizeThinkingLevel(request.thinking) ??
			normalizeThinkingLevel(configuredDefault.thinking) ??
			normalizeThinkingLevel(agent.thinking) ??
			normalizeThinkingLevel(workflowModelLock.thinking),
	};
}

function getRequestedTasks(params: Record<string, any>): RequestedTask[] {
	if (Array.isArray(params.chain)) {
		return params.chain
			.filter(isRecord)
			.map((step) => ({
				agent: normalizeNonEmptyString(step.agent) ?? "",
				task: normalizeNonEmptyString(step.task) ?? "",
				cwd: normalizeNonEmptyString(step.cwd),
				model: normalizeNonEmptyString(step.model),
				thinking: normalizeThinkingLevel(step.thinking),
			}))
			.filter((step) => step.agent && step.task);
	}
	if (Array.isArray(params.tasks)) {
		return params.tasks
			.filter(isRecord)
			.map((task) => ({
				agent: normalizeNonEmptyString(task.agent) ?? "",
				task: normalizeNonEmptyString(task.task) ?? "",
				cwd: normalizeNonEmptyString(task.cwd),
				model: normalizeNonEmptyString(task.model),
				thinking: normalizeThinkingLevel(task.thinking),
			}))
			.filter((task) => task.agent && task.task);
	}
	if (typeof params.agent === "string" && typeof params.task === "string") {
		return [
			{
				agent: normalizeNonEmptyString(params.agent) ?? "",
				task: normalizeNonEmptyString(params.task) ?? "",
				cwd: normalizeNonEmptyString(params.cwd),
				model: normalizeNonEmptyString(params.model),
				thinking: normalizeThinkingLevel(params.thinking),
			},
		].filter((task) => task.agent && task.task);
	}
	return [];
}

function getRequestMode(params: Record<string, any>): SubagentRequestMode {
	if (Array.isArray(params.chain) && params.chain.length > 0) return "chain";
	if (Array.isArray(params.tasks) && params.tasks.length > 0) return "parallel";
	return "single";
}

function resolveExecutionCwd(defaultCwd: string, requestedCwd: string | undefined): string {
	const normalized = requestedCwd?.trim();
	return normalized ? path.resolve(defaultCwd, normalized) : defaultCwd;
}

function getRequestExecutionCwds(defaultCwd: string, params: Record<string, any>): string[] {
	const tasks = getRequestedTasks(params);
	const cwds = tasks.length > 0 ? tasks.map((task) => resolveExecutionCwd(defaultCwd, task.cwd)) : [defaultCwd];
	return Array.from(new Set(cwds));
}

function createAgentDiscoveryResolver(
	defaultCwd: string,
	scope: AgentScope,
): (requestedCwd: string | undefined) => AgentDiscoveryResult {
	const cache = new Map<string, AgentDiscoveryResult>();
	return (requestedCwd) => {
		const executionCwd = resolveExecutionCwd(defaultCwd, requestedCwd);
		let discovery = cache.get(executionCwd);
		if (!discovery) {
			discovery = discoverAgents(executionCwd, scope);
			cache.set(executionCwd, discovery);
		}
		return discovery;
	};
}

export function getProjectAgentTrustBlockReason(agentScope: AgentScope, isProjectTrusted: boolean): string | null {
	if (agentScope === "user" || isProjectTrusted) return null;

	// Safer/simple behavior: if a call opts into project-local agents from an untrusted
	// project, block the whole call before reading .pi/agents instead of trying to
	// degrade `both` to user-only and risk ambiguous agent-name resolution.
	return `Blocked: project-local agents require project trust. Current project is not trusted, so agentScope="${agentScope}" cannot load agents from .pi/agents. Trust the project before using project-local subagents, or use agentScope="user". confirmProjectAgents only controls the extra confirmation shown after project trust is established and cannot bypass project trust.`;
}

function normalizeAgentNameForScopeLookup(agentName: string): string {
	return agentName.trim().toLowerCase();
}

function resolveInheritedApprovalScopeForAgent(
	defaultScope: DelegationApprovalScope,
	agentName: string,
	executionSettings: LoadedSubagentExecutionSettings,
): DelegationApprovalScope {
	const configuredScope = executionSettings.inheritedApprovalScopes[normalizeAgentNameForScopeLookup(agentName)];
	return configuredScope ?? defaultScope;
}

function isWriteCapableAgent(agent: AgentConfig | undefined): boolean {
	if (!agent?.tools || agent.tools.length === 0) return true;
	return agent.tools.includes("edit") || agent.tools.includes("write");
}

function summarizeSubagentRequestWithResolver(
	params: Record<string, any>,
	resolveAgentsForTask: (task: RequestedTask) => AgentConfig[],
): SubagentRequestSummary {
	const requestedTasks = getRequestedTasks(params);
	const requestedAgents = Array.from(new Set(requestedTasks.map((task) => task.agent)));
	const writeCapableAgents = new Set<string>();
	const projectAgents = new Set<string>();
	const unknownAgents = new Set<string>();

	for (const task of requestedTasks) {
		const agents = resolveAgentsForTask(task);
		const agent = agents.find((candidate) => candidate.name === task.agent);
		if (!agent) {
			unknownAgents.add(task.agent);
			continue;
		}
		if (isWriteCapableAgent(agent)) writeCapableAgents.add(task.agent);
		if (agent.source === "project") projectAgents.add(task.agent);
	}

	return {
		requestMode: getRequestMode(params),
		requestedTasks,
		requestedAgents,
		taskCount: requestedTasks.length,
		writeCapableAgents: Array.from(writeCapableAgents),
		projectAgents: Array.from(projectAgents),
		unknownAgents: Array.from(unknownAgents),
	};
}

function isExplicitSubagentRequest(userPrompt: string, requestedAgents: string[]): boolean {
	if (!userPrompt.trim()) return false;
	if (EXPLICIT_SUBAGENT_PATTERNS.some((pattern) => pattern.test(userPrompt))) return true;
	const namedAgents = requestedAgents.filter(Boolean).map(escapeRegex);
	if (namedAgents.length === 0) return false;
	const namedAgentPattern = new RegExp(
		`\\b(?:use|run|spawn|delegate(?:\\s+to)?|fan\\s*out\\s+to)\\b[\\s\\S]{0,40}\\b(?:${namedAgents.join("|")})\\b`,
		"i",
	);
	return namedAgentPattern.test(userPrompt);
}

function looksLikeOrdinaryPrReview(userPrompt: string, explicitRequest: boolean): boolean {
	return !explicitRequest && SIMPLE_PR_REVIEW_PATTERN.test(userPrompt);
}

function getReadOnlyScopeViolation(summary: SubagentRequestSummary): string | null {
	const reasons: string[] = [];
	if (summary.writeCapableAgents.length > 0) {
		reasons.push(`write-capable agents: ${summary.writeCapableAgents.join(", ")}`);
	}
	if (summary.projectAgents.length > 0) {
		reasons.push(`project-local agents: ${summary.projectAgents.join(", ")}`);
	}
	if (summary.unknownAgents.length > 0) {
		reasons.push(`unknown agents: ${summary.unknownAgents.join(", ")}`);
	}
	return reasons.length > 0 ? reasons.join("; ") : null;
}

function formatSubagentPolicyMode(mode: SubagentPolicyMode): string {
	switch (mode) {
		case "off":
			return "off";
		case "manual":
			return "manual";
		case "ask":
			return "ask";
		case "auto":
			return "auto";
	}
}

function getInheritedSubagentApprovalScope(): DelegationApprovalScope {
	const rawScope = process.env[SUBAGENT_INHERITED_APPROVAL_SCOPE_ENV]?.trim().toLowerCase();
	if (rawScope === "all") return "all";
	if (rawScope === "read-only" || rawScope === "readonly" || rawScope === "read_only") return "read-only";
	if (rawScope === "none" || rawScope === "0" || rawScope === "false" || rawScope === "no") return "none";

	const legacyValue = process.env[SUBAGENT_INHERITED_APPROVAL_ENV]?.trim().toLowerCase();
	if (legacyValue === "1" || legacyValue === "true" || legacyValue === "yes") return "all";
	return "none";
}

function hasParentEscalationRelay(): boolean {
	const value = process.env[SUBAGENT_PARENT_ESCALATION_ENV]?.trim().toLowerCase();
	return value === "1" || value === "true" || value === "yes";
}

function getCurrentSubagentDepth(): number {
	const rawDepth = process.env[SUBAGENT_DEPTH_ENV]?.trim();
	if (!rawDepth || !/^\d+$/.test(rawDepth)) return 0;
	const parsed = Number(rawDepth);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function formatMaxDelegationDepth(maxDelegationDepth: number | null): string {
	return maxDelegationDepth === null ? "∞" : String(maxDelegationDepth);
}

function getRemainingDelegationDepth(currentDepth: number, maxDelegationDepth: number | null): number | null {
	if (maxDelegationDepth === null) return null;
	return Math.max(0, maxDelegationDepth - currentDepth);
}

function canDelegateWithinDepthLimit(currentDepth: number, maxDelegationDepth: number | null): boolean {
	return maxDelegationDepth === null || currentDepth < maxDelegationDepth;
}

function canUseSubagentToolInSession(
	mode: SubagentPolicyMode,
	executionSettings: LoadedSubagentExecutionSettings,
): boolean {
	return mode !== "off" && canDelegateWithinDepthLimit(getCurrentSubagentDepth(), executionSettings.limits.maxDelegationDepth);
}

function hasSessionSubagentApproval(ctx: ExtensionContext): boolean {
	let approved = false;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== SUBAGENT_SESSION_APPROVAL_CUSTOM_TYPE) continue;
		const data = entry.data as Partial<SubagentSessionApprovalState> | undefined;
		approved = data?.askModeApproved !== false;
	}
	return approved;
}

function persistSessionSubagentApproval(pi: ExtensionAPI, approved: boolean): void {
	pi.appendEntry(
		SUBAGENT_SESSION_APPROVAL_CUSTOM_TYPE,
		{ askModeApproved: approved } as SubagentSessionApprovalState,
	);
}

function formatSubagentStatusLabel(mode: SubagentPolicyMode, sessionApproval: boolean): string {
	if (mode === "ask" && sessionApproval) return `${formatSubagentPolicyMode(mode)} (session-approved)`;
	return formatSubagentPolicyMode(mode);
}

function setSubagentToolEnabled(pi: ExtensionAPI, enabled: boolean): void {
	const activeTools = pi.getActiveTools();
	const activeSet = new Set(activeTools);
	if (enabled) activeSet.add("subagent");
	else activeSet.delete("subagent");
	if (activeSet.size === activeTools.length && activeTools.every((tool) => activeSet.has(tool))) return;
	pi.setActiveTools(Array.from(activeSet));
}

function setParentEscalationToolEnabled(pi: ExtensionAPI, enabled: boolean): void {
	const activeTools = pi.getActiveTools();
	const activeSet = new Set(activeTools);
	if (enabled) activeSet.add(PARENT_ESCALATION_TOOL_NAME);
	else activeSet.delete(PARENT_ESCALATION_TOOL_NAME);
	if (activeSet.size === activeTools.length && activeTools.every((tool) => activeSet.has(tool))) return;
	pi.setActiveTools(Array.from(activeSet));
}

function buildSelectableValues(choices: readonly number[], current: number): string[] {
	return Array.from(new Set<number>([...choices, current]))
		.sort((a, b) => a - b)
		.map(String);
}

function hasProjectLimitOverride(executionSettings: LoadedSubagentExecutionSettings): boolean {
	return (
		executionSettings.sources.maxConcurrency === "project" ||
		executionSettings.sources.maxParallelTasks === "project" ||
		executionSettings.sources.maxDelegationDepth === "project"
	);
}

function updateSubagentStatus(
	ctx: ExtensionContext,
	mode: SubagentPolicyMode,
	sessionApproval: boolean,
	executionSettings: LoadedSubagentExecutionSettings = loadSubagentExecutionSettings(ctx.cwd, {
		projectTrusted: ctx.isProjectTrusted(),
	}),
): void {
	if (!ctx.hasUI) return;
	clearLegacyFooterStatus(ctx, "subagents");
	const currentDepth = getDisplayedSubagentDepth();
	ctx.ui.setStatus(
		SUBAGENT_STATUS_KEY,
		ctx.ui.theme.fg(
			"dim",
			`subagents: ${formatSubagentStatusLabel(mode, sessionApproval)} • c:${executionSettings.limits.maxConcurrency}|t:${executionSettings.limits.maxParallelTasks} • d:${currentDepth}|${formatMaxDelegationDepth(executionSettings.limits.maxDelegationDepth)} •`,
		),
	);
}

function mergeSubagentExecutionSettings(settings: LoadedSubagentExecutionSettings[]): LoadedSubagentExecutionSettings {
	if (settings.length === 0) return loadSubagentExecutionSettings(process.cwd());
	if (settings.length === 1) return settings[0];

	const sourceFor = (key: "maxConcurrency" | "maxParallelTasks" | "maxDelegationDepth") => {
		if (settings.some((item) => item.sources[key] === "project")) return "project" as const;
		if (settings.some((item) => item.sources[key] === "global")) return "global" as const;
		return "default" as const;
	};

	const configuredDelegationDepths = settings
		.map((item) => item.limits.maxDelegationDepth)
		.filter((depth): depth is number => depth !== null);
	const limits = {
		maxParallelTasks: Math.min(...settings.map((item) => item.limits.maxParallelTasks)),
		maxConcurrency: Math.min(...settings.map((item) => item.limits.maxConcurrency)),
		maxDelegationDepth: configuredDelegationDepths.length > 0 ? Math.min(...configuredDelegationDepths) : null,
	};
	if (limits.maxConcurrency > limits.maxParallelTasks) limits.maxConcurrency = limits.maxParallelTasks;

	return {
		limits,
		sources: {
			maxParallelTasks: sourceFor("maxParallelTasks"),
			maxConcurrency: sourceFor("maxConcurrency"),
			maxDelegationDepth: sourceFor("maxDelegationDepth"),
		},
		inheritedApprovalScopes: Object.assign({}, ...settings.map((item) => item.inheritedApprovalScopes)),
		agentDefaults: mergeSubagentAgentDefaults(...settings.map((item) => item.agentDefaults)),
		warnings: Array.from(new Set(settings.flatMap((item) => item.warnings))),
		paths: settings[0].paths,
	};
}

function loadSubagentExecutionSettingsForRequestedCwd(
	defaultCwd: string,
	requestedCwd: string | undefined,
	options: { projectTrusted?: boolean } = {},
): LoadedSubagentExecutionSettings {
	const executionCwd = resolveExecutionCwd(defaultCwd, requestedCwd);
	try {
		return loadSubagentExecutionSettings(executionCwd, options);
	} catch (error) {
		const fallback = loadSubagentExecutionSettings(defaultCwd, options);
		return {
			...fallback,
			warnings: [
				...fallback.warnings,
				`Warning (subagent settings for ${executionCwd}): ${error instanceof Error ? error.message : String(error)}`,
			],
		};
	}
}

function loadSubagentExecutionSettingsForCwds(
	cwds: string[],
	fallbackCwd: string,
	options: { projectTrusted?: boolean } = {},
): LoadedSubagentExecutionSettings {
	const uniqueCwds = Array.from(new Set(cwds));
	const settings = uniqueCwds.map((cwd) => loadSubagentExecutionSettingsForRequestedCwd(fallbackCwd, cwd, options));
	return mergeSubagentExecutionSettings(settings);
}

function formatConfiguredAgentDefaults(executionSettings: LoadedSubagentExecutionSettings): string[] {
	return Object.entries(executionSettings.agentDefaults)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([agent, config]) => {
			const parts = [
				config.model ? `model=${config.model}` : undefined,
				config.thinking ? `thinking=${config.thinking}` : undefined,
			].filter((value): value is string => Boolean(value));
			return `${agent}(${parts.join(", ")})`;
		})
		.filter(Boolean);
}

function buildSubagentUsageText(): string {
	return [
		"Usage:",
		"/subagents — show current mode and limits",
		"/subagents ui — open interactive TUI subagent config",
		"/subagents off|manual|ask|auto — set policy mode",
		`/subagents concurrency <n>|default — set max concurrent subagents (1-${SUBAGENT_MAX_CONCURRENCY_LIMIT})`,
		`/subagents max-tasks <n>|default — set max parallel tasks per call (1-${SUBAGENT_MAX_PARALLEL_TASKS_LIMIT})`,
		"/subagents reset-limits — remove global subagent limit overrides from settings.json",
		"/subagents cancel-session-approval — stop auto-approving ask-mode requests in this session",
		'Manual settings.json keys: "subagents.maxDelegationDepth", "subagents.inheritedApprovalScopes.<agent>", and "subagents.agentDefaults.<agent>.{model,thinking}"',
	].join("\n");
}

function buildSubagentSummaryText(
	mode: SubagentPolicyMode,
	sessionApproval: boolean,
	executionSettings: LoadedSubagentExecutionSettings,
): string {
	const currentDepth = getCurrentSubagentDepth();
	const remainingDelegationDepth = getRemainingDelegationDepth(
		currentDepth,
		executionSettings.limits.maxDelegationDepth,
	);
	const configuredInheritedScopes = Object.entries(executionSettings.inheritedApprovalScopes)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([agent, scope]) => `${agent}=${scope}`);
	const configuredAgentDefaults = formatConfiguredAgentDefaults(executionSettings);

	const lines = [
		`subagents mode: ${formatSubagentStatusLabel(mode, sessionApproval)}`,
		`current session delegation depth: ${currentDepth}`,
		`max delegation depth: ${formatMaxDelegationDepth(executionSettings.limits.maxDelegationDepth)} (${formatSubagentSettingsSource(executionSettings.sources.maxDelegationDepth)})`,
		`remaining delegation generations in this session: ${remainingDelegationDepth === null ? "∞" : remainingDelegationDepth}`,
		`max concurrent subagents: ${executionSettings.limits.maxConcurrency} (${formatSubagentSettingsSource(executionSettings.sources.maxConcurrency)})`,
		`max parallel tasks per call: ${executionSettings.limits.maxParallelTasks} (${formatSubagentSettingsSource(executionSettings.sources.maxParallelTasks)})`,
		`nested inherited approval overrides: ${configuredInheritedScopes.length > 0 ? configuredInheritedScopes.join(", ") : "none"}`,
		`agent model/thinking defaults: ${configuredAgentDefaults.length > 0 ? configuredAgentDefaults.join(", ") : "none"}`,
		"- off: subagent tool disabled completely",
		"- manual: only explicit user requests may use subagents",
		"- ask: explicit requests run immediately; otherwise Pi asks first (Allow once / Allow for current session / Deny)",
		`- auto: Pi may auto-use read-only multi-agent delegation within guardrails (max ${AUTO_MODE_MAX_NON_EXPLICIT_AGENTS} agents; write-capable agents require an explicit request)`,
		"- /subagents ui opens interactive TUI config",
		'- settings.json keys: "subagents.maxConcurrency", "subagents.maxParallelTasks", "subagents.maxDelegationDepth", "subagents.inheritedApprovalScopes.<agent>", and "subagents.agentDefaults.<agent>.{model,thinking}"',
		"- maxDelegationDepth=2 allows root -> first -> second; a third nested generation is blocked",
		"- maxDelegationDepth, inherited approval overrides, and per-agent model defaults are currently edited manually in settings.json",
		"- concurrency/max-tasks overrides save to ~/.pi/agent/settings.json by default; trusted project .pi/settings.json overrides still apply to the effective subagent settings for the current project",
		"- delegated child sessions inherit read-only nested delegation approval by default unless overridden per child agent in settings.json",
		`- delegated child sessions can use ${PARENT_ESCALATION_TOOL_NAME} to ask the parent agent for user input or broader approval`,
		"- policy mode is still stored in ~/.pi/agent/subagent-policy.json",
	];

	if (mode === "ask" && sessionApproval) {
		lines.splice(
			4,
			0,
			"- current session approval: subsequent ask-mode subagent requests are auto-approved in this session",
			"- cancel it with /subagents cancel-session-approval",
		);
	}

	if (remainingDelegationDepth === 0) {
		lines.splice(4, 0, "- current session has reached the delegation depth cap; this session cannot spawn more subagents");
	}

	if (hasProjectLimitOverride(executionSettings)) {
		lines.push("- current project overrides one or more limit values via .pi/settings.json");
	}

	if (executionSettings.warnings.length > 0) {
		lines.push("", ...executionSettings.warnings);
	}

	return lines.join("\n");
}

function buildSubagentPolicyPrompt(
	mode: SubagentPolicyMode,
	hasUI: boolean,
	inheritedApprovalScope: DelegationApprovalScope,
	sessionApproval: boolean,
	executionSettings: LoadedSubagentExecutionSettings,
	parentEscalationAvailable: boolean,
): string {
	const currentDepth = getCurrentSubagentDepth();
	const maxDelegationDepth = executionSettings.limits.maxDelegationDepth;
	const remainingDelegationDepth = getRemainingDelegationDepth(currentDepth, maxDelegationDepth);
	const depthLimitReached = !canDelegateWithinDepthLimit(currentDepth, maxDelegationDepth);
	const lines = [
		"Subagent policy:",
		`- Current subagent mode is ${formatSubagentPolicyMode(mode)}.`,
		`- Current parallel limits: ${executionSettings.limits.maxParallelTasks} task(s) per call, with up to ${executionSettings.limits.maxConcurrency} subagent(s) running at once.`,
		`- Current delegation depth is ${currentDepth}.`,
		`- Max delegation depth for this session is ${formatMaxDelegationDepth(maxDelegationDepth)}.`,
	];

	if (remainingDelegationDepth === null) {
		lines.push("- This session is not depth-limited.");
	} else if (remainingDelegationDepth > 0) {
		lines.push(`- This session may spawn ${remainingDelegationDepth} more subagent generation(s).`);
	} else {
		lines.push("- Max delegation depth has been reached in this session.");
	}

	if (inheritedApprovalScope === "all" && mode !== "off") {
		lines.push("- This session inherits broad user approval for nested subagent use from an ancestor agent session.");
		lines.push("- You may use the subagent tool within this delegated task without asking again.");
	} else if (inheritedApprovalScope === "read-only" && mode !== "off") {
		lines.push("- This session inherits read-only nested delegation approval from an ancestor agent session.");
		lines.push("- You may only auto-delegate to read-only user-scoped agents (no edit/write tools, no project-local agents, no unknown agents) without new approval.");
		lines.push("- If you need broader delegation, escalate to the parent agent instead of assuming it is allowed.");
	}

	if (parentEscalationAvailable) {
		lines.push("- Interactive clarification and approval requests from this delegated session do not reach the top-level user directly.");
		lines.push(`- If you need the parent agent to ask the user a question or request broader approval, use ${PARENT_ESCALATION_TOOL_NAME}.`);
		lines.push(`- After calling ${PARENT_ESCALATION_TOOL_NAME}, stop and let the parent agent continue.`);
	}

	if (depthLimitReached) {
		lines.push("- The subagent tool is disabled in this session because the maximum delegation depth has already been reached.");
		lines.push("- Handle the remaining work directly in this session.");
		if (parentEscalationAvailable) {
			lines.push(`- If deeper orchestration is required, use ${PARENT_ESCALATION_TOOL_NAME} instead of attempting further delegation.`);
		}
		lines.push("- After any subagent run, you must reconcile, de-duplicate, and merge the results into one final answer.");
		return lines.join("\n");
	}

	if (mode === "off") {
		lines.push("- The subagent tool is disabled completely. Do not use it.");
		lines.push("- Handle all work directly unless the user explicitly asks how to re-enable subagents.");
	} else if (mode === "manual") {
		lines.push("- Only use the subagent tool when the user explicitly asks for sub-agents, delegation, multiple agents, or a named subagent.");
		lines.push("- Otherwise do the work yourself.");
	} else if (mode === "ask") {
		lines.push("- If the user explicitly asks for sub-agents, delegation, multiple agents, or a named subagent, you may use the subagent tool.");
		if (sessionApproval) {
			lines.push("- This session already has user approval for non-explicit subagent use in ask mode.");
			lines.push("- You may use the subagent tool in this session without asking again when delegation is genuinely helpful.");
		} else {
			lines.push("- If the user did not explicitly ask for subagents, prefer doing the work yourself.");
		}
		lines.push("- Do not use subagent for ordinary PR reviews, small diffs, or simple tasks; review directly and optionally mention subagents as an option.");
		if (!sessionApproval) {
			lines.push(
				hasUI
					? "- If you call subagent without an explicit user request, the user will be asked to approve it first."
					: "- If you call subagent without an explicit user request, it will be blocked because no approval UI is available.",
			);
		}
	} else {
		lines.push("- You may use subagent autonomously only for clearly decomposable, mostly read-only, multi-surface work.");
		lines.push(`- Non-explicit auto delegation is limited to at most ${AUTO_MODE_MAX_NON_EXPLICIT_AGENTS} agents.`);
		if (!AUTO_MODE_ALLOW_WRITE_CAPABLE_AGENTS) {
			lines.push("- Do not auto-use write-capable subagents such as worker unless the user explicitly asked for delegation.");
		}
		lines.push("- Do not auto-use subagent for ordinary PR reviews, small diffs, or simple tasks; do those directly unless the user asks.");
		lines.push(
			hasUI
				? "- Requests outside these guardrails will require user approval."
				: "- Requests outside these guardrails will be blocked because no approval UI is available.",
		);
	}

	lines.push("- After any subagent run, you must reconcile, de-duplicate, and merge the results into one final answer.");
	return lines.join("\n");
}

function evaluateSubagentPolicy(
	mode: SubagentPolicyMode,
	summary: SubagentRequestSummary,
	explicitRequest: boolean,
	latestUserPrompt: string,
	hasUI: boolean,
	inheritedApprovalScope: DelegationApprovalScope,
	sessionApproval: boolean,
): SubagentPolicyDecision {
	if (mode === "off") {
		return {
			action: "block",
			reason: "Blocked by subagent policy: off mode disables subagents completely.",
		};
	}

	if (inheritedApprovalScope === "all") {
		return {
			action: "allow",
			reason: "This session inherits broad user approval for nested subagent use from an ancestor session.",
		};
	}

	if (inheritedApprovalScope === "read-only") {
		const violation = getReadOnlyScopeViolation(summary);
		if (!violation) {
			return {
				action: "allow",
				reason: "This session inherits read-only approval for nested subagent use from an ancestor session.",
			};
		}
		return hasUI
			? {
					action: "ask",
					reason: `Nested delegation exceeds inherited read-only approval (${violation}).`,
				}
			: {
					action: "block",
					reason: `Blocked by inherited subagent approval scope: this delegated session only has read-only nested delegation approval (${violation}), and no approval UI is available. Ask the parent agent to request broader approval instead.`,
				};
	}

	if (explicitRequest) {
		return { action: "allow", reason: "User explicitly requested subagents." };
	}

	if (mode === "ask" && sessionApproval) {
		return {
			action: "allow",
			reason: "This session already has user approval for non-explicit subagent use in ask mode.",
		};
	}

	if (mode === "manual") {
		return {
			action: "block",
			reason: "Blocked by subagent policy: manual mode only allows subagents when the user explicitly asks for them.",
		};
	}

	if (mode === "ask") {
		if (!hasUI) {
			return {
				action: "block",
				reason: "Blocked by subagent policy: ask mode requires user confirmation for non-explicit subagent use, and no UI is available.",
			};
		}
		return {
			action: "ask",
			reason: "The user did not explicitly request subagents.",
		};
	}

	if (looksLikeOrdinaryPrReview(latestUserPrompt, explicitRequest)) {
		return hasUI
			? {
					action: "ask",
					reason: "Ordinary PR reviews should be handled directly unless the user asks for subagents.",
				}
			: {
					action: "block",
					reason: "Blocked by subagent policy: ordinary PR reviews are not auto-delegated without approval, and no UI is available.",
				};
	}
	if (summary.requestMode === "single") {
		return hasUI
			? {
					action: "ask",
					reason: "Single-agent delegation is not auto-approved without an explicit user request.",
				}
			: {
					action: "block",
					reason: "Blocked by subagent policy: single-agent delegation without an explicit request requires approval, and no UI is available.",
				};
	}
	if (summary.taskCount > AUTO_MODE_MAX_NON_EXPLICIT_AGENTS) {
		return hasUI
			? {
					action: "ask",
					reason: `Auto mode only auto-approves up to ${AUTO_MODE_MAX_NON_EXPLICIT_AGENTS} non-explicit agents at once.`,
				}
			: {
					action: "block",
					reason: `Blocked by subagent policy: auto mode only auto-approves up to ${AUTO_MODE_MAX_NON_EXPLICIT_AGENTS} non-explicit agents at once, and no UI is available.`,
				};
	}
	if (!AUTO_MODE_ALLOW_WRITE_CAPABLE_AGENTS && summary.writeCapableAgents.length > 0) {
		const agents = summary.writeCapableAgents.join(", ");
		return hasUI
			? {
					action: "ask",
					reason: `Write-capable agents require approval unless the user explicitly asked for delegation (${agents}).`,
				}
			: {
					action: "block",
					reason: `Blocked by subagent policy: write-capable agents require approval unless the user explicitly asked for delegation (${agents}), and no UI is available.`,
				};
	}
	return {
		action: "allow",
		reason: "Auto mode guardrails passed for non-explicit read-only multi-agent delegation.",
	};
}

function buildApprovalPrompt(
	mode: SubagentPolicyMode,
	summary: SubagentRequestSummary,
	reason: string,
	latestUserPrompt: string,
	explicitRequest: boolean,
): string {
	const taskLines = summary.requestedTasks
		.slice(0, 6)
		.map((task, index) => `${index + 1}. ${formatRequestedTaskTarget(task)}: ${trimPreview(task.task, 110)}`);
	if (summary.requestedTasks.length > taskLines.length) {
		taskLines.push(`... +${summary.requestedTasks.length - taskLines.length} more task(s)`);
	}

	const lines = [
		`Policy mode: ${formatSubagentPolicyMode(mode)}`,
		explicitRequest
			? "User intent: explicit subagent/delegation request detected"
			: "User intent: no explicit subagent/delegation request detected",
		`Request: ${summary.requestMode} (${summary.taskCount} ${summary.taskCount === 1 ? "task" : "tasks"})`,
		`Agents: ${summary.requestedAgents.join(", ") || "(none)"}`,
		summary.projectAgents.length > 0 ? `Project-local agents: ${summary.projectAgents.join(", ")}` : undefined,
		summary.writeCapableAgents.length > 0
			? `Write-capable agents: ${summary.writeCapableAgents.join(", ")}`
			: "Write-capable agents: none detected",
		summary.unknownAgents.length > 0 ? `Unknown agents: ${summary.unknownAgents.join(", ")}` : undefined,
		`Reason: ${reason}`,
		mode === "ask"
			? `Approval options: ${APPROVAL_OPTION_ALLOW_ONCE} / ${APPROVAL_OPTION_ALLOW_SESSION} / ${APPROVAL_OPTION_DENY}`
			: `Approval options: ${APPROVAL_OPTION_ALLOW_ONCE} / ${APPROVAL_OPTION_DENY}`,
		`Latest user prompt: ${trimPreview(latestUserPrompt || "(unavailable)", 180)}`,
		"",
		"Planned tasks:",
		...taskLines,
	].filter((line): line is string => Boolean(line));

	return lines.join("\n");
}

function getRequestedProjectAgents(
	params: Record<string, any>,
	resolveDiscoveryForCwd: (requestedCwd: string | undefined) => AgentDiscoveryResult,
): Array<{ name: string; dir: string | null }> {
	const requested = new Map<string, { name: string; dir: string | null }>();
	for (const task of getRequestedTasks(params)) {
		const discovery = resolveDiscoveryForCwd(task.cwd);
		const agent = discovery.agents.find((candidate) => candidate.name === task.agent);
		if (agent?.source !== "project") continue;
		const dir = discovery.projectAgentsDir ?? path.dirname(agent.filePath);
		requested.set(`${agent.name}\0${dir}`, { name: agent.name, dir });
	}
	return Array.from(requested.values());
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		turns?: number;
	},
	model?: string,
): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) {
		parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	}
	if (model) parts.push(model);
	return parts.join(" ");
}

function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: any, text: string) => string,
): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};

	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				text += themeFg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath));
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "find ") + themeFg("accent", pattern) + themeFg("dim", ` in ${shortenPath(rawPath)}`);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		case "subagent": {
			const label = getSubagentCallLabelFromUx(args).replace(/^subagent\s*/, "");
			return themeFg("muted", "subagent ") + themeFg("accent", label || "delegation");
		}
		case PARENT_ESCALATION_TOOL_NAME: {
			const question = ((args.question as string) || "ask parent")
				.replace(/\s+/g, " ")
				.trim();
			const preview = question.length > 60 ? `${question.slice(0, 60)}...` : question;
			return themeFg("muted", `${PARENT_ESCALATION_TOOL_NAME} `) + themeFg("accent", preview || "ask parent");
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

interface SingleResult {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	parentEscalations: ParentEscalationDetails[];
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
}

interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
	parentEscalationResolutions?: ParentEscalationResolution[];
}

function parseSubagentDetails(value: unknown): SubagentDetails | null {
	if (!isRecord(value)) return null;
	const mode = value.mode === "parallel" || value.mode === "chain" || value.mode === "single" ? value.mode : null;
	if (!mode || !Array.isArray(value.results)) return null;
	const agentScope: AgentScope = value.agentScope === "project" || value.agentScope === "both" ? value.agentScope : "user";
	const resolutions = Array.isArray(value.parentEscalationResolutions)
		? (value.parentEscalationResolutions.filter(isRecord) as ParentEscalationResolution[])
		: undefined;
	return {
		mode,
		agentScope,
		projectAgentsDir: typeof value.projectAgentsDir === "string" ? value.projectAgentsDir : null,
		results: value.results.filter(isRecord) as SingleResult[],
		...(resolutions && resolutions.length > 0 ? { parentEscalationResolutions: resolutions } : {}),
	};
}

function getActiveSubagentRelativeDepthFromResult(result: unknown): number {
	if (!isRecord(result)) return 1;
	const details = parseSubagentDetails(result.details);
	return details ? getMaxSubagentRelativeDepthFromUx(details) : 1;
}

function setActiveSubagentRelativeDepth(toolCallId: string, relativeDepth: number): boolean {
	const normalizedDepth = Math.max(1, Math.floor(relativeDepth));
	if (activeSubagentRelativeDepthByToolCallId.get(toolCallId) === normalizedDepth) return false;
	activeSubagentRelativeDepthByToolCallId.set(toolCallId, normalizedDepth);
	return true;
}

function clearActiveSubagentRelativeDepth(toolCallId: string): boolean {
	return activeSubagentRelativeDepthByToolCallId.delete(toolCallId);
}

function getDisplayedSubagentDepth(): number {
	let activeRelativeDepth = 0;
	for (const relativeDepth of activeSubagentRelativeDepthByToolCallId.values()) {
		activeRelativeDepth = Math.max(activeRelativeDepth, relativeDepth);
	}
	return getCurrentSubagentDepth() + activeRelativeDepth;
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
		const messages = Array.isArray(result.messages) ? (result.messages as Message[]) : [];
		for (const message of messages) {
			for (const escalation of getParentEscalationsFromMessage(message)) {
				addForResult(escalation);
			}
		}
	}
	return escalations;
}

function getParentEscalationsFromMessage(message: Message): ParentEscalationDetails[] {
	const directEscalation = getParentEscalationFromMessage(message);
	if (directEscalation) return [directEscalation];
	if (isRecord(message) && message.role === "toolResult" && message.toolName === "subagent") {
		return getParentEscalationsFromSubagentDetails(message.details);
	}
	return [];
}

function getAssistantText(message: Message): string {
	if (!Array.isArray(message.content)) return "";
	return message.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof (part as any).text === "string")
		.map((part) => part.text)
		.join("");
}

function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant") continue;
		const text = getAssistantText(msg);
		if (text) return text;
	}
	return "";
}

function getFailureDiagnosticOutput(result: SingleResult): string {
	return getFailureDiagnosticOutputForState({
		errorMessage: result.errorMessage,
		stderr: result.stderr,
	});
}

function getResultOutput(result: SingleResult): string {
	return getResultOutputForState({
		exitCode: result.exitCode,
		stopReason: result.stopReason,
		errorMessage: result.errorMessage,
		stderr: result.stderr,
		finalOutput: getFinalOutput(result.messages),
	});
}

function getFailureFallbackOutput(result: SingleResult, finalOutput = ""): string {
	if (!isFailedResult(result)) return "";
	const output = getResultOutput(result);
	if (!output || output === "(no output)" || output === finalOutput) return "";
	return output;
}

function hasParentEscalations(result: SingleResult): boolean {
	return Array.isArray(result.parentEscalations) && result.parentEscalations.length > 0;
}

function formatEscalationOptions(options: EscalationOption[], allowCustom: boolean): string[] {
	const lines = options.map((option, index) => {
		const suffix = option.description ? ` — ${option.description}` : "";
		return `${index + 1}. ${option.label}${suffix}`;
	});
	if (allowCustom) lines.push(`${options.length + 1}. Custom instructions`);
	return lines;
}

interface ParentEscalationOccurrence {
	occurrenceIndex: number;
	result: SingleResult;
	escalation: ParentEscalationDetails;
}

function getParentEscalationOccurrences(results: SingleResult[]): ParentEscalationOccurrence[] {
	const occurrences: ParentEscalationOccurrence[] = [];
	for (const result of results) {
		const escalations = Array.isArray(result.parentEscalations) ? result.parentEscalations : [];
		for (const escalation of escalations) {
			occurrences.push({ occurrenceIndex: occurrences.length, result, escalation });
		}
	}
	return occurrences;
}

function buildEscalationChoiceLabel(index: number, label: string): string {
	return `${index + 1}. ${label}`;
}

function buildParentClarifyTitle(occurrence: ParentEscalationOccurrence): string {
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

function formatParentEscalationResolution(resolution: ParentEscalationResolution): string {
	if (resolution.answerType === "cancelled") return "User cancelled the top-level clarification.";
	if (resolution.answerType === "custom") return `User provided custom instructions: ${resolution.answer ?? ""}`;
	const prefix = resolution.selectedIndex ? `${resolution.selectedIndex}. ` : "";
	return `User selected: ${prefix}${resolution.answer ?? ""}`;
}

async function askParentClarification(
	ctx: ExtensionContext,
	occurrence: ParentEscalationOccurrence,
): Promise<ParentEscalationResolution | null> {
	if (!ctx.hasUI || occurrence.escalation.requestType !== "clarify") return null;
	const { result, escalation, occurrenceIndex } = occurrence;
	if (escalation.options.length === 0 && !escalation.allowCustom) return null;

	const base: Omit<ParentEscalationResolution, "answer" | "answerType" | "selectedIndex"> = {
		occurrenceIndex,
		agent: result.agent,
		task: result.task,
		escalation,
	};

	if (escalation.options.length === 0) {
		const customAnswer = await ctx.ui.editor(buildParentClarifyTitle(occurrence), escalation.customPrompt ?? "");
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
	const selected = await ctx.ui.select(buildParentClarifyTitle(occurrence), selectOptions);

	if (selected === undefined) {
		return {
			...base,
			answer: null,
			answerType: "cancelled",
		};
	}

	if (selected === customChoiceLabel) {
		const customAnswer = await ctx.ui.editor(`Custom instructions\n\n${buildParentClarifyTitle(occurrence)}`, escalation.customPrompt ?? "");
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

async function resolveInteractiveParentClarifications(
	ctx: ExtensionContext,
	results: SingleResult[],
): Promise<ParentEscalationResolution[]> {
	if (!ctx.hasUI) return [];
	const resolutions: ParentEscalationResolution[] = [];
	for (const occurrence of getParentEscalationOccurrences(results)) {
		const resolution = await askParentClarification(ctx, occurrence);
		if (resolution) resolutions.push(resolution);
	}
	return resolutions;
}

function formatParentEscalationSummary(
	results: SingleResult[],
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

type DisplayItem =
	| { type: "text"; text: string }
	| { type: "toolCall"; id?: string; name: string; args: Record<string, any> };

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
		for (const part of msg.content) {
			if (part.type === "text") items.push({ type: "text", text: part.text });
			else if (part.type === "toolCall") {
				items.push({ type: "toolCall", id: part.id, name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

type ActivityStatus = "running" | "done" | "failed" | "escalated" | "waiting on parent/user";

type ThemeFg = (color: any, text: string) => string;

interface ActivityNode {
	label: string;
	status: ActivityStatus;
	task?: string;
	children: ActivityNode[];
}

function getResultActivityStatus(result: SingleResult): ActivityStatus {
	if (hasParentEscalations(result)) return "waiting on parent/user";
	if (isRunningResult(result)) return "running";
	if (isFailedResult(result)) return "failed";
	return "done";
}

function getAggregateActivityStatus(results: SingleResult[]): ActivityStatus {
	if (results.some(hasParentEscalations)) return "waiting on parent/user";
	if (results.some((result) => isRunningResult(result))) return "running";
	if (results.some((result) => isFailedResult(result))) return "failed";
	return "done";
}

function getSubagentRootLabel(details: SubagentDetails): string {
	if (details.mode === "single") {
		const agent = details.results.length === 1 ? details.results[0].agent : "single";
		return `subagent ${agent}`;
	}
	if (details.mode === "chain") return `subagent chain (${details.results.length} step${details.results.length === 1 ? "" : "s"})`;
	return `subagent parallel (${details.results.length} task${details.results.length === 1 ? "" : "s"})`;
}

function getSubagentCallLabel(args: Record<string, any>): string {
	if (Array.isArray(args.chain) && args.chain.length > 0) return `subagent chain (${args.chain.length} step${args.chain.length === 1 ? "" : "s"})`;
	if (Array.isArray(args.tasks) && args.tasks.length > 0) return `subagent parallel (${args.tasks.length} task${args.tasks.length === 1 ? "" : "s"})`;
	if (typeof args.agent === "string" && args.agent.trim()) return `subagent ${args.agent.trim()}`;
	return "subagent";
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

function getToolResultsByCallId(messages: Message[]): Map<string, ToolResultMessage> {
	const toolResults = new Map<string, ToolResultMessage>();
	for (const message of messages) {
		if (message.role !== "toolResult" || typeof message.toolCallId !== "string") continue;
		toolResults.set(message.toolCallId, message);
	}
	return toolResults;
}

function getErrorCode(error: unknown): string | undefined {
	return isRecord(error) && typeof (error as { code?: unknown }).code === "string"
		? (error as { code: string }).code
		: undefined;
}

function buildResultActivityNode(result: SingleResult): ActivityNode {
	const agent = typeof result.agent === "string" && result.agent ? result.agent : "unknown";
	const label = result.step ? `step ${result.step}: ${agent}` : agent;
	return {
		label,
		status: getResultActivityStatus(result),
		task: typeof result.task === "string" ? result.task : undefined,
		children: buildNestedActivityNodes(Array.isArray(result.messages) ? result.messages : []),
	};
}

function buildNestedActivityNodes(messages: Message[]): ActivityNode[] {
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
					label: getSubagentCallLabel(part.arguments),
					status,
					children: nestedDetails
						? nestedDetails.results.map(buildResultActivityNode)
						: buildRequestedTaskActivityNodes(part.arguments),
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

function formatSubagentActivityTree(details: SubagentDetails, themeFg: ThemeFg): string {
	const root: ActivityNode = {
		label: getSubagentRootLabel(details),
		status: getAggregateActivityStatus(details.results),
		children: details.results.map(buildResultActivityNode),
	};
	return renderActivityNode(root, themeFg, "", true, true).join("\n");
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

async function writePromptToTempFile(agentName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	await withFileMutationQueue(filePath, async () => {
		await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	});
	return { dir: tmpDir, filePath };
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

async function runSingleAgent(
	defaultCwd: string,
	agents: AgentConfig[],
	request: RequestedTask,
	step: number | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	workflowModelLock: WorkflowModelLock,
	executionSettings: LoadedSubagentExecutionSettings,
	inheritSubagentApprovalScope: DelegationApprovalScope,
	makeDetails: (results: SingleResult[]) => SubagentDetails,
): Promise<SingleResult> {
	const agentName = request.agent;
	const task = request.task;
	const cwd = request.cwd;
	const agent = agents.find((a) => a.name === agentName);

	if (!agent) {
		const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
		return {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
			parentEscalations: [],
			step,
		};
	}

	const effectiveModelSelection = resolveEffectiveSubagentModelSelection(
		request,
		agent,
		executionSettings,
		workflowModelLock,
	);
	const args: string[] = ["--mode", "json", "-p", "--no-session"];
	if (effectiveModelSelection.model) args.push("--model", effectiveModelSelection.model);
	if (effectiveModelSelection.thinking) args.push("--thinking", effectiveModelSelection.thinking);
	if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;

	const currentResult: SingleResult = {
		agent: agentName,
		agentSource: agent.source,
		task,
		exitCode: -1,
		messages: [],
		stderr: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		parentEscalations: [],
		model: effectiveModelSelection.model,
		step,
	};

	const emitUpdate = () => {
		if (onUpdate) {
			onUpdate({
				content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(running...)" }],
				details: makeDetails([currentResult]),
			});
		}
	};

	try {
		if (agent.systemPrompt.trim()) {
			const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
			tmpPromptDir = tmp.dir;
			tmpPromptPath = tmp.filePath;
			args.push("--append-system-prompt", tmpPromptPath);
		}

		const promptInput = `Task: ${task}`;
		const executionCwd = resolveExecutionCwd(defaultCwd, cwd);
		let wasAborted = false;
		const childDepth = getCurrentSubagentDepth() + 1;
		const childEnv: NodeJS.ProcessEnv = {
			...process.env,
			[SUBAGENT_DEPTH_ENV]: String(childDepth),
			[SUBAGENT_INHERITED_APPROVAL_ENV]: inheritSubagentApprovalScope !== "none" ? "1" : "0",
			[SUBAGENT_INHERITED_APPROVAL_SCOPE_ENV]: inheritSubagentApprovalScope,
			[SUBAGENT_PARENT_ESCALATION_ENV]: "1",
		};
		if (workflowModelLock.model) childEnv[SUBAGENT_WORKFLOW_MODEL_ENV] = workflowModelLock.model;
		else delete childEnv[SUBAGENT_WORKFLOW_MODEL_ENV];
		if (workflowModelLock.thinking) childEnv[SUBAGENT_WORKFLOW_THINKING_ENV] = workflowModelLock.thinking;
		else delete childEnv[SUBAGENT_WORKFLOW_THINKING_ENV];

		const exitCode = await new Promise<number>((resolve) => {
			const invocation = getPiInvocation(args);
			let buffer = "";
			let closed = false;
			let settled = false;
			let killTimer: ReturnType<typeof setTimeout> | undefined;
			let abortHandler: (() => void) | undefined;

			const formatProcessError = (prefix: string, error: unknown) => {
				const message = error instanceof Error ? error.message : String(error);
				const code = getErrorCode(error);
				return `${prefix}${code ? ` (${code})` : ""}: ${message}`;
			};
			const appendDiagnostic = (text: string) => {
				if (!text) return;
				currentResult.stderr += currentResult.stderr && !currentResult.stderr.endsWith("\n") ? `\n${text}` : text;
			};
			const cleanup = () => {
				if (killTimer) clearTimeout(killTimer);
				if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
			};
			const finish = (code: number) => {
				if (settled) return;
				settled = true;
				cleanup();
				resolve(code);
			};

			const seenToolResultCallIds = new Set<string>();
			const appendMessage = (msg: Message) => {
				let replacementIndex = -1;
				if (isRecord(msg) && msg.role === "toolResult") {
					const toolCallId = typeof msg.toolCallId === "string" ? msg.toolCallId : undefined;
					if (toolCallId && seenToolResultCallIds.has(toolCallId)) return;
					if (toolCallId) {
						replacementIndex = currentResult.messages.findIndex(
							(message) => isRecord(message) && message.role === "toolResult" && message.toolCallId === toolCallId,
						);
						seenToolResultCallIds.add(toolCallId);
					}
				}
				for (const escalation of getParentEscalationsFromMessageFromUx(msg)) {
					currentResult.parentEscalations.push(escalation);
				}
				if (replacementIndex >= 0) currentResult.messages[replacementIndex] = msg;
				else currentResult.messages.push(msg);
			};

			const upsertPartialToolResult = (toolCallId: string, toolName: string, partialResult: unknown) => {
				if (!toolCallId || seenToolResultCallIds.has(toolCallId) || !isRecord(partialResult)) return;
				const partialMessage = {
					role: "toolResult" as const,
					toolCallId,
					toolName,
					content: Array.isArray(partialResult.content) ? partialResult.content : [],
					details: partialResult.details,
					isError: Boolean(partialResult.isError),
					timestamp: Date.now(),
				} as Message;
				const existingIndex = currentResult.messages.findIndex(
					(message) =>
						isRecord(message) &&
						message.role === "toolResult" &&
						message.toolCallId === toolCallId &&
						!seenToolResultCallIds.has(toolCallId),
				);
				if (existingIndex >= 0) currentResult.messages[existingIndex] = partialMessage;
				else currentResult.messages.push(partialMessage);
			};

			const processLine = (line: string) => {
				if (!line.trim()) return;
				let event: any;
				try {
					event = JSON.parse(line);
				} catch {
					return;
				}

				if (event.type === "message_end" && event.message) {
					const msg = event.message as Message;
					appendMessage(msg);

					if (msg.role === "assistant") {
						currentResult.usage.turns++;
						const usage = msg.usage;
						if (usage) {
							currentResult.usage.input += usage.input || 0;
							currentResult.usage.output += usage.output || 0;
							currentResult.usage.cacheRead += usage.cacheRead || 0;
							currentResult.usage.cacheWrite += usage.cacheWrite || 0;
							currentResult.usage.cost += usage.cost?.total || 0;
							currentResult.usage.contextTokens = usage.totalTokens || 0;
						}
						if (msg.model) currentResult.model = msg.model;
						if (msg.stopReason) currentResult.stopReason = msg.stopReason;
						if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
					}
					emitUpdate();
				}

				if (event.type === "tool_execution_update" && event.toolName === "subagent" && event.partialResult) {
					upsertPartialToolResult(event.toolCallId, event.toolName, event.partialResult);
					emitUpdate();
				}
			};

			let proc: ChildProcessWithoutNullStreams;
			try {
				proc = spawn(invocation.command, invocation.args, {
					cwd: executionCwd,
					env: childEnv,
					shell: false,
					stdio: ["pipe", "pipe", "pipe"],
				}) as ChildProcessWithoutNullStreams;
			} catch (error) {
				const message = `${formatProcessError("Failed to spawn subagent process", error)} [cwd: ${executionCwd}]`;
				currentResult.stopReason = "error";
				currentResult.errorMessage = message;
				appendDiagnostic(message);
				finish(1);
				return;
			}

			proc.stdout.on("data", (data) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});

			proc.stderr.on("data", (data) => {
				currentResult.stderr += data.toString();
			});

			proc.stdin.on("error", (error) => {
				const code = getErrorCode(error);
				if (!settled && code !== "EPIPE") appendDiagnostic(formatProcessError("Failed to write subagent prompt", error));
			});

			proc.on("close", (code, termSignal) => {
				closed = true;
				if (buffer.trim()) processLine(buffer);
				if (wasAborted) {
					currentResult.stopReason = "aborted";
					const abortMessage = termSignal
						? `Subagent was aborted (terminated by ${termSignal}).`
						: "Subagent was aborted.";
					if (!currentResult.errorMessage || currentResult.errorMessage === "Subagent was aborted.") {
						currentResult.errorMessage = abortMessage;
					}
					finish(1);
					return;
				}
				if (termSignal) {
					currentResult.stopReason = "error";
					currentResult.errorMessage ??= `Subagent terminated by signal ${termSignal}.`;
					finish(1);
					return;
				}
				if (code === null) {
					currentResult.stopReason = "error";
					currentResult.errorMessage ??= "Subagent exited without an exit code.";
					finish(1);
					return;
				}
				finish(code);
			});

			proc.on("error", (error) => {
				closed = true;
				const message = `${formatProcessError("Subagent process error", error)} [cwd: ${executionCwd}]`;
				currentResult.stopReason = "error";
				currentResult.errorMessage = message;
				appendDiagnostic(message);
				finish(1);
			});

			try {
				proc.stdin.end(promptInput, "utf8");
			} catch (error) {
				appendDiagnostic(formatProcessError("Failed to write subagent prompt", error));
			}

			if (signal) {
				abortHandler = () => {
					if (closed || settled) return;
					wasAborted = true;
					currentResult.stopReason = "aborted";
					currentResult.errorMessage ??= "Subagent was aborted.";
					proc.kill("SIGTERM");
					killTimer = setTimeout(() => {
						if (!closed) proc.kill("SIGKILL");
					}, SUBAGENT_TERMINATION_GRACE_MS);
				};
				if (signal.aborted) abortHandler();
				else signal.addEventListener("abort", abortHandler, { once: true });
			}
		});

		currentResult.exitCode = exitCode;
		return currentResult;
	} finally {
		if (tmpPromptPath)
			try {
				fs.unlinkSync(tmpPromptPath);
			} catch {
				/* ignore */
			}
		if (tmpPromptDir)
			try {
				fs.rmdirSync(tmpPromptDir);
			} catch {
				/* ignore */
			}
	}
}

const TaskItem = Type.Object({
	agent: Type.String({
		description: "Name of the agent to invoke. Common built-in agents: scout, planner, planner-readonly, reviewer, reviewer-readonly, worker, consolidator.",
	}),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
	model: Type.Optional(
		Type.String({
			description:
				"Optional model override for this subagent. Accepts the same values as pi --model, such as provider/id or a model alias.",
		}),
	),
	thinking: Type.Optional(
		StringEnum(THINKING_LEVEL_VALUES, {
			description:
				"Optional thinking level override for this subagent. Defaults to the workflow lock unless overridden here or in agent frontmatter.",
		}),
	),
});

const ChainItem = Type.Object({
	agent: Type.String({
		description: "Name of the agent to invoke. Common built-in agents: scout, planner, planner-readonly, reviewer, reviewer-readonly, worker, consolidator.",
	}),
	task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
	model: Type.Optional(
		Type.String({
			description:
				"Optional model override for this step. Accepts the same values as pi --model, such as provider/id or a model alias.",
		}),
	),
	thinking: Type.Optional(
		StringEnum(THINKING_LEVEL_VALUES, {
			description:
				"Optional thinking level override for this step. Defaults to the workflow lock unless overridden here or in agent frontmatter.",
		}),
	),
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description: 'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
	default: "user",
});

const ThinkingLevelSchema = StringEnum(THINKING_LEVEL_VALUES, {
	description:
		"Optional thinking level override. Defaults to the workflow-start thinking level unless overridden here or in agent frontmatter.",
});

const EscalationOptionSchema = Type.Object({
	label: Type.String({
		description: "Short label for the option shown to the parent agent and user.",
	}),
	description: Type.Optional(
		Type.String({
			description: "Optional short explanation of the trade-off or consequence behind this option.",
		}),
	),
});

const ParentEscalationRequestTypeSchema = StringEnum(["clarify", "approval"] as const, {
	description: "Whether the parent should treat this as a clarification request or an approval request.",
	default: "clarify",
});

const ParentEscalationParams = Type.Object({
	requestType: Type.Optional(ParentEscalationRequestTypeSchema),
	question: Type.String({
		description: "Question the parent agent should ask the user before continuing.",
	}),
	options: Type.Optional(
		Type.Array(EscalationOptionSchema, {
			description: "Optional distinct choices the parent agent can present to the user.",
		}),
	),
	allowCustom: Type.Optional(
		Type.Boolean({
			description: "Allow custom instructions in addition to listed options. Defaults to true.",
			default: true,
		}),
	),
	customPrompt: Type.Optional(
		Type.String({
			description: "Optional prefilled text for custom instructions.",
		}),
	),
	reason: Type.Optional(
		Type.String({
			description: "Brief context on why the delegated task is blocked or why the question matters.",
		}),
	),
});

const SubagentParams = Type.Object({
	agent: Type.Optional(
		Type.String({
			description: "Name of the agent to invoke for single mode. Common built-in agents: scout, planner, planner-readonly, reviewer, reviewer-readonly, worker, consolidator.",
		}),
	),
	task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
	model: Type.Optional(
		Type.String({
			description:
				"Optional model override for single mode. Accepts the same values as pi --model, such as provider/id or a model alias.",
		}),
	),
	thinking: Type.Optional(ThinkingLevelSchema),
	tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })),
	chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution" })),
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({ description: "Prompt before running project-local agents. Default: true.", default: true }),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
});

export default function (pi: ExtensionAPI) {
	let policyState = loadSubagentPolicyState();
	const delegatedApprovalByToolCallId = new Map<string, DelegationApprovalScope>();

	function getDelegatedApprovalScope(
		explicitRequest: boolean,
		inheritedScope: DelegationApprovalScope,
		sessionApproval: boolean,
	): DelegationApprovalScope {
		if (inheritedScope !== "none") return inheritedScope;
		if (explicitRequest) return "read-only";
		if (policyState.mode === "ask" && sessionApproval) return "read-only";
		return "none";
	}

	function syncSubagentSessionState(
		ctx: ExtensionContext,
		executionSettings: LoadedSubagentExecutionSettings = loadSubagentExecutionSettings(ctx.cwd, {
			projectTrusted: ctx.isProjectTrusted(),
		}),
	): LoadedSubagentExecutionSettings {
		setSubagentToolEnabled(pi, canUseSubagentToolInSession(policyState.mode, executionSettings));
		updateSubagentStatus(ctx, policyState.mode, hasSessionSubagentApproval(ctx), executionSettings);
		return executionSettings;
	}

	function refreshSubagentFooter(ctx: ExtensionContext): void {
		updateSubagentStatus(
			ctx,
			policyState.mode,
			hasSessionSubagentApproval(ctx),
			loadSubagentExecutionSettings(ctx.cwd, { projectTrusted: ctx.isProjectTrusted() }),
		);
	}

	function markSubagentExecutionActive(toolCallId: string, ctx: ExtensionContext): void {
		if (setActiveSubagentRelativeDepth(toolCallId, 1)) {
			refreshSubagentFooter(ctx);
		}
	}

	function parseRequestedLimit(raw: string, hardMax: number): number | undefined {
		const normalized = raw.trim();
		if (!/^\d+$/.test(normalized)) return undefined;
		const parsed = Number(normalized);
		if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > hardMax) return undefined;
		return parsed;
	}

	async function setPolicyMode(nextMode: SubagentPolicyMode, ctx: ExtensionContext): Promise<LoadedSubagentExecutionSettings> {
		policyState = { mode: nextMode };
		await saveSubagentPolicyState(policyState);
		return syncSubagentSessionState(ctx);
	}

	async function saveGlobalExecutionSettings(
		ctx: ExtensionContext,
		updates: Partial<SubagentExecutionSettings>,
	): Promise<LoadedSubagentExecutionSettings> {
		const executionSettings = await saveSubagentExecutionSettings(ctx.cwd, updates, "global", {
			projectTrusted: ctx.isProjectTrusted(),
		});
		return syncSubagentSessionState(ctx, executionSettings);
	}

	async function resetGlobalExecutionSettings(
		ctx: ExtensionContext,
		keys: Array<keyof SubagentExecutionSettings>,
	): Promise<LoadedSubagentExecutionSettings> {
		const executionSettings = await resetSubagentExecutionSettings(ctx.cwd, keys, "global", {
			projectTrusted: ctx.isProjectTrusted(),
		});
		return syncSubagentSessionState(ctx, executionSettings);
	}

	async function showSubagentConfigUi(ctx: ExtensionCommandContext): Promise<void> {
		if (!canOpenSubagentConfigUi(ctx)) {
			notifyCommand(
				ctx,
				"Interactive subagent config UI is available only in TUI mode. Use /subagents show, /subagents off|manual|ask|auto, /subagents concurrency <n>|default, or /subagents max-tasks <n>|default.",
				"warning",
			);
			return;
		}

		let executionSettings = loadSubagentExecutionSettings(ctx.cwd, { projectTrusted: ctx.isProjectTrusted() });

		await ctx.ui.custom((tui, theme, _kb, done) => {
			const container = new Container();
			const title = new Text(theme.fg("accent", theme.bold("Subagent Configuration")), 1, 0);
			const effectiveText = new Text("", 1, 0);
			const noteText = new Text("", 1, 0);
			const warningText = new Text("", 1, 0);
			const footerText = new Text(
				theme.fg(
					"dim",
					"Use /subagents concurrency <n>|default or /subagents max-tasks <n>|default for exact values. maxDelegationDepth, inheritedApprovalScopes, and agentDefaults are manual settings.json keys.",
				),
				1,
				0,
			);
			container.addChild(title);
			container.addChild(effectiveText);
			container.addChild(noteText);
			container.addChild(warningText);

			const items: SettingItem[] = [
				{
					id: "mode",
					label: "Mode",
					currentValue: policyState.mode,
					values: ["off", "manual", "ask", "auto"],
				},
				{
					id: "maxConcurrency",
					label: "Max concurrent subagents",
					currentValue: String(executionSettings.limits.maxConcurrency),
					values: buildSelectableValues(COMMON_CONCURRENCY_CHOICES, executionSettings.limits.maxConcurrency),
				},
				{
					id: "maxParallelTasks",
					label: "Max parallel tasks per call",
					currentValue: String(executionSettings.limits.maxParallelTasks),
					values: buildSelectableValues(COMMON_MAX_TASK_CHOICES, executionSettings.limits.maxParallelTasks),
				},
			];

			let settingsList!: SettingsList;
			const syncUi = () => {
				settingsList.updateValue("mode", policyState.mode);
				settingsList.updateValue("maxConcurrency", String(executionSettings.limits.maxConcurrency));
				settingsList.updateValue("maxParallelTasks", String(executionSettings.limits.maxParallelTasks));
				effectiveText.setText(
					theme.fg(
						"muted",
						`Effective limits: concurrency ${executionSettings.limits.maxConcurrency} (${formatSubagentSettingsSource(executionSettings.sources.maxConcurrency)}) • tasks ${executionSettings.limits.maxParallelTasks} (${formatSubagentSettingsSource(executionSettings.sources.maxParallelTasks)}) • depth ${formatMaxDelegationDepth(executionSettings.limits.maxDelegationDepth)} (${formatSubagentSettingsSource(executionSettings.sources.maxDelegationDepth)})`,
					),
				);
				noteText.setText(
					hasProjectLimitOverride(executionSettings)
						? theme.fg("warning", "Project .pi/settings.json overrides one or more current limit values. UI saves global defaults only.")
						: theme.fg(
								"dim",
								"Mode saves to ~/.pi/agent/subagent-policy.json. Concurrency/max-tasks overrides save to ~/.pi/agent/settings.json. maxDelegationDepth, inheritedApprovalScopes, and agentDefaults remain manual settings.json keys.",
							),
				);
				warningText.setText(
					executionSettings.warnings.length > 0 ? theme.fg("warning", executionSettings.warnings.join("\n")) : "",
				);
				updateSubagentStatus(ctx, policyState.mode, hasSessionSubagentApproval(ctx), executionSettings);
				tui.requestRender();
			};

			const restoreEffectiveSettings = () => {
				executionSettings = loadSubagentExecutionSettings(ctx.cwd, { projectTrusted: ctx.isProjectTrusted() });
				syncUi();
			};

			settingsList = new SettingsList(
				items,
				Math.min(items.length + 4, 14),
				getSettingsListTheme(),
				(id, newValue) => {
					void (async () => {
						if (id === "mode") {
							const nextMode = normalizeSubagentPolicyMode(newValue);
							if (!nextMode) {
								restoreEffectiveSettings();
								return;
							}
							executionSettings = await setPolicyMode(nextMode, ctx);
							syncUi();
							return;
						}

						if (id !== "maxConcurrency" && id !== "maxParallelTasks") {
							restoreEffectiveSettings();
							return;
						}

						const requested = Number(newValue);
						executionSettings = await saveGlobalExecutionSettings(
							ctx,
							id === "maxConcurrency"
								? { maxConcurrency: requested }
								: { maxParallelTasks: requested },
						);
						if (
							(id === "maxConcurrency" && executionSettings.limits.maxConcurrency !== requested) ||
							(id === "maxParallelTasks" && executionSettings.limits.maxParallelTasks !== requested)
						) {
							ctx.ui.notify(
								hasProjectLimitOverride(executionSettings)
									? "Saved to ~/.pi/agent/settings.json, but the current project still overrides the effective limit via .pi/settings.json."
									: "Saved, but the effective value is currently constrained by the other subagent limit.",
								"warning",
							);
						}
						syncUi();
					})().catch((error) => {
						restoreEffectiveSettings();
						ctx.ui.notify(
							`Failed to save subagent configuration: ${error instanceof Error ? error.message : String(error)}`,
							"error",
						);
					});
				},
				() => done(undefined),
				{ enableSearch: true },
			);

			container.addChild(settingsList);
			container.addChild(footerText);
			syncUi();

			return {
				render(width: number) {
					return container.render(width);
				},
				invalidate() {
					container.invalidate();
				},
				handleInput(data: string) {
					settingsList.handleInput?.(data);
					tui.requestRender();
				},
			};
		});
	}

	pi.registerTool({
		name: PARENT_ESCALATION_TOOL_NAME,
		label: "Escalate to Parent",
		description:
			"Request that the parent agent obtain user clarification or approval before this delegated subagent continues.",
		promptSnippet:
			"Use escalate_to_parent only from delegated subagents when you need the parent agent to ask the user a question or request broader approval.",
		promptGuidelines: [
			"Use escalate_to_parent only from delegated subagents. The top-level assistant should ask the user directly instead.",
			"Use escalate_to_parent when you need a user decision, approval, or instruction that cannot be safely assumed inside this delegated session.",
			"Keep the escalate_to_parent question focused and provide a small set of materially different options when possible.",
			"After calling escalate_to_parent, stop and let the parent agent continue.",
		],
		parameters: ParentEscalationParams,
		async execute(_toolCallId, params) {
			if (!hasParentEscalationRelay()) {
				throw new Error(`${PARENT_ESCALATION_TOOL_NAME} is only available inside delegated subagent sessions.`);
			}
			const question = params.question.trim();
			if (!question) {
				throw new Error(`${PARENT_ESCALATION_TOOL_NAME} requires a non-empty question.`);
			}
			const requestType = params.requestType === "approval" ? "approval" : "clarify";
			const options = normalizeEscalationOptions(params.options);
			const allowCustom = params.allowCustom !== false;
			const reason = normalizeText(params.reason);
			const details: ParentEscalationDetails = {
				requestType,
				question,
				options,
				allowCustom,
				customPrompt: typeof params.customPrompt === "string" ? params.customPrompt : undefined,
				reason,
			};
			const lines = [`Escalation sent to parent: ${question}`];
			if (reason) lines.push(`Reason: ${reason}`);
			const optionLines = formatEscalationOptions(options, allowCustom);
			if (optionLines.length > 0) lines.push("Options:", ...optionLines);
			lines.push("Stop here and wait for the parent agent to continue.");
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details,
			};
		},
		renderCall(args, theme) {
			const question = typeof args.question === "string" ? args.question : "Escalate to parent";
			const options = normalizeEscalationOptions(args.options);
			let text = theme.fg("toolTitle", theme.bold(`${PARENT_ESCALATION_TOOL_NAME} `)) + theme.fg("muted", question);
			if (options.length > 0) {
				text += `\n${theme.fg("dim", `Options: ${options.slice(0, 4).map((option, index) => `${index + 1}. ${option.label}`).join(", ")}`)}`;
			}
			return new Text(text, 0, 0);
		},
		renderResult(result, _options, theme) {
			const details = parseParentEscalationDetails(result.details);
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}
			let text = theme.fg("warning", "⇡ ") + theme.fg("accent", details.question);
			if (details.reason) text += `\n${theme.fg("muted", `Reason: ${details.reason}`)}`;
			const optionLines = formatEscalationOptions(details.options, details.allowCustom);
			if (optionLines.length > 0) text += `\n${theme.fg("dim", optionLines.join(" | "))}`;
			return new Text(text, 0, 0);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		policyState = loadSubagentPolicyState();
		activeSubagentRelativeDepthByToolCallId.clear();
		setParentEscalationToolEnabled(pi, hasParentEscalationRelay());
		syncSubagentSessionState(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		syncSubagentSessionState(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!pi.getActiveTools().includes("subagent") && !pi.getActiveTools().includes(PARENT_ESCALATION_TOOL_NAME)) return undefined;
		const executionSettings = loadSubagentExecutionSettings(ctx.cwd, { projectTrusted: ctx.isProjectTrusted() });
		return {
			systemPrompt: `${event.systemPrompt}\n\n${buildSubagentPolicyPrompt(
				policyState.mode,
				ctx.hasUI,
				getInheritedSubagentApprovalScope(),
				hasSessionSubagentApproval(ctx),
				executionSettings,
				hasParentEscalationRelay(),
			)}`,
		};
	});

	pi.on("tool_execution_update", async (event, ctx) => {
		if (event.toolName !== "subagent") return;
		if (setActiveSubagentRelativeDepth(event.toolCallId, getActiveSubagentRelativeDepthFromResult(event.partialResult))) {
			refreshSubagentFooter(ctx);
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName === PARENT_ESCALATION_TOOL_NAME && !hasParentEscalationRelay()) {
			return {
				block: true,
				reason: `${PARENT_ESCALATION_TOOL_NAME} is only available inside delegated subagent sessions.`,
			};
		}
		if (event.toolName !== "subagent" || !isRecord(event.input)) return undefined;

		const requestedScope: AgentScope =
			event.input.agentScope === "project" || event.input.agentScope === "both" ? event.input.agentScope : "user";
		const projectTrusted = ctx.isProjectTrusted();
		const projectAgentTrustBlockReason = getProjectAgentTrustBlockReason(
			requestedScope,
			requestedScope === "user" ? true : projectTrusted,
		);
		if (projectAgentTrustBlockReason) {
			delegatedApprovalByToolCallId.delete(event.toolCallId);
			return { block: true, reason: projectAgentTrustBlockReason };
		}

		const requestedExecutionCwds = getRequestExecutionCwds(ctx.cwd, event.input);
		const executionSettings = loadSubagentExecutionSettingsForCwds(requestedExecutionCwds, ctx.cwd, {
			projectTrusted,
		});
		const currentDepth = getCurrentSubagentDepth();
		if (!canDelegateWithinDepthLimit(currentDepth, executionSettings.limits.maxDelegationDepth)) {
			delegatedApprovalByToolCallId.delete(event.toolCallId);
			return {
				block: true,
				reason: `Blocked by subagent depth policy: current depth ${currentDepth} has reached maxDelegationDepth ${formatMaxDelegationDepth(executionSettings.limits.maxDelegationDepth)}. This session may not spawn more subagents.`,
			};
		}

		const resolveDiscovery = createAgentDiscoveryResolver(ctx.cwd, requestedScope);
		const summary = summarizeSubagentRequestWithResolver(
			event.input,
			(task) => resolveDiscovery(task.cwd).agents,
		);
		const latestUserPrompt = getLatestUserPromptText(ctx);
		const explicitRequest = isExplicitSubagentRequest(latestUserPrompt, summary.requestedAgents);
		const inheritedApprovalScope = getInheritedSubagentApprovalScope();
		const sessionApproval = hasSessionSubagentApproval(ctx);
		const decision = evaluateSubagentPolicy(
			policyState.mode,
			summary,
			explicitRequest,
			latestUserPrompt,
			ctx.hasUI,
			inheritedApprovalScope,
			sessionApproval,
		);
		const delegatedApprovalScope = getDelegatedApprovalScope(explicitRequest, inheritedApprovalScope, sessionApproval);

		if (decision.action === "allow") {
			delegatedApprovalByToolCallId.set(event.toolCallId, delegatedApprovalScope);
			markSubagentExecutionActive(event.toolCallId, ctx);
			return undefined;
		}
		if (decision.action === "block") {
			delegatedApprovalByToolCallId.delete(event.toolCallId);
			return { block: true, reason: decision.reason };
		}
		if (!ctx.hasUI) {
			delegatedApprovalByToolCallId.delete(event.toolCallId);
			return { block: true, reason: decision.reason };
		}

		const choice = await ctx.ui.select(
			buildApprovalPrompt(policyState.mode, summary, decision.reason, latestUserPrompt, explicitRequest),
			policyState.mode === "ask"
				? [APPROVAL_OPTION_ALLOW_ONCE, APPROVAL_OPTION_ALLOW_SESSION, APPROVAL_OPTION_DENY]
				: [APPROVAL_OPTION_ALLOW_ONCE, APPROVAL_OPTION_DENY],
		);
		if (choice === APPROVAL_OPTION_ALLOW_SESSION) {
			persistSessionSubagentApproval(pi, true);
			updateSubagentStatus(ctx, policyState.mode, true);
			delegatedApprovalByToolCallId.set(event.toolCallId, "read-only");
			markSubagentExecutionActive(event.toolCallId, ctx);
			return undefined;
		}
		if (choice !== APPROVAL_OPTION_ALLOW_ONCE) {
			delegatedApprovalByToolCallId.delete(event.toolCallId);
			return { block: true, reason: `Blocked by user: ${decision.reason}` };
		}
		delegatedApprovalByToolCallId.set(event.toolCallId, "read-only");
		markSubagentExecutionActive(event.toolCallId, ctx);
		return undefined;
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		if (event.toolName !== "subagent") return;
		delegatedApprovalByToolCallId.delete(event.toolCallId);
		if (clearActiveSubagentRelativeDepth(event.toolCallId)) {
			refreshSubagentFooter(ctx);
		}
	});

	pi.registerCommand("subagents", {
		description: "Show or configure subagent mode and parallel limits",
		getArgumentCompletions(prefix: string): AutocompleteItem[] | null {
			const normalizedPrefix = prefix.trim().toLowerCase();
			if (normalizedPrefix.startsWith("concurrency ")) {
				const items: AutocompleteItem[] = [
					...COMMON_CONCURRENCY_CHOICES.map((value) => ({
						value: `concurrency ${value}`,
						label: String(value),
						description: `Set max concurrent subagents to ${value}`,
					})),
					{
						value: "concurrency default",
						label: "default",
						description: "Remove the global maxConcurrency override",
					},
				];
				const filtered = items.filter((item) => item.value.startsWith(normalizedPrefix));
				return filtered.length > 0 ? filtered : null;
			}
			if (normalizedPrefix.startsWith("max-tasks ")) {
				const items: AutocompleteItem[] = [
					...COMMON_MAX_TASK_CHOICES.map((value) => ({
						value: `max-tasks ${value}`,
						label: String(value),
						description: `Set max parallel tasks per call to ${value}`,
					})),
					{
						value: "max-tasks default",
						label: "default",
						description: "Remove the global maxParallelTasks override",
					},
				];
				const filtered = items.filter((item) => item.value.startsWith(normalizedPrefix));
				return filtered.length > 0 ? filtered : null;
			}

			const items: AutocompleteItem[] = [
				{ value: "show", label: "show", description: "Show current mode and effective limits" },
				{ value: "ui", label: "ui", description: "Open interactive subagent config" },
				{ value: "off", label: "off", description: "Disable subagents completely" },
				{ value: "manual", label: "manual", description: "Only explicit user requests may use subagents" },
				{ value: "ask", label: "ask", description: "Default: explicit requests run, otherwise ask first" },
				{ value: "auto", label: "auto", description: "Allow autonomous read-only fan-out within guardrails" },
				{
					value: "concurrency",
					label: "concurrency",
					description: `Set max concurrent subagents (1-${SUBAGENT_MAX_CONCURRENCY_LIMIT})`,
				},
				{
					value: "max-tasks",
					label: "max-tasks",
					description: `Set max parallel tasks per call (1-${SUBAGENT_MAX_PARALLEL_TASKS_LIMIT})`,
				},
				{
					value: "reset-limits",
					label: "reset-limits",
					description: "Remove global limit overrides from ~/.pi/agent/settings.json",
				},
				{
					value: "cancel-session-approval",
					label: "cancel-session-approval",
					description: "Stop auto-approving ask-mode subagent requests in this session",
				},
			];
			const filtered = items.filter((item) => item.value.startsWith(normalizedPrefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const raw = args.trim();
			let executionSettings = loadSubagentExecutionSettings(ctx.cwd, { projectTrusted: ctx.isProjectTrusted() });
			const sessionApproval = hasSessionSubagentApproval(ctx);

			if (!raw || raw === "show") {
				updateSubagentStatus(ctx, policyState.mode, sessionApproval, executionSettings);
				notifyCommand(ctx, buildSubagentSummaryText(policyState.mode, sessionApproval, executionSettings));
				return;
			}

			if (raw === "help") {
				notifyCommand(ctx, buildSubagentUsageText());
				return;
			}

			if (raw === "ui") {
				if (!canOpenSubagentConfigUi(ctx)) {
					notifyCommand(
						ctx,
						"Interactive subagent config UI is available only in TUI mode. Use /subagents show, /subagents off|manual|ask|auto, /subagents concurrency <n>|default, or /subagents max-tasks <n>|default.",
						"warning",
					);
					return;
				}
				await showSubagentConfigUi(ctx);
				return;
			}

			if (raw === "cancel-session-approval") {
				if (!sessionApproval) {
					updateSubagentStatus(ctx, policyState.mode, false, executionSettings);
					notifyCommand(ctx, "No current session subagent approval is active.", "warning");
					return;
				}
				persistSessionSubagentApproval(pi, false);
				updateSubagentStatus(ctx, policyState.mode, false, executionSettings);
				notifyCommand(
					ctx,
					"Cancelled current session subagent approval. Non-explicit ask-mode subagent requests will prompt again.",
				);
				return;
			}

			const nextMode = normalizeSubagentPolicyMode(raw);
			if (nextMode) {
				if (nextMode === policyState.mode) {
					if (nextMode === "off") setSubagentToolEnabled(pi, false);
					updateSubagentStatus(ctx, policyState.mode, sessionApproval, executionSettings);
					notifyCommand(ctx, `subagents mode is already ${formatSubagentStatusLabel(nextMode, sessionApproval)}`);
					return;
				}

				executionSettings = await setPolicyMode(nextMode, ctx);
				notifyCommand(
					ctx,
					`${buildSubagentSummaryText(policyState.mode, hasSessionSubagentApproval(ctx), executionSettings)}\n\nSaved mode to ~/.pi/agent/subagent-policy.json`,
				);
				return;
			}

			const [command, value, extra] = raw.split(/\s+/).filter(Boolean);
			if (extra) {
				notifyCommand(ctx, buildSubagentUsageText(), "warning");
				return;
			}

			if (command === "concurrency") {
				if (!value) {
					notifyCommand(ctx, buildSubagentUsageText(), "warning");
					return;
				}
				if (value === "default") {
					executionSettings = await resetGlobalExecutionSettings(ctx, ["maxConcurrency"]);
					const note =
						executionSettings.sources.maxConcurrency === "project"
							? "Cleared the global maxConcurrency override from ~/.pi/agent/settings.json. The current project still overrides the effective value via .pi/settings.json."
							: "Cleared the global maxConcurrency override from ~/.pi/agent/settings.json.";
					notifyCommand(
						ctx,
						`${buildSubagentSummaryText(policyState.mode, hasSessionSubagentApproval(ctx), executionSettings)}\n\n${note}`,
					);
					return;
				}
				const requested = parseRequestedLimit(value, SUBAGENT_MAX_CONCURRENCY_LIMIT);
				if (requested === undefined) {
					notifyCommand(
						ctx,
						`Invalid concurrency value. Expected an integer from 1 to ${SUBAGENT_MAX_CONCURRENCY_LIMIT}.`,
						"warning",
					);
					return;
				}
				executionSettings = await saveGlobalExecutionSettings(ctx, { maxConcurrency: requested });
				const note =
					executionSettings.sources.maxConcurrency === "project"
						? "Saved to ~/.pi/agent/settings.json, but the current project still overrides the effective concurrency via .pi/settings.json."
						: executionSettings.limits.maxConcurrency !== requested
							? `Saved to ~/.pi/agent/settings.json. Effective concurrency is currently ${executionSettings.limits.maxConcurrency} because max parallel tasks is ${executionSettings.limits.maxParallelTasks}.`
							: `Saved maxConcurrency=${requested} to ~/.pi/agent/settings.json.`;
				notifyCommand(
					ctx,
					`${buildSubagentSummaryText(policyState.mode, hasSessionSubagentApproval(ctx), executionSettings)}\n\n${note}`,
				);
				return;
			}

			if (command === "max-tasks") {
				if (!value) {
					notifyCommand(ctx, buildSubagentUsageText(), "warning");
					return;
				}
				if (value === "default") {
					executionSettings = await resetGlobalExecutionSettings(ctx, ["maxParallelTasks"]);
					const note =
						executionSettings.sources.maxParallelTasks === "project"
							? "Cleared the global maxParallelTasks override from ~/.pi/agent/settings.json. The current project still overrides the effective value via .pi/settings.json."
							: "Cleared the global maxParallelTasks override from ~/.pi/agent/settings.json.";
					notifyCommand(
						ctx,
						`${buildSubagentSummaryText(policyState.mode, hasSessionSubagentApproval(ctx), executionSettings)}\n\n${note}`,
					);
					return;
				}
				const requested = parseRequestedLimit(value, SUBAGENT_MAX_PARALLEL_TASKS_LIMIT);
				if (requested === undefined) {
					notifyCommand(
						ctx,
						`Invalid max-tasks value. Expected an integer from 1 to ${SUBAGENT_MAX_PARALLEL_TASKS_LIMIT}.`,
						"warning",
					);
					return;
				}
				executionSettings = await saveGlobalExecutionSettings(ctx, { maxParallelTasks: requested });
				const note =
					executionSettings.sources.maxParallelTasks === "project"
						? "Saved to ~/.pi/agent/settings.json, but the current project still overrides the effective max-tasks value via .pi/settings.json."
						: `Saved maxParallelTasks=${requested} to ~/.pi/agent/settings.json.`;
				notifyCommand(
					ctx,
					`${buildSubagentSummaryText(policyState.mode, hasSessionSubagentApproval(ctx), executionSettings)}\n\n${note}`,
				);
				return;
			}

			if (command === "reset-limits") {
				executionSettings = await resetGlobalExecutionSettings(ctx, ["maxConcurrency", "maxParallelTasks"]);
				const note =
					hasProjectLimitOverride(executionSettings)
						? "Cleared global subagent limit overrides from ~/.pi/agent/settings.json. The current project still overrides one or more effective values via .pi/settings.json."
						: "Cleared global subagent limit overrides from ~/.pi/agent/settings.json.";
				notifyCommand(
					ctx,
					`${buildSubagentSummaryText(policyState.mode, hasSessionSubagentApproval(ctx), executionSettings)}\n\n${note}`,
				);
				return;
			}

			notifyCommand(ctx, buildSubagentUsageText(), "warning");
		},
	});

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to specialized subagents with isolated context.",
			"Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
			"Per-subagent model and thinking overrides are supported; otherwise child sessions inherit the workflow-start model and thinking level.",
			"Built-in agents typically available: scout, planner, planner-readonly, reviewer, reviewer-readonly, worker, consolidator.",
			"Default policy mode is ask: explicit requests run, otherwise Pi asks before spawning subagents. Use /subagents off to disable completely.",
			'Default agent scope is "user" (from ~/.pi/agent/agents).',
			'To enable project-local agents in .pi/agents, set agentScope: "both" (or "project").',
		].join(" "),
		promptSnippet: "Delegate work to isolated subagents in single, parallel, or chain mode.",
		promptGuidelines: [
			"Use subagent when the user explicitly asks for sub-agents, delegation, named subagents, or multiple agents, or when large decomposable work clearly benefits from multi-agent fan-out under the current policy mode.",
			"Do not use subagent for ordinary PR reviews, small diffs, or simple tasks; handle those directly unless the user explicitly asks for multi-agent review.",
			"Use subagent with the tasks parameter when the user asks to spawn multiple sub-agents for independent work, and try to match the requested number of sub-agents with focused tasks when the work can be cleanly decomposed.",
			"When the user specifies different speed, cost, or reasoning expectations per subagent, pass model and thinking overrides in the subagent call instead of relying on the current global /model setting.",
			"If a delegated child requests parent input, ask the user at the top level before continuing, then decide whether to rerun the child or handle the follow-up directly.",
			"After subagent returns, the main assistant must review all subagent outputs, remove duplicates, reconcile disagreements, and present one merged final answer to the user instead of dumping raw subagent output.",
			"Prefer scout for codebase discovery, planner for saved Markdown plan artifacts, planner-readonly for read-only nested planning, reviewer for writable report workflows, reviewer-readonly for read-only nested review, worker for general implementation, and consolidator for synthesis/report artifacts.",
			"Use subagent agentScope set to both only when project-local agents under .pi/agents are needed and the repository is trusted.",
		],
		parameters: SubagentParams,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const agentScope: AgentScope = params.agentScope ?? "user";
			const projectTrusted = ctx.isProjectTrusted();
			const settingsLoadOptions = { projectTrusted };
			const projectAgentTrustBlockReason = getProjectAgentTrustBlockReason(
				agentScope,
				agentScope === "user" ? true : projectTrusted,
			);
			if (projectAgentTrustBlockReason) throw new Error(projectAgentTrustBlockReason);
			const resolveDiscovery = createAgentDiscoveryResolver(ctx.cwd, agentScope);
			const discovery = resolveDiscovery(undefined);
			const agents = discovery.agents;
			const requestedExecutionCwds = getRequestExecutionCwds(ctx.cwd, params);
			const projectAgentDirs = Array.from(
				new Set(
					requestedExecutionCwds
						.map((executionCwd) => resolveDiscovery(executionCwd).projectAgentsDir)
						.filter((dir): dir is string => Boolean(dir)),
				),
			);
			const projectAgentsDirForDetails = projectAgentDirs.length === 1 ? projectAgentDirs[0] : null;
			const confirmProjectAgents = params.confirmProjectAgents ?? true;
			const inheritedDelegationApproval =
				delegatedApprovalByToolCallId.get(toolCallId) ?? getInheritedSubagentApprovalScope();
			const executionSettings = loadSubagentExecutionSettingsForCwds(
				requestedExecutionCwds,
				ctx.cwd,
				settingsLoadOptions,
			);
			const workflowModelLock = resolveWorkflowModelLock(ctx, pi.getThinkingLevel());

			const hasChain = (params.chain?.length ?? 0) > 0;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task);
			const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

			const makeDetails =
				(mode: "single" | "parallel" | "chain") =>
				(results: SingleResult[], parentEscalationResolutions?: ParentEscalationResolution[]): SubagentDetails => ({
					mode,
					agentScope,
					projectAgentsDir: projectAgentsDirForDetails,
					results,
					...(parentEscalationResolutions && parentEscalationResolutions.length > 0
						? { parentEscalationResolutions }
						: {}),
				});

			const buildParentEscalationResult = async (mode: "single" | "parallel" | "chain", results: SingleResult[]) => {
				const resolutions = await resolveInteractiveParentClarificationsFromUx(ctx.hasUI ? ctx.ui : null, results);
				return {
					content: [{ type: "text" as const, text: formatParentEscalationSummaryFromUx(results, resolutions) }],
					details: makeDetails(mode)(results, resolutions),
				};
			};

			if (modeCount !== 1) {
				const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
				return {
					content: [
						{
							type: "text",
							text: `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}`,
						},
					],
					details: makeDetails("single")([]),
				};
			}

			if (agentScope === "project" || agentScope === "both") {
				const projectAgentsRequested = getRequestedProjectAgents(params, resolveDiscovery);

				if (confirmProjectAgents && projectAgentsRequested.length > 0) {
					const names = Array.from(new Set(projectAgentsRequested.map((agent) => agent.name))).join(", ");
					const dirs = Array.from(new Set(projectAgentsRequested.map((agent) => agent.dir ?? "(unknown)")));
					const sourceText = dirs.length === 1 ? dirs[0] : dirs.map((dir) => `- ${dir}`).join("\n");
					if (!ctx.hasUI) {
						throw new Error(
							`Blocked: project-local agents require confirmation, but no UI is available. Agents: ${names}. Source: ${sourceText}. Pass confirmProjectAgents: false only for trusted repositories.`,
						);
					}
					const ok = await ctx.ui.confirm(
						"Run project-local agents?",
						`Agents: ${names}\nSource: ${sourceText}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
					);
					if (!ok)
						return {
							content: [{ type: "text", text: "Canceled: project-local agents not approved." }],
							details: makeDetails(hasChain ? "chain" : hasTasks ? "parallel" : "single")([]),
						};
				}
			}

			if (params.chain && params.chain.length > 0) {
				const results: SingleResult[] = [];
				let previousOutput = "";

				for (let i = 0; i < params.chain.length; i++) {
					const step = params.chain[i];
					const stepDiscovery = resolveDiscovery(step.cwd);
					const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);

					// Create update callback that includes all previous results
					const chainUpdate: OnUpdateCallback | undefined = onUpdate
						? (partial) => {
								// Combine completed results with current streaming result
								const currentResult = partial.details?.results[0];
								if (currentResult) {
									const allResults = [...results, currentResult];
									onUpdate({
										content: partial.content,
										details: makeDetails("chain")(allResults),
									});
								}
							}
						: undefined;

					const stepExecutionSettings = loadSubagentExecutionSettingsForRequestedCwd(
						ctx.cwd,
						step.cwd,
						settingsLoadOptions,
					);
					const result = await runSingleAgent(
						ctx.cwd,
						stepDiscovery.agents,
						{
							agent: step.agent,
							task: taskWithContext,
							cwd: step.cwd,
							model: step.model,
							thinking: step.thinking,
						},
						i + 1,
						signal,
						chainUpdate,
						workflowModelLock,
						stepExecutionSettings,
						resolveInheritedApprovalScopeForAgent(
							inheritedDelegationApproval,
							step.agent,
							stepExecutionSettings,
						),
						makeDetails("chain"),
					);
					results.push(result);

					if (hasParentEscalations(result)) {
						return buildParentEscalationResult("chain", results);
					}

					const isError = isFailedResult(result);
					if (isError) {
						const errorMsg = await truncateSubagentVisibleOutput(getResultOutput(result));
						throw new Error(`Chain stopped at step ${i + 1} (${step.agent}): ${errorMsg.text}`);
					}
					previousOutput = getFinalOutput(result.messages);
				}
				const finalOutput = await truncateSubagentVisibleOutput(
					getFinalOutput(results[results.length - 1].messages) || "(no output)",
				);
				return {
					content: [{ type: "text", text: finalOutput.text }],
					details: makeDetails("chain")(results),
				};
			}

			if (params.tasks && params.tasks.length > 0) {
				if (params.tasks.length > executionSettings.limits.maxParallelTasks)
					return {
						content: [
							{
								type: "text",
								text: `Too many parallel tasks (${params.tasks.length}). Max is ${executionSettings.limits.maxParallelTasks}. Configure via /subagents max-tasks <n> or settings.json subagents.maxParallelTasks.`,
							},
						],
						details: makeDetails("parallel")([]),
					};

				// Track all results for streaming updates
				const allResults: SingleResult[] = new Array(params.tasks.length);

				// Initialize placeholder results
				for (let i = 0; i < params.tasks.length; i++) {
					allResults[i] = {
						agent: params.tasks[i].agent,
						agentSource: "unknown",
						task: params.tasks[i].task,
						exitCode: -1, // -1 = still running
						messages: [],
						stderr: "",
						usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
						parentEscalations: [],
					};
				}

				const emitParallelUpdate = () => {
					if (onUpdate) {
						const running = allResults.filter((r) => isRunningResult(r)).length;
						const done = allResults.filter((r) => !isRunningResult(r)).length;
						onUpdate({
							content: [
								{ type: "text", text: `Parallel: ${done}/${allResults.length} done, ${running} running...` },
							],
							details: makeDetails("parallel")([...allResults]),
						});
					}
				};

				const results = await mapWithConcurrencyLimit(
					params.tasks,
					executionSettings.limits.maxConcurrency,
					async (t, index) => {
						const taskDiscovery = resolveDiscovery(t.cwd);
						const taskExecutionSettings = loadSubagentExecutionSettingsForRequestedCwd(
							ctx.cwd,
							t.cwd,
							settingsLoadOptions,
						);
						const result = await runSingleAgent(
							ctx.cwd,
							taskDiscovery.agents,
							{
								agent: t.agent,
								task: t.task,
								cwd: t.cwd,
								model: t.model,
								thinking: t.thinking,
							},
							undefined,
							signal,
							// Per-task update callback
							(partial) => {
								if (partial.details?.results[0]) {
									allResults[index] = partial.details.results[0];
									emitParallelUpdate();
								}
							},
							workflowModelLock,
							taskExecutionSettings,
							resolveInheritedApprovalScopeForAgent(
								inheritedDelegationApproval,
								t.agent,
								taskExecutionSettings,
							),
							makeDetails("parallel"),
						);
						allResults[index] = result;
						emitParallelUpdate();
						return result;
					},
				);

				const escalatedResults = results.filter(hasParentEscalations);
				if (escalatedResults.length > 0) {
					return buildParentEscalationResult("parallel", results);
				}

				const successCount = results.filter((r) => !isFailedResult(r)).length;
				const summaries = await Promise.all(
					results.map(async (r) => {
						const output = await truncateSubagentVisibleOutput(getResultOutput(r));
						const status = isFailedResult(r)
							? `failed${r.stopReason && r.stopReason !== "end" ? ` (${r.stopReason})` : ""}`
							: "completed";
						return `### [${r.agent}] ${status}\n\n${output.text}`;
					}),
				);
				return {
					content: [
						{
							type: "text",
							text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}`,
						},
					],
					details: makeDetails("parallel")(results),
				};
			}

			if (params.agent && params.task) {
				const taskDiscovery = resolveDiscovery(params.cwd);
				const taskExecutionSettings = loadSubagentExecutionSettingsForRequestedCwd(
					ctx.cwd,
					params.cwd,
					settingsLoadOptions,
				);
				const result = await runSingleAgent(
					ctx.cwd,
					taskDiscovery.agents,
					{
						agent: params.agent,
						task: params.task,
						cwd: params.cwd,
						model: params.model,
						thinking: params.thinking,
					},
					undefined,
					signal,
					onUpdate,
					workflowModelLock,
					taskExecutionSettings,
					resolveInheritedApprovalScopeForAgent(
						inheritedDelegationApproval,
						params.agent,
						taskExecutionSettings,
					),
					makeDetails("single"),
				);
				if (hasParentEscalations(result)) {
					return buildParentEscalationResult("single", [result]);
				}
				const isError = isFailedResult(result);
				if (isError) {
					const errorMsg = await truncateSubagentVisibleOutput(getResultOutput(result));
					throw new Error(`Agent ${result.stopReason || "failed"}: ${errorMsg.text}`);
				}
				const finalOutput = await truncateSubagentVisibleOutput(getFinalOutput(result.messages) || "(no output)");
				return {
					content: [{ type: "text", text: finalOutput.text }],
					details: makeDetails("single")([result]),
				};
			}

			const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
			return {
				content: [{ type: "text", text: `Invalid parameters. Available agents: ${available}` }],
				details: makeDetails("single")([]),
			};
		},

		renderCall(args, theme, _context) {
			const scope: AgentScope = args.agentScope ?? "user";
			if (args.chain && args.chain.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `chain (${args.chain.length} steps)`) +
					theme.fg("muted", ` [${scope}]`);
				for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
					const step = args.chain[i];
					// Clean up {previous} placeholder for display
					const cleanTask = step.task.replace(/\{previous\}/g, "").trim();
					const preview = cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
					text +=
						"\n  " +
						theme.fg("muted", `${i + 1}.`) +
						" " +
						theme.fg("accent", step.agent) +
						theme.fg("dim", ` ${preview}`);
				}
				if (args.chain.length > 3) text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			if (args.tasks && args.tasks.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
					theme.fg("muted", ` [${scope}]`);
				for (const t of args.tasks.slice(0, 3)) {
					const preview = t.task.length > 40 ? `${t.task.slice(0, 40)}...` : t.task;
					text += `\n  ${theme.fg("accent", t.agent)}${theme.fg("dim", ` ${preview}`)}`;
				}
				if (args.tasks.length > 3) text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			const agentName = args.agent || "...";
			const preview = args.task ? (args.task.length > 60 ? `${args.task.slice(0, 60)}...` : args.task) : "...";
			let text =
				theme.fg("toolTitle", theme.bold("subagent ")) +
				theme.fg("accent", agentName) +
				theme.fg("muted", ` [${scope}]`);
			text += `\n  ${theme.fg("dim", preview)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as SubagentDetails | undefined;
			if (!details || details.results.length === 0) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}

			const mdTheme = getMarkdownTheme();
			const activityTree = formatSubagentActivityTreeFromUx(details, theme.fg.bind(theme));
			const escalatedResults = details.results.filter(hasParentEscalations);
			if (escalatedResults.length > 0) {
				const summary = formatParentEscalationSummaryFromUx(details.results, details.parentEscalationResolutions ?? []);
				return new Text(`${activityTree}\n\n${summary}`, 0, 0);
			}

			const renderDisplayItems = (items: DisplayItem[], limit?: number) => {
				const toShow = limit ? items.slice(-limit) : items;
				const skipped = limit && items.length > limit ? items.length - limit : 0;
				let text = "";
				if (skipped > 0) text += theme.fg("muted", `... ${skipped} earlier items\n`);
				for (const item of toShow) {
					if (item.type === "text") {
						const preview = expanded ? item.text : item.text.split("\n").slice(0, 3).join("\n");
						text += `${theme.fg("toolOutput", preview)}\n`;
					} else {
						text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
					}
				}
				return text.trimEnd();
			};

			if (details.mode === "single" && details.results.length === 1) {
				const r = details.results[0];
				const isError = isFailedResult(r);
				const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
				const displayItems = getDisplayItems(r.messages);
				const finalOutput = getFinalOutput(r.messages);
				const failureOutput = getFailureFallbackOutput(r, finalOutput);

				if (expanded) {
					const container = new Container();
					let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
					if (isError && r.stopReason) header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
					container.addChild(new Text(header, 0, 0));
					if (isError && r.errorMessage)
						container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(activityTree, 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
					container.addChild(new Text(theme.fg("dim", r.task), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
					if (displayItems.length === 0 && !finalOutput && !failureOutput) {
						container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
					} else {
						for (const item of displayItems) {
							if (item.type === "toolCall")
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
						}
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
							if (failureOutput) {
								container.addChild(new Spacer(1));
								container.addChild(new Markdown(failureOutput.trim(), 0, 0, mdTheme));
							}
						} else if (failureOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(failureOutput.trim(), 0, 0, mdTheme));
						}
					}
					const usageStr = formatUsageStats(r.usage, r.model);
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
					}
					return container;
				}

				let text = `${activityTree}\n\n${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
				if (isError && r.stopReason) text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
				if (isError && r.errorMessage) text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
				if (displayItems.length === 0) {
					if (failureOutput && failureOutput !== r.errorMessage) text += `\n${theme.fg("error", failureOutput)}`;
					else if (!isError || !r.errorMessage) text += `\n${theme.fg("muted", "(no output)")}`;
				} else {
					text += `\n${renderDisplayItems(displayItems, COLLAPSED_ITEM_COUNT)}`;
					if (failureOutput) text += `\n${theme.fg("error", failureOutput)}`;
					if (displayItems.length > COLLAPSED_ITEM_COUNT) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				}
				const usageStr = formatUsageStats(r.usage, r.model);
				if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
				return new Text(text, 0, 0);
			}

			const aggregateUsage = (results: SingleResult[]) => {
				const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
				for (const r of results) {
					total.input += r.usage.input;
					total.output += r.usage.output;
					total.cacheRead += r.usage.cacheRead;
					total.cacheWrite += r.usage.cacheWrite;
					total.cost += r.usage.cost;
					total.turns += r.usage.turns;
				}
				return total;
			};

			if (details.mode === "chain") {
				const successCount = details.results.filter((r) => !isFailedResult(r)).length;
				const icon = successCount === details.results.length ? theme.fg("success", "✓") : theme.fg("error", "✗");

				if (expanded) {
					const container = new Container();
					container.addChild(
						new Text(
							icon +
								" " +
								theme.fg("toolTitle", theme.bold("chain ")) +
								theme.fg("accent", `${successCount}/${details.results.length} steps`),
							0,
							0,
						),
					);
					container.addChild(new Spacer(1));
					container.addChild(new Text(activityTree, 0, 0));

					for (const r of details.results) {
						const failed = isFailedResult(r);
						const rIcon = failed ? theme.fg("error", "✗") : theme.fg("success", "✓");
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);
						const failureOutput = getFailureFallbackOutput(r, finalOutput);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(
								`${theme.fg("muted", `─── Step ${r.step}: `) + theme.fg("accent", r.agent)} ${rIcon}`,
								0,
								0,
							),
						);
						container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

						// Show tool calls
						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
							}
						}

						// Show final output as markdown
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
							if (failureOutput) {
								container.addChild(new Spacer(1));
								container.addChild(new Markdown(failureOutput.trim(), 0, 0, mdTheme));
							}
						} else if (failureOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(failureOutput.trim(), 0, 0, mdTheme));
						}

						const stepUsage = formatUsageStats(r.usage, r.model);
						if (stepUsage) container.addChild(new Text(theme.fg("dim", stepUsage), 0, 0));
					}

					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
					}
					return container;
				}

				// Collapsed view
				let text =
					activityTree +
					"\n\n" +
					icon +
					" " +
					theme.fg("toolTitle", theme.bold("chain ")) +
					theme.fg("accent", `${successCount}/${details.results.length} steps`);
				for (const r of details.results) {
					const failed = isFailedResult(r);
					const rIcon = failed ? theme.fg("error", "✗") : theme.fg("success", "✓");
					const displayItems = getDisplayItems(r.messages);
					const finalOutput = getFinalOutput(r.messages);
					const failureOutput = getFailureFallbackOutput(r, finalOutput);
					text += `\n\n${theme.fg("muted", `─── Step ${r.step}: `)}${theme.fg("accent", r.agent)} ${rIcon}`;
					if (displayItems.length === 0) text += `\n${theme.fg(failureOutput ? "error" : "muted", failureOutput || "(no output)")}`;
					else {
						text += `\n${renderDisplayItems(displayItems, 5)}`;
						if (failureOutput) text += `\n${theme.fg("error", failureOutput)}`;
					}
				}
				const usageStr = formatUsageStats(aggregateUsage(details.results));
				if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
				text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			if (details.mode === "parallel") {
				const running = details.results.filter((r) => isRunningResult(r)).length;
				const successCount = details.results.filter((r) => !isRunningResult(r) && !isFailedResult(r)).length;
				const failCount = details.results.filter((r) => !isRunningResult(r) && isFailedResult(r)).length;
				const isRunning = running > 0;
				const icon = isRunning
					? theme.fg("warning", "⏳")
					: failCount > 0
						? theme.fg("warning", "◐")
						: theme.fg("success", "✓");
				const status = isRunning
					? `${successCount + failCount}/${details.results.length} done, ${running} running`
					: `${successCount}/${details.results.length} tasks`;

				if (expanded && !isRunning) {
					const container = new Container();
					container.addChild(
						new Text(
							`${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`,
							0,
							0,
						),
					);
					container.addChild(new Spacer(1));
					container.addChild(new Text(activityTree, 0, 0));

					for (const r of details.results) {
						const rIcon = isFailedResult(r) ? theme.fg("error", "✗") : theme.fg("success", "✓");
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);
						const failureOutput = getFailureFallbackOutput(r, finalOutput);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(`${theme.fg("muted", "─── ") + theme.fg("accent", r.agent)} ${rIcon}`, 0, 0),
						);
						container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

						// Show tool calls
						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
							}
						}

						// Show final output as markdown
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
							if (failureOutput) {
								container.addChild(new Spacer(1));
								container.addChild(new Markdown(failureOutput.trim(), 0, 0, mdTheme));
							}
						} else if (failureOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(failureOutput.trim(), 0, 0, mdTheme));
						}

						const taskUsage = formatUsageStats(r.usage, r.model);
						if (taskUsage) container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
					}

					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
					}
					return container;
				}

				// Collapsed view (or still running)
				let text = `${activityTree}\n\n${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
				for (const r of details.results) {
					const rIcon = isRunningResult(r)
						? theme.fg("warning", "⏳")
						: isFailedResult(r)
							? theme.fg("error", "✗")
							: theme.fg("success", "✓");
					const displayItems = getDisplayItems(r.messages);
					const finalOutput = getFinalOutput(r.messages);
					const failureOutput = getFailureFallbackOutput(r, finalOutput);
					text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", r.agent)} ${rIcon}`;
					if (displayItems.length === 0) {
						const fallback = isRunningResult(r) ? "(running...)" : failureOutput || "(no output)";
						text += `\n${theme.fg(failureOutput ? "error" : "muted", fallback)}`;
					} else {
						text += `\n${renderDisplayItems(displayItems, 5)}`;
						if (failureOutput) text += `\n${theme.fg("error", failureOutput)}`;
					}
				}
				if (!isRunning) {
					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
				}
				if (!expanded) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
		},
	});

}
