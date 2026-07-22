# MCP bridge internals

Shared developer-facing helper for extension-owned MCP connectors. This folder is not a standalone user-facing extension; it provides the connector runtime used by extensions such as `idea-mcp`.

## What it provides

- Creates a Streamable HTTP MCP client and discovers MCP server tools.
- Registers discovered MCP tools as Pi tools with a connector-specific prefix.
- Owns shared `/mcp` management commands for all registered connectors.
- Optionally registers a connector-specific toggle command such as `/idea-mcp`.
- Tracks enabled/connected state, footer status, and lifecycle cleanup.
- Normalizes MCP content, truncates large text output, and preserves image blocks.

Only `streamable-http` transports are supported today.

## Current consumer: `idea-mcp`

`agent/extensions/idea-mcp/index.ts` imports the bridge and passes connector metadata:

```ts
import { createMcpConnector } from "../mcp-bridge/mcpConnector.js";

await createMcpConnector(pi, {
	connectorName: "idea",
	extensionName: "idea-mcp",
	displayName: "IDEA MCP",
	toggleCommandName: "idea-mcp",
	toolPrefix: "idea_",
	configUrl: new URL("./config.json", import.meta.url),
	clientName: "pi-idea-mcp",
	clientVersion: "1.0.0",
	envPrefix: "PI_IDEA_MCP",
});
```

The bridge supplies the shared MCP behavior; `idea-mcp` owns its config file and user-facing README.

## Files

- `mcpConnector.ts` - connector factory, shared command manager, runtime state, MCP tool wrapping, content formatting, and truncation helpers.
- `mcpConnector.test.ts` - focused regression tests for notification normalization and MCP text-output truncation behavior.

Related local dependency:

- `../shared/footerStatus.ts` (`agent/extensions/shared/footerStatus.ts`) - shared footer-key order and legacy status cleanup used by the aggregate MCP footer indicator.

## Public API and exports

Primary entry point:

- `createMcpConnector(pi, options)` - registers one connector runtime, shared `/mcp` command handling, optional toggle command, and lifecycle hooks.

Important option fields:

- `connectorName` - short id for `/mcp` commands, for example `idea`. Defaults to `extensionName` without a trailing `-mcp`, normalized to lowercase command-safe text.
- `extensionName` - stable extension id used in status cleanup and default metadata.
- `displayName` - human-readable name used in notifications and prompt snippets.
- `commandName` - shared manager command name. Defaults to `mcp`; all bridge connectors in one Pi runtime must use the same value.
- `toggleCommandName` - optional dedicated command without `/`, for example `idea-mcp`.
- `toolPrefix` - required unique prefix for generated Pi tool names, for example `idea_`.
- `configUrl` - URL for the connector-owned JSON config file.
- `clientName` / `clientVersion` - metadata passed to the MCP client.
- `envPrefix` - optional prefix for `${PREFIX}_URL` and `${PREFIX}_HEADERS` environment overrides.
- `toolCallTimeoutMs` - per-tool call timeout; defaults to `120000`.
- `enabledScope` - `session` by default, or `global` to persist enable/disable into the config file.
- `defaultEnabled` - explicit default when no persisted state exists.

Exported helper types and functions:

- `McpConfig` - connector config shape: `type`, `url`, optional `headers`, optional `enabled`.
- `McpConnectorOptions` - options accepted by `createMcpConnector`.
- `McpTextContentBlock`, `McpImageContentBlock`, `McpContentBlock` - normalized Pi-facing MCP content blocks.
- `McpNotifyType` and `normalizeMcpNotifyType()` - maps bridge-level `success` notifications to Pi-supported `info` notifications.
- `McpToolContentTruncationOptions`, `McpToolContentTruncationResult`, and `truncateMcpToolContent()` - truncates combined text blocks and writes full text to a temp file when needed.
- `formatMcpToolErrorMessage()` - formats MCP error content as a thrown error message, including truncation markers when needed.

