import { basename, isAbsolute, normalize, resolve } from "node:path";

export type PackageManager =
	| "npm"
	| "npx"
	| "yarn"
	| "pnpm"
	| "bun"
	| "bunx"
	| "pip"
	| "uv"
	| "uvx"
	| "poetry"
	| "pipenv"
	| "brew"
	| "apt"
	| "apt-get"
	| "dnf"
	| "yum"
	| "cargo"
	| "go"
	| "gem";

export type PackageOperation = "dependency-install" | "global-install" | "package-execute" | "system-install";

export interface PackageProtectedAction {
	manager: PackageManager;
	operation: PackageOperation;
	cwd: string;
	reason: string;
	commandName: string;
	subcommand?: string;
}

export interface PackageCommandAnalysis {
	actions: PackageProtectedAction[];
}

export interface PackageProjectResolver {
	getProjectRoot(cwd: string): Promise<string>;
}

export interface PackagePermissionScope {
	manager: PackageManager;
	operation: PackageOperation;
	projectRoot: string;
	cwd: string;
	reason: string;
	commandName: string;
	subcommand?: string;
}

export interface PackagePermissionRequest {
	toolName: "bash";
	summary: string;
	command: string;
	scopes: PackagePermissionScope[];
}

export interface PackagePermissionGrant {
	manager: PackageManager;
	operation: PackageOperation;
	projectRoot: string;
	grantedAt: number;
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
const NPM_PROJECT_OPTIONS_WITH_VALUE = new Set(["--prefix"]);
const PIP_PROJECT_OPTIONS_WITH_VALUE = new Set(["--target", "-t", "--prefix"]);

export class PackagePermissionStore {
	private readonly grants: PackagePermissionGrant[] = [];

	list(): PackagePermissionGrant[] {
		return this.grants.map((grant) => ({ ...grant }));
	}

	clear(): void {
		this.grants.length = 0;
	}

	hasGrant(request: PackagePermissionRequest): boolean {
		return request.scopes.every((scope) =>
			this.grants.some(
				(grant) =>
					grant.manager === scope.manager &&
					grant.operation === scope.operation &&
					grant.projectRoot === scope.projectRoot,
			),
		);
	}

	addSessionGrant(request: PackagePermissionRequest, now = Date.now()): void {
		for (const scope of request.scopes) {
			const alreadyGranted = this.grants.some(
				(grant) =>
					grant.manager === scope.manager &&
					grant.operation === scope.operation &&
					grant.projectRoot === scope.projectRoot,
			);
			if (!alreadyGranted) {
				this.grants.push({
					manager: scope.manager,
					operation: scope.operation,
					projectRoot: scope.projectRoot,
					grantedAt: now,
				});
			}
		}
	}
}

export function analyzePackageCommands(command: string, cwd: string): PackageCommandAnalysis {
	const tokens = tokenizeShell(command);
	const commands = splitShellCommands(tokens);
	const actions: PackageProtectedAction[] = [];
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

		actions.push(...analyzePackageInvocation(commandName, parsed.args, effectiveCwd));
	}

	return { actions: dedupeActions(actions) };
}

export async function buildPackagePermissionRequest(
	actions: PackageProtectedAction[],
	command: string,
	projectResolver: PackageProjectResolver,
): Promise<PackagePermissionRequest | undefined> {
	const scopes: PackagePermissionScope[] = [];

	for (const action of actions) {
		const projectRoot = normalizePath(await projectResolver.getProjectRoot(action.cwd));
		scopes.push({
			manager: action.manager,
			operation: action.operation,
			projectRoot,
			cwd: action.cwd,
			reason: action.reason,
			commandName: action.commandName,
			subcommand: action.subcommand,
		});
	}

	const uniqueScopes = dedupeScopes(scopes);
	if (uniqueScopes.length === 0) return undefined;

	return {
		toolName: "bash",
		summary: "package/dependency acquisition command",
		command,
		scopes: uniqueScopes,
	};
}

