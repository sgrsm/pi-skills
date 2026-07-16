import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, normalize, resolve } from "node:path";

export type CatastrophicDeletionReasonCode =
	| "P0_NO_DELETION"
	| "P0_CONCRETE_NONCRITICAL_DELETE"
	| "P0_DELETE_CRITICAL_TARGET"
	| "P0_DELETE_DYNAMIC_TARGET"
	| "P0_DELETE_BROAD_FIND_ROOT"
	| "P0_DELETE_INDIRECT_EXECUTION"
	| "P0_DELETE_MALFORMED_SYNTAX"
	| "P0_DELETE_UNSUPPORTED_SYNTAX"
	| "P0_DELETE_CONTEXT_RESOLUTION_FAILED"
	| "P0_DELETE_RECURSION_LIMIT"
	| "P0_DELETE_MISSING_TARGET";

export interface CatastrophicTargetEvidence {
	command: "rm" | "rmdir" | "unlink" | "find-delete";
	rawTarget: string;
	resolvedTarget?: string;
	canonicalTarget?: string;
	criticalRoot?: string;
	classification: "concrete" | "critical" | "dynamic" | "broad" | "unresolved";
}

type DecisionDetails = {
	reasonCode: CatastrophicDeletionReasonCode;
	reason: string;
	targets: CatastrophicTargetEvidence[];
};

export type CatastrophicDeletionDecision =
	| ({ kind: "no-visible-deletion" } & DecisionDetails)
	| ({ kind: "concrete-noncritical" } & DecisionDetails)
	| ({ kind: "hard-deny" } & DecisionDetails);

export interface CatastrophicDeletionContext {
	cwd: string;
	home?: string;
	maxShellDepth?: number;
	/** Original command cwd whose canonical root and ancestors remain protected during literal cwd transitions. */
	protectedCwd?: string;
}

type WordToken = {
	kind: "word";
	value: string;
	raw: string;
	dynamic: boolean;
};

type OperatorToken = {
	kind: "operator" | "redirection";
	value: string;
	raw: string;
	dynamic: false;
};

type ShellToken = WordToken | OperatorToken;
type CommandSegment = {
	tokens: ShellToken[];
	boundaryBefore?: string;
	boundaryAfter?: string;
	subshellPath: number[];
};
type CwdScopeState = {
	entryCwd: string;
	effectiveCwd: string;
	cwdResolutionUncertain: boolean;
	cwdDependsOnSuccessfulAndList: boolean;
};
type DeleteCommand = CatastrophicTargetEvidence["command"];
type DeleteCandidate = { command: DeleteCommand; targets: WordToken[] };

const COMMAND_BOUNDARIES = new Set([";", "&&", "||", "|", "|&", "&", "\n", "(", ")", "{", "}"]);
const NON_PERSISTENT_CD_BOUNDARIES_BEFORE = new Set(["|", "|&"]);
const NON_PERSISTENT_CD_BOUNDARIES_AFTER = new Set(["|", "|&", "&"]);
const AMBIGUOUS_CONDITIONAL_CWD_BOUNDARIES = new Set([";", "\n", "||"]);
// Exact lexically normalized roots only; descendants are not broad merely because their parent appears here.
const BROAD_FIND_DELETE_ROOTS = new Set([
	"/Applications",
	"/Library",
	"/System",
	"/Users",
	"/Volumes",
	"/bin",
	"/etc",
	"/home",
	"/opt",
	"/private/tmp",
	"/private/var/tmp",
	"/sbin",
	"/tmp",
	"/usr",
	"/var",
	"/var/tmp",
]);
const DELETE_COMMANDS = new Set(["rm", "rmdir", "unlink"]);
const SHELL_COMMANDS = new Set(["sh", "bash", "dash", "zsh", "ksh"]);
const CONTROL_PREFIXES = new Set(["!", "if", "then", "else", "elif", "while", "until", "do"]);
const SIMPLE_WRAPPERS = new Set(["command", "builtin", "noglob", "exec", "nohup"]);
const MAX_DEFAULT_SHELL_DEPTH = 3;

