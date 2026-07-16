import { basename, isAbsolute, normalize, resolve } from "node:path";

export type GitProtectedOperation =
	| "merge"
	| "pull"
	| "rebase"
	| "reset"
	| "clean"
	| "restore"
	| "checkout-paths"
	| "amend"
	| "force-push"
	| "cherry-pick"
	| "revert"
	| "branch-delete"
	| "branch-rename"
	| "branch-force";

export interface GitProtectedAction {
	operation: GitProtectedOperation;
	cwd: string;
	reason: string;
	subcommand: string;
	targetBranch?: string;
}

export interface GitBranchCreation {
	cwd: string;
	branch: string;
	reason: string;
}

export interface GitCommandAnalysis {
	protectedActions: GitProtectedAction[];
	branchCreations: GitBranchCreation[];
}

export interface AgentBranchRecord {
	repoRoot: string;
	branch: string;
	createdAt: number;
}

export interface GitProtectedOperationScope {
	operation: GitProtectedOperation;
	repoRoot: string;
	branch: string;
	reason: string;
	cwd: string;
	subcommand: string;
}

export interface GitPermissionRequest {
	toolName: "bash";
	summary: string;
	command: string;
	operations: GitProtectedOperationScope[];
}

export interface GitPermissionGrant {
	operation: GitProtectedOperation;
	repoRoot: string;
	branch: string;
	grantedAt: number;
}

export interface GitRepositoryStateProvider {
	getRepoRoot(cwd: string): Promise<string | undefined>;
	getCurrentBranch(repoRoot: string): Promise<string | undefined>;
	branchExists(repoRoot: string, branch: string): Promise<boolean>;
}

const SHELL_SEPARATORS = new Set([";", "&&", "||", "|", "&"]);
const REDIRECTION_TOKENS = new Set([">", ">>", "<", "<<", "<<<", "1>", "1>>", "2>", "2>>", "&>", "&>>"]);
const SUDO_OPTIONS_WITH_VALUE = new Set([
	"-u",
	"--user",
	"-g",
	"--group",
	"-h",
	"--host",
	"-p",
	"--prompt",
	"-C",
	"--close-from",
	"-t",
	"--type",
	"-r",
	"--role",
]);
const ENV_OPTIONS_WITH_VALUE = new Set(["-u", "--unset", "-C", "--chdir"]);
const GIT_GLOBAL_OPTIONS_WITH_VALUE = new Set([
	"-C",
	"-c",
	"--git-dir",
	"--work-tree",
	"--namespace",
	"--exec-path",
	"--html-path",
	"--man-path",
	"--info-path",
	"--paginate",
]);

export class AgentBranchRegistry {
	private readonly prefixes: readonly string[];
	private readonly trackedBranches = new Map<string, AgentBranchRecord>();

	constructor(prefixes: readonly string[]) {
		this.prefixes = prefixes;
	}

	add(repoRoot: string, branch: string, createdAt = Date.now()): void {
		this.trackedBranches.set(branchKey(repoRoot, branch), { repoRoot: normalizePath(repoRoot), branch, createdAt });
	}

	clearTracked(): void {
		this.trackedBranches.clear();
	}

	isAgentBranch(repoRoot: string, branch: string): boolean {
		return this.prefixes.some((prefix) => branch.startsWith(prefix)) || this.trackedBranches.has(branchKey(repoRoot, branch));
	}

	listTracked(): AgentBranchRecord[] {
		return Array.from(this.trackedBranches.values()).map((record) => ({ ...record }));
	}
}

export class GitPermissionStore {
	private readonly grants: GitPermissionGrant[] = [];

	list(): GitPermissionGrant[] {
		return this.grants.map((grant) => ({ ...grant }));
	}

	clear(): void {
		this.grants.length = 0;
	}

	hasGrant(request: GitPermissionRequest): boolean {
		return request.operations.every((operation) =>
			this.grants.some(
				(grant) =>
					grant.operation === operation.operation &&
					grant.repoRoot === operation.repoRoot &&
					grant.branch === operation.branch,
			),
		);
	}

	addSessionGrant(request: GitPermissionRequest, now = Date.now()): void {
		for (const operation of request.operations) {
			const alreadyGranted = this.grants.some(
				(grant) =>
					grant.operation === operation.operation &&
					grant.repoRoot === operation.repoRoot &&
					grant.branch === operation.branch,
			);
			if (!alreadyGranted) {
				this.grants.push({
					operation: operation.operation,
					repoRoot: operation.repoRoot,
					branch: operation.branch,
					grantedAt: now,
				});
			}
		}
	}
}