function analyzePackageInvocation(commandName: string, args: string[], cwd: string): PackageProtectedAction[] {
	if (commandName === "npm") return analyzeNpm(args, cwd);
	if (commandName === "npx") return analyzeStandalonePackageExecutor("npx", args, cwd);
	if (commandName === "yarn") return analyzeYarn(args, cwd);
	if (commandName === "pnpm") return analyzePnpm(args, cwd);
	if (commandName === "bun") return analyzeBun(args, cwd);
	if (commandName === "bunx") return analyzeStandalonePackageExecutor("bunx", args, cwd);
	if (isPipCommand(commandName)) return analyzePip(args, cwd, "pip");
	if (isPythonCommand(commandName)) return analyzePython(args, cwd);
	if (commandName === "uv") return analyzeUv(args, cwd);
	if (commandName === "uvx") return analyzeStandalonePackageExecutor("uvx", args, cwd);
	if (commandName === "poetry") return analyzeSimpleManager("poetry", args, cwd, new Set(["add", "install", "update", "sync"]));
	if (commandName === "pipenv") return analyzeSimpleManager("pipenv", args, cwd, new Set(["install", "sync", "update"]));
	if (commandName === "brew") return analyzeSimpleManager("brew", args, cwd, new Set(["install", "upgrade", "reinstall"]), "system-install");
	if (commandName === "apt" || commandName === "apt-get") return analyzeApt(commandName, args, cwd);
	if (commandName === "dnf" || commandName === "yum") return analyzeYumLike(commandName, args, cwd);
	if (commandName === "cargo") return analyzeCargo(args, cwd);
	if (commandName === "go") return analyzeGo(args, cwd);
	if (commandName === "gem") return analyzeSimpleManager("gem", args, cwd, new Set(["install", "update"]), "global-install");
	return [];
}

function analyzeNpm(args: string[], cwd: string): PackageProtectedAction[] {
	const scopedCwd = resolveFirstOptionPath(args, NPM_PROJECT_OPTIONS_WITH_VALUE, cwd) ?? cwd;
	const subcommand = firstNonOption(args, new Set(["--prefix", "--cache", "--registry", "--userconfig", "--globalconfig"]));
	if (!subcommand) return [];
	const name = normalizeSubcommand(subcommand.value);
	const isGlobal = hasGlobalFlag(args);

	if (["install", "i", "add", "ci", "update", "up", "upgrade"].includes(name)) {
		return [
			packageAction("npm", isGlobal ? "global-install" : "dependency-install", scopedCwd, "npm installs or updates packages", "npm", name),
		];
	}

	if ((name === "exec" || name === "x") && !hasNoInstallFlag(args)) {
		return [packageAction("npm", "package-execute", scopedCwd, "npm exec may download and run a package", "npm", name)];
	}

	return [];
}

function analyzeStandalonePackageExecutor(manager: "npx" | "bunx" | "uvx", args: string[], cwd: string): PackageProtectedAction[] {
	if (hasNoInstallFlag(args)) return [];
	return [packageAction(manager, "package-execute", cwd, `${manager} may download and run a package`, manager)];
}

function analyzeYarn(args: string[], cwd: string): PackageProtectedAction[] {
	const subcommand = firstNonOption(args, new Set(["--cwd", "--cache-folder", "--registry"]));
	const scopedCwd = resolveFirstOptionPath(args, new Set(["--cwd"]), cwd) ?? cwd;
	if (!subcommand) {
		if (args.some((arg) => arg === "--version" || arg === "-v" || arg === "--help" || arg === "-h")) return [];
		return [packageAction("yarn", "dependency-install", scopedCwd, "yarn with no command runs install", "yarn", "install")];
	}

	const name = normalizeSubcommand(subcommand.value);
	if (name === "global" && args[subcommand.index + 1] === "add") {
		return [packageAction("yarn", "global-install", scopedCwd, "yarn global add installs packages globally", "yarn", "global add")];
	}
	if (["add", "install", "upgrade", "up"].includes(name)) {
		return [packageAction("yarn", "dependency-install", scopedCwd, "yarn installs or updates packages", "yarn", name)];
	}
	if (name === "dlx" && !hasNoInstallFlag(args)) {
		return [packageAction("yarn", "package-execute", scopedCwd, "yarn dlx may download and run a package", "yarn", name)];
	}
	return [];
}

function analyzePnpm(args: string[], cwd: string): PackageProtectedAction[] {
	const subcommand = firstNonOption(args, new Set(["--dir", "-C", "--config", "--store-dir"]));
	const scopedCwd = resolveFirstOptionPath(args, new Set(["--dir", "-C"]), cwd) ?? cwd;
	if (!subcommand) return [];
	const name = normalizeSubcommand(subcommand.value);
	const isGlobal = hasGlobalFlag(args);
	if (["add", "install", "i", "update", "up"].includes(name)) {
		return [packageAction("pnpm", isGlobal ? "global-install" : "dependency-install", scopedCwd, "pnpm installs or updates packages", "pnpm", name)];
	}
	if (name === "dlx" && !hasNoInstallFlag(args)) {
		return [packageAction("pnpm", "package-execute", scopedCwd, "pnpm dlx may download and run a package", "pnpm", name)];
	}
	return [];
}

