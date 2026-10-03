# 0010: Align MCP footer projection with current config semantics

- **Status:** Resolved
- **Priority:** Low
- **Evidence:** Alias/validation drift source-verified; alias visible only when enabled
- **Area:** `agent/extensions/mcp-status` — parser, tests, display docs together
- **Instructions:** [Package workflow and validation](README.md)

## Problem and evidence

`mcp-status/state.ts:5, :24-25` accepts legacy `codemode-deferred` and casts it to `McpExposure`. Pi's canonical type has codemode/deferred/direct/hidden and its validator maps the alias to codemode (`HOST/dist/core/mcp-servers.js:9`).

The audited `agent/mcp.json` uses that alias on a disabled IntelliJ server. If enabled, the footer would display the legacy value while `/mcp` reports codemode. Some README examples additionally describe deferred, which is a distinct current exposure, not another spelling of codemode.

The local parser only performs basic command/url checks. Host rejection rules also include obsolete SSE transport, invalid URL/args, normalized server-name collisions, and provider-auth restrictions in project files. A configured-enabled footer entry is not proof the host accepted or connected it. This is display/validation parity, not a security boundary.

## Reproduce / test first

Extend `mcp-status/index.test.ts` with alias/canonical cases and cheap invalid-config cases. Compare equivalent fixtures against the current host validator/config loader without connecting servers. Include global versus trusted-project source and `foo-bar`/`foo_bar` collisions.

Read `HOST/docs/mcp.md` and host validator code before deciding which checks can be faithfully reused. Preserve last-valid projection on transient JSON/read errors.

## Recommended fix

- Normalize `codemode-deferred` to `codemode` before storing typed statuses; eliminate the unsafe cast of a legacy value.
- Mirror cheap, stable rejection/normalization rules only where needed for accurate projection, using a public validator if available.
- Pass source context where project restrictions differ; handle merge/name collisions consistently.
- If no supported validation API exists, keep the projection conservative and state its limits rather than duplicating the whole host.
- Update README examples to distinguish actual deferred exposure from the legacy alias.
- Preserve the rule: green means enabled in configuration, not healthy/connected. Do not add connections, credentials, or extension-registered-server claims.

## Acceptance criteria

- Legacy and canonical codemode display identically; actual deferred remains distinct.
- Disabled entries hide exposure as before.
- Invalid entries are not falsely presented as host-validated; projection limitations remain explicit.
- Trusted project override rules, one-second updates, read-error fallback, and secret-free state remain intact.
- Tests/README agree with host normalization.

## Validation

`node --test mcp-status/index.test.ts shared/footerStatus.test.ts`; `npm run verify` with approved scratch. Do not edit the real MCP configuration.

## Resolution and validation

Read-only scout confirmation was **source-only**. Parent test-first regressions reproduced five failures on Pi 1.0.0. Host `dist/core/mcp-servers.js:9,107–178` normalizes exposures; `dist/extensions/mcp/config.js:61–70` enforces collisions/project auth. Neither validator nor loader is a public package export.

The fix normalizes the legacy alias without an unsafe cast, mirrors cheap transport/URL/field checks, passes configuration scope, and rejects later normalized-name collisions while retaining exact-name project overrides. Trust gating, one-second polling, per-file last-valid fallback, disabled display and secret-free state remain.

A fresh independent reviewer **approved**, using source/log inspection only. The parent reproduced its same-path cache concern with a failing regression and separated global/project fallback caches; IPv6 compatibility coverage was added and duplicate assertions removed. The reviewer did not re-review that remediation.

Parent-executed final validation used approved scratch:

- `node --test mcp-status/index.test.ts shared/footerStatus.test.ts response-timer/index.test.ts`: **19 passed**.
- `npm run verify`: **580 passed**, TypeScript passed and all five host links valid; zero failed/cancelled/skipped.
- Version-checked, no-connection host validator/loader probe: **44 matching comparisons**, four expected blank-command differences, zero unexpected mismatches.

Per user choice, existing blank-command omission remains; its collision consequence and incomplete validation are explicit in the [user guide](../agent/extensions/mcp-status/README.md#what-green-means). Green still means configuration-enabled, not host-accepted/connected. OAuth, credentials, executables and runtime validation remain Pi-owned. No live TUI/provider/MCP checks were run; personal configuration and installed host files were untouched.

Related: [0013: footer lifecycle/themes](0013-footer-lifecycle-and-theme-drift.md).
