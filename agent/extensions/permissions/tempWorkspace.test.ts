import assert from "node:assert/strict";
import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { withTestScratchFixture } from "./testScratch.ts";
import { createPiTempWorkspace, isPathInsideWorkspaceChild } from "./tempWorkspace.ts";

test("pi temp workspace uses a sanitized session child under the configured temp root", async () => {
	await withTestScratchFixture(async (fixture) => {
		const workspace = createPiTempWorkspace("session/with spaces", { systemTempDir: fixture.sessionTemp });

		assert.equal(workspace.baseDir, join(fixture.sessionTemp, "pi"));
		assert.equal(workspace.sessionDir, join(fixture.sessionTemp, "pi", "session-session-with-spaces"));
		assert.equal(await isPathInsideWorkspaceChild(join(workspace.sessionDir, "out.txt"), workspace), true);
		assert.equal(await isPathInsideWorkspaceChild(join(workspace.sessionDir, "nested", "out.txt"), workspace), true);
		assert.equal(await isPathInsideWorkspaceChild(join(workspace.sessionDir, "..cache", "out.txt"), workspace), true);
		assert.equal(await isPathInsideWorkspaceChild(workspace.sessionDir, workspace), false);
		assert.equal(await isPathInsideWorkspaceChild(join(workspace.baseDir, "session-other", "out.txt"), workspace), false);
		assert.equal(await isPathInsideWorkspaceChild(workspace.baseDir, workspace), false);
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

test("workspace containment recognizes aliases in both directions without approving the root or siblings", async () => {
	await withTestScratchFixture(async (fixture) => {
		const workspace = createPiTempWorkspace("alias-test", { systemTempDir: fixture.sessionTemp });
		await workspace.ensureCreated();
		const alias = join(fixture.root, "temp-alias");
		await fixture.symlink(fixture.sessionTemp, alias);
		const aliasedWorkspace = createPiTempWorkspace("alias-test", { systemTempDir: alias });

		for (const [candidate, root] of [[aliasedWorkspace, workspace], [workspace, aliasedWorkspace]]) {
			assert.equal(await isPathInsideWorkspaceChild(join(candidate.sessionDir, "missing", "nested", "out.txt"), root), true);
			assert.equal(await isPathInsideWorkspaceChild(candidate.sessionDir, root), false);
			assert.equal(await isPathInsideWorkspaceChild(join(candidate.baseDir, "session-other", "out.txt"), root), false);
		}
	});
});

test("workspace containment recognizes macOS /var and /private/var spellings", { skip: process.platform !== "darwin" }, async (t) => {
	await withTestScratchFixture(async (fixture) => {
		const workspace = createPiTempWorkspace("macos-alias-test", { systemTempDir: fixture.sessionTemp });
		await workspace.ensureCreated();
		const canonical = await realpath(workspace.sessionDir);
		if (!canonical.startsWith("/private/var/")) {
			t.skip("Approved scratch is outside the macOS /var alias; generic alias coverage still applies");
			return;
		}
		const alias = canonical.replace(/^\/private\/var\//, "/var/");
		for (const [candidate, root] of [[canonical, alias], [alias, canonical]]) {
			assert.equal(await isPathInsideWorkspaceChild(`${candidate}/missing/out.txt`, { sessionDir: root }), true);
			assert.equal(await isPathInsideWorkspaceChild(candidate, { sessionDir: root }), false);
		}
	});
});

test("workspace containment refuses symlink escapes, including missing descendants and dangling links", async () => {
	await withTestScratchFixture(async (fixture) => {
		const workspace = createPiTempWorkspace("escape-test", { systemTempDir: fixture.sessionTemp });
		await workspace.ensureCreated();
		const escape = join(workspace.sessionDir, "escape");
		await fixture.symlink(fixture.protectedDir, escape);
		await fixture.writeFile(join(fixture.protectedDir, "existing.txt"), "outside scratch");
		await fixture.symlink(join(fixture.protectedDir, "existing.txt"), join(workspace.sessionDir, "leaf-link"));

		assert.equal(await isPathInsideWorkspaceChild(join(escape, "existing.txt"), workspace), false);
		assert.equal(await isPathInsideWorkspaceChild(join(escape, "missing", "nested", "out.txt"), workspace), false);
		assert.equal(await isPathInsideWorkspaceChild(join(workspace.sessionDir, "leaf-link"), workspace), false);

		const target = join(fixture.protectedDir, "disposable");
		await fixture.mkdir(target);
		const dangling = join(workspace.sessionDir, "dangling");
		await fixture.symlink(target, dangling);
		await fixture.rename(target, join(fixture.protectedDir, "moved"));
		assert.equal(await isPathInsideWorkspaceChild(join(dangling, "out.txt"), workspace), false);
	});
});

test("workspace containment does not approve outside symlink entries pointing into scratch", async () => {
	await withTestScratchFixture(async (fixture) => {
		const workspace = createPiTempWorkspace("entry-location-test", { systemTempDir: fixture.sessionTemp });
		await workspace.ensureCreated();
		const file = join(workspace.sessionDir, "file.txt");
		await fixture.writeFile(file, "scratch file");
		const outsideLink = join(fixture.protectedDir, "link-to-scratch-file");
		await fixture.symlink(file, outsideLink);
		assert.equal(await isPathInsideWorkspaceChild(outsideLink, workspace), false);
		const insideLink = join(workspace.sessionDir, "internal-link");
		await fixture.symlink(file, insideLink);
		assert.equal(await isPathInsideWorkspaceChild(insideLink, workspace), true);
	});
});

test("workspace containment fails closed for a non-directory ancestor", async () => {
	await withTestScratchFixture(async (fixture) => {
		const workspace = createPiTempWorkspace("invalid-parent-test", { systemTempDir: fixture.sessionTemp });
		await workspace.ensureCreated();
		const file = join(workspace.sessionDir, "file.txt");
		await fixture.writeFile(file, "not a directory");
		assert.equal(await isPathInsideWorkspaceChild(`${file}/out.txt`, workspace), false);
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
