# Shared helper maintenance

For the helper overview and current consumers, see [README.md](./README.md). Dialog and tool-availability contracts remain in [extension maintenance](../maintenance.md).

## Footer status color refresh

`ctx.ui.setStatus(key, text)` stores text, not semantic theme-token references or a render callback. Producers apply `ctx.ui.theme.fg()` and other theme helpers before publishing, so the stored text already contains ANSI styling. Pi can redraw the footer after a theme change, but that redraw does not replace explicit colors embedded in the stored strings.

The managed statuses therefore follow a **refresh-on-next-write** contract:

- Obtain the current `ctx.ui.theme` and rebuild themed text when writing a status. Do not cache a theme instance or precolored status indefinitely for reuse across theme changes.
- Use semantic tokens such as `success`, `accent`, and `dim`; the active theme chooses their actual colors. Do not promise a fixed shade in user documentation.
- An idle status can retain its previous colors until its producer next writes it. This is an accepted limitation of storing preformatted status text, not a guarantee of immediate recoloring when Pi changes themes.
- When suppressing unchanged writes, compare the newly themed text rather than only the underlying state, so changed ANSI styling can trigger a write.

### Existing refresh behavior

| Producer | Refresh trigger |
|---|---|
| `response-timer` | Session initialization, response start, once per second while running, and final settlement. Settlement stops the interval; the idle final duration waits for another status write, such as the next response. |
| `mcp-status` | Existing once-per-second polling reformats with the current theme even when configuration is unchanged. It writes only if the formatted status differs, so changed colors appear on the next poll without an extra theme listener. |
| Permissions, clarify, web search, subagents | Startup and relevant state/activity events; no general idle polling for theme changes. |

Preserve these refresh triggers and the built-in footer. Do not add idle polling, private theme listeners, or a custom footer merely to recolor stored statuses. Keep timer start/duration and `agent_settled` semantics independent from presentation changes.

### Verify-first lifecycle observations

The response timer starts in `before_agent_start`; investigate whether a reachable host setup failure after that point can bypass `agent_settled` and leave its interval running. Timer and MCP interval callbacks capture extension contexts, but normal shutdown/reload stops those intervals: establish a reachable callback after context invalidation despite that cleanup before proposing guards or generation tracking.

Both observations remain unconfirmed and deprioritized. Synthetic throwing or saved post-shutdown callbacks alone are not host reproductions. Reopen lifecycle work only with a reachable host reproduction and a separately scoped remedy that preserves timer start/duration and settlement semantics; cosmetic refresh changes do not resolve these observations.

### Focused validation

From `agent/extensions/`:

```bash
node --test response-timer/index.test.ts mcp-status/index.test.ts shared/footerStatus.test.ts
npm run typecheck
```

Use injected marker themes to assert semantic tokens rather than fixed built-in palette values. MCP coverage checks recoloring on an existing poll, unchanged-write suppression, and shutdown cleanup. Timer coverage checks formatting, live/final durations, settlement, and interval cleanup; these local tests do not establish that speculative setup-error or stale-context failures are reachable in the host.

For filesystem-mutating fixtures, follow the [safe test scratch setup](../permissions/README.md#safe-test-scratch-setup).
