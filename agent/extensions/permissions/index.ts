import {
	createBashToolDefinition,
	createLocalBashOperations,
	type BashOperations,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	AgentBranchRegistry,
	GitPermissionStore,
	analyzeGitCommands,
	buildGitPermissionRequest,
	resolveBranchCreations,
	type AgentBranchRecord,
	type GitPermissionGrant,
	type GitPermissionRequest,
	type GitProtectedOperation,
	type GitRepositoryStateProvider,
} from "./git.ts";
import {
	PackagePermissionStore,
	analyzePackageCommands,
	buildPackagePermissionRequest,
	type PackageOperation,
	type PackagePermissionGrant,
	type PackagePermissionRequest,
	type PackageProjectResolver,
} from "./package.ts";
import {
	PermissionStore,
	analyzeBashMutation,
	buildFileMutationRequest,
	type FilePermissionOperation,
	type PermissionGrant,
	type PermissionRequest,
} from "./permissions.ts";
import { createPiTempWorkspace, isPathInsideWorkspaceChild, type PiTempWorkspace } from "./tempWorkspace.ts";
import { analyzeCatastrophicDeletion, type CatastrophicDeletionDecision } from "./catastrophicDeletion.ts";
import { createGuardedBashOperations, formatCatastrophicDeletionBlock } from "./bashGuard.ts";
import { clearLegacyFooterStatus, FOOTER_STATUS_KEYS } from "../shared/footerStatus.ts";
import { isHideToolOutputEnabled } from "../hide-tool-output/state.ts";

const STATUS_KEY = FOOTER_STATUS_KEYS.permissions;
const PERMISSION_CHOICES = ["Allow once", "Allow for current session", "Deny", "Custom instructions"];
const AGENT_BRANCH_PREFIXES = ["pi/", "agent/", "codex/"];
const AGENT_BRANCH_ENTRY_TYPE = "permissions-agent-branch";
const LEGACY_AGENT_BRANCH_ENTRY_TYPES = new Set([AGENT_BRANCH_ENTRY_TYPE, "guardrails-agent-branch"]);
const PERMISSIONS_EXTENSION_PATH = realpathSync(fileURLToPath(import.meta.url));

type PermissionStatusTheme = {
	fg(color: "dim" | "error" | "syntaxComment", text: string): string;
	bold(text: string): string;
};

type PermissionStatusGrantCounts = {
	fs: number;
	git: number;
	deps: number;
};

export interface PermissionsExtensionOptions {
	systemTempDir?: string;
	bashOperations?: BashOperations;
	localBashOperationsFactory?: (options?: { shellPath?: string }) => BashOperations;
	home?: string;
	hideToolOutputEnabled?: () => boolean;
}

