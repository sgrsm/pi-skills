# MCP footer status maintenance

User-visible behavior, display rules and limitations are in the [user guide](./README.md). This note records only the maintainer invariants behind it.

## Scope

- `state.ts` projects display fields (`name`, `enabled`, `exposure`) from cheap config checks, with an `override: true` discriminator for project-only patches. It normalizes the legacy `codemode-deferred` exposure to `codemode` and keeps `deferred` distinct. It does not retain commands, environment values, credentials or per-tool exposure mappings.
- `index.ts` polls the global file and, only when the project is trusted, the project file. It merges the projections in global-then-project order, applying exact-name project patches or replacements but omitting later differently named definitions whose normalized names collide.
- This is not Pi's full validator and does not connect to servers. Green means enabled in configuration; see [What green means](./README.md#what-green-means). Do not add connection, credential or extension-registered-server claims here or in the guide.

## Project precedence

- Match Pi's settings-only override detection: a project entry has no defined `command`, `url`, or `type`. Only `enabled`, `exposure`, and `toolExposure` are allowed; malformed values or extra keys reject the whole patch.
- Do not default omitted patch fields. They inherit the current global enabled state and exposure; an empty or valid tool-exposure-only patch leaves the server-level display unchanged.
- Patches require an exact-name projected global server. They cannot create a server or reserve a normalized-name namespace. Full project definitions still replace same-name global entries, with normal defaults rather than inheritance.
- Keep patches unresolved in the last-valid cache and reapply them to current global projections on each refresh. A cached enabled-only patch must pick up a newly saved global exposure even while the project file is unreadable.
- The project provider-auth restriction applies to full project definitions, not to settings-only patches of a global server.

Regression anchors in [`index.test.ts`](./index.test.ts): `footer follows effective global/project settings, inheriting omitted override fields` and `cached project patches reapply to current global settings and are cleared on trust revocation`. Parser and invalid/orphan-patch cases are in neighboring tests.

## Last-valid fallback identity

Transient JSON or read errors keep the previous projection for the same source. The cache identity is the pair **config scope and path** (`global:<path>` or `project:<path>`), never the path alone.

- Global and project parsing differ (project entries with a URL and `auth` are omitted). If `<agent-dir>` and the project's `.pi` directory resolve to the same path, a path-only cache would let one scope overwrite or reuse the other's projection.
- Trust revocation deletes only the project-scope fallback. The global fallback for the same path must remain, and a revoked project must not be read or reused.
- Session shutdown and restart clear all fallbacks.

Regression anchor in [`index.test.ts`](./index.test.ts): `last-valid caches stay source-specific when global and project config paths coincide`. Related trust and collision coverage is in the neighboring project-override and normalized-name tests.

## Validation

From `agent/extensions`, run:

```bash
node --test mcp-status/index.test.ts shared/footerStatus.test.ts response-timer/index.test.ts
npm run typecheck
```

For the full gate, prepare approved scratch as described in the [shared maintenance notes](../maintenance.md#extension-verification). Use fake files in tests; do not edit the real MCP configuration.