Most other symbols in `mcpConnector.ts` are internal implementation details.

## Configuration and enabled state

Connector-owned config files use this shape:

```json
{
  "type": "streamable-http",
  "url": "http://127.0.0.1:64342/stream",
  "headers": {},
  "enabled": false
}
```

Behavior:

- `type` must be `streamable-http`; other values throw during config read.
- `url` is passed to `StreamableHTTPClientTransport`.
- `headers` are sent through `requestInit.headers`.
- If `envPrefix` is set, `${PREFIX}_URL` overrides `url` and `${PREFIX}_HEADERS` is parsed as JSON and overrides `headers`.
- `enabledScope: "session"` stores explicit enable/disable changes as custom session entries with type `mcp-connector-state`; branch navigation replays the latest value for that connector.
- Session-scoped connectors default to disabled unless `defaultEnabled` is set.
- `enabledScope: "global"` writes the `enabled` field back to the connector config file on enable/disable.
- Global-scoped connectors default to `config.enabled !== false` unless `defaultEnabled` is set.

Runtime state tracks the active MCP `Client`, HTTP transport, connected/enabled flags, last error, server name, MCP tools by generated Pi name, and currently registered Pi tool names.

## Commands and status

The bridge keeps one `McpManager` per `ExtensionAPI` instance. Each connector registers itself with that manager.

Shared command:

```text
/mcp [status|tools|enable|disable|reload] [connector]
```

Behavior:

- `/mcp` and `/mcp status` list all registered connectors.
- `/mcp status <connector>` shows one connector status line.
- `/mcp tools <connector>` lists generated Pi tool names and original MCP tool names.
- `/mcp enable <connector>` enables, connects, discovers tools, activates them, and persists state according to `enabledScope`.
- `/mcp disable <connector>` disables, deactivates tools, and closes the connection.
- `/mcp reload <connector>` reconnects and rediscovers tools when enabled.

Optional toggle command:

```text
/<toggleCommandName> [on|off]
```

With no argument it reports the connector status. `on` delegates to enable behavior; `off` delegates to disable behavior. Commands provide argument completions for actions and known connector names.

Footer status uses the shared `mcp` footer key from `../shared/footerStatus.ts` (`agent/extensions/shared/footerStatus.ts`):

- `mcp: none` appears dim when no connectors are registered.
- `mcp: <name>` appears when one or more connectors are registered; multiple connectors are ordered by connector id/key and the rendered display names are separated with `, `.
- Connector names are dim when disabled.
- Connector names are accent-colored whenever enabled, including enabled-but-disconnected or connection-failed states.
- The compact MCP segment ends with `•`, separating it from the rightmost response timer status.

Detailed connection errors, connection state, and tool counts are intentionally kept in command notifications/status lines, not the compact footer.

## Tool wrapping behavior

On connect/reload, the bridge closes any existing connection, clears registered tool state, connects a new MCP client, and pages through `client.listTools()` until no cursor remains.

For each MCP tool it registers a Pi tool:

- Pi tool names are lowercase, use the connector `toolPrefix`, replace unsupported characters with `_`, are capped at 64 characters, and are deduplicated with numeric suffixes.
- Labels prefer MCP annotation title, then tool title, then original tool name.
- Descriptions include the original MCP tool name and the standard text-output truncation policy.
- Input schemas are passed through as object schemas via `Type.Unsafe`, with a permissive object fallback.
- Prompt snippets mention the connector display name and original MCP tool.

Execution behavior:

- Disabled connectors throw with guidance to run the enable command.
- Disconnected enabled connectors attempt to reconnect before executing.
- Calls use `client.callTool({ name, arguments }, ..., { signal, timeout })`.
- MCP `isError` results are thrown as Pi tool errors after formatting/truncating error content.
- Successful results return normalized content and details containing connector id, server name, original MCP tool, Pi tool, structured content when present, raw MCP result, and truncation metadata when present.

Content normalization:

