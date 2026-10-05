import assert from "node:assert/strict";
import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createEventBus, type ExtensionUIContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import permissionsExtension, { formatPermissionStatus, getPermissionsArgumentCompletions } from "./index.ts";
import { FOOTER_STATUS_KEYS } from "../shared/footerStatus.ts";
import { createPiTempWorkspace } from "./tempWorkspace.ts";
import { withTestScratchFixture } from "./testScratch.ts";
import { createTestExtensionCommandContext } from "./testContext.ts";

const markerTheme = {
	fg(color: string, text: string) {
		return `<${color}>${text}</${color}>`;
	},
	bold(text: string) {
		return `<bold>${text}</bold>`;
	},
} as unknown as ExtensionUIContext["theme"];

test("permissions command offers mode and clear argument completions", () => {
	assert.deepEqual(getPermissionsArgumentCompletions(""), [
		{ value: "on", label: "on", description: "Enable permissions guards" },
		{ value: "off", label: "off", description: "Disable permissions guards" },
		{ value: "clear", label: "clear", description: "Clear current session permission grants" },
	]);
	assert.deepEqual(getPermissionsArgumentCompletions("o"), [
		{ value: "on", label: "on", description: "Enable permissions guards" },
		{ value: "off", label: "off", description: "Disable permissions guards" },
	]);
	assert.deepEqual(getPermissionsArgumentCompletions("cl"), [
		{ value: "clear", label: "clear", description: "Clear current session permission grants" },
	]);
	assert.equal(getPermissionsArgumentCompletions("show"), null);
	assert.equal(getPermissionsArgumentCompletions("clear now"), null);
});

test("permission status is always visible and reflects mode or granted count details", () => {
	assert.equal(
		formatPermissionStatus({ enabled: true, grants: { fs: 0, git: 0, deps: 0 }, theme: markerTheme }),
		"<dim>permissions: </dim><dim>on</dim><dim> •</dim>",
	);
	assert.equal(
		formatPermissionStatus({ enabled: false, grants: { fs: 2, git: 1, deps: 0 }, theme: markerTheme }),
		"<dim>permissions: </dim><error>off</error><dim> •</dim>",
	);
	assert.equal(
		formatPermissionStatus({ enabled: true, grants: { fs: 2, git: 1, deps: 0 }, theme: markerTheme }),
		"<dim>permissions: </dim><syntaxComment><bold>3</bold></syntaxComment><dim> (fs×2, git)</dim><dim> •</dim>",
	);
	assert.equal(
		formatPermissionStatus({ enabled: true, grants: { fs: 1, git: 0, deps: 2 }, theme: markerTheme }),
		"<dim>permissions: </dim><syntaxComment><bold>3</bold></syntaxComment><dim> (fs, deps×2)</dim><dim> •</dim>",
	);
});

test("permissions off disables guards without clearing existing command behavior", async () => {
	const harness = createPermissionsHarness();
	const ctx = createContext("Deny");
	ctx.statuses.set("3-permissions", "legacy status");

	await harness.emit("session_start", {}, ctx);
	assert.equal(ctx.statuses.has("3-permissions"), false);
	assert.equal(ctx.statuses.get(FOOTER_STATUS_KEYS.permissions), "<dim>permissions: </dim><dim>on</dim><dim> •</dim>");

	await harness.commands.get("permissions")?.handler("off", ctx);
	assert.equal(ctx.statuses.get(FOOTER_STATUS_KEYS.permissions), "<dim>permissions: </dim><error>off</error><dim> •</dim>");

	const disabledResult = await harness.emitFirst("tool_call", { toolName: "write", input: { path: "/tmp/out.txt" } }, ctx);
	assert.equal(disabledResult, undefined);
	assert.equal(ctx.selectCalls, 0);

	await harness.commands.get("permissions")?.handler("on", ctx);
	assert.equal(ctx.statuses.get(FOOTER_STATUS_KEYS.permissions), "<dim>permissions: </dim><dim>on</dim><dim> •</dim>");

	const enabledResult = await harness.emitFirst("tool_call", { toolName: "write", input: { path: "/tmp/out.txt" } }, ctx);
	assert.deepEqual(enabledResult, { block: true, reason: "Blocked by user. Target scope(s): write /tmp" });
	assert.equal(ctx.selectCalls, 1);
});

