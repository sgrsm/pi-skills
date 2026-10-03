# Pi extension compatibility work packages

Actionable backlog from the Pi **1.0.0** compatibility/regression audit of the local extensions in `agent/extensions/`. Each finding document contains enough context, evidence, proposed remediation, and acceptance criteria to serve as an implementation brief.

## Audit baseline and confidence

- Repository baseline: `49d40c286ea2800f7188e5d4b03bb940f7e2d9a1`.
- Host: `@earendil-works/pi-coding-agent@1.0.0`; Node `v22.19.0`.
- All five host dependency links were valid; TypeScript passed; **252 tests passed, none failed or skipped**.
- All 12 runtime extensions loaded through the actual Pi/jiti loader without errors.
- Existing passing tests do not cover every host integration boundary.
- **Reproduced** means an isolated probe using actual host methods/components, with synthetic state or fake terminal buffers—not an end-to-end live-terminal or enabled-MCP test.
- **Source-verified** means supported by local/host source, but not exercised end to end.
- **Verify first** means a lower-confidence review observation or optional improvement; reproduce before changing behavior.
- Findings include older gaps and latent configuration issues; they are not all regressions introduced in 1.0.0. The only configured MCP server was disabled.

The ten findings in the audit summary are covered below. Additional lower-priority review observations are retained as explicitly qualified work packages rather than silently promoted to confirmed bugs.

## Recommended order

| Order | Work package | Priority / evidence | Source | Status |
|---|---|---|---|---|
| 1 | [0001: visible, safe Trash confirmation](0001-trash-history-fullscreen-confirmation.md) | High / reproduced | Audit summary | Resolved |
| 2 | [0002: concurrent approval and clarification dialogs](0002-dialog-concurrency-and-cancellation.md) | High / permissions reproduced | Audit summary | Resolved |
| 3 | [0003: fullscreen clarify input and mouse ownership](0003-clarify-fullscreen-input.md) | Medium / input reproduced | Audit summary | Deferred |
| 4 | [0004: structured prompt contributions](0004-structured-prompt-contributions.md) | Medium / reproduced, MCP latent | Audit summary | Resolved |
| 5 | [0005: startup loadouts and MCP restoration](0005-tool-activation-and-mcp-restoration.md) | Medium / reproduced, MCP latent | Audit summary | Resolved — local fix; host resume issue in TDR-0004 |
| 6 | [0006: failed subagent results and usage](0006-subagent-failure-results.md) | Medium / public-host regression reproduced | Audit summary | Resolved — residual orchestration debt in TDR-0005 |
| 7 | [0007: nested-call file lists in handoffs](0007-handoff-nested-file-operations.md) | Medium / confirmed in-memory | Audit summary | Resolved |
| 8 | [0008: short-paths state across loader instances](0008-short-paths-loader-state.md) | Medium / reproduced | Audit summary | Resolved |
| 9 | [0009: wrapped built-in configuration contracts](0009-wrapped-built-in-configuration.md) | Low–medium / reproduced test-first | Additional observation | Resolved |
| 10 | [0010: MCP footer parsing and exposure drift](0010-mcp-status-config-drift.md) | Low / source-verified | Audit summary | Resolved |
| 11 | [0011: Codex provider and virtual-model coverage](0011-codex-verbosity-provider-coverage.md) | Low / test-first local regressions | Audit summary | Resolved — local coverage fix; host API enhancement in TDR-0006 |
| 12 | [0012: visible Git preview/expansion](0012-tool-rendering-expansion.md) | Low / source-verified UX gap | Additional observation | Open — narrowed; hide-refresh limitation accepted |
| 13 | [0013: footer presentation and docs](0013-footer-lifecycle-and-theme-drift.md) | Low / definite corrections; lifecycle verify-first | Additional observation | Open — presentation/docs only; lifecycle deprioritized |
| 14 | [0014: shared/custom session cleanup scope](0014-trash-history-custom-session-directory.md) | Medium in shared storage / source-verified, latent | Additional observation | Open — project safeguard; all-projects policy undecided |
| 15 | [0015: unnecessary MCP startup in children](0015-subagent-mcp-startup.md) | Low / startup source-supported; impact unmeasured, latent | Additional observation | Deferred — runtime; maintenance note actionable |
| 16 | [0016: tool annotations and permission boundaries](0016-tool-annotations-and-permission-scope.md) | Low / documentation gap; metadata optional | Additional observation | Open — permission docs first |
| Host follow-up | [TDR-0004: SDK/CLI resume tool restoration](../tdr/0004-sdk-cli-resume-tool-restoration-host-defect.md) | Medium / reproduced without local extensions | 0005 resume validation | Open — confirmed host defect |
| Local debt follow-up | [TDR-0005: orchestration failure accounting](../tdr/0005-subagent-orchestration-failure-accounting.md) | Medium / parallel cancellation reproduced; exceptions verify first | 0006 review | Open |
| Host API follow-up | [TDR-0006: physical provider-request identity](../tdr/0006-provider-request-physical-model-identity.md) | Low / source-verified API limitation | Codex coverage | Open — enhancement deferred |

