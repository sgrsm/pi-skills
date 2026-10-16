# Pi 1.2.0 → 1.3.0: simplification and debt

## Assessment context

- **Run:** `20261016-220621`, 2026-10-16 22:06:21 CEST (UTC+02:00).
- **Versions:** requested baseline **1.2.0**, requested target **1.3.0**; managed selector, executed CLI, running-process evidence and target package identify **1.3.0**.
- **Baseline provenance:** explicit user-supplied upgrade interval; installed 1.2.0 source and the retained 1.2.0 comparison evidence in the compatibility document provide bounded support, not an inferred upgrade history.
- **Repository at audit:** `main`, HEAD `aed4ee4f6bab6e60b021beff9940b9f0b9b661c8`; initially clean and synchronized with upstream.
- **Current disposition:** implementation follow-up is tracked in the [remediation record](01-compatibility.md#implementation-follow-up). Audit-time observations below remain historical unless explicitly superseded there.
- **Overall status:** required validation repairs and upgrade-enabled resume/Clarify remediation are complete; the integrated normal gate is green. API adoption and optional verification dispositions are tracked in the remediation record. Live hardware/provider/MCP acceptance is explicitly unclaimed.
- **Category status:** D1/D2 acceptance is complete and TDR-1202/1201 are deleted with concise closure evidence below. Other TDR constraints and all defer/skip/retirement decisions are unchanged.
- **Sibling reports:** [Compatibility and canonical validation](01-compatibility.md) · [API opportunities](03-api-opportunities.md).

## Result and priorities

- **TDR-1202 is resolved and deleted:** the core host correction and local acceptance/documentation are complete; [D1](#d1--medium-priority-finish-local-acceptance-and-documentation-for-restored-resume-tools) preserves closure evidence and limits.
- **TDR-1201 is resolved and deleted:** the supported overlay remedy and independent input/layout/lifecycle acceptance are complete; [D2](#d2--medium-priority-revisit-the-supported-clarify-overlay-remedy) preserves closure evidence and live-hardware limits.
- **No complete shipped-and-enabled built-in replacement was found.** No runtime extension is recommended for retirement because of 1.3.0.
- Documentation follow-up `00a5366` updated the TDR statuses and guidance described below. Other TDRs retain their constraints; no runtime/test repairs or TDR closures were part of that follow-up.

### Retained baseline benefit: Handoff serialization

Since [Pi 1.2.0](https://github.com/earendil-works/pi/releases/tag/v1.2.0), the public `serializeConversation()` omits thinking blocks. [Handoff](../../agent/extensions/handoff/index.ts), `summarizeWithModel()`, already calls `serializeConversation(convertToLlm(messages))`; the earlier synthetic baseline/target probe confirmed thinking omission while retaining the visible answer. Keep that supported helper rather than adding local filtering. The optional verification is now complete: `handoff/summary.test.ts` captures mocked summary input and returned conversation text, proves thinking omission while retaining visible answer/tool-call/result context, and fails a deliberate leak mutation. Independent review found no blocker; independent execution passed 22/22 Handoff tests. No runtime filtering change, live summary-quality or token-saving magnitude claim is made. This is an inherited benefit, not a new 1.3 finding or runtime migration.

## Upgrade-enabled debt work

### D1 — Medium priority: finish local acceptance and documentation for restored resume tools

**Resolution: complete. TDR-20261009-1202 is closed and deleted, with its index entry and inbound links repaired.** Pi 1.3.0 fixed the original host omission (#10785); C1 repaired local fixture assumptions. No local pending-state workaround, host patch or activation-policy change was needed.

**Acceptance and durable evidence:** `pi-compatibility/sdk-resume.test.ts` and its single offline `resumeFixture.ts` now cover:

- Positive reopened-SDK and actual bundled CLI `--session` restoration, host-only and with local extensions saved off. Selected direct/deferred/codemode tools register with `defaultActive: false`, so registration cannot fake restoration. The four former diagnostics are normal gate requirements, not skipped or weakened.
- Actual CLI and SDK modifiers, plain/MCP allowlists, exclusions, no-tools/no-builtins and `defaultTools` precedence, with declaration, registration and indirect callability distinguished. `--no-builtin-tools` intentionally bypasses transcript restoration, as documented in the Pi 1.3 changelog; registered extension tools are not globally prohibited by that flag.
- Separate selected-local and unselected-local transcripts across saved-off/relay and depth-capped states; actual CLI restrictive and saved-off controls. Enabled clarify/search/subagent startup additions are retained. A recorded depth-capped subagent is withdrawn during `session_start`; the SDK pre-bind declaration window is not a guarantee of executability, and execution retains its depth guard.
- Deterministic isolated CLI `--continue` (older and foreign-project decoys) and `--fork` identity/lineage/source preservation; public runtime switch and fork at distinct branch points, with restrictions re-applied on replacement; separate tree and reload controls before/after late registration.

**Validation and independent challenge:** parent executed 78/78 resume tests within 183/183 activation/CLI/resume controls and integrated `npm run verify`: host links/typecheck pass, 898/898 tests, no failures/cancellations/skips/TODOs. The integrated count includes concurrent D2/A1/optional work, not 898 D1-only tests. A separate verifier independently reran focused/full gates; a separate source reviewer traced selection, branch/continue/fork identity, safety and all closure criteria. Reviewer-requested replacement-restriction and CLI saved-off controls were added and parent reran them.

**Recorded limits, not erased by closure:** no interactive resume picker, RPC `switch_session` protocol exchange, default session-directory/cross-project prompt acceptance, CLI reload of a resumed session, live `tool_search`/MCP/provider or real terminal workflow was exercised. Public runtime tests exercise the replacement seam used by resume/fork, not the picker UI. An extra Pi 1.3 tree characterization shows that navigating to a branch re-seeds its recorded names without reapplying invocation modifiers; exclusions remain enforced. This existing host behavior is not a private local workaround or a new exact-loadout policy decision. Durable scope/commands live in [resume coverage](../../agent/extensions/pi-compatibility/host-contract-coverage.md#sdk-resumetestts).

### D2 — Medium priority: revisit the supported Clarify overlay remedy

**Resolution: complete. TDR-20261009-1201 is closed and deleted, with its index entry and inbound references repaired.** Pi 1.3's identity-safe completion enabled the supported remedy. C2 corrected the copied adapter; production now uses `ctx.ui.custom(..., { overlay: true })` through the existing exactly-once cancellable wrapper, with typed options forwarding and no extension-owned overlay hiding.

**Acceptance and durable evidence:**

- `clarify/selector.ts` consumes normalized wheel deltas even at both question boundaries, uses injected configurable actions, leaves non-wheel selection/link gestures to the host and never toggles terminal mouse modes in either TUI mode.
- Height/width-aware layout and full-terminal percentage overlay bounds survive small/narrow terminals, height-only/width resize, long questions, many choices, wide text, selected descriptions and repeated dialogs. Description rows are preserved when they fit; clipping is indicated. Tiny terminals shed chrome before losing the reachable selected choice. Theme invalidation re-renders colored content.
- Normal tests cover selection/Escape/abort, queued/displayed/factory-install cancellation, unrelated overlays above/below, search before/after installation, shutdown/reload scope cancellation, exactly-once disposal, fresh interactions and selector-to-editor FIFO ownership. RPC basic dialogs, no-UI/model-only restrictions and permission/clarify safety controls are unchanged.
- Independent review exposed a stale-focus residual in the shared editor's default dock completion when search was stacked above it. The bounded integration remedy adds optional overlay presentation for Clarify's editor only, preserving the permissions/shared default dock and RPC behavior, rather than weakening the acceptance criterion or redesigning the editor. Positive search-focus, cursor, paste, resize and wheel controls cover the entire Clarify exchange.
- `clarify-host.test.ts` drives the real root-exported `InteractiveMode` in offline isolated subprocesses, using public APIs and fake terminals in fullscreen/regular modes. It verifies host completion, input, search/unrelated focus, custom answers and lifetime behavior independently of `clarifyUiFixture.ts`. No private host imports or installed-host patch are retained. The five former production diagnostic requirements are normal regressions; both diagnostic files and the obsolete diagnostic-only npm command are removed.

**Validation and independent challenge:** original five production diagnostics failed before implementation. New options-forwarding regressions failed before helper changes; old production failed the expanded routing/lifecycle tests and nine actual-host scenarios. Reviewer follow-ups for editor stacking, search-first, text selection, theme and meaningful resize assertions were implemented and verified. Parent executed 181/181 focused tests; integrated `npm run verify` passes valid host links, typecheck and 898/898 tests with no failures/cancellations/skips/TODOs (includes concurrent A1/optional work). Separate execution verifier reran focused/full gates, and a separate source reviewer approved closure without acceptance relaxation.

**Recorded practical limits:** no live Ghostty/macOS trackpad or other hardware terminal was available. Fake-terminal input does not establish terminal-specific encoding or wheel-to-arrow behavior; earlier pre-overlay user confirmation is not overlay proof. Actual-host tests do not activate real links or copy the system clipboard (capturing fixture controls test those defaults), drive the provider agent loop or execute a real busy `/reload`; shutdown/reload scope cancellation is exercised through lifecycle events. Regular-mode actual-host checks focus on lifetime/focus; public-renderer fixtures cover layout. The shared default dock editor's host behavior is not changed or claimed fixed. Reproduction/maintenance guidance and precise coverage limits are in [Clarify maintenance](../../agent/extensions/clarify/maintenance.md#overlay-selector) and [host coverage](../../agent/extensions/pi-compatibility/host-contract-coverage.md#clarify-inputtestts-and-clarify-hosttestts).

## Every TDR disposition

The index is context, not a debt record. All owning records under both `tdr/` and `tdr/blocked/` were read, including their acceptance and safety criteria.

| TDR | Disposition on 1.3.0 | Evidence and remaining work | Current record / remaining action |
| --- | --- | --- | --- |
| [1200: transient child project trust](../../tdr/20261009-1200-propagate-transient-project-trust-to-subagents.md) | **Still valid / open** | Canonical child-boundary and external denial controls pass. Child args still transmit external denial, not the contained parent's transient trust decision. Both releases already support `--approve`; there is no interval unblock. | Retain status. Before local work, settle precedence for contained untrusted parents and nested trusted scopes because explicit `--approve` overrides child trust handlers/saved/default decisions. Preserve external/unresolved/symlink-escape `--no-approve`; add transient/persisted/default/denied tests. This is existing debt, not an upgrade finding. |
| 1201: safe fullscreen Clarify | **Resolved; record deleted** | Supported selector/editor overlays, input/layout/lifecycle safety, real public-host integration, promoted requirements, independent review and green gates. Live hardware unavailable and explicitly unclaimed. | Closure evidence and practical limits are preserved in [D2](#d2--medium-priority-revisit-the-supported-clarify-overlay-remedy), not a separate archive. |
| 1202: SDK/CLI resumed loadout | **Resolved; record deleted** | Core host correction plus completed SDK/actual-CLI restriction and lifecycle acceptance, diagnostic promotion, independent review and green gates. | Closure evidence and skipped-check limits are preserved in [D1](#d1--medium-priority-finish-local-acceptance-and-documentation-for-restored-resume-tools), not a separate archive. |
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

## Original recommended order (completed dispositions above)

1. Restore trustworthy retained validation with C1/C2, without weakening requirements or changing activation policy silently.
2. Finish D1's durable resume acceptance and version-bound documentation, then reconsider TDR closure.
3. Implement D2's now-feasible supported overlay remedy only with separate approval and test-first lifecycle/input/layout coverage.
4. Adopt A1 independently when touching read renderers; retain all extensions unless a separate workflow decision authorizes a reversible retirement trial.

The [implementation record](01-compatibility.md#implementation-follow-up) supersedes the original pending dispositions. Historical audit commands remain in the canonical validation record; current closure summaries above include new gates and explicit practical limits. No live-terminal/provider/MCP result or resolution of unrelated TDRs is claimed.