export default function (pi: ExtensionAPI, options: PermissionsExtensionOptions = {}) {
	const filePermissions = new PermissionStore();
	const gitPermissions = new GitPermissionStore();
	const packagePermissions = new PackagePermissionStore();
	const agentBranches = new AgentBranchRegistry(AGENT_BRANCH_PREFIXES);
	const pendingBranchCreations = new Map<string, AgentBranchRecord[]>();
	const gitStateProvider = createGitStateProvider(pi);
	const packageProjectResolver = createPackageProjectResolver(pi);
	let permissionsEnabled = true;
	let tempWorkspace: PiTempWorkspace | undefined;
	const localBashOperationsFactory = options.localBashOperationsFactory ?? createLocalBashOperations;
	const bashDelegate = options.bashOperations ?? localBashOperationsFactory();
	const hideToolOutputEnabled = options.hideToolOutputEnabled ?? isHideToolOutputEnabled;
	const builtInBash = createBashToolDefinition(process.cwd());

	pi.registerTool({
		...builtInBash,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const sessionCwd = typeof ctx?.cwd === "string" && ctx.cwd.length > 0 ? ctx.cwd : process.cwd();
			const guardedOperations = createGuardedBashOperations(bashDelegate, { home: options.home });
			const guardedBash = createBashToolDefinition(sessionCwd, { operations: guardedOperations });
			return guardedBash.execute(toolCallId, params, signal, onUpdate, ctx);
		},
		renderResult(result, renderOptions, theme, context) {
			if (!builtInBash.renderResult) return new Container();
			const state = context.state as Record<string, unknown>;
			const builtInComponent = (builtInBash.renderResult as any)(result, renderOptions, theme, {
				...context,
				lastComponent: state.permissionsBuiltInBashResultComponent,
			});
			state.permissionsBuiltInBashResultComponent = builtInComponent;
			return hideToolOutputEnabled() ? new Container() : builtInComponent;
		},
	});

	pi.on("session_start", (_event, ctx) => {
		tempWorkspace = createTempWorkspaceForContext(ctx, options.systemTempDir);
		restoreAgentBranches(ctx, agentBranches);
		updateStatus(ctx, permissionsEnabled, filePermissions, gitPermissions, packagePermissions);
	});

	pi.on("session_shutdown", () => {
		permissionsEnabled = true;
		tempWorkspace = undefined;
		filePermissions.clear();
		gitPermissions.clear();
		packagePermissions.clear();
		pendingBranchCreations.clear();
	});

	pi.on("before_agent_start", (event, ctx) => {
		const workspace = tempWorkspace ?? createTempWorkspaceForContext(ctx, options.systemTempDir);
		tempWorkspace = workspace;
		return { systemPrompt: `${event.systemPrompt}\n\n${formatTempWorkspacePrompt(workspace)}` };
	});

	pi.registerCommand("permissions", {
		description: "Show, enable, disable, or clear current permission state",
		getArgumentCompletions: getPermissionsArgumentCompletions,
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (action === "on" || action === "off") {
				const nextEnabled = action === "on";
				if (permissionsEnabled === nextEnabled) {
					updateStatus(ctx, permissionsEnabled, filePermissions, gitPermissions, packagePermissions);
					ctx.ui.notify(
						`Ordinary permission guards are already ${formatPermissionMode(permissionsEnabled)}; catastrophic protection remains active.`,
						"info",
					);
					return;
				}

				permissionsEnabled = nextEnabled;
				updateStatus(ctx, permissionsEnabled, filePermissions, gitPermissions, packagePermissions);
				ctx.ui.notify(
					permissionsEnabled
						? "Ordinary permission guards enabled. Catastrophic protection remains active."
						: "Ordinary permission guards disabled; catastrophic protection remains active.",
					"info",
				);
				return;
			}

			if (action === "clear") {
				filePermissions.clear();
				gitPermissions.clear();
				packagePermissions.clear();
				updateStatus(ctx, permissionsEnabled, filePermissions, gitPermissions, packagePermissions);
				ctx.ui.notify("Session permissions cleared.", "info");
				return;
			}

			if (action) {
				ctx.ui.notify(`Usage: /permissions [on|off|clear] (currently ${formatPermissionMode(permissionsEnabled)})`, "warning");
				return;
			}

			const fileGrants = filePermissions.list();
			const gitGrants = gitPermissions.list();
			const packageGrants = packagePermissions.list();
			const trackedBranches = agentBranches.listTracked();
			if (fileGrants.length === 0 && gitGrants.length === 0 && packageGrants.length === 0 && trackedBranches.length === 0) {
				ctx.ui.notify(
					`Ordinary permission guards are ${formatPermissionMode(permissionsEnabled)}; catastrophic protection remains active. No active session permissions or tracked agent branches.`,
					"info",
				);
				return;
			}

			const choice = ctx.hasUI
				? await ctx.ui.select(formatGrants(permissionsEnabled, fileGrants, gitGrants, packageGrants, trackedBranches), [
						"Keep",
						"Clear permissions",
					])
				: undefined;
			if (choice === "Clear permissions") {
				filePermissions.clear();
				gitPermissions.clear();
				packagePermissions.clear();
				updateStatus(ctx, permissionsEnabled, filePermissions, gitPermissions, packagePermissions);
				ctx.ui.notify("Session permissions cleared. Agent branch tracking was kept.", "info");
			}
		},
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName === "bash") {
			const input = event.input && typeof event.input === "object" ? (event.input as Record<string, unknown>) : {};
			if (typeof input.command !== "string") {
				return { block: true, reason: "Blocked Bash call (P0_INVALID_BASH_INPUT): command must be a string" };
			}
			const catastrophic = await analyzeCatastrophicDeletion(input.command, { cwd: ctx.cwd, home: options.home });
			if (catastrophic.kind === "hard-deny") {
				return { block: true, reason: formatCatastrophicDeletionBlock(catastrophic) };
			}
			if (!hasExpectedBashOwnership(pi)) {
				return { block: true, reason: "Blocked Bash call (P0_BASH_OWNERSHIP_UNEXPECTED): permissions does not own the active model Bash definition" };
			}
		}

		const refreshStatus = () => updateStatus(ctx, permissionsEnabled, filePermissions, gitPermissions, packagePermissions);
		const workspace = tempWorkspace ?? createTempWorkspaceForContext(ctx, options.systemTempDir);
		tempWorkspace = workspace;
		const fileRequest = fileRequestForToolCall(event, ctx.cwd);
		const tempWorkspaceAutoApproved = fileRequest
			? await tryAutoApproveTempWorkspaceRequest(fileRequest, workspace)
			: false;
		if (permissionsEnabled && fileRequest && !tempWorkspaceAutoApproved && !filePermissions.hasGrant(fileRequest)) {
			const decision = await requestFilePermission(fileRequest, ctx, filePermissions, refreshStatus);
			if (decision) return decision;
		}

		if (event.toolName !== "bash") return undefined;
		const input = event.input && typeof event.input === "object" ? (event.input as Record<string, unknown>) : {};
		const command = input.command;
		if (typeof command !== "string") return undefined;

		const gitAnalysis = analyzeGitCommands(command, ctx.cwd);
		if (permissionsEnabled && gitAnalysis.protectedActions.length > 0) {
			const gitRequest = await buildGitPermissionRequest(
				gitAnalysis.protectedActions,
				command,
				gitStateProvider,
				agentBranches,
			);
			if (gitRequest && !gitPermissions.hasGrant(gitRequest)) {
				const decision = await requestGitPermission(gitRequest, ctx, gitPermissions, refreshStatus);
				if (decision) return decision;
			}
		}

		if (permissionsEnabled) {
			const packageAnalysis = analyzePackageCommands(command, ctx.cwd);
			if (packageAnalysis.actions.length > 0) {
				const packageRequest = await buildPackagePermissionRequest(
					packageAnalysis.actions,
					command,
					packageProjectResolver,
				);
				if (packageRequest && !packagePermissions.hasGrant(packageRequest)) {
					const decision = await requestPackagePermission(packageRequest, ctx, packagePermissions, refreshStatus);
					if (decision) return decision;
				}
			}
		}

		if (gitAnalysis.branchCreations.length > 0) {
			const creations = await resolveBranchCreations(gitAnalysis.branchCreations, gitStateProvider);
			if (creations.length > 0) pendingBranchCreations.set(event.toolCallId, creations);
		}

		return undefined;
	});

	pi.on("user_bash", async (event) => {
		let catastrophic: CatastrophicDeletionDecision;
		try {
			catastrophic = await analyzeCatastrophicDeletion(event.command, { cwd: event.cwd, home: options.home });
		} catch {
			catastrophic = {
				kind: "hard-deny",
				reasonCode: "P0_DELETE_CONTEXT_RESOLUTION_FAILED",
				reason: "catastrophic deletion analysis failed unexpectedly",
				targets: [],
			};
		}
		if (catastrophic.kind === "hard-deny") {
			return {
				result: {
					output: formatCatastrophicDeletionBlock(catastrophic),
					exitCode: 1,
					cancelled: false,
					truncated: false,
				},
			};
		}
		return { operations: createGuardedBashOperations(bashDelegate, { home: options.home }) };
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;
		const creations = pendingBranchCreations.get(event.toolCallId);
		if (!creations) return undefined;
		pendingBranchCreations.delete(event.toolCallId);

		if (event.isError) return undefined;
		const tracked: AgentBranchRecord[] = [];
		for (const creation of creations) {
			if (!(await gitStateProvider.branchExists(creation.repoRoot, creation.branch))) continue;
			agentBranches.add(creation.repoRoot, creation.branch, creation.createdAt);
			pi.appendEntry(AGENT_BRANCH_ENTRY_TYPE, creation);
			tracked.push(creation);
		}
		if (tracked.length > 0 && ctx.hasUI) {
			ctx.ui.notify(
				`Tracked agent-created git branch${tracked.length === 1 ? "" : "es"}: ${tracked
					.map((creation) => creation.branch)
					.join(", ")}`,
				"info",
			);
		}
		return undefined;
	});
}