export function analyzeGitCommands(command: string, cwd: string): GitCommandAnalysis {
	const tokens = tokenizeShell(command);
	const commands = splitShellCommands(tokens);
	const protectedActions: GitProtectedAction[] = [];
	const branchCreations: GitBranchCreation[] = [];
	let effectiveCwd = normalizePath(cwd);

	for (const commandTokens of commands) {
		const executableTokens = stripRedirections(commandTokens);
		const parsed = unwrapCommand(executableTokens);
		if (!parsed) continue;

		const commandName = basename(parsed.name);
		if (commandName === "cd") {
			effectiveCwd = resolveCdTarget(parsed.args, effectiveCwd) ?? effectiveCwd;
			continue;
		}

		if (commandName !== "git") continue;

		const git = parseGitInvocation(parsed.args, effectiveCwd);
		if (!git) continue;

		const result = analyzeGitInvocation(git.subcommand, git.args, git.cwd);
		protectedActions.push(...result.protectedActions);
		branchCreations.push(...result.branchCreations);
	}

	return { protectedActions, branchCreations };
}

export async function buildGitPermissionRequest(
	actions: GitProtectedAction[],
	command: string,
	stateProvider: GitRepositoryStateProvider,
	agentBranches: AgentBranchRegistry,
): Promise<GitPermissionRequest | undefined> {
	const operations: GitProtectedOperationScope[] = [];

	for (const action of actions) {
		const repoRoot = await stateProvider.getRepoRoot(action.cwd);
		if (!repoRoot) continue;
		const normalizedRepoRoot = normalizePath(repoRoot);

		if (action.targetBranch) {
			const exists = await stateProvider.branchExists(normalizedRepoRoot, action.targetBranch);
			if (!exists) continue;
			if (agentBranches.isAgentBranch(normalizedRepoRoot, action.targetBranch)) continue;
			operations.push({
				operation: action.operation,
				repoRoot: normalizedRepoRoot,
				branch: action.targetBranch,
				reason: action.reason,
				cwd: action.cwd,
				subcommand: action.subcommand,
			});
			continue;
		}

		const currentBranch = await stateProvider.getCurrentBranch(normalizedRepoRoot);
		if (!currentBranch || currentBranch === "HEAD") continue;
		if (agentBranches.isAgentBranch(normalizedRepoRoot, currentBranch)) continue;

		operations.push({
			operation: action.operation,
			repoRoot: normalizedRepoRoot,
			branch: currentBranch,
			reason: action.reason,
			cwd: action.cwd,
			subcommand: action.subcommand,
		});
	}

	if (operations.length === 0) return undefined;

	return {
		toolName: "bash",
		summary: "git command mutates an existing non-agent branch or its working tree",
		command,
		operations: dedupeOperations(operations),
	};
}

export async function resolveBranchCreations(
	creations: GitBranchCreation[],
	stateProvider: GitRepositoryStateProvider,
): Promise<AgentBranchRecord[]> {
	const records: AgentBranchRecord[] = [];
	for (const creation of creations) {
		const repoRoot = await stateProvider.getRepoRoot(creation.cwd);
		if (!repoRoot) continue;
		const normalizedRepoRoot = normalizePath(repoRoot);
		if (await stateProvider.branchExists(normalizedRepoRoot, creation.branch)) continue;
		records.push({ repoRoot: normalizedRepoRoot, branch: creation.branch, createdAt: Date.now() });
	}
	return dedupeBranchRecords(records);
}