test("session permission grants update the visible granted count", async () => {
	const harness = createPermissionsHarness();
	const ctx = createContext("Allow for current session");

	await harness.emit("session_start", {}, ctx);
	await harness.emitFirst("tool_call", { toolName: "write", input: { path: "/tmp/out.txt" } }, ctx);

	assert.equal(ctx.statuses.get(FOOTER_STATUS_KEYS.permissions), "<dim>permissions: </dim><syntaxComment><bold>1</bold></syntaxComment><dim> (fs)</dim><dim> •</dim>");
});

test("before_agent_start prepares private scratch before advertising it and preserves other sections", async () => {
	await withTestScratchFixture(async (fixture) => {
		const harness = createPermissionsHarness(fixture.sessionTemp);
		const ctx = createContext("Deny", "permissions-prompt-test", fixture.project);
		const workspace = createPiTempWorkspace("permissions-prompt-test", { systemTempDir: fixture.sessionTemp });

		await harness.emit("session_start", {}, ctx);
		const systemPromptOptions = { sections: { unrelated: "Keep me" } as Record<string, string> };
		const result = await harness.emitFirst("before_agent_start", { systemPrompt: "Base prompt", systemPromptOptions }, ctx);

		assert.equal(result, undefined);
		assert.deepEqual(systemPromptOptions.sections, {
			unrelated: "Keep me",
			permissions_scratch: `Session scratch (already created): ${workspace.sessionDir}\nWrite files or create subdirectories below it instead of /tmp. Pi manages the root; do not mkdir, chmod, rename, or delete it. Use explicit destination filenames.`,
		});
		const created = await stat(workspace.sessionDir);
		assert.equal(created.isDirectory(), true);
		if (process.platform !== "win32") assert.equal(created.mode & 0o777, 0o700);
		assert.equal(ctx.selectCalls, 0);

		await harness.emit("before_agent_start", { systemPromptOptions }, ctx);
		assert.equal(systemPromptOptions.sections.permissions_scratch.split(workspace.sessionDir).length - 1, 1);
		assert.equal(ctx.selectCalls, 0);
	});
});

test("failed scratch initialization removes a stale hint without requesting approval", async () => {
	await withTestScratchFixture(async (fixture) => {
		const harness = createPermissionsHarness(fixture.sessionTemp);
		const ctx = createContext("Deny", "permissions-unsafe-temp-test", fixture.project);
		await fixture.symlink(fixture.protectedDir, join(fixture.sessionTemp, "pi"));
		await harness.emit("session_start", {}, ctx);
		const systemPromptOptions = { sections: { unrelated: "Keep me", permissions_scratch: "stale scratch path" } };

		await assert.rejects(harness.emit("before_agent_start", { systemPromptOptions }, ctx), /Refusing to use Pi temp workspace directory/);
		assert.deepEqual(systemPromptOptions.sections, { unrelated: "Keep me" });
		assert.equal(ctx.selectCalls, 0);
	});
});

test("cancelled agent start clears a stale scratch hint without creating the workspace", async () => {
	await withTestScratchFixture(async (fixture) => {
		const harness = createPermissionsHarness(fixture.sessionTemp);
		const ctx = createContext("Deny", "permissions-cancelled-temp-test", fixture.project);
		const workspace = createPiTempWorkspace("permissions-cancelled-temp-test", { systemTempDir: fixture.sessionTemp });
		await harness.emit("session_start", {}, ctx);
		const systemPromptOptions = { sections: { permissions_scratch: "stale scratch path" } };
		await assert.rejects(harness.emit("before_agent_start", { systemPromptOptions }, {
			...ctx, signal: AbortSignal.abort(),
		}), { name: "AbortError" });
		assert.equal(systemPromptOptions.sections.permissions_scratch, undefined);
		await assert.rejects(stat(workspace.sessionDir), { code: "ENOENT" });
		assert.equal(ctx.selectCalls, 0);
	});
});