export async function analyzeCatastrophicDeletion(
	command: string,
	context: CatastrophicDeletionContext,
	depth = 0,
): Promise<CatastrophicDeletionDecision> {
	const lexed = lexShell(command);
	const segmentation = splitCommandSegments(lexed.tokens);
	lexed.malformed ||= segmentation.malformedGrouping;
	const concreteTargets: CatastrophicTargetEvidence[] = [];
	const protectedCwd = context.protectedCwd ?? context.cwd;
	const cwdScopes = new Map<string, CwdScopeState>();
	cwdScopes.set("", {
		entryCwd: context.cwd,
		effectiveCwd: context.cwd,
		cwdResolutionUncertain: false,
		cwdDependsOnSuccessfulAndList: false,
	});

	for (const rawSegment of segmentation.segments) {
		const cwdScope = getOrCreateCwdScope(rawSegment.subshellPath, cwdScopes);
		if (
			cwdScope.cwdDependsOnSuccessfulAndList &&
			AMBIGUOUS_CONDITIONAL_CWD_BOUNDARIES.has(rawSegment.boundaryBefore ?? "")
		) {
			cwdScope.cwdResolutionUncertain = true;
		}
		if (cwdScope.cwdDependsOnSuccessfulAndList && rawSegment.boundaryBefore === "&") {
			cwdScope.effectiveCwd = cwdScope.entryCwd;
			cwdScope.cwdDependsOnSuccessfulAndList = false;
		}

		const segmentContext = { ...context, cwd: cwdScope.effectiveCwd, protectedCwd };
		for (const payload of extractVisibleCommandSubstitutions(rawSegment.tokens.map((token) => token.raw).join(" "))) {
			const substitution = await analyzeCatastrophicDeletion(payload, segmentContext, depth + 1);
			if (substitution.kind === "hard-deny") return substitution;
			if (substitution.kind === "concrete-noncritical") {
				if (cwdScope.cwdResolutionUncertain) {
					return hardDeny("P0_DELETE_UNSUPPORTED_SYNTAX", "visible deletion follows a cwd transition whose success cannot be established; rewrite it with an explicit path");
				}
				concreteTargets.push(...substitution.targets);
			}
		}

		const words = stripRedirections(rawSegment.tokens);
		if (words.length === 0) continue;
		const executable = unwrapCommand(words);
		if (!executable) continue;

		const commandName = basename(executable.command.value);
		if (commandName === "cd") {
			const nextCwd = resolveLiteralCwd(executable.args, cwdScope.effectiveCwd, context.home ?? homedir());
			const boundaryBefore = rawSegment.boundaryBefore;
			const boundaryAfter = rawSegment.boundaryAfter;
			const runsInNonPersistentContext = NON_PERSISTENT_CD_BOUNDARIES_BEFORE.has(boundaryBefore ?? "") ||
				NON_PERSISTENT_CD_BOUNDARIES_AFTER.has(boundaryAfter ?? "");
			const entersFromAlternativeList = boundaryBefore === "||";
			if (boundaryAfter === "&&" && !runsInNonPersistentContext && !entersFromAlternativeList && nextCwd) {
				cwdScope.effectiveCwd = nextCwd;
				cwdScope.cwdDependsOnSuccessfulAndList = true;
			} else if (
				boundaryAfter === ";" ||
				boundaryAfter === "\n" ||
				(boundaryAfter === "&&" && entersFromAlternativeList)
			) {
				cwdScope.cwdResolutionUncertain = true;
			}
			continue;
		}
		if (commandName === "pushd" || commandName === "popd") {
			cwdScope.cwdResolutionUncertain = true;
			continue;
		}

		const indirectReason = await classifyVisibleIndirectDeletion(commandName, executable.args, segmentContext, depth);
		if (indirectReason) return indirectReason;

		if (SHELL_COMMANDS.has(commandName)) {
			const nested = await analyzeLiteralShellPayload(commandName, executable.args, segmentContext, depth);
			if (!nested || nested.kind === "no-visible-deletion") continue;
			if (cwdScope.cwdResolutionUncertain) {
				return hardDeny("P0_DELETE_UNSUPPORTED_SYNTAX", "visible deletion follows an unresolved cwd transition; rewrite it with an explicit path");
			}
			if (nested.kind === "hard-deny") return nested;
			concreteTargets.push(...nested.targets);
			continue;
		}

		const candidate = collectDeleteCandidate(commandName, executable.args);
		if (!candidate) continue;
		if (cwdScope.cwdResolutionUncertain) {
			return hardDeny("P0_DELETE_UNSUPPORTED_SYNTAX", "visible deletion follows an unresolved cwd transition; rewrite it with an explicit path");
		}
		if (hasEnvChdirOption(words)) {
			return hardDeny("P0_DELETE_UNSUPPORTED_SYNTAX", "visible deletion uses an env cwd override; rewrite it with an explicit target path");
		}
		if (lexed.malformed) {
			return hardDeny(
				"P0_DELETE_MALFORMED_SYNTAX",
				"visible deletion contains malformed shell syntax; rewrite it as a simple command with an explicit target path",
			);
		}
		if (candidate.command === "rmdir" && hasRmdirParentsOption(executable.args)) {
			return hardDeny(
				"P0_DELETE_UNSUPPORTED_SYNTAX",
				"rmdir -p/--parents has implicit ancestor deletion targets; rewrite it as explicit concrete rmdir commands",
			);
		}
		if (candidate.targets.length === 0) {
			return hardDeny("P0_DELETE_MISSING_TARGET", "visible deletion has no target; rewrite it with an explicit concrete path");
		}
		const dynamicTargets = candidate.targets.filter((target) => target.dynamic);
		if (dynamicTargets.length > 0) {
			return hardDeny(
				"P0_DELETE_DYNAMIC_TARGET",
				"visible deletion uses a variable, substitution, glob, brace, or other dynamic target; resolve it to an explicit path",
				dynamicTargets.map((target) => ({ command: candidate.command, rawTarget: target.raw, classification: "dynamic" })),
			);
		}

		const broadFindTraversal = classifyBroadFindTraversal(candidate, segmentContext);
		if (broadFindTraversal) return broadFindTraversal;

		const classified = await classifyConcreteTargets(candidate, segmentContext);
		if (classified.kind === "hard-deny") return classified;
		concreteTargets.push(...classified.targets);
	}

	if (concreteTargets.length > 0) return concreteNoncritical(concreteTargets);
	return noVisibleDeletion();
}

