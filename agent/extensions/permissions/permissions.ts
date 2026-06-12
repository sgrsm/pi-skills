import { homedir } from "node:os";
import { basename, dirname, isAbsolute, normalize, relative, resolve } from "node:path";

export type FilePermissionOperation = "write" | "edit" | "delete" | "bash-mutate";

export interface PermissionTarget {
	operation: FilePermissionOperation;
	path: string;
	scopeDir: string;
	reason: string;
}

export interface PermissionRequest {
	toolName: string;
	summary: string;
	targets: PermissionTarget[];
	command?: string;
}

export interface PermissionGrant {
	operation: FilePermissionOperation;
	scopeDir: string;
	grantedAt: number;
}

const SHELL_SEPARATORS = new Set([";", "&&", "||", "|", "&"]);
const REDIRECTION_TOKENS = new Set([">", ">>", "1>", "1>>", "2>", "2>>", "&>", "&>>"]);
const DELETE_COMMANDS = new Set(["rm", "rmdir", "unlink"]);
const PATH_MUTATION_COMMANDS = new Set(["mv", "mkdir", "touch", "truncate", "ln"]);
const OWNERSHIP_OR_MODE_COMMANDS = new Set(["chmod", "chown", "chgrp"]);
const COPY_LIKE_COMMANDS = new Set(["cp", "install"]);
const TEE_COMMANDS = new Set(["tee"]);
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

export class PermissionStore {
	private readonly grants: PermissionGrant[] = [];

	list(): PermissionGrant[] {
		return this.grants.map((grant) => ({ ...grant }));
	}

	clear(): void {
		this.grants.length = 0;
	}

	hasGrant(request: PermissionRequest): boolean {
		return request.targets.every((target) =>
			this.grants.some(
				(grant) =>
					grant.operation === target.operation && isPathInsideOrEqual(target.scopeDir, grant.scopeDir),
			),
		);
	}

	addSessionGrant(request: PermissionRequest, now = Date.now()): void {
		for (const target of request.targets) {
			const alreadyCovered = this.grants.some(
				(grant) => grant.operation === target.operation && isPathInsideOrEqual(target.scopeDir, grant.scopeDir),
			);
			if (alreadyCovered) continue;

			for (let index = this.grants.length - 1; index >= 0; index -= 1) {
				const grant = this.grants[index];
				if (grant?.operation === target.operation && isPathInsideOrEqual(grant.scopeDir, target.scopeDir)) {
					this.grants.splice(index, 1);
				}
			}

			this.grants.push({ operation: target.operation, scopeDir: target.scopeDir, grantedAt: now });
		}
	}
}

