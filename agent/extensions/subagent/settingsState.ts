import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { SettingsManager, getAgentDir, withFileMutationQueue } from "@earendil-works/pi-coding-agent";

export type SubagentSettingsScope = "global" | "project";
export type SubagentLimitSource = "default" | SubagentSettingsScope;
export type SubagentDelegationApprovalScope = "none" | "read-only" | "all";

export type SubagentExecutionSettings = {
	maxParallelTasks: number;
	maxConcurrency: number;
	maxDelegationDepth: number | null;
};

export type SubagentAgentDefault = {
	model?: string;
	thinking?: ThinkingLevel;
};

export type LoadedSubagentExecutionSettings = {
	limits: SubagentExecutionSettings;
	sources: {
		maxParallelTasks: SubagentLimitSource;
		maxConcurrency: SubagentLimitSource;
		maxDelegationDepth: SubagentLimitSource;
	};
	inheritedApprovalScopes: Record<string, SubagentDelegationApprovalScope>;
	agentDefaults: Record<string, SubagentAgentDefault>;
	warnings: string[];
	paths: {
		global: string;
		project: string;
	};
};

export type SubagentSettingsLoadOptions = {
	/**
	 * Whether project-local .pi/settings.json may be read into effective subagent settings.
	 * Defaults to false so callers without an ExtensionContext fail closed.
	 */
	projectTrusted?: boolean;
};

export const DEFAULT_SUBAGENT_EXECUTION_SETTINGS: SubagentExecutionSettings = {
	maxParallelTasks: 8,
	maxConcurrency: 5,
	maxDelegationDepth: null,
};

export const SUBAGENT_MAX_PARALLEL_TASKS_LIMIT = 64;
export const SUBAGENT_MAX_CONCURRENCY_LIMIT = 32;

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null;
}

function normalizePositiveInteger(value: unknown, min: number, max: number): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	const normalized = Math.trunc(value);
	if (normalized < min) return min;
	if (normalized > max) return max;
	return normalized;
}

function normalizeDelegationDepth(value: unknown): number | null | undefined {
	if (value === undefined) return undefined;
	if (value === null) return null;
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	const normalized = Math.trunc(value);
	if (!Number.isSafeInteger(normalized)) return undefined;
	if (normalized < 0) return 0;
	return normalized;
}

function normalizeDelegationApprovalScope(value: unknown): SubagentDelegationApprovalScope | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	if (normalized === "all") return "all";
	if (normalized === "none") return "none";
	if (normalized === "read-only" || normalized === "readonly" || normalized === "read_only") return "read-only";
	return undefined;
}

function normalizeNonEmptyString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

function normalizeThinkingLevel(value: unknown): ThinkingLevel | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return ["off", "minimal", "low", "medium", "high", "xhigh"].includes(normalized)
		? (normalized as ThinkingLevel)
		: undefined;
}

export function extractSubagentInheritedApprovalScopes(
	settings: unknown,
): Record<string, SubagentDelegationApprovalScope> {
	if (!isRecord(settings) || !isRecord(settings.subagents) || !isRecord(settings.subagents.inheritedApprovalScopes)) {
		return {};
	}

	const inheritedApprovalScopes: Record<string, SubagentDelegationApprovalScope> = {};
	for (const [agentName, rawScope] of Object.entries(settings.subagents.inheritedApprovalScopes)) {
		const normalizedAgentName = agentName.trim().toLowerCase();
		const normalizedScope = normalizeDelegationApprovalScope(rawScope);
		if (!normalizedAgentName || !normalizedScope) continue;
		inheritedApprovalScopes[normalizedAgentName] = normalizedScope;
	}

	return inheritedApprovalScopes;
}

export function mergeSubagentAgentDefaults(
	...records: Array<Record<string, SubagentAgentDefault>>
): Record<string, SubagentAgentDefault> {
	const merged: Record<string, SubagentAgentDefault> = {};
	for (const record of records) {
		for (const [agentName, agentDefault] of Object.entries(record)) {
			if (!agentName.trim()) continue;
			if (!(agentDefault.model || agentDefault.thinking)) {
				delete merged[agentName];
				continue;
			}
			const current = merged[agentName] ?? {};
			const next: SubagentAgentDefault = {
				...(current.model ? { model: current.model } : {}),
				...(current.thinking ? { thinking: current.thinking } : {}),
				...(agentDefault.model ? { model: agentDefault.model } : {}),
				...(agentDefault.thinking ? { thinking: agentDefault.thinking } : {}),
			};
			merged[agentName] = next;
		}
	}
	return merged;
}

