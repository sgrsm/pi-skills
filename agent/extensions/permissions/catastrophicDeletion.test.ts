import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { analyzeCatastrophicDeletion } from "./catastrophicDeletion.ts";
import { withTestScratchFixture } from "./testScratch.ts";

test("critical roots hard-deny while concrete critical children remain ordinary deletion", async () => {
	await withTestScratchFixture(async (fixture) => {
		const context = { cwd: fixture.project, home: fixture.fakeHome };
		const criticalCases = [
			{ command: "rm -- /", target: await realpath("/") },
			{ command: "rmdir .", target: await realpath(fixture.project) },
			{ command: "unlink ..", target: await realpath(fixture.root) },
			{ command: `rm ${fixture.fakeHome}`, target: await realpath(fixture.fakeHome) },
			{ command: "rm ~", target: await realpath(fixture.fakeHome) },
			{ command: `/bin/rm ${dirname(fixture.project)}`, target: await realpath(fixture.root) },
			{ command: "find . -delete", target: await realpath(fixture.project) },
		];

		for (const { command, target } of criticalCases) {
			const result = await analyzeCatastrophicDeletion(command, context);
			assert.equal(result.kind, "hard-deny", command);
			assert.equal(result.reasonCode, "P0_DELETE_CRITICAL_TARGET", command);
			assert.equal(result.targets.some((item) => item.canonicalTarget === target), true, command);
		}

		await fixture.mkdir(join(fixture.project, "dist"));
		await fixture.writeFile(join(fixture.fakeHome, "child.txt"), "fixture\n");
		await fixture.mkdir(join(fixture.project, "generated"));
		for (const command of ["rm ./dist", `unlink ${join(fixture.fakeHome, "child.txt")}`, "find ./generated -delete"]) {
			const result = await analyzeCatastrophicDeletion(command, context);
			assert.equal(result.kind, "concrete-noncritical", command);
			assert.equal(result.reasonCode, "P0_CONCRETE_NONCRITICAL_DELETE", command);
		}
	});
});

test("common boundaries, redirections, assignments, wrappers, and control positions keep visible critical deletion recognizable", async () => {
	await withTestScratchFixture(async (fixture) => {
		const context = { cwd: fixture.project, home: fixture.fakeHome };
		for (const command of [
			"printf ok; rm .",
			"printf ok && rm .",
			"printf ok || rm .",
			"printf ok | rm .",
			"printf ok\nrm .",
			"MODE=test command rm .",
			"sudo -- /bin/rm .",
			"sudo MODE=test rm .",
			"env MODE=test rm .",
			"nice -n 10 rm .",
			"ionice -c 2 -n 7 rm .",
			"time -p rm .",
			"2>/dev/null rm .",
			"2>&1 rm -rf /",
			">&2 rm -rf /",
			"<&0 rm -rf /",
			"&>/dev/null rm -rf /",
			"&>>/dev/null rm -rf /",
			"if test -d .; then rm .; fi",
			"for item in child; do rm .; done",
			"(rm .)",
		]) {
			const result = await analyzeCatastrophicDeletion(command, context);
			assert.equal(result.kind, "hard-deny", command);
			assert.equal(result.reasonCode, "P0_DELETE_CRITICAL_TARGET", command);
		}
	});
});

test("command lookup mode is inert while command execution wrappers remain analyzed", async () => {
	await withTestScratchFixture(async (fixture) => {
		const context = { cwd: fixture.project, home: fixture.fakeHome };
		for (const command of [
			"command -v rm",
			"command -V rm",
			"command -v rmdir",
			"command -V rmdir",
			"command -v unlink",
			"command -V unlink",
			"command -v find",
			"command -V find",
			"command -pv rm",
			"command -V -- find",
		]) {
			const result = await analyzeCatastrophicDeletion(command, context);
			assert.equal(result.kind, "no-visible-deletion", command);
			assert.equal(result.reasonCode, "P0_NO_DELETION", command);
		}

		for (const command of ["command rm .", "command -p rm .", "command -p -- rm ."]) {
			const result = await analyzeCatastrophicDeletion(command, context);
			assert.equal(result.kind, "hard-deny", command);
			assert.equal(result.reasonCode, "P0_DELETE_CRITICAL_TARGET", command);
		}
	});
});

