import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPiTempWorkspace, isPathInsideWorkspaceChild } from "./tempWorkspace.ts";

async function withTempRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
	const root = await mkdtemp(join(tmpdir(), "pi-temp-workspace-test-"));
	try {
		return await fn(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test("pi temp workspace uses a sanitized session child under the configured temp root", async () => {
	await withTempRoot(async (root) => {
		const workspace = createPiTempWorkspace("session/with spaces", { systemTempDir: root });

		assert.equal(workspace.baseDir, join(root, "pi"));
		assert.equal(workspace.sessionDir, join(root, "pi", "session-session-with-spaces"));
		assert.equal(isPathInsideWorkspaceChild(join(workspace.sessionDir, "out.txt"), workspace), true);
		assert.equal(isPathInsideWorkspaceChild(join(workspace.sessionDir, "nested", "out.txt"), workspace), true);
		assert.equal(isPathInsideWorkspaceChild(workspace.sessionDir, workspace), false);
		assert.equal(isPathInsideWorkspaceChild(join(workspace.baseDir, "session-other", "out.txt"), workspace), false);
		assert.equal(isPathInsideWorkspaceChild(workspace.baseDir, workspace), false);
	});
});

test("pi temp workspace is created on demand with private permissions", async () => {
	await withTempRoot(async (root) => {
		const workspace = createPiTempWorkspace("permissions-temp-test", { systemTempDir: root });

		await assert.rejects(stat(workspace.sessionDir), { code: "ENOENT" });
		await workspace.ensureCreated();

		const base = await stat(workspace.baseDir);
		const session = await stat(workspace.sessionDir);
		assert.equal(base.isDirectory(), true);
		assert.equal(session.isDirectory(), true);
		if (process.platform !== "win32") {
			assert.equal(base.mode & 0o777, 0o700);
			assert.equal(session.mode & 0o777, 0o700);
		}
	});
});

test("pi temp workspace refuses an unsafe symlinked base directory", async () => {
	await withTempRoot(async (root) => {
		const target = join(root, "target");
		await mkdir(target);
		await writeFile(join(target, "sentinel"), "ok");
		await symlink(target, join(root, "pi"));

		const workspace = createPiTempWorkspace("permissions-temp-test", { systemTempDir: root });
		await assert.rejects(workspace.ensureCreated(), /Refusing to use Pi temp workspace directory/);
	});
});
