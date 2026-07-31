import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { FOOTER_STATUS_KEYS } from "../shared/footerStatus.ts";
import { createMcpConnector, formatMcpFooterStatus, formatMcpToolErrorMessage, normalizeMcpNotifyType, truncateMcpToolContent } from "./mcpConnector.ts";

const imageBlock = { type: "image" as const, data: "base64-image-data", mimeType: "image/png" };

type SourceInfo = { path: string; source: string; scope: "user" | "project" | "temporary"; origin: "package" | "top-level"; baseDir?: string };
type RegisteredTool = {
	name: string;
	description?: string;
	execute?: (toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
};
type CanonicalTool = RegisteredTool & { sourceInfo: SourceInfo };
type Command = { handler: (args: string, ctx: unknown) => Promise<void> };
type HeldRequest = { started: Promise<void>; aborted: Promise<void> };

async function assertSettlesPromptly(promise: Promise<unknown>, label: string, timeoutMs = 750): Promise<void> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			promise,
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(() => reject(new Error(`${label} did not settle within ${timeoutMs}ms`)), timeoutMs);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

function notificationMatcher(
	notifications: string[],
	notificationTypes: Array<"info" | "warning" | "error" | undefined>,
	start: number,
	type: "info" | "warning" | "error",
	pattern: RegExp,
): boolean {
	return notifications.slice(start).some((message, offset) => notificationTypes[start + offset] === type && pattern.test(message));
}

async function createMcpFixture({ allowlistMode = false }: { allowlistMode?: boolean } = {}) {
	const tempDir = mkdtempSync(join(tmpdir(), "pi-mcp-reconcile-test-"));
	let catalogue = ["A", "B"];
	let failDiscovery = false;
	let listDelayMs = 0;
	let initializeCount = 0;
	let toolsListCount = 0;
	let getAllToolsCount = 0;
	let throwOnRegisterName: string | undefined;
	let heldRequestMethod: "initialize" | "tools/list" | undefined;
	let resolveHeldRequestStarted: (() => void) | undefined;
	let resolveHeldRequestAborted: (() => void) | undefined;
	let activeTools = ["unrelated_tool", "test_collision"];
	let closed = false;
	const callTargets: string[] = [];
	const server = createServer(async (request, response) => {
		if (request.method === "GET") {
			response.writeHead(405).end();
			return;
		}
		const body = await new Promise<string>((resolve, reject) => {
			let text = "";
			request.setEncoding("utf8");
			request.on("data", (chunk) => { text += chunk; });
			request.on("end", () => resolve(text));
			request.on("error", reject);
		});
		const message = JSON.parse(body) as { id?: number; method?: string; params?: { name?: string } };
		if (message.method === "notifications/initialized") {
			response.writeHead(202).end();
			return;
		}
		if (message.method === "initialize") initializeCount++;
		if (message.method === heldRequestMethod) {
			heldRequestMethod = undefined;
			resolveHeldRequestStarted?.();
			await new Promise<void>((resolve) => {
				let settled = false;
				const onAbort = () => {
					if (settled) return;
					settled = true;
					resolveHeldRequestAborted?.();
					resolve();
				};
				request.once("aborted", onAbort);
				response.once("close", onAbort);
			});
			return;
		}
		if (message.method === "tools/list") {
			toolsListCount++;
			if (listDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, listDelayMs));
			if (failDiscovery) {
				response.writeHead(503, { "content-type": "text/plain" }).end("discovery failed");
				return;
			}
		}
		if (message.method === "tools/call") callTargets.push(message.params?.name ?? "(missing)");
		const result = message.method === "initialize"
			? { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "loopback", version: "1.0.0" } }
			: message.method === "tools/list"
				? { tools: catalogue.map((name) => ({ name, inputSchema: { type: "object" } })) }
				: { content: [{ type: "text", text: `called ${message.params?.name}` }] };
		response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");

	const connectorSourceInfo: SourceInfo = { path: "/extensions/test-mcp/index.ts", source: "test-mcp", scope: "user", origin: "top-level" };
	const unrelatedSourceInfo: SourceInfo = { path: "/extensions/unrelated/index.ts", source: "unrelated", scope: "user", origin: "top-level" };
	const registry = new Map<string, CanonicalTool>([
		["unrelated_tool", { name: "unrelated_tool", sourceInfo: unrelatedSourceInfo }],
		["test_collision", { name: "test_collision", sourceInfo: unrelatedSourceInfo }],
	]);
	const filteredNames = new Set<string>();
	const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
	const commands = new Map<string, Command>();
	const pi = {
		appendEntry() {},
		getActiveTools: () => activeTools,
		getAllTools: () => {
			getAllToolsCount++;
			return [...registry.values()].filter((tool) => !filteredNames.has(tool.name));
		},
		on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
			const registered = handlers.get(event) ?? [];
			registered.push(handler);
			handlers.set(event, registered);
		},
		registerCommand(name: string, command: Command) { commands.set(name, command); },
		registerTool(tool: RegisteredTool) {
			if (filteredNames.has(tool.name)) return;
			const canonical = registry.get(tool.name);
			if (canonical && canonical.sourceInfo !== connectorSourceInfo) return;
			const newlyCanonical = !canonical;
			registry.set(tool.name, { ...tool, sourceInfo: connectorSourceInfo });
			if (allowlistMode) {
				activeTools = [...new Set([...activeTools, ...[...registry.keys()].filter((name) => !filteredNames.has(name))])];
			} else if (newlyCanonical) {
				activeTools = [...new Set([...activeTools, tool.name])];
			}
			if (tool.name === throwOnRegisterName) throw new Error(`registration failed for ${tool.name}`);
		},
		setActiveTools(names: string[]) {
			activeTools = [...new Set(names)].filter((name) => registry.has(name) && !filteredNames.has(name));
		},
	};
	const statuses = new Map<string, string | undefined>();
	const notifications: string[] = [];
	const notificationTypes: Array<"info" | "warning" | "error" | undefined> = [];
	const ctx = {
		sessionManager: { getBranch: () => [] },
		ui: {
			notify: (message: string, type?: "info" | "warning" | "error") => {
				notifications.push(message);
				notificationTypes.push(type);
			},
			setStatus: (key: string, value: string | undefined) => statuses.set(key, value),
			theme: { fg: (_color: string, text: string) => text },
		},
	};
	const configPath = join(tempDir, "connector.json");
	const writeConfig = (contents = JSON.stringify({ type: "streamable-http", url: `http://127.0.0.1:${address.port}/mcp`, enabled: true })) => writeFileSync(configPath, `${contents}\n`);
	writeConfig();

	const fixture = {
		registry,
		filteredNames,
		connectorSourceInfo,
		unrelatedSourceInfo,
		callTargets,
		notifications,
		notificationTypes,
		statuses,
		setCatalogue: (names: string[]) => { catalogue = names; },
		setFailDiscovery: (value: boolean) => { failDiscovery = value; },
		setListDelay: (value: number) => { listDelayMs = value; },
		setThrowOnRegisterName: (name: string | undefined) => { throwOnRegisterName = name; },
		setActiveTools: (names: string[]) => { activeTools = names; },
		activeTools: () => activeTools,
		getAllToolsCount: () => getAllToolsCount,
		initializeCount: () => initializeCount,
		toolsListCount: () => toolsListCount,
		writeConfig,
		holdRequestUntilAbort(method: "initialize" | "tools/list"): HeldRequest {
			heldRequestMethod = method;
			const started = new Promise<void>((resolve) => { resolveHeldRequestStarted = resolve; });
			const aborted = new Promise<void>((resolve) => { resolveHeldRequestAborted = resolve; });
			return { started, aborted };
		},
		assertActive(...names: string[]) { assert.deepEqual([...activeTools].sort(), names.sort()); },
		hasNotification(start: number, type: "info" | "warning" | "error", pattern: RegExp) {
			return notificationMatcher(notifications, notificationTypes, start, type, pattern);
		},
		async start() {
			await createMcpConnector(pi as never, {
				connectorName: "test",
				extensionName: "test-mcp",
				toolPrefix: "test_",
				configUrl: pathToFileURL(configPath),
				enabledScope: "global",
			});
			for (const handler of handlers.get("session_start") ?? []) await handler(undefined, ctx);
		},
		async run(command: string) { await commands.get("mcp")!.handler(command, ctx); },
		async sessionTree() {
			for (const handler of handlers.get("session_tree") ?? []) await handler(undefined, ctx);
		},
		async close() {
			if (closed) return;
			closed = true;
			server.closeAllConnections();
			for (const handler of handlers.get("session_shutdown") ?? []) await handler(undefined, ctx);
			await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
			rmSync(tempDir, { recursive: true, force: true });
		},
	};
	return fixture;
}

