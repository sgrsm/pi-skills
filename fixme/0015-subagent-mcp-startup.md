# 0015: Avoid unnecessary MCP startup in restricted child sessions

- **Status:** Deferred — runtime work; maintenance note actionable, impact measurement pending
- **Priority:** Low; latent while all applicable MCP servers are disabled
- **Evidence:** Enabled-server startup independent of tool allowlists is source-supported; cost and cleanup behavior unmeasured
- **Area:** `agent/extensions/subagent`
- **Instructions:** [Package workflow and validation](README.md)

## Current disposition and implementation scope

Do not dismiss the startup redundancy, but do not implement a predetermined workaround yet. The inspected configuration has its only MCP server disabled, so it currently incurs no enabled-server startup cost. Enabled configuration in another trusted child project could change applicability.

The immediate action is a short limitation in [subagent maintenance](../agent/extensions/subagent/maintenance.md): child tool allowlists constrain callable tools, not MCP initialization. Add a user-facing README warning when routine MCP use makes that distinction relevant.

**Revisit trigger:** before enabling MCP for routine delegated work, measure startup, first-prompt delay, and cleanup using a disposable counting mock. Concurrency can amplify process/connection cost, but no measured cost or process leak is established by this review. Direct-exposure startup may also delay restricted children even when their tools are unavailable.

The installed CLI has no straightforward dedicated child-only MCP-disable flag in the current launcher. The documented replaceable-built-in mechanism can suppress built-in MCP, but a command-collision replacement is not a purpose-built opt-out and needs compatibility/safety evaluation. Prefer a host-supported child-local switch if available; do not commit to a replacement or enumerated extension loadout before measuring impact.

No new TDR is needed now. If measurement establishes material impact and remediation is intentionally deferred, record the measured limitation and revisit condition as debt. This remains separate from transient-project-trust debt in TDR-0002.

This disposition is source/docs review only, not a mock-server measurement or new test run. Earlier re-checks below retain their historical evidence; the current runtime disposition is deferred, not resolved.

## Observation

Each child is a separate Pi process and normally loads built-in extensions, including MCP. Child arguments include `--tools` but no MCP startup opt-out (`subagent/index.ts:1917-1930`), and the child inherits the process environment (`:2011-2019`). MCP connects enabled servers on `session_start` without consulting the tool allowlist (`HOST/dist/extensions/mcp/index.js:840-873`). A restrictive allowlist prevents calls to excluded tools, but does not gate enabled-server startup in the inspected host.

Once an MCP server is enabled, concurrent delegation (audited user `subagents.maxConcurrency` 12; code default 5, hard cap 32 in `subagent/settingsState.ts:48, :53`) could create unnecessary subprocesses/connections for read-only children that cannot use those tools. This is a resource/lifecycle concern, not evidence of an allowlist bypass.

Inspect `subagent/index.ts` child argument/environment construction, `HOST/docs/cli.md`, `docs/mcp.md`, and `dist/extensions/mcp/index.js`.

## Next action: measure before choosing a fix

A counting fake transport through the public MCP extension factory can establish connection attempts without external capabilities. Use a disposable local mock stdio server when actual child-process startup and cleanup need measurement. Keep all configuration and markers in isolated approved scratch; do not copy real credentials.

Start a restricted child; assert its callable registry excludes MCP/codemode outside its allowlist, and record mock starts/connections, first-prompt delay, and observed shutdown/abort cleanup. An in-process transport test alone does not establish process cleanup.

Use bounded timeouts and existing child-process lifecycle tests. Do not enable the real IntelliJ server or any network service. Cover codemode/deferred/direct exposures separately because startup timing and waits differ. Existing synthetic allowlist tests are not startup measurements.

## Conditional remediation scope

Only after measurement shows material impact, choose a documented child-local way to suppress unneeded MCP loading when the effective allowlist excludes every MCP/discovery/resource capability. Allow MCP for children whose explicitly approved loadout needs it. A proposed opt-out must be tested with the actual child launcher before being treated as supported.

Do not change global/project mcp.json, copy credentials into scratch, disable all extensions (which removes local guards), or treat `--no-tools` as a server opt-out. Preserve project-trust behavior and owned-process cancellation.

If no suitably safe public child-only control is available, retain the measured limitation and consider a host enhancement or TDR. Do not invent a private flag or patch the host installation.

## Acceptance criteria by track

### Documentation and measurement

- Maintenance documentation distinguishes tool reachability from MCP startup and states the revisit trigger.
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

## Historical re-checks

### Re-check after 0005

0005 changes only local tool availability/activation. Source inspection confirms child CLI arguments/environment construction and built-in MCP loading were not changed. Public activation regressions verify restrictive child allowlists and direct child escalation, but do not measure server startup or connections. No disposable mock-server lifecycle test was run for this package; process amplification remains **inconclusive / verify-first**, and **Status remains Open**. No external server or personal MCP configuration was enabled or changed.

Existing transient-project-trust debt remains separate in [TDR-0002](../tdr/0002-propagate-transient-project-trust-to-subagents.md).

### Re-check after 0006

Source inspection confirms 0006 changes failure retention/rendering and catches a next-step preparation abort, but leaves child argument/environment construction, built-in MCP startup and process termination unchanged. Parent-executed subagent tests passed **149** and the final full gate **517** (TypeScript and host links valid); these include lifecycle/allowlist controls, not MCP startup measurements. No disposable mock-server lifecycle test or live MCP connection was run. The server-startup/connection acceptance criteria remain unverified, so **0015 remains Open / verify-first**; no related runtime fix or status promotion was made.
