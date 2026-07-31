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
		[
			{ name: "alpha", displayName: "Alpha MCP", enabled: false },
			{ name: "zeta", displayName: "Zeta MCP", enabled: true },
		],
		{ fg: (color: string, text: string) => `<${color}>${text}</${color}>` },
	);

	assert.equal(footerStatus, "<accent>mcp: </accent><dim>alpha</dim><dim>, </dim><accent>zeta</accent><dim> •</dim>");
});

test("aggregate MCP footer separates multiple connector display names with comma-space", async () => {
	const tempDir = mkdtempSync(join(tmpdir(), "pi-mcp-footer-test-"));
	let activeTools: string[] = [];
	const sessionStartHandlers: Array<(event: unknown, ctx: unknown) => unknown> = [];
	const pi = {
		appendEntry() {},
		getActiveTools: () => activeTools,
		on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
			if (event === "session_start") sessionStartHandlers.push(handler);
		},
		registerCommand() {},
		registerTool() {},
		setActiveTools(names: string[]) {
			activeTools = names;
		},
	};
	const writeConfig = (name: string) => {
		const filePath = join(tempDir, `${name}.json`);
		writeFileSync(filePath, `${JSON.stringify({ type: "streamable-http", url: `http://127.0.0.1:1/${name}`, enabled: false }, null, 2)}\n`);
		return pathToFileURL(filePath);
	};

	try {
		await createMcpConnector(pi as never, {
			connectorName: "zeta",
			extensionName: "zeta-mcp",
			displayName: "Zeta MCP",
			toolPrefix: "zeta_",
			configUrl: writeConfig("zeta"),
		});
		await createMcpConnector(pi as never, {
			connectorName: "alpha",
			extensionName: "alpha-mcp",
			displayName: "Alpha MCP",
			toolPrefix: "alpha_",
			configUrl: writeConfig("alpha"),
		});

		const statuses = new Map<string, string | undefined>();
		const ctx = {
			sessionManager: { getBranch: () => [] },
			ui: {
				setStatus: (key: string, value: string | undefined) => statuses.set(key, value),
				theme: { fg: (_color: string, text: string) => text },
			},
		};
		for (const handler of sessionStartHandlers) {
			await handler(undefined, ctx);
		}

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
	const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
	const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
	const pi = {
		appendEntry() {},
		getActiveTools: () => activeTools,
		getAllTools: () => [],
		on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
			const registered = handlers.get(event) ?? [];
			registered.push(handler);
			handlers.set(event, registered);
		},
		registerCommand(name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) {
			commands.set(name, command);
		},
		registerTool() {},
		setActiveTools(names: string[]) { activeTools = names; },
	};
	const notifications: string[] = [];
	const ctx = {
		ui: {
			notify: (message: string) => notifications.push(message),
			setStatus() {},
			theme: { fg: (_color: string, text: string) => text },
		},
	};

	try {
		await createMcpConnector(pi as never, {
			connectorName: "broken",
			extensionName: "broken-mcp",
			toolPrefix: "broken_",
			configUrl: pathToFileURL(configPath),
			enabledScope: "global",
		});
		assert.ok(commands.get("mcp"), "the malformed connector must still register management commands");
		await commands.get("mcp")!.handler("disable broken", ctx);
		await commands.get("mcp")!.handler("status broken", ctx);
		assert.match(notifications.at(-1) ?? "", /^broken: disabled/);
		assert.equal(notifications.some((message) => /unable to persist config/i.test(message)), true);
	} finally {
		for (const handler of handlers.get("session_shutdown") ?? []) await handler(undefined, ctx);
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("MCP catalogue reconciliation is stable, provenance-safe, serialized, and locally disableable", async () => {
	const tempDir = mkdtempSync(join(tmpdir(), "pi-mcp-reconcile-test-"));
	let catalogue = ["A", "B"];
	let failDiscovery = false;
	let listDelayMs = 0;
	let initializeCount = 0;
	let toolsListCount = 0;
	let heldRequestMethod: "initialize" | "tools/list" | undefined;
	let resolveHeldRequestStarted: (() => void) | undefined;
	let resolveHeldRequestAborted: (() => void) | undefined;
	const holdRequestUntilAbort = (method: "initialize" | "tools/list") => {
		heldRequestMethod = method;
		const started = new Promise<void>((resolve) => { resolveHeldRequestStarted = resolve; });
		const aborted = new Promise<void>((resolve) => { resolveHeldRequestAborted = resolve; });
		return { started, aborted };
	};
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
			? {
				protocolVersion: "2025-03-26",
				capabilities: { tools: {} },
				serverInfo: { name: "loopback", version: "1.0.0" },
			}
			: message.method === "tools/list"
				? { tools: catalogue.map((name) => ({ name, inputSchema: { type: "object" } })) }
				: { content: [{ type: "text", text: `called ${message.params?.name}` }] };
		response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");

	type SourceInfo = { path: string; source: string; scope: "user" | "project" | "temporary"; origin: "package" | "top-level"; baseDir?: string };
	type RegisteredTool = {
		name: string;
		description?: string;
		execute?: (toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
	};
	type CanonicalTool = RegisteredTool & { sourceInfo: SourceInfo };
	const connectorSourceInfo: SourceInfo = {
		path: "/extensions/test-mcp/index.ts",
		source: "test-mcp",
		scope: "user",
		origin: "top-level",
	};
	const unrelatedSourceInfo: SourceInfo = {
		path: "/extensions/unrelated/index.ts",
		source: "unrelated",
		scope: "user",
		origin: "top-level",
	};
	const registry = new Map<string, CanonicalTool>([
		["unrelated_tool", { name: "unrelated_tool", sourceInfo: unrelatedSourceInfo }],
		["test_collision", { name: "test_collision", sourceInfo: unrelatedSourceInfo }],
	]);
	const filteredNames = new Set<string>();
	const allowlistMode = true;
	let activeTools = ["unrelated_tool", "test_collision"];
	const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
	const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
	const pi = {
		appendEntry() {},
		getActiveTools: () => activeTools,
		getAllTools: () => [...registry.values()].filter((tool) => !filteredNames.has(tool.name)),
		on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
			const registered = handlers.get(event) ?? [];
			registered.push(handler);
			handlers.set(event, registered);
		},
		registerCommand(name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) {
			commands.set(name, command);
		},
		registerTool(tool: RegisteredTool) {
			if (filteredNames.has(tool.name)) return;
			const canonical = registry.get(tool.name);
			// Pi 0.83 resolves duplicate extension tool names first-extension-wins. A tool in
			// this extension can update its own definition, but cannot replace another source.
			if (canonical && canonical.sourceInfo !== connectorSourceInfo) return;
			const newlyCanonical = !canonical;
			registry.set(tool.name, { ...tool, sourceInfo: connectorSourceInfo });
			if (allowlistMode) {
				// Pi 0.83 reapplies --tools on every dynamic refresh, reactivating every
				// registered allowlisted canonical name, including obsolete definitions.
				activeTools = [...new Set([
					...activeTools,
					...[...registry.keys()].filter((name) => !filteredNames.has(name)),
				])];
			} else if (newlyCanonical) {
				// Without an allowlist, only truly new canonical names are auto-activated.
				activeTools = [...new Set([...activeTools, tool.name])];
			}
		},
		setActiveTools(names: string[]) {
			// Pi ignores unknown and host-policy-filtered names.
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
	const hasNotification = (start: number, type: "info" | "warning" | "error", pattern: RegExp) =>
		notifications.slice(start).some((message, offset) => notificationTypes[start + offset] === type && pattern.test(message));
	const countNotifications = (start: number, type: "info" | "warning" | "error", pattern: RegExp) =>
		notifications.slice(start).filter((message, offset) => notificationTypes[start + offset] === type && pattern.test(message)).length;
	const assertActiveTools = (...names: string[]) => assert.deepEqual([...activeTools].sort(), names.sort());
	const config = () => JSON.stringify({ type: "streamable-http", url: `http://127.0.0.1:${address.port}/mcp`, enabled: true });
	const configPath = join(tempDir, "connector.json");
	writeFileSync(configPath, `${config()}\n`);

	try {
		await createMcpConnector(pi as never, {
			connectorName: "test",
			extensionName: "test-mcp",
			toolPrefix: "test_",
			configUrl: pathToFileURL(configPath),
			enabledScope: "global",
		});
		for (const handler of handlers.get("session_start") ?? []) await handler(undefined, ctx);
		assertActiveTools("unrelated_tool", "test_collision", "test_a", "test_b");

		// A retained original keeps its generated name across A,B -> B,C reconciliation.
		catalogue = ["B", "C"];
		await commands.get("mcp")!.handler("reload test", ctx);
		assertActiveTools("unrelated_tool", "test_collision", "test_b", "test_c");
		assert.equal(activeTools.includes("test_a"), false, "obsolete A must be inactive after commit");
		assert.equal(registry.has("test_a"), true, "Pi retains obsolete definitions internally");

		// A later allowlist refresh can reactivate obsolete A; connected session synchronization
		// must reconcile it away without rediscovering the already committed catalogue.
		activeTools = [...new Set([...activeTools, "test_a"])];
		const listsBeforeConnectedSync = toolsListCount;
		for (const handler of handlers.get("session_tree") ?? []) await handler(undefined, ctx);
		assert.equal(toolsListCount, listsBeforeConnectedSync);
		assertActiveTools("unrelated_tool", "test_collision", "test_b", "test_c");

		// Sanitization collisions are allocated independent of server order and wrappers keep
		// dispatching to the original MCP tool they were created for.
		catalogue = ["A_B", "A-B"];
		await commands.get("mcp")!.handler("reload test", ctx);
		assertActiveTools("unrelated_tool", "test_collision", "test_a_b", "test_a_b_2");
		const dashedWrapper = registry.get("test_a_b")!;
		const underscoredWrapper = registry.get("test_a_b_2")!;
		assert.match(dashedWrapper.description ?? "", /Original MCP tool name: A-B/);
		assert.match(underscoredWrapper.description ?? "", /Original MCP tool name: A_B/);
		catalogue = ["A-B", "A_B"];
		await commands.get("mcp")!.handler("reload test", ctx);
		const currentDashedWrapper = registry.get("test_a_b")!;
		const currentUnderscoredWrapper = registry.get("test_a_b_2")!;
		assert.match(currentDashedWrapper.description ?? "", /Original MCP tool name: A-B/);
		assert.match(currentUnderscoredWrapper.description ?? "", /Original MCP tool name: A_B/);
		await Promise.all([
			dashedWrapper.execute!("retained-dash", {}),
			underscoredWrapper.execute!("retained-underscore", {}),
			currentDashedWrapper.execute!("current-dash", {}),
			currentUnderscoredWrapper.execute!("current-underscore", {}),
		]);
		assert.deepEqual(callTargets.slice(-4).sort(), ["A-B", "A-B", "A_B", "A_B"]);

		// A failed reload disconnects the catalogue; simultaneous retained executions share
		// one candidate connection/rebuild and each calls the correct current original.
		catalogue = ["B", "C"];
		await commands.get("mcp")!.handler("reload test", ctx);
		const retainedB = registry.get("test_b")!;
		const retainedC = registry.get("test_c")!;
		failDiscovery = true;
		await commands.get("mcp")!.handler("reload test", ctx);
		assertActiveTools("unrelated_tool", "test_collision");
		failDiscovery = false;
		listDelayMs = 50;
		const startsBeforeReconnect = initializeCount;
		const listsBeforeReconnect = toolsListCount;
		await Promise.all([retainedB.execute!("reconnect-b", {}), retainedC.execute!("reconnect-c", {})]);
		listDelayMs = 0;
		assert.equal(initializeCount - startsBeforeReconnect, 1);
		assert.equal(toolsListCount - listsBeforeReconnect, 1);
		assert.deepEqual(callTargets.slice(-2).sort(), ["B", "C"]);
		assertActiveTools("unrelated_tool", "test_collision", "test_b", "test_c");

		// A disable-only teardown promptly aborts a tools/list request that will never
		// produce a normal response, and the interrupted reload cannot report success.
		let heldList = holdRequestUntilAbort("tools/list");
		let notificationStart = notifications.length;
		const reloadBeforeDisable = commands.get("mcp")!.handler("reload test", ctx);
		await assertSettlesPromptly(heldList.started, "pending tools/list request start");
		const disableDuringReload = commands.get("mcp")!.handler("disable test", ctx);
		await assertSettlesPromptly(disableDuringReload, "disable during pending tools/list");
		await assertSettlesPromptly(heldList.aborted, "pending tools/list transport abort");
		await assertSettlesPromptly(reloadBeforeDisable, "interrupted reload");
		assert.equal(
			hasNotification(notificationStart, "warning", /reload was superseded before the connection completed/),
			true,
			"a reload superseded by disable must report a warning",
		);
		assert.equal(
			hasNotification(notificationStart, "info", /reloaded \(\d+ tools\)|enabled and connected/),
			false,
			"a reload superseded by disable must not report command success",
		);
		assertActiveTools("unrelated_tool", "test_collision");
		await commands.get("mcp")!.handler("status test", ctx);
		assert.match(notifications.at(-1) ?? "", /^test: disabled/);

		// The same cancellation and notification guarantees apply when enable itself
		// is interrupted before its candidate catalogue can commit.
		heldList = holdRequestUntilAbort("initialize");
		notificationStart = notifications.length;
		const interruptedEnable = commands.get("mcp")!.handler("enable test", ctx);
		await assertSettlesPromptly(heldList.started, "pending initialize request start");
		const disableDuringEnable = commands.get("mcp")!.handler("disable test", ctx);
		await assertSettlesPromptly(disableDuringEnable, "disable during pending enable");
		await assertSettlesPromptly(heldList.aborted, "pending enable transport abort");
		await assertSettlesPromptly(interruptedEnable, "interrupted enable");
		assert.equal(
			hasNotification(notificationStart, "warning", /enable was superseded before the connection completed/),
			true,
			"an enable superseded by disable must report a warning",
		);
		assert.equal(
			hasNotification(notificationStart, "info", /enabled and connected/),
			false,
			"an enable superseded by disable must not report command success",
		);
		await commands.get("mcp")!.handler("enable test", ctx);
		assertActiveTools("unrelated_tool", "test_collision", "test_b", "test_c");

		// A teardown invalidates an in-flight candidate, while a later enable is serialized after
		// it and commits successfully instead of being cleared by the stale teardown. The server
		// barrier proves discovery started before teardown; the observed abort releases the held
		// request before the later enable queues its replacement generation.
		heldList = holdRequestUntilAbort("tools/list");
		notificationStart = notifications.length;
		const interruptedReload = commands.get("mcp")!.handler("reload test", ctx);
		await assertSettlesPromptly(heldList.started, "disable-reenable tools/list request start");
		const concurrentDisable = commands.get("mcp")!.handler("disable test", ctx);
		await assertSettlesPromptly(heldList.aborted, "disable-reenable tools/list transport abort");
		const concurrentEnable = commands.get("mcp")!.handler("enable test", ctx);
		await Promise.all([interruptedReload, concurrentDisable, concurrentEnable]);
		assert.equal(
			hasNotification(notificationStart, "warning", /reload was superseded before the connection completed/),
			true,
			"the pre-disable reload must report that its generation was superseded",
		);
		assert.equal(
			hasNotification(notificationStart, "info", /reloaded \(\d+ tools\)/),
			false,
			"the pre-disable reload must not inherit the later enable generation's success",
		);
		assert.equal(
			countNotifications(notificationStart, "info", /enabled and connected/),
			1,
			"only the later enable may report its committed generation as info",
		);
		assertActiveTools("unrelated_tool", "test_collision", "test_b", "test_c");
		await commands.get("mcp")!.handler("status test", ctx);
		assert.match(notifications.at(-1) ?? "", /^test: enabled, connected/);

		// A connected empty catalogue is synchronized and branch navigation does not rediscover.
		catalogue = [];
		notificationStart = notifications.length;
		await commands.get("mcp")!.handler("reload test", ctx);
		assert.equal(
			hasNotification(notificationStart, "info", /reloaded \(0 tools\)/),
			true,
			"a committed empty catalogue remains a successful reload",
		);
		assertActiveTools("unrelated_tool", "test_collision");
		const listsAfterEmptyCommit = toolsListCount;
		for (const handler of handlers.get("session_tree") ?? []) await handler(undefined, ctx);
		for (const handler of handlers.get("session_tree") ?? []) await handler(undefined, ctx);
		assert.equal(toolsListCount, listsAfterEmptyCommit);

		// Zero is also a valid successful count for a fresh enable, not a cancellation sentinel.
		await commands.get("mcp")!.handler("disable test", ctx);
		notificationStart = notifications.length;
		await commands.get("mcp")!.handler("enable test", ctx);
		assert.equal(
			hasNotification(notificationStart, "info", /enabled and connected \(0 tools\)/),
			true,
			"a committed empty catalogue remains a successful enable",
		);
		await commands.get("mcp")!.handler("status test", ctx);
		assert.match(notifications.at(-1) ?? "", /^test: enabled, connected.*\(0 tools\)/);

		// A Pi allowlist/exclude-list filtered canonical name is omitted without retrying
		// suffixes that would bypass the host policy.
		catalogue = ["Filtered"];
		filteredNames.add("test_filtered");
		await commands.get("mcp")!.handler("reload test", ctx);
		assertActiveTools("unrelated_tool", "test_collision");
		assert.equal([...registry.keys()].some((name) => /^test_filtered_\d+$/.test(name)), false);
		filteredNames.clear();

		// Unrelated canonical provenance reserves a collision. If provenance for a historical
		// name is later lost, that name is preserved and a deterministic suffix is allocated.
		catalogue = ["collision", "B"];
		await commands.get("mcp")!.handler("reload test", ctx);
		assertActiveTools("unrelated_tool", "test_collision", "test_collision_2", "test_b");
		registry.set("test_b", { name: "test_b", sourceInfo: unrelatedSourceInfo });
		activeTools = [...new Set([...activeTools, "test_b"])];
		catalogue = ["B"];
		await commands.get("mcp")!.handler("reload test", ctx);
		assertActiveTools("unrelated_tool", "test_collision", "test_b", "test_b_2");
		assert.equal(registry.get("test_b")?.sourceInfo, unrelatedSourceInfo);
		await registry.get("test_b_2")!.execute!("provenance-fallback", {});
		assert.equal(callTargets.at(-1), "B");

		// Persistence failure must not prevent local global-scope disable and teardown.
		writeFileSync(configPath, "{ invalid json\n");
		await commands.get("mcp")!.handler("disable test", ctx);
		assertActiveTools("unrelated_tool", "test_collision", "test_b");
		await commands.get("mcp")!.handler("status test", ctx);
		assert.match(notifications.at(-1) ?? "", /^test: disabled/);
		assert.equal(notifications.some((message) => /persist|config/i.test(message) && /fail|unable/i.test(message)), true);

		// Session shutdown uses the same prompt-abort path and remains idempotent when
		// lifecycle cleanup is requested again from the test's finally block.
		writeFileSync(configPath, `${config()}\n`);
		await commands.get("mcp")!.handler("enable test", ctx);
		heldList = holdRequestUntilAbort("tools/list");
		notificationStart = notifications.length;
		const reloadBeforeShutdown = commands.get("mcp")!.handler("reload test", ctx);
		await assertSettlesPromptly(heldList.started, "shutdown tools/list request start");
		const shutdown = Promise.all((handlers.get("session_shutdown") ?? []).map((handler) => handler(undefined, ctx)));
		await assertSettlesPromptly(shutdown, "shutdown during pending tools/list");
		await assertSettlesPromptly(heldList.aborted, "shutdown transport abort");
		await assertSettlesPromptly(reloadBeforeShutdown, "reload interrupted by shutdown");
		assert.equal(
			hasNotification(notificationStart, "warning", /reload was superseded before the connection completed/),
			true,
			"a reload superseded by shutdown must report a warning",
		);
		assert.equal(
			hasNotification(notificationStart, "info", /reloaded \(\d+ tools\)|enabled and connected/),
			false,
			"a reload superseded by shutdown must not report command success",
		);
	} finally {
		// Abort loopback sockets first so a failed prompt-cancellation assertion cannot
		// strand teardown behind the deliberately non-responsive tools/list request.
		server.closeAllConnections();
		for (const handler of handlers.get("session_shutdown") ?? []) await handler(undefined, ctx);
		await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("small MCP text output and image blocks are preserved without truncation metadata", async () => {
	const content = [
		{ type: "text" as const, text: "short result" },
		imageBlock,
		{ type: "text" as const, text: "more text" },
	];

	const result = await truncateMcpToolContent(content, { maxLines: 10, maxBytes: 1024 });

	assert.deepEqual(result.content, content);
	assert.equal(result.truncation, undefined);
	assert.equal(result.fullTextOutputPath, undefined);
});

test("large MCP text output is truncated with a temp-file marker while images are preserved", async () => {
	const content = [
		{ type: "text" as const, text: "line 1\nline 2" },
		imageBlock,
		{ type: "text" as const, text: "line 3\nline 4" },
	];

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
	const content = [
		{ type: "text" as const, text: "small error" },
		imageBlock,
		{ type: "text" as const, text: "more context" },
	];

	const message = await formatMcpToolErrorMessage(content, { maxLines: 10, maxBytes: 1024 });

	assert.equal(message, "small error\n[image/png image]\nmore context");
	assert.doesNotMatch(message, /MCP text output truncated/);
});

test("large MCP error text is truncated with the temp-file marker before throwing", async () => {
	const content = [
		{ type: "text" as const, text: "error line 1\nerror line 2" },
		imageBlock,
		{ type: "text" as const, text: "error line 3\nerror line 4" },
	];

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
