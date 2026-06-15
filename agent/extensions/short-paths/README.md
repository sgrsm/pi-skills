# short-paths extension

Toggles smart path shortening in Pi tool-call summaries.

## Purpose

`short-paths` keeps long file paths readable in narrow tool rows. It preserves the filename, shortens parent directories, replaces the home directory with `~`, normalizes `\` to `/`, and uses `…` when a path still does not fit.

The extension defaults to `on` when no saved state exists.

## When it is used

This extension registers the `/short-paths` command and exports rendering helpers used by `agent/extensions/hide-tool-output`.

When `hide-tool-output` wraps the built-in tools, the `short-paths` state controls whether path-bearing tool-call summaries use smart shortening. It affects summaries for:

- `read`
- `edit`
- `write`
- `grep`
- `find`
- `ls`

`bash` keeps Pi's built-in call renderer in the `hide-tool-output` wrapper, so `/short-paths` does not normally change bash call display there.

## Slash command

```text
/short-paths
/short-paths on
/short-paths off
```

Behavior:

- `/short-paths` - show the current state.
- `/short-paths on` - enable smart path shortening.
- `/short-paths off` - disable smart path shortening and show display paths without smart compaction.
- Any other argument shows `Usage: /short-paths on|off (currently on|off)`.

The command has autocomplete for `on` and `off`.

State is persisted in:

```text
~/.pi/agent/short-paths.json
```

## Display behavior

With smart paths enabled, paths are shortened to fit the available row width:

1. display `~` for the home directory and strip a leading `@` path marker;
2. keep the basename visible;
3. compact parent directory names while space is tight;
4. fall back to an ellipsis path such as `…/src/file.ts` when needed;
5. if only the basename can fit, left-truncate it with `…`.

Tool summaries also include small metadata where available:

- `read` - optional line range such as `:10-25`
- `edit` - edit count
- `write` - line count and byte count
- `grep` - pattern, search path, optional glob, optional limit
- `find` - pattern, search path, optional limit
- `ls` - path, optional limit

## Visual/status indicators

There is no separate footer badge or long-running status indicator.

For self-rendered compact tool rows, the background follows Pi's normal tool status theme keys:

- pending/partial: `toolPendingBg`
- completed successfully: `toolSuccessBg`
- error: `toolErrorBg`

Paths are styled with the theme accent color; metadata uses the normal muted/tool-output styling.

## Extension surface

- Slash commands: `/short-paths [on|off]`
- Registered tools: none
- Flags: none
- Events/hooks: none
- Exports: `getShortPathsState`, `saveShortPathsState`, `smartShortenPath`, `renderSmartToolCall`, `renderSmartVisibleToolCall`
