import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
	type ExtensionAPI,
	type TruncationOptions,
	type TruncationResult,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Type } from "typebox";
import { promises as fs, readFileSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { clearLegacyFooterStatus, FOOTER_STATUS_KEYS } from "../shared/footerStatus.ts";
import { isHideToolOutputEnabled } from "../hide-tool-output/state.ts";

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

type PiToolInfo = ReturnType<ExtensionAPI["getAllTools"]>[number];
type PiToolSourceInfo = PiToolInfo["sourceInfo"];

type McpToolOwnership = {
	originalName: string;
	piName: string;
	/** Canonical Pi sourceInfo identity observed after registration. */
	sourceInfoIdentity: string;
};

type CandidateConnection = {
	generation: number;
	client: Client;
	transport: StreamableHTTPClientTransport;
	closePromise?: Promise<void>;
};

type CatalogueRebuildResult = {
	generation: number;
	status: "committed" | "superseded";
	toolCount: number;
};

class CatalogueRebuildError extends Error {
	readonly generation: number;

	constructor(generation: number, cause: unknown) {
		super(errorMessage(cause));
		this.name = "CatalogueRebuildError";
		this.generation = generation;
	}
}

type ConnectionState = {
	client?: Client;
	transport?: StreamableHTTPClientTransport;
	connected: boolean;
	enabled: boolean;
	lastError?: string;
	serverName?: string;
	/** The currently discovered catalogue, keyed by generated Pi tool name. */
	toolByPiName: Map<string, McpTool>;
	/** Preferred stable generated name for each original MCP name. */
	ownershipByOriginal: Map<string, McpToolOwnership>;
	/** All historical registrations, retained because Pi cannot unregister tools. */
	ownershipByPiName: Map<string, McpToolOwnership>;
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

export type McpTextContentBlock = { type: "text"; text: string };
export type McpImageContentBlock = { type: "image"; data: string; mimeType: string };
export type McpContentBlock = McpTextContentBlock | McpImageContentBlock;
type PiNotifyType = "info" | "warning" | "error";
export type McpNotifyType = PiNotifyType | "success";
type McpStatusColor = "dim" | "accent";
type McpStatusTheme = { fg: (color: McpStatusColor, text: string) => string };
type McpStatusContext = { ui: { setStatus: (key: string, value: string | undefined) => void; theme: McpStatusTheme } };
type McpNotifyContext = { ui: { notify: (message: string, type?: PiNotifyType) => void } };
type McpCommandContext = McpStatusContext & McpNotifyContext;
type McpEnabledScope = "global" | "session";
type McpSessionState = { connectorName: string; enabled: boolean };
type McpSessionStateEntry = { type?: string; customType?: string; data?: unknown };
type McpSessionStateContext = McpStatusContext & { sessionManager: { getBranch: () => McpSessionStateEntry[] } };

const MCP_STATUS_KEY = FOOTER_STATUS_KEYS.mcp;
const ENABLED_MCP_SEPARATOR = ", ";
const FOOTER_STATUS_DELIMITER = " •";
const MCP_SESSION_STATE_CUSTOM_TYPE = "mcp-connector-state";

type McpConnectorRuntime = {
	name: string;
	displayName: string;
	extensionName: string;
	commandName: string;
	state: ConnectionState;
	activateTools: () => void;
	deactivateTools: () => void;
	setEnabled: (enabled: boolean, persist: boolean) => string | undefined;
	connectAndRegister: () => Promise<CatalogueRebuildResult>;
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

export function normalizeMcpNotifyType(type?: McpNotifyType): PiNotifyType | undefined {
	return type === "success" ? "info" : type;
}

function notifyMcp(ctx: McpNotifyContext, message: string, type?: McpNotifyType): void {
	ctx.ui.notify(message, normalizeMcpNotifyType(type));
}

export interface McpToolContentTruncationOptions extends TruncationOptions {
	tempFilePrefix?: string;
	tempFileName?: string;
}

export type McpToolContentTruncationResult = {
	content: McpContentBlock[];
	truncation?: TruncationResult;
	fullTextOutputPath?: string;
};

function formatMcpTruncationLimit(truncation: TruncationResult): string {
	return truncation.truncatedBy === "lines"
		? `${truncation.maxLines} line limit`
		: truncation.truncatedBy === "bytes"
			? `${formatSize(truncation.maxBytes)} byte limit`
			: "configured limit";
}

function formatMcpTruncationMarker(truncation: TruncationResult, fullTextOutputPath: string): string {
	const limit = formatMcpTruncationLimit(truncation);
	return `[MCP text output truncated by ${limit}: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full text output saved to: ${fullTextOutputPath}]`;
}

async function writeMcpTextOutputToTempFile(output: string, options: McpToolContentTruncationOptions): Promise<string> {
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), options.tempFilePrefix ?? "pi-mcp-"));
	const tempFile = path.join(tempDir, options.tempFileName ?? "text-output.txt");
	await withFileMutationQueue(tempFile, async () => {
		await fs.writeFile(tempFile, output, { encoding: "utf8", mode: 0o600 });
	});
	return tempFile;
}

