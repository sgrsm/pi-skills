import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from "node:path";

export interface PiTempWorkspace {
	baseDir: string;
	sessionDir: string;
	ensureCreated(): Promise<void>;
}

export interface PiTempWorkspaceOptions {
	systemTempDir?: string;
	fallbackSessionId?: string;
}

const PI_TEMP_DIR_NAME = "pi";
const PRIVATE_DIR_MODE = 0o700;

export function createPiTempWorkspace(sessionId: string | undefined, options: PiTempWorkspaceOptions = {}): PiTempWorkspace {
	const baseDir = normalizePath(join(options.systemTempDir ?? tmpdir(), PI_TEMP_DIR_NAME));
	const sessionDir = normalizePath(join(baseDir, sessionChildName(sessionId, options.fallbackSessionId)));
	return {
		baseDir,
		sessionDir,
		async ensureCreated() {
			await ensurePrivateDirectory(baseDir);
			await ensurePrivateDirectory(sessionDir);
		},
	};
}

export async function isPathInsideWorkspaceChild(pathValue: string, workspace: Pick<PiTempWorkspace, "sessionDir">): Promise<boolean> {
	// Do not erase traversal before resolving symlinks. Parent traversal is
	// deliberately ineligible for scratch auto-approval, unlike names such as ..cache.
	const components = pathValue.split(process.platform === "win32" ? /[\\/]/ : /\//);
	if (!isAbsolute(pathValue) || components.includes("..")) return false;
	try {
		const [candidate, root, parent] = await Promise.all([
			canonicalizeExistingOrNearestParent(pathValue),
			canonicalizeExistingOrNearestParent(workspace.sessionDir),
			canonicalizeExistingOrNearestParent(dirname(pathValue)),
		]);
		// Deletion/rename/replace can mutate the symlink entry itself, whereas
		// write/edit may follow it. Both locations must stay below scratch.
		const entry = join(parent, basename(pathValue));
		return isPathStrictlyInside(candidate, root) && isPathStrictlyInside(entry, root);
	} catch {
		return false;
	}
}

function sessionChildName(sessionId: string | undefined, fallbackSessionId: string | undefined): string {
	const rawId = sessionId?.trim() || fallbackSessionId?.trim() || randomUUID();
	const sanitized = rawId
		.replace(/[^A-Za-z0-9_.-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	if (sanitized && sanitized !== "." && sanitized !== "..") return `session-${sanitized}`;
	return `session-${createHash("sha256").update(rawId).digest("hex").slice(0, 16)}`;
}

function normalizePath(pathValue: string): string {
	const normalized = normalize(pathValue);
	return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function isPathStrictlyInside(candidatePath: string, rootPath: string): boolean {
	const candidate = normalizePath(candidatePath);
	const root = normalizePath(rootPath);
	const rel = relative(root, candidate);
	return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function canonicalizeExistingOrNearestParent(pathValue: string): Promise<string> {
	let cursor = normalizePath(pathValue);
	const missingSuffix: string[] = [];
	while (true) {
		try {
			await lstat(cursor);
		} catch (error) {
			if (!isNodeError(error) || error.code !== "ENOENT") throw error;
			const parent = dirname(cursor);
			if (parent === cursor) throw error;
			missingSuffix.push(basename(cursor));
			cursor = parent;
			continue;
		}
		// A dangling symlink is not a missing directory. Resolve only after lstat
		// succeeds, and never turn a realpath failure into an unresolved suffix.
		const canonical = await realpath(cursor);
		if (missingSuffix.length > 0 && !(await stat(canonical)).isDirectory()) {
			throw new Error(`Scratch target ancestor is not a directory: ${cursor}`);
		}
		return normalizePath(join(canonical, ...missingSuffix.reverse()));
	}
}

async function ensurePrivateDirectory(dir: string): Promise<void> {
	try {
		const existing = await lstat(dir);
		assertUsablePrivateDirectory(dir, existing);
	} catch (error) {
		if (!isNodeError(error) || error.code !== "ENOENT") throw error;
		await mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
		const created = await lstat(dir);
		assertUsablePrivateDirectory(dir, created);
	}

	if (process.platform !== "win32") {
		await chmod(dir, PRIVATE_DIR_MODE);
	}
}

function assertUsablePrivateDirectory(dir: string, stat: Awaited<ReturnType<typeof lstat>>): void {
	if (stat.isSymbolicLink() || !stat.isDirectory()) {
		throw new Error(`Refusing to use Pi temp workspace directory because it is not a real directory: ${dir}`);
	}

	if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
		throw new Error(`Refusing to use Pi temp workspace directory because it is not owned by the current user: ${dir}`);
	}
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