function collectDeleteCandidate(commandName: string, args: WordToken[]): DeleteCandidate | undefined {
	if (DELETE_COMMANDS.has(commandName)) {
		return { command: commandName as "rm" | "rmdir" | "unlink", targets: nonOptionArguments(args) };
	}
	if (commandName !== "find" || !args.some((token) => token.value === "-delete")) return undefined;

	const roots: WordToken[] = [];
	let index = skipFindTraversalOptions(args);
	for (; index < args.length; index += 1) {
		const token = args[index];
		if (!token || token.value === "-delete") break;
		if (token.value.startsWith("-") || token.value === "!" || token.value === "(") break;
		roots.push(token);
	}
	return {
		command: "find-delete",
		targets: roots.length > 0 ? roots : [literalWord(".")],
	};
}

function classifyBroadFindTraversal(
	candidate: DeleteCandidate,
	context: CatastrophicDeletionContext,
): CatastrophicDeletionDecision | undefined {
	if (candidate.command !== "find-delete") return undefined;
	for (const target of candidate.targets) {
		const resolvedTarget = resolveConcreteTarget(target.value, context.cwd, context.home ?? homedir());
		if (!resolvedTarget || !BROAD_FIND_DELETE_ROOTS.has(resolvedTarget)) continue;
		return hardDeny(
			"P0_DELETE_BROAD_FIND_ROOT",
			"find -delete starts at an explicitly protected broad system traversal root; use a concrete project or build-directory path",
			[{
				command: candidate.command,
				rawTarget: target.raw,
				resolvedTarget,
				classification: "broad",
			}],
		);
	}
	return undefined;
}