export async function truncateMcpToolContent(content: McpContentBlock[], options: McpToolContentTruncationOptions = {}): Promise<McpToolContentTruncationResult> {
	const textBlocks = content.filter((block): block is McpTextContentBlock => block.type === "text");
	if (textBlocks.length === 0) return { content };

	const combinedText = textBlocks.map((block) => block.text).join("\n");
	const truncation = truncateHead(combinedText, {
		maxLines: options.maxLines ?? DEFAULT_MAX_LINES,
		maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
	});
	if (!truncation.truncated) return { content };

	const fullTextOutputPath = await writeMcpTextOutputToTempFile(combinedText, options);

	// Only text blocks are truncated. Image blocks stay unchanged so existing image handling is preserved.
	const truncatedContent: McpContentBlock[] = [];
	let consumedCharacters = 0;
	let textBlockIndex = 0;
	for (const block of content) {
		if (block.type === "image") {
			truncatedContent.push(block);
			continue;
		}

		const segment = `${textBlockIndex > 0 ? "\n" : ""}${block.text}`;
		const keptSegment = truncation.content.slice(
			consumedCharacters,
			Math.min(consumedCharacters + segment.length, truncation.content.length),
		);
		const keptText = textBlockIndex > 0 && keptSegment.startsWith("\n") ? keptSegment.slice(1) : keptSegment;
		if (keptText.length > 0) {
			truncatedContent.push({ type: "text", text: keptText });
		}
		consumedCharacters += segment.length;
		textBlockIndex++;
	}

	truncatedContent.push({ type: "text", text: formatMcpTruncationMarker(truncation, fullTextOutputPath) });
	return { content: truncatedContent, truncation, fullTextOutputPath };
}

function getMcpTextOutput(
	content: McpContentBlock[],
	showImages: boolean,
): string {
	return content
		.flatMap((block) => {
			if (block.type === "text") return [block.text];
			return showImages ? [] : [`[${block.mimeType} image]`];
		})
		.join("\n");
}

