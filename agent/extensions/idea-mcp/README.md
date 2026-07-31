# IDEA MCP extension

Connects Pi to an IDEA-compatible MCP server over streamable HTTP and makes the server's tools available to the agent. The connector is disabled by default; enable it only when the IDE MCP server is running.

## Configuration

`config.json` contains the transport settings:

```json
{
  "type": "streamable-http",
  "url": "http://127.0.0.1:64342/stream",
  "headers": {},
  "enabled": false
}
```

Only `streamable-http` is supported. The normal on/off setting is session-scoped, so use the commands below rather than changing `enabled` to auto-connect.

Override the endpoint or request headers for one Pi invocation:

```bash
PI_IDEA_MCP_URL="http://127.0.0.1:64342/stream" pi
PI_IDEA_MCP_HEADERS='{"Authorization":"Bearer token"}' pi
```

## Commands

- `/idea-mcp` — show IDEA MCP status.
- `/idea-mcp on` — enable, connect, discover, and activate IDEA tools.
- `/idea-mcp off` — disable, deactivate IDEA tools, and close the connection.
- `/mcp status idea` — show IDEA MCP status through the shared MCP command.
- `/mcp tools idea` — list the currently available `idea_*` tools and their server names.
- `/mcp reload idea` — reconnect and refresh the available tool catalogue.

Examples:

```text
/idea-mcp on
/mcp tools idea
/mcp reload idea
/idea-mcp off
```

## Tools and output

The extension discovers the server's tools when enabled; it does not provide a fixed list. Available tools use sanitized `idea_` names. `/mcp tools idea` shows each generated name and its original server tool name.

Reloading replaces the active IDEA tool catalogue. If the server has no tools, the connector remains connected with no IDEA tools active. If connection or discovery fails, the connector reports the error and no current IDEA tools remain active.

Text and image MCP output are passed to Pi. Text output is limited to Pi's standard MCP limits (2,000 lines or 50 KB); when truncated, the full text is saved to a temporary file and its path is reported in the tool output. MCP tool errors are returned as failed tool results.

## Status indicator

The shared footer shows MCP enabled state:

- dim `mcp: idea` — disabled
- accent `mcp: idea` — enabled
- `mcp: none` — no MCP connectors are registered

Use `/idea-mcp` or `/mcp status idea` for connection details, including the server and current tool count.
