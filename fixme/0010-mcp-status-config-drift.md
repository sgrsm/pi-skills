# 0010: Align MCP footer projection with current config semantics

- **Status:** Open
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

Related: [0013: footer lifecycle/themes](0013-footer-lifecycle-and-theme-drift.md).