function fileRequestForToolCall(event: { toolName: string; input: unknown }, cwd: string): PermissionRequest | undefined {
	const input = event.input && typeof event.input === "object" ? (event.input as Record<string, unknown>) : {};

	if (event.toolName === "write" || event.toolName === "edit") {
		const path = input.path;
		return typeof path === "string" ? buildFileMutationRequest(event.toolName, path, cwd) : undefined;
	}

	if (event.toolName === "bash") {
		const command = input.command;
		return typeof command === "string" ? analyzeBashMutation(command, cwd) : undefined;
	}

	return undefined;
}

function hasExpectedBashOwnership(pi: ExtensionAPI): boolean {
	try {
		const bash = pi.getAllTools().find((tool) => tool.name === "bash");
		if (!bash) return false;
		const sourcePath = bash.sourceInfo?.path;
		return typeof sourcePath === "string" && realpathSync(sourcePath) === PERMISSIONS_EXTENSION_PATH;
	} catch {
		return false;
	}
}

function createTempWorkspaceForContext(ctx: SessionTempContext, systemTempDir?: string): PiTempWorkspace {
	return createPiTempWorkspace(readSessionId(ctx), { systemTempDir });
}

function readSessionId(ctx: SessionTempContext): string | undefined {
	try {
		return ctx.sessionManager?.getSessionId?.();
	} catch {
		return undefined;
	}
}

