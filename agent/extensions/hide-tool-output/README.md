# hide-tool-output

Hides supported tool result output from Pi's conversation UI while keeping tool calls visible.

## Purpose

Use this extension when tool output is taking too much screen space but you still want to see which tools ran and with what key arguments.

This is a UI rendering change only:

- tools still execute normally
- results are still returned to the agent
- relative paths still resolve against the active session cwd

If no saved state exists, hiding is enabled by default. The state is saved in `~/.pi/agent/hide-tool-output.json`.

## Command

```text
/hide-tool [on|off]
```

- `/hide-tool` - show the current state
- `/hide-tool on` - hide tool result output
- `/hide-tool off` - show tool result output

Invalid arguments show:

```text
Usage: /hide-tool on|off (currently on|off)
```

The command provides `on` and `off` completions.

## Integrated tools

The extension controls display for these file tools:

- `read`
- `edit`
- `write`
- `grep`
- `find`
- `ls`

`git_inspect` independently honors the same setting, so its result output is hidden while its tool-call row remains visible.

Native MCP tools remain visible under `/hide-tool`. Model/codemode results are unchanged.

With the [permissions extension](../permissions/README.md) loaded, Bash output also follows this preference while the full command remains visible. Permission guards are unchanged; hiding output is not an execution-safety control or a sandbox.

Custom-shell limitation: permissions-owned Bash cannot honor `shellPath`, or `shellCommandPrefix` for model-issued commands. TUI command prefixes are still applied and checked. See the permissions guide for guard scope and limitations.

This extension adds no new agent-facing tools or flags.

## UI behavior

When `hide-tool` is `on`:

- result output for supported tools is suppressed in the conversation UI
- the tool call row remains visible
- Bash commands remain fully visible; only their result output is hidden
- non-`bash` tools use compact one-line summaries such as `read <path>`, `grep /pattern/ in <path>`, or `write <path>`
- compact path display follows the saved [short-paths](../short-paths/README.md) preference; `/short-paths on|off` updates it immediately

When `hide-tool` is `off`:

- wrapped tool results render normally
- `read`, `grep`, `find`, and `ls` keep their compact path summaries
- `edit` and `write` use Pi's normal call display

Changing `/short-paths` updates existing summaries without changing which rows are expanded. The saved preference is also used when the command extension is not loaded; changes from another session or manual file edits require `/reload` or a restart.

## Troubleshooting

- **Expanding a row does not reveal its output:** while hiding is on, expansion does not override it. Use `/hide-tool off`.
- **Some rows changed expansion after a toggle:** `/hide-tool on|off` can reset individual expansion choices. `/short-paths` does not.
- **MCP output is still visible:** native MCP tools are not covered by this extension.

For extension developers, see the [state and rendering maintenance notes](../short-paths/maintenance.md).

## Visual states

Tool rows use Pi's normal pending, success, and error colors.

There is no separate footer or status-bar indicator beyond command notifications such as `hide-tool on`, `hide-tool off`, and `hide-tool is on`.
