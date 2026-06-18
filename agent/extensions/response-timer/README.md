# Response timer extension

Shows the elapsed time for the current Pi response on the first footer line.

## What it does

- Adds a right-aligned timer to the footer line that shows the current working directory.
- Resets to `0s` when a new agent response starts.
- Updates once per second while the agent is thinking, streaming, or running tools.
- Stops at `agent_end` and leaves the final duration visible until the next response.
- Measures only the current response, not the whole session.

## Display

The timer uses two symbols:

- `⏱` while a response is running
- bold darker-green `✓` when the response is stopped/idle

Examples:

```text
~/.pi                                                      ⏱ 5s
~/.pi                                                     ⏱ 23s
~/.pi                                                 ⏱ 1m 05s
~/.pi                                                ⏱ 12m 10s
~/.pi                                              ⏱ 1h 05m 02s
~/.pi                                             ⏱ 11h 25m 30s
~/.pi                                                     ✓ 23s
```

Time uses `Xh Ym Zs` units. Leading zero values are hidden: seconds-only responses show `5s` or `23s`, minute responses show `1m 05s`, and hour responses show `1h 05m 02s`.

## UI placement

The extension installs a custom footer wrapper in TUI mode. It renders Pi's default footer first, then rewrites only the first footer line so the timer is right-aligned and the cwd/session text is truncated if space is tight.

The timer no longer uses `ctx.ui.setStatus()`, so it does not add a separate extension-status line. On startup it clears the old `-1-response-timer` status key from earlier versions so stale status-line timers disappear after `/reload`.

Because Pi exposes footer customization as a replacement API, this extension owns the custom footer while it is loaded. Other extensions that also call `ctx.ui.setFooter()` may replace it depending on extension load order.

## Extension hooks

The extension listens for:

- `session_start` - installs the footer wrapper, initializes the stopped timer at `✓ 0s`, and clears the previous status-line key.
- `before_agent_start` - starts and resets the timer as early as possible for a new response.
- `agent_start` - fallback start for programmatic turns that may not run `before_agent_start`.
- `agent_end` - stops live updates and shows the final duration with `✓`.
- `session_shutdown` - clears the live update interval.

No slash commands, custom tools, flags, or shortcuts are registered.

## Validation

Focused tests live in `index.test.ts` and cover duration formatting, first-line right alignment, TUI-only footer installation, per-response reset behavior, live update ticking, final stopped display, and shutdown cleanup.
