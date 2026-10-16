# short-paths extension

Toggles smart path shortening in Pi tool-call summaries.

## Purpose

`short-paths` keeps long file paths readable in narrow tool rows. It preserves the filename, shortens parent directories, replaces the home directory with `~`, normalizes `\` to `/`, and uses `…` when a path still does not fit.

Requires Pi 1.3.0 or newer.

The extension defaults to `on` when no saved state exists.

## When it is used

Use this extension with [hide-tool-output](../hide-tool-output/README.md). The `/short-paths` command controls smart shortening in its file-tool summaries:

- `read`
- `edit`
- `write`
- `grep`
- `find`
- `ls`

When tool output is visible, `edit` and `write` keep Pi's normal headers and are not affected by this preference. `/short-paths` never changes Bash command display.

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

If you set `PI_CODING_AGENT_DIR`, the file is stored there instead. Missing or invalid saved state defaults to `on`.

Successful command changes update existing summaries immediately without changing which tool rows are expanded. If saving fails, the preference stays unchanged. Changes made in another Pi session or by editing the file take effect after `/reload` or a restart.

## Display behavior

With smart paths enabled, paths are shortened to fit the available row width:

1. display `~` for the home directory and strip a leading `@` path marker;
2. keep the basename visible;
3. compact parent directory names while space is tight;
4. fall back to an ellipsis path such as `…/src/file.ts` when needed;
5. if only the basename can fit, left-truncate it with `…`.

Summaries follow Pi's `outputPad` setting: 0 means no horizontal padding, and 1 (the default) means one column.

Tool summaries also include small metadata where available:

- `read` - optional line range such as `:10-25`; numeric strings are accepted, and malformed ranges are omitted
- `edit` - edit count
- `write` - line count and byte count
- `grep` - pattern, search path, optional glob, optional limit
- `find` - pattern, search path, optional limit
- `ls` - path, optional limit

## Visual/status indicators

There is no separate footer badge or long-running status indicator.

Tool rows use Pi's normal pending, success, and error colors. Paths use the theme's accent color.

## Troubleshooting

- **The command has no effect:** check that both `short-paths` and `hide-tool-output` are loaded. A path that already fits may look unchanged.
- **A manually edited preference is not reflected:** run `/reload` or restart Pi.
- **Off still shows `~`:** disabling smart compaction does not disable ordinary home-directory formatting.

For extension developers, see the [state and rendering maintenance notes](maintenance.md).
