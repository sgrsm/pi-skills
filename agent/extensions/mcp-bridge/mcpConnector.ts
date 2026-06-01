import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Container, Text } from "@mariozechner/pi-tui";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Type } from "typebox";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isHideToolOutputEnabled } from "../shared/hideToolOutputState.ts";

export type McpConfig = {
	type: "streamable-http";
	url: string;
	headers?: Record<string, string>;
	enabled?: boolean;
};

type McpTool = {
	name: string;
	title?: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
	annotations?: {
		title?: string;
		readOnlyHint?: boolean;
		destructiveHint?: boolean;
		idempotentHint?: boolean;
		openWorldHint?: boolean;
	};
};

type ConnectionState = {
	client?: Client;
	transport?: StreamableHTTPClientTransport;
	connected: boolean;
	enabled: boolean;
	lastError?: string;
	serverName?: string;
	toolByPiName: Map<string, McpTool>;
	registeredPiNames: Set<string>;
};

export type McpConnectorOptions = {
	/** Short server id used by /mcp commands, e.g. "idea" for /mcp enable idea. Defaults to extensionName without a trailing "-mcp". */
	connectorName?: string;
	/** Stable extension id used for status keys and defaults, e.g. "idea-mcp". */
	extensionName: string;
	/** Human-readable name used in notifications and prompt snippets, e.g. "IDEA MCP". */
	displayName?: string;
	/** Shared slash command name without leading slash. Defaults to "mcp". */
	commandName?: string;
	/** Optional dedicated toggle command, e.g. "idea-mcp" for /idea-mcp [on|off]. */
	toggleCommandName?: string;
	/** Prefix for generated pi tool names, e.g. "idea_". Must be unique per connector. */
	toolPrefix: string;
	/** URL of the connector config file, usually new URL("./config.json", import.meta.url). */
	configUrl: URL;
	/** MCP client metadata. */
	clientName?: string;
	clientVersion?: string;
	/** Optional env var prefix. Supports ${PREFIX}_URL and ${PREFIX}_HEADERS overrides. */
	envPrefix?: string;
	/** Per-tool call timeout. Defaults to 120000ms. */
	toolCallTimeoutMs?: number;
	/** Whether enable/disable is persisted globally in config or in the current session history. Defaults to "session". */
	enabledScope?: "global" | "session";
	/** Default enabled value when no persisted state exists. Defaults to false for session scope, config.enabled for global scope. */
	defaultEnabled?: boolean;
};

type McpNotifyType = "info" | "success" | "warning" | "error";
type McpStatusColor = "dim" | "accent";
type McpStatusContext = { ui: { setStatus: (key: string, value: string | undefined) => void; theme: { fg: (color: McpStatusColor, text: string) => string } } };
type McpNotifyContext = { ui: { notify: (message: string, type?: McpNotifyType) => void } };
type McpCommandContext = McpStatusContext & McpNotifyContext;
type McpEnabledScope = "global" | "session";
type McpSessionState = { connectorName: string; enabled: boolean };
type McpSessionStateEntry = { type?: string; customType?: string; data?: unknown };
type McpSessionStateContext = McpStatusContext & { sessionManager: { getBranch: () => McpSessionStateEntry[] } };

const MCP_STATUS_KEY = "mcp";
const ENABLED_MCP_SEPARATOR = " · ";
const MCP_SESSION_STATE_CUSTOM_TYPE = "mcp-connector-state";

type McpConnectorRuntime = {
	name: string;
	displayName: string;
	extensionName: string;
	commandName: string;
	state: ConnectionState;
	activateTools: () => void;
	deactivateTools: () => void;
	setEnabled: (enabled: boolean, persist: boolean) => void;
	connectAndRegister: () => Promise<number>;
	close: () => Promise<void>;
	setStatus: (ctx: McpStatusContext) => void;
	statusLine: () => string;
	notifyTools: (ctx: McpNotifyContext) => void;
	enable: (ctx: McpCommandContext) => Promise<void>;
	disable: (ctx: McpCommandContext) => Promise<void>;
	reload: (ctx: McpCommandContext) => Promise<void>;
	syncEnabledState: (ctx?: McpSessionStateContext) => Promise<void>;
};

