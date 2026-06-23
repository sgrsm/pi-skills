import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize, relative } from "node:path";

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

export function isPathInsideWorkspaceChild(pathValue: string, workspace: Pick<PiTempWorkspace, "sessionDir">): boolean {
	return isPathStrictlyInside(pathValue, workspace.sessionDir);
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
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
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
