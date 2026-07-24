import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { initTheme, type BashOperations, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import permissionsExtension, { type PermissionsExtensionOptions } from "./index.ts";
import { CatastrophicDeletionBlockedError, createGuardedBashOperations } from "./bashGuard.ts";
import { withTestScratchFixture } from "./testScratch.ts";
import { createTestExtensionContext } from "./testContext.ts";

test("guarded operations hard-deny before delegation and pass concrete or harmless commands unchanged", async () => {
	await withTestScratchFixture(async (fixture) => {
		const calls: Array<{ command: string; cwd: string; options: Parameters<BashOperations["exec"]>[2] }> = [];
		const guarded = createGuardedBashOperations(createDelegateSpy(calls), { home: fixture.fakeHome });
		const options: Parameters<BashOperations["exec"]>[2] = {
			onData() {},
			timeout: 7,
			env: { BASH_ENV: "preserve-standard-environment", SAFE_VALUE: "yes" },
		};

		await assert.rejects(
			guarded.exec("rm .", fixture.project, options),
			(error: unknown) => error instanceof CatastrophicDeletionBlockedError && error.reasonCode === "P0_DELETE_CRITICAL_TARGET",
		);
		assert.equal(calls.length, 0);

		for (const command of [
			"rm ./already-absent",
			"command -v rm",
			"command -V find",
			"nice -n 10 printf ok",
			"if test -d .; then printf ok; fi",
			"\"$COMMAND\" --version",
		]) {
			await guarded.exec(command, fixture.project, options);
		}
		assert.deepEqual(calls.map(({ command, cwd }) => ({ command, cwd })), [
			{ command: "rm ./already-absent", cwd: fixture.project },
			{ command: "command -v rm", cwd: fixture.project },
			{ command: "command -V find", cwd: fixture.project },
			{ command: "nice -n 10 printf ok", cwd: fixture.project },
			{ command: "if test -d .; then printf ok; fi", cwd: fixture.project },
			{ command: "\"$COMMAND\" --version", cwd: fixture.project },
		]);
		assert.equal(calls.every((call) => call.options === options), true, "Pi-standard operation options must pass through unchanged");
		assert.equal(calls[0]?.options.env?.BASH_ENV, "preserve-standard-environment");
	});
});

test("guarded operations keep visible dynamic, nested-critical, and indirect deletion away from the delegate", async () => {
	await withTestScratchFixture(async (fixture) => {
		const calls: Array<{ command: string; cwd: string; options: Parameters<BashOperations["exec"]>[2] }> = [];
		const guarded = createGuardedBashOperations(createDelegateSpy(calls), { home: fixture.fakeHome });
		await fixture.mkdir(join(fixture.project, "generated"));

		for (const command of [
			"rm -rf $PWD",
			"cd .. && rm -rf project",
			"cd ./missing || find . -delete",
			"cd ./missing; find . -delete",
			"cd ./child | find . -delete",
			"cd ./child & find . -delete",
			"(cd ./generated && printf ok) && find . -delete",
			"(cd ./generated && printf ok) | find . -delete",
			"(cd ./generated && printf ok) & find . -delete",
			"(cd ./generated); (find . -delete)",
			"(cd ./generated && printf ok) && (find . -delete",
			"2>&1 rm -rf /",
			">&2 rm -rf /",
			"<&0 rm -rf /",
			"&>/dev/null rm -rf /",
			"find /tmp -delete",
			`printf '%s\\n' "$(rm -rf ${fixture.project})"`,
			"sudo MODE=test rm .",
			"sh -c 'rm .'",
			"eval 'rm .'",
			"printf '%s\\0' child | xargs -0 rm",
			"find ./child -exec rm -rf {} +",
		]) {
			await assert.rejects(guarded.exec(command, fixture.project, { onData() {} }), CatastrophicDeletionBlockedError, command);
		}
		assert.equal(calls.length, 0);
	});
});

test("guarded operations canonicalize a visible target at the final delegate boundary", async () => {
	await withTestScratchFixture(async (fixture) => {
		const criticalLink = join(fixture.protectedDir, "project-link");
		await fixture.symlink(fixture.project, criticalLink);
		const calls: Array<{ command: string; cwd: string; options: Parameters<BashOperations["exec"]>[2] }> = [];
		const guarded = createGuardedBashOperations(createDelegateSpy(calls), { home: fixture.fakeHome });

		await assert.rejects(guarded.exec(`rm ${criticalLink}`, fixture.project, { onData() {} }), CatastrophicDeletionBlockedError);
		assert.equal(calls.length, 0);
	});
});

test("permissions-owned default backend requests Pi-standard local shell operations without forcing a shell", async () => {
	await withTestScratchFixture(async (fixture) => {
		const calls: Array<{ command: string; cwd: string; options: Parameters<BashOperations["exec"]>[2] }> = [];
		let factoryCalls = 0;
		let factoryOptions: { shellPath?: string } | undefined = { shellPath: "not-called" };
		createToolHarness({
			systemTempDir: fixture.sessionTemp,
			home: fixture.fakeHome,
			hideToolOutputEnabled: () => false,
			localBashOperationsFactory(options) {
				factoryCalls += 1;
				factoryOptions = options;
				return createDelegateSpy(calls);
			},
		});

		assert.equal(factoryCalls, 1);
		assert.equal(factoryOptions, undefined);
		assert.equal(calls.length, 0, "constructing the permissions backend must not execute a shell");
	});
});

test("permissions-owned model bash uses ctx.cwd and performs the final non-delegating denial", async () => {
	await withTestScratchFixture(async (fixture) => {
		const calls: Array<{ command: string; cwd: string; options: Parameters<BashOperations["exec"]>[2] }> = [];
		const harness = createToolHarness({
			systemTempDir: fixture.sessionTemp,
			bashOperations: createDelegateSpy(calls),
			home: fixture.fakeHome,
			hideToolOutputEnabled: () => true,
		});
		const bash = harness.tools.get("bash");
		assert.ok(bash, "permissions must own the model bash definition");
		assert.equal(typeof bash.renderCall, "function", "built-in Bash call rendering must be preserved");
		assert.equal(typeof bash.renderResult, "function", "permissions must compose hidden Bash results");

		const ctx = createContext(fixture.project);

		await assert.rejects(
			bash.execute("dangerous-call", { command: "rm ." }, undefined, undefined, ctx),
			CatastrophicDeletionBlockedError,
		);
		assert.equal(calls.length, 0);

		await bash.execute("allowed-call", { command: "printf ok" }, undefined, undefined, ctx);
		assert.deepEqual(calls.map(({ command, cwd }) => ({ command, cwd })), [{ command: "printf ok", cwd: fixture.project }]);
	});
});

test("permissions-owned Bash preserves mutable built-in result state across hidden then visible rendering", async () => {
	initTheme("dark", false);
	await withTestScratchFixture(async (fixture) => {
		let hidden = true;
		const harness = createToolHarness({
			systemTempDir: fixture.sessionTemp,
			bashOperations: createDelegateSpy([]),
			home: fixture.fakeHome,
			hideToolOutputEnabled: () => hidden,
		});
		const bash = harness.tools.get("bash");
		assert.ok(bash?.renderResult);
		const state = { startedAt: undefined, endedAt: undefined, interval: undefined };
		const baseContext = { state, invalidate() {}, showImages: true, isError: false };
		const result = { content: [{ type: "text" as const, text: "visible-output" }], details: undefined };

		const hiddenComponent = bash.renderResult(
			result,
			{ expanded: false, isPartial: false },
			{} as any,
			{ ...baseContext, lastComponent: undefined } as any,
		);
		assert.equal(hiddenComponent.render(100).join("\n").includes("visible-output"), false);

		hidden = false;
		let visibleComponent: any;
		assert.doesNotThrow(() => {
			visibleComponent = bash.renderResult?.(
				result,
				{ expanded: false, isPartial: false },
				{} as any,
				{ ...baseContext, lastComponent: hiddenComponent } as any,
			);
		});
		assert.equal(visibleComponent.render(100).join("\n").includes("visible-output"), true);
	});
});

test("TUI user_bash returns complete non-executing denials and guards Pi's final prefixed operation", async () => {
	await withTestScratchFixture(async (fixture) => {
		const calls: Array<{ command: string; cwd: string; options: Parameters<BashOperations["exec"]>[2] }> = [];
		const harness = createToolHarness({
			systemTempDir: fixture.sessionTemp,
			bashOperations: createDelegateSpy(calls),
			home: fixture.fakeHome,
			hideToolOutputEnabled: () => false,
		});
		const ctx = createContext(fixture.project);

		for (const excludeFromContext of [false, true]) {
			const denied = await harness.emitFirst("user_bash", {
				command: "rm .",
				excludeFromContext,
				cwd: fixture.project,
			}, ctx) as any;
			assert.equal(denied?.result?.exitCode, 1);
			assert.match(denied?.result?.output ?? "", /P0_DELETE_CRITICAL_TARGET/);
		}
		assert.equal(calls.length, 0);

		const allowed = await harness.emitFirst("user_bash", {
			command: "printf ok",
			excludeFromContext: true,
			cwd: fixture.project,
		}, ctx) as any;
		assert.ok(allowed?.operations);
		for (const finalCommand of ["prefix\nrm .", "cd .. && rm -rf project"]) {
			await assert.rejects(
				allowed.operations.exec(finalCommand, fixture.project, { onData() {} }),
				CatastrophicDeletionBlockedError,
			);
		}
		assert.equal(calls.length, 0, "the final operations check must see Pi's prefixed or cwd-mutating TUI command");
	});
});

function createDelegateSpy(
	calls: Array<{ command: string; cwd: string; options: Parameters<BashOperations["exec"]>[2] }>,
): BashOperations {
	return {
		async exec(command, cwd, options) {
			calls.push({ command, cwd, options });
			return { exitCode: 0 };
		},
	};
}

function createToolHarness(options: PermissionsExtensionOptions) {
	const tools = new Map<string, ToolDefinition<any, any, any>>();
	const handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();
	const pi = {
		registerTool(tool: ToolDefinition<any, any, any>) {
			tools.set(tool.name, tool);
		},
		registerCommand() {},
		on(eventName: string, handler: (event: any, ctx: any) => unknown) {
			const existing = handlers.get(eventName) ?? [];
			existing.push(handler);
			handlers.set(eventName, existing);
		},
		exec: async () => ({ code: 1, stdout: "", stderr: "" }),
		appendEntry() {},
		getAllTools: () => [],
	} as never;
	permissionsExtension(pi, options);
	return {
		tools,
		async emitFirst(eventName: string, event: unknown, ctx: unknown) {
			return handlers.get(eventName)?.[0]?.(event, ctx);
		},
	};
}

function createContext(cwd: string) {
	return createTestExtensionContext({ cwd, sessionId: "bash-guard-test" });
}
