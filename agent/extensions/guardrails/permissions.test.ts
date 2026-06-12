import assert from "node:assert/strict";
import test from "node:test";
import {
	PermissionStore,
	analyzeBashMutation,
	buildFileMutationRequest,
	isPathInsideOrEqual,
} from "./permissions.ts";

const cwd = "/repo/project";

test("path containment treats nested paths as inside without prefix false positives", () => {
	assert.equal(isPathInsideOrEqual("/repo/project", "/repo/project"), true);
	assert.equal(isPathInsideOrEqual("/repo/project/src/file.ts", "/repo/project"), true);
	assert.equal(isPathInsideOrEqual("/repo/project-other/file.ts", "/repo/project"), false);
	assert.equal(isPathInsideOrEqual("/repo/project/../other/file.ts", "/repo/project"), false);
});

test("file mutation guard only requests permission outside cwd and scopes to parent directory", () => {
	assert.equal(buildFileMutationRequest("write", "src/file.ts", cwd), undefined);

	const request = buildFileMutationRequest("edit", "../shared/config.json", cwd);
	assert.ok(request);
	assert.equal(request.toolName, "edit");
	assert.deepEqual(request.targets.map((target) => ({ operation: target.operation, path: target.path, scopeDir: target.scopeDir })), [
		{ operation: "edit", path: "/repo/shared/config.json", scopeDir: "/repo/shared" },
	]);
});

test("session grants apply only to matching operation and requested directory subtree", () => {
	const store = new PermissionStore();
	const request = buildFileMutationRequest("write", "/tmp/allowed/file.txt", cwd);
	assert.ok(request);

	assert.equal(store.hasGrant(request), false);
	store.addSessionGrant(request);
	assert.equal(store.hasGrant(request), true);

	const nested = buildFileMutationRequest("write", "/tmp/allowed/nested/other.txt", cwd);
	assert.ok(nested);
	assert.equal(store.hasGrant(nested), true);
	store.addSessionGrant(nested);
	assert.equal(store.list().length, 1);

	const sibling = buildFileMutationRequest("write", "/tmp/allowed-other/file.txt", cwd);
	assert.ok(sibling);
	assert.equal(store.hasGrant(sibling), false);

	const differentOperation = buildFileMutationRequest("edit", "/tmp/allowed/file.txt", cwd);
	assert.ok(differentOperation);
	assert.equal(store.hasGrant(differentOperation), false);
});

test("bash delete outside cwd is detected while delete inside cwd is ignored", () => {
	const inside = analyzeBashMutation("rm -rf ./dist", cwd);
	assert.equal(inside, undefined);

	const outside = analyzeBashMutation("rm -rf ../shared", cwd);
	assert.ok(outside);
	assert.equal(outside.toolName, "bash");
	assert.deepEqual(outside.targets.map((target) => ({ operation: target.operation, path: target.path, scopeDir: target.scopeDir })), [
		{ operation: "delete", path: "/repo/shared", scopeDir: "/repo/shared" },
	]);
});

test("bash write-like mutations outside cwd are detected but read-only commands are ignored", () => {
	assert.equal(analyzeBashMutation("ls /tmp", cwd), undefined);

	const redirected = analyzeBashMutation("echo hello > /tmp/pi-guardrails/out.txt", cwd);
	assert.ok(redirected);
	assert.deepEqual(redirected.targets.map((target) => ({ operation: target.operation, path: target.path, scopeDir: target.scopeDir })), [
		{ operation: "bash-mutate", path: "/tmp/pi-guardrails/out.txt", scopeDir: "/tmp/pi-guardrails/out.txt" },
	]);

	const copied = analyzeBashMutation("cp package.json /tmp/pi-guardrails/package.json", cwd);
	assert.ok(copied);
	assert.deepEqual(copied.targets.map((target) => ({ operation: target.operation, path: target.path, scopeDir: target.scopeDir })), [
		{ operation: "bash-mutate", path: "/tmp/pi-guardrails/package.json", scopeDir: "/tmp/pi-guardrails/package.json" },
	]);
});

test("bash mutation detection tracks simple cd commands before relative targets", () => {
	assert.equal(analyzeBashMutation("cd src && rm generated.txt", cwd), undefined);

	const request = analyzeBashMutation("cd ../shared && rm generated.txt", cwd);
	assert.ok(request);
	assert.deepEqual(request.targets.map((target) => ({ operation: target.operation, path: target.path, scopeDir: target.scopeDir })), [
		{ operation: "delete", path: "/repo/shared/generated.txt", scopeDir: "/repo/shared/generated.txt" },
	]);
});