async function classifyConcreteTargets(
	candidate: DeleteCandidate,
	context: CatastrophicDeletionContext,
): Promise<CatastrophicDeletionDecision> {
	let critical: CriticalContext;
	try {
		critical = await resolveCriticalContext(context);
	} catch {
		return hardDeny(
			"P0_DELETE_CONTEXT_RESOLUTION_FAILED",
			"critical deletion context could not be resolved; retry from a valid cwd with an explicit target",
			candidate.targets.map((target) => ({ command: candidate.command, rawTarget: target.raw, classification: "unresolved" })),
		);
	}

	const evidence: CatastrophicTargetEvidence[] = [];
	for (const target of candidate.targets) {
		const resolvedTarget = resolveConcreteTarget(target.value, context.cwd, context.home ?? homedir());
		if (!resolvedTarget) {
			return hardDeny(
				"P0_DELETE_UNSUPPORTED_SYNTAX",
				"visible deletion target is not a supported concrete local path; rewrite it as an explicit path",
				[...evidence, { command: candidate.command, rawTarget: target.raw, classification: "unresolved" }],
			);
		}

		let canonicalTarget: string;
		try {
			canonicalTarget = await canonicalizeExistingOrNearestParent(resolvedTarget);
		} catch {
			return hardDeny(
				"P0_DELETE_CONTEXT_RESOLUTION_FAILED",
				"visible deletion target could not be resolved through its nearest existing parent",
				[...evidence, { command: candidate.command, rawTarget: target.raw, resolvedTarget, classification: "unresolved" }],
			);
		}

		const criticalRoot = critical.roots.get(canonicalTarget);
		if (criticalRoot) {
			const criticalEvidence: CatastrophicTargetEvidence = {
				command: candidate.command,
				rawTarget: target.raw,
				resolvedTarget,
				canonicalTarget,
				criticalRoot,
				classification: "critical",
			};
			return hardDeny(
				"P0_DELETE_CRITICAL_TARGET",
				"deletion target resolves exactly to a protected critical root",
				[...evidence, criticalEvidence],
			);
		}

		evidence.push({
			command: candidate.command,
			rawTarget: target.raw,
			resolvedTarget,
			canonicalTarget,
			classification: "concrete",
		});
	}
	return concreteNoncritical(evidence);
}

type CriticalContext = { roots: Map<string, string> };

async function resolveCriticalContext(context: CatastrophicDeletionContext): Promise<CriticalContext> {
	if (!isAbsolute(context.cwd)) throw new Error("cwd must be absolute");
	const canonicalRoot = normalizePath(await realpath("/"));
	const canonicalHome = normalizePath(await realpath(context.home ?? homedir()));
	const canonicalCwd = normalizePath(await realpath(context.protectedCwd ?? context.cwd));
	const roots = new Map<string, string>();
	roots.set(canonicalRoot, "filesystem-root");
	roots.set(canonicalHome, "home");
	let ancestor = canonicalCwd;
	while (true) {
		if (!roots.has(ancestor)) roots.set(ancestor, ancestor === canonicalCwd ? "cwd" : "cwd-ancestor");
		const parent = dirname(ancestor);
		if (parent === ancestor) break;
		ancestor = parent;
	}
	return { roots };
}

function resolveConcreteTarget(rawTarget: string, cwd: string, home: string): string | undefined {
	if (!rawTarget || rawTarget === "-" || rawTarget.includes("\0") || rawTarget.includes("://")) return undefined;
	let target = rawTarget;
	if (target === "~") target = home;
	else if (target.startsWith("~/")) target = resolve(home, target.slice(2));
	else if (target.startsWith("~")) return undefined;
	return normalizePath(isAbsolute(target) ? resolve(target) : resolve(cwd, target));
}

async function canonicalizeExistingOrNearestParent(pathValue: string): Promise<string> {
	let cursor = normalizePath(pathValue);
	const missingSuffix: string[] = [];
	while (true) {
		try {
			const existing = normalizePath(await realpath(cursor));
			return normalizePath(resolve(existing, ...missingSuffix.reverse()));
		} catch (error) {
			if (!isMissingPathError(error)) throw error;
			const parent = dirname(cursor);
			if (parent === cursor) throw error;
			missingSuffix.push(basename(cursor));
			cursor = parent;
		}
	}
}

async function analyzeLiteralShellPayload(
	commandName: string,
	args: WordToken[],
	context: CatastrophicDeletionContext,
	depth: number,
): Promise<CatastrophicDeletionDecision | undefined> {
	const payloadIndex = shellPayloadIndex(args);
	if (payloadIndex < 0) return undefined;
	const payload = args[payloadIndex];
	if (!payload) {
		return hardDeny("P0_DELETE_MALFORMED_SYNTAX", `${commandName} -c is missing its command payload`);
	}
	if (payload.dynamic) {
		return hasDeletionWord(payload.value)
			? hardDeny("P0_DELETE_DYNAMIC_TARGET", `${commandName} -c has visible deletion in a dynamic payload; rewrite it literally`)
			: undefined;
	}
	const maxDepth = context.maxShellDepth ?? MAX_DEFAULT_SHELL_DEPTH;
	if (depth >= maxDepth) {
		return hasDeletionWord(payload.value)
			? hardDeny("P0_DELETE_RECURSION_LIMIT", "literal nested deletion exceeds the bounded shell-payload depth")
			: undefined;
	}
	return analyzeCatastrophicDeletion(payload.value, context, depth + 1);
}

