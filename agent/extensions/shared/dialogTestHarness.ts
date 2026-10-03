import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createEventBus, initTheme, type ExtensionAPI, type ExtensionUIDialogOptions, type ExtensionUIContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createTestExtensionContext } from "../permissions/testContext.ts";

export type DialogRequest = {
	method: "select" | "input" | "editor" | "custom";
	title: string;
	choices?: string[];
	signal?: AbortSignal;
	answer(value?: string): void;
	component?: { handleInput?(data: string): void; dispose?(): void };
	doneCalls: number;
};

// No execute functions, real terminal, settings writes, or outside-cwd mutations.
export function createDialogHarness() {
	initTheme("dark", false);
	const events = createEventBus();
	const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
	const commands = new Map<string, any>();
	const tools = new Map<string, ToolDefinition<any, any, any>>();
	const requests: DialogRequest[] = [];
	const notifications: string[] = [];
	const terminalWrites: string[] = [];
	let activeTools: string[] = ["clarify", "bash", "write", "edit"];
	let branch = "main";
	const pi = {
		events,
		on(name: string, handler: (event: any, ctx: any) => any) {
			const list = handlers.get(name) ?? [];
			list.push(handler);
			handlers.set(name, list);
			return () => { handlers.set(name, list.filter((item) => item !== handler)); };
		},
		registerTool(tool: ToolDefinition<any, any, any>) { tools.set(tool.name, tool); },
		registerCommand(name: string, command: any) { commands.set(name, command); },
		getActiveTools: () => activeTools,
		setActiveTools: (names: string[]) => { activeTools = names; },
		getAllTools: () => [...tools.values()].map((tool) => ({
			...tool,
			sourceInfo: { path: fileURLToPath(new URL("../permissions/index.ts", import.meta.url)) },
		})),
		appendEntry() {},
		exec: async (_command: string, args: string[]) => ({
			code: 0,
			stdout: args.includes("--show-toplevel") ? args[1] : args.includes("--abbrev-ref") ? branch : "",
			stderr: "",
		}),
	} as unknown as ExtensionAPI;

	function dialog(method: "select" | "input" | "editor", title: string, choices?: string[], opts?: ExtensionUIDialogOptions) {
		return new Promise<string | undefined>((resolve) => {
			const onAbort = () => request.answer();
			const request: DialogRequest = {
				method, title, choices, signal: opts?.signal, doneCalls: 0,
				answer(value) { opts?.signal?.removeEventListener("abort", onAbort); resolve(value); },
			};
			requests.push(request);
			if (opts?.signal?.aborted) onAbort();
			else opts?.signal?.addEventListener("abort", onAbort, { once: true });
		});
	}

	const ui: ExtensionUIContext = {
		...createTestExtensionContext({ cwd: "/synthetic/project" }).ui,
		notify(message) { notifications.push(message); },
		select: (title, choices, opts) => dialog("select", title, choices, opts),
		input: (title, _placeholder, opts) => dialog("input", title, undefined, opts),
		editor: (title) => dialog("editor", title),
		custom<T>(factory: Parameters<ExtensionUIContext["custom"]>[0]): Promise<T> {
			return new Promise((resolve, reject) => {
				let closed = false;
				let component: any;
				const request: DialogRequest = { method: "custom", title: "", doneCalls: 0, answer() {} };
				requests.push(request);
				const done = (result: unknown) => {
					request.doneCalls++;
					if (closed) return;
					closed = true;
					resolve(result as T);
					component?.dispose?.();
				};
				// Faithful to Pi: factory is synchronous, but installation is a microtask;
				// completing inside the factory skips host installation/disposal.
				const tui = { terminal: { rows: 24, columns: 80, write: (data: string) => terminalWrites.push(data) }, requestRender() {} };
				Promise.resolve(factory(tui as any, ui.theme, { matches: () => false } as any, done))
					.then((value) => { if (!closed) { component = value; request.component = value; } })
					.catch(reject);
			});
		},
	};

	return {
		pi, handlers, commands, tools, requests, notifications, terminalWrites,
		setBranch(value: string) { branch = value; },
		context(signal?: AbortSignal, mode: "rpc" | "tui" = "rpc", cwd = "/synthetic/project") {
			return { ...createTestExtensionContext({ cwd, mode, sessionId: "dialog-tests" }), signal, ui };
		},
		async emit(name: string, event: any, ctx: any) {
			for (const handler of handlers.get(name) ?? []) {
				const result = await handler(event, ctx);
				if (result) return result;
			}
		},
		permission(kind: "file" | "git" | "package", id: string, ctx: any, alternate = false) {
			const event = kind === "file"
				? { toolName: alternate ? "edit" : "write", input: { path: `/synthetic/outside/${id}.txt` } }
				: { toolName: "bash", input: { command: kind === "git" ? (alternate ? "git merge topic" : "git reset --hard HEAD") : (alternate ? "pnpm install" : "npm install") } };
			return this.emit("tool_call", { ...event, toolCallId: id, parentToolCallId: "codemode-parent" }, ctx);
		},
		clarify(id: string, ctx: any, signal?: AbortSignal, options = [{ label: "First" }, { label: "Second" }]) {
			return tools.get("clarify")!.execute(id, { question: `Question ${id}?`, options }, signal, undefined, ctx);
		},
	};
}

export async function flushDialogs() {
	for (let i = 0; i < 8; i++) await setImmediate();
}

export async function expectRequestCount(requests: DialogRequest[], count: number) {
	await flushDialogs();
	assert.equal(requests.length, count);
}
