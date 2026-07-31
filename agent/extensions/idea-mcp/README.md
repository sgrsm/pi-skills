# IDEA MCP extension

Connects Pi to an IDEA-compatible MCP server over streamable HTTP and exposes the server's tools to the agent as Pi tools.

## When to use it

Use this extension when a local JetBrains IDE / IntelliJ IDEA MCP server is running and you want Pi to inspect or act through the IDE-provided MCP tools. The extension is disabled by default; enable it only for sessions where the IDE server is available.

Default endpoint:

```text
http://127.0.0.1:64342/stream
```

## Configuration

`config.json` contains the MCP transport settings:

```json
{
  "type": "streamable-http",
  "url": "http://127.0.0.1:64342/stream",
  "headers": {},
  "enabled": false
}
```

Notes:

- Only `streamable-http` is supported.
- `url` is the MCP stream endpoint.
- `headers` are sent with MCP requests.
- Normal on/off state is session-scoped; use the slash commands below rather than relying on `config.json` to auto-enable the connector.

Environment overrides:

```bash
PI_IDEA_MCP_URL="http://127.0.0.1:64342/stream" pi
PI_IDEA_MCP_HEADERS='{"Authorization":"Bearer token"}' pi
```

## Slash commands

Dedicated command:

- `/idea-mcp` - show IDEA MCP status
- `/idea-mcp on` - enable, connect, discover tools, and activate them
- `/idea-mcp off` - disable, deactivate tools, and close the connection

Shared MCP manager command:

- `/mcp` or `/mcp status` - show all registered MCP connectors
- `/mcp status idea` - show IDEA MCP status
- `/mcp tools idea` - list the currently available `idea_*` tool catalogue and its original MCP tool names
- `/mcp enable idea` - same as `/idea-mcp on`
- `/mcp disable idea` - same as `/idea-mcp off`
- `/mcp reload idea` - reconnect, reconcile the active tool catalogue, and rediscover tools

Examples:

```text
/idea-mcp on
/mcp tools idea
/mcp reload idea
/idea-mcp off
```

## Tools exposed to the agent

The extension does not define a fixed tool list. When enabled, it asks the MCP server for its tools and registers each one with an `idea_` prefix.

Example mapping format from `/mcp tools idea`:

```text
idea_<tool_name> -> <original_mcp_tool_name> - <description>
```

Tool names are sanitized to lowercase `idea_...` names and deduplicated if needed. Original MCP names keep stable generated names across reloads, including when multiple originals sanitize to the same base and the server reverses their order. Existing unrelated Pi tools and historical names whose canonical provenance no longer belongs to this connector reserve their names, so a collision receives a deterministic suffix instead of replacing or later deactivating that tool. Ownership is accepted only when Pi's canonical `sourceInfo` confirms this connector; host-policy-filtered names are not reintroduced under alternate suffixes. The original MCP tool name is preserved in tool details.

When `/mcp reload idea` replaces the server catalogue, only the newly discovered, canonically owned `idea_*` names are active. Names from an earlier catalogue are deactivated only while their canonical provenance still belongs to this connector; unrelated or replaced canonical tools remain untouched. Pi does not support unregistering tools, so obsolete `idea_*` definitions can remain in its internal tool registry but are not active or exposed to the model. An empty replacement leaves every prior IDEA tool inactive and remains synchronized across session navigation. A failed config read, reconnect, discovery, or thrown registration exception aborts the rebuild and leaves the connector disconnected with no current catalogue. Individual tools rejected by host policy or canonical-provenance checks are omitted instead; the remaining partial or empty catalogue can still commit as connected. Concurrent reconnecting tool calls share one catalogue rebuild, and each retained wrapper verifies its original MCP call target before dispatch.

Tool output behavior:

- text and image MCP content are passed through to Pi;
- text output is truncated at Pi's standard MCP bridge limits: 2000 lines or 50 KB;
- when text is truncated, the full text is saved to a temporary file and the path is included in the tool output/details;
- MCP tool errors are reported to the agent as failed tool results.

Enable, reload, session synchronization, and disconnected tool execution share one serialized rebuild. Disable/shutdown invalidates in-flight candidates, deactivates only canonically owned IDEA tools, and closes resources. A malformed IDEA config leaves the connector runtime loaded but locally disabled, so status/disable commands and shutdown cleanup remain available.

## Status indicator

The extension contributes to the shared footer MCP status:

- dim `mcp: idea` - connector is disabled
- accent `mcp: idea` - connector is enabled
- `mcp: none` - no MCP connectors are registered

The footer only shows enabled/disabled state. Use `/idea-mcp` or `/mcp status idea` for connection details:

```text
idea: disabled
idea: enabled, connected to <server> (<n> tools)
idea: enabled, disconnected: <last error>
```

## Events and flags

Internal session hooks:

- `session_start` - sync session-scoped enable state, connect if enabled, update status
- `session_tree` - resync enable state when navigating session branches, update status
- `session_shutdown` - close the MCP connection and unregister this connector runtime

No custom CLI flags or keyboard shortcuts are registered.