type McpManager = {
	commandName: string;
	commandRegistered: boolean;
	connectors: Map<string, McpConnectorRuntime>;
};

const MCP_COMMANDS = ["status", "tools", "enable", "disable", "reload"] as const;
const MCP_TOGGLE_COMMANDS = ["on", "off"] as const;
type McpCommand = typeof MCP_COMMANDS[number];
type McpToggleCommand = typeof MCP_TOGGLE_COMMANDS[number];
const TARGET_REQUIRED_COMMANDS = new Set<McpCommand>(["tools", "enable", "disable", "reload"]);
const managers = new WeakMap<ExtensionAPI, McpManager>();

function resolveEnabledScope(options: McpConnectorOptions): McpEnabledScope {
	return options.enabledScope ?? "session";
}

function resolveDefaultEnabled(options: McpConnectorOptions, config?: McpConfig): boolean {
	if (options.defaultEnabled !== undefined) return options.defaultEnabled;
	return resolveEnabledScope(options) === "session" ? false : config?.enabled !== false;
}

function getSessionEnabledState(ctx: McpSessionStateContext, connectorName: string): boolean | undefined {
	let enabled: boolean | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry?.type !== "custom" || entry.customType !== MCP_SESSION_STATE_CUSTOM_TYPE) continue;
		const data = entry.data as Partial<McpSessionState> | undefined;
		if (data?.connectorName === connectorName && typeof data.enabled === "boolean") {
			enabled = data.enabled;
		}
	}
	return enabled;
}

function persistSessionEnabledState(pi: ExtensionAPI, connectorName: string, enabled: boolean): void {
	pi.appendEntry(MCP_SESSION_STATE_CUSTOM_TYPE, { connectorName, enabled } as McpSessionState);
}

function errorMessage(error: unknown): string {
	return error instanceof Error && error.message ? error.message : String(error);
}

function getMcpTextOutput(
	content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>,
	showImages: boolean,
): string {
	return content
		.flatMap((block) => {
			if (block.type === "text") return [block.text];
			return showImages ? [] : [`[${block.mimeType} image]`];
		})
		.join("\n");
}