test("shutdown during scratch preparation cannot advertise a late hint", async () => {
	await withTestScratchFixture(async (fixture) => {
		const harness = createPermissionsHarness(fixture.sessionTemp);
		const ctx = createContext("Deny", "permissions-shutdown-temp-test", fixture.project);
		await harness.emit("session_start", {}, ctx);
		const systemPromptOptions = { sections: { permissions_scratch: "stale scratch path" } };
		const starting = harness.emit("before_agent_start", { systemPromptOptions }, ctx);
		const cancelled = assert.rejects(starting, { name: "AbortError" });
		await harness.emit("session_shutdown", {}, ctx);
		await cancelled;
		assert.equal(systemPromptOptions.sections.permissions_scratch, undefined);
		assert.equal(ctx.selectCalls, 0);
	});
});

test("scratch is revalidated before subsequent turns", async () => {
	await withTestScratchFixture(async (fixture) => {
		const harness = createPermissionsHarness(fixture.sessionTemp);
		const ctx = createContext("Deny", "permissions-revalidate-temp-test", fixture.project);
		const workspace = createPiTempWorkspace("permissions-revalidate-temp-test", { systemTempDir: fixture.sessionTemp });
		await harness.emit("session_start", {}, ctx);
		const systemPromptOptions = { sections: {} as Record<string, string> };
		await harness.emit("before_agent_start", { systemPromptOptions }, ctx);
		await fixture.rename(workspace.sessionDir, join(workspace.baseDir, "displaced-session"));
		await fixture.symlink(fixture.protectedDir, workspace.sessionDir);

		await assert.rejects(harness.emit("before_agent_start", { systemPromptOptions }, ctx), /Refusing to use Pi temp workspace directory/);
		assert.equal(systemPromptOptions.sections.permissions_scratch, undefined);
		assert.equal(ctx.selectCalls, 0);
	});
});

test("scratch aliases and ..-prefixed children are auto-approved, but symlink escapes are not", async () => {
	await withTestScratchFixture(async (fixture) => {
		const harness = createPermissionsHarness(fixture.sessionTemp);
		const ctx = createContext("Deny", "permissions-canonical-temp-test", fixture.project);
		const workspace = createPiTempWorkspace("permissions-canonical-temp-test", { systemTempDir: fixture.sessionTemp });
		await harness.emit("session_start", {}, ctx);
		await harness.emit("before_agent_start", { systemPromptOptions: { sections: {} } }, ctx);
		const alias = join(fixture.root, "temp-alias");
		await fixture.symlink(fixture.sessionTemp, alias);
		const aliasedWorkspace = createPiTempWorkspace("permissions-canonical-temp-test", { systemTempDir: alias });

		for (const event of [
			{ toolName: "write", input: { path: `${aliasedWorkspace.sessionDir}/missing/out.txt` } },
			{ toolName: "edit", input: { path: `${await realpath(workspace.sessionDir)}/out.txt` } },
			{ toolName: "bash", input: { command: `mkdir -p ${workspace.sessionDir}/..cache` } },
			{ toolName: "bash", input: { command: `printf hi > ${aliasedWorkspace.sessionDir}/out.txt` } },
		]) assert.equal(await harness.emitFirst("tool_call", event, ctx), undefined);
		assert.equal(ctx.selectCalls, 0);

		await fixture.symlink(fixture.protectedDir, join(workspace.sessionDir, "escape"));
		const scratchFile = join(workspace.sessionDir, "file.txt");
		await fixture.writeFile(scratchFile, "scratch contents");
		const outsideLink = join(fixture.protectedDir, "link-to-scratch-file");
		await fixture.symlink(scratchFile, outsideLink);
		for (const event of [
			{ toolName: "write", input: { path: `${workspace.sessionDir}/escape/out.txt` } },
			{ toolName: "bash", input: { command: `touch ${workspace.sessionDir}/escape/missing/out.txt` } },
			{ toolName: "bash", input: { command: `touch ${workspace.sessionDir}/out.txt ${workspace.sessionDir}/escape/../out.txt` } },
			{ toolName: "bash", input: { command: `rm ${outsideLink}` } },
		]) assert.equal((await harness.emitFirst("tool_call", event, ctx) as any)?.block, true);
		assert.equal(ctx.selectCalls, 4);
	});
});

