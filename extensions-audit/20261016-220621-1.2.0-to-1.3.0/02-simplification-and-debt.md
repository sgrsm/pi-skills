# Pi 1.2.0 → 1.3.0: simplification and debt

## Assessment context

- **Run:** `20261016-220621`, 2026-10-16 22:06:21 CEST (UTC+02:00).
- **Versions:** requested baseline **1.2.0**, requested target **1.3.0**; managed selector, executed CLI, running-process evidence and target package identify **1.3.0**.
- **Baseline provenance:** explicit user-supplied upgrade interval; installed 1.2.0 source and the retained 1.2.0 comparison evidence in the compatibility document provide bounded support, not an inferred upgrade history.
- **Repository at audit:** `main`, HEAD `aed4ee4f6bab6e60b021beff9940b9f0b9b661c8`; initially clean and synchronized with upstream.
- **Current disposition:** this is the consolidated retained assessment for Pi 1.3.0. Documentation follow-up `00a5366` is reflected below; no executable fixes or new runtime validation are claimed by this consolidation.
- **Overall status:** **Partial assurance:** the full documented gate and positive diagnostics were executed, but the retained gate is red and extended/live acceptance remains incomplete. All three report categories were assessed and saved.
- **Category status:** all 12 runtime extensions, documented limitations/workarounds and all six TDR records assessed within source/offline scope. Two host prerequisites improved; TDR documentation is aligned, but no TDR closure or extension retirement is established.
- **Sibling reports:** [Compatibility and canonical validation](01-compatibility.md) · [API opportunities](03-api-opportunities.md).

## Result and priorities

- **TDR-1202 is host-unblocked on the checked core seams:** SDK and actual CLI `--session` restore the selected late declarations, with and without local extensions. Remaining acceptance/documentation work prevents closure.
- **TDR-1201 is partially addressed and its identity-safe completion prerequisite is unblocked:** an actual-host probe confirms the 1.3 fix. Local selector migration, scrolling/layout and wider lifecycle validation remain.
- **No complete shipped-and-enabled built-in replacement was found.** No runtime extension is recommended for retirement because of 1.3.0.
- Documentation follow-up `00a5366` updated the TDR statuses and guidance described below. Other TDRs retain their constraints; no runtime/test repairs or TDR closures were part of that follow-up.

### Retained baseline benefit: Handoff serialization

