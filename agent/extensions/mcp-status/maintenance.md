# MCP footer status maintenance

User-visible behavior, display rules and limitations are in the [user guide](./README.md). This note records only the maintainer invariants behind it.

## Scope

- `state.ts` projects only display fields (`name`, `enabled`, `exposure`) from cheap config checks. It normalizes the legacy `codemode-deferred` exposure to `codemode` and keeps `deferred` distinct. It does not retain commands, environment values or credentials.
- `index.ts` polls the global file and, only when the project is trusted, the project file. It merges the projections in global-then-project order, allowing exact-name project overrides but omitting later differently named entries whose normalized names collide.
- This is not Pi's full validator and does not connect to servers. Green means enabled in configuration; see [What green means](./README.md#what-green-means). Do not add connection, credential or extension-registered-server claims here or in the guide.

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
