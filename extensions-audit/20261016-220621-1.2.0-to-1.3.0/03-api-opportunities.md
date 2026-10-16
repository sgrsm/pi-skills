# Pi 1.2.0 → 1.3.0: API opportunities

## Assessment context

- **Run:** `20261016-220621`, 2026-10-16 22:06:21 CEST (UTC+02:00).
- **Versions:** requested baseline **1.2.0**, requested target **1.3.0**; managed selector, executed CLI, running-process evidence and target package identify **1.3.0**.
- **Baseline provenance:** explicit user-supplied upgrade interval; installed 1.2.0 source and the retained 1.2.0 comparison evidence in the compatibility document provide bounded support, not an inferred upgrade history.
- **Repository at audit:** `main`, HEAD `aed4ee4f6bab6e60b021beff9940b9f0b9b661c8`; initially clean and synchronized with upstream.
- **Current disposition:** this is the consolidated retained assessment for Pi 1.3.0. Documentation follow-up `00a5366` is reflected below; no executable fixes or new runtime validation are claimed by this consolidation.
- **Overall status:** **Partial assurance:** the full documented gate and positive diagnostics were executed, but the retained gate is red and extended/live acceptance remains incomplete. All three report categories were assessed and saved.
- **Category status:** released API/capability relevance screen complete for current consumers; one substantive optional adoption recommended. Demonstrated helper/renderer behavior is separate from unimplemented adoption and live acceptance.
- **Sibling reports:** [Compatibility and canonical validation](01-compatibility.md) · [Simplification and debt](02-simplification-and-debt.md).

## Recommendation summary

| Capability / consumer | Recommendation | Reason |
| --- | --- | --- |
| New public `formatReadLineRange()` / short-paths and hide-tool-output read summaries | **Adopt now** | Replaces a duplicated formatter with supported normalization and fixes demonstrated misleading/missing local labels. Small, presentation-only change. |
| Resumed default-selection semantics / availability and validation | **Required follow-up, not optional API adoption** | C1 owns fixture changes; D1 owns existing-debt acceptance/documentation. Keep the hidden-withdrawal helper. |
| Identity-safe custom-overlay completion / Clarify | **Existing-debt remediation, not a second optional finding** | C2/D2 own the now-feasible remedy and diagnostic repair. |
| `ToolCall.argumentsError` / local tool-call display and child JSON consumers | **Skip custom parsing/integration now** | Host validation already rejects malformed final arguments; no local parser workaround or current lost-error workflow was established. |
| `supportsMidConvoEffort` / provider options | **Skip local integration** | Native transport capability, not text verbosity or physical request identity; no local transport/cache shim to replace. |
| `sessionShareDestination` / Handoff or Trash | **Skip** | Upload destination does not match local handoff, archive or deletion workflows. No sharing-policy change authorized. |

## Retained baseline recommendation

Pi 1.2.0 began presenting schema constraints in codemode declarations. [Git Inspect](../../agent/extensions/git-inspect/index.ts) already supplies integer/range bounds for `maxCount` and a maximum `paths` length; the earlier passive catalog probe demonstrated those tags. Keep schemas as the source of truth rather than duplicating a declaration formatter. A small catalog regression remains optional, not a migration requirement or new 1.3 finding. Earlier `reachesTools`/namespace-alias candidates still have no concrete local adoption need; blocked-status integration remains in the debt report.

## A1 — Adopt now: use the public read-range formatter

**Priority/category:** low-risk optional correctness/maintenance improvement. Affected: [short-paths/toolCallSummary.ts](../../agent/extensions/short-paths/toolCallSummary.ts), `formatReadRange()`, `buildSummaryParts("read")`, `renderSmartToolCall()` and `renderSmartVisibleToolCall()`; [hide-tool-output](../../agent/extensions/hide-tool-output/README.md) chooses those summary paths.

### New target contract and concrete consumer

Pi 1.3.0 adds a root public export:

```ts
formatReadLineRange(offset: unknown, limit: unknown): string
```