0003 was reconfirmed on Pi 1.0.0. Its custom-overlay approach exposed unsafe stacked/pre-install completion in the host; the user chose to defer the runtime fix pending a host correction. Only characterization coverage/docs were retained; the original defect remains. See the finding for final validation (**342 tests**, TypeScript) and the actual-host scratch probe.

0004 was confirmed and resolved on Pi 1.0.0: clarify, permissions and subagent now contribute stable structured sections instead of forcing the whole prompt. Public loader/runner regressions preserve late MCP/extension guidance, modes, owned removal, same-id reload and deliberate foreign forces. Final verification: **356 tests passed**, valid host links and TypeScript; a version-checked scratch builder/differ probe verified unchanged-turn/no-delta, owned removals and scratch-only replacement. Two independent read-only reviews led to test/docs refinements, not further runtime changes. No provider cache measurement or real MCP connection was used. At that stage **0005 remained Open**: its independent startup-restoration loss still reproduced; the subsequent resolution is recorded below. See 0004 for evidence, limits and related rechecks.

0005's **local extension defect** was confirmed by read-only source review and parent-run public-host regressions, then resolved with approved hidden re-registration for unavailable tools. Eligible model-only/direct exposure, global defaults and restrictive CLI/child allowlists remain; explicit off commands may still replace restoration. All saved off-mode combinations preserve late synthetic tools on constructor-level restoration and reload; tree restoration is also covered. An independent read-only review found no blocking runtime defects and led to coverage/documentation refinements. The first local-fix verification gate passed **456 tests** before the SDK/CLI follow-up. Final combined validation after that follow-up: **476 tests passed**, valid host links and TypeScript; focused **180**, subagent **108**, and resume **20** passed. The resume count includes open-host-defect characterizations plus a positive tree control, not positive SDK/CLI restoration. Both read-only review outcomes and actual validation are recorded in 0005. Detailed outcomes and limits are recorded in 0005. Its missing SDK/CLI resume check was subsequently completed: both public SDK creation and actual bundled CLI startup reproduce a separate host omission **without the local extensions**. The user approved closing the local fix and tracking that host defect as **Open in TDR-0004**. End-to-end resumed-tool restoration remains broken on Pi 1.0.0; passing the new characterization tests does not fix it. 0004 stayed Resolved; 0009 and 0015 stayed Open after qualified re-checks. No live MCP connection or personal configuration change was used.

0006 was confirmed by a read-only scout (source inspection only), reproduced test-first with mocked children through public `runToolCall`, and resolved for completed single/chain failures and cancellation between steps/preparation. Error results retain diagnostics and exactly-once reported usage; safe renderer fallback and legacy saved-usage display are covered. A fresh independent reviewer requested four focused corrections; the parent reproduced and fixed the cancellation window, terminal waiting rows and legacy-rendering regression, and narrowed parallel-cancellation docs. Final validation: **41 focused**, **149 subagent**, **134 related-contract**, and **517 full-gate tests passed**, valid five host links and TypeScript; none failed/cancelled/skipped. The reviewer inspected source/logs but did not execute tests or re-review the remediated state. 0004/0005 remain Resolved in their existing scopes; 0015 and TDR-0004 remain Open. No live provider/MCP/TUI billing check was run. The user approved closing the completed-child scope and tracking residual orchestration debt in standalone [TDR-0005](../tdr/0005-subagent-orchestration-failure-accounting.md), which distinguishes confirmed parallel cancellation from source-only exception/UI observations and does not depend on temporary findings. Unreported usage remains an inherent limit. See 0006 for evidence and review reconciliation.