- `text` blocks become Pi text blocks.
- `image` blocks with `data` and `mimeType` are preserved.
- `resource` blocks become text summaries, including resource text when available.
- `resource_link` blocks become text link summaries.
- Unknown or non-array content is stringified as text.
- Empty result arrays become `(empty MCP result)`.

Rendering behavior:

- Visible tool output joins text blocks with newlines.
- Image blocks are shown as `[mime image]` placeholders when images are not being displayed.
- If the `hide-tool-output` extension state is enabled, MCP tool output rendering is suppressed in the conversation UI while the tool result still reaches the model.

## Truncation behavior

`truncateMcpToolContent()` combines all text blocks with newlines and applies Pi's standard limits by default:

- `DEFAULT_MAX_LINES`
- `DEFAULT_MAX_BYTES`

If text is too large:

- the full combined text is written to a `0600` temp file under a `pi-mcp-*` temp directory;
- only text blocks are truncated;
- image blocks are preserved unchanged;
- a final text marker reports the truncation limit, shown/total lines and bytes, and temp file path;
- returned tool details include `truncation` and `fullTextOutputPath`.

`formatMcpToolErrorMessage()` uses the same truncation helper for error paths and represents images as `[mime image]` placeholders in the thrown message.

## Lifecycle hooks

`createMcpConnector()` registers these hooks:

- `session_start` - sync enabled state, connect/discover tools when enabled, activate tools, and refresh footer status.
- `session_tree` - resync session-scoped enable state after branch navigation and refresh footer status.
- `session_shutdown` - unregister this runtime from the shared manager and close the MCP connection.

If a session-scoped connector is disabled during sync, tools are deactivated and the MCP connection is closed.

## Adding another connector

For a new MCP-backed extension:

1. Create a dedicated extension folder, for example `agent/extensions/<name>-mcp/`.
2. Add that extension's `index.ts`, `config.json`, and user-facing `README.md` there.
3. Import `createMcpConnector` from `../mcp-bridge/mcpConnector.js`.
4. Choose a unique `connectorName` and `toolPrefix`.
5. Use the default shared `commandName: "mcp"` unless there is a strong reason not to; all bridge connectors loaded together must agree on this name.
6. Prefer session-scoped enablement for local or optional MCP servers, so sessions do not auto-connect unexpectedly.
7. Add or update focused bridge tests if the shared behavior changes.

Do not put connector-specific user docs in `mcp-bridge`; keep this folder as shared internal documentation and implementation.

## Maintenance and testing

### Known production audit findings

As of 2026-07-22, `npm audit --omit=dev` reports unresolved transitive findings through `@modelcontextprotocol/sdk@1.29.0`.

The findings are temporarily accepted for the current IDEA connector because:

- it imports only MCP client functionality;
- its endpoint is loopback-only and the connector is disabled by default;
- the MCP server is the trusted local IntelliJ IDEA process;
- the Hono, Node server, and body-parser findings affect unused server paths.

`fast-uri` is loaded by the client's AJV validator, so this acceptance must not be extended to remote or untrusted MCP servers.

Do not apply npm's suggested SDK downgrade or cross-major overrides without running the MCP bridge tests, typecheck, and a real client connection smoke test. Re-evaluate when the MCP SDK updates its dependency ranges or if connector usage expands beyond a trusted local server.

Upstream tracking: [modelcontextprotocol/typescript-sdk#2036](https://github.com/modelcontextprotocol/typescript-sdk/issues/2036).

Run commands from `agent/extensions`:

```bash
node --test mcp-bridge/mcpConnector.test.ts
npm test
npm run typecheck
```

Testing notes:

- Existing tests cover notification type normalization, text truncation, temp-file marker behavior, image preservation, and error-message formatting.
- Truncation tests create temp output directories and remove them after assertions.
- Add narrow regression tests before changing command parsing, enabled-state persistence, tool-name generation, MCP content normalization, or truncation behavior.
- Docs-only changes do not require tests.