It accepts finite numbers or non-empty numeric strings, treats null/omitted optional arguments as omitted, and suppresses malformed ranges. Source: [tagged formatter](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/tools/render-utils.ts), [tagged root exports](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/index.ts), and [release 1.3.0](https://github.com/earendil-works/pi/releases/tag/v1.3.0), issue [9887](https://github.com/earendil-works/pi/issues/9887). The formatter is absent from the installed 1.2 root and callable from the installed 1.3 root. This is shipped public API, not a main-only proposal or private subpath.

The local read header calls `formatReadRange(getNumberArg(args, "offset"), getNumberArg(args, "limit"))`. Its `getNumberArg()` discards strings, so native normalization does not reach either custom smart summary. Local path shortening and output hiding still have value; only the small range calculation is redundant.

### Demonstrated benefit

A bounded public-helper/local-renderer probe produced the following at width 100 with identity styling and a synthetic path. No read operation or file execution was needed.

| Arguments | Target public/native range | Current hidden and smart-visible local labels |
| --- | --- | --- |
| `offset: "10", limit: "5"` | `:10-14` | Range omitted |
| `offset: "10", limit: 5` | `:10-14` | Incorrect `:1-5` |
| `offset: null, limit: 5` | `:1-5` | `:1-5` |
| `offset: 10, limit: null` | `:10` | `:10` |
| `offset: "bad", limit: 5` | Empty range | Misleading `:1-5` |
| Both omitted | Empty range | No range |

These are presentation observations for raw/partial/replayed argument shapes. They do not claim every such input is executable under tool argument validation or that read execution is broken. The local normalization gap predates the interval; the new supported helper is what makes this an upgrade-enabled adoption opportunity, not a newly caused regression.

**Material benefit:** accurate labels across native and custom read rows, plus removal of duplicated range semantics. No scheduling, tool selection, provider behavior, output content, path policy or authorization changes are needed.

### Smallest adoption and validation

1. Import `formatReadLineRange` from the public `@earendil-works/pi-coding-agent` root and pass the raw `args?.offset` / `args?.limit` values for read summaries.
2. Remove only the now-unused local `formatReadRange`; keep `getNumberArg` for unrelated tool fields, and retain smart path fitting, styling, row reuse and output hiding.
3. Add focused existing-framework tests for numeric/numeric-string combinations, null/omitted values, malformed/empty strings and non-finite values. Assert both hidden and smart-visible headers, short paths on/off, narrow widths and row reuse without changing expansion/result lines. Exercise ordinary numeric inputs as parity controls.
4. Run the focused renderer/short-path loader tests and the full `npm run verify` after C1 is repaired. Update owning maintainer coverage notes. A README edit is needed only if a user-visible requirement/limitation changes; do not turn it into a validation report.

**Validation already performed:** public export baseline/target check; actual target helper calls; actual current hidden and smart-visible summary rendering for the six cases above; existing renderer/row/loader tests in the full target gate passed. **Not performed:** an implementation, new durable regression, live terminal smoke test or provider-generated malformed-input workflow.

### Alternatives, compatibility and recommendation

- **Recommended: direct public-helper adoption for the selected 1.3 host.** Smallest implementation and least drift. A static import means 1.3 is required for this consumer; document that support floor when changing it rather than treating peer dependency `"*"` as a compatibility promise.
- **If continued 1.2 support is required:** retain a local normalizer with equivalent tested behavior, or a deliberately bounded feature-detection adapter. This preserves the older host but keeps duplicate logic/branching. The audit does not silently select or implement a multi-version support policy.
- **Retain current code/defer:** zero immediate change, but the demonstrated label discrepancies and duplicated semantics remain. Reasonable if renderer work is being postponed; not preferable for a small target-specific maintenance change.

**Recommendation:** **adopt now** after required validation repair, independently of larger Clarify work. Confidence is high for feasibility and presentation benefit; effort/risk are small. Preserve all execution and safety contracts.

## Released surfaces screened

The screen used the complete interval release notes and baseline/target public declaration differences, including capabilities not already named by a TDR. It did not simply search old debt for keywords.

| New/changed surface | Current local workflow assessment | Decision and evidence boundary |
| --- | --- | --- |
| `AgentSessionConfig.usesDefaultTools` restoration semantics; CLI modifiers/selection precedence | Direct constructor fixture and resumed optional-tool controls are concrete consumers. Production startup can intentionally add saved-on workflow tools. | C1/D1, not optional duplication. Core host diagnostics pass; full retained gate and broader CLI lifecycle acceptance remain incomplete. |
| Owned custom-overlay completion | Clarify's deferred supported overlay route has a concrete user-visible input/layout need. | C2/D2. Actual host probes demonstrate the prerequisite; no speculative optional feature added here. |
| Public read-range formatter | Custom hidden and smart-visible headers replace the native header. | A1, demonstrated optional adoption above. |
| `ToolCall.argumentsError`, root-exported `parseToolCallArguments()` and repaired final-argument parsing | Permissions consumes validated tool events; subagent processes child events/results rather than implementing a provider final-arguments parser; Handoff extracts tool argument metadata. No local use of the removed `assistant-message-frame` root export was found. | **Skip** writing a second parser or inferring authorization from error metadata. Native rejection is safety benefit in depth; typecheck and current tests pass outside C1. No live malformed-provider request was attempted. |
| `supportsMidConvoEffort` and response conversion effort updates | Public provider compatibility schema expands cache-preserving thinking changes. Codex verbosity changes `text.verbosity`, not reasoning effort or transport configuration. | **Skip** local adoption. This does not expose physical request identity, establish verbosity capability or unblock 1204. No custom provider/cache shim exists locally. |
| Credential-aware ambiguous model resolution; multi-provider scoped patterns | Subagent settings forward a model string to the CLI, not copied host resolver internals. Fully qualified models remain the unambiguous path. Public extension event types remain unchanged. | Native selection improvement; no local resolver migration identified. Private resolver refactors are not a new supported extension API. No personal credentials used to test ambiguous selection. |
| `SettingsManager` share destination getters/setters and setting | Handoff persists local documents, Trash archives/deletes sessions; neither invokes `/share`. | **Skip** adding upload behavior. Destination configuration would be a separate user preference/privacy decision. |
| Codemode Bun interruption and two-live-worker admission | Native codemode is used; local subagent children are separate processes with their own scheduler/process-tree cleanup. No local codemode worker shim remains. | Native improvement, no local adoption/removal. Node normal sandbox/model-only tests pass; Bun-specific interruption and live-worker exhaustion were not executed. Do not change subagent concurrency to match this host limit. |
| Thinking dropped across model switches; provider image-error conversion; cache/protocol/retry fixes | Handoff already uses supported message conversion/serialization; local wrappers return host-compatible content; no provider transport fork to simplify. | Native behavior improvements, no actionable extension migration identified. No live provider/image-error request or measured cache/summary quality result claimed. |
| Kimi Chat Completions endpoint, OpenCode endpoints/APIs, model context/thinking catalog corrections | No local provider adapter or relevant endpoint workaround to replace. | Screened as host dependencies, not a general personal models/configuration audit. No credentials/models settings dumped and no provider setup changed. |
| Exact internal package pins; Nix launcher/build fixes | Managed host peer links still need refresh after a release-tree switch; this installation is not Nix. | Approved links refreshed. No dependency installation or local peer-range change recommended from pins alone. |
| Prompt-template empty quoted arguments and renderer line-label changes | Local Handoff candidate extraction uses structured call arguments, not rendered read labels. No local prompt-template tokenizer to remove. | Native improvement; A1 owns the only concrete custom-renderer consumer. No unrelated prompt-library work added. |
| Structured prompt events, reach metadata, namespace aliases, terminal status setter | These predate 1.3; no changed event declaration or new scoped status facility in the interval. | Not new API opportunities. Existing consumers/helpers remain; 1206 remains blocked on supported status ownership/arbitration. |

## Adoption order and limits

1. Repair [C1/C2](01-compatibility.md#required-compatibility-follow-up) so retained validation reflects the selected host.
2. Finish [D1](02-simplification-and-debt.md#d1--medium-priority-finish-local-acceptance-and-documentation-for-restored-resume-tools), and adopt A1 as a small independent renderer change.
3. Plan [D2](02-simplification-and-debt.md#d2--medium-priority-revisit-the-supported-clarify-overlay-remedy) as separately approved lifecycle/input/layout work. Do not invent local integrations for unshipped physical-identity or scoped-status APIs.

All recommendations are non-remediating. Optional metadata/API adoption does not weaken P0, no-UI behavior, trust boundaries, explicit tool restrictions, model-only exposure, cancellation, or user-data preservation. The [canonical validation record](01-compatibility.md#canonical-validation-record) is the authoritative executed-versus-skipped account.
