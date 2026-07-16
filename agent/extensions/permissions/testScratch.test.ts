import assert from "node:assert/strict";
import { lstat, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
	createTestScratchFixture,
	getApprovedTestScratchRoot,
	protectedPathsOverlapApprovedRoot,
	withTestScratchFixture,
} from "./testScratch.ts";

test("approved test scratch root requires an explicit absolute environment value", () => {
	assert.throws(() => getApprovedTestScratchRoot({}), /PI_PERMISSIONS_TEST_SCRATCH_ROOT/);
	assert.throws(
		() => getApprovedTestScratchRoot({ PI_PERMISSIONS_TEST_SCRATCH_ROOT: "relative/path" }),
		/must be absolute/,
	);
});

test("pure protected-path overlap rejects equals, descendants, and ancestors without treating filesystem root as universal", () => {
	assert.equal(protectedPathsOverlapApprovedRoot("/safe/scratch", ["/home/user", "/repo", "/work"]), false);
	assert.equal(protectedPathsOverlapApprovedRoot("/home/user", ["/home/user"]), true);
	assert.equal(protectedPathsOverlapApprovedRoot("/home/user/scratch", ["/home/user"]), true);
	assert.equal(protectedPathsOverlapApprovedRoot("/home", ["/home/user"]), true);
	assert.equal(protectedPathsOverlapApprovedRoot("/safe/scratch", ["/"]), false);
	assert.equal(protectedPathsOverlapApprovedRoot("/", ["/"]), true);
});

test("fixture creates the required owned private real-directory layout below the approved root", async () => {
	await withTestScratchFixture(async (fixture) => {
		assert.notEqual(fixture.root, fixture.approvedRoot);
		assert.match(fixture.root, /permissions-test-[^/]+$/);
		for (const pathValue of [fixture.root, fixture.fakeHome, fixture.project, fixture.protectedDir, fixture.sessionTemp]) {
			const pathStat = await lstat(pathValue);
			assert.equal(pathStat.isDirectory(), true);
			assert.equal(pathStat.isSymbolicLink(), false);
			if (typeof process.getuid === "function") assert.equal(pathStat.uid, process.getuid());
		}
		if (process.platform !== "win32") assert.equal((await stat(fixture.root)).mode & 0o777, 0o700);
	});
});

test("fixture mutation guard rejects roots, outside paths, and prefix collisions", async () => {
	await withTestScratchFixture(async (fixture) => {
		for (const rejected of [
			"/",
			homedir(),
			process.cwd(),
			resolve(import.meta.dirname, "../../.."),
			fixture.approvedRoot,
			fixture.root,
			join(fixture.root, "..", `${fixture.root.split("/").at(-1)}-collision`, "file.txt"),
			join(fixture.approvedRoot, "outside.txt"),
		]) {
			await assert.rejects(fixture.assertMutationTarget(rejected), /strict descendant|dangerous/);
		}
		await assert.rejects(fixture.assertMutationTarget("relative.txt"), /resolved absolute/);
	});
});

test("a symlink can never become an approved fixture root", async () => {
	await withTestScratchFixture(async (fixture) => {
		const candidate = join(fixture.protectedDir, "candidate-root");
		const linkedRoot = join(fixture.project, "linked-root");
		await fixture.mkdir(candidate);
		await fixture.writeFile(join(candidate, ".step1-test-root-ready"), "approved only for rejection test\n");
		await fixture.symlink(candidate, linkedRoot);

		await assert.rejects(
			createTestScratchFixture({ PI_PERMISSIONS_TEST_SCRATCH_ROOT: linkedRoot }),
			/must not be a symlink|must be a real directory/,
		);
	});
});

test("pinned cleanup refuses a replaced in-fixture object and leaves its sentinel intact", async () => {
	await withTestScratchFixture(async (fixture) => {
		const disposable = join(fixture.protectedDir, "disposable");
		const displaced = join(fixture.protectedDir, "displaced-original");
		const sentinel = join(disposable, "identity-sentinel");
		await fixture.mkdir(disposable);
		const cleanup = await fixture.pinDirectoryCleanup(disposable);
		await fixture.rename(disposable, displaced);
		await fixture.mkdir(disposable);
		await fixture.writeFile(sentinel, "replacement must survive refused cleanup\n");

		await assert.rejects(cleanup(), /identity changed/);
		assert.equal((await lstat(sentinel)).isFile(), true);
	});
});

test("every normal mutation refuses a replaced generated root and preserves the replacement sentinel", async () => {
	await withTestScratchFixture(async (fixture) => {
		const refusedTarget = join(fixture.project, "must-not-be-created.txt");
		await fixture.withGeneratedRootReplacementForTest(async ({ sentinelPath }) => {
			await assert.rejects(
				fixture.writeFile(refusedTarget, "must not be written\n"),
				/generated test fixture root identity changed/,
			);
			assert.equal(await readFile(sentinelPath, "utf8"), "replacement identity sentinel\n");
		});

		await fixture.writeFile(join(fixture.project, "restored-root.txt"), "original root restored\n");
	});
});

test("fixture symlinks may target only the fixture and cannot become mutation parents", async () => {
	const fixture = await createTestScratchFixture();
	try {
		const target = join(fixture.protectedDir, "target");
		const link = join(fixture.project, "target-link");
		await fixture.mkdir(target);
		await fixture.symlink(target, link);
		assert.equal((await lstat(link)).isSymbolicLink(), true);
		await assert.rejects(fixture.assertMutationTarget(join(link, "child.txt")), /must not be a symlink/);
	} finally {
		await fixture.cleanup();
	}
});