export function isPathInsideOrEqual(candidatePath: string, rootPath: string): boolean {
	const candidate = normalizePath(candidatePath);
	const root = normalizePath(rootPath);
	const rel = relative(root, candidate);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function buildFileMutationRequest(
	operation: "write" | "edit",
	rawPath: string,
	cwd: string,
): PermissionRequest | undefined {
	const targetPath = resolvePathArgument(rawPath, cwd);
	if (!targetPath || isPathInsideOrEqual(targetPath, cwd)) return undefined;

	return {
		toolName: operation,
		summary: `${operation} target is outside the current working directory`,
		targets: [
			{
				operation,
				path: targetPath,
				scopeDir: normalizePath(dirname(targetPath)),
				reason: `${operation} target`,
			},
		],
	};
}

export function analyzeBashMutation(command: string, cwd: string): PermissionRequest | undefined {
	const tokens = tokenizeShell(command);
	const commands = splitShellCommands(tokens);
	const targets: PermissionTarget[] = [];
	let effectiveCwd = cwd;

	for (const commandTokens of commands) {
		const includePlainRelative = !isPathInsideOrEqual(effectiveCwd, cwd);
		const redirectionTargets = collectRedirectionTargets(commandTokens, effectiveCwd, cwd, includePlainRelative);
		targets.push(...redirectionTargets);

		const executableTokens = stripRedirections(commandTokens);
		const parsed = unwrapCommand(executableTokens);
		if (!parsed) continue;

		const commandName = basename(parsed.name);
		const args = parsed.args;

		if (commandName === "cd") {
			effectiveCwd = resolveCdTarget(args, effectiveCwd) ?? effectiveCwd;
			continue;
		}

		if (DELETE_COMMANDS.has(commandName)) {
			targets.push(
				...targetsFromArgs(getNonOptionArgs(args), "delete", "delete target", effectiveCwd, cwd, "path", includePlainRelative),
			);
			continue;
		}

		if (commandName === "find" && args.includes("-delete")) {
			targets.push(...targetsFromFindDelete(args, effectiveCwd, cwd, includePlainRelative));
			continue;
		}

		if (PATH_MUTATION_COMMANDS.has(commandName)) {
			targets.push(
				...targetsFromArgs(
					getNonOptionArgs(args),
					"bash-mutate",
					`${commandName} target`,
					effectiveCwd,
					cwd,
					"path",
					includePlainRelative,
				),
			);
			continue;
		}

		if (OWNERSHIP_OR_MODE_COMMANDS.has(commandName)) {
			const pathArgs = getNonOptionArgs(args).slice(1);
			targets.push(
				...targetsFromArgs(pathArgs, "bash-mutate", `${commandName} target`, effectiveCwd, cwd, "path", includePlainRelative),
			);
			continue;
		}

		if (COPY_LIKE_COMMANDS.has(commandName)) {
			targets.push(
				...targetsFromArgs(
					getCopyDestinations(args),
					"bash-mutate",
					`${commandName} destination`,
					effectiveCwd,
					cwd,
					"path",
					includePlainRelative,
				),
			);
			continue;
		}

		if (TEE_COMMANDS.has(commandName)) {
			targets.push(
				...targetsFromArgs(getNonOptionArgs(args), "bash-mutate", "tee output", effectiveCwd, cwd, "path", includePlainRelative),
			);
			continue;
		}

		if (commandName === "sed" && hasInPlaceOption(args)) {
			targets.push(
				...targetsFromArgs(
					getNonOptionArgs(args).slice(1),
					"bash-mutate",
					"sed in-place target",
					effectiveCwd,
					cwd,
					"path",
					includePlainRelative,
				),
			);
		}
	}

	const outsideTargets = dedupeTargets(targets).filter((target) => !isPathInsideOrEqual(target.path, cwd));
	if (outsideTargets.length === 0) return undefined;

	return {
		toolName: "bash",
		summary: "bash command mutates paths outside the current working directory",
		command,
		targets: outsideTargets,
	};
}

function normalizePath(pathValue: string): string {
	const normalized = normalize(pathValue);
	return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function stripLeadingAt(pathValue: string): string {
	return pathValue.startsWith("@") ? pathValue.slice(1) : pathValue;
}

function resolvePathArgument(rawPath: string | undefined, cwd: string): string | undefined {
	if (!rawPath) return undefined;
	let value = stripLeadingAt(rawPath.trim());
	if (!value || value === "-") return undefined;
	if (value.includes("://")) return undefined;

	if (value === "~") {
		value = homedir();
	} else if (value.startsWith("~/")) {
		value = resolve(homedir(), value.slice(2));
	} else if (value === "$HOME" || value === "${HOME}") {
		value = homedir();
	} else if (value.startsWith("$HOME/")) {
		value = resolve(homedir(), value.slice("$HOME/".length));
	} else if (value.startsWith("${HOME}/")) {
		value = resolve(homedir(), value.slice("${HOME}/".length));
	} else if (value === "$PWD" || value === "${PWD}") {
		value = cwd;
	} else if (value.startsWith("$PWD/")) {
		value = resolve(cwd, value.slice("$PWD/".length));
	} else if (value.startsWith("${PWD}/")) {
		value = resolve(cwd, value.slice("${PWD}/".length));
	}

	return normalizePath(isAbsolute(value) ? resolve(value) : resolve(cwd, value));
}

function looksLikePathArgument(rawArg: string, includePlainRelative = false): boolean {
	const arg = stripLeadingAt(rawArg.trim());
	return (
		arg === "." ||
		arg === ".." ||
		arg === "~" ||
		arg.startsWith("/") ||
		arg.startsWith("./") ||
		arg.startsWith("../") ||
		arg.startsWith("~/") ||
		arg.startsWith("$HOME") ||
		arg.startsWith("${HOME}") ||
		arg.startsWith("$PWD") ||
		arg.startsWith("${PWD}") ||
		arg.includes("/") ||
		(includePlainRelative && isPlainRelativePathCandidate(arg))
	);
}

function isPlainRelativePathCandidate(arg: string): boolean {
	return arg.length > 0 && !arg.startsWith("$") && !arg.includes("=") && !isRedirection(arg) && !SHELL_SEPARATORS.has(arg);
}

function targetsFromArgs(
	args: string[],
	operation: FilePermissionOperation,
	reason: string,
	resolveCwd: string,
	guardCwd: string,
	scopeKind: "path" | "parent",
	includePlainRelative = false,
): PermissionTarget[] {
	const targets: PermissionTarget[] = [];
	for (const arg of args) {
		if (!looksLikePathArgument(arg, includePlainRelative)) continue;
		const path = resolvePathArgument(arg, resolveCwd);
		if (!path || isPathInsideOrEqual(path, guardCwd)) continue;
		const scopeDir = scopeKind === "parent" ? normalizePath(dirname(path)) : path;
		targets.push({ operation, path, scopeDir, reason });
	}
	return targets;
}

function collectRedirectionTargets(
	tokens: string[],
	resolveCwd: string,
	guardCwd: string,
	includePlainRelative: boolean,
): PermissionTarget[] {
	const targets: PermissionTarget[] = [];
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token || !isWriteRedirection(token)) continue;
		const targetArg = tokens[index + 1];
		if (!targetArg || targetArg.startsWith("&")) continue;
		targets.push(
			...targetsFromArgs([targetArg], "bash-mutate", "shell redirection", resolveCwd, guardCwd, "path", includePlainRelative),
		);
	}
	return targets;
}