Since [Pi 1.2.0](https://github.com/earendil-works/pi/releases/tag/v1.2.0), the public `serializeConversation()` omits thinking blocks. [Handoff](../../agent/extensions/handoff/index.ts), `summarizeWithModel()`, already calls `serializeConversation(convertToLlm(messages))`; the earlier synthetic baseline/target probe confirmed thinking omission while retaining the visible answer. Keep that supported helper rather than adding local filtering. A focused summary-input regression remains optional; no live summary-quality or token-saving magnitude was measured. This is an inherited benefit, not a new 1.3 finding or runtime migration.

## Upgrade-enabled debt work

### D1 — Medium priority: finish local acceptance and documentation for restored resume tools

**Primary owner:** [TDR-20261009-1202](../../tdr/20261009-1202-sdk-cli-resume-tool-restoration-host-defect.md). Consumers: clarify/web-search/subagent availability, late MCP-like tool declarations and resume/loadout documentation.

**Released change and proof:** [Pi 1.3.0](https://github.com/earendil-works/pi/releases/tag/v1.3.0), [10785](https://github.com/earendil-works/pi/issues/10785), restores transcript tool declarations during ordinary/default-selection construction. Baseline and target `sdk.js`/`agent-session.js` explain the change: restoration now follows `usesDefaultTools`, with CLI modifiers applied to the restored names. All four positive durable diagnostics now pass:

| Positive core requirement | 1.2 comparison evidence | Executed 1.3 result |
| --- | --- | --- |
| Reopened SDK transcript, host only | Previous version-bound diagnostic/source failure | Pass |
| Reopened SDK transcript, local extensions all off | Previous version-bound diagnostic/source failure | Pass |
| Actual bundled CLI `--session`, host only | Previous version-bound diagnostic/source failure | Pass |
| Actual bundled CLI `--session`, local extensions all off | Previous version-bound diagnostic/source failure | Pass |

In each target case, the active set after late registration equals recorded `read` plus inactive direct/deferred/codemode synthetic tools. `defaultActive: false` prevents ordinary registration from faking restoration. No provider request or MCP connection was needed.

**User-visible benefit:** tools selected on the active session branch no longer disappear solely because SDK/CLI construction discarded their pending names. The local hidden-withdrawal helper can now preserve names that the host actually seeds. This does not imply every custom extension leaves the selected loadout unchanged: current local saved-on handlers intentionally add clarify/search/subagent during startup, as measured in [C1](01-compatibility.md#c1--p1-adapt-resumeactivation-fixtures-to-restored-selection-semantics).

**Current disposition and remaining plan:** documentation follow-up `00a5366` marked the host prerequisite fixed, moved TDR-1202 out of `blocked/` and aligned the current limitation notices; the record remains open. Repair C1, retain phase-specific startup policy tests and add resume-specific restrictive/CLI lifecycle controls. Promote the four verified positive resume requirements into the normal gate, avoiding duplicated fixtures; keep uncompleted criteria explicit. No private pending-state workaround or host patch is needed.

**Required remaining acceptance:** full retained gate; actual CLI resumed modifiers/allowlists/exclusions/no-tools/no-builtins; selected-local off/depth/relay withdrawal; relevant continue/resume/runtime-switch/fork seams; focused independent review of the final changes. Eight scratch SDK selection cases pass, and the scratch-corrected activation suite passes 100/100, but those do not substitute for all durable/actual-CLI criteria. The canonical [validation record](01-compatibility.md#canonical-validation-record) provides the exact scope.

**Alternatives:** leave the diagnostic separate until all acceptance work is complete, which is reversible but keeps a known-fixed core requirement outside the normal success gate; or close immediately based on the four passes, which would overstate the remaining matrix and is not recommended. A local private-pending-state workaround or host patch is unnecessary and would add risk. Preserve the shared availability helper, model-only boundaries, explicit restrictions, and intentional user toggles.

**Confidence:** high that the original core construction defect is fixed on the executed seams; incomplete evidence for full TDR closure.

### D2 — Medium priority: revisit the supported Clarify overlay remedy

**Primary owner:** [TDR-20261009-1201](../../tdr/20261009-1201-clarify-fullscreen-input-host-blocker.md). Consumers: `clarify/index.ts`, `showClarifySelector()`, shared cancellable custom UI and owning documentation.

**Released change:** [PR 10999](https://github.com/earendil-works/pi/pull/10999), shipped in [1.3.0](https://github.com/earendil-works/pi/releases/tag/v1.3.0), makes custom-overlay completion hide the interaction's owned handle instead of the topmost overlay. The actual method, not just the copied fixture, was invoked on both installed versions with public fake-terminal TUI state.

**Acceptance split:**

- **Improved and behaviorally verified:** normal mounted completion still disposes once and restores editor focus; target completion under stacked transcript search removes the owned dialog and preserves search focus; synchronous/microtask pre-install completion no longer steals an unrelated overlay. The existing local cancellable helper with actual target completion also preserves the unrelated overlay and disposes once on pre-install abort.
- **Still local responsibility:** raw host completion does not dispose a never-installed component in either version. The existing wrapper supplies this cleanup; do not remove it because overlay ownership improved.
- **Still failing in production:** PageUp/PageDown/wheel route to the transcript, help can clip at 80×24, and regular mode still toggles terminal mouse modes. Clarify still uses the non-overlay dock. No runtime migration was applied.
- **Still unverified:** complete small/narrow/height-only/width-resize/repeated-dialog matrix; all stacked/cancel/reload/shutdown cases in the eventual production integration; live terminal/trackpad behavior.

**Recommendation and smallest feasible remedy:** first repair the diagnostic adapter under [C2](01-compatibility.md#c2--p2-stop-diagnosing-the-old-host-overlay-close-algorithm). Then, in separately authorized test-first work, let the cancellable custom helper forward supported custom options, use `ctx.ui.custom({ overlay: true })` for the selector, consume normalized mouse events and budget layout against actual available bounds. Complete via the supplied callback, not direct `OverlayHandle.hide()` calls from extension code. Keep exactly-once completion/disposal, the permissions/clarify FIFO, RPC/basic UI and no-UI/model-only safeguards unchanged. Do not arbitrarily hide description detail that fits.

**Alternatives:** retaining the dock is the lowest-risk deferral but leaves the acceptance failures. An extension-owned raw overlay controller remains more code and lifetime responsibility than using the now-correct supported completion flow; it is not the recommended first approach. Switching to basic selectors would sacrifice current long-context/preview/custom-answer features and is a workflow change, not a parity replacement.

**Record update completed:** `00a5366` moved TDR-1201 out of `blocked/` and separated the fixed identity-safe host prerequisite from remaining local input/layout/cleanup work. The record and unresolved user warnings remain open. Do not mistake two stale-adapter failures for continuing target host ownership failure, or treat the documentation update as selector remediation.

**Confidence:** high for the host ownership correction and resulting feasibility; provisional for the unimplemented local overlay design. Fake-terminal evidence is not live terminal acceptance.

## Every TDR disposition

The index is context, not a debt record. All owning records under both `tdr/` and `tdr/blocked/` were read, including their acceptance and safety criteria.

| TDR | Disposition on 1.3.0 | Evidence and remaining work | Current record / remaining action |
| --- | --- | --- | --- |
| [1200: transient child project trust](../../tdr/20261009-1200-propagate-transient-project-trust-to-subagents.md) | **Still valid / open** | Canonical child-boundary and external denial controls pass. Child args still transmit external denial, not the contained parent's transient trust decision. Both releases already support `--approve`; there is no interval unblock. | Retain status. Before local work, settle precedence for contained untrusted parents and nested trusted scopes because explicit `--approve` overrides child trust handlers/saved/default decisions. Preserve external/unresolved/symlink-escape `--no-approve`; add transient/persisted/default/denied tests. This is existing debt, not an upgrade finding. |
| [1201: safe fullscreen Clarify](../../tdr/20261009-1201-clarify-fullscreen-input-host-blocker.md) | **Partially addressed / identity-safe host prerequisite unblocked** | Actual target method fixes owned removal/search preservation/pre-install unrelated-overlay theft; local wrapper still needed for pre-install disposal. Five production requirements still fail; full local remedy/resize/live acceptance incomplete. | Record now reflects D2's host-versus-local split and is outside `blocked/`. Keep remaining acceptance and safety boundaries; C2 owns the adapter repair. Do not close. |
| [1202: SDK/CLI resumed loadout](../../tdr/20261009-1202-sdk-cli-resume-tool-restoration-host-defect.md) | **Unblocked; core host defect resolved on checked seams, closure pending** | Four positive durable SDK/actual-CLI cases pass. Source supports selection precedence. Eight extra host-only SDK cases and corrected constructor controls pass; retained gate is red under C1, and broader actual-CLI/lifecycle criteria remain. | D1: record now has fixed-core/remaining-acceptance status and is outside `blocked/`; promote verified checks after test repair. No local pending-state workaround. |
| [1204: physical provider-request identity](../../tdr/blocked/20261009-1204-provider-request-physical-model-identity.md) | **Still valid / still blocked** | Target `BeforeProviderRequestEvent` still has only `type,payload`; SDK `transformProviderPayload` and runner still discard physical model identity available below that seam. Provider selection ambiguity and later stream identity do not supply pre-request physical identity. No fake/live routed-request acceptance executed. | The record now includes 1.3 source revalidation and remains blocked. Keep conservative Codex direct-legacy gate; identity is not verbosity capability. Proposed host fake-adapter/direct/virtual/router/concurrency criteria remain. |
| [1205: Trash all-projects storage policy](../../tdr/20261009-1205-trash-history-all-projects-storage-policy.md) | **Still valid / policy decision pending** | Readonly manager still has no supported effective-configured-root provenance. `getSessionDir()` may be an opened file's parent; `usesDefaultSessionDir()` remains absent from readonly context despite existing on the full class. Current scope/safety tests do not select a policy. | Retain the three unselected branches. Recommend conventional-only scope as the bounded default for a later decision; custom support needs supported root/traversal evidence, refusal needs provable scope. Align help/preview/confirmation/docs only after approval. No real Trash/session action. |
| [1206: custom-dialog blocked program status](../../tdr/blocked/20261009-1206-custom-dialog-blocked-status.md) | **Still blocked; record wording clarified** | Standard host selectors/inputs/editors set `ProgramStatusReporter` blocked state; `showExtensionCustom()` still does not. Its public options expose no scoped/arbitrated blocked metadata. The 1.3 overlay close fix is unrelated. No live dashboard proof. | The record now states the missing scoped/arbitrated integration, distinguishes the low-level setter and includes shared custom-answer users. Retain blocked status and privacy/displayed-lifetime/arbitration acceptance. This precision correction is not an upgrade defect. |

The docs-only follow-up updated/moved TDR-1201/1202, added 1204 revalidation and clarified 1206. No TDR was closed and no runtime or test implementation was changed. Host unblock, local remediation and record closure remain separate outcomes.

## Built-in overlap and retirement screen

Target built-ins were assessed as relevant host dependencies/replacement candidates, not as a separate general audit. No extra package was installed or assumed to be an enabled substitute. The user uses native codemode through `defaultTools`; no configured third-party replacement parity was established.

| Extension | Native overlap / classification | Remaining local value and recommendation |
| --- | --- | --- |
| clarify | Standard dialogs: **partial overlap** | Long context, previews, custom answers, model-only guidance and session FIFO remain. D2 is a supported-host integration improvement, not retirement. |
| permissions | Native tool events/annotations: **not a policy replacement** | Concrete P0/path/Git/dependency guards, grants and scratch remain local. Annotations are not verified authorization. |
| subagent | SDK/processes and extension examples: **not a complete bundled replacement** | Discovery, trust/approval, scheduling, relay, accounting and process termination remain. Codemode worker admission is not subagent concurrency. |
| git-inspect | Bash can invoke Git: **not equivalent** | Fixed read-only operations, conservative argument validation, bounded capture and dedicated display remain. |
| web-search | Potential MCP search: **not an enabled equivalent** | Current SearXNG tool/toggle/format/truncation/persistence workflow has no verified shipped replacement. |
| handoff | Native compaction/continuation/share: **partial overlap** | Persistent handoff documents, explicit selection, continue warning and fallback workflow remain. New share destination does not replace them. |
| codex-verbosity | Adapter-level verbosity passthrough: **partial overlap** | No verified provider-neutral setting covers the supported legacy workflow; physical identity and capability remain separate. |
| mcp-status | Native `/mcp`: **partial overlap** | Persistent effective-config footer is intentionally not live health/connection management. |
| response-timer | Native per-tool/codemode timing: **partial overlap** | Whole-response lifecycle/final footer duration is different. |
| trash-history | Native per-session deletion: **partial overlap** | Age-filtered batch preview, named/active protection, archive verification and macOS Trash policy remain. |
| hide-tool-output | Native collapse/expand: **partial overlap** | Persistent hiding and summaries, including permissions-owned Bash integration, remain. |
| short-paths | Native path formatting and new read-range formatter: **partial overlap** | Toggle, smart fitting and cross-renderer state remain; adopt the small formatter under A1, not whole-extension removal. |

Retirement would require a separate workflow authorization, reversible disable-first trial and dependent-integration validation. Preserve preferences, handoff files, sessions and archives. The audit does not authorize deletion or disabling.

## Documented limitations and workaround coverage

These are coverage rows, not repetitions of unchanged debt as new findings.

| Limitation/workaround surface | Target assessment |
| --- | --- |
| Clarify fullscreen dock input/layout; regular-mode mouse handling; shorter-question/regular-mode workaround | D2 changes the host prerequisite, not production behavior. Preserve unresolved user warnings until local remediation is validated. |
| Copied close adapter and fixed-dock layout fixtures | C2 is new diagnostic drift; actual close was independently probed. Baseline/target fixed-dock composition has no relevant interval change. Keep fake-terminal limits explicit. |
| Shared FIFO only for clarify/permissions; other approvals/handoff/Trash not enrolled | Still needed; no new host global dialog serialization. Preserve collision warnings and scope cancellation. Identity-safe overlay removal does not serialize ordinary dialogs. |
| Cancellable in-Pi editor, disabled external-editor shortcut; RPC placeholder/basic input and stale visible RPC dialog | No new abort-aware external editor or RPC dismissal contract found. Preserve backend cancellation/late-reply protection and no-UI fail-closed handling. |
| Optional-tool hidden withdrawal and additive startup activation | Still necessary. D1 repairs the host's seed step, not local off/depth/exclusion policy. Startup additions require phase-aware coverage under C1; do not replace hidden withdrawal with subtractive startup reconciliation. |
| Structured prompt sections and deliberate whole-prompt overrides | User/custom runner matrix passes. Whole-prompt overrides still can hide additive guidance. Actual custom-run scheduling/provider-cache coverage remains bounded, unchanged. |
| Permission best-effort shell/path classification, custom-shell forwarding, custom/MCP boundary and filesystem races | Unchanged. New malformed-argument rejection is native defense in depth, not a sandbox or authorization expansion. Keep P0 and concrete guards. |
| Subagent transient trust, child MCP startup/performance, process/output/recovery/accounting limits | Existing tests pass; transient trust remains 1200. Codemode worker fixes do not remove child process-tree cleanup or output limits. No live provider/MCP child performance test. |
| Codex direct legacy-only support and selected/physical identity | 1204 remains blocked; no safe basis to expand provider support. |
| Trash conventional root, project-header identity, last-pathname race and archive/Trash prerequisites | 1205 remains open. Current-project protections pass; no custom-root promise or permanent-delete path is authorized. |
| MCP config-only projection, extension-registered servers absent, no connection validation | Unchanged; native `/mcp` remains complementary. No live server fixture. |
| Precolored footer strings refresh on next write; speculative setup-error/stale-context timer observations | No new scoped theme/status callback removes the limitation. Keep existing refresh triggers; no reachable lifecycle regression established. |
| Wrapper/short-path state bus, native selection/image parity, row invalidation, live/GC/edit-preview gaps | Normal controls pass; small public-helper opportunity A1 is separate. Do not replace the state bus or strip row invalidation based on a range-label fix. |
| Git Inspect hide toggle display lifetime; search service/full-output persistence; Handoff model summary/fallback limits | No released replacement/remedy in this interval. Local focused tests pass, not live workflow acceptance. |

## Recommended order

1. Restore trustworthy retained validation with C1/C2, without weakening requirements or changing activation policy silently.
2. Finish D1's durable resume acceptance and version-bound documentation, then reconsider TDR closure.
3. Implement D2's now-feasible supported overlay remedy only with separate approval and test-first lifecycle/input/layout coverage.
4. Adopt A1 independently when touching read renderers; retain all extensions unless a separate workflow decision authorizes a reversible retirement trial.

Exact commands, evidence strength and skipped acceptance are recorded once in [Compatibility](01-compatibility.md#canonical-validation-record). No green full-gate, live-terminal/provider/MCP, or complete TDR-resolution claim is made here.
