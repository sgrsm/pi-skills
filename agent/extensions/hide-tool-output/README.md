# hide-tool-output

Hides built-in tool result output from Pi's conversation UI while keeping tool calls visible.

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

## Wrapped tools

The extension re-registers these built-in tools with custom rendering:

- `read`
- `bash`
- `edit`
- `write`
- `grep`
- `find`
- `ls`

It does not add new agent-facing tools, flags, or events.

## UI behavior

When `hide-tool` is `on`:

- result output for the wrapped tools is suppressed in the conversation UI
- the tool call row remains visible
- `bash` keeps Pi's built-in call renderer so the full command remains visible; only the result output is hidden
- non-`bash` tools use compact one-line summaries such as `read <path>`, `grep /pattern/ in <path>`, or `write <path>`
- compact path display follows the shared `short-paths` state when that extension is available

When `hide-tool` is `off`:

- wrapped tool results render normally
- non-`bash` default-shell tool calls still use the smart visible summary header
- self-rendered tools fall back to Pi's built-in call renderer

## Visual states

For compact self-rendered tool calls, the row background follows Pi's normal tool state colors:

- pending / partial: `toolPendingBg`
- success: `toolSuccessBg`
- error: `toolErrorBg`

There is no separate footer or status-bar indicator beyond command notifications such as `hide-tool on`, `hide-tool off`, and `hide-tool is on`.
