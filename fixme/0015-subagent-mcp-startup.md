# 0015: Avoid unnecessary MCP startup in restricted child sessions

- **Status:** Deferred — runtime work; maintenance note complete, impact measurement pending
- **Priority:** Low; latent while all applicable MCP servers are disabled
- **Evidence:** Enabled-server startup independent of tool allowlists is source-supported; startup cost, latency and cleanup behavior unmeasured
- **Area:** `agent/extensions/subagent`
- **Instructions:** [Package workflow and validation](README.md)

## Current disposition and implementation scope

Do not dismiss the startup redundancy, but do not implement a predetermined workaround yet. The statically inspected local MCP configuration has one server, disabled, so the configured-server startup concern is currently latent. Enabled configuration in another trusted child project or extension-registered servers could change applicability.

The immediate documentation scope is complete in [subagent maintenance](../agent/extensions/subagent/maintenance.md#child-mcp-startup-limitation): child tool allowlists constrain callable tools, not enabled MCP-server initialization. No prominent user README warning is needed for current usage; add one when routine MCP use makes that distinction relevant.

**Revisit trigger:** before enabling MCP for routine delegated work, measure startup, first-prompt delay, and cleanup using a disposable counting mock. Concurrency can amplify process/connection cost, but no measured cost or process leak is established by this review. Direct-exposure startup may also delay restricted children even when their tools are unavailable.

The installed CLI documents tool selection separately from extension loading; `--no-tools` is not a server opt-out. Its MCP/settings docs describe built-in exclusion and replacement controls, but this review does not establish a safe child-local startup opt-out for the current launcher. Prefer a host-supported child-local switch if available; do not select or implement a suppression workaround before isolated measurement.

No new TDR is needed now. If measurement establishes material impact and remediation is intentionally deferred, record the measured limitation and revisit condition as debt. This remains separate from transient-project-trust debt in TDR-0002.

This disposition is source/docs review only, not a mock-server measurement or new test run. Earlier re-checks below retain their historical evidence; the current runtime disposition is deferred, not resolved.

## Observation

Each child is a separate Pi process and normally loads built-in extensions, including MCP. For a declared non-empty child allowlist, `buildSubagentChildProcessArgs()` adds `--tools` but no MCP startup opt-out (`subagent/index.ts:1915-1930`); `runSingleAgent()` inherits the process environment (`:2012-2018`). The CLI passes tool selection through to the SDK (`HOST/dist/main.js:432-434`, `dist/core/sdk.js:145-148`), and `AgentSession._refreshToolRegistry()` filters registered tools through `_isAllowedTool()` (`dist/core/agent-session.js:1099-1101, :2772-2829`), including late MCP tools. Separately, built-in MCP starts enabled configured and extension-registered servers on `session_start` without consulting that allowlist (`dist/extensions/mcp/index.js:840-873`). Callable-tool filtering does not gate enabled-server startup.

Once an MCP server is enabled, concurrent delegation (audited user `subagents.maxConcurrency` 12; code default 5, hard cap 32 in `subagent/settingsState.ts:48, :53`) could create unnecessary subprocesses/connections for read-only children that cannot use those tools. This is a resource/lifecycle concern, not evidence of an allowlist bypass.

Source boundary checked against installed Pi **1.0.0** and its `HOST/docs/cli.md`, `docs/mcp.md`, `docs/settings.md`, `docs/extensions.md`, and `docs/sdk.md`. Direct-exposure first-prompt waiting is also independent of the allowlist (`dist/extensions/mcp/index.js:882-908`); its latency impact remains unmeasured.

## Deferred measurement: before choosing a fix

A counting fake transport through the public MCP extension factory can establish connection attempts without external capabilities. Use a disposable local mock stdio server when actual child-process startup and cleanup need measurement. Keep all configuration and markers in isolated approved scratch; do not copy real credentials.

Start a restricted child; assert its callable registry excludes MCP/codemode outside its allowlist, and record mock starts/connections, first-prompt delay, and observed shutdown/abort cleanup. An in-process transport test alone does not establish process cleanup.

Use bounded timeouts and existing child-process lifecycle tests. Do not enable the real IntelliJ server or any network service. Cover codemode/deferred/direct exposures separately because startup timing and waits differ. Existing synthetic allowlist tests are not startup measurements.

## Conditional remediation scope

Only after measurement shows material impact, choose a documented child-local way to suppress unneeded MCP loading when the effective allowlist excludes every MCP/discovery/resource capability. Allow MCP for children whose explicitly approved loadout needs it. A proposed opt-out must be tested with the actual child launcher before being treated as supported.

Do not change global/project mcp.json, copy credentials into scratch, disable all extensions (which removes local guards), or treat `--no-tools` as a server opt-out. Preserve project-trust behavior and owned-process cancellation.

If no suitably safe public child-only control is available, retain the measured limitation and consider a host enhancement or TDR. Do not invent a private flag or patch the host installation.

## Acceptance criteria by track

### Documentation and measurement

- **Complete:** [maintenance documentation](../agent/extensions/subagent/maintenance.md#child-mcp-startup-limitation) distinguishes tool reachability from MCP startup, states the revisit trigger, and leaves startup cost, latency and cleanup behavior unmeasured.
- Measurements identify host version, exposure, concurrency, mock starts/connections, latency, and the actual cleanup paths exercised.
- Restricted-child allowlist enforcement is checked independently of startup.
- No external server, personal MCP configuration, or real credentials are used as fixtures.
- Documentation completion does not close the unmeasured runtime concern or claim that startup is suppressed.

### Runtime change, only if justified and selected

- A verified supported opt-out avoids unnecessary mock startup without disabling safety extensions or weakening tool allowlists.
- Permitted children retain required MCP functionality.
- Bounded concurrent mock tests verify the exercised abort/shutdown cleanup paths; broader leak guarantees are not inferred from unrelated tests.
- User settings and real credentials/config remain untouched.
- Any intentionally retained limitation includes precise evidence and a revisit condition.

## Validation

Docs-only maintenance changes need consistency/link review. For measurement, run the focused isolated MCP startup/lifecycle checks and report what was actually observed. For any runtime change: `npm run test:subagent`; focused mocked MCP lifecycle regressions; `npm run verify` with approved scratch.

## Documentation completion

The maintenance-only scope is complete. Documentation consistency, relative links and the new section anchor were checked against the source/docs boundary above. No Pi/server startup, mock-server experiment or executable suite was run. No child arguments/environment, settings/MCP configuration, dependencies or host links were changed; no TDR was created.

Startup cost, first-prompt latency and MCP cleanup behavior remain unmeasured. **Runtime remediation remains Deferred** pending isolated measurement before routine delegated MCP use; documentation completion is not runtime resolution or evidence of measured impact.

## Historical re-checks

### Re-check after 0005

0005 changes only local tool availability/activation. Source inspection confirms child CLI arguments/environment construction and built-in MCP loading were not changed. Public activation regressions verify restrictive child allowlists and direct child escalation, but do not measure server startup or connections. No disposable mock-server lifecycle test was run for this package; process amplification remains **inconclusive / verify-first**, and **Status remains Open**. No external server or personal MCP configuration was enabled or changed.

Existing transient-project-trust debt remains separate in [TDR-0002](../tdr/0002-propagate-transient-project-trust-to-subagents.md).

### Re-check after 0006

Source inspection confirms 0006 changes failure retention/rendering and catches a next-step preparation abort, but leaves child argument/environment construction, built-in MCP startup and process termination unchanged. Parent-executed subagent tests passed **149** and the final full gate **517** (TypeScript and host links valid); these include lifecycle/allowlist controls, not MCP startup measurements. No disposable mock-server lifecycle test or live MCP connection was run. The server-startup/connection acceptance criteria remain unverified, so **0015 remains Open / verify-first**; no related runtime fix or status promotion was made.