async function tryAutoApproveTempWorkspaceRequest(request: PermissionRequest, workspace: PiTempWorkspace): Promise<boolean> {
	if (!request.targets.every((target) => isPathInsideWorkspaceChild(target.path, workspace))) return false;
	try {
		await workspace.ensureCreated();
		return true;
	} catch {
		return false;
	}
}

function formatTempWorkspacePrompt(workspace: PiTempWorkspace): string {
	return `Use scratch temp dir instead of /tmp: ${workspace.sessionDir}`;
}

async function requestFilePermission(
	request: PermissionRequest,
	ctx: PermissionPromptContext,
	permissions: PermissionStore,
	refreshStatus: () => void,
): Promise<ToolCallBlock | undefined> {
	if (!ctx.hasUI) {
		return {
			block: true,
			reason: `${request.summary} requires permission, but this Pi mode has no interactive UI. ${formatTargetScopes(request)}`,
		};
	}

	const choice = await ctx.ui.select(formatFilePermissionPrompt(request, ctx.cwd), PERMISSION_CHOICES);
	return handlePermissionChoice({
		choice,
		ctx,
		requestSummary: formatFileRequestSummary(request),
		scopeSummary: formatTargetScopes(request),
		onAllowSession: () => {
			permissions.addSessionGrant(request);
			refreshStatus();
		},
	});
}

async function requestGitPermission(
	request: GitPermissionRequest,
	ctx: PermissionPromptContext,
	permissions: GitPermissionStore,
	refreshStatus: () => void,
): Promise<ToolCallBlock | undefined> {
	if (!ctx.hasUI) {
		return {
			block: true,
			reason: `${request.summary} requires permission, but this Pi mode has no interactive UI. ${formatGitScopes(request)}`,
		};
	}

	const choice = await ctx.ui.select(formatGitPermissionPrompt(request, ctx.cwd), PERMISSION_CHOICES);
	return handlePermissionChoice({
		choice,
		ctx,
		requestSummary: formatGitRequestSummary(request),
		scopeSummary: formatGitScopes(request),
		onAllowSession: () => {
			permissions.addSessionGrant(request);
			refreshStatus();
		},
	});
}

async function requestPackagePermission(
	request: PackagePermissionRequest,
	ctx: PermissionPromptContext,
	permissions: PackagePermissionStore,
	refreshStatus: () => void,
): Promise<ToolCallBlock | undefined> {
	if (!ctx.hasUI) {
		return {
			block: true,
			reason: `${request.summary} requires permission, but this Pi mode has no interactive UI. ${formatPackageScopes(request)}`,
		};
	}

	const choice = await ctx.ui.select(formatPackagePermissionPrompt(request, ctx.cwd), PERMISSION_CHOICES);
	return handlePermissionChoice({
		choice,
		ctx,
		requestSummary: formatPackageRequestSummary(request),
		scopeSummary: formatPackageScopes(request),
		onAllowSession: () => {
			permissions.addSessionGrant(request);
			refreshStatus();
		},
	});
}