test("MCP notification types are normalized to Pi-supported notification values", () => {
	assert.equal(normalizeMcpNotifyType("success"), "info");
	assert.equal(normalizeMcpNotifyType("info"), "info");
	assert.equal(normalizeMcpNotifyType("warning"), "warning");
	assert.equal(normalizeMcpNotifyType("error"), "error");
	assert.equal(normalizeMcpNotifyType(undefined), undefined);
});

test("MCP bridge no longer passes success directly to ctx.ui.notify", () => {
	const source = readFileSync(new URL("./mcpConnector.ts", import.meta.url), "utf8");
	assert.equal(/\.notify\([\s\S]*?,\s*"success"\s*\)/.test(source), false);
});

test("aggregate MCP footer colors the label like active connectors when any connector is enabled", () => {
	const footerStatus = formatMcpFooterStatus(
		[{ name: "alpha", displayName: "Alpha MCP", enabled: false }, { name: "zeta", displayName: "Zeta MCP", enabled: true }],
		{ fg: (color: string, text: string) => `<${color}>${text}</${color}>` },
	);
	assert.equal(footerStatus, "<accent>mcp: </accent><dim>alpha</dim><dim>, </dim><accent>zeta</accent><dim> •</dim>");
});

test("aggregate MCP footer separates multiple connector display names with comma-space", async () => {
	const tempDir = mkdtempSync(join(tmpdir(), "pi-mcp-footer-test-"));
	let activeTools: string[] = [];
	const sessionStartHandlers: Array<(event: unknown, ctx: unknown) => unknown> = [];
	const pi = {
		appendEntry() {}, getActiveTools: () => activeTools,
		on(event: string, handler: (event: unknown, ctx: unknown) => unknown) { if (event === "session_start") sessionStartHandlers.push(handler); },
		registerCommand() {}, registerTool() {}, setActiveTools(names: string[]) { activeTools = names; },
	};
	const writeConfig = (name: string) => {
		const filePath = join(tempDir, `${name}.json`);
		writeFileSync(filePath, `${JSON.stringify({ type: "streamable-http", url: `http://127.0.0.1:1/${name}`, enabled: false }, null, 2)}\n`);
		return pathToFileURL(filePath);
	};
	try {
		await createMcpConnector(pi as never, { connectorName: "zeta", extensionName: "zeta-mcp", displayName: "Zeta MCP", toolPrefix: "zeta_", configUrl: writeConfig("zeta") });
		await createMcpConnector(pi as never, { connectorName: "alpha", extensionName: "alpha-mcp", displayName: "Alpha MCP", toolPrefix: "alpha_", configUrl: writeConfig("alpha") });
		const statuses = new Map<string, string | undefined>();
		const ctx = { sessionManager: { getBranch: () => [] }, ui: { setStatus: (key: string, value: string | undefined) => statuses.set(key, value), theme: { fg: (_color: string, text: string) => text } } };
		for (const handler of sessionStartHandlers) await handler(undefined, ctx);
		const footerStatus = statuses.get(FOOTER_STATUS_KEYS.mcp) ?? "";
		assert.equal(footerStatus, "mcp: alpha, zeta •");
		assert.doesNotMatch(footerStatus, / · /);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("malformed global config still loads a locally disableable connector", async () => {
	const tempDir = mkdtempSync(join(tmpdir(), "pi-mcp-malformed-config-test-"));
	const configPath = join(tempDir, "connector.json");
	writeFileSync(configPath, "{ invalid json\n");
	let activeTools: string[] = [];
	const commands = new Map<string, Command>();
	const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
	const pi = {
		appendEntry() {}, getActiveTools: () => activeTools, getAllTools: () => [],
		on(event: string, handler: (event: unknown, ctx: unknown) => unknown) { const registered = handlers.get(event) ?? []; registered.push(handler); handlers.set(event, registered); },
		registerCommand(name: string, command: Command) { commands.set(name, command); }, registerTool() {}, setActiveTools(names: string[]) { activeTools = names; },
	};
	const notifications: string[] = [];
	const ctx = { ui: { notify: (message: string) => notifications.push(message), setStatus() {}, theme: { fg: (_color: string, text: string) => text } } };
	try {
		await createMcpConnector(pi as never, { connectorName: "broken", extensionName: "broken-mcp", toolPrefix: "broken_", configUrl: pathToFileURL(configPath), enabledScope: "global" });
		assert.ok(commands.get("mcp"));
		await commands.get("mcp")!.handler("disable broken", ctx);
		await commands.get("mcp")!.handler("status broken", ctx);
		assert.match(notifications.at(-1) ?? "", /^broken: disabled/);
		assert.equal(notifications.some((message) => /unable to persist config/i.test(message)), true);
	} finally {
		for (const handler of handlers.get("session_shutdown") ?? []) await handler(undefined, ctx);
		rmSync(tempDir, { recursive: true, force: true });
	}
});

for (const allowlistMode of [false, true]) {
	test(`catalogue reconciliation retains B and removes obsolete A in ${allowlistMode ? "allowlist" : "normal host"} mode`, async (t) => {
		const fixture = await createMcpFixture({ allowlistMode });
		t.after(() => fixture.close());
		await fixture.start();
		fixture.assertActive("unrelated_tool", "test_collision", "test_a", "test_b");
		fixture.setCatalogue(["B", "C"]);
		const readsBeforeReload = fixture.getAllToolsCount();
		await fixture.run("reload test");
		assert.equal(fixture.getAllToolsCount() - readsBeforeReload, 3, "a rebuild reads one snapshot before and after its registration batch plus teardown");
		fixture.assertActive("unrelated_tool", "test_collision", "test_b", "test_c");
		assert.equal(fixture.registry.has("test_a"), true, "Pi retains obsolete definitions internally");
		fixture.setActiveTools([...fixture.activeTools(), "test_a"]);
		const listsBeforeConnectedSync = fixture.toolsListCount();
		const readsBeforeConnectedSync = fixture.getAllToolsCount();
		await fixture.sessionTree();
		assert.equal(fixture.toolsListCount(), listsBeforeConnectedSync);
		assert.equal(fixture.getAllToolsCount() - readsBeforeConnectedSync, 1, "connected synchronization reconciles one canonical registry snapshot");
		fixture.assertActive("unrelated_tool", "test_collision", "test_b", "test_c");
	});
}

test("sanitization collisions are deterministic and wrappers retain their original call targets", async (t) => {
	const fixture = await createMcpFixture();
	t.after(() => fixture.close());
	fixture.setCatalogue(["A_B", "A-B"]);
	await fixture.start();
	fixture.assertActive("unrelated_tool", "test_collision", "test_a_b", "test_a_b_2");
	const dashedWrapper = fixture.registry.get("test_a_b")!;
	const underscoredWrapper = fixture.registry.get("test_a_b_2")!;
	assert.match(dashedWrapper.description ?? "", /Original MCP tool name: A-B/);
	assert.match(underscoredWrapper.description ?? "", /Original MCP tool name: A_B/);
	fixture.setCatalogue(["A-B", "A_B"]);
	await fixture.run("reload test");
	assert.match(fixture.registry.get("test_a_b")!.description ?? "", /Original MCP tool name: A-B/);
	assert.match(fixture.registry.get("test_a_b_2")!.description ?? "", /Original MCP tool name: A_B/);
	await Promise.all([dashedWrapper.execute!("retained-dash", {}), underscoredWrapper.execute!("retained-underscore", {})]);
	assert.deepEqual(fixture.callTargets.slice(-2).sort(), ["A-B", "A_B"]);
});

test("disconnected retained wrappers share one reconnect discovery flight", async (t) => {
	const fixture = await createMcpFixture();
	t.after(() => fixture.close());
	fixture.setCatalogue(["B", "C"]);
	await fixture.start();
	const retainedB = fixture.registry.get("test_b")!;
	const retainedC = fixture.registry.get("test_c")!;
	fixture.setFailDiscovery(true);
	await fixture.run("reload test");
	fixture.assertActive("unrelated_tool", "test_collision");
	fixture.setFailDiscovery(false);
	fixture.setListDelay(50);
	const startsBeforeReconnect = fixture.initializeCount();
	const listsBeforeReconnect = fixture.toolsListCount();
	await Promise.all([retainedB.execute!("reconnect-b", {}), retainedC.execute!("reconnect-c", {})]);
	assert.equal(fixture.initializeCount() - startsBeforeReconnect, 1);
	assert.equal(fixture.toolsListCount() - listsBeforeReconnect, 1);
	assert.deepEqual(fixture.callTargets.slice(-2).sort(), ["B", "C"]);
	fixture.assertActive("unrelated_tool", "test_collision", "test_b", "test_c");
});

test("disable cancels a pending reload and prevents stale success", async (t) => {
	const fixture = await createMcpFixture();
	t.after(() => fixture.close());
	await fixture.start();
	const held = fixture.holdRequestUntilAbort("tools/list");
	const notificationStart = fixture.notifications.length;
	const reload = fixture.run("reload test");
	await assertSettlesPromptly(held.started, "pending tools/list request start");
	await assertSettlesPromptly(fixture.run("disable test"), "disable during pending tools/list");
	await assertSettlesPromptly(held.aborted, "pending tools/list transport abort");
	await assertSettlesPromptly(reload, "interrupted reload");
	assert.equal(fixture.hasNotification(notificationStart, "warning", /reload was superseded before the connection completed/), true);
	assert.equal(fixture.hasNotification(notificationStart, "info", /reloaded \(\d+ tools\)|enabled and connected/), false);
	fixture.assertActive("unrelated_tool", "test_collision");
});

test("disable cancels a pending enable and a later enable commits after teardown", async (t) => {
	const fixture = await createMcpFixture();
	t.after(() => fixture.close());
	await fixture.start();
	await fixture.run("disable test");
	const heldEnable = fixture.holdRequestUntilAbort("initialize");
	const notificationStart = fixture.notifications.length;
	const enable = fixture.run("enable test");
	await assertSettlesPromptly(heldEnable.started, "pending initialize request start");
	await assertSettlesPromptly(fixture.run("disable test"), "disable during pending enable");
	await assertSettlesPromptly(heldEnable.aborted, "pending enable transport abort");
	await assertSettlesPromptly(enable, "interrupted enable");
	assert.equal(fixture.hasNotification(notificationStart, "warning", /enable was superseded before the connection completed/), true);
	assert.equal(fixture.hasNotification(notificationStart, "info", /enabled and connected/), false);
	await fixture.run("enable test");
	const heldReload = fixture.holdRequestUntilAbort("tools/list");
	const reenableNotificationStart = fixture.notifications.length;
	const reload = fixture.run("reload test");
	await assertSettlesPromptly(heldReload.started, "disable-reenable tools/list request start");
	const disable = fixture.run("disable test");
	await assertSettlesPromptly(heldReload.aborted, "disable-reenable tools/list transport abort");
	const enableAgain = fixture.run("enable test");
	await Promise.all([reload, disable, enableAgain]);
	assert.equal(fixture.hasNotification(reenableNotificationStart, "warning", /reload was superseded before the connection completed/), true);
	assert.equal(fixture.hasNotification(reenableNotificationStart, "info", /reloaded \(\d+ tools\)/), false);
	fixture.assertActive("unrelated_tool", "test_collision", "test_a", "test_b");
});

test("shutdown cancels a pending reload and leaves no connector tools active", async (t) => {
	const fixture = await createMcpFixture();
	t.after(() => fixture.close());
	await fixture.start();
	const held = fixture.holdRequestUntilAbort("tools/list");
	const notificationStart = fixture.notifications.length;
	const reload = fixture.run("reload test");
	await assertSettlesPromptly(held.started, "shutdown tools/list request start");
	const shutdown = fixture.close();
	await assertSettlesPromptly(shutdown, "shutdown during pending tools/list");
	await assertSettlesPromptly(held.aborted, "shutdown transport abort");
	await assertSettlesPromptly(reload, "reload interrupted by shutdown");
	assert.equal(fixture.hasNotification(notificationStart, "warning", /reload was superseded before the connection completed/), true);
	assert.equal(fixture.hasNotification(notificationStart, "info", /reloaded \(\d+ tools\)|enabled and connected/), false);
	fixture.assertActive("unrelated_tool", "test_collision");
});

test("empty catalogues commit as connected and do not rediscover during session sync", async (t) => {
	const fixture = await createMcpFixture();
	t.after(() => fixture.close());
	await fixture.start();
	fixture.setCatalogue([]);
	let notificationStart = fixture.notifications.length;
	await fixture.run("reload test");
	assert.equal(fixture.hasNotification(notificationStart, "info", /reloaded \(0 tools\)/), true);
	fixture.assertActive("unrelated_tool", "test_collision");
	const listsAfterEmptyCommit = fixture.toolsListCount();
	await fixture.sessionTree();
	await fixture.sessionTree();
	assert.equal(fixture.toolsListCount(), listsAfterEmptyCommit);
	await fixture.run("disable test");
	notificationStart = fixture.notifications.length;
	await fixture.run("enable test");
	assert.equal(fixture.hasNotification(notificationStart, "info", /enabled and connected \(0 tools\)/), true);
});

test("host-filtered names are omitted without suffix policy bypass", async (t) => {
	const fixture = await createMcpFixture();
	t.after(() => fixture.close());
	await fixture.start();
	fixture.setCatalogue(["Filtered"]);
	fixture.filteredNames.add("test_filtered");
	await fixture.run("reload test");
	fixture.assertActive("unrelated_tool", "test_collision");
	assert.equal([...fixture.registry.keys()].some((name) => /^test_filtered_\d+$/.test(name)), false);
});

test("registration failure reconciles earlier synchronously registered tools through catch cleanup", async (t) => {
	const fixture = await createMcpFixture({ allowlistMode: true });
	t.after(() => fixture.close());
	fixture.setThrowOnRegisterName("test_b");
	await fixture.start();
	assert.equal(fixture.registry.has("test_a"), true, "the first registration completed before the later throw");
	fixture.assertActive("unrelated_tool", "test_collision");
});

test("foreign collisions and provenance loss reserve names without changing wrapper targets", async (t) => {
	const fixture = await createMcpFixture();
	t.after(() => fixture.close());
	fixture.setCatalogue(["collision", "B"]);
	await fixture.start();
	fixture.assertActive("unrelated_tool", "test_collision", "test_collision_2", "test_b");
	fixture.registry.set("test_b", { name: "test_b", sourceInfo: fixture.unrelatedSourceInfo });
	fixture.setActiveTools([...fixture.activeTools(), "test_b"]);
	fixture.setCatalogue(["B"]);
	await fixture.run("reload test");
	fixture.assertActive("unrelated_tool", "test_collision", "test_b", "test_b_2");
	assert.equal(fixture.registry.get("test_b")?.sourceInfo, fixture.unrelatedSourceInfo);
	await fixture.registry.get("test_b_2")!.execute!("provenance-fallback", {});
	assert.equal(fixture.callTargets.at(-1), "B");
});

test("global persistence failure still disables and tears down locally", async (t) => {
	const fixture = await createMcpFixture();
	t.after(() => fixture.close());
	await fixture.start();
	fixture.writeConfig("{ invalid json");
	await fixture.run("disable test");
	fixture.assertActive("unrelated_tool", "test_collision");
	await fixture.run("status test");
	assert.match(fixture.notifications.at(-1) ?? "", /^test: disabled/);
	assert.equal(fixture.notifications.some((message) => /persist|config/i.test(message) && /fail|unable/i.test(message)), true);
});

test("small MCP text output and image blocks are preserved without truncation metadata", async () => {
	const content = [{ type: "text" as const, text: "short result" }, imageBlock, { type: "text" as const, text: "more text" }];
	const result = await truncateMcpToolContent(content, { maxLines: 10, maxBytes: 1024 });
	assert.deepEqual(result.content, content);
	assert.equal(result.truncation, undefined);
	assert.equal(result.fullTextOutputPath, undefined);
});

test("large MCP text output is truncated with a temp-file marker while images are preserved", async () => {
	const content = [{ type: "text" as const, text: "line 1\nline 2" }, imageBlock, { type: "text" as const, text: "line 3\nline 4" }];
	const result = await truncateMcpToolContent(content, { maxLines: 2, maxBytes: 1024 });
	const { content: truncated, fullTextOutputPath } = result;
	assert.deepEqual(truncated[0], { type: "text", text: "line 1\nline 2" });
	assert.deepEqual(truncated[1], imageBlock);
	assert.equal(truncated.some((block) => block.type === "text" && block.text.includes("line 3")), false);
	const marker = truncated.at(-1);
	assert.equal(marker?.type, "text");
	assert.match(marker?.type === "text" ? marker.text : "", /MCP text output truncated/);
	assert.match(marker?.type === "text" ? marker.text : "", /Full text output saved to:/);
	assert.doesNotMatch(marker?.type === "text" ? marker.text : "", /details\.rawResult/);
	assert.equal(typeof fullTextOutputPath, "string");
	assert.match(marker?.type === "text" ? marker.text : "", new RegExp(fullTextOutputPath!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	assert.equal(readFileSync(fullTextOutputPath!, "utf8"), "line 1\nline 2\nline 3\nline 4");
	assert.equal(result.truncation?.truncated, true);
	rmSync(dirname(fullTextOutputPath!), { recursive: true, force: true });
});

test("small MCP error output keeps existing text and image formatting", async () => {
	const content = [{ type: "text" as const, text: "small error" }, imageBlock, { type: "text" as const, text: "more context" }];
	const message = await formatMcpToolErrorMessage(content, { maxLines: 10, maxBytes: 1024 });
	assert.equal(message, "small error\n[image/png image]\nmore context");
	assert.doesNotMatch(message, /MCP text output truncated/);
});

test("large MCP error text is truncated with the temp-file marker before throwing", async () => {
	const content = [{ type: "text" as const, text: "error line 1\nerror line 2" }, imageBlock, { type: "text" as const, text: "error line 3\nerror line 4" }];
	const message = await formatMcpToolErrorMessage(content, { maxLines: 2, maxBytes: 1024 });
	assert.match(message, /^error line 1\nerror line 2\n\[image\/png image\]/);
	assert.doesNotMatch(message, /error line 3/);
	assert.match(message, /MCP text output truncated/);
	assert.match(message, /Full text output saved to:/);
	const fullTextOutputPath = message.match(/Full text output saved to: ([^\]]+)/)?.[1];
	assert.equal(typeof fullTextOutputPath, "string");
	assert.equal(readFileSync(fullTextOutputPath!, "utf8"), "error line 1\nerror line 2\nerror line 3\nerror line 4");
	rmSync(dirname(fullTextOutputPath!), { recursive: true, force: true });
});
