import assert from "node:assert/strict";
import test from "node:test";
import {
	PermissionStore,
	analyzeBashMutation,
	buildFileMutationRequest,
	isPathInsideOrEqual,
} from "./permissions.ts";

const cwd = "/repo/project";

function targetSummary(request: NonNullable<ReturnType<typeof analyzeBashMutation>>) {
	return request.targets.map(({ operation, path, scopeDir }) => ({ operation, path, scopeDir }));
}

test("path containment treats nested paths as inside without prefix false positives", () => {
	assert.equal(isPathInsideOrEqual("/repo/project", "/repo/project"), true);
	assert.equal(isPathInsideOrEqual("/repo/project/src/file.ts", "/repo/project"), true);
	assert.equal(isPathInsideOrEqual("/repo/project/..cache/file.ts", "/repo/project"), true);
	assert.equal(isPathInsideOrEqual("/repo/project-other/file.ts", "/repo/project"), false);
	assert.equal(isPathInsideOrEqual("/repo/project/../other/file.ts", "/repo/project"), false);
});

test("file mutation guard only requests permission outside cwd and scopes to parent directory", () => {
	assert.equal(buildFileMutationRequest("write", "src/file.ts", cwd), undefined);

	const request = buildFileMutationRequest("edit", "../shared/config.json", cwd);
	assert.ok(request);
	assert.equal(request.toolName, "edit");
	assert.deepEqual(targetSummary(request), [
		{ operation: "edit", path: "/repo/shared/config.json", scopeDir: "/repo/shared" },
	]);
});

test("bash preserves unnormalized filesystem targets for scratch checks without deduplicating traversal", () => {
	const request = analyzeBashMutation("touch /tmp/scratch/out.txt /tmp/scratch/link/../out.txt", cwd);
	assert.ok(request);
	assert.equal(request.targets.length, 2);
	assert.equal(request.targets[0].path, "/tmp/scratch/out.txt");
	assert.equal(request.targets[1].path, "/tmp/scratch/out.txt");
	assert.equal(request.targets[1].filesystemPath, "/tmp/scratch/link/../out.txt");
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
	assert.deepEqual(targetSummary(outside), [
		{ operation: "delete", path: "/repo/shared", scopeDir: "/repo/shared" },
	]);
});

test("bash write-like mutations outside cwd are detected but read-only commands are ignored", () => {
	assert.equal(analyzeBashMutation("ls /tmp", cwd), undefined);

	const redirected = analyzeBashMutation("echo hello > /tmp/pi-permissions/out.txt", cwd);
	assert.ok(redirected);
	assert.deepEqual(targetSummary(redirected), [
		{ operation: "bash-mutate", path: "/tmp/pi-permissions/out.txt", scopeDir: "/tmp/pi-permissions/out.txt" },
	]);

	const copied = analyzeBashMutation("cp package.json /tmp/pi-permissions/package.json", cwd);
	assert.ok(copied);
	assert.deepEqual(targetSummary(copied), [
		{ operation: "bash-mutate", path: "/tmp/pi-permissions/package.json", scopeDir: "/tmp/pi-permissions/package.json" },
	]);
});

test("bash ignores output suppression to /dev/null via redirection and tee", () => {
	for (const command of [
		"echo hello >/dev/null",
		"echo hello > /dev/null",
		"echo hello 1>/dev/null",
		"echo hello 2>/dev/null",
		"echo hello >>/dev/null",
		"echo hello 2>>/dev/null",
		"echo hello &>/dev/null",
		"echo hello &>>/dev/null",
		"printf hi | tee /dev/null",
	]) {
		assert.equal(analyzeBashMutation(command, cwd), undefined, command);
	}
});

test("bash ignores only /dev/null output targets while preserving other tee targets", () => {
	const request = analyzeBashMutation("printf hi | tee /dev/null /tmp/pi-permissions/out.txt", cwd);
	assert.ok(request);
	assert.deepEqual(targetSummary(request), [
		{ operation: "bash-mutate", path: "/tmp/pi-permissions/out.txt", scopeDir: "/tmp/pi-permissions/out.txt" },
	]);
});

test("bash still guards destructive or metadata-changing operations against /dev/null", () => {
	const deleted = analyzeBashMutation("rm /dev/null", cwd);
	assert.ok(deleted);
	assert.deepEqual(targetSummary(deleted), [
		{ operation: "delete", path: "/dev/null", scopeDir: "/dev/null" },
	]);

	const chmodded = analyzeBashMutation("chmod 666 /dev/null", cwd);
	assert.ok(chmodded);
	assert.deepEqual(targetSummary(chmodded), [
		{ operation: "bash-mutate", path: "/dev/null", scopeDir: "/dev/null" },
	]);
});

test("bash mutation detection tracks simple cd commands before relative targets", () => {
	assert.equal(analyzeBashMutation("cd src && rm generated.txt", cwd), undefined);

	const request = analyzeBashMutation("cd ../shared && rm generated.txt", cwd);
	assert.ok(request);
	assert.deepEqual(targetSummary(request), [
		{ operation: "delete", path: "/repo/shared/generated.txt", scopeDir: "/repo/shared/generated.txt" },
	]);
});
