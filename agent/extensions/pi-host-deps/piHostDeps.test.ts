import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { lstatSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { checkPiHostDeps, PI_HOST_PACKAGES, syncPiHostDeps } from "./piHostDeps.ts";

async function makeFixture(t: TestContext): Promise<{
	packageRoot: string;
	piCodingAgentRoot: string;
	expectedTargets: Map<string, string>;
}> {
	const root = await mkdtemp(path.join(tmpdir(), "pi-host-deps-"));
	t.after(() => rm(root, { recursive: true, force: true }));

	const packageRoot = path.join(root, "extensions");
	const piCodingAgentRoot = path.join(root, "global", "@earendil-works", "pi-coding-agent");
	await writePackage(piCodingAgentRoot, "@earendil-works/pi-coding-agent");

	const expectedTargets = new Map<string, string>();
	expectedTargets.set("@earendil-works/pi-coding-agent", realpathSync(piCodingAgentRoot));
	for (const packageName of PI_HOST_PACKAGES) {
		if (packageName === "@earendil-works/pi-coding-agent") {
			continue;
		}
		const hostPackagePath = path.join(piCodingAgentRoot, "node_modules", ...packageName.split("/"));
		await writePackage(hostPackagePath, packageName);
		expectedTargets.set(packageName, realpathSync(hostPackagePath));
	}

	return { packageRoot, piCodingAgentRoot, expectedTargets };
}

async function writePackage(packagePath: string, packageName: string): Promise<void> {
	await mkdir(packagePath, { recursive: true });
	await writeFile(path.join(packagePath, "package.json"), JSON.stringify({ name: packageName, version: "1.0.0" }));
}

function localPackagePath(packageRoot: string, packageName: string): string {
	return path.join(packageRoot, "node_modules", ...packageName.split("/"));
}

test("sync replaces copied host dependencies with links to the current Pi host tree", async (t) => {
	const fixture = await makeFixture(t);

	for (const packageName of PI_HOST_PACKAGES) {
		await writePackage(localPackagePath(fixture.packageRoot, packageName), packageName);
	}

	const links = syncPiHostDeps({
		packageRoot: fixture.packageRoot,
		piCodingAgentRoot: fixture.piCodingAgentRoot,
		execFileSync: neverExec,
	});

	assert.equal(links.length, PI_HOST_PACKAGES.length);
	for (const packageName of PI_HOST_PACKAGES) {
		const localPath = localPackagePath(fixture.packageRoot, packageName);
		assert.equal(lstatSync(localPath).isSymbolicLink(), true, `${packageName} should be a symlink`);
		assert.equal(realpathSync(localPath), fixture.expectedTargets.get(packageName));
	}

	assert.doesNotThrow(() =>
		checkPiHostDeps({
			packageRoot: fixture.packageRoot,
			piCodingAgentRoot: fixture.piCodingAgentRoot,
			execFileSync: neverExec,
		}),
	);
});

test("check reports copied and stale local host dependency entries", async (t) => {
	const fixture = await makeFixture(t);
	syncPiHostDeps({ packageRoot: fixture.packageRoot, piCodingAgentRoot: fixture.piCodingAgentRoot, execFileSync: neverExec });

	const copiedPackage = "@earendil-works/pi-ai";
	rmSync(localPackagePath(fixture.packageRoot, copiedPackage), { recursive: true, force: true });
	await writePackage(localPackagePath(fixture.packageRoot, copiedPackage), copiedPackage);

	const stalePackage = "typebox";
	const staleTarget = path.join(path.dirname(fixture.piCodingAgentRoot), "old-typebox");
	await writePackage(staleTarget, stalePackage);
	rmSync(localPackagePath(fixture.packageRoot, stalePackage), { recursive: true, force: true });
	await symlink(staleTarget, localPackagePath(fixture.packageRoot, stalePackage), "dir");

	assert.throws(
		() =>
			checkPiHostDeps({
				packageRoot: fixture.packageRoot,
				piCodingAgentRoot: fixture.piCodingAgentRoot,
				execFileSync: neverExec,
			}),
		(error) => {
			assert.ok(error instanceof Error);
			assert.match(error.message, /@earendil-works\/pi-ai: .* is a real directory/);
			assert.match(error.message, /typebox: .* resolves to .*old-typebox/);
			return true;
		},
	);
});

function neverExec(): never {
	throw new Error("test should not execute external commands");
}
