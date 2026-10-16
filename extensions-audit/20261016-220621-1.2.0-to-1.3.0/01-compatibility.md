# Pi 1.2.0 → 1.3.0: compatibility

## Assessment context

- **Run:** `20261016-220621`, 2026-10-16 22:06:21 CEST (UTC+02:00).
- **Versions:** requested baseline **1.2.0**, requested target **1.3.0**; managed selector, executed CLI, running-process evidence and target package identify **1.3.0**.
- **Baseline provenance:** explicit user-supplied upgrade interval; installed 1.2.0 source and the retained 1.2.0 comparison evidence in the compatibility document provide bounded support, not an inferred upgrade history.
- **Repository at audit:** `main`, HEAD `aed4ee4f6bab6e60b021beff9940b9f0b9b661c8`; initially clean and synchronized with upstream.
- **Current disposition:** implementation follow-up is tracked in the [remediation record](01-compatibility.md#implementation-follow-up). Audit-time observations below remain historical unless explicitly superseded there.
- **Overall status:** **Partial assurance:** the full documented gate and positive diagnostics were executed, but the retained gate is red and extended/live acceptance remains incomplete. All three report categories were assessed and saved.
- **Category status:** all discovered runtime extensions and shared infrastructure assessed; two validation-contract findings, with no newly demonstrated production execution regression. Resume startup selection differences are explicitly qualified below.
- **Sibling reports:** [Simplification and debt](02-simplification-and-debt.md) · [API opportunities](03-api-opportunities.md).

## Implementation follow-up

The user authorized the recommended local changes, associated validation/documentation and item-level commits. Each entry below supersedes the corresponding pending audit disposition; historical audit evidence remains version-bound.

| Item | Current disposition and evidence |
| --- | --- |
| C1 | **Resolved.** Direct-constructor restoration now requests `usesDefaultTools: true`; separate selected-local and unselected-local transcripts assert phase-specific startup policy, registration/exposure and callability. Existing red run reproduced 52 failures; corrected focused activation/resume controls pass 137/137. Parent independently reran those controls plus unchanged resume diagnostics: 141/141. Independent source review found no blocking defect; documentation/coverage refinements were applied. A worker full gate passed 745/745 with concurrent C2 changes; item-local focused results are the C1 evidence. TDR-1202 remains open for D1. |
| C2 | Pending integration of adapter repair and independent verification. |
| D1 | Pending broader resumed-selection/lifecycle acceptance and diagnostic promotion. |
| D2 | Pending supported Clarify overlay/input/layout remediation and acceptance. |
| A1 | Pending public read-range formatter adoption. |
| Optional verification | Pending focused Handoff serialization and Git Inspect codemode-catalog regressions. |

## Result (audit-time)

1. **C1, P1:** Pi's resumed-loadout correction invalidates two assumptions in the resume/activation tests. This accounts for all **52** normal-gate failures, not 52 independent defects.
2. **C2, P2:** the copied custom-dialog completion adapter still implements Pi 1.2's defective topmost-overlay removal. Its two lifecycle diagnostics cannot assess the 1.3 host correction.
3. **Positive upstream results:** all four SDK/actual-CLI resume diagnostics pass. A separate actual-host method probe confirms identity-safe overlay removal and preservation of unrelated overlays in 1.3. See [D1/D2](02-simplification-and-debt.md#upgrade-enabled-debt-work), not a claim that their TDRs are closed.
4. **Optional improvement:** a new public read-range formatter can replace duplicated local summary logic. See [A1](03-api-opportunities.md#a1--adopt-now-use-the-public-read-range-formatter).

At audit time, the five stale host-package links were refreshed only after separate user approval; no extension source, durable tests, configuration, TDR, dependency installation or installed-host code was changed. The later documentation follow-up aligned TDR statuses and linked guidance; C1/C2 executable repairs remain pending.

## Required compatibility follow-up

### C1 — P1: adapt resume/activation fixtures to restored selection semantics

**Resolution:** completed; see the [implementation follow-up](#implementation-follow-up). The following diagnosis/recommendation is retained as the original rationale, not outstanding work.

**Affected:** [tool-activation.test.ts](../../agent/extensions/pi-compatibility/tool-activation.test.ts), `activationFixture.create()` around lines 126–136; [sdk-resume.test.ts](../../agent/extensions/pi-compatibility/sdk-resume.test.ts), local-mode parity test around lines 24–45; [resumeFixture.ts](../../agent/extensions/pi-compatibility/resumeFixture.ts); owning [coverage notes](../../agent/extensions/pi-compatibility/host-contract-coverage.md).

**Pi change:** [1.3.0](https://github.com/earendil-works/pi/releases/tag/v1.3.0), issue [10785](https://github.com/earendil-works/pi/issues/10785), restores the transcript loadout for ordinary/default-selection resume. CLI modifiers apply on top; explicit selections retain precedence. Installed baseline `dist/core/agent-session.js` restores when `initialActiveToolNames === undefined`; target restores when `config.usesDefaultTools` is true. Target `sdk.js` supplies that flag for ordinary/default-modifier sessions. The public `AgentSessionConfig.usesDefaultTools` documentation now explicitly describes restoration.

**Two precise fixture mismatches:**

- **Direct constructor:** the fixture omits `initialActiveToolNames` to request restoration but does not set `usesDefaultTools`. In 1.3 its default is false. Consequently 32 restored pending-tool cases and two restored depth cases fail, plus their two aggregate parents. A scratch copy with only `usesDefaultTools: true` added to this constructor passed its entire **100-test** file. Production extensions do not construct `AgentSession` directly.
- **Pre-start local declarations:** the SDK fixture records `read` plus three late synthetic tools, not local workflow tools. The test nevertheless expects every eligible local tool at **all** phases, including `before` binding/startup. Target correctly exposes only registered, recorded `read` at that phase; 15 subcases and their parent fail there. The recorded late names become active after registration. This is not evidence that restored names were lost.

**Observed startup policy, not silently treated as host failure:** actual phase probes for all 16 off-mask/relay combinations show that enabled clarify, web search and subagent are explicitly added by their existing `session_start` handlers. They can therefore augment a resumed transcript that did not select them. `escalate_to_parent` has no equivalent add and remains unselected in this synthetic resumed-child transcript. Ordinary delegated children use `--no-session` and explicit child tool selection, so this is not a demonstrated broken child workflow. The local guides already explain saved enablement and that `-name` is not a reliable disable mechanism; restrictive allowlists/exclusions remain authoritative.

A focused reviewer identified a possible exact-resume-policy mismatch here. Parent measurement confirms the additions but does **not** classify the documented local auto-on policy as a newly introduced execution bug. Retain that policy for the bounded test repair, document its exception to exact transcript selection, and treat changing it as a separate workflow decision. Do not simply add every eligible tool to fixture history to hide the distinction.

**Recommended bounded repair:**

1. Set `usesDefaultTools: true` for the direct-constructor restoration control, or route it through the public SDK if constructor coverage is no longer wanted. Update the obsolete fixture comment.
2. Make resume expectations phase-specific: `before` follows the recorded selected loadout; `afterStartup` includes the deliberate enabled-local additions; `afterRegistration` additionally includes the selected late tools. Do not assume an unselected relay tool activates merely because it is eligible.
3. Retain both a transcript without local names and a separate transcript selecting local names. Keep off/depth/relay withdrawal, forward/reverse load order, pending names, indirect callability, tree/reload and restrictive-option controls. Distinguish registration, eligibility, active declaration and callability.
4. Update maintainer coverage notes; rerun the focused files, `npm run verify`, and unchanged positive diagnostics. Promote verified positive resume checks as described in D1.

**Alternatives:** using SDK-only fixtures reduces constructor coupling but loses an explicit public-constructor control. Exact transcript selection with no automatic local additions is a reasonable different product policy, but requires separately approved startup changes and documentation/tests; it is not necessary to repair these assertions. Adding all local names to the only transcript fixture would erase useful unselected-tool coverage and is not recommended.

**Confidence:** high for both failure causes and target behavior. The scratch control is not a durable repair or a green repository gate. Broader resume/fork/continue/switch acceptance remains incomplete.

### C2 — P2: stop diagnosing the old host overlay-close algorithm

**Affected:** [clarifyUiFixture.ts](../../agent/extensions/pi-compatibility/clarifyUiFixture.ts), `createUi()` completion callback around line 68; the final two checks in [clarify-input.diagnostic.ts](../../agent/extensions/pi-compatibility/clarify-input.diagnostic.ts); [coverage notes](../../agent/extensions/pi-compatibility/host-contract-coverage.md#clarify-inputtestts-and-clarify-inputdiagnosticts).

**Released change:** [1.3.0 PR 10999](https://github.com/earendil-works/pi/pull/10999) replaces topmost `this.ui.hideOverlay()` in `InteractiveMode.showExtensionCustom()` with `overlayHandle?.hide()` for the interaction's own handle. The target TUI removes that entry by identity. The local adapter still calls `tui.hideOverlay()`, so its failures are simulated old-host behavior, not evidence that the target correction failed.

**Impact and evidence:** normal diagnostics report seven Clarify failures. Five exercise still-unmet production input/layout/mouse requirements; two exercise this stale adapter. Actual version-checked host probes distinguish the versions: 1.2 removes stacked search and leaves the disposed owned overlay; 1.3 removes the owned overlay, preserves search focus and disposes once. Completion before installation preserves an unrelated overlay in 1.3, unlike 1.2. The existing local cancellable wrapper plus actual target close also preserves the unrelated overlay and disposes once in a pre-install abort probe.

**Recommended repair:** update the adapter to retain the handle and use identity-specific completion, only after comparison with the actual target method. Preserve the two positive lifecycle assertions; then promote behaviorally verified lifecycle controls where appropriate. Keep a bounded actual-host probe as independent evidence because a copied adapter cannot detect future host changes by itself. The TDR's blocker description and linked guidance have been updated; keep the coverage notes aligned when repairing the adapter. No production overlay migration is included in this repair.

**Alternatives:** a retained public integration fixture exercising actual custom UI would be stronger if a practical public seam is available. A private-method probe is acceptable only in scratch and version-checked, not as a production import. Keeping the old adapter as a clearly labeled historical negative control is possible, but it must not remain the only purported target host acceptance check. Do not delete or weaken the assertions merely to make diagnostics green.

**Confidence:** high, supported by baseline/target source and actual-method observations. Generic raw-host disposal before installation remains zero in both versions; the local wrapper's exactly-once disposal still matters. Full Clarify remediation belongs in D2, not here.

## Scope and activation inventory

Filesystem discovery found **12 runtime entrypoints**, excluding `node_modules`; no disabled entrypoint or explicit extension exclusion was found. User resource lists/packages have no override; project settings are absent. Saved modes were inspected only for non-sensitive activation fields: clarify/search have no override and default on, subagents are `auto`, output hiding and short paths are on. Public isolated loading succeeded for all 12. This does not prove every live command/UI workflow.

| Runtime extension | Activation and purpose | Target evidence and limits |
| --- | --- | --- |
| [clarify](../../agent/extensions/clarify/README.md) | Discovered/enabled; model-only questions and custom answers | Local queue/cancellation/mode/prompt controls pass. C1 affects resume expectations; C2 affects lifecycle diagnostics. Production dock debt persists; no live-terminal acceptance. |
| [permissions](../../agent/extensions/permissions/README.md) | Discovered; default guards plus P0; owns Bash and scratch | Path/Git/dependency/shell/P0/dialog/scratch and shared tests pass; structured user/custom prompt matrix passes. Not a sandbox or generic custom/MCP approval policy. |
| [subagent](../../agent/extensions/subagent/README.md) | Discovered; saved auto policy; child relay scoped | Policy/trust/process/accounting/scheduler and model-only tests pass. C1 affects constructor/resume controls, not demonstrated child execution. Transient trust remains open. |
| [git-inspect](../../agent/extensions/git-inspect/README.md) | Discovered; fixed read-only Git interface | Operation/bounds/rendering tests pass. No arbitrary Git execution, mutation or external integration used as fixture. |
| [web-search](../../agent/extensions/web-search/README.md) | Discovered; defaults enabled; SearXNG | Local response/schema/truncation/availability tests pass. C1 covers resumed startup selection. Audit search returned no matching result; no broad service acceptance claim. |
| [handoff](../../agent/extensions/handoff/README.md) | Discovered commands; persistent handoff/continuation | Context/file/summary tests pass; no host replacement or new request-contract mismatch found. No live nested summary/provider call. |
| [codex-verbosity](../../agent/extensions/codex-verbosity/README.md) | Discovered; supported direct legacy requests only | Conservative identity/API-selection and payload tests pass. Physical pre-request identity remains absent; no credentialed provider test. |
| [mcp-status](../../agent/extensions/mcp-status/README.md) | Discovered footer producer | Config projection/trust/precedence/polling tests pass. Means configured/enabled, not connection health; no live MCP/dashboard. |
| [response-timer](../../agent/extensions/response-timer/README.md) | Discovered lifecycle/footer producer | Timing/settlement/cleanup tests pass; no changed 1.3 lifecycle API found. No live footer or reachable setup-error reproduction. |
| [trash-history](../../agent/extensions/trash-history/README.md) | Discovered command; filtered Trash/archive workflow | Scope/revalidation/archive/confirmation tests pass using injected executors. No actual Trash/personal sessions; storage policy remains open. |
| [hide-tool-output](../../agent/extensions/hide-tool-output/README.md) | Discovered; saved on | Native wrapper selection/image parity, row invalidation/state and renderer tests pass. Local read labels do not inherit native 1.3 normalization; optional A1. |
| [short-paths](../../agent/extensions/short-paths/README.md) | Discovered; saved on | Separate-loader/reload/bus, row reuse and narrow/wide tests pass. Optional A1 verified by bounded render probe; no live rendering/edit-preview/GC acceptance. |

**Shared infrastructure, assessed separately:** dialog queue/UI/harness, tool availability and footer helpers; host-resolution utility; manifests/TypeScript configuration; and all `pi-compatibility` test/diagnostic entrypoints. Only permissions and clarify use the shared FIFO. The availability helper remains necessary to hide unavailable tools without discarding unrelated pending names; restored SDK/CLI names now exist for it to preserve. No shared helper is declared obsolete.

## Canonical validation record

### Environment and authorized setup

- Verified root `/Users/sergey/.pi` from the skill directory, including `agent/extensions/` and `tdr/`.
- Launcher `/Users/sergey/.pi/agent/bin/pi`, selector `agent/install/current-version`, CLI `pi --version`: **1.3.0**. The running `pi` process also has the 1.3.0 TUI native module loaded; no evidence of an old unrestarted runtime.
- `HOST=/Users/sergey/.pi/agent/install/releases/1.3.0/node_modules/@earendil-works/pi-coding-agent`. Baseline imports use the adjacent **1.2.0** package tree without switching the active install.
- Node **v22.19.0**, npm **11.21.0**, TypeScript **6.0.3**, Darwin **25.6.0 arm64**. Node satisfies the target minimum. Managed launcher has no separate installed Node fallback on this machine.
- Initially all five extension peer links pointed to 1.2.0. After explicit user approval, `npm run sync:pi-host-deps` refreshed coding-agent/agent-core/ai/tui to 1.3.0 and typebox to the target tree's **1.3.27**. The non-mutating check passed. No npm install, package update or host patch occurred. Target internal Pi dependencies are exact-pinned; that does not refresh local links automatically.
- Approved session scratch was verified as a real, canonical, current-user-owned **0700** directory outside HOME/repository/cwd. The approving caller created the required real **0600** `.step1-test-root-ready` marker. No root mkdir/chmod/rename/delete was performed. Fixture guards enforce root/sentinel identity and containment.
- All test subprocesses used `PI_HOST_PACKAGE_ROOT="$HOST"`, and both `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR` selected that approved canonical session scratch. Host resolution was not silently left at 1.2.0.
- Fixtures isolated agent configuration and disposable/in-memory sessions, including fake HOME and allowlisted environments for CLI children. The retained CLI fixture uses a deliberately invalid non-persistent placeholder key, sends no prompt and remains offline. No personal sessions, usable/personal credentials, live provider/MCP calls, real Trash, or downloaded executable code were used as test fixtures.

### Executed commands and outcomes

Commands ran from `agent/extensions/` unless described as scratch probes. Temporary logs are supplementary; the durable observations needed for this assessment follow here.

| Check | Result | Interpretation |
| --- | --- | --- |
| Selector, launcher, package metadata, `pi --version`, running-process native module | 1.3.0 | Actual target established, not latest-online substitution. |
| Approved `npm run sync:pi-host-deps`; `npm run check:pi-host-deps` | Exit 0; five correct links | Authorized validation setup only. |
| `npm run verify` | Typecheck passes; test stage exits 1; **723 tests: 671 pass, 52 fail**, zero cancelled/skipped/TODO | Complete documented gate executed. All failures are C1: 49 failing subcases plus three aggregate parents. No unrelated failure backlog inferred. |
| `npm run diagnose:pi-host` | Exit 1; **11 tests: 4 pass, 7 fail**, zero cancelled/skipped/TODO | All four resume requirements pass. Five actual Clarify requirements still fail; two lifecycle failures come from C2's stale adapter. |
| Scratch copy of `tool-activation.test.ts`, corrected constructor flag only | **100/100 pass** | Confirms C1 constructor causality and selected-local/off/depth/relay/pending controls. Not a committed repair or replacement for the red gate. |
| Public-SDK resume phase probe, all 16 local off-mask/relay combinations | Completed, exit 0 | Before startup only `read`; enabled clarify/search/subagent added on startup; unselected relay not added. All selected late declarations survive registration. Model-only tools remain non-callable; search callability follows its mode. |
| Eight host-only reopened-SDK selection cases | All assertions pass | Ordinary restoration, `+grep`, removal of one recorded late tool, explicit allowlist, exclusion, no-tools, no-builtins, and changed `defaultTools` precedence. No-tools leaves no callable tools; no-builtins still allows indirect deferred/codemode tools, as intended. These are not actual-CLI restrictive-option tests. |
| Version-checked actual `showExtensionCustom()` on 1.2.0 and 1.3.0 with public fake-terminal renderer | Target positive identity/focus assertions pass; baseline reproduces old failures | Normal mounted completion, stacked transcript search, synchronous/microtask pre-install completion, and local-wrapper pre-install abort measured. Detail below. |
| Target public `discoverAndLoadExtensions()` on dynamically discovered entrypoints | **12 loaded, zero errors** | Isolated factory-loading smoke check; no session timers or provider/MCP calls started. |
| Baseline/target public export and current local read-summary probes | Formatter absent in 1.2, present in 1.3; normalization mismatch demonstrated | Optional A1, not new execution regression. Both hidden and smart-visible local summaries measured. |
| Baseline/target declarations/source and official release research | Completed for relevant contracts/new API candidates | Extension event/UI declarations and TUI root exports unchanged; constructor semantics and the public formatter are the significant local changes. See research limits below. |

**Normal failure accounting:** `sdk-resume.test.ts` has 15 failed local-mode subcases plus its parent (16). `tool-activation.test.ts` has 32 failed constructor pending-name subcases, two failed constructor depth subcases and two parents (36). The shared cause is C1, with two different fixture assumptions. Other normal test files pass.

**Remaining production Clarify observations:** PageDown leaves question position 1 while transcript moves 30 → 31; PageUp leaves question position 40 while transcript moves 30 → 29; wheel leaves question position 1 while transcript moves 30 → 33. Regular-mode mouse ownership and 80×24 help visibility also fail. Fullscreen ownership, Home/End, normalized-wheel controls, keyboard controls and shared queue regressions pass.

**Actual-host lifecycle observations:** both versions remove a normally completed mounted dialog, restore editor focus and dispose once. With search above, 1.2 leaves the disposed owned overlay mounted and removes search; 1.3 removes the owned overlay, preserves search focus and disposes once. For raw completion synchronously in the factory or in its pre-install microtask, 1.2 removes an unrelated overlay; 1.3 leaves it mounted. Raw never-installed components are not disposed by either host (zero calls), so do not remove the local disposal wrapper. With the actual host plus existing cancellable wrapper, pre-install abort disposes once; 1.3 preserves the unrelated overlay, 1.2 does not. The probe handles the helper's expected AbortError; an initial exploratory invocation omitted that catch and was corrected in scratch before the successful comparison. No installed host was patched.

### Material gaps and next bounded checks

1. Apply C1/C2 only in separately authorized work, then rerun the full retained gate and diagnostics. Scratch controls do not establish a green repository gate.
2. TDR-1202's core SDK/CLI `--session` requirement passes, but actual CLI restrictive/modifier resume cases, `--continue`, interactive `/resume`, runtime switch and fork are not all behaviorally exercised. Tree/reload and selection checks have narrower coverage as recorded above.
3. TDR-1201 still needs actual local overlay integration, full small/narrow/resize/repeated-interaction and cancellation/focus matrices, plus practical terminal input confirmation. The bounded fake-terminal probe is not a Ghostty/trackpad test.
4. No live terminal/program-status dashboard, real external-editor cancellation, provider request/routed identity, live MCP/OAuth, genuine model-backed handoff, or paid child model workflow acceptance was attempted. Existing tests and source screen do not imply those checks passed.
5. Direct structured-prompt runner tests pass for user/custom triggers; they do not execute all AgentSession custom-run busy-start, delivery, abort or provider-cache scenarios. This limitation predates the interval and is not a new finding.

## Research and comparison provenance

Installed package metadata identifies **earendil-works/pi** as canonical upstream. Official release-list/API retrieval agrees with the installed changelog: **1.3.0**, published 2026-10-15, is the only release after 1.2.0 through target and was latest stable when queried. Newer/unreleased proposals were not substituted for target behavior. Web search returned no matching release result; direct official HTTP succeeded, leaving no release-notes retrieval gap.

Primary external sources:

- [v1.3.0 release](https://github.com/earendil-works/pi/releases/tag/v1.3.0), [release API](https://api.github.com/repos/earendil-works/pi/releases/tags/v1.3.0), [release list](https://api.github.com/repos/earendil-works/pi/releases?per_page=10).
- [Tagged AgentSession source](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/agent-session.ts) and [tagged interactive source](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/modes/interactive/interactive-mode.ts).
- [Tagged public renderer helper](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/tools/render-utils.ts), [extension guide](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/extensions.md), [TUI guide](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/tui.md), and [settings](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/settings.md).

### Retained Pi 1.2.0 comparison evidence

The earlier 1.1.0 → 1.2.0 assessment was initially partial, then documented two verified fixture repairs: **1.2 C1** adapted structured-prompt calls to the user/custom trigger API (`5304a895`); **1.2 C2** replaced the obsolete raw-overlay-wheel expectation with normalized consumption/fallback controls (`ea2534d1`). Both are resolved and are not current backlog. After those repairs, verified 1.2 host links, TypeScript and the normal gate passed **723/723**; the **11** positive host diagnostics still failed (seven Clarify, four SDK/CLI resume). This was bounded offline/fake-terminal evidence, not complete live or TDR acceptance.

The **1.3 C1/C2 in this document are different findings**: resume/activation fixture assumptions and the copied overlay-close adapter. The current 52 normal-gate failures are not recurrence of the repaired 1.2 trigger/wheel controls. Target diagnostics improve to four resume passes and seven Clarify failures, with five production requirements and two stale-adapter checks distinguished above. Source comparisons and the recorded 1.3 execution establish these conclusions; no deleted report directory is required to interpret them.

Three user-scoped read-only scouts covered disjoint clusters and assigned each TDR/shared contract a primary owner. A focused reviewer challenged resume causality/selection. Parent probes reconciled their source-only observations: the constructor control is stale, post-start local additions are real existing policy, and the core host restoration now works. No further authorization was requested merely to choose a remediation recommendation.

**Audit-time write boundary:** only the approved peer-link refresh, scratch/test artifacts and reports were written; source, durable tests, settings, TDRs, installed packages and user data were not changed by the audit. **Current follow-up:** `00a5366` updated/moved TDR-1201/1202, revalidated TDR-1204, clarified TDR-1206 and aligned linked documentation, without executable fixes or TDR closure. This consolidation preserves the necessary 1.2 baseline and current dispositions before removing the superseded report set; it does not rerun or change the validation results.