export function extractSubagentAgentDefaults(settings: unknown): Record<string, SubagentAgentDefault> {
	if (!isRecord(settings) || !isRecord(settings.subagents) || !isRecord(settings.subagents.agentDefaults)) {
		return {};
	}

	const agentDefaults: Record<string, SubagentAgentDefault> = {};
	for (const [agentName, rawDefault] of Object.entries(settings.subagents.agentDefaults)) {
		const normalizedAgentName = agentName.trim().toLowerCase();
		if (!normalizedAgentName) continue;

		let model: string | undefined;
		let thinking: ThinkingLevel | undefined;
		if (rawDefault === null) {
			agentDefaults[normalizedAgentName] = {};
			continue;
		}
		if (typeof rawDefault === "string") {
			model = normalizeNonEmptyString(rawDefault);
			if (!model) continue;
		} else if (isRecord(rawDefault)) {
			if (!("model" in rawDefault) && !("thinking" in rawDefault)) continue;
			model = normalizeNonEmptyString(rawDefault.model);
			thinking = normalizeThinkingLevel(rawDefault.thinking);
			if (!model && !thinking) continue;
		} else {
			continue;
		}
		agentDefaults[normalizedAgentName] = {
			...(model ? { model } : {}),
			...(thinking ? { thinking } : {}),
		};
	}

	return agentDefaults;
}

function extractSubagentExecutionSettings(settings: unknown): Partial<SubagentExecutionSettings> {
	if (!isRecord(settings) || !isRecord(settings.subagents)) return {};
	const subagents = settings.subagents;
	return {
		maxParallelTasks: normalizePositiveInteger(subagents.maxParallelTasks, 1, SUBAGENT_MAX_PARALLEL_TASKS_LIMIT),
		maxConcurrency: normalizePositiveInteger(subagents.maxConcurrency, 1, SUBAGENT_MAX_CONCURRENCY_LIMIT),
		maxDelegationDepth: normalizeDelegationDepth(subagents.maxDelegationDepth),
	};
}

function getGlobalSettingsPath(): string {
	return join(getAgentDir(), "settings.json");
}

function getProjectSettingsPath(cwd: string): string {
	return join(cwd, ".pi", "settings.json");
}

export function formatSubagentSettingsSource(source: SubagentLimitSource): string {
	switch (source) {
		case "global":
			return "~/.pi/agent/settings.json";
		case "project":
			return ".pi/settings.json";
		default:
			return "default";
	}
}

function buildLoadedExecutionSettings(
	cwd: string,
	globalSettings: unknown,
	projectSettings: unknown,
	warnings: string[],
): LoadedSubagentExecutionSettings {
	const globalOverrides = extractSubagentExecutionSettings(globalSettings);
	const projectOverrides = extractSubagentExecutionSettings(projectSettings);
	const inheritedApprovalScopes = {
		...extractSubagentInheritedApprovalScopes(globalSettings),
		...extractSubagentInheritedApprovalScopes(projectSettings),
	};
	const agentDefaults = mergeSubagentAgentDefaults(
		extractSubagentAgentDefaults(globalSettings),
		extractSubagentAgentDefaults(projectSettings),
	);

	const limits: SubagentExecutionSettings = {
		...DEFAULT_SUBAGENT_EXECUTION_SETTINGS,
		...globalOverrides,
		...projectOverrides,
	};

	if (limits.maxConcurrency > limits.maxParallelTasks) {
		limits.maxConcurrency = limits.maxParallelTasks;
	}

	return {
		limits,
		sources: {
			maxParallelTasks:
				projectOverrides.maxParallelTasks !== undefined
					? "project"
					: globalOverrides.maxParallelTasks !== undefined
						? "global"
						: "default",
			maxConcurrency:
				projectOverrides.maxConcurrency !== undefined
					? "project"
					: globalOverrides.maxConcurrency !== undefined
						? "global"
						: "default",
			maxDelegationDepth:
				projectOverrides.maxDelegationDepth !== undefined
					? "project"
					: globalOverrides.maxDelegationDepth !== undefined
						? "global"
						: "default",
		},
		inheritedApprovalScopes,
		agentDefaults,
		warnings,
		paths: {
			global: getGlobalSettingsPath(),
			project: getProjectSettingsPath(cwd),
		},
	};
}