function analyzeGitInvocation(subcommand: string, args: string[], cwd: string): GitCommandAnalysis {
	const protectedActions: GitProtectedAction[] = [];
	const branchCreations: GitBranchCreation[] = [];

	switch (subcommand) {
		case "merge":
			protectedActions.push(protectedCurrentBranchAction("merge", subcommand, cwd, "git merge can modify branch history"));
			break;
		case "pull":
			protectedActions.push(protectedCurrentBranchAction("pull", subcommand, cwd, "git pull can merge or fast-forward the current branch"));
			break;
		case "rebase":
			protectedActions.push(protectedCurrentBranchAction("rebase", subcommand, cwd, "git rebase rewrites current branch history"));
			break;
		case "reset":
			protectedActions.push(protectedCurrentBranchAction("reset", subcommand, cwd, "git reset mutates the current branch or index"));
			break;
		case "clean":
			if (!hasCleanDryRunOption(args)) {
				protectedActions.push(protectedCurrentBranchAction("clean", subcommand, cwd, "git clean deletes untracked working-tree files"));
			}
			break;
		case "restore":
			protectedActions.push(protectedCurrentBranchAction("restore", subcommand, cwd, "git restore mutates the working tree or index"));
			break;
		case "cherry-pick":
			protectedActions.push(protectedCurrentBranchAction("cherry-pick", subcommand, cwd, "git cherry-pick adds commits to the current branch"));
			break;
		case "revert":
			protectedActions.push(protectedCurrentBranchAction("revert", subcommand, cwd, "git revert adds commits to the current branch"));
			break;
		case "commit":
			if (hasLongOption(args, "--amend")) {
				protectedActions.push(protectedCurrentBranchAction("amend", subcommand, cwd, "git commit --amend rewrites the current branch tip"));
			}
			break;
		case "push":
			if (hasForcePushOption(args)) {
				protectedActions.push(protectedCurrentBranchAction("force-push", subcommand, cwd, "git push with force can overwrite remote branch history"));
			}
			break;
		case "branch":
			analyzeGitBranch(args, cwd, protectedActions, branchCreations);
			break;
		case "checkout":
			analyzeCheckoutOrSwitch(args, cwd, "checkout", protectedActions, branchCreations);
			if (hasExplicitCheckoutPaths(args)) {
				protectedActions.push(
					protectedCurrentBranchAction("checkout-paths", subcommand, cwd, "git checkout -- <paths> overwrites working-tree files"),
				);
			}
			break;
		case "switch":
			analyzeCheckoutOrSwitch(args, cwd, "switch", protectedActions, branchCreations);
			break;
		case "worktree":
			analyzeWorktree(args, cwd, branchCreations);
			break;
	}

	return { protectedActions, branchCreations };
}

function protectedCurrentBranchAction(
	operation: GitProtectedOperation,
	subcommand: string,
	cwd: string,
	reason: string,
): GitProtectedAction {
	return { operation, subcommand, cwd, reason };
}

function analyzeGitBranch(
	args: string[],
	cwd: string,
	protectedActions: GitProtectedAction[],
	branchCreations: GitBranchCreation[],
): void {
	const nonOptionArgs = getNonOptionArgs(args, branchOptionsWithValues());

	if (hasBranchDeleteOption(args)) {
		for (const targetBranch of nonOptionArgs) {
			protectedActions.push({
				operation: "branch-delete",
				subcommand: "branch",
				cwd,
				targetBranch,
				reason: `git branch delete targets ${targetBranch}`,
			});
		}
		return;
	}

	if (hasBranchRenameOption(args)) {
		const targetBranch = nonOptionArgs.length >= 2 ? nonOptionArgs[0] : undefined;
		protectedActions.push({
			operation: "branch-rename",
			subcommand: "branch",
			cwd,
			targetBranch,
			reason: targetBranch ? `git branch rename targets ${targetBranch}` : "git branch rename targets the current branch",
		});
		return;
	}

	if (hasBranchForceOption(args)) {
		const targetBranch = nonOptionArgs[0];
		if (!targetBranch) return;
		protectedActions.push({
			operation: "branch-force",
			subcommand: "branch",
			cwd,
			targetBranch,
			reason: `git branch -f can reset ${targetBranch}`,
		});
		branchCreations.push({ cwd, branch: targetBranch, reason: "git branch -f can create a branch if it does not already exist" });
		return;
	}

	if (nonOptionArgs.length >= 1 && !hasBranchListOnlyOption(args)) {
		branchCreations.push({ cwd, branch: nonOptionArgs[0] ?? "", reason: "git branch created by agent" });
	}
}

function analyzeCheckoutOrSwitch(
	args: string[],
	cwd: string,
	subcommand: "checkout" | "switch",
	protectedActions: GitProtectedAction[],
	branchCreations: GitBranchCreation[],
): void {
	const createFlag = getOptionValue(args, subcommand === "checkout" ? ["-b"] : ["-c", "--create"]);
	if (createFlag) {
		branchCreations.push({ cwd, branch: createFlag, reason: `git ${subcommand} creates a branch` });
	}

	const forceFlag = getOptionValue(args, subcommand === "checkout" ? ["-B"] : ["-C", "--force-create"]);
	if (forceFlag) {
		protectedActions.push({
			operation: "branch-force",
			subcommand,
			cwd,
			targetBranch: forceFlag,
			reason: `git ${subcommand} force-creates or resets ${forceFlag}`,
		});
		branchCreations.push({ cwd, branch: forceFlag, reason: `git ${subcommand} force-creates a branch if it does not already exist` });
	}
}

