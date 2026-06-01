import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SettingsManager, getAgentDir, withFileMutationQueue } from "@earendil-works/pi-coding-agent";

export type SubagentSettingsScope = "global" | "project";
export type SubagentLimitSource = "default" | SubagentSettingsScope;
export type SubagentDelegationApprovalScope = "none" | "read-only" | "all";

export type SubagentExecutionSettings = {
	maxParallelTasks: number;
	maxConcurrency: number;
	maxDelegationDepth: number | null;
};

export type LoadedSubagentExecutionSettings = {
	limits: SubagentExecutionSettings;
	sources: {
		maxParallelTasks: SubagentLimitSource;
		maxConcurrency: SubagentLimitSource;
		maxDelegationDepth: SubagentLimitSource;
	};
	inheritedApprovalScopes: Record<string, SubagentDelegationApprovalScope>;
	warnings: string[];
	paths: {
		global: string;
		project: string;
	};
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
		warnings,
		paths: {
			global: getGlobalSettingsPath(),
			project: getProjectSettingsPath(cwd),
		},
	};
}

export function loadSubagentExecutionSettings(cwd: string): LoadedSubagentExecutionSettings {
	const settingsManager = SettingsManager.create(cwd, getAgentDir());
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
	return loadSubagentExecutionSettings(cwd);
}

export async function resetSubagentExecutionSettings(
	cwd: string,
	keys: Array<keyof SubagentExecutionSettings>,
	scope: SubagentSettingsScope = "global",
): Promise<LoadedSubagentExecutionSettings> {
	const filePath = scope === "global" ? getGlobalSettingsPath() : getProjectSettingsPath(cwd);
	await mutateSubagentSettingsFile(filePath, (subagents) => {
		for (const key of keys) {
			delete subagents[key];
		}
	});
	return loadSubagentExecutionSettings(cwd);
}