async function handlePermissionChoice(options: {
	choice: string | undefined;
	ctx: PermissionPromptContext;
	requestSummary: string;
	scopeSummary: string;
	onAllowSession(): void;
}): Promise<ToolCallBlock | undefined> {
	if (options.choice === "Allow once") {
		options.ctx.ui.notify("Allowed guarded action once.", "info");
		return undefined;
	}

	if (options.choice === "Allow for current session") {
		options.onAllowSession();
		options.ctx.ui.notify("Allowed guarded action for the listed scope(s) this session.", "info");
		return undefined;
	}

	if (options.choice === "Custom instructions") {
		const instructions = await options.ctx.ui.editor(
			"Custom permission instructions",
			`The permission-gated action was not allowed yet. Tell Pi how to proceed instead.\n\nRequested action:\n${options.requestSummary}\n\nInstructions:\n`,
		);
		const trimmed = instructions?.trim();
		if (trimmed) {
			return { block: true, reason: `Blocked by user. Custom instructions: ${trimmed}` };
		}
		return { block: true, reason: `Blocked by user after choosing custom instructions. ${options.scopeSummary}` };
	}

	return { block: true, reason: `Blocked by user. ${options.scopeSummary}` };
}

function createGitStateProvider(pi: ExtensionAPI): GitRepositoryStateProvider {
	return {
		async getRepoRoot(cwd: string) {
			const result = await pi.exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
			if (result.code !== 0) return undefined;
			return result.stdout.trim() || undefined;
		},
		async getCurrentBranch(repoRoot: string) {
			const result = await pi.exec("git", ["-C", repoRoot, "rev-parse", "--abbrev-ref", "HEAD"]);
			if (result.code !== 0) return undefined;
			return result.stdout.trim() || undefined;
		},
		async branchExists(repoRoot: string, branch: string) {
			const result = await pi.exec("git", ["-C", repoRoot, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
			return result.code === 0;
		},
	};
}

function createPackageProjectResolver(pi: ExtensionAPI): PackageProjectResolver {
	return {
		async getProjectRoot(cwd: string) {
			const result = await pi.exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
			if (result.code !== 0) return cwd;
			return result.stdout.trim() || cwd;
		},
	};
}

function restoreAgentBranches(ctx: { sessionManager: { getBranch(): unknown[] } }, agentBranches: AgentBranchRegistry): void {
	agentBranches.clearTracked();
	for (const entry of ctx.sessionManager.getBranch()) {
		const maybeEntry = entry as { type?: string; customType?: string; data?: unknown };
		if (maybeEntry.type !== "custom" || !LEGACY_AGENT_BRANCH_ENTRY_TYPES.has(maybeEntry.customType ?? "")) continue;
		const data = maybeEntry.data as Partial<AgentBranchRecord> | undefined;
		if (!data || typeof data.repoRoot !== "string" || typeof data.branch !== "string") continue;
		agentBranches.add(data.repoRoot, data.branch, typeof data.createdAt === "number" ? data.createdAt : Date.now());
	}
}

function updateStatus(
	ctx: { hasUI: boolean; ui: { setStatus(key: string, value: string | undefined): void; theme: PermissionStatusTheme } },
	enabled: boolean,
	filePermissions: PermissionStore | undefined,
	gitPermissions: GitPermissionStore | undefined,
	packagePermissions: PackagePermissionStore | undefined,
): void {
	if (!ctx.hasUI) return;
	clearLegacyFooterStatus(ctx, "permissions");
	const fileCount = filePermissions?.list().length ?? 0;
	const gitCount = gitPermissions?.list().length ?? 0;
	const packageCount = packagePermissions?.list().length ?? 0;
	ctx.ui.setStatus(
		STATUS_KEY,
		formatPermissionStatus({ enabled, grants: { fs: fileCount, git: gitCount, deps: packageCount }, theme: ctx.ui.theme }),
	);
}

function formatPermissionMode(enabled: boolean): "on" | "off" {
	return enabled ? "on" : "off";
}

export function formatPermissionStatus(options: { enabled: boolean; grants: PermissionStatusGrantCounts; theme: PermissionStatusTheme }): string {
	const prefix = options.theme.fg("dim", "permissions: ");
	const separator = options.theme.fg("dim", " •");
	if (!options.enabled) return prefix + options.theme.fg("error", "off") + separator;

	const grantCount = options.grants.fs + options.grants.git + options.grants.deps;
	if (grantCount > 0) {
		const detail = formatPermissionGrantDetails(options.grants);
		return prefix + options.theme.fg("syntaxComment", options.theme.bold(String(grantCount))) + options.theme.fg("dim", ` (${detail})`) + separator;
	}

	return prefix + options.theme.fg("dim", "on") + separator;
}

function formatPermissionGrantDetails(grants: PermissionStatusGrantCounts): string {
	return [
		{ label: "fs", count: grants.fs },
		{ label: "git", count: grants.git },
		{ label: "deps", count: grants.deps },
	]
		.filter((item) => item.count > 0)
		.map((item) => (item.count === 1 ? item.label : `${item.label}×${item.count}`))
		.join(", ");
}

function formatFilePermissionPrompt(request: PermissionRequest, cwd: string): string {
	return [
		"Pi wants to perform a guarded mutating action outside the current working directory.",
		"",
		`Working directory: ${cwd}`,
		`Tool: ${request.toolName}`,
		`Action: ${request.summary}`,
		...(request.command ? ["", "Command:", indent(truncate(request.command, 1600), "  ")] : []),
		"",
		"Permission target scope(s):",
		...request.targets.flatMap((target) => [
			`- ${operationLabel(target.operation)}: ${target.path}`,
			`  session scope: ${target.scopeDir} and nested paths only`,
			`  reason: ${target.reason}`,
		]),
		"",
		"Choose how to proceed:",
	].join("\n");
}

function formatGitPermissionPrompt(request: GitPermissionRequest, cwd: string): string {
	return [
		"Pi wants to perform a guarded git mutation on an existing non-agent branch or its working tree.",
		"",
		`Working directory: ${cwd}`,
		`Tool: ${request.toolName}`,
		`Action: ${request.summary}`,
		"",
		"Command:",
		indent(truncate(request.command, 1600), "  "),
		"",
		"Permission scope(s):",
		...request.operations.flatMap((operation) => [
			`- ${gitOperationLabel(operation.operation)} on branch ${operation.branch}`,
			`  repo: ${operation.repoRoot}`,
			`  session scope: this operation, this repo, and this branch only`,
			`  reason: ${operation.reason}`,
		]),
		"",
		`Agent branch prefixes bypass this restriction: ${AGENT_BRANCH_PREFIXES.join(", ")}`,
		"Choose how to proceed:",
	].join("\n");
}

function formatPackagePermissionPrompt(request: PackagePermissionRequest, cwd: string): string {
	return [
		"Pi wants to run a guarded package/dependency acquisition command.",
		"",
		`Working directory: ${cwd}`,
		`Tool: ${request.toolName}`,
		`Action: ${request.summary}`,
		"",
		"Command:",
		indent(truncate(request.command, 1600), "  "),
		"",
		"Permission scope(s):",
		...request.scopes.flatMap((scope) => [
			`- ${packageOperationLabel(scope.operation)} via ${scope.manager}`,
			`  project root: ${scope.projectRoot}`,
			`  command cwd: ${scope.cwd}`,
			`  session scope: this package manager, operation class, and project root only`,
			`  reason: ${scope.reason}`,
		]),
		"",
		"Maven and Gradle commands are intentionally excluded from this package permission check.",
		"Choose how to proceed:",
	].join("\n");
}

function formatFileRequestSummary(request: PermissionRequest): string {
	return [
		`Tool: ${request.toolName}`,
		`Action: ${request.summary}`,
		...(request.command ? [`Command: ${truncate(request.command, 800)}`] : []),
		formatTargetScopes(request),
	].join("\n");
}

function formatGitRequestSummary(request: GitPermissionRequest): string {
	return [`Tool: ${request.toolName}`, `Action: ${request.summary}`, `Command: ${truncate(request.command, 800)}`, formatGitScopes(request)].join(
		"\n",
	);
}

function formatPackageRequestSummary(request: PackagePermissionRequest): string {
	return [
		`Tool: ${request.toolName}`,
		`Action: ${request.summary}`,
		`Command: ${truncate(request.command, 800)}`,
		formatPackageScopes(request),
	].join("\n");
}

function formatTargetScopes(request: PermissionRequest): string {
	return `Target scope(s): ${request.targets
		.map((target) => `${operationLabel(target.operation)} ${target.scopeDir}`)
		.join(", ")}`;
}

function formatGitScopes(request: GitPermissionRequest): string {
	return `Git scope(s): ${request.operations
		.map((operation) => `${gitOperationLabel(operation.operation)} ${operation.repoRoot}#${operation.branch}`)
		.join(", ")}`;
}

function formatPackageScopes(request: PackagePermissionRequest): string {
	return `Package scope(s): ${request.scopes
		.map((scope) => `${packageOperationLabel(scope.operation)} ${scope.manager} in ${scope.projectRoot}`)
		.join(", ")}`;
}

function formatGrants(
	enabled: boolean,
	fileGrants: PermissionGrant[],
	gitGrants: GitPermissionGrant[],
	packageGrants: PackagePermissionGrant[],
	trackedBranches: AgentBranchRecord[],
): string {
	return [
		"Permission state:",
		`Ordinary permission guards: ${formatPermissionMode(enabled)}`,
		"Catastrophic deletion protection: always on",
		"",
		"Active file/path session permissions:",
		...(fileGrants.length > 0
			? fileGrants.map(
					(grant) =>
						`- ${operationLabel(grant.operation)}: ${grant.scopeDir} and nested paths only (granted ${new Date(
							grant.grantedAt,
						).toLocaleTimeString()})`,
				)
			: ["- None"]),
		"",
		"Active git session permissions:",
		...(gitGrants.length > 0
			? gitGrants.map(
					(grant) =>
						`- ${gitOperationLabel(grant.operation)}: ${grant.repoRoot}#${grant.branch} (granted ${new Date(
							grant.grantedAt,
						).toLocaleTimeString()})`,
				)
			: ["- None"]),
		"",
		"Active package/dependency session permissions:",
		...(packageGrants.length > 0
			? packageGrants.map(
					(grant) =>
						`- ${packageOperationLabel(grant.operation)} via ${grant.manager}: ${grant.projectRoot} (granted ${new Date(
							grant.grantedAt,
						).toLocaleTimeString()})`,
				)
			: ["- None"]),
		"",
		"Tracked agent-created branches:",
		...(trackedBranches.length > 0
			? trackedBranches.map((branch) => `- ${branch.repoRoot}#${branch.branch}`)
			: ["- None"]),
		"",
		"Choose an action:",
	].join("\n");
}