function targetsFromFindDelete(
	args: string[],
	resolveCwd: string,
	guardCwd: string,
	includePlainRelative: boolean,
): PermissionTarget[] {
	const roots: string[] = [];
	for (const arg of args) {
		if (arg === "-delete") break;
		if (arg.startsWith("-") || arg === "!" || arg === "(") break;
		roots.push(arg);
	}
	return targetsFromArgs(
		roots.length > 0 ? roots : ["."],
		"delete",
		"find -delete root",
		resolveCwd,
		guardCwd,
		"path",
		includePlainRelative,
	);
}

function dedupeTargets(targets: PermissionTarget[]): PermissionTarget[] {
	const seen = new Set<string>();
	const unique: PermissionTarget[] = [];
	for (const target of targets) {
		const key = `${target.operation}\0${target.path}\0${target.scopeDir}`;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(target);
	}
	return unique;
}

function getCopyDestinations(args: string[]): string[] {
	const explicitTargets: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "-t" || arg === "--target-directory") {
			const target = args[index + 1];
			if (target) explicitTargets.push(target);
			index += 1;
			continue;
		}
		if (arg?.startsWith("--target-directory=")) {
			explicitTargets.push(arg.slice("--target-directory=".length));
		}
	}
	if (explicitTargets.length > 0) return explicitTargets;

	const nonOptionArgs = getNonOptionArgs(args);
	return nonOptionArgs.length >= 2 ? [nonOptionArgs[nonOptionArgs.length - 1] ?? ""] : [];
}

function resolveCdTarget(args: string[], currentCwd: string): string | undefined {
	const target = getNonOptionArgs(args)[0] ?? "~";
	return resolvePathArgument(target, currentCwd);
}

function hasInPlaceOption(args: string[]): boolean {
	return args.some((arg) => arg === "-i" || arg.startsWith("-i") || arg === "--in-place" || arg.startsWith("--in-place="));
}

function getNonOptionArgs(args: string[]): string[] {
	const result: string[] = [];
	let endOfOptions = false;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (!arg) continue;
		if (isWriteRedirection(arg)) {
			index += 1;
			continue;
		}
		if (!endOfOptions && arg === "--") {
			endOfOptions = true;
			continue;
		}
		if (!endOfOptions && arg.startsWith("-") && arg !== "-") continue;
		result.push(arg);
	}
	return result;
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
	return REDIRECTION_TOKENS.has(token) || /^(?:\d+)?>>?$/.test(token) || /^&>>?$/.test(token);
}

function isWriteRedirection(token: string): boolean {
	return REDIRECTION_TOKENS.has(token) || /^(?:\d+)?>>?$/.test(token) || /^&>>?$/.test(token);
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

		if (char === ">") {
			flush();
			if (next === ">") {
				tokens.push(">>");
				index += 1;
			} else {
				tokens.push(">");
			}
			continue;
		}

		current += char;
	}

	flush();
	return tokens;
}
