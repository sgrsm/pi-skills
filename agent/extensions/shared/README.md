# Shared extension helpers

`agent/extensions/shared` is not a standalone Pi extension. Do not enable it directly or add extension entrypoints here. This folder contains small helper modules imported by multiple local extensions under `agent/extensions/`.

## Dialog helpers

`dialogQueue.ts` and `dialogUi.ts` coordinate permission approvals and clarify questions within a session. They keep selector/custom-answer exchanges together, cancel waiting or displayed work on abort/shutdown/reload, and leave independent sessions separate. They are used by the owning extensions automatically; there is nothing to enable or configure here.

TUI permission selectors stay compact with persistent request details above them. RPC selectors carry their own bounded details. Permission requests too large to display completely offer only Deny or Custom instructions, never approval of hidden scopes. Custom answers use an in-Pi multiline editor in TUI (external-editor launch disabled) and cancellable input in RPC. See the [permissions](../permissions/README.md#prompt-choices) and [clarify](../clarify/README.md#tool) guides for user-visible behavior and limitations.

Focused coverage lives in `dialogQueue.test.ts`, `dialogUi.test.ts`, the owning extension tests, and `pi-compatibility/dialog-concurrency.test.ts`. For integration rules and remaining enrollment candidates, see [Shared interactive dialogs](../maintenance.md#shared-interactive-dialogs).

## `footerStatus.ts`

`footerStatus.ts` centralizes footer status keys for local extensions that render persistent indicators in Pi's terminal footer. The shared keys keep those indicators from competing for arbitrary positions or leaving stale entries behind when key names change.

Current managed display order:

1. `permissions`
2. `clarify`
3. `web-search`
4. `subagents`
5. `response-timer`

The numeric prefixes in `FOOTER_STATUS_KEYS` (`0-`, `1-`, etc.) are intentional. Pi displays footer statuses sorted by key, so the prefixes encode the managed order while the suffixes keep the keys readable.

Use `FOOTER_STATUS_ORDER` for logical iteration, `FooterStatusName` for the managed status names, and `FOOTER_STATUS_KEYS` when writing a status with `ctx.ui.setStatus(...)`.

## Legacy key cleanup

Some local extensions previously used different prefixed keys. `LEGACY_FOOTER_STATUS_KEYS` records those old keys.

Consumers should call `clearLegacyFooterStatus(ctx, name)` before setting the current key. This unsets legacy entries and prevents duplicate footer indicators after a key/order migration.

## Current consumers

- `permissions/index.ts` (`permissions`)
- `clarify/index.ts` (`clarify`)
- `web-search/index.ts` (`web-search`)
- `subagent/index.ts` (`subagents`)
- `response-timer/index.ts` (`responseTimer`)

The focused test coverage for ordering and legacy cleanup lives in `shared/footerStatus.test.ts`.
