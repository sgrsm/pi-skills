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
- `edit`
- `write`
- `grep`
- `find`
- `ls`

It no longer registers or owns `bash`. The global permissions extension owns the model Bash definition and composes Pi's full built-in Bash call renderer with this extension's persisted `isHideToolOutputEnabled()` state: results are empty when hiding is on and normal when hiding is off. The permissions wrapper keeps Pi's mutable built-in Bash result component in row-local renderer state, so a live row can move from hidden to visible without passing the empty placeholder back to Pi's built-in renderer. This avoids competing Bash definitions while preserving the existing UI behavior.

That ownership supports the permissions extension's practical catastrophic-deletion accident guard; it is not a sandbox or hostile-code guarantee. `hide-tool-output` changes rendering only and adds no execution protection. The permissions-owned model Bash uses Pi's standard local shell operations, but permissions-provided guarded operations cannot currently forward a configured `shellPath` for either model Bash or TUI Bash. The model override also cannot forward its configured `shellCommandPrefix`; TUI `shellCommandPrefix` is still applied by Pi before the returned operations run and is final-checked by permissions.

It does not add new agent-facing tools, flags, or events.

## UI behavior

When `hide-tool` is `on`:

- result output for the wrapped tools is suppressed in the conversation UI
- the tool call row remains visible
- permissions-owned `bash` keeps Pi's built-in call renderer so the full command remains visible; only the result output is hidden through renderer composition
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