test("multiline Bash scratch requests classify only actual destinations", async () => {
	await withTestScratchFixture(async (fixture) => {
		const harness = createPermissionsHarness(fixture.sessionTemp);
		const ctx = createContext("Deny", "permissions-multiline-temp-test", fixture.project);
		const workspace = createPiTempWorkspace("permissions-multiline-temp-test", { systemTempDir: fixture.sessionTemp });
		await harness.emit("session_start", {}, ctx);
		await harness.emit("before_agent_start", { systemPromptOptions: { sections: {} } }, ctx);
		const source = 'source "$HOME/.sdkman/bin/sdkman-init.sh"';
		const result = await harness.emitFirst("tool_call", {
			toolName: "bash",
			input: { command: `READY=1\nmkdir -p "${workspace.sessionDir}/work"\n${source}\nmvn test > "${workspace.sessionDir}/test.log" 2>&1` },
		}, ctx);
		assert.equal(result, undefined);
		assert.equal(ctx.selectCalls, 0);

		for (const destination of [workspace.sessionDir, `${fixture.protectedDir}/work`]) {
			const denied = await harness.emitFirst("tool_call", {
				toolName: "bash", input: { command: `mkdir -p "${destination}"\n${source}` },
			}, ctx);
			assert.deepEqual(denied, { block: true, reason: `Blocked by user. Target scope(s): bash mutation ${destination}` });
		}
		assert.equal(ctx.selectCalls, 2);
	});
});

test("mutations below the session temp workspace are auto-approved even without an agent-start event", async () => {
	await withTestScratchFixture(async (fixture) => {
		const harness = createPermissionsHarness(fixture.sessionTemp);
		const ctx = createContext("Deny", "permissions-auto-temp-test", fixture.project);
		const workspace = createPiTempWorkspace("permissions-auto-temp-test", { systemTempDir: fixture.sessionTemp });

		await harness.emit("session_start", {}, ctx);
		const writeResult = await harness.emitFirst("tool_call", { toolName: "write", input: { path: `${workspace.sessionDir}/out.txt` } }, ctx);
		const bashResult = await harness.emitFirst("tool_call", { toolName: "bash", input: { command: `mkdir -p ${workspace.sessionDir}/child` } }, ctx);

		assert.equal(writeResult, undefined);
		assert.equal(bashResult, undefined);
		assert.equal(ctx.selectCalls, 0);
		assert.equal((await stat(workspace.sessionDir)).isDirectory(), true);
	});
});

test("mutating the session temp workspace root itself still prompts", async () => {
	await withTestScratchFixture(async (fixture) => {
		const harness = createPermissionsHarness(fixture.sessionTemp);
		const ctx = createContext("Deny", "permissions-root-temp-test", fixture.project);
		const workspace = createPiTempWorkspace("permissions-root-temp-test", { systemTempDir: fixture.sessionTemp });
		await workspace.ensureCreated();

		await harness.emit("session_start", {}, ctx);
		const result = await harness.emitFirst("tool_call", { toolName: "bash", input: { command: `rm -rf ${workspace.sessionDir}` } }, ctx);

		assert.deepEqual(result, { block: true, reason: `Blocked by user. Target scope(s): delete ${workspace.sessionDir}` });
		for (const command of [
			`mkdir -p ${workspace.sessionDir}`,
			`chmod 700 ${workspace.sessionDir}`,
			`mv ${workspace.sessionDir} ${workspace.sessionDir}/renamed`,
			`cp README.md ${workspace.sessionDir}`,
			`touch ${workspace.baseDir}/session-other/out.txt`,
		]) assert.equal((await harness.emitFirst("tool_call", { toolName: "bash", input: { command } }, ctx) as any)?.block, true);
		assert.equal(ctx.selectCalls, 6);
	});
});