function analyzeBun(args: string[], cwd: string): PackageProtectedAction[] {
	const subcommand = firstNonOption(args, new Set(["--cwd", "-C"]));
	const scopedCwd = resolveFirstOptionPath(args, new Set(["--cwd", "-C"]), cwd) ?? cwd;
	if (!subcommand) return [];
	const name = normalizeSubcommand(subcommand.value);
	if (["add", "install", "i", "update", "upgrade"].includes(name)) {
		return [packageAction("bun", "dependency-install", scopedCwd, "bun installs or updates packages", "bun", name)];
	}
	if ((name === "x" || name === "bunx") && !hasNoInstallFlag(args)) {
		return [packageAction("bun", "package-execute", scopedCwd, "bun x may download and run a package", "bun", name)];
	}
	return [];
}

function analyzePip(args: string[], cwd: string, commandName: string): PackageProtectedAction[] {
	const subcommand = firstNonOption(args, new Set(["--python", "--config-settings", "--index-url", "--extra-index-url"]));
	if (!subcommand) return [];
	const name = normalizeSubcommand(subcommand.value);
	if (!["install", "download", "wheel"].includes(name)) return [];
	const scopedCwd = resolveFirstOptionPath(args.slice(subcommand.index + 1), PIP_PROJECT_OPTIONS_WITH_VALUE, cwd) ?? cwd;
	return [packageAction("pip", "dependency-install", scopedCwd, "pip installs or downloads Python packages", commandName, name)];
}

function analyzePython(args: string[], cwd: string): PackageProtectedAction[] {
	const moduleIndex = args.findIndex((arg) => arg === "-m");
	if (moduleIndex < 0) return [];
	const moduleName = args[moduleIndex + 1];
	if (!moduleName || !isPipCommand(moduleName)) return [];
	return analyzePip(args.slice(moduleIndex + 2), cwd, "python -m pip");
}

function analyzeUv(args: string[], cwd: string): PackageProtectedAction[] {
	const subcommand = firstNonOption(args, new Set(["--project", "--directory", "--config-file"]));
	const scopedCwd = resolveFirstOptionPath(args, new Set(["--project", "--directory"]), cwd) ?? cwd;
	if (!subcommand) return [];
	const name = normalizeSubcommand(subcommand.value);
	if (["add", "sync"].includes(name)) {
		return [packageAction("uv", "dependency-install", scopedCwd, "uv installs or syncs Python packages", "uv", name)];
	}
	if (name === "pip") {
		const pipSubcommand = firstNonOption(args.slice(subcommand.index + 1), new Set(["--python", "--system"]));
		if (pipSubcommand && ["install", "sync"].includes(normalizeSubcommand(pipSubcommand.value))) {
			return [packageAction("uv", "dependency-install", scopedCwd, "uv pip installs or syncs Python packages", "uv", `pip ${pipSubcommand.value}`)];
		}
	}
	if (name === "tool") {
		const toolSubcommand = firstNonOption(args.slice(subcommand.index + 1), new Set());
		if (toolSubcommand && normalizeSubcommand(toolSubcommand.value) === "install") {
			return [packageAction("uv", "global-install", scopedCwd, "uv tool install installs Python tools", "uv", "tool install")];
		}
		if (toolSubcommand && normalizeSubcommand(toolSubcommand.value) === "run" && !hasNoInstallFlag(args)) {
			return [packageAction("uv", "package-execute", scopedCwd, "uv tool run may download and run a package", "uv", "tool run")];
		}
	}
	return [];
}

function analyzeSimpleManager(
	manager: PackageManager,
	args: string[],
	cwd: string,
	guardedSubcommands: Set<string>,
	operation: PackageOperation = "dependency-install",
): PackageProtectedAction[] {
	const subcommand = firstNonOption(args, new Set());
	if (!subcommand) return [];
	const name = normalizeSubcommand(subcommand.value);
	if (!guardedSubcommands.has(name)) return [];
	return [packageAction(manager, operation, cwd, `${manager} ${name} acquires packages`, manager, name)];
}