async function classifyVisibleIndirectDeletion(
	commandName: string,
	args: WordToken[],
	context: CatastrophicDeletionContext,
	depth: number,
): Promise<CatastrophicDeletionDecision | undefined> {
	if (commandName === "eval") {
		const payload = args.map((token) => token.value).join(" ");
		if (!payload || !hasDeletionWord(payload)) return undefined;
		return hardDeny(
			"P0_DELETE_INDIRECT_EXECUTION",
			"eval contains visible deletion intent that cannot be safely reduced; rewrite it as a direct concrete command",
		);
	}
	if (commandName === "xargs") {
		const commandArgs = skipXargsOptions(args);
		if (await tokensContainVisibleDeletion(commandArgs, context, depth)) {
			return hardDeny(
				"P0_DELETE_INDIRECT_EXECUTION",
				"xargs visibly invokes deletion with runtime-provided targets; rewrite it as direct concrete deletion",
			);
		}
	}
	if (commandName === "find") {
		const execIndex = args.findIndex((token) => ["-exec", "-execdir", "-ok", "-okdir"].includes(token.value));
		if (execIndex >= 0 && await tokensContainVisibleDeletion(args.slice(execIndex + 1), context, depth)) {
			return hardDeny(
				"P0_DELETE_INDIRECT_EXECUTION",
				"find -exec visibly invokes deletion with traversal-provided targets; rewrite it as a simpler concrete command",
			);
		}
	}
	return undefined;
}

async function tokensContainVisibleDeletion(
	tokens: WordToken[],
	context: CatastrophicDeletionContext,
	depth: number,
): Promise<boolean> {
	const executable = unwrapCommand(tokens);
	if (!executable) return false;
	const name = basename(executable.command.value);
	if (DELETE_COMMANDS.has(name)) return true;
	if (name === "find" && executable.args.some((token) => token.value === "-delete")) return true;
	if (!SHELL_COMMANDS.has(name)) return false;
	const nested = await analyzeLiteralShellPayload(name, executable.args, context, depth);
	return nested !== undefined && nested.kind !== "no-visible-deletion";
}

function unwrapCommand(tokens: WordToken[]): { command: WordToken; args: WordToken[] } | undefined {
	let index = 0;
	while (index < tokens.length && CONTROL_PREFIXES.has(tokens[index]?.value ?? "")) index += 1;
	while (index < tokens.length && isAssignment(tokens[index]?.value ?? "")) index += 1;

	while (index < tokens.length) {
		while (index < tokens.length && isAssignment(tokens[index]?.value ?? "")) index += 1;
		const token = tokens[index];
		if (!token) return undefined;
		const name = basename(token.value);
		if (name === "command" && commandUsesQueryMode(tokens, index)) return undefined;
		if (SIMPLE_WRAPPERS.has(name)) {
			index = skipSimpleWrapper(tokens, index, name);
			continue;
		}
		if (name === "sudo") {
			index = skipOptions(tokens, index + 1, new Set(["-u", "--user", "-g", "--group", "-h", "--host", "-p", "--prompt", "-C", "--close-from", "-t", "--type", "-r", "--role"]));
			continue;
		}
		if (name === "env") {
			index = skipOptions(tokens, index + 1, new Set(["-u", "--unset", "-C", "--chdir"]));
			while (index < tokens.length && isAssignment(tokens[index]?.value ?? "")) index += 1;
			continue;
		}
		if (name === "nice") {
			index = skipOptions(tokens, index + 1, new Set(["-n", "--adjustment"]));
			continue;
		}
		if (name === "ionice") {
			index = skipOptions(tokens, index + 1, new Set(["-c", "--class", "-n", "--classdata", "-t", "--ignore", "-p", "--pid", "-P", "--pgid", "-u", "--uid"]));
			continue;
		}
		if (name === "time") {
			index = skipOptions(tokens, index + 1, new Set(["-f", "--format", "-o", "--output"]));
			continue;
		}
		return { command: token, args: tokens.slice(index + 1) };
	}
	return undefined;
}

function commandUsesQueryMode(tokens: WordToken[], wrapperIndex: number): boolean {
	for (let index = wrapperIndex + 1; index < tokens.length; index += 1) {
		const value = tokens[index]?.value ?? "";
		if (value === "--" || !/^-[pVv]+$/.test(value)) return false;
		if (/[Vv]/.test(value)) return true;
	}
	return false;
}