test("catastrophic bash analysis is first and cannot create scratch or prompt", async () => {
	await withTestScratchFixture(async (fixture) => {
		const harness = createPermissionsHarness(fixture.sessionTemp, fixture.fakeHome);
		const ctx = createContext("Allow once", "catastrophic-order-test", fixture.project);
		const workspace = createPiTempWorkspace("catastrophic-order-test", { systemTempDir: fixture.sessionTemp });

		const result = await harness.emitFirst("tool_call", { toolName: "bash", input: { command: "rm ." } }, ctx) as any;

		assert.equal(result?.block, true);
		assert.match(result?.reason ?? "", /P0_DELETE_CRITICAL_TARGET/);
		assert.equal(ctx.selectCalls, 0);
		await assert.rejects(stat(workspace.sessionDir), { code: "ENOENT" });
	});
});

test("outside-cwd concrete nonexistent cleanup reaches ordinary prompts and grants cannot bypass catastrophic deletion", async () => {
	await withTestScratchFixture(async (fixture) => {
		const harness = createPermissionsHarness(fixture.sessionTemp, fixture.fakeHome);
		const ctx = createContext("Allow for current session", "catastrophic-bypass-test", fixture.project);
		await harness.emit("session_start", {}, ctx);

		const absentOutsideTarget = `${fixture.protectedDir}/already-absent.txt`;
		const ordinary = await harness.emitFirst("tool_call", {
			toolName: "bash",
			input: { command: `rm ${absentOutsideTarget}` },
		}, ctx);
		assert.equal(ordinary, undefined);
		assert.equal(ctx.selectCalls, 1);

		const grantedResult = await harness.emitFirst("tool_call", { toolName: "bash", input: { command: "rm ." } }, ctx) as any;
		assert.equal(grantedResult?.block, true);
		assert.match(grantedResult?.reason ?? "", /P0_DELETE_CRITICAL_TARGET/);
		assert.equal(ctx.selectCalls, 1);

		await harness.commands.get("permissions")?.handler("off", ctx);
		const disabledResult = await harness.emitFirst("tool_call", { toolName: "bash", input: { command: "rm ." } }, ctx) as any;
		assert.equal(disabledResult?.block, true);
		assert.match(disabledResult?.reason ?? "", /P0_DELETE_CRITICAL_TARGET/);
		assert.equal(ctx.selectCalls, 1);
		assert.match(ctx.notifications.at(-1) ?? "", /catastrophic protection remains active/i);
	});
});

test("unexpected active Bash ownership fails closed after catastrophic preflight", async () => {
	await withTestScratchFixture(async (fixture) => {
		const harness = createPermissionsHarness(fixture.sessionTemp, fixture.fakeHome);
		const ctx = createContext("Allow once", "ownership-test", fixture.project);
		await harness.emit("session_start", {}, ctx);
		harness.setOwnerPath("/test/other/index.ts");

		const result = await harness.emitFirst("tool_call", { toolName: "bash", input: { command: "printf ok" } }, ctx) as any;
		assert.equal(result?.block, true);
		assert.match(result?.reason ?? "", /P0_BASH_OWNERSHIP_UNEXPECTED/);
		assert.equal(ctx.selectCalls, 0);
	});
});

test("user_bash always returns a valid terminal result under Pi 0.86 fail-closed dispatch", async () => {
	await withTestScratchFixture(async (fixture) => {
		const harness = createPermissionsHarness(fixture.sessionTemp, fixture.fakeHome);
		const ctx = createContext("Deny", "user-bash-contract-test", fixture.project);

		const safe = await harness.emitFirst("user_bash", {
			command: "printf ok",
			cwd: fixture.project,
			excludeFromContext: false,
		}, ctx) as any;
		assert.equal(typeof safe?.operations?.exec, "function");
		assert.equal("result" in safe, false);

		const denied = await harness.emitFirst("user_bash", {
			command: "rm .",
			cwd: fixture.project,
			excludeFromContext: false,
		}, ctx) as any;
		assert.deepEqual(Object.keys(denied), ["result"]);
		assert.equal(denied.result.exitCode, 1);
		assert.equal(denied.result.cancelled, false);
		assert.equal(denied.result.truncated, false);
		assert.match(denied.result.output, /P0_DELETE_CRITICAL_TARGET/);
	});
});