test("dynamic targets, malformed visible deletion, parent-removing rmdir, and broad find traversal hard-deny", async () => {
	await withTestScratchFixture(async (fixture) => {
		const context = { cwd: fixture.project, home: fixture.fakeHome };
		const cases = [
			["rm -rf $HOME/child", "P0_DELETE_DYNAMIC_TARGET"],
			["rm -rf \"${HOME}/child\"", "P0_DELETE_DYNAMIC_TARGET"],
			["rm -rf $PWD", "P0_DELETE_DYNAMIC_TARGET"],
			["rm -rf ./*", "P0_DELETE_DYNAMIC_TARGET"],
			["rm -rf ./build/{a,b}", "P0_DELETE_DYNAMIC_TARGET"],
			["rm -rf \"$(printf target)\"", "P0_DELETE_DYNAMIC_TARGET"],
			["find $ROOT -delete", "P0_DELETE_DYNAMIC_TARGET"],
			["rm 'unterminated", "P0_DELETE_MALFORMED_SYNTAX"],
			["rm ./child &&", "P0_DELETE_MALFORMED_SYNTAX"],
			["rmdir -pv child", "P0_DELETE_UNSUPPORTED_SYNTAX"],
			["rmdir --parents child", "P0_DELETE_UNSUPPORTED_SYNTAX"],
		] as const;

		for (const [command, reasonCode] of cases) {
			const result = await analyzeCatastrophicDeletion(command, context);
			assert.equal(result.kind, "hard-deny", command);
			assert.equal(result.reasonCode, reasonCode, command);
		}
	});
});

test("command-boundary and subshell cwd scopes cannot redirect later deletion onto an assumed child cwd", async () => {
	await withTestScratchFixture(async (fixture) => {
		const context = { cwd: fixture.project, home: fixture.fakeHome };
		await fixture.mkdir(join(fixture.project, "generated"));

		for (const command of [
			"cd ./missing || find . -delete",
			"cd ./generated | find . -delete",
			"cd ./generated & find . -delete",
			"(cd ./generated && printf ok) && find . -delete",
			"(cd ./generated && printf ok) | find . -delete",
			"(cd ./generated && printf ok) & find . -delete",
			"(cd ./generated); (find . -delete)",
		]) {
			const result = await analyzeCatastrophicDeletion(command, context);
			assert.equal(result.kind, "hard-deny", command);
			assert.equal(result.reasonCode, "P0_DELETE_CRITICAL_TARGET", command);
		}

		const uncertain = await analyzeCatastrophicDeletion("cd ./missing; find . -delete", context);
		assert.equal(uncertain.kind, "hard-deny");
		assert.equal(uncertain.reasonCode, "P0_DELETE_UNSUPPORTED_SYNTAX");
		assert.match(uncertain.reason, /explicit path/i);

		const malformedGroup = await analyzeCatastrophicDeletion(
			"(cd ./generated && printf ok) && (find . -delete",
			context,
		);
		assert.equal(malformedGroup.kind, "hard-deny");
		assert.equal(malformedGroup.reasonCode, "P0_DELETE_MALFORMED_SYNTAX");
		assert.match(malformedGroup.reason, /explicit target path/i);

		for (const command of [
			"cd ./generated && find . -delete",
			"(cd ./generated && find . -delete)",
		]) {
			const successfulAnd = await analyzeCatastrophicDeletion(command, context);
			assert.equal(successfulAnd.kind, "concrete-noncritical", command);
			assert.equal(
				successfulAnd.targets[0]?.canonicalTarget,
				await realpath(join(fixture.project, "generated")),
				command,
			);
		}
	});
});

test("simple cwd transitions and visible command substitutions cannot redirect deletion onto a protected root", async () => {
	await withTestScratchFixture(async (fixture) => {
		const context = { cwd: fixture.project, home: fixture.fakeHome };
		for (const command of [
			"cd .. && rm -rf project",
			`printf '%s\\n' "$(rm -rf ${fixture.project})"`,
			`result="$(rm -rf ${fixture.project})"`,
			`printf '%s\\n' \`rm -rf ${fixture.project}\``,
		]) {
			const result = await analyzeCatastrophicDeletion(command, context);
			assert.equal(result.kind, "hard-deny", command);
			assert.equal(result.reasonCode, "P0_DELETE_CRITICAL_TARGET", command);
		}
	});
});

test("find-delete denies only an explicit bounded set of broad traversal roots", async () => {
	await withTestScratchFixture(async (fixture) => {
		const context = { cwd: fixture.project, home: fixture.fakeHome };
		for (const command of ["find /tmp -delete", "find /var/tmp -delete"]) {
			const result = await analyzeCatastrophicDeletion(command, context);
			assert.equal(result.kind, "hard-deny", command);
			assert.equal(result.reasonCode, "P0_DELETE_BROAD_FIND_ROOT", command);
		}

		const concreteAbsoluteRoot = join(fixture.protectedDir, "old-build");
		const allowed = await analyzeCatastrophicDeletion(`find ${concreteAbsoluteRoot} -delete`, context);
		assert.equal(allowed.kind, "concrete-noncritical");
		assert.equal(allowed.targets[0]?.resolvedTarget, concreteAbsoluteRoot);
	});
});