function normalizeConnectorName(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function defaultConnectorName(extensionName: string): string {
	return normalizeConnectorName(extensionName.replace(/-mcp$/i, ""));
}

function sanitizeToolBaseName(name: string): string {
	const sanitized = name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
	return sanitized || "tool";
}

function makePiToolName(originalName: string, usedNames: Set<string>, toolPrefix: string): string {
	const maxLength = 64;
	const base = `${toolPrefix}${sanitizeToolBaseName(originalName)}`.slice(0, maxLength).replace(/_+$/g, "");
	let candidate = base || `${toolPrefix}tool`;
	let suffix = 2;
	while (usedNames.has(candidate)) {
		const suffixText = `_${suffix++}`;
		candidate = `${base.slice(0, maxLength - suffixText.length)}${suffixText}`;
	}
	usedNames.add(candidate);
	return candidate;
}

function asObjectSchema(schema: unknown) {
	const fallback = { type: "object", properties: {}, additionalProperties: true };
	if (!schema || typeof schema !== "object") return Type.Unsafe(fallback);
	const candidate = schema as Record<string, unknown>;
	return Type.Unsafe({
		type: "object",
		properties: {},
		additionalProperties: true,
		...candidate,
	});
}

function formatMcpContent(content: unknown): Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> {
	if (!Array.isArray(content)) {
		return [{ type: "text", text: JSON.stringify(content, null, 2) }];
	}

	const result: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
	for (const item of content) {
		if (!item || typeof item !== "object") {
			result.push({ type: "text", text: String(item) });
			continue;
		}
		const block = item as Record<string, unknown>;
		if (block.type === "text") {
			result.push({ type: "text", text: String(block.text ?? "") });
		} else if (block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string") {
			result.push({ type: "image", data: block.data, mimeType: block.mimeType });
		} else if (block.type === "resource" && block.resource && typeof block.resource === "object") {
			const resource = block.resource as Record<string, unknown>;
			if (typeof resource.text === "string") {
				result.push({ type: "text", text: `Resource ${resource.uri ?? ""}:\n${resource.text}` });
			} else {
				result.push({ type: "text", text: `Resource ${resource.uri ?? ""}: ${JSON.stringify(resource, null, 2)}` });
			}
		} else if (block.type === "resource_link") {
			result.push({ type: "text", text: `Resource link ${block.name ?? ""}: ${block.uri ?? ""}` });
		} else {
			result.push({ type: "text", text: JSON.stringify(block, null, 2) });
		}
	}
	return result.length > 0 ? result : [{ type: "text", text: "(empty MCP result)" }];
}

async function closeConnection(state: ConnectionState) {
	try {
		await state.client?.close();
	} catch {
		try {
			await state.transport?.close();
		} catch {
			// Ignore cleanup errors.
		}
	}
	state.client = undefined;
	state.transport = undefined;
	state.connected = false;
	state.serverName = undefined;
}

async function listAllTools(client: Client): Promise<McpTool[]> {
	const tools: McpTool[] = [];
	let cursor: string | undefined;
	do {
		const page = await client.listTools(cursor ? { cursor } : undefined);
		tools.push(...(page.tools as McpTool[]));
		cursor = page.nextCursor;
	} while (cursor);
	return tools;
}

function isManagedToolName(state: ConnectionState, name: string, toolPrefix: string): boolean {
	return state.registeredPiNames.size > 0 ? state.registeredPiNames.has(name) : name.startsWith(toolPrefix);
}

function isMcpCommand(command: string): command is McpCommand {
	return (MCP_COMMANDS as readonly string[]).includes(command);
}

function isMcpToggleCommand(command: string): command is McpToggleCommand {
	return (MCP_TOGGLE_COMMANDS as readonly string[]).includes(command);
}

function connectorNames(manager: McpManager): string[] {
	return [...manager.connectors.keys()].sort((a, b) => a.localeCompare(b));
}

function knownConnectorText(manager: McpManager): string {
	const names = connectorNames(manager);
	return names.length > 0 ? names.join(", ") : "none";
}

function statusDisplayName(connector: McpConnectorRuntime): string {
	const name = connector.displayName.trim().replace(/\s+MCP$/i, "").trim();
	return (name || connector.name).toLowerCase();
}

function updateMcpStatus(manager: McpManager, ctx: McpStatusContext): void {
	const connectors = connectorNames(manager).map((name) => manager.connectors.get(name)!);
	if (connectors.length === 0) {
		ctx.ui.setStatus(MCP_STATUS_KEY, ctx.ui.theme.fg("dim", "mcp: none"));
		return;
	}

	let text = ctx.ui.theme.fg("dim", "mcp: ");
	for (const [index, connector] of connectors.entries()) {
		if (index > 0) {
			text += ctx.ui.theme.fg("dim", ENABLED_MCP_SEPARATOR);
		}
		text += ctx.ui.theme.fg(connector.state.enabled ? "accent" : "dim", statusDisplayName(connector));
	}

	ctx.ui.setStatus(MCP_STATUS_KEY, text);
}

function getArgumentCompletions(manager: McpManager, prefix: string) {
	const value = prefix.trimStart();
	const parts = value.trim().length > 0 ? value.trim().split(/\s+/) : [];
	const hasTrailingSpace = /\s$/.test(prefix);

	if (parts.length === 0 || (parts.length === 1 && !hasTrailingSpace)) {
		const needle = parts[0] ?? "";
		const items = MCP_COMMANDS
			.filter((command) => command.startsWith(needle))
			.map((command) => ({ value: command, label: command }));
		return items.length > 0 ? items : null;
	}

	const action = parts[0];
	if (!isMcpCommand(action)) return null;
	if ((parts.length === 1 && hasTrailingSpace) || (parts.length === 2 && !hasTrailingSpace)) {
		const needle = hasTrailingSpace ? "" : (parts[1] ?? "");
		const items = connectorNames(manager)
			.filter((name) => name.startsWith(needle))
			.map((name) => ({
				value: `${action} ${name}`,
				label: name,
				description: manager.connectors.get(name)?.displayName,
			}));
		return items.length > 0 ? items : null;
	}

	return null;
}

function parseMcpArgs(args: string): { command: McpCommand; connectorName?: string; error?: string } {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return { command: "status" };

	const command = parts[0].toLowerCase();
	if (!isMcpCommand(command)) {
		return { command: "status", error: `Unknown MCP command: ${parts[0]}` };
	}

	const connectorName = parts[1] ? normalizeConnectorName(parts[1]) : undefined;
	return { command, connectorName };
}

function getToggleArgumentCompletions(prefix: string) {
	const value = prefix.trim();
	if (value.includes(" ")) return null;

	const items = MCP_TOGGLE_COMMANDS
		.filter((command) => command.startsWith(value.toLowerCase()))
		.map((command) => ({ value: command, label: command }));
	return items.length > 0 ? items : null;
}

function parseToggleArgs(args: string): { command?: McpToggleCommand; error?: string } {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return {};
	if (parts.length > 1) {
		return { error: `Too many arguments: ${parts.slice(1).join(" ")}` };
	}

	const command = parts[0].toLowerCase();
	if (!isMcpToggleCommand(command)) {
		return { error: `Unknown command: ${parts[0]}` };
	}

	return { command };
}

function registerMcpCommand(pi: ExtensionAPI, manager: McpManager) {
	if (manager.commandRegistered) return;
	manager.commandRegistered = true;

	pi.registerCommand(manager.commandName, {
		description: `Manage MCP connectors: /${manager.commandName} [status|tools|enable|disable|reload] [connector]`,
		getArgumentCompletions: (prefix) => getArgumentCompletions(manager, prefix),
		handler: async (args, ctx) => {
			const parsed = parseMcpArgs(args);
			if (parsed.error) {
				ctx.ui.notify(`${parsed.error}\nUsage: /${manager.commandName} [status|tools|enable|disable|reload] [connector]\nKnown connectors: ${knownConnectorText(manager)}`, "error");
				return;
			}

			if (parsed.command === "status" && !parsed.connectorName) {
				const lines = connectorNames(manager).map((name) => manager.connectors.get(name)!.statusLine());
				ctx.ui.notify(lines.length > 0 ? lines.join("\n") : "No MCP connectors registered.", lines.length > 0 ? "info" : "warning");
				return;
			}

			if (!parsed.connectorName && TARGET_REQUIRED_COMMANDS.has(parsed.command)) {
				ctx.ui.notify(`Missing connector name. Usage: /${manager.commandName} ${parsed.command} <connector>\nKnown connectors: ${knownConnectorText(manager)}`, "error");
				return;
			}

			const connector = parsed.connectorName ? manager.connectors.get(parsed.connectorName) : undefined;
			if (!connector) {
				ctx.ui.notify(`Unknown MCP connector: ${parsed.connectorName ?? "(missing)"}\nKnown connectors: ${knownConnectorText(manager)}`, "error");
				return;
			}

			if (parsed.command === "status") {
				ctx.ui.notify(connector.statusLine(), connector.state.enabled && connector.state.connected ? "success" : "warning");
				return;
			}

			if (parsed.command === "tools") {
				connector.notifyTools(ctx);
				return;
			}

			if (parsed.command === "enable") {
				await connector.enable(ctx);
				return;
			}

			if (parsed.command === "disable") {
				await connector.disable(ctx);
				return;
			}

			await connector.reload(ctx);
		},
	});
}

function registerToggleCommand(pi: ExtensionAPI, runtime: McpConnectorRuntime, toggleCommandName: string) {
	pi.registerCommand(toggleCommandName, {
		description: `Toggle ${runtime.displayName}: /${toggleCommandName} [on|off]`,
		getArgumentCompletions: (prefix) => getToggleArgumentCompletions(prefix),
		handler: async (args, ctx) => {
			const parsed = parseToggleArgs(args);
			if (parsed.error) {
				ctx.ui.notify(`${parsed.error}\nUsage: /${toggleCommandName} [on|off]`, "error");
				return;
			}

			if (!parsed.command) {
				ctx.ui.notify(runtime.statusLine(), runtime.state.enabled && runtime.state.connected ? "success" : "warning");
				return;
			}

			if (parsed.command === "on") {
				await runtime.enable(ctx);
				return;
			}

			await runtime.disable(ctx);
		},
	});
}

function getMcpManager(pi: ExtensionAPI, commandName: string): McpManager {
	let manager = managers.get(pi);
	if (manager) {
		if (manager.commandName !== commandName) {
			throw new Error(`MCP connectors must use one shared command name. Existing: ${manager.commandName}, requested: ${commandName}`);
		}
		registerMcpCommand(pi, manager);
		return manager;
	}

	manager = {
		commandName,
		commandRegistered: false,
		connectors: new Map(),
	};
	managers.set(pi, manager);
	registerMcpCommand(pi, manager);
	return manager;
}

function createConnectorRuntime(pi: ExtensionAPI, options: McpConnectorOptions, connectorName: string, commandName: string, manager: McpManager): McpConnectorRuntime {
	const displayName = options.displayName ?? options.extensionName;
	const clientName = options.clientName ?? `pi-${options.extensionName}`;
	const clientVersion = options.clientVersion ?? "1.0.0";
	const toolCallTimeoutMs = options.toolCallTimeoutMs ?? 120000;
	const toggleCommandName = options.toggleCommandName?.trim() || undefined;
	const enableCommandText = toggleCommandName ? `/${toggleCommandName} on` : `/${commandName} enable ${connectorName}`;
	const reloadCommandText = `/${commandName} reload ${connectorName}`;
	const enabledScope = resolveEnabledScope(options);

	const readRawConfig = (): McpConfig => JSON.parse(readFileSync(options.configUrl, "utf8")) as McpConfig;

	const readConfig = (): McpConfig => {
		const config = readRawConfig();
		if (options.envPrefix && process.env[`${options.envPrefix}_URL`]) {
			config.url = process.env[`${options.envPrefix}_URL`]!;
		}
		if (options.envPrefix && process.env[`${options.envPrefix}_HEADERS`]) {
			config.headers = JSON.parse(process.env[`${options.envPrefix}_HEADERS`]!) as Record<string, string>;
		}
		if (config.type !== "streamable-http") {
			throw new Error(`Unsupported ${displayName} type: ${config.type}`);
		}
		return config;
	};

	const writeEnabled = (enabled: boolean) => {
		const config = readRawConfig();
		config.enabled = enabled;
		writeFileSync(fileURLToPath(options.configUrl), `${JSON.stringify(config, null, 2)}\n`);
	};

	const initialConfig = readConfig();
	const state: ConnectionState = {
		connected: false,
		enabled: resolveDefaultEnabled(options, initialConfig),
		toolByPiName: new Map(),
		registeredPiNames: new Set(),
	};

	const activateTools = () => {
		pi.setActiveTools([...new Set([...pi.getActiveTools(), ...state.registeredPiNames])]);
	};

	const deactivateTools = () => {
		pi.setActiveTools(pi.getActiveTools().filter((name) => !isManagedToolName(state, name, options.toolPrefix)));
	};

	const setEnabled = (enabled: boolean, persist: boolean) => {
		if (enabledScope === "global") {
			writeEnabled(enabled);
		} else if (persist) {
			persistSessionEnabledState(pi, connectorName, enabled);
		}
		state.enabled = enabled;
	};

	const connectAndRegister = async () => {
		const config = readConfig();
		if (!state.enabled) {
			await closeConnection(state);
			return 0;
		}
		await closeConnection(state);
		state.toolByPiName.clear();
		state.registeredPiNames.clear();

		const transport = new StreamableHTTPClientTransport(new URL(config.url), {
			requestInit: { headers: config.headers ?? {} },
		});
		const client = new Client({ name: clientName, version: clientVersion });

		await client.connect(transport);
		state.client = client;
		state.transport = transport;
		state.connected = true;
		state.lastError = undefined;
		const server = client.getServerVersion();
		state.serverName = server ? `${server.name} ${server.version}` : config.url;

		const usedNames = new Set<string>();
		const tools = await listAllTools(client);
		for (const tool of tools) {
			const piName = makePiToolName(tool.name, usedNames, options.toolPrefix);
			state.toolByPiName.set(piName, tool);
			state.registeredPiNames.add(piName);

			pi.registerTool({
				name: piName,
				label: tool.annotations?.title ?? tool.title ?? tool.name,
				description: `${tool.description ?? `${displayName} tool.`}\n\nOriginal MCP tool name: ${tool.name}`,
				promptSnippet: `Call ${displayName} tool ${tool.name}${tool.description ? `: ${tool.description}` : "."}`,
				parameters: asObjectSchema(tool.inputSchema),
				renderResult(result, _options, theme, context) {
					if (isHideToolOutputEnabled()) {
						const component = context.lastComponent instanceof Container ? context.lastComponent : new Container();
						component.clear();
						return component;
					}

					const output = getMcpTextOutput(result.content, context.showImages);
					if (!output.trim()) {
						const component = context.lastComponent instanceof Container ? context.lastComponent : new Container();
						component.clear();
						return component;
					}

					const component = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
					component.setText(theme.fg("toolOutput", output));
					return component;
				},
				async execute(_toolCallId, params, signal) {
					if (!state.enabled) {
						throw new Error(`${displayName} connector is disabled. Run ${enableCommandText} to enable it.`);
					}
					if (!state.client || !state.connected) {
						await connectAndRegister();
					}
					const activeTool = state.toolByPiName.get(piName);
					if (!activeTool || !state.client) {
						throw new Error(`${displayName} tool is not available: ${tool.name}`);
					}
					const result = await state.client.callTool(
						{ name: activeTool.name, arguments: params as Record<string, unknown> },
						undefined,
						{ signal, timeout: toolCallTimeoutMs },
					);
					const content = formatMcpContent("content" in result ? result.content : result);
					if ("isError" in result && result.isError) {
						throw new Error(content.map((block) => (block.type === "text" ? block.text : `[${block.mimeType} image]`)).join("\n"));
					}
					return {
						content,
						details: {
							mcpConnector: connectorName,
							mcpServer: state.serverName,
							mcpTool: activeTool.name,
							piTool: piName,
							structuredContent: "structuredContent" in result ? result.structuredContent : undefined,
							rawResult: result,
						},
					};
				},
			});
		}

		return tools.length;
	};

	const syncEnabledState = async (ctx?: McpSessionStateContext) => {
		state.enabled =
			enabledScope === "session"
				? (ctx ? getSessionEnabledState(ctx, connectorName) ?? resolveDefaultEnabled(options) : resolveDefaultEnabled(options))
				: resolveDefaultEnabled(options, readConfig());

		if (!state.enabled) {
			deactivateTools();
			await closeConnection(state);
			return;
		}

		activateTools();
		if (state.connected && state.toolByPiName.size > 0) {
			return;
		}

		try {
			await connectAndRegister();
			activateTools();
		} catch (error) {
			state.lastError = errorMessage(error);
			deactivateTools();
			await closeConnection(state);
		}
	};

	const runtime: McpConnectorRuntime = {
		name: connectorName,
		displayName,
		extensionName: options.extensionName,
		commandName,
		state,
		activateTools,
		deactivateTools,
		setEnabled,
		connectAndRegister,
		close: () => closeConnection(state),
		setStatus: (ctx) => {
			// Clear the old per-connector status key, then publish one aggregate MCP footer entry.
			ctx.ui.setStatus(options.extensionName, undefined);
			updateMcpStatus(manager, ctx);
		},
		statusLine: () => {
			const status = !state.enabled
				? "disabled"
				: state.connected
					? `enabled, connected to ${state.serverName ?? displayName} (${state.toolByPiName.size} tools)`
					: `enabled, disconnected${state.lastError ? `: ${state.lastError}` : ""}`;
			return `${connectorName}: ${status}`;
		},
		notifyTools: (ctx) => {
			const lines = [...state.toolByPiName.entries()]
				.map(([piName, tool]) => `${piName} -> ${tool.name}${tool.description ? ` - ${tool.description}` : ""}`);
			ctx.ui.notify(lines.length ? lines.join("\n") : `No ${displayName} tools registered. Use ${enableCommandText} or ${reloadCommandText}.`, "info");
		},
		enable: async (ctx) => {
			setEnabled(true, true);
			try {
				const count = await connectAndRegister();
				activateTools();
				runtime.setStatus(ctx);
				ctx.ui.notify(`${displayName} enabled and connected (${count} tools).`, "success");
			} catch (error) {
				state.lastError = errorMessage(error);
				runtime.setStatus(ctx);
				ctx.ui.notify(`${displayName} enabled, but connection failed: ${state.lastError}`, "error");
			}
		},
		disable: async (ctx) => {
			setEnabled(false, true);
			deactivateTools();
			await closeConnection(state);
			runtime.setStatus(ctx);
			ctx.ui.notify(`${displayName} disabled. Run ${enableCommandText} to re-enable it.`, "success");
		},
		reload: async (ctx) => {
			if (!state.enabled) {
				runtime.setStatus(ctx);
				ctx.ui.notify(`${displayName} is disabled. Run ${enableCommandText} to connect it.`, "warning");
				return;
			}
			try {
				const count = await connectAndRegister();
				activateTools();
				runtime.setStatus(ctx);
				ctx.ui.notify(`${displayName} reloaded (${count} tools).`, "success");
			} catch (error) {
				state.lastError = errorMessage(error);
				runtime.setStatus(ctx);
				ctx.ui.notify(`${displayName} connection failed: ${state.lastError}`, "error");
			}
		},
		syncEnabledState,
	};

	return runtime;
}

export async function createMcpConnector(pi: ExtensionAPI, options: McpConnectorOptions) {
	const commandName = options.commandName ?? "mcp";
	const connectorName = normalizeConnectorName(options.connectorName ?? defaultConnectorName(options.extensionName));
	if (!connectorName) throw new Error(`Invalid MCP connector name for ${options.extensionName}`);

	const manager = getMcpManager(pi, commandName);
	if (manager.connectors.has(connectorName)) {
		throw new Error(`Duplicate MCP connector name: ${connectorName}`);
	}

	const runtime = createConnectorRuntime(pi, options, connectorName, commandName, manager);
	manager.connectors.set(connectorName, runtime);

	const toggleCommandName = options.toggleCommandName?.trim();
	if (toggleCommandName) {
		registerToggleCommand(pi, runtime, toggleCommandName);
	}

	pi.on("session_start", async (_event, ctx) => {
		await runtime.syncEnabledState(ctx as McpSessionStateContext);
		runtime.setStatus(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		await runtime.syncEnabledState(ctx as McpSessionStateContext);
		runtime.setStatus(ctx);
	});

	pi.on("session_shutdown", async () => {
		manager.connectors.delete(connectorName);
		manager.commandRegistered = false;
		await runtime.close();
	});
}
