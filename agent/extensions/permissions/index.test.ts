import assert from "node:assert/strict";
import { rm, stat } from "node:fs/promises";
import test from "node:test";
import permissionsExtension, { formatPermissionStatus, getPermissionsArgumentCompletions } from "./index.ts";
import { FOOTER_STATUS_KEYS } from "../shared/footerStatus.ts";
import { createPiTempWorkspace } from "./tempWorkspace.ts";

const markerTheme = {
	fg(color: string, text: string) {
		return `<${color}>${text}</${color}>`;
	},
	bold(text: string) {
		return `<bold>${text}</bold>`;
	},
};

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

test("before_agent_start adds only a one-line scratch temp dir hint without creating it", async () => {
	const harness = createPermissionsHarness();
	const ctx = createContext("Deny", "permissions-prompt-test");
	const workspace = createPiTempWorkspace("permissions-prompt-test");
	await rm(workspace.sessionDir, { recursive: true, force: true });

	await harness.emit("session_start", {}, ctx);
	const result = await harness.emitFirst("before_agent_start", { systemPrompt: "Base prompt" }, ctx) as { systemPrompt?: string } | undefined;

	assert.equal(result?.systemPrompt, `Base prompt\n\nUse scratch temp dir instead of /tmp: ${workspace.sessionDir}`);
	await assert.rejects(stat(workspace.sessionDir), { code: "ENOENT" });
});

test("mutations below the session temp workspace are auto-approved and create it on demand", async () => {
	const harness = createPermissionsHarness();
	const ctx = createContext("Deny", "permissions-auto-temp-test");
	const workspace = createPiTempWorkspace("permissions-auto-temp-test");
	await rm(workspace.sessionDir, { recursive: true, force: true });

	await harness.emit("session_start", {}, ctx);
	const writeResult = await harness.emitFirst("tool_call", { toolName: "write", input: { path: `${workspace.sessionDir}/out.txt` } }, ctx);
	const bashResult = await harness.emitFirst("tool_call", { toolName: "bash", input: { command: `mkdir -p ${workspace.sessionDir}/child` } }, ctx);

	assert.equal(writeResult, undefined);
	assert.equal(bashResult, undefined);
	assert.equal(ctx.selectCalls, 0);
	assert.equal((await stat(workspace.sessionDir)).isDirectory(), true);

	await rm(workspace.sessionDir, { recursive: true, force: true });
});

test("mutating the session temp workspace root itself still prompts", async () => {
	const harness = createPermissionsHarness();
	const ctx = createContext("Deny", "permissions-root-temp-test");
	const workspace = createPiTempWorkspace("permissions-root-temp-test");

	await harness.emit("session_start", {}, ctx);
	const result = await harness.emitFirst("tool_call", { toolName: "bash", input: { command: `rm -rf ${workspace.sessionDir}` } }, ctx);

	assert.deepEqual(result, { block: true, reason: `Blocked by user. Target scope(s): delete ${workspace.sessionDir}` });
	assert.equal(ctx.selectCalls, 1);
});

function createPermissionsHarness() {
	const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> | void }>();
	const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => Promise<unknown> | unknown>>();
	const pi = {
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
	} as never;

	permissionsExtension(pi);

	return {
		commands,
		handlers,
		async emit(eventName: string, event: unknown, ctx: unknown) {
			for (const handler of handlers.get(eventName) ?? []) await handler(event, ctx);
		},
		async emitFirst(eventName: string, event: unknown, ctx: unknown) {
			return handlers.get(eventName)?.[0]?.(event, ctx);
		},
	};
}

function createContext(selectChoice: string, sessionId = "permissions-index-test") {
	const ctx = {
		cwd: "/repo/project",
		hasUI: true,
		statuses: new Map<string, string>(),
		notifications: [] as string[],
		selectCalls: 0,
		sessionManager: { getBranch: () => [], getSessionId: () => sessionId },
		ui: {} as {
			theme: typeof markerTheme;
			setStatus(key: string, value: string | undefined): void;
			notify(message: string): void;
			select(): Promise<string>;
			editor(): Promise<undefined>;
		},
	};
	ctx.ui = {
		theme: markerTheme,
		setStatus(key: string, value: string | undefined) {
			if (value === undefined) ctx.statuses.delete(key);
			else ctx.statuses.set(key, value);
		},
		notify(message: string) {
			ctx.notifications.push(message);
		},
		select: async () => {
			ctx.selectCalls += 1;
			return selectChoice;
		},
		editor: async () => undefined,
	};
	return ctx;
}