function skipSimpleWrapper(tokens: WordToken[], wrapperIndex: number, name: string): number {
	let index = wrapperIndex + 1;
	if (name === "command") {
		while (["-p", "-v", "-V"].includes(tokens[index]?.value ?? "")) index += 1;
	} else if (name === "exec") {
		while (index < tokens.length) {
			const value = tokens[index]?.value ?? "";
			if (value === "-a") {
				index += 2;
				continue;
			}
			if (value === "-c" || value === "-l") {
				index += 1;
				continue;
			}
			break;
		}
	}
	if (tokens[index]?.value === "--") index += 1;
	return index;
}

function skipOptions(tokens: WordToken[], start: number, optionsWithValue: Set<string>): number {
	let index = start;
	while (index < tokens.length) {
		const value = tokens[index]?.value ?? "";
		if (value === "--") return index + 1;
		if (!value.startsWith("-") || value === "-") break;
		const optionName = value.split("=", 1)[0] ?? value;
		if (!value.includes("=") && optionsWithValue.has(optionName)) index += 2;
		else index += 1;
	}
	return index;
}

function skipXargsOptions(tokens: WordToken[]): WordToken[] {
	let index = 0;
	const withValue = new Set(["-a", "--arg-file", "-d", "--delimiter", "-E", "--eof", "-I", "--replace", "-L", "--max-lines", "-n", "--max-args", "-P", "--max-procs", "-s", "--max-chars"]);
	while (index < tokens.length) {
		const value = tokens[index]?.value ?? "";
		if (value === "--") return tokens.slice(index + 1);
		if (!value.startsWith("-") || value === "-") break;
		const optionName = value.split("=", 1)[0] ?? value;
		if (!value.includes("=") && withValue.has(optionName)) index += 2;
		else index += 1;
	}
	return tokens.slice(index);
}

function shellPayloadIndex(args: WordToken[]): number {
	for (let index = 0; index < args.length; index += 1) {
		const value = args[index]?.value ?? "";
		if (value === "--") continue;
		if (value === "--rcfile" || value === "--init-file" || value === "-o" || value === "-O") {
			index += 1;
			continue;
		}
		if (value === "-c" || /^-[A-Za-z]*c[A-Za-z]*$/.test(value)) return index + 1;
		if (!value.startsWith("-")) return -1;
	}
	return -1;
}

function skipFindTraversalOptions(args: WordToken[]): number {
	let index = 0;
	while (index < args.length) {
		const value = args[index]?.value ?? "";
		if (value === "-H" || value === "-L" || value === "-P" || /^-O\d*$/.test(value)) {
			index += 1;
			continue;
		}
		if (value === "-D") {
			index += 2;
			continue;
		}
		break;
	}
	return index;
}

function resolveLiteralCwd(args: WordToken[], cwd: string, home: string): string | undefined {
	const target = nonOptionArguments(args)[0];
	if (!target) return normalizePath(home);
	if (target.dynamic || target.value === "-") return undefined;
	return resolveConcreteTarget(target.value, cwd, home);
}

function hasEnvChdirOption(tokens: WordToken[]): boolean {
	const envIndex = tokens.findIndex((token) => basename(token.value) === "env");
	if (envIndex < 0) return false;
	return tokens.slice(envIndex + 1).some((token) =>
		token.value === "-C" ||
		token.value === "--chdir" ||
		token.value.startsWith("--chdir=") ||
		(token.value.startsWith("-C") && token.value.length > 2),
	);
}

function extractVisibleCommandSubstitutions(value: string): string[] {
	const payloads: string[] = [];
	let quote: "'" | '"' | undefined;
	for (let index = 0; index < value.length; index += 1) {
		const char = value[index] ?? "";
		if (char === "\\") {
			index += 1;
			continue;
		}
		if (quote === "'") {
			if (char === "'") quote = undefined;
			continue;
		}
		if (char === "'") {
			if (!quote) quote = "'";
			continue;
		}
		if (char === '"') {
			quote = quote === '"' ? undefined : '"';
			continue;
		}
		if (char === "`") {
			const end = findUnescaped(value, "`", index + 1);
			if (end > index) {
				payloads.push(value.slice(index + 1, end));
				index = end;
			}
			continue;
		}
		if (char === "$" && value[index + 1] === "(" && value[index + 2] !== "(") {
			const end = findClosingCommandSubstitution(value, index + 2);
			if (end > index) {
				payloads.push(value.slice(index + 2, end));
				index = end;
			}
		}
	}
	return payloads;
}