export function loadSubagentExecutionSettings(
	cwd: string,
	{ projectTrusted = false }: SubagentSettingsLoadOptions = {},
): LoadedSubagentExecutionSettings {
	const settingsManager = SettingsManager.create(cwd, getAgentDir(), { projectTrusted });
	const warnings = settingsManager
		.drainErrors()
		.map(({ scope, error }) => `Warning (${scope} settings): ${error.message}`);

	return buildLoadedExecutionSettings(
		cwd,
		settingsManager.getGlobalSettings() as Record<string, unknown>,
		settingsManager.getProjectSettings() as Record<string, unknown>,
		warnings,
	);
}

async function readJsonObject(
	filePath: string,
): Promise<{
	exists: boolean;
	value: Record<string, any>;
}> {
	try {
		const content = await readFile(filePath, "utf-8");
		if (!content.trim()) return { exists: true, value: {} };
		const parsed = JSON.parse(content);
		if (!isRecord(parsed)) {
			throw new Error(`Expected a JSON object in ${filePath}`);
		}
		return { exists: true, value: parsed };
	} catch (error) {
		const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
		if (code === "ENOENT") return { exists: false, value: {} };
		throw error;
	}
}

async function mutateSubagentSettingsFile(
	filePath: string,
	mutate: (subagents: Record<string, any>) => void,
): Promise<void> {
	await withFileMutationQueue(filePath, async () => {
		const { exists, value } = await readJsonObject(filePath);
		const subagents = isRecord(value.subagents) ? { ...value.subagents } : {};
		mutate(subagents);

		if (Object.keys(subagents).length === 0) delete value.subagents;
		else value.subagents = subagents;

		if (!exists && Object.keys(value).length === 0) return;

		await mkdir(dirname(filePath), { recursive: true });
		await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
	});
}

export async function saveSubagentExecutionSettings(
	cwd: string,
	updates: Partial<SubagentExecutionSettings>,
	scope: SubagentSettingsScope = "global",
	options: SubagentSettingsLoadOptions = {},
): Promise<LoadedSubagentExecutionSettings> {
	const filePath = scope === "global" ? getGlobalSettingsPath() : getProjectSettingsPath(cwd);
	await mutateSubagentSettingsFile(filePath, (subagents) => {
		const maxParallelTasks =
			updates.maxParallelTasks !== undefined
				? normalizePositiveInteger(updates.maxParallelTasks, 1, SUBAGENT_MAX_PARALLEL_TASKS_LIMIT)
				: undefined;
		const maxConcurrency =
			updates.maxConcurrency !== undefined
				? normalizePositiveInteger(updates.maxConcurrency, 1, SUBAGENT_MAX_CONCURRENCY_LIMIT)
				: undefined;
		const maxDelegationDepth =
			updates.maxDelegationDepth !== undefined ? normalizeDelegationDepth(updates.maxDelegationDepth) : undefined;
		if (maxParallelTasks !== undefined) {
			subagents.maxParallelTasks = maxParallelTasks;
		}
		if (maxConcurrency !== undefined) {
			subagents.maxConcurrency = maxConcurrency;
		}
		if (maxDelegationDepth !== undefined) {
			subagents.maxDelegationDepth = maxDelegationDepth;
		}
	});
	return loadSubagentExecutionSettings(cwd, options);
}

export async function resetSubagentExecutionSettings(
	cwd: string,
	keys: Array<keyof SubagentExecutionSettings>,
	scope: SubagentSettingsScope = "global",
	options: SubagentSettingsLoadOptions = {},
): Promise<LoadedSubagentExecutionSettings> {
	const filePath = scope === "global" ? getGlobalSettingsPath() : getProjectSettingsPath(cwd);
	await mutateSubagentSettingsFile(filePath, (subagents) => {
		for (const key of keys) {
			delete subagents[key];
		}
	});
	return loadSubagentExecutionSettings(cwd, options);
}
