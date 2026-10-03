# 0012: Respect native expansion for visible Git inspection results

- **Status:** Open — narrowed to Git's visible collapsed/expanded rendering
- **Priority:** Low; rendering improvement, not an execution failure
- **Evidence:** Git expansion gap source-verified; hiding is intentional; hide-toggle refresh is an accepted limitation
- **Areas:** `git-inspect`; `hide-tool-output` and `short-paths` for compatibility only
- **Instructions:** [Package workflow and validation](README.md)

## Current disposition and implementation scope

| Subfinding | Disposition | Remaining action |
|---|---|---|
| Visible Git results ignore expanded state | Actionable, low priority | Add a bounded collapsed preview and full expanded view within existing output limits. |
| Expanding a hidden result does not reveal it | Intentional; dismissed as a defect | Preserve the explicit hiding contract. |
| `/hide-tool` refresh can reset individual expansion choices | Accepted, documented limitation | No refresh redesign in this package. Revisit if fullscreen per-row expansion makes the reset disruptive. |
| `/short-paths` refresh resets expansion | Resolved by 0008 | Preserve its row-local invalidation behavior. |

The inspected local setup has hiding enabled and uses regular TUI mode, so the visible-output gap and fullscreen mixed-expansion reset have low current exposure. These settings are evidence of applicability, not permanent assumptions.

The [hide-tool-output guide](../agent/extensions/hide-tool-output/README.md#troubleshooting) already explains both expansion limitations. The [short-paths maintenance notes](../agent/extensions/short-paths/maintenance.md) record the refresh boundary. No new TDR is needed for these accepted behaviors. Pi's public row invalidation API exists, but replacing the hide-toggle refresh across all participating renderers is separate optional work, not a blocker for the Git preview.

This disposition is based on source/docs review, not a new live-terminal reproduction or test run. Earlier re-checks below retain their historical scope; remaining acceptance criteria are the narrowed criteria in this section and below.

## Observation and evidence

`renderGitInspectionResult` (`git-inspect/index.ts:526-551`) renders the entire available output (up to 2,000 lines) when output is not hidden. Its registered `renderResult` at `:614` does not use `_options`, including expanded state. This defeats a compact fullscreen default.

The wrapped `renderResult()` in `hide-tool-output/index.ts` intentionally returns an empty result component while hiding is enabled. Native expansion therefore cannot reveal a hidden result. This is not automatically a bug: the extension promises a persistent hiding preference.

At the audit baseline, both extensions refreshed rows by flipping `setToolsExpanded()` twice. The host applies this globally and resets per-block expansion state (`HOST/dist/modes/interactive/interactive-mode.js`, `setToolsExpanded`). After 0008, only `hide-tool-output/index.ts`'s `refreshToolRows()` retains that behavior for `/hide-tool`. `/short-paths` uses public per-row invalidation instead, as verified below.

## Reproduce / test first

Review owning READMEs and native renderer conventions in fullscreen/regular modes. With synthetic long output, call the Git renderer collapsed/expanded and establish the failing preview regression before changing code.

Test error results, partial results, lastComponent reuse, huge single lines, and ANSI/Unicode widths. Keep the output-truncation notice discoverable when the preview is collapsed. No Git mutation is needed.

Mixed per-block expansion and hide-toggle refresh reproduction are optional follow-up work only if the accepted limitation is reopened.

## Recommended fix and scope

- Give visible git-inspect results a bounded collapsed preview and full expanded view, following host renderer conventions.
- Preserve explicit `/hide-tool on` semantics: do not silently make Ctrl+O bypass hiding. If that UX is wanted, it needs a separate user decision and README change.
- Do not redesign `/hide-tool` refresh or change `/short-paths` invalidation under this package. Do not add private UI traversal.
- Keep errors diagnosable according to existing hide/show behavior, without changing model-facing output or truncation limits.

## Acceptance criteria

- Visible git-inspect output is compact when collapsed and complete within existing bounds when expanded.
- Hidden mode stays consistent with its documented contract, including errors; expansion does not bypass hiding.
- Partial/error results and reusable components remain host-compatible; collapsed previews are bounded even for long wrapped lines.
- Existing output-limit notices remain discoverable.
- No execution/schema/model-result changes or cross-tool refresh redesign are introduced.

## Validation

`node --test git-inspect/index.test.ts hide-tool-output/index.test.ts hide-tool-output/renderStrategy.test.ts`; focused collapsed/expanded renderer regressions; `npm run verify` with approved scratch. Refresh redesign tests are not required unless that separate scope is reopened.

Related: [0008: loader state synchronization](0008-short-paths-loader-state.md).

## Historical re-checks

### Re-check after 0008

0008 is resolved. Public-loader tests verify synchronized path preferences across separate jiti instances; actual public `ToolExecutionComponent` tests verify `/short-paths` redraws existing rows without changing mixed expansion or result-line counts. Pi 1.0.0 exposes the supported `ToolRenderContext.invalidate()` callback, so this path does not require global expansion changes or private UI traversal. Final checks passed **17 focused, 26 related, and 547 full-gate tests**, plus TypeScript and five valid host links. See 0008 for review reconciliation, actual-host GC evidence and limits.

**Status remains Open:** `/hide-tool` still uses global-expansion refresh, and source inspection still shows `git_inspect.renderResult()` ignoring expanded options. The related Git tests passing do not establish the compact/expanded acceptance criteria. Explicit hiding remains unchanged and was regression-tested; no Ctrl+O bypass, Git renderer change, or unrelated refresh fix was implemented here.

### Re-check after 0009

**Still Open:** source inspection confirms global `/hide-tool` expansion refresh and Git's ignored expansion options remain. Related rendering tests pass, but do not establish these criteria; [0009](0009-wrapped-built-in-configuration.md#resolution-and-validation) changes configuration only.
