# Shared extension helpers

`agent/extensions/shared` is not a standalone Pi extension. Do not enable it directly or add extension entrypoints here. This folder contains small helper modules imported by multiple local extensions under `agent/extensions/`.

## Dialog helpers

`dialogQueue.ts` and `dialogUi.ts` coordinate permission approvals and clarify questions within a session. They keep each selector/custom-answer exchange together, cancel waiting or displayed work on abort/shutdown/reload, and leave independent sessions separate. The owning extensions use them automatically; there is nothing to enable or configure here.

`showCancellableCustom()` accepts optional host `custom()` options (for example `{ overlay: true, overlayOptions }`) and forwards them unchanged. The options type omits `onHandle`: completion always goes through the host's callback and a dialog never hides its own overlay handle, so a cancelled interaction removes only its own overlay, and a component that was never installed is still disposed exactly once.

`showCancellableEditor()` takes the same optional options. Without them it keeps the host's default (input-area) presentation, which the permission prompts use. With `overlay: true` it fits the terminal height (shortening the title, then the hints, then showing the lines around the cursor) and does not let the wheel scroll the transcript beneath it. A separate optional sixth argument, `{ maxRows: (terminalRows) => number }`, bounds an inline editor too and keeps wheel input local without forwarding layout data to the host. Clarify uses that compact presentation. Outside the TUI the options and layout are ignored.

Prompt layout, hidden-scope limits, and custom-answer input differ by mode and are described in the [permissions](../permissions/README.md#prompt-choices) and [clarify](../clarify/README.md#tool) guides.

Tests: `dialogQueue.test.ts`, `dialogUi.test.ts`, the owning extension tests, and [`pi-compatibility/dialog-concurrency.test.ts`](../pi-compatibility/host-contract-coverage.md#dialog-concurrencytestts). For rules when adding a consumer and the dialogs not yet enrolled, see [Shared interactive dialogs](../maintenance.md#shared-interactive-dialogs).

## Tool availability

`toolAvailability.ts` lets clarify, web search, and subagent withdraw unavailable tools by re-registering them with Pi's documented `hidden` exposure. Eligible tools keep their original exposure and activation defaults; unavailable tools register inactive. This avoids replacing unrelated pending tool restoration at startup/reload, and host allowlists and exclusions still filter registration. Explicit user deactivation stays in the owning command handlers.

For the contract and regression coverage, see [Tool availability at startup](../maintenance.md#tool-availability-at-startup).

## `footerStatus.ts`

`footerStatus.ts` centralizes footer status keys for local extensions that render persistent indicators in Pi's terminal footer. The shared keys keep those indicators from competing for arbitrary positions or leaving stale entries behind when key names change.

Current managed display order:

1. `permissions`
2. `clarify`
3. `web-search`
4. `subagents`
5. `mcp`
6. `response-timer`

The numeric prefixes in `FOOTER_STATUS_KEYS` (`0-`, `1-`, etc.) are intentional. Pi displays footer statuses sorted by key, so the prefixes encode the managed order while the suffixes keep the keys readable.

Use `FOOTER_STATUS_ORDER` for logical iteration, `FooterStatusName` for the managed status names, and `FOOTER_STATUS_KEYS` when writing a status with `ctx.ui.setStatus(...)`.

## Theme changes

An idle indicator can retain its previous theme's colors until its producer next writes the status. MCP already refreshes once per second; the response timer updates periodically only while running. See the [footer status color refresh contract](./maintenance.md#footer-status-color-refresh) for details.

## Legacy key cleanup

Some local extensions previously used different prefixed keys. `LEGACY_FOOTER_STATUS_KEYS` records those old keys.

Consumers should call `clearLegacyFooterStatus(ctx, name)` before setting the current key. This unsets legacy entries and prevents duplicate footer indicators after a key/order migration.

## Current consumers

- `permissions/index.ts` (`permissions`)
- `clarify/index.ts` (`clarify`)
- `web-search/index.ts` (`web-search`)
- `subagent/index.ts` (`subagents`)
- `mcp-status/index.ts` (`mcp`)
- `response-timer/index.ts` (`responseTimer`)

The focused test coverage for ordering and legacy cleanup lives in `shared/footerStatus.test.ts`.
