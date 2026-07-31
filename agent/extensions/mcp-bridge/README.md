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
- `mcpConnector.test.ts` - focused regression tests for notification normalization, lifecycle/reconciliation behavior, and MCP text-output truncation.

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
- A malformed config at extension load leaves the runtime loaded but locally disabled, so management commands and shutdown cleanup remain available.
- Enable/disable changes local runtime state before persistence. If a global config is malformed or unwritable, the connector reports the persistence error; disable still deactivates its canonically owned tools and closes its connection.

Runtime state tracks the active MCP `Client`, HTTP transport, connected/enabled flags, last error, server name, the current MCP catalogue by generated Pi name, and persistent original-name/generated-name ownership records. Every ownership record includes the canonical Pi `sourceInfo` identity observed after registration. Historical records are retained because Pi has no tool-unregistration API.

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
- Enable/reload success is reported only when that command's awaited generation commits and remains the connector's enabled, connected final state. A teardown-superseded generation reports a warning instead and cannot inherit a later enable's success; a connected empty catalogue remains a successful `(0 tools)` result.

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

On connect/reload, the bridge deactivates only historical names whose current canonical `getAllTools().sourceInfo` still matches the recorded connector ownership. It clears the committed catalogue and closes the old connection before fallible discovery. The replacement client, transport, and catalogue remain candidate-local until a successful commit; candidate tools are kept inactive until that commit.

All catalogue rebuild entry points—enable, reload, session sync, and disconnected tool execution—use one serialized, single-flight coordinator. Concurrent retained-tool executions share one candidate connection and rebuild. The current candidate client/transport is tracked by connector generation while connect or discovery is pending. Disable/shutdown invalidates that generation and immediately closes its matching candidate before queued final-state cleanup, so a pending request is aborted promptly; cleanup remains serialized and idempotent. A later enable is rebuilt after stale teardown instead of being cleared by it.

Pi cannot unregister tool definitions, so names removed from a later catalogue can remain in Pi's internal registry/`getAllTools()` result. They are not active or model-exposed. An empty replacement catalogue is a valid connected/synchronized state, so later session navigation does not rediscover it. If config reading, connection, or discovery fails during a reload—or if tool registration throws—candidate resources are closed and state is disconnected with an empty current catalogue. An individual tool rejected by host policy or canonical-provenance validation is omitted instead; a remaining partial or empty candidate catalogue can still commit as connected. Unrelated or lost-provenance canonical tools are never deactivated.

For each MCP tool it registers a Pi tool:

- Pi tool names are lowercase, use the connector `toolPrefix`, replace unsupported characters with `_`, are capped at 64 characters, and are deduplicated with numeric suffixes.
- Stable, canonically owned mappings are allocated first. New originals are sorted before collision allocation, so two originals that sanitize to one base keep deterministic names even if server order changes.
- Existing unrelated canonical names, historical names with lost provenance, and other reserved names force a numeric suffix. Registration is recorded and activated only when canonical `sourceInfo` verifies ownership.
- Names omitted from `getAllTools()` by Pi allow/exclude policy are not owned and are not retried under a suffix, preventing policy bypass.
- Labels prefer MCP annotation title, then tool title, then original tool name.
- Descriptions include the original MCP tool name and the standard text-output truncation policy.
- Input schemas are passed through as object schemas via `Type.Unsafe`, with a permissive object fallback.
- Prompt snippets mention the connector display name and original MCP tool.

Execution behavior:

- Disabled connectors throw with guidance to run the enable command.
- Disconnected enabled connectors attempt the shared single-flight rebuild before executing. A successful reconnect centrally activates every canonically owned name in the replacement catalogue, including names that Pi had registered previously and would not auto-reactivate.
- Each wrapper is permanently tied to its original MCP name. Before dispatch, execution checks that the current catalogue entry still has that exact original name; an ownership mismatch fails instead of calling a different MCP tool.
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

If a session-scoped connector is disabled during sync, canonically owned tools are deactivated and the MCP connection is closed. Connected empty catalogues remain synchronized. Reload reconciliation and lifecycle teardown use the same serialized coordinator, so failed or invalidated candidates cannot overwrite or leak past another committed state.

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

Run commands from `agent/extensions`:

```bash
node --test mcp-bridge/mcpConnector.test.ts
npm test
npm run typecheck
```

Testing notes:

- Focused tests cover notification normalization, source-aware first-registration-wins reconciliation, stable collision mappings and call targets, provenance loss, host-filtered names, serialized reconnect/teardown races, prompt abort of non-responsive discovery during disable/shutdown, superseded command notifications, successful empty catalogues, malformed-config disable, text truncation, temp-file markers, image preservation, and error formatting.
- Loopback and truncation tests create temporary resources and remove them deterministically.
- Add narrow regression tests before changing command parsing, enabled-state persistence, tool-name generation, MCP content normalization, or truncation behavior.
- Docs-only changes do not require tests.