function findUnescaped(value: string, needle: string, start: number): number {
	for (let index = start; index < value.length; index += 1) {
		if (value[index] === "\\") {
			index += 1;
			continue;
		}
		if (value[index] === needle) return index;
	}
	return -1;
}

function findClosingCommandSubstitution(value: string, start: number): number {
	let depth = 1;
	let quote: "'" | '"' | undefined;
	for (let index = start; index < value.length; index += 1) {
		const char = value[index] ?? "";
		if (char === "\\") {
			index += 1;
			continue;
		}
		if (quote) {
			if (char === quote) quote = undefined;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}
		if (char === "(") depth += 1;
		else if (char === ")") {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	return -1;
}

function hasRmdirParentsOption(args: WordToken[]): boolean {
	for (const token of args) {
		if (token.value === "--") return false;
		if (token.value === "--parents") return true;
		if (/^-[^-]/.test(token.value) && token.value.slice(1).includes("p")) return true;
	}
	return false;
}

function nonOptionArguments(args: WordToken[]): WordToken[] {
	const targets: WordToken[] = [];
	let endOfOptions = false;
	for (const token of args) {
		if (!endOfOptions && token.value === "--") {
			endOfOptions = true;
			continue;
		}
		if (!endOfOptions && token.value.startsWith("-") && token.value !== "-") continue;
		targets.push(token);
	}
	return targets;
}

function getOrCreateCwdScope(
	subshellPath: number[],
	scopes: Map<string, CwdScopeState>,
): CwdScopeState {
	const key = subshellPath.join("/");
	const existing = scopes.get(key);
	if (existing) return existing;

	const parent = getOrCreateCwdScope(subshellPath.slice(0, -1), scopes);
	const created: CwdScopeState = {
		entryCwd: parent.effectiveCwd,
		effectiveCwd: parent.effectiveCwd,
		cwdResolutionUncertain: parent.cwdResolutionUncertain,
		cwdDependsOnSuccessfulAndList: false,
	};
	scopes.set(key, created);
	return created;
}

function splitCommandSegments(tokens: ShellToken[]): {
	segments: CommandSegment[];
	malformedGrouping: boolean;
} {
	const segments: CommandSegment[] = [];
	const subshellPath: number[] = [];
	let nextSubshellId = 1;
	let current: ShellToken[] = [];
	let boundaryBefore: string | undefined;
	let malformedGrouping = false;

	const flush = (boundaryAfter?: string) => {
		if (current.length === 0) return;
		segments.push({
			tokens: current,
			boundaryBefore,
			boundaryAfter,
			subshellPath: [...subshellPath],
		});
		current = [];
	};

	for (const token of tokens) {
		if (token.kind !== "operator" || !COMMAND_BOUNDARIES.has(token.value)) {
			current.push(token);
			continue;
		}

		flush(token.value);
		if (token.value === "(") {
			subshellPath.push(nextSubshellId++);
		} else if (token.value === ")") {
			if (subshellPath.length === 0) malformedGrouping = true;
			else subshellPath.pop();
		}
		boundaryBefore = token.value;
	}
	flush();
	if (subshellPath.length > 0) malformedGrouping = true;
	return { segments, malformedGrouping };
}

function stripRedirections(tokens: ShellToken[]): WordToken[] {
	const words: WordToken[] = [];
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token) continue;
		if (token.kind === "word" && /^\d+$/.test(token.value) && tokens[index + 1]?.kind === "redirection") {
			index += 2;
			continue;
		}
		if (token.kind === "redirection") {
			index += 1;
			continue;
		}
		if (token.kind === "word") words.push(token);
	}
	return words;
}

