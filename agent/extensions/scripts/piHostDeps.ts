import { execFileSync as defaultExecFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PI_CODING_AGENT_PACKAGE = "@earendil-works/pi-coding-agent";

export const PI_HOST_PACKAGES = [
	PI_CODING_AGENT_PACKAGE,
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-tui",
	"typebox",
] as const;

export type PiHostPackage = (typeof PI_HOST_PACKAGES)[number];

export interface PiHostDepsOptions {
	/** Extension package root. Defaults to the current working directory. */
	packageRoot?: string;
	/** Test/override hook for the installed global @earendil-works/pi-coding-agent root. */
	piCodingAgentRoot?: string;
	/** Test/override hook for npm's global node_modules root. */
	globalNodeModulesRoot?: string;
	/** Environment override hook. Defaults to process.env. */
	env?: NodeJS.ProcessEnv;
	/** Command runner override for tests. */
	execFileSync?: typeof defaultExecFileSync;
}

export interface PiHostDepLink {
	packageName: PiHostPackage;
	localPath: string;
	targetPath: string;
	status: "ok" | "linked";
}

export class PiHostDepsError extends Error {
	readonly problems: string[];

	constructor(problems: string[]) {
		super(`Pi host dependency check failed:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
		this.name = "PiHostDepsError";
		this.problems = problems;
	}
}

export function syncPiHostDeps(options: PiHostDepsOptions = {}): PiHostDepLink[] {
	const links = resolveHostDepLinks(options);
	for (const link of links) {
		const currentProblem = inspectLocalLink(link);
		if (currentProblem) {
			rmSync(link.localPath, { recursive: true, force: true });
			mkdirSync(path.dirname(link.localPath), { recursive: true });
			symlinkSync(link.targetPath, link.localPath, process.platform === "win32" ? "junction" : "dir");
			link.status = "linked";
		}
	}
	return links;
}

export function checkPiHostDeps(options: PiHostDepsOptions = {}): PiHostDepLink[] {
	const links = resolveHostDepLinks(options);
	const problems = links.flatMap((link) => {
		const problem = inspectLocalLink(link);
		return problem ? [problem] : [];
	});
	if (problems.length > 0) {
		throw new PiHostDepsError(problems);
	}
	return links;
}

function resolveHostDepLinks(options: PiHostDepsOptions): PiHostDepLink[] {
	const packageRoot = path.resolve(options.packageRoot ?? process.cwd());
	const piCodingAgentRoot = resolvePiCodingAgentRoot(options);
	const getGlobalNodeModulesRoot = memoize(() => resolveGlobalNodeModulesRoot(options));

	return PI_HOST_PACKAGES.map((packageName) => ({
		packageName,
		localPath: path.join(packageRoot, "node_modules", ...packageName.split("/")),
		targetPath: resolveHostPackagePath(packageName, piCodingAgentRoot, getGlobalNodeModulesRoot),
		status: "ok" as const,
	}));
}

function resolvePiCodingAgentRoot(options: PiHostDepsOptions): string {
	const env = options.env ?? process.env;
	for (const candidate of [options.piCodingAgentRoot, env.PI_HOST_PACKAGE_ROOT]) {
		if (!candidate) {
			continue;
		}
		const packageRoot = findPackageRoot(candidate, PI_CODING_AGENT_PACKAGE);
		if (packageRoot) {
			return packageRoot;
		}
	}

	const globalPackageRoot = candidateFromGlobalNodeModulesRoot(resolveGlobalNodeModulesRoot(options));
	if (globalPackageRoot) {
		const packageRoot = findPackageRoot(globalPackageRoot, PI_CODING_AGENT_PACKAGE);
		if (packageRoot) {
			return packageRoot;
		}
	}

	const piCommandPackageRoot = candidateFromPiCommand(options);
	if (piCommandPackageRoot) {
		const packageRoot = findPackageRoot(piCommandPackageRoot, PI_CODING_AGENT_PACKAGE);
		if (packageRoot) {
			return packageRoot;
		}
	}

	throw new Error(
		`Unable to locate installed ${PI_CODING_AGENT_PACKAGE}. Run this script with the same Node/npm environment that provides the pi command, or set PI_HOST_PACKAGE_ROOT.`,
	);
}

function resolveGlobalNodeModulesRoot(options: PiHostDepsOptions): string | undefined {
	if (options.globalNodeModulesRoot) {
		return path.resolve(options.globalNodeModulesRoot);
	}

	const execFileSync = options.execFileSync ?? defaultExecFileSync;
	const env = options.env ?? process.env;
	try {
		if (env.npm_execpath) {
			return String(execFileSync(process.execPath, [env.npm_execpath, "root", "-g"], { encoding: "utf8" })).trim();
		}
		return String(execFileSync("npm", ["root", "-g"], { encoding: "utf8" })).trim();
	} catch {
		return undefined;
	}
}

function candidateFromGlobalNodeModulesRoot(globalNodeModulesRoot: string | undefined): string | undefined {
	return globalNodeModulesRoot ? path.join(globalNodeModulesRoot, ...PI_CODING_AGENT_PACKAGE.split("/")) : undefined;
}

function candidateFromPiCommand(options: PiHostDepsOptions): string | undefined {
	const execFileSync = options.execFileSync ?? defaultExecFileSync;
	try {
		const piCommand = String(execFileSync("bash", ["-lc", "command -v pi"], { encoding: "utf8" })).trim();
		return piCommand ? realpathSync(piCommand) : undefined;
	} catch {
		return undefined;
	}
}

function resolveHostPackagePath(
	packageName: PiHostPackage,
	piCodingAgentRoot: string,
	getGlobalNodeModulesRoot: () => string | undefined,
): string {
	if (packageName === PI_CODING_AGENT_PACKAGE) {
		return assertPackageDirectory(piCodingAgentRoot, packageName);
	}

	const candidates = [path.join(piCodingAgentRoot, "node_modules", ...packageName.split("/"))];
	for (const candidate of candidates) {
		try {
			return assertPackageDirectory(candidate, packageName);
		} catch {
			// Try the next known host location.
		}
	}

	const globalNodeModulesRoot = getGlobalNodeModulesRoot();
	if (globalNodeModulesRoot) {
		const globalCandidate = path.join(globalNodeModulesRoot, ...packageName.split("/"));
		try {
			return assertPackageDirectory(globalCandidate, packageName);
		} catch {
			candidates.push(globalCandidate);
		}
	}

	throw new Error(
		`Unable to locate host-provided ${packageName}. Checked ${candidates.join(", ")} from ${piCodingAgentRoot}.`,
	);
}

function memoize<T>(fn: () => T): () => T {
	let resolved = false;
	let value: T | undefined;
	return () => {
		if (!resolved) {
			value = fn();
			resolved = true;
		}
		return value as T;
	};
}

function findPackageRoot(startPath: string, packageName: string): string | undefined {
	let current = path.resolve(startPath);
	if (existsSync(current) && !lstatSync(current).isDirectory()) {
		current = path.dirname(current);
	}

	while (true) {
		try {
			return assertPackageDirectory(current, packageName);
		} catch {
			const parent = path.dirname(current);
			if (parent === current) {
				return undefined;
			}
			current = parent;
		}
	}
}

function assertPackageDirectory(packagePath: string, expectedName: string): string {
	const realPackagePath = realpathSync(packagePath);
	const packageJsonPath = path.join(realPackagePath, "package.json");
	const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string };
	if (packageJson.name !== expectedName) {
		throw new Error(`${packageJsonPath} is ${packageJson.name ?? "<unnamed>"}, expected ${expectedName}`);
	}
	return realPackagePath;
}

function inspectLocalLink(link: PiHostDepLink): string | undefined {
	let stat;
	try {
		stat = lstatSync(link.localPath);
	} catch {
		return `${link.packageName}: missing ${link.localPath}; run npm run sync:pi-host-deps`;
	}

	if (!stat.isSymbolicLink()) {
		const kind = stat.isDirectory() ? "a real directory" : "not a symlink";
		return `${link.packageName}: ${link.localPath} is ${kind}; expected a symlink to ${link.targetPath}`;
	}

	let actualTarget: string;
	try {
		actualTarget = realpathSync(link.localPath);
	} catch (error) {
		return `${link.packageName}: ${link.localPath} is a broken symlink (${String(error)})`;
	}

	if (actualTarget !== link.targetPath) {
		return `${link.packageName}: ${link.localPath} resolves to ${actualTarget}; expected ${link.targetPath}`;
	}

	return undefined;
}

async function main(): Promise<void> {
	const command = process.argv[2] ?? "check";
	if (command !== "sync" && command !== "check") {
		console.error("Usage: node scripts/piHostDeps.ts [sync|check]");
		process.exitCode = 2;
		return;
	}

	try {
		const links = command === "sync" ? syncPiHostDeps() : checkPiHostDeps();
		for (const link of links) {
			console.log(`${link.status} ${link.packageName}: ${link.localPath} -> ${link.targetPath}`);
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : undefined;
const modulePath = realpathSync(fileURLToPath(import.meta.url));
if (invokedPath === modulePath) {
	void main();
}
