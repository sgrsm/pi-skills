# Response timer extension

Shows the elapsed time for the current Pi response through Pi's extension status API.

## What it does

- Adds a timer at the right edge of Pi's extension-status line, after the MCP indicator and its `•` delimiter, while preserving the built-in footer.
- Resets to `0s` when a new agent response starts.
- Updates once per second while the agent is thinking, streaming, or running tools.
- Stops at `agent_settled` and leaves the final duration visible until the next response.
- Measures only the current response, not the whole session.

## Display

The timer uses two symbols:

- `⏱` while a response is running
- bold darker-green `✓` when the response is stopped/idle

Examples:

```text
⏱ 5s
⏱ 23s
⏱ 1m 05s
⏱ 12m 10s
⏱ 1h 05m 02s
⏱ 11h 25m 30s
✓ 23s
```

Time uses `Xh Ym Zs` units. Leading zero values are hidden: seconds-only responses show `5s` or `23s`, minute responses show `1m 05s`, and hour responses show `1h 05m 02s`.

## UI placement

The extension publishes the timer with `ctx.ui.setStatus()`. Its shared sortable status key places it at the rightmost position after the MCP indicator, which contributes the separating `•` delimiter. Pi retains full ownership of the built-in footer, including cwd, model, usage, OAuth, and auto-compaction indicators.

This avoids depending on Pi's internal `FooterComponent` or fabricating a partial session object. It also composes with other extension statuses and custom footers according to Pi's documented status API.

## Extension hooks

The extension listens for:

- `session_start` - initializes the stopped timer at `✓ 0s`.
- `before_agent_start` - starts and resets the timer as early as possible for a new response.
- `agent_start` - fallback start for programmatic turns that may not run `before_agent_start`.
- `agent_settled` - stops live updates and shows the final duration with `✓` after retries, compaction retries, and queued continuations finish.
- `session_shutdown` - clears the live update interval.

No slash commands, custom tools, flags, or shortcuts are registered.

## Validation

Focused tests live in `index.test.ts` and cover duration formatting, status updates across a response, final stopped display, and shutdown cleanup.