function lexShell(command: string): { tokens: ShellToken[]; malformed: boolean } {
	const tokens: ShellToken[] = [];
	let value = "";
	let raw = "";
	let dynamic = false;
	let quote: "'" | '"' | undefined;
	let malformed = false;

	const flush = () => {
		if (!raw) return;
		tokens.push({ kind: "word", value, raw, dynamic });
		value = "";
		raw = "";
		dynamic = false;
	};
	const pushOperator = (kind: "operator" | "redirection", operator: string) => {
		flush();
		tokens.push({ kind, value: operator, raw: operator, dynamic: false });
	};

	for (let index = 0; index < command.length; index += 1) {
		const char = command[index] ?? "";
		const next = command[index + 1] ?? "";
		if (quote) {
			raw += char;
			if (char === quote) {
				quote = undefined;
				continue;
			}
			if (char === "\\" && quote === '"' && index + 1 < command.length) {
				const escaped = command[++index] ?? "";
				raw += escaped;
				value += escaped;
				continue;
			}
			if (quote === '"' && (char === "$" || char === "`")) dynamic = true;
			value += char;
			continue;
		}

		if (char === "'" || char === '"') {
			quote = char;
			raw += char;
			continue;
		}
		if (char === "\\") {
			if (next === "\n") {
				index += 1;
				continue;
			}
			raw += char;
			if (index + 1 >= command.length) {
				malformed = true;
				continue;
			}
			const escaped = command[++index] ?? "";
			raw += escaped;
			value += escaped;
			continue;
		}
		if (char === "#" && raw.length === 0) {
			while (index + 1 < command.length && command[index + 1] !== "\n") index += 1;
			continue;
		}
		if (/\s/.test(char)) {
			flush();
			if (char === "\n") pushOperator("operator", "\n");
			continue;
		}
		if (char === "&" && next === ">") {
			const append = command[index + 2] === ">";
			pushOperator("redirection", append ? "&>>" : "&>");
			index += append ? 2 : 1;
			continue;
		}
		if ((char === "&" && next === "&") || (char === "|" && (next === "|" || next === "&"))) {
			pushOperator("operator", `${char}${next}`);
			index += 1;
			continue;
		}
		if (char === ";" || char === "|" || char === "&" || char === "(" || char === ")") {
			pushOperator("operator", char);
			continue;
		}
		if ((char === "{" || char === "}") && raw.length === 0) {
			pushOperator("operator", char);
			continue;
		}
		if (char === ">" || char === "<") {
			if (next === "(") {
				dynamic = true;
				raw += char;
				value += char;
				continue;
			}
			const operator = next === "&" ? `${char}&` : next === char ? `${char}${next}` : char;
			pushOperator("redirection", operator);
			if (next === "&" || next === char) index += 1;
			continue;
		}
		if (char === "$" || char === "`" || char === "*" || char === "?" || char === "[" || char === "{" || char === "}") {
			dynamic = true;
		}
		raw += char;
		value += char;
	}
	if (quote) malformed = true;
	flush();
	malformed ||= hasMalformedCommandList(tokens);
	return { tokens, malformed };
}

function hasMalformedCommandList(tokens: ShellToken[]): boolean {
	const last = tokens.at(-1);
	return last?.kind === "operator" && new Set(["&&", "||", "|", "|&"]).has(last.value);
}

function literalWord(value: string): WordToken {
	return { kind: "word", value, raw: value, dynamic: false };
}

function hasDeletionWord(value: string): boolean {
	return /(?:^|[^A-Za-z0-9_])(?:[^\s;&|()]+\/)?(?:rm|rmdir|unlink)(?=$|[\s;&|()])/m.test(value) ||
		/(?:^|[^A-Za-z0-9_])find(?=$|[\s;&|()])[^\n;]*?(?:^|\s)-delete(?=$|\s|[;&|()])/m.test(value);
}

function isAssignment(value: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*(?:\+)?=/.test(value);
}

function normalizePath(pathValue: string): string {
	const normalized = normalize(pathValue);
	return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code !== undefined &&
		new Set(["ENOENT", "ENOTDIR"]).has((error as NodeJS.ErrnoException).code ?? "");
}

function noVisibleDeletion(): CatastrophicDeletionDecision {
	return {
		kind: "no-visible-deletion",
		reasonCode: "P0_NO_DELETION",
		reason: "no bounded visible deletion command was recognized",
		targets: [],
	};
}

function concreteNoncritical(targets: CatastrophicTargetEvidence[]): CatastrophicDeletionDecision {
	return {
		kind: "concrete-noncritical",
		reasonCode: "P0_CONCRETE_NONCRITICAL_DELETE",
		reason: "all recognized deletion targets are concrete and do not equal protected critical roots",
		targets,
	};
}

function hardDeny(
	reasonCode: CatastrophicDeletionReasonCode,
	reason: string,
	targets: CatastrophicTargetEvidence[] = [],
): CatastrophicDeletionDecision {
	return { kind: "hard-deny", reasonCode, reason, targets };
}