function analyzeApt(commandName: "apt" | "apt-get", args: string[], cwd: string): PackageProtectedAction[] {
	const subcommand = firstNonOption(args, new Set(["-o", "-c"]));
	if (!subcommand) return [];
	const name = normalizeSubcommand(subcommand.value);
	if (!["install", "upgrade", "dist-upgrade", "full-upgrade", "reinstall"].includes(name)) return [];
	return [packageAction(commandName, "system-install", cwd, `${commandName} ${name} installs or upgrades system packages`, commandName, name)];
}

function analyzeYumLike(commandName: "dnf" | "yum", args: string[], cwd: string): PackageProtectedAction[] {
	const subcommand = firstNonOption(args, new Set(["--config", "-c", "--setopt"]));
	if (!subcommand) return [];
	const name = normalizeSubcommand(subcommand.value);
	if (!["install", "update", "upgrade", "groupinstall", "localinstall", "reinstall"].includes(name)) return [];
	return [packageAction(commandName, "system-install", cwd, `${commandName} ${name} installs or updates system packages`, commandName, name)];
}

function analyzeCargo(args: string[], cwd: string): PackageProtectedAction[] {
	const subcommand = firstNonOption(args, new Set(["--config", "-Z"]));
	if (!subcommand || normalizeSubcommand(subcommand.value) !== "install") return [];
	return [packageAction("cargo", "global-install", cwd, "cargo install downloads and installs Rust binaries", "cargo", "install")];
}

function analyzeGo(args: string[], cwd: string): PackageProtectedAction[] {
	const subcommand = firstNonOption(args, new Set());
	if (!subcommand) return [];
	const name = normalizeSubcommand(subcommand.value);
	if (name === "install") return [packageAction("go", "global-install", cwd, "go install downloads and installs Go binaries", "go", name)];
	if (name === "get") return [packageAction("go", "dependency-install", cwd, "go get downloads or updates Go module dependencies", "go", name)];
	return [];
}

function packageAction(
	manager: PackageManager,
	operation: PackageOperation,
	cwd: string,
	reason: string,
	commandName: string,
	subcommand?: string,
): PackageProtectedAction {
	return { manager, operation, cwd: normalizePath(cwd), reason, commandName, subcommand };
}

function normalizeSubcommand(value: string): string {
	return value.trim().toLowerCase();
}

function hasGlobalFlag(args: string[]): boolean {
	return args.some((arg) => arg === "-g" || arg === "--global" || arg === "--location=global");
}

function hasNoInstallFlag(args: string[]): boolean {
	return args.some((arg) => arg === "--no-install" || arg === "--offline");
}

function firstNonOption(args: string[], optionsWithValues: Set<string>): { value: string; index: number } | undefined {
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
		return { value: arg, index };
	}
	return undefined;
}

function resolveFirstOptionPath(args: string[], optionNames: Set<string>, cwd: string): string | undefined {
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (!arg) continue;
		if (optionNames.has(arg)) {
			return resolvePathArgument(args[index + 1], cwd);
		}
		for (const optionName of optionNames) {
			if (arg.startsWith(`${optionName}=`)) return resolvePathArgument(arg.slice(optionName.length + 1), cwd);
		}
	}
	return undefined;
}

function isPipCommand(commandName: string): boolean {
	return /^pip(?:\d+(?:\.\d+)?)?$/.test(commandName);
}

function isPythonCommand(commandName: string): boolean {
	return /^(?:python(?:\d+(?:\.\d+)?)?|py)$/.test(commandName);
}

function dedupeActions(actions: PackageProtectedAction[]): PackageProtectedAction[] {
	const seen = new Set<string>();
	const unique: PackageProtectedAction[] = [];
	for (const action of actions) {
		const key = `${action.manager}\0${action.operation}\0${action.cwd}\0${action.subcommand ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(action);
	}
	return unique;
}

function dedupeScopes(scopes: PackagePermissionScope[]): PackagePermissionScope[] {
	const seen = new Set<string>();
	const unique: PackagePermissionScope[] = [];
	for (const scope of scopes) {
		const key = `${scope.manager}\0${scope.operation}\0${scope.projectRoot}`;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(scope);
	}
	return unique;
}

function resolveCdTarget(args: string[], currentCwd: string): string | undefined {
	const target = firstNonOption(args, new Set())?.value ?? "~";
	return resolvePathArgument(target, currentCwd);
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
