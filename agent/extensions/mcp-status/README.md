# MCP footer status

Shows configured MCP servers between the **subagents** and **response timer** indicators, without replacing Pi's built-in footer or `/mcp` command.

## Quickstart

Run `/reload` after installing the extension. It loads automatically from `~/.pi/agent/extensions/mcp-status/index.ts`.

For the IntelliJ server:

| Setting | Footer | Appearance |
|---|---|---|
| Disabled | `MCP: idea` | Gray; exposure hidden |
| Enabled, codemode (or legacy `codemode-deferred`) | `MCP: idea · codemode` | Entire segment in normal green |
| Enabled, deferred | `MCP: idea · deferred` | Entire segment in normal green |

The configured server name `intellij` is displayed as `idea`; this is only a display alias. The server's name in `/mcp` and its tool names are unchanged.

Example footer segment:

```text
subagents: auto • MCP: idea · codemode • ✓ 23s
```

Other servers use their configured names. Multiple servers share one comma-separated `MCP:` segment: enabled entries are green, disabled entries are gray, and the `MCP:` prefix is green if any server is enabled. The separator before the timer stays gray. The indicator disappears when no entries pass the footer's configuration checks.

## Change the status

Use `/mcp` to enable/disable a server or change its exposure. The footer reflects saved changes within about one second. The default exposure is `codemode` when no exposure is configured; the legacy alias `codemode-deferred` displays as `codemode`. Actual `deferred` remains distinct; it is not another spelling of `codemode`.

The extension reads the global `<agent-dir>/mcp.json` (normally `~/.pi/agent/mcp.json`) and trusted project `.pi/mcp.json`. For entries that pass the footer's checks, it shows the effective settings:

- **No project override:** show the global enabled state and exposure.
- **Project settings override:** apply the project's enabled state or exposure to the global server of the exact same name. Omitted fields inherit from global. This includes the small overrides saved by `/mcp`'s **Enable in this project** and **Disable in this project** actions.
- **Full project server definition:** replace the same-name global definition; omitted settings use their normal defaults rather than inheriting from global.

Settings-only overrides have no `command`, `url`, or `type`, can set only `enabled`, `exposure`, and `toolExposure`, and require a matching global server. Per-tool exposure does not change the server-level exposure label in the footer.

Among projected entries, names differing only in `-` and `_` collide: the later definition is omitted, following global-then-project file order. Full project definitions using provider-token `auth` with a URL are omitted, as Pi permits that only in the global file; a settings-only override can still inherit a global server using that auth. The extension does not read untrusted project configuration, start servers, or change settings.

## What green means

Green means **enabled in the effective configuration**, not host-validated or necessarily connected. The footer omits entries rejected by cheap checks of transport, URL, basic field shapes, exposure, provider-auth source and name collisions. Empty or whitespace-only commands remain omitted even though Pi accepts them as configured; this conservative filter can change which colliding name is displayed. It is not Pi's full validator: OAuth details, credential/environment resolution, executable availability and runtime state are not checked. Use `/mcp` to confirm acceptance, connection errors, sign-in requirements, and tool counts. Extension-registered servers that are not in `mcp.json` are not shown.

Manual edits to `mcp.json` also update the indicator, but Pi needs `/reload` to apply those edits to its MCP connections. Use `/mcp` to change settings immediately.

## Troubleshooting

- **No indicator or missing server:** check that a server is configured in the global file or a trusted project's file and that `/mcp` accepts it. Rejected entries are omitted; run `/reload` after correcting manual edits. The indicator is terminal-only; RPC, JSON, and print modes do not show it.
- **Stale status while editing:** invalid JSON or read errors retain that file's last valid settings until it can be read again. Changes to the other file can still update the display. Check JSON syntax and file permissions.
- **Green but tools unavailable:** inspect the server in `/mcp`; enabling is separate from a successful connection.

Maintainers: see [maintenance notes](./maintenance.md) for fallback invariants and validation.