test("catastrophic deletion hard-denies without an interactive UI", async () => {
	await withTestScratchFixture(async (fixture) => {
		const harness = createPermissionsHarness(fixture.sessionTemp, fixture.fakeHome);
		const ctx = createContext("Allow once", "no-ui-catastrophic-test", fixture.project);
		ctx.hasUI = false;

		const result = await harness.emitFirst("tool_call", { toolName: "bash", input: { command: "rm ." } }, ctx) as any;
		assert.equal(result?.block, true);
		assert.match(result?.reason ?? "", /P0_DELETE_CRITICAL_TARGET/);
		assert.equal(ctx.selectCalls, 0);
	});
});

test("invalid Bash input and dynamic scratch deletion fail closed before auto-approval", async () => {
	await withTestScratchFixture(async (fixture) => {
		const harness = createPermissionsHarness(fixture.sessionTemp, fixture.fakeHome);
		const ctx = createContext("Allow once", "invalid-bash-test", fixture.project);
		const workspace = createPiTempWorkspace("invalid-bash-test", { systemTempDir: fixture.sessionTemp });

		const invalid = await harness.emitFirst("tool_call", { toolName: "bash", input: { command: 42 } }, ctx) as any;
		assert.equal(invalid?.block, true);
		assert.match(invalid?.reason ?? "", /P0_INVALID_BASH_INPUT/);

		const dynamic = await harness.emitFirst("tool_call", {
			toolName: "bash",
			input: { command: `rm -rf ${workspace.sessionDir}/*` },
		}, ctx) as any;
		assert.equal(dynamic?.block, true);
		assert.match(dynamic?.reason ?? "", /P0_DELETE_DYNAMIC_TARGET/);
		assert.equal(ctx.selectCalls, 0);
		await assert.rejects(stat(workspace.sessionDir), { code: "ENOENT" });
	});
});

function createPermissionsHarness(systemTempDir?: string, home?: string, ownerPath = fileURLToPath(new URL("./index.ts", import.meta.url))) {
	let activeOwnerPath = ownerPath;
	const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> | void }>();
	const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => Promise<unknown> | unknown>>();
	const tools = new Map<string, ToolDefinition<any, any, any>>();
	const pi = {
		events: createEventBus(),
		registerTool(tool: ToolDefinition<any, any, any>) {
			tools.set(tool.name, tool);
		},
		registerCommand(name: string, command: { handler(args: string, ctx: unknown): Promise<void> | void }) {
			commands.set(name, command);
		},
		on(eventName: string, handler: (event: unknown, ctx: unknown) => Promise<unknown> | unknown) {
			const existing = handlers.get(eventName) ?? [];
			existing.push(handler);
			handlers.set(eventName, existing);
		},
		exec: async () => ({ code: 1, stdout: "", stderr: "" }),
		appendEntry() {},
		getAllTools: () => [...tools.values()].map((tool) => ({
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
			sourceInfo: { path: activeOwnerPath, source: "local", scope: "user", origin: "top-level" },
		})),
	} as never;

	permissionsExtension(pi, { systemTempDir, home });

	return {
		commands,
		handlers,
		tools,
		setOwnerPath(pathValue: string) {
			activeOwnerPath = pathValue;
		},
		async emit(eventName: string, event: unknown, ctx: unknown) {
			for (const handler of handlers.get(eventName) ?? []) await handler(event, ctx);
		},
		async emitFirst(eventName: string, event: unknown, ctx: unknown) {
			return handlers.get(eventName)?.[0]?.(event, ctx);
		},
	};
}

function createContext(selectChoice: string, sessionId = "permissions-index-test", cwd = "/repo/project") {
	return createTestExtensionCommandContext({
		cwd,
		sessionId,
		theme: markerTheme,
		selectChoice,
	});
}