function analyzeWorktree(args: string[], cwd: string, branchCreations: GitBranchCreation[]): void {
	const [subcommand, ...rest] = args;
	if (subcommand !== "add") return;
	const branch = getOptionValue(rest, ["-b", "-B"]);
	if (branch) branchCreations.push({ cwd, branch, reason: "git worktree add created by agent" });
}

function parseGitInvocation(args: string[], cwd: string): { subcommand: string; args: string[]; cwd: string } | undefined {
	let index = 0;
	let effectiveCwd = cwd;

	while (index < args.length) {
		const arg = args[index] ?? "";

		if (arg === "-C") {
			const value = args[index + 1];
			if (value) effectiveCwd = resolvePathArgument(value, effectiveCwd) ?? effectiveCwd;
			index += 2;
			continue;
		}

		if (arg.startsWith("-C") && arg.length > 2) {
			effectiveCwd = resolvePathArgument(arg.slice(2), effectiveCwd) ?? effectiveCwd;
			index += 1;
			continue;
		}

		if (arg.startsWith("--git-dir=") || arg.startsWith("--work-tree=") || arg.startsWith("--namespace=")) {
			index += 1;
			continue;
		}

		if (GIT_GLOBAL_OPTIONS_WITH_VALUE.has(arg)) {
			index += 2;
			continue;
		}

		if (arg.startsWith("-")) {
			index += 1;
			continue;
		}

		return { subcommand: arg, args: args.slice(index + 1), cwd: effectiveCwd };
	}

	return undefined;
}

function resolveCdTarget(args: string[], currentCwd: string): string | undefined {
	const target = getNonOptionArgs(args, new Set())[0] ?? "~";
	return resolvePathArgument(target, currentCwd);
}

function getOptionValue(args: string[], names: readonly string[]): string | undefined {
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index] ?? "";
		for (const name of names) {
			if (arg === name) return args[index + 1];
			if (name.startsWith("--") && arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
		}
	}
	return undefined;
}

function hasForcePushOption(args: string[]): boolean {
	return args.some((arg) => arg === "-f" || /^-[^-]*f/.test(arg) || arg === "--force" || arg.startsWith("--force-with-lease"));
}

function hasCleanDryRunOption(args: string[]): boolean {
	for (const arg of args) {
		if (arg === "--") return false;
		if (arg === "--dry-run" || /^-[^-]*n/.test(arg)) return true;
	}
	return false;
}

function hasExplicitCheckoutPaths(args: string[]): boolean {
	const delimiterIndex = args.indexOf("--");
	return delimiterIndex >= 0 && delimiterIndex < args.length - 1;
}

function hasLongOption(args: string[], option: string): boolean {
	return args.some((arg) => arg === option || arg.startsWith(`${option}=`));
}

function hasBranchDeleteOption(args: string[]): boolean {
	return args.some((arg) => arg === "-d" || arg === "-D" || arg === "--delete");
}

function hasBranchRenameOption(args: string[]): boolean {
	return args.some((arg) => arg === "-m" || arg === "-M" || arg === "--move");
}

function hasBranchForceOption(args: string[]): boolean {
	return args.some((arg) => arg === "-f" || arg === "--force");
}

function hasBranchListOnlyOption(args: string[]): boolean {
	return args.some((arg) => arg === "-a" || arg === "-r" || arg === "--all" || arg === "--remotes" || arg === "--list");
}

function branchOptionsWithValues(): Set<string> {
	return new Set(["--format", "--sort", "--contains", "--points-at", "--merged", "--no-merged", "--color", "--column"]);
}

function getNonOptionArgs(args: string[], optionsWithValues: Set<string>): string[] {
	const result: string[] = [];
	let endOfOptions = false;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (!arg) continue;
		if (isRedirection(arg)) {
			index += 1;
			continue;
		}
		if (!endOfOptions && arg === "--") {
			endOfOptions = true;
			continue;
		}
		if (!endOfOptions && optionsWithValues.has(arg)) {
			index += 1;
			continue;
		}
		if (!endOfOptions && Array.from(optionsWithValues).some((option) => arg.startsWith(`${option}=`))) continue;
		if (!endOfOptions && arg.startsWith("-") && arg !== "-") continue;
		result.push(arg);
	}
	return result;
}

function dedupeOperations(operations: GitProtectedOperationScope[]): GitProtectedOperationScope[] {
	const seen = new Set<string>();
	const unique: GitProtectedOperationScope[] = [];
	for (const operation of operations) {
		const key = `${operation.operation}\0${operation.repoRoot}\0${operation.branch}`;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(operation);
	}
	return unique;
}