function operationLabel(operation: FilePermissionOperation): string {
	switch (operation) {
		case "write":
			return "write";
		case "edit":
			return "edit";
		case "delete":
			return "delete";
		case "bash-mutate":
			return "bash mutation";
	}
}

function gitOperationLabel(operation: GitProtectedOperation): string {
	switch (operation) {
		case "merge":
			return "git merge";
		case "pull":
			return "git pull";
		case "rebase":
			return "git rebase";
		case "reset":
			return "git reset";
		case "clean":
			return "git clean";
		case "restore":
			return "git restore";
		case "checkout-paths":
			return "git checkout paths";
		case "amend":
			return "git commit --amend";
		case "force-push":
			return "git push --force";
		case "cherry-pick":
			return "git cherry-pick";
		case "revert":
			return "git revert";
		case "branch-delete":
			return "git branch delete";
		case "branch-rename":
			return "git branch rename";
		case "branch-force":
			return "git branch force/reset";
	}
}

function packageOperationLabel(operation: PackageOperation): string {
	switch (operation) {
		case "dependency-install":
			return "dependency install/update";
		case "global-install":
			return "global/tool install";
		case "package-execute":
			return "package download/execute";
		case "system-install":
			return "system package install/update";
	}
}

function truncate(value: string, maxLength: number): string {
	return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function indent(value: string, prefix: string): string {
	return value
		.split("\n")
		.map((line) => `${prefix}${line}`)
		.join("\n");
}

export function getPermissionsArgumentCompletions(prefix: string): Array<{ value: string; label: string; description?: string }> | null {
	const normalizedPrefix = prefix.trimStart().toLowerCase();
	if (normalizedPrefix.includes(" ")) return null;
	const items = [
		{ value: "on", label: "on", description: "Enable permissions guards" },
		{ value: "off", label: "off", description: "Disable permissions guards" },
		{ value: "clear", label: "clear", description: "Clear current session permission grants" },
	];
	const filtered = items.filter((item) => item.value.startsWith(normalizedPrefix));
	return filtered.length > 0 ? filtered : null;
}

type ToolCallBlock = { block: true; reason?: string };

type SessionTempContext = {
	sessionManager?: {
		getSessionId?(): string;
	};
};

type PermissionPromptContext = {
	cwd: string;
	hasUI: boolean;
	ui: {
		select(title: string, items: string[]): Promise<string | undefined>;
		editor(title: string, prefilled?: string): Promise<string | undefined>;
		notify(message: string, type?: "info" | "warning" | "error"): void;
		setStatus(key: string, value: string | undefined): void;
	};
};
