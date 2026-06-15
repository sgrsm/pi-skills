# Shared extension helpers

`agent/extensions/shared` is not a standalone Pi extension. Do not enable it directly or add extension entrypoints here. This folder contains small helper modules imported by multiple local extensions under `agent/extensions/`.

## `footerStatus.ts`

`footerStatus.ts` centralizes footer status keys for local extensions that render persistent indicators in Pi's terminal footer. The shared keys keep those indicators from competing for arbitrary positions or leaving stale entries behind when key names change.

Current managed display order:

1. `permissions`
2. `clarify`
3. `web-search`
4. `subagents`
5. `mcp`

The numeric prefixes in `FOOTER_STATUS_KEYS` (`0-`, `1-`, etc.) are intentional. Pi displays footer statuses sorted by key, so the prefixes encode the managed order while the suffixes keep the keys readable.

Use `FOOTER_STATUS_ORDER` for logical iteration, `FooterStatusName` for the managed status names, and `FOOTER_STATUS_KEYS` when writing a status with `ctx.ui.setStatus(...)`.

## Legacy key cleanup

Some local extensions previously used different prefixed keys or an unprefixed key (`mcp`). `LEGACY_FOOTER_STATUS_KEYS` records those old keys.

Consumers should call `clearLegacyFooterStatus(ctx, name)` before setting the current key. This unsets legacy entries and prevents duplicate footer indicators after a key/order migration.

## Current consumers

- `permissions/index.ts` (`permissions`)
- `clarify/index.ts` (`clarify`)
- `web-search/index.ts` (`web-search`)
- `subagent/index.ts` (`subagents`)
- `mcp-bridge/mcpConnector.ts` (`mcp`)

The focused test coverage for ordering and legacy cleanup lives in `shared/footerStatus.test.ts`.