function dedupeBranchRecords(records: AgentBranchRecord[]): AgentBranchRecord[] {
	const seen = new Set<string>();
	const unique: AgentBranchRecord[] = [];
	for (const record of records) {
		const key = branchKey(record.repoRoot, record.branch);
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(record);
	}
	return unique;
}

function branchKey(repoRoot: string, branch: string): string {
	return `${normalizePath(repoRoot)}\0${branch}`;
}

function normalizePath(pathValue: string): string {
	const normalized = normalize(pathValue);
	return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function resolvePathArgument(rawPath: string | undefined, cwd: string): string | undefined {
	if (!rawPath) return undefined;
	let value = rawPath.trim();
	if (!value || value === "-") return undefined;

	if (value === "~") {
		value = process.env.HOME ?? value;
	} else if (value.startsWith("~/")) {
		value = resolve(process.env.HOME ?? ".", value.slice(2));
	}

	return normalizePath(isAbsolute(value) ? resolve(value) : resolve(cwd, value));
}

function stripRedirections(tokens: string[]): string[] {
	const result: string[] = [];
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token && isRedirection(token)) {
			index += 1;
			continue;
		}
		if (token) result.push(token);
	}
	return result;
}

function isRedirection(token: string): boolean {
	return REDIRECTION_TOKENS.has(token) || /^(?:\d+)?[<>]{1,3}$/.test(token) || /^&>>?$/.test(token);
}

function unwrapCommand(tokens: string[]): { name: string; args: string[] } | undefined {
	let index = 0;
	while (index < tokens.length) {
		const token = tokens[index];
		if (!token) return undefined;
		const commandName = basename(token);

		if (isEnvAssignment(token) || commandName === "command" || commandName === "builtin" || commandName === "noglob") {
			index += 1;
			continue;
		}

		if (commandName === "sudo") {
			index = skipWrapperOptions(tokens, index + 1, SUDO_OPTIONS_WITH_VALUE);
			continue;
		}

		if (commandName === "env") {
			index = skipWrapperOptions(tokens, index + 1, ENV_OPTIONS_WITH_VALUE);
			while (index < tokens.length && isEnvAssignment(tokens[index] ?? "")) index += 1;
			continue;
		}

		return { name: token, args: tokens.slice(index + 1) };
	}
	return undefined;
}

function skipWrapperOptions(tokens: string[], startIndex: number, optionsWithValue: Set<string>): number {
	let index = startIndex;
	while (index < tokens.length) {
		const token = tokens[index] ?? "";
		if (!token.startsWith("-") || token === "--") {
			if (token === "--") index += 1;
			break;
		}
		index += 1;
		if (optionsWithValue.has(token) && index < tokens.length) index += 1;
	}
	return index;
}

function isEnvAssignment(token: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function splitShellCommands(tokens: string[]): string[][] {
	const commands: string[][] = [];
	let current: string[] = [];
	for (const token of tokens) {
		if (SHELL_SEPARATORS.has(token)) {
			if (current.length > 0) {
				commands.push(current);
				current = [];
			}
			continue;
		}
		current.push(token);
	}
	if (current.length > 0) commands.push(current);
	return commands;
}

function tokenizeShell(command: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let escaped = false;

	const flush = () => {
		if (current.length > 0) {
			tokens.push(current);
			current = "";
		}
	};

	for (let index = 0; index < command.length; index += 1) {
		const char = command[index] ?? "";
		const next = command[index + 1];

		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}

		if (char === "\\") {
			escaped = true;
			continue;
		}

		if (quote) {
			if (char === quote) quote = undefined;
			else current += char;
			continue;
		}

		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}

		if (/\s/.test(char)) {
			flush();
			continue;
		}

		if (char === ";") {
			flush();
			tokens.push(char);
			continue;
		}

		if ((char === "&" && next === "&") || (char === "|" && next === "|")) {
			flush();
			tokens.push(`${char}${next}`);
			index += 1;
			continue;
		}

		if (char === "&" && next === ">") {
			flush();
			if (command[index + 2] === ">") {
				tokens.push("&>>");
				index += 2;
			} else {
				tokens.push("&>");
				index += 1;
			}
			continue;
		}

		if (char === "|" || char === "&") {
			flush();
			tokens.push(char);
			continue;
		}

		if (char === ">" || char === "<") {
			flush();
			if (next === char && command[index + 2] === char) {
				tokens.push(`${char}${char}${char}`);
				index += 2;
			} else if (next === char) {
				tokens.push(`${char}${char}`);
				index += 1;
			} else {
				tokens.push(char);
			}
			continue;
		}

		current += char;
	}

	flush();
	return tokens;
}
