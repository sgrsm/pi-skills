# Pi 1.1.0 → 1.2.0: simplification and debt

## Assessment context

- **Run:** `20261015-000127`, 2026-10-15 00:01:27 CEST (UTC+02:00).
- **Versions:** requested baseline **1.1.0**, requested target **1.2.0**; installed selector and executed CLI **1.2.0**.
- **Baseline provenance:** explicit user-supplied upgrade interval, corroborated by installed 1.1.0 packages and version-bound maintenance/TDR evidence. No inferred upgrade history.
- **Repository:** `main`, HEAD `21f23bd66afe9e1efbbec9d126ced49c83638e94`; initially clean, one commit ahead of upstream.
- **Overall status:** **Partial assurance:** the bounded offline/source assessment and documented checks were executed, but the target verification gate is not green and extended/live acceptance remains unverified.
- **Category status:** all 12 runtime extensions, documented limitations/workarounds, and all six TDR records assessed; dispositions established within the stated source/offline scope, not full debt-closure acceptance.
- **Sibling reports:** [Compatibility and canonical validation](01-compatibility.md) · [API opportunities](03-api-opportunities.md).

> **Post-audit follow-up:** [C1](01-compatibility.md#c1-follow-up-resolution) and [C2](01-compatibility.md#c2-follow-up-resolution) have been addressed with bounded test repairs, and the normal verification gate passes. TDR-1201's historical raw-wheel wording is qualified; the tracked host debt remains open and its diagnostics still fail. The assessment below retains its audit-time findings.

## Result and priorities

- **No complete shipped-and-enabled built-in replacement was found.** No extension is recommended for retirement because of this upgrade.
- **No TDR became host-unblocked, resolved, or superseded in 1.2.0.** Existing debt remains separate from the two validation-adapter fixes in [C1/C2](01-compatibility.md#required-compatibility-follow-up).
- **One useful simplification is already inherited:** Handoff's public host serializer now omits thinking blocks. Keep that supported integration rather than introducing local filtering.
- **Record maintenance:** TDR-1201's raw-overlay-wheel historical/control wording needs qualification after the routing change. TDR-1206 should precisely distinguish missing arbitrated extension status from the already-public low-level terminal setter. Neither correction closes debt.

## S1 — Low-priority, already-realized host improvement: leaner Handoff serialization

**Consumer:** [handoff/index.ts](../../agent/extensions/handoff/index.ts), `summarizeWithModel()` around lines 997–1002, calling `serializeConversation(convertToLlm(messages))`; [summary tests](../../agent/extensions/handoff/summary.test.ts) and [owning maintenance](../../agent/extensions/handoff/maintenance.md).

**Released change:** [Pi 1.2.0](https://github.com/earendil-works/pi/releases/tag/v1.2.0) changes public `serializeConversation()` to omit thinking blocks. Installed `dist/core/compaction/utils.js`, `serializeConversation`, differs accordingly from 1.1.0. A public-export baseline/target probe using synthetic assistant thinking and visible text confirmed that baseline includes the thinking marker, target omits it, and both retain the visible answer.

**Material benefit:** Handoff already feeds this text to model summaries and fallback excerpts. Excluding replayed reasoning avoids spending summary input budget on text the live context may not contain; the release specifically associates this with oversized summarization requests. No token-saving magnitude or live summary-quality improvement was measured.

**Recommendation and smallest plan:** retain the public serializer, with no runtime migration. If adding durable coverage, use one synthetic thinking-plus-answer regression through the existing Handoff summary seam to show that relevant visible context remains while thinking does not enter the summary/fallback input. Adjust user guidance only if a documented output promise actually changes; do not add an implementation report to the README.

**Alternatives:** custom local filtering duplicates the now-correct host logic and creates maintenance drift; serializing raw messages would reintroduce unnecessary reasoning text. Keep the current public integration. No handoff documents, archives, sessions, or fallback artifacts should be removed.

**Confidence:** high for serialization behavior and concrete consumption; source-only for downstream budget/quality benefit beyond the bounded probe. This is not a complete native Handoff replacement and requires no required compatibility fix.

## Built-in overlap and retirement screen

All extensions were publicly loaded against 1.2.0 in isolated configuration. Resource selections contain `defaultTools: ["+codemode"]`; no external search/agent/MCP package was assumed to provide a replacement. Native features that predate the interval are context, not new obsolescence findings.

| Local extension | Shipped/native overlap and classification | Remaining workflow/policy; recommendation |
| --- | --- | --- |
| clarify | Standard selector/input/editor dialogs: **partial overlap**, not a replacement | Long context, previews, custom-answer flow, model-only policy and shared queue remain local. Retain; do not replace custom UI solely for status accuracy. |
| permissions | Tool annotations, nested-tool pipeline and new `reachesTools`: **not a replacement** | Concrete P0/path/Git/dependency policy, session grants, guarded Bash and ready scratch remain local. Metadata is not authorization. |
| subagent | Upstream extension examples and separate SDK sessions: **not a bundled replacement** | Local agent discovery, trust/policy approvals, scheduling, child relay, accounting and process lifecycle remain necessary. |
| git-inspect | Bash can run Git: **not equivalent** | Fixed read-only vectors, input restrictions, bounded capture and dedicated rendering remain local safety/workflow value. |
| web-search | MCP can theoretically supply search: **not an enabled replacement** | No complete configured provider with equivalent tool, toggle, output contract and bounded persistence was established. |
| handoff | Native compaction/session continuation: **partial overlap** | Persistent handoff files, explicit selection/continuation and fallback workflow remain. S1 improves an existing dependency, not replacement parity. |
| codex-verbosity | Provider-specific adapter option/passthrough: **partial overlap**, unchanged | No verified provider-neutral setting covering the extension's supported legacy requests; physical identity and capability remain separate. |
| mcp-status | Native `/mcp` management and 1.2 resource-presence reporting: **partial overlap** | Persistent footer intentionally projects effective configuration, not runtime connection health. New boolean resource reporting does not replace it. |
| response-timer | New codemode row elapsed/total time, plus native per-tool timing: **partial overlap** | A script/tool row duration is not whole-response lifecycle timing or the persistent footer. Retain. |
| trash-history | Native session management/deletion: **partial overlap** | Age-filtered batches, named/active protection, archive verification, preview/confirmation and macOS Trash semantics remain local. |
| hide-tool-output | Native collapse/expand: **partial overlap**, pre-existing | Persistent output hiding, summaries and wrapper/permissions integration remain. No new parity established. |
| short-paths | Native path formatting: **partial overlap**, pre-existing | User toggle, smart fit across supported rows and renderer-state propagation remain local. |

Retirement would require separate approval, a reversible disable-first trial and integration checks before deletion. Preserve state/preferences and all user artifacts. In particular, permissions owns Bash while hide-tool-output decorates it; short-path state crosses loader instances; dialog consumers share a session queue. No cleanup of these integrations is authorized by this audit.

## Documented limitations and workaround coverage

This screen covers owning READMEs/maintenance notes, including known/unsupported/deferred behavior and temporary adapters. Unchanged limitations below are coverage, **not new findings**.

| Constraint / owning surface | Target disposition |
| --- | --- |
| Clarify dock PageUp/PageDown/wheel, layout/help clipping, regular mouse ownership, overlay completion | Positive diagnostics still fail. Fullscreen mouse ownership and Home/End controls remain working. Temporary shorter-question/regular-mode workaround remains; see TDR-1201. The raw-overlay-wheel control itself must change under C2. |
| Shared permission/clarify FIFO and scope cancellation; other dialogs not enrolled | Still necessary. Raw host dialogs do not provide global serialization. Subagent approval/config/escalation, Handoff and Trash confirmation remain outside its guarantee. Keep collision warnings. |
| Cancellable custom editor with external-editor shortcut disabled; RPC basic input/placeholder fallback and stale visible RPC dialogs | No target facility found that safely replaces these routes or adds client-side cancellation dismissal. Preserve backend cancellation and no-UI fail-closed handling. |
| Optional-tool hidden withdrawal preserving pending restored names | Still necessary and passing local controls. Host SDK/CLI construction still omits pending declarations; new MCP/readiness metadata does not repair that. See TDR-1202. |
| Structured additive prompt sections and whole-prompt override limitation | Production handlers tolerate both event variants; C1 invalidates the durable runner matrix. Target expands custom-run handling but does not override another extension's deliberate full-prompt replacement. |
| Permissions best-effort shell/path classification, unsupported custom-shell forwarding, custom/MCP boundary, trusted-local-filesystem race limits | No target change removes these constraints. Do not interpret annotations/reach metadata or MCP OAuth fixes as a sandbox or generic approval policy. |
| Subagent contained-child transient trust, unmeasured child MCP startup, cancellation/recovery accounting boundaries | Existing controls pass; no newly relevant host remedy found. Trust remains TDR-1200. Do not launch live children/providers merely to fill a gap. |
| Codex direct legacy-only coverage and selected-versus-physical identity | Conservative skips remain intentional; no request identity enhancement. TDR-1204 remains blocked. |
| Trash conventional global root, conservative project identity, active-file/last-pathname race, archive/Trash prerequisites | No broadened storage/traversal policy is selected. Existing safeguards and injected-executor tests remain valid; no real Trash used. TDR-1205 remains open. |
| MCP footer is config projection, not host validation/connection state; extension-registered servers absent | Unchanged by removing eager resource enumeration. No live MCP acceptance claimed. |
| Footer precolored strings refresh on producer writes, not guaranteed idle recoloring | No scoped upgrade benefit justifies replacing the helper; retain documented limitation. |
| Renderer wrappers, short-path loader/bus adapters, copied fixed-dock layout and custom close fixture | Native/wrapped selection, image parity and row controls pass except C2. Fixed-dock host composition was source-checked; actual host close was independently probed, so copied adapter output was not mistaken for an upstream correction. Live rendering/GC/edit-preview limits remain. |
| Web-search service/fallback availability and bounded output; Handoff nested summaries/fallbacks; response-wide timing | No new complete built-in alternative or released API removes those operational limits. Local tests pass; no live model/search-service acceptance used. |

## Every TDR disposition

The [index](../../tdr/README.md) was treated as context, not as a debt record. All top-level and blocked owning records were read. IDs intentionally need not be contiguous.

| TDR | Disposition on 1.2.0 | Evidence and positive acceptance | Remaining work / proposed record changes |
| --- | --- | --- | --- |
| [1200: transient project trust](../../tdr/20261009-1200-propagate-transient-project-trust-to-subagents.md) | **Still valid / open** | Local child args still express external trust denial but do not pass the contained parent's current trust decision. `--approve` already existed at baseline; 1.2 does not newly enable it. Canonical containment/external denial tests pass, not transient-trust acceptance. | Retain status. A separately authorized three-way child trust decision must cover trusted/untrusted parents, persisted/default trust, contained resources, external/unresolved paths and symlink escape. Do not propagate based on lexical prefixes. |
| [1201: fullscreen Clarify](../../tdr/20261009-1201-clarify-fullscreen-input-host-blocker.md) | **Still valid / broader remediation still blocked; control adjustment needed** | Seven positive diagnostics fail. Actual version-checked host method probes on both releases reproduce stacked-search removal and unrelated-overlay removal before installation, with normal mounted completion as control. Fullscreen ownership/Home/End controls pass. Wheel fallback changed under C2, not lifecycle safety. | Retain open/blocked split. Add target revalidation and qualify historical raw-overlay-wheel feasibility; normalized handling is required in any future overlay remedy. Layout/resize, complete cancellation/disposal/focus, shared FIFO and practical live-terminal acceptance remain. Do not adopt overlays before identity-safe completion. |
| [1202: SDK/CLI resume](../../tdr/20261009-1202-sdk-cli-resume-tool-restoration-host-defect.md) | **Still blocked** | All four positive SDK/actual CLI cases fail, with and without local extensions. Host `sdk.js` supplies `initialActiveToolNames`; `AgentSession` construction restores transcript names only when that argument is undefined. Working tree/callability/local-availability controls remain separate. | Retain host/local distinction and status; append 1.2 evidence when separately authorized. Upstream/source-checkout remedy must distinguish ordinary resume from explicit loadout selection; test restrictive options, late registration, resume/fork/tree/reload, then promote positive diagnostics. No local pending-state workaround. |
| [1204: physical request identity](../../tdr/blocked/20261009-1204-provider-request-physical-model-identity.md) | **Still blocked** | Target `BeforeProviderRequestEvent` remains payload-only (`types.d.ts:693–696`); SDK/runner still discard the adapter callback's physical model. Baseline has the same boundary. `provider_stream_event` identity arrives after request dispatch. No provider acceptance exercised. | Retain conservative Codex gate. Supported per-request identity plus fake-adapter direct/virtual/router/concurrency tests are still prerequisites; identity alone must not enable unsupported verbosity fields. No live credentials are needed for the proposed host tests. |
| [1205: all-projects storage policy](../../tdr/20261009-1205-trash-history-all-projects-storage-policy.md) | **Still valid / open policy decision** | Public readonly manager has `getSessionDir()`, not a guaranteed configured-root accessor; `usesDefaultSessionDir()` is not in that public readonly type. Current-project safety tests pass, but do not select all-projects scope. No 1.2 root guarantee or product decision. | Keep status and the three unselected policy branches. Explicit conventional-only scope is the lowest-effort safety-preserving option; custom support needs a supported root/traversal contract, refusal needs provable layout. Recommend, do not silently select. Align help/preview/docs only after policy authorization. |
| [1206: custom-dialog blocked status](../../tdr/blocked/20261009-1206-custom-dialog-blocked-status.md) | **Adjustment needed; still blocked on supported arbitration** | `showExtensionCustom()` still lacks host `ProgramStatusReporter.setBlocked()` integration. Low-level public `TUI.terminal.setProgramStatus()` exists in **both** versions, but is a latest-wins terminal slot without reporter ownership/restore semantics. Source-only status conclusion; no live dashboard reproduction. | Narrow “no public status API” to “no supported, scoped/arbitrated extension-owned blocked-status integration.” Include permissions' shared custom-instructions editor in the scope assessment; explicitly decide whether `/subagents` custom settings UI belongs. Preserve generic privacy-safe labels, displayed-not-queued lifetime, independent-wait arbitration and exact cleanup acceptance. No raw/direct competing status workaround. |

### Record-only corrections versus upgrade findings

TDR-1206's low-level setter precision and shared-editor scope predate the interval; these are **record maintenance**, not new defects caused by 1.2.0. The extension-UI options really do lack a scoped status facility, so the blocker remains meaningful. Direct terminal writes cannot safely restore a reporter state the extension does not own; reporter deduplication can also leave a conflicting status in place.

TDR-1201's raw-wheel control qualification **is** interval-related, but its actionable test repair has a single primary home in C2. None of the TDRs was edited or moved. Host unblock, local remediation and closure remain separate decisions.

## Validation and next action order

The [canonical validation record](01-compatibility.md#canonical-validation-record) contains commands, environment, counts and durable observations. The actual-host probes corroborate persistent lifecycle debt rather than relying on the copied adapter; the positive resume checks include the actual bundled CLI, not merely SDK inference. These results still do not cover live terminal/dashboard, real provider/MCP or the broader TDR closure matrices.

1. Repair C1/C2 with focused tests, then restore a green target contract gate. Do not weaken positive host diagnostics.
2. Make the bounded TDR-1201/TDR-1206 wording corrections if separately authorized, retaining unresolved warnings and acceptance criteria.
3. Optionally add the small Handoff serialization regression. No runtime serializer rewrite is needed.
4. Keep all extensions enabled unless a separate workflow decision authorizes a reversible retirement trial. Pursue host debt or storage/trust policy changes as separate work, not as audit cleanup.

Primary release context: [official v1.2.0 notes](https://github.com/earendil-works/pi/releases/tag/v1.2.0), [target extension contract](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/extensions.md), [target TUI contract](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/tui.md), and [target MCP documentation](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/mcp.md). Source-only conclusions are labeled above; no unexecuted acceptance is presented as passing.
