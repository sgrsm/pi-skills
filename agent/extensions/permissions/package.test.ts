import assert from "node:assert/strict";
import test from "node:test";
import {
	PackagePermissionStore,
	analyzePackageCommands,
	buildPackagePermissionRequest,
	type PackageProjectResolver,
} from "./package.ts";

const cwd = "/repo/project";

function makeProjectResolver(rootByCwd: Record<string, string> = {}): PackageProjectResolver {
	return {
		async getProjectRoot(actionCwd) {
			return rootByCwd[actionCwd] ?? actionCwd;
		},
	};
}

test("node package installs are guarded while normal npm scripts and metadata reads are ignored", () => {
	assert.equal(analyzePackageCommands("npm install left-pad", cwd).actions[0]?.manager, "npm");
	assert.equal(analyzePackageCommands("npm i", cwd).actions[0]?.operation, "dependency-install");
	assert.equal(analyzePackageCommands("npm ci", cwd).actions[0]?.operation, "dependency-install");
	assert.equal(analyzePackageCommands("npm update", cwd).actions[0]?.operation, "dependency-install");
	assert.equal(analyzePackageCommands("npm install -g typescript", cwd).actions[0]?.operation, "global-install");
	assert.equal(analyzePackageCommands("npx cowsay hi", cwd).actions[0]?.operation, "package-execute");

	assert.deepEqual(analyzePackageCommands("npm test", cwd).actions, []);
	assert.deepEqual(analyzePackageCommands("npm run build", cwd).actions, []);
	assert.deepEqual(analyzePackageCommands("npm view react version", cwd).actions, []);
});

test("yarn pnpm and bun package acquisition commands are guarded", () => {
	assert.equal(analyzePackageCommands("yarn add lodash", cwd).actions[0]?.manager, "yarn");
	assert.equal(analyzePackageCommands("yarn", cwd).actions[0]?.operation, "dependency-install");
	assert.equal(analyzePackageCommands("pnpm install", cwd).actions[0]?.manager, "pnpm");
	assert.equal(analyzePackageCommands("pnpm dlx create-vite", cwd).actions[0]?.operation, "package-execute");
	assert.equal(analyzePackageCommands("bun add hono", cwd).actions[0]?.manager, "bun");
	assert.equal(analyzePackageCommands("bunx eslint .", cwd).actions[0]?.operation, "package-execute");
});

test("python package acquisition commands are guarded", () => {
	assert.equal(analyzePackageCommands("pip install -r requirements.txt", cwd).actions[0]?.manager, "pip");
	assert.equal(analyzePackageCommands("python -m pip install requests", cwd).actions[0]?.manager, "pip");
	assert.equal(analyzePackageCommands("uv add pytest", cwd).actions[0]?.manager, "uv");
	assert.equal(analyzePackageCommands("uv pip install black", cwd).actions[0]?.manager, "uv");
	assert.equal(analyzePackageCommands("poetry install", cwd).actions[0]?.manager, "poetry");
	assert.equal(analyzePackageCommands("pipenv install", cwd).actions[0]?.manager, "pipenv");

	assert.deepEqual(analyzePackageCommands("pip list", cwd).actions, []);
	assert.deepEqual(analyzePackageCommands("poetry show", cwd).actions, []);
});

test("system and language-level package installs are guarded", () => {
	assert.equal(analyzePackageCommands("brew install jq", cwd).actions[0]?.operation, "system-install");
	assert.equal(analyzePackageCommands("sudo apt-get install ripgrep", cwd).actions[0]?.manager, "apt-get");
	assert.equal(analyzePackageCommands("dnf upgrade", cwd).actions[0]?.operation, "system-install");
	assert.equal(analyzePackageCommands("cargo install cargo-nextest", cwd).actions[0]?.operation, "global-install");
	assert.equal(analyzePackageCommands("go install golang.org/x/tools/gopls@latest", cwd).actions[0]?.operation, "global-install");
	assert.equal(analyzePackageCommands("go get example.com/mod", cwd).actions[0]?.operation, "dependency-install");
	assert.equal(analyzePackageCommands("gem install rubocop", cwd).actions[0]?.operation, "global-install");
});

test("maven and gradle commands are intentionally excluded", () => {
	assert.deepEqual(analyzePackageCommands("mvn test", cwd).actions, []);
	assert.deepEqual(analyzePackageCommands("./mvnw package", cwd).actions, []);
	assert.deepEqual(analyzePackageCommands("gradle build", cwd).actions, []);
	assert.deepEqual(analyzePackageCommands("./gradlew test", cwd).actions, []);
});

test("package analyzer honors simple cd and manager-specific project directory flags", () => {
	assert.equal(analyzePackageCommands("cd ../other && npm install", cwd).actions[0]?.cwd, "/repo/other");
	assert.equal(analyzePackageCommands("npm --prefix ../other install", cwd).actions[0]?.cwd, "/repo/other");
	assert.equal(analyzePackageCommands("pip install --target ../vendor requests", cwd).actions[0]?.cwd, "/repo/vendor");
});

test("package permission grants are scoped to project root, manager, and operation", async () => {
	const store = new PackagePermissionStore();
	const request = await buildPackagePermissionRequest(
		analyzePackageCommands("npm install", cwd).actions,
		"npm install",
		makeProjectResolver({ [cwd]: "/repo" }),
	);
	assert.ok(request);

	assert.equal(store.hasGrant(request), false);
	store.addSessionGrant(request, 123);
	assert.equal(store.hasGrant(request), true);

	const sameProjectDifferentManager = await buildPackagePermissionRequest(
		analyzePackageCommands("pip install requests", cwd).actions,
		"pip install requests",
		makeProjectResolver({ [cwd]: "/repo" }),
	);
	assert.ok(sameProjectDifferentManager);
	assert.equal(store.hasGrant(sameProjectDifferentManager), false);

	const sameProjectDifferentOperation = await buildPackagePermissionRequest(
		analyzePackageCommands("npm install -g typescript", cwd).actions,
		"npm install -g typescript",
		makeProjectResolver({ [cwd]: "/repo" }),
	);
	assert.ok(sameProjectDifferentOperation);
	assert.equal(store.hasGrant(sameProjectDifferentOperation), false);

	const differentProject = await buildPackagePermissionRequest(
		analyzePackageCommands("npm install", "/other/project").actions,
		"npm install",
		makeProjectResolver({ "/other/project": "/other/project" }),
	);
	assert.ok(differentProject);
	assert.equal(store.hasGrant(differentProject), false);
});
