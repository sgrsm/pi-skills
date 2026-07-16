import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { withTestScratchFixture } from "./testScratch.ts";
import { createPiTempWorkspace, isPathInsideWorkspaceChild } from "./tempWorkspace.ts";

test("pi temp workspace uses a sanitized session child under the configured temp root", async () => {
	await withTestScratchFixture(async (fixture) => {
		const workspace = createPiTempWorkspace("session/with spaces", { systemTempDir: fixture.sessionTemp });

		assert.equal(workspace.baseDir, join(fixture.sessionTemp, "pi"));
		assert.equal(workspace.sessionDir, join(fixture.sessionTemp, "pi", "session-session-with-spaces"));
		assert.equal(isPathInsideWorkspaceChild(join(workspace.sessionDir, "out.txt"), workspace), true);
		assert.equal(isPathInsideWorkspaceChild(join(workspace.sessionDir, "nested", "out.txt"), workspace), true);
		assert.equal(isPathInsideWorkspaceChild(workspace.sessionDir, workspace), false);
		assert.equal(isPathInsideWorkspaceChild(join(workspace.baseDir, "session-other", "out.txt"), workspace), false);
		assert.equal(isPathInsideWorkspaceChild(workspace.baseDir, workspace), false);
	});
});

test("pi temp workspace is created on demand with private permissions", async () => {
	await withTestScratchFixture(async (fixture) => {
		const workspace = createPiTempWorkspace("permissions-temp-test", { systemTempDir: fixture.sessionTemp });

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
	await withTestScratchFixture(async (fixture) => {
		const target = join(fixture.protectedDir, "target");
		await fixture.mkdir(target);
		await fixture.writeFile(join(target, "sentinel"), "ok");
		await fixture.symlink(target, join(fixture.sessionTemp, "pi"));

		const workspace = createPiTempWorkspace("permissions-temp-test", { systemTempDir: fixture.sessionTemp });
		await assert.rejects(workspace.ensureCreated(), /Refusing to use Pi temp workspace directory/);
	});
});
