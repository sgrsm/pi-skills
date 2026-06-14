import assert from "node:assert/strict";
import test from "node:test";
import permissionsExtension, { formatPermissionStatus, getPermissionsArgumentCompletions } from "./index.ts";

const markerTheme = {
	fg(color: string, text: string) {
		return `<${color}>${text}</${color}>`;
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

test("permission status is always visible and reflects mode or granted count", () => {
	assert.equal(formatPermissionStatus({ enabled: true, grantCount: 0, theme: markerTheme }), "<dim>permissions: </dim><dim>on</dim><dim> •</dim>");
	assert.equal(formatPermissionStatus({ enabled: false, grantCount: 0, theme: markerTheme }), "<dim>permissions: </dim><error>off</error><dim> •</dim>");
	assert.equal(
		formatPermissionStatus({ enabled: true, grantCount: 3, theme: markerTheme }),
		"<dim>permissions: </dim><success>3</success><dim> •</dim>",
	);
});

test("permissions off disables guards without clearing existing command behavior", async () => {
	const harness = createPermissionsHarness();
	const ctx = createContext("Deny");

	await harness.emit("session_start", {}, ctx);
	assert.equal(ctx.statuses.get("3-permissions"), "<dim>permissions: </dim><dim>on</dim><dim> •</dim>");

	await harness.commands.get("permissions")?.handler("off", ctx);
	assert.equal(ctx.statuses.get("3-permissions"), "<dim>permissions: </dim><error>off</error><dim> •</dim>");

	const disabledResult = await harness.emitFirst("tool_call", { toolName: "write", input: { path: "/tmp/out.txt" } }, ctx);
	assert.equal(disabledResult, undefined);
	assert.equal(ctx.selectCalls, 0);

	await harness.commands.get("permissions")?.handler("on", ctx);
	assert.equal(ctx.statuses.get("3-permissions"), "<dim>permissions: </dim><dim>on</dim><dim> •</dim>");

	const enabledResult = await harness.emitFirst("tool_call", { toolName: "write", input: { path: "/tmp/out.txt" } }, ctx);
	assert.deepEqual(enabledResult, { block: true, reason: "Blocked by user. Target scope(s): write /tmp" });
	assert.equal(ctx.selectCalls, 1);
});

test("session permission grants update the visible granted count", async () => {
	const harness = createPermissionsHarness();
	const ctx = createContext("Allow for current session");

	await harness.emit("session_start", {}, ctx);
	await harness.emitFirst("tool_call", { toolName: "write", input: { path: "/tmp/out.txt" } }, ctx);

	assert.equal(ctx.statuses.get("3-permissions"), "<dim>permissions: </dim><success>1</success><dim> •</dim>");
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

function createContext(selectChoice: string) {
	const ctx = {
		cwd: "/repo/project",
		hasUI: true,
		statuses: new Map<string, string>(),
		notifications: [] as string[],
		selectCalls: 0,
		sessionManager: { getBranch: () => [] },
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