export async function formatMcpToolErrorMessage(content: McpContentBlock[], options: McpToolContentTruncationOptions = {}): Promise<string> {
	const truncated = await truncateMcpToolContent(content, options);
	return getMcpTextOutput(truncated.content, false);
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

function compareMcpToolNames(left: McpTool, right: McpTool): number {
	return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function sourceInfoIdentity(sourceInfo: PiToolSourceInfo): string {
	return JSON.stringify([
		sourceInfo.path,
		sourceInfo.source,
		sourceInfo.scope,
		sourceInfo.origin,
		sourceInfo.baseDir ?? null,
	]);
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

function formatMcpContent(content: unknown): McpContentBlock[] {
	if (!Array.isArray(content)) {
		return [{ type: "text", text: JSON.stringify(content, null, 2) }];
	}

	const result: McpContentBlock[] = [];
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

async function closeResources(client?: Client, transport?: StreamableHTTPClientTransport): Promise<void> {
	// Client.close normally closes its transport, but also close the transport directly so a
	// partially connected candidate cannot leak if the client cleanup itself fails.
	await Promise.allSettled([client?.close(), transport?.close()]);
}

async function closeConnection(state: ConnectionState): Promise<void> {
	const { client, transport } = state;
	state.client = undefined;
	state.transport = undefined;
	state.connected = false;
	state.serverName = undefined;
	await closeResources(client, transport);
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

type McpFooterConnectorStatus = { name: string; displayName: string; enabled: boolean };
const ACTIVE_MCP_STATUS_COLOR: McpStatusColor = "accent";
const INACTIVE_MCP_STATUS_COLOR: McpStatusColor = "dim";

function statusDisplayName(connector: { name: string; displayName: string }): string {
	const name = connector.displayName.trim().replace(/\s+MCP$/i, "").trim();
	return (name || connector.name).toLowerCase();
}

export function formatMcpFooterStatus(connectors: readonly McpFooterConnectorStatus[], theme: McpStatusTheme): string {
	if (connectors.length === 0) return theme.fg(INACTIVE_MCP_STATUS_COLOR, `mcp: none${FOOTER_STATUS_DELIMITER}`);

	const labelColor = connectors.some((connector) => connector.enabled) ? ACTIVE_MCP_STATUS_COLOR : INACTIVE_MCP_STATUS_COLOR;
	let text = theme.fg(labelColor, "mcp: ");
	for (const [index, connector] of connectors.entries()) {
		if (index > 0) {
			text += theme.fg(INACTIVE_MCP_STATUS_COLOR, ENABLED_MCP_SEPARATOR);
		}
		text += theme.fg(connector.enabled ? ACTIVE_MCP_STATUS_COLOR : INACTIVE_MCP_STATUS_COLOR, statusDisplayName(connector));
	}

	return text + theme.fg(INACTIVE_MCP_STATUS_COLOR, FOOTER_STATUS_DELIMITER);
}

function updateMcpStatus(manager: McpManager, ctx: McpStatusContext): void {
	clearLegacyFooterStatus(ctx, "mcp");
	const connectors = connectorNames(manager).map((name) => {
		const connector = manager.connectors.get(name)!;
		return { name: connector.name, displayName: connector.displayName, enabled: connector.state.enabled };
	});
	ctx.ui.setStatus(MCP_STATUS_KEY, formatMcpFooterStatus(connectors, ctx.ui.theme));
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
				notifyMcp(ctx, `${parsed.error}\nUsage: /${manager.commandName} [status|tools|enable|disable|reload] [connector]\nKnown connectors: ${knownConnectorText(manager)}`, "error");
				return;
			}

			if (parsed.command === "status" && !parsed.connectorName) {
				const lines = connectorNames(manager).map((name) => manager.connectors.get(name)!.statusLine());
				notifyMcp(ctx, lines.length > 0 ? lines.join("\n") : "No MCP connectors registered.", lines.length > 0 ? "info" : "warning");
				return;
			}

			if (!parsed.connectorName && TARGET_REQUIRED_COMMANDS.has(parsed.command)) {
				notifyMcp(ctx, `Missing connector name. Usage: /${manager.commandName} ${parsed.command} <connector>\nKnown connectors: ${knownConnectorText(manager)}`, "error");
				return;
			}

			const connector = parsed.connectorName ? manager.connectors.get(parsed.connectorName) : undefined;
			if (!connector) {
				notifyMcp(ctx, `Unknown MCP connector: ${parsed.connectorName ?? "(missing)"}\nKnown connectors: ${knownConnectorText(manager)}`, "error");
				return;
			}

			if (parsed.command === "status") {
				notifyMcp(ctx, connector.statusLine(), connector.state.enabled && connector.state.connected ? "info" : "warning");
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
				notifyMcp(ctx, `${parsed.error}\nUsage: /${toggleCommandName} [on|off]`, "error");
				return;
			}

			if (!parsed.command) {
				notifyMcp(ctx, runtime.statusLine(), runtime.state.enabled && runtime.state.connected ? "info" : "warning");
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

	let initialConfig: McpConfig | undefined;
	let initialConfigError: string | undefined;
	try {
		initialConfig = readConfig();
	} catch (error) {
		initialConfigError = errorMessage(error);
	}
	const state: ConnectionState = {
		connected: false,
		// Invalid startup config must not prevent the runtime and disable command from loading.
		enabled: initialConfig ? resolveDefaultEnabled(options, initialConfig) : false,
		lastError: initialConfigError,
		toolByPiName: new Map(),
		ownershipByOriginal: new Map(),
		ownershipByPiName: new Map(),
	};

	const canonicalTool = (name: string): PiToolInfo | undefined => pi.getAllTools().find((tool) => tool.name === name);
	const ownershipIsCanonical = (ownership: McpToolOwnership): boolean => {
		const canonical = canonicalTool(ownership.piName);
		return canonical !== undefined && sourceInfoIdentity(canonical.sourceInfo) === ownership.sourceInfoIdentity;
	};
	const canonicalHistoricalNames = (): Set<string> => new Set(
		[...state.ownershipByPiName.values()]
			.filter(ownershipIsCanonical)
			.map((ownership) => ownership.piName),
	);
	const canonicalCurrentNames = (): string[] => [...state.toolByPiName.entries()]
		.filter(([piName, tool]) => {
			const ownership = state.ownershipByPiName.get(piName);
			return ownership?.originalName === tool.name && ownershipIsCanonical(ownership);
		})
		.map(([piName]) => piName);

	const activateTools = () => {
		// Pi's allowlist mode can reactivate every registered allowlisted definition whenever
		// registerTool refreshes the host registry. Reconcile the full historical ownership set,
		// then add back only the canonically verified names in the committed current catalogue.
		const historicalNames = canonicalHistoricalNames();
		const unrelatedActiveNames = pi.getActiveTools().filter((name) => !historicalNames.has(name));
		pi.setActiveTools([...new Set([...unrelatedActiveNames, ...canonicalCurrentNames()])]);
	};

	const deactivateTools = () => {
		const historicalNames = canonicalHistoricalNames();
		pi.setActiveTools(pi.getActiveTools().filter((name) => !historicalNames.has(name)));
	};

	let coordinationGeneration = 0;
	const setEnabled = (enabled: boolean, persist: boolean): string | undefined => {
		// Local state changes first so persistence failures cannot leave a connector enabled.
		// Teardown invalidates the current generation and aborts its candidate separately so the
		// candidate generation and the resource being closed always stay paired.
		state.enabled = enabled;
		if (!persist) return undefined;
		try {
			if (enabledScope === "global") {
				writeEnabled(enabled);
			} else {
				persistSessionEnabledState(pi, connectorName, enabled);
			}
			return undefined;
		} catch (error) {
			return errorMessage(error);
		}
	};

	const disconnectCommittedCatalogue = async () => {
		deactivateTools();
		state.toolByPiName = new Map();
		await closeConnection(state);
	};

	let operationTail: Promise<void> = Promise.resolve();
	const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
		const result = operationTail.then(operation, operation);
		operationTail = result.then(() => undefined, () => undefined);
		return result;
	};
	let rebuildFlight: Promise<CatalogueRebuildResult> | undefined;
	let rebuildFlightGeneration: number | undefined;
	let candidateConnection: CandidateConnection | undefined;
	let shuttingDown = false;
	let connectAndRegister!: () => Promise<CatalogueRebuildResult>;

	const closeCandidateConnection = (generation: number): Promise<void> => {
		const candidate = candidateConnection;
		if (!candidate || candidate.generation !== generation) return Promise.resolve();
		// Start both close paths immediately. Keeping the promise on the generation-scoped
		// candidate makes repeated disable/shutdown/error cleanup idempotent and race-safe.
		candidate.closePromise ??= closeResources(candidate.client, candidate.transport);
		return candidate.closePromise;
	};

	const releaseCandidateConnection = (candidate: CandidateConnection): void => {
		if (candidateConnection === candidate) candidateConnection = undefined;
	};

	const registerCandidateTool = (tool: McpTool, piName: string) => {
		pi.registerTool({
			name: piName,
			label: tool.annotations?.title ?? tool.title ?? tool.name,
			description: `${tool.description ?? `${displayName} tool.`}\n\nOriginal MCP tool name: ${tool.name}\nText output returned to the model is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}. When truncated, the full MCP text output is saved to a temp file path reported in the tool output/details; raw MCP results remain in tool details.rawResult. Image content is passed through unchanged.`,
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
					const rebuild = await connectAndRegister();
					if (rebuild.status !== "committed" || rebuild.generation !== coordinationGeneration) {
						throw new Error(`${displayName} connection attempt was superseded.`);
					}
				}
				if (!state.enabled) {
					throw new Error(`${displayName} connector is disabled. Run ${enableCommandText} to enable it.`);
				}
				const activeTool = state.toolByPiName.get(piName);
				if (!activeTool || !state.client) {
					throw new Error(`${displayName} tool is not available: ${tool.name}`);
				}
				if (activeTool.name !== tool.name) {
					throw new Error(`${displayName} tool ownership invariant failed for ${piName}: expected ${tool.name}, found ${activeTool.name}`);
				}
				const result = await state.client.callTool(
					{ name: activeTool.name, arguments: params as Record<string, unknown> },
					undefined,
					{ signal, timeout: toolCallTimeoutMs },
				);
				const content = formatMcpContent("content" in result ? result.content : result);
				if ("isError" in result && result.isError) {
					throw new Error(await formatMcpToolErrorMessage(content));
				}
				const truncated = await truncateMcpToolContent(content);
				return {
					content: truncated.content,
					details: {
						mcpConnector: connectorName,
						mcpServer: state.serverName,
						mcpTool: activeTool.name,
						piTool: piName,
						structuredContent: "structuredContent" in result ? result.structuredContent : undefined,
						rawResult: result,
						...(truncated.truncation
							? {
								truncation: truncated.truncation,
								fullTextOutputPath: truncated.fullTextOutputPath,
							}
							: {}),
					},
				};
			},
		});
	};

	const supersededRebuild = (generation: number): CatalogueRebuildResult => ({
		generation,
		status: "superseded",
		toolCount: 0,
	});

	const performCatalogueRebuild = async (generation: number): Promise<CatalogueRebuildResult> => {
		if (generation !== coordinationGeneration) return supersededRebuild(generation);
		await disconnectCommittedCatalogue();
		if (generation !== coordinationGeneration || !state.enabled || shuttingDown) return supersededRebuild(generation);

		let candidate: CandidateConnection | undefined;
		try {
			const config = readConfig();
			if (generation !== coordinationGeneration || !state.enabled || shuttingDown) return supersededRebuild(generation);

			const transport = new StreamableHTTPClientTransport(new URL(config.url), {
				requestInit: { headers: config.headers ?? {} },
			});
			const client = new Client({ name: clientName, version: clientVersion });
			candidate = { generation, client, transport };
			candidateConnection = candidate;
			await client.connect(transport);
			if (generation !== coordinationGeneration || !state.enabled || shuttingDown) {
				await closeCandidateConnection(generation);
				releaseCandidateConnection(candidate);
				return supersededRebuild(generation);
			}

			const tools = await listAllTools(client);
			if (generation !== coordinationGeneration || !state.enabled || shuttingDown) {
				await closeCandidateConnection(generation);
				releaseCandidateConnection(candidate);
				return supersededRebuild(generation);
			}
			tools.sort(compareMcpToolNames);

			const usedNames = new Set([
				...pi.getAllTools().map((tool) => tool.name),
				...state.ownershipByPiName.keys(),
			]);
			const retained = new Map<string, McpToolOwnership>();
			const unavailableOriginalNames = new Set<string>();
			for (const tool of tools) {
				const ownership = state.ownershipByOriginal.get(tool.name);
				if (!ownership || ownership.originalName !== tool.name) continue;
				const canonical = canonicalTool(ownership.piName);
				if (!canonical) {
					// getAllTools() omits allowlist/exclude-list filtered names. Do not evade host
					// policy by manufacturing a suffix for a historical name hidden by Pi.
					unavailableOriginalNames.add(tool.name);
				} else if (sourceInfoIdentity(canonical.sourceInfo) === ownership.sourceInfoIdentity) {
					retained.set(tool.name, ownership);
				}
			}

			const candidateCatalogue = new Map<string, McpTool>();
			const register = (tool: McpTool, retainedOwnership?: McpToolOwnership): boolean => {
				const piName = retainedOwnership?.piName ?? makePiToolName(tool.name, usedNames, options.toolPrefix);
				if (!retainedOwnership && canonicalTool(piName)) return false;
				registerCandidateTool(tool, piName);
				const canonical = canonicalTool(piName);
				if (!canonical) {
					// Registration may be filtered by Pi's active tool policy (for example
					// --no-tools or --exclude-tools). Without canonical provenance, neither own
					// nor activate the name, and never retry with a policy-bypassing suffix.
					return false;
				}
				const canonicalIdentity = sourceInfoIdentity(canonical.sourceInfo);
				if (retainedOwnership && canonicalIdentity !== retainedOwnership.sourceInfoIdentity) return false;

				const knownConnectorIdentity = [...state.ownershipByPiName.values()]
					.find(ownershipIsCanonical)?.sourceInfoIdentity;
				if (!retainedOwnership && knownConnectorIdentity && canonicalIdentity !== knownConnectorIdentity) return false;

				const ownership: McpToolOwnership = {
					originalName: tool.name,
					piName,
					sourceInfoIdentity: canonicalIdentity,
				};
				state.ownershipByOriginal.set(tool.name, ownership);
				state.ownershipByPiName.set(piName, ownership);
				candidateCatalogue.set(piName, tool);
				// Dynamic refresh may activate every allowlisted historical connector definition.
				// Keep all connector-owned names hidden until the candidate catalogue commits.
				deactivateTools();
				return true;
			};

			const unretained: McpTool[] = [];
			for (const tool of tools) {
				if (unavailableOriginalNames.has(tool.name)) continue;
				const ownership = retained.get(tool.name);
				if (!ownership || !register(tool, ownership)) unretained.push(tool);
			}
			for (const tool of unretained) register(tool);

			if (generation !== coordinationGeneration || !state.enabled || shuttingDown) {
				deactivateTools();
				await closeCandidateConnection(generation);
				releaseCandidateConnection(candidate);
				return supersededRebuild(generation);
			}

			const server = candidate.client.getServerVersion();
			state.client = candidate.client;
			state.transport = candidate.transport;
			state.connected = true;
			state.serverName = server ? `${server.name} ${server.version}` : config.url;
			state.toolByPiName = candidateCatalogue;
			activateTools();
			state.lastError = undefined;
			releaseCandidateConnection(candidate);
			return { generation, status: "committed", toolCount: candidateCatalogue.size };
		} catch (error) {
			if (candidate) {
				await closeCandidateConnection(candidate.generation);
				releaseCandidateConnection(candidate);
			}
			state.client = undefined;
			state.transport = undefined;
			state.connected = false;
			state.serverName = undefined;
			state.toolByPiName = new Map();
			deactivateTools();
			if (generation !== coordinationGeneration || !state.enabled || shuttingDown) {
				return supersededRebuild(generation);
			}
			state.lastError = errorMessage(error);
			throw new CatalogueRebuildError(generation, error);
		}
	};

	connectAndRegister = () => {
		if (rebuildFlight) {
			const flight = rebuildFlight;
			const generation = rebuildFlightGeneration!;
			// Callers already awaiting the current generation receive that generation's own
			// outcome. Only a caller arriving after teardown invalidated the old flight (for
			// example, a later enable) chains a fresh rebuild behind it.
			if (generation === coordinationGeneration || !state.enabled || shuttingDown) return flight;
			return flight.then(connectAndRegister, connectAndRegister);
		}
		const generation = ++coordinationGeneration;
		const flight = serialize(() => performCatalogueRebuild(generation));
		rebuildFlight = flight;
		rebuildFlightGeneration = generation;
		const clearFlight = () => {
			if (rebuildFlight === flight) {
				rebuildFlight = undefined;
				rebuildFlightGeneration = undefined;
			}
		};
		void flight.then(clearFlight, clearFlight);
		return flight;
	};

	const disconnectAndClearCatalogue = () => {
		const invalidatedGeneration = coordinationGeneration;
		const generation = ++coordinationGeneration;
		// Closing starts now, before this teardown waits behind the serialized rebuild. A pending
		// connect/tools-list request therefore aborts promptly instead of holding disable/shutdown.
		const candidateClose = closeCandidateConnection(invalidatedGeneration);
		return serialize(async () => {
			await candidateClose;
			if (generation === coordinationGeneration) await disconnectCommittedCatalogue();
		});
	};
	const close = async () => {
		shuttingDown = true;
		await disconnectAndClearCatalogue();
	};

	const syncEnabledState = async (ctx?: McpSessionStateContext) => {
		try {
			const enabled =
				enabledScope === "session"
					? (ctx ? getSessionEnabledState(ctx, connectorName) ?? resolveDefaultEnabled(options) : resolveDefaultEnabled(options))
					: resolveDefaultEnabled(options, readConfig());
			setEnabled(enabled, false);

			if (!state.enabled) {
				await disconnectAndClearCatalogue();
				return;
			}

			if (state.connected) {
				activateTools();
				return;
			}

			await connectAndRegister();
		} catch (error) {
			state.lastError = errorMessage(error);
			await disconnectAndClearCatalogue();
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
		close,
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
			notifyMcp(ctx, lines.length ? lines.join("\n") : `No ${displayName} tools registered. Use ${enableCommandText} or ${reloadCommandText}.`, "info");
		},
		enable: async (ctx) => {
			const persistenceError = setEnabled(true, true);
			try {
				const result = await connectAndRegister();
				runtime.setStatus(ctx);
				if (result.status === "committed" && result.generation === coordinationGeneration && state.enabled && state.connected) {
					notifyMcp(ctx, `${displayName} enabled and connected (${result.toolCount} tools).`, "info");
				} else {
					notifyMcp(ctx, `${displayName} enable was superseded before the connection completed.`, "warning");
				}
			} catch (error) {
				const isCurrentFailure = !(error instanceof CatalogueRebuildError) || error.generation === coordinationGeneration;
				if (isCurrentFailure && state.enabled && !shuttingDown) {
					state.lastError = errorMessage(error);
					runtime.setStatus(ctx);
					notifyMcp(ctx, `${displayName} enabled, but connection failed: ${state.lastError}`, "error");
				} else {
					runtime.setStatus(ctx);
					notifyMcp(ctx, `${displayName} enable was superseded before the connection completed.`, "warning");
				}
			}
			if (persistenceError) {
				const localOutcome = state.enabled ? "is enabled locally" : "enable was superseded locally";
				notifyMcp(ctx, `${displayName} ${localOutcome}, but unable to persist config: ${persistenceError}`, "error");
			}
		},
		disable: async (ctx) => {
			const persistenceError = setEnabled(false, true);
			await disconnectAndClearCatalogue();
			runtime.setStatus(ctx);
			notifyMcp(ctx, `${displayName} disabled. Run ${enableCommandText} to re-enable it.`, "info");
			if (persistenceError) {
				notifyMcp(ctx, `${displayName} is disabled locally, but unable to persist config: ${persistenceError}`, "error");
			}
		},
		reload: async (ctx) => {
			if (!state.enabled) {
				runtime.setStatus(ctx);
				notifyMcp(ctx, `${displayName} is disabled. Run ${enableCommandText} to connect it.`, "warning");
				return;
			}
			try {
				const result = await connectAndRegister();
				runtime.setStatus(ctx);
				if (result.status === "committed" && result.generation === coordinationGeneration && state.enabled && state.connected) {
					notifyMcp(ctx, `${displayName} reloaded (${result.toolCount} tools).`, "info");
				} else {
					notifyMcp(ctx, `${displayName} reload was superseded before the connection completed.`, "warning");
				}
			} catch (error) {
				const isCurrentFailure = !(error instanceof CatalogueRebuildError) || error.generation === coordinationGeneration;
				if (isCurrentFailure && state.enabled && !shuttingDown) {
					state.lastError = errorMessage(error);
					runtime.setStatus(ctx);
					notifyMcp(ctx, `${displayName} connection failed: ${state.lastError}`, "error");
				} else {
					runtime.setStatus(ctx);
					notifyMcp(ctx, `${displayName} reload was superseded before the connection completed.`, "warning");
				}
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
