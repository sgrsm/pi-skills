# Pi 1.4.0: compatibility

## At a glance

**No immediate action found within the checked scope.** The recorded audit found no reason to roll back or disable extensions. The red test gate is a maintenance problem, not a demonstrated production failure.

| Finding | Practical impact | What to do and when |
| --- | --- | --- |
| [Stale resume tests (C1)](#stale-resume-tests-c1) | Maintenance-only: unreliable regression gate | Fix before the next extension change. |
| [MCP footer parsing (C2)](#mcp-footer-parsing-c2) | Low: missing/stale indicator for BOM-prefixed config | Can wait until routine maintenance; sooner if the footer misleads you. |
| [Dialog guidance (D1)](02-simplification-and-debt.md#dialog-guidance-d1) | Maintenance-only: outdated collision warnings | Can wait; update with related docs/tests. |

No complete built-in replacement or immediate optional API adoption was identified. [Worker tuning remains deferred](03-api-opportunities.md#worker-capacity).

**Audit:** 20261024-143437 CEST (UTC+02:00); requested/verified target **1.4.0**. Reference **1.3.0** inferred from completed assessment through `a437cc1`, not confirmed upgrade history.  
**State at audit:** `0ea1be4cb8b1a49d1b812a7f4e2e5f9129a563dd`, initially clean; offline/source assessment complete, verification gate red (C1); category complete.  
**Editorial rewrite only:** recorded evidence and dispositions unchanged; no checks rerun.

[Simplification/debt](02-simplification-and-debt.md) · [API opportunities](03-api-opportunities.md)

C/D labels are compatibility/debt finding numbers, not severity scores. Recommendations below remain unapplied.

## Findings

### Stale resume tests (C1)

- **Impact/timing:** Repair validation before the next extension change. In [`sdk-resume.test.ts`](../../agent/extensions/pi-compatibility/sdk-resume.test.ts), one matrix assumes resumed branches cannot activate unrecorded local tools.
- **Evidence:** [Pi 1.4's restoration rule](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/src/core/agent-session.ts) activates default-active extension tools the branch never added or removed, unlike 1.3. Enabled clarify/search/subagent and an eligible child relay therefore appear earlier. Source comparison and SDK/CLI probes support high confidence: all 18 failures are 17 obsolete leaf assertions plus their parent. Depth, off, exclusion and model-only safeguards still hold; the scratch-only correction passes.
- **Recommendation:** Update exact construction/post-start/late-registration expectations, including the child relay, in that test and [coverage/startup guidance](../../agent/extensions/maintenance.md#tool-availability-at-startup). Keep production policy unchanged. Add default-inactive/recorded-removal controls and retain tree/reload, exclusions, depth denial and actual-CLI coverage; run focused suites and `npm run verify`. Exact historical-loadout enforcement is a separate workflow change, not the remedy.

### MCP footer parsing (C2)

- **Impact/timing:** Low, conditional display mismatch; ordinary maintenance is sufficient. Pi can load a valid config while the footer shows nothing or retains old server names.
- **Evidence:** [Pi 1.4 accepts a leading BOM](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/src/extensions/mcp/config.ts); 1.3 rejected it. Local [`parseMcpStatuses()`](../../agent/extensions/mcp-status/state.ts) still uses raw `JSON.parse()`. Recorded global/trusted-project probes and injected footer lifecycle checks reproduce empty/stale indicators. High confidence; the user's config was not inspected for BOMs.
- **Recommendation:** Strip one leading `\uFEFF` locally. Preserve trust/overrides, malformed-file caching and the configuration-only (not connection-health) meaning. Test BOM/no-BOM, untrusted-project exclusion, malformed JSON and cache transitions in `mcp-status/index.test.ts`, then typecheck/full verification. Saving without a BOM is a workaround; importing the private host parser adds unnecessary coupling.

## Validation

Recorded setup: Node **22.19.0**, npm **11.21.0**, TypeScript **6.0.3**, Darwin **25.6.0 arm64**. Launcher/package/running-process evidence matched 1.4.0. From `agent/extensions/`, `PI_HOST_PACKAGE_ROOT=$HOST`, where `HOST=<repo>/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent`; `TMPDIR` and `PI_PERMISSIONS_TEST_SCRATCH_ROOT` selected session-authorized 0700 scratch with `.step1-test-root-ready` and ownership/containment checks.

| Recorded check | Result / significance |
| --- | --- |
| Host-link sync/check | Five stale 1.3 links safely refreshed to verified 1.4-tree packages; check passed. |
| `npm run verify` | Typecheck passed; **881 passed, 18 failed, 899 total**. All failures are C1; no cancelled/skipped/TODO tests. |
| Resume phase/tree/restriction/reload and three CLI probes | Target expectations and withdrawal safeguards passed. Scratch-only corrected resume file: **78/78**; repository gate remains red. |
| Actual-host Clarify tests within the gate | **20 fullscreen + 6 regular** fake-terminal scenarios passed. |
| MCP/dialog probes | C2 mismatch and D1 stack restoration reproduced. MCP probe used a version-checked private reader only in scratch; no servers connected. |
| Loader/depth probe | All 12 extensions loaded without errors; pre-bind depth-capped call blocked and startup withdrew its declaration. |

## Coverage and gaps

All 12 runtime extensions were loaded/enabled; none disabled. Grouped recorded coverage:

- **clarify, web-search, subagent:** default on/on/saved `auto`; availability, exposure, prompt, policy and lifecycle checks passed apart from C1.
- **permissions, git-inspect, trash-history:** guards, read-only operations, scope/archive and confirmation controls passed; permissions default on.
- **mcp-status, response-timer, hide-tool-output, short-paths:** normal config/timing/wrapper/image/render/reload controls passed; last two saved on. BOM coverage is missing until C2.
- **handoff, codex-verbosity:** summary/thinking-omission and conservative direct-legacy payload controls passed.
- **Shared infrastructure:** dialog queue/cancellation, hidden withdrawal, footer/state helpers, structured prompts, host resolution and real-sandbox/catalog controls assessed; queue and withdrawal helpers remain necessary.

Live terminal/OSC dashboard, external editor, RPC picker/protocol, provider/router, MCP/OAuth and paid-child workflows were not validated. Child-MCP startup/cleanup, worker saturation, summary/cache quality and full custom-run scheduling remain unmeasured; offline/render fixtures are not hardware or live-service proof. Owning [coverage notes](../../agent/extensions/pi-compatibility/host-contract-coverage.md) retain precise limits.

Comparison provenance: the completed 1.3 follow-up recorded typecheck and **898/898** passes, not live acceptance. Earlier repairs remain complete; C1 is a different 1.4 rule. Original [release research](https://github.com/earendil-works/pi/releases/tag/v1.4.0) covered the reference-to-target interval with no intermediate release.