0007 was confirmed by a read-only scout (source inspection only), reproduced test-first by the parent and resolved on Pi 1.0.0. Handoff now collects direct and nested read/grep/edit/write attempts with shared normalization and exposes known bounded-record loss in prompts/documents. Current-branch projection, tagged summaries, model-selected lean file lists and the 12-file fallback cap remain. A fresh independent read-only reviewer found no blockers; its suggestions led to typed-contract and notice tests/docs refinements, not more runtime changes. Final validation: **22 focused and 535 full-gate tests passed**, TypeScript and five host links valid, none failed/cancelled/skipped; an inline version-checked actual-host recorder probe also passed. The first full attempt failed only on the macOS scratch-path alias; using the canonical approved root for both environment variables fixed it without code/config changes. Both subagents executed no tests. 0017's handoff recommendation was updated; 0009/0016 remain Open after qualified source rechecks. No live provider/MCP/TUI/codemode run or real handoff mutation was used. See 0007 for executed results, review reconciliation and bounded-record limitations.

0008 was confirmed by a read-only scout (source only), reproduced test-first through the public Pi/jiti loader, and resolved with committed-state events, per-runtime caches and public row-local invalidation. A fresh independent reviewer found no critical defects; its callback-lifetime and coverage findings led to weak row-owned registrations and real host-component regressions, including test-first same-id and reused-factory corrections. Final validation: **17 focused, 26 related and 547 full-gate tests passed**, TypeScript and five valid host links; none failed/cancelled/skipped. A version-checked scratch GC probe collected 24 discarded actual host rows while preserving one live redraw. Both subagents executed no tests, and the reviewer did not re-review the remediated state. 0012 remains Open except for its verified `/short-paths` refresh portion; 0009 stays Open after source recheck; 0017's recommendation was updated without retirement approval. No live terminal/provider/MCP checks or personal configuration changes were made. See 0008 for evidence, review reconciliation and limits.