test("standard find traversal options preserve concrete noncritical cleanup", async () => {
	await withTestScratchFixture(async (fixture) => {
		const context = { cwd: fixture.project, home: fixture.fakeHome };
		await fixture.mkdir(join(fixture.project, "generated"));
		for (const command of ["find -P ./generated -delete", "find -L ./generated -delete"]) {
			const result = await analyzeCatastrophicDeletion(command, context);
			assert.equal(result.kind, "concrete-noncritical", command);
			assert.equal(result.reasonCode, "P0_CONCRETE_NONCRITICAL_DELETE", command);
		}
	});
});

test("literal nested shell payloads distinguish critical deletion from concrete cleanup", async () => {
	await withTestScratchFixture(async (fixture) => {
		const context = { cwd: fixture.project, home: fixture.fakeHome };
		await fixture.mkdir(join(fixture.project, "child"));

		for (const command of ["sh -c 'rm .'", "bash -c 'find . -delete'"]) {
			const result = await analyzeCatastrophicDeletion(command, context);
			assert.equal(result.kind, "hard-deny", command);
			assert.equal(result.reasonCode, "P0_DELETE_CRITICAL_TARGET", command);
		}

		for (const command of ["sh -c 'rm ./child'", "bash -c 'rm ./already-absent'"]) {
			const result = await analyzeCatastrophicDeletion(command, context);
			assert.equal(result.kind, "concrete-noncritical", command);
			assert.equal(result.reasonCode, "P0_CONCRETE_NONCRITICAL_DELETE", command);
		}
	});
});

test("visible eval, xargs, and find-exec deletion hard-deny as bounded indirect execution", async () => {
	await withTestScratchFixture(async (fixture) => {
		const context = { cwd: fixture.project, home: fixture.fakeHome };
		for (const command of [
			"eval 'rm ./child'",
			"printf '%s\\0' child | xargs -0 rm",
			"xargs sh -c 'rm .'",
			"find ./child -exec rm -rf {} +",
			"find ./child -exec sh -c 'rm .' {} +",
		]) {
			const result = await analyzeCatastrophicDeletion(command, context);
			assert.equal(result.kind, "hard-deny", command);
			assert.equal(result.reasonCode, "P0_DELETE_INDIRECT_EXECUTION", command);
		}
	});
});

test("ordinary nonexistent cleanup uses lexical and nearest-existing-parent resolution", async () => {
	await withTestScratchFixture(async (fixture) => {
		const context = { cwd: fixture.project, home: fixture.fakeHome };
		const existing = join(fixture.project, "existing");
		const link = join(fixture.project, "existing-link");
		await fixture.mkdir(existing);
		await fixture.symlink(existing, link);

		for (const command of [
			"rm ./absent",
			"unlink ./existing/absent",
			"find ./existing/absent -delete",
			"rm ./existing-link/absent",
		]) {
			const result = await analyzeCatastrophicDeletion(command, context);
			assert.equal(result.kind, "concrete-noncritical", command);
			assert.equal(result.reasonCode, "P0_CONCRETE_NONCRITICAL_DELETE", command);
		}
	});
});

test("harmless wrappers, control syntax, dynamic executables, startup state, comments, and inert operands are unaffected", async () => {
	await withTestScratchFixture(async (fixture) => {
		const context = { cwd: fixture.project, home: fixture.fakeHome };
		for (const command of [
			"nice -n 10 printf ok",
			"ionice -c2 -n7 printf ok",
			"time -p \"$COMMAND\"",
			"if test -d .; then printf ok; fi",
			"while false; do printf never; done",
			"for item in one two; do printf '%s\\n' \"$item\"; done",
			"\"$COMMAND\" --version",
			"BASH_ENV=./startup bash -c 'printf ok'",
			"bash --rcfile ./startup -c 'printf ok'",
			"printf '%s\\n' 'rm .'",
			"printf ok # rm .",
			"printf '%s%s' r m | sh",
		]) {
			const result = await analyzeCatastrophicDeletion(command, context);
			assert.equal(result.kind, "no-visible-deletion", command);
			assert.equal(result.reasonCode, "P0_NO_DELETION", command);
		}
	});
});

test("recognized deletion fails closed when critical context cannot be resolved", async () => {
	await withTestScratchFixture(async (fixture) => {
		const result = await analyzeCatastrophicDeletion("rm ./child", {
			cwd: join(fixture.project, "missing-cwd"),
			home: fixture.fakeHome,
		});
		assert.equal(result.kind, "hard-deny");
		assert.equal(result.reasonCode, "P0_DELETE_CONTEXT_RESOLUTION_FAILED");
	});
});