0009 is Resolved: native file-wrapper selection and effective image options are corrected. See [0009](0009-wrapped-built-in-configuration.md#resolution-and-validation) for confirmation, independent review, validation and limits.

0010 is Resolved: MCP footer normalization and conservative configuration projection are corrected; see [0010](0010-mcp-status-config-drift.md#resolution-and-validation) for evidence and retained limits.

Order reflects actual exposure in the audited configuration, not severity alone. Shared custom storage or opening/resuming a session from a shared directory increases 0014's exposure. Update Status to Resolved, Closed-not-reproduced, or Deferred with evidence in the owning document.

For the remaining 0012–0016 work, prioritize 0014's minimal project-identity safeguard, 0016's permission-boundary documentation, and 0013's definite color/docs corrections. Git preview and owned-tool hints are low-priority follow-ups. 0015's runtime work is deferred pending isolated impact measurement before routine MCP use; its maintenance limitation can be documented now.

Each owning document now distinguishes actionable work, accepted behavior, and verify-first observations. Historical re-checks in the index and findings retain their original evidence, not an instruction to implement superseded scope. These dispositions do not claim new runtime fixes or validation. Before changing 0014 all-projects behavior, explicitly select its storage policy; the current-project safeguard can proceed independently. Use TDRs for meaningful intentionally deferred debt, not every cosmetic mismatch or intended behavior.

[0017: built-in feature overlap](0017-extension-feature-overlap.md) records the retirement assessment. It is a completed assessment, **not** an instruction to disable extensions.

## Change-set boundaries and parallel work

Keep one document's closely related fixes together: all three structured-prompt contributors in 0004; all startup-deactivation paths in 0005; subagent error accounting plus error rendering in 0006; MCP alias/validation/display parity in 0010.

Independent documents need not be combined merely because they touch one extension. Avoid concurrent edits to the same files; overlapping owners are:

- clarify: 0002, 0003, 0004, 0005.
- permissions: 0002, 0004; 0016 also touches its documentation.
- subagent: 0004, 0005, 0006, 0015.
- web-search: 0005, 0016; 0013 may touch idle status refresh.
- hide-tool-output: 0008, 0009, 0012.
- short-paths: 0008, 0012.
- git-inspect: 0012, 0016.
- mcp-status: 0010, 0013.
- trash-history: 0001, 0014.

Finish 0002 before subsequent edits to clarify in 0003/0004/0005. Address 0005 before or alongside 0009 because both involve tool activation. Other shared-file work should use sequential implementation or explicit ownership coordination, not concurrent uncoordinated edits.

TDR-0004 is a **host-owned** follow-up, not authorization to patch the installed Pi package or add a local restoration workaround. Fix it in a separately authorized Pi source checkout/upstream change while preserving selection and trust boundaries. 0005's local fix does not depend on such a patch, but end-to-end resume restoration does.

Existing unrelated debt remains in [`tdr/`](../tdr/README.md); do not duplicate or opportunistically implement it.

## Agent quickstart

Example prompt:

> Implement `fixme/0001-trash-history-fullscreen-confirmation.md`. Read `fixme/README.md`, add focused regression tests first, preserve the stated scope, and report validation. Do not commit or change personal settings.

For any work package:

1. Read repository guidance, the owning extension README, and `agent/extensions/maintenance.md`.
2. Re-read the currently installed Pi documentation and declarations. Audit line numbers below refer to the baseline; search by named symbol if they moved.
3. Reproduce the issue without changing real user state. For verify-first items, narrow or close the finding with evidence if it no longer holds.
4. Add the smallest practical failing `node:test` regression before executable changes. Use owning tests for feature behavior and `pi-compatibility/` for host/cross-extension contracts.
5. Implement only the selected package. Preserve trust policy, tool exposure/allowlists, Priority 0 hard denials, bounded output, and session cleanup.
6. Update directory-local READMEs for changed usage or expectations. Record resolution and actual validation in the finding document and this index; retain the history.
7. Ask the user only if the desired outcome requires a material choice not settled by the package. Do not broaden security policy, provider support, or extension retirement implicitly.

### Host references

The audited host was installed at:

`/Users/sergey/.nvm/versions/node/v22.19.0/lib/node_modules/@earendil-works/pi-coding-agent`

Documents use **HOST** for that package root. Locate the current host instead of assuming that path remains valid. Read relevant `HOST/docs/*.md` completely and consult `HOST/examples/`. Use host internals to understand/reproduce contracts, not as production extension imports. Check dependencies before changing links; do not run `sync:pi-host-deps` unless necessary and authorized.

### Test-seam policy

Committed regressions should prefer local exported helpers and public host APIs, for example `ExtensionRunner`, `AgentSession`, `createAgentSession*`, `discoverAndLoadExtensions`, `ExtensionSelectorComponent`, and pi-tui's `TuiAltScreen`. Check the current package exports before choosing a seam. Existing `pi-compatibility` tests use local imports and a fake `ExtensionAPI`; preserve that portability where it adequately captures the contract.

Several reproduction recipes name private host functions (`loadExtensions`, `loadExtensionFromFactory`, `buildSystemPrompt`, `createChatViewport`, `renderLayoutFrame`). Those are **optional host probes**, not instructions to add unsupported package subpath imports. Resolve the currently installed host root from the extension package's module resolution/host link, use `pathToFileURL` for an explicit file import, and never commit the absolute nvm path. Isolate/version-check private probes and report missing seams explicitly.

If no portable public integration seam exists, commit a faithful local contract regression and retain the private-host probe in approved scratch as supplementary evidence. A missing private seam may skip that optional probe with a reason; it must not silently skip required behavior regressions or justify production imports of private host internals.

### Validation and scratch safety

Run commands from `agent/extensions/`. Focused commands are given per finding. Before any filesystem-mutating test, follow [safe test scratch setup](../agent/extensions/permissions/README.md#safe-test-scratch-setup).

Use an explicitly approved, private, real, current-user-owned session scratch root outside HOME/repository/cwd. It must contain the caller-created `.step1-test-root-ready` sentinel. The permissions fixture requires `PI_PERMISSIONS_TEST_SCRATCH_ROOT`. Also set `TMPDIR` so ordinary `mkdtemp(tmpdir())` fixtures in other tests stay inside that approved root:

```bash
export PI_PERMISSIONS_TEST_SCRATCH_ROOT="<approved scratch root>"
export TMPDIR="$PI_PERMISSIONS_TEST_SCRATCH_ROOT"
cd agent/extensions
npm run verify
```

Do not use HOME, the repository, or real session/MCP configuration as a fixture. Do not run live Trash operations, paid model calls, real dependency installs, or enabled external MCP servers just to reproduce these findings. Mock external operations or use disposable scratch fixtures. Preserve all existing Git history and user data.

Original optional artifacts were retained under:

`/var/folders/br/m0tzwhrx6t77qjyr7846jwyc0000gn/T/pi/session-01a0fee5-284d-7732-80fa-3294f2f91b91/compatibility-check/`

Files: `verify.log`, `runtime-probes.mjs`, `runtime-probes.log`, `ui-probes.mjs`, `ui-probes.log`. These are ephemeral evidence, not prerequisites; each finding describes how to reconstruct its probe.
