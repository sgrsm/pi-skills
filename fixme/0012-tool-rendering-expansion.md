# 0012: Respect native expansion for visible Git inspection results

- **Status:** Implemented — narrowed Git rendering fixed; focused validation complete; integration gate pending
- **Priority:** Low; rendering improvement, not an execution failure
- **Evidence:** Preview gap reproduced test-first and fixed with synthetic renderer/public-host regressions on Pi 1.0.0; hiding remains intentional; hide-toggle refresh remains an accepted limitation
- **Areas:** `git-inspect`; `hide-tool-output` and `short-paths` for compatibility only
- **Instructions:** [Package workflow and validation](README.md)

## Current disposition and implementation scope

| Subfinding | Disposition | Remaining action |
|---|---|---|
| Visible Git results ignore expanded state | Implemented | Five-visual-line collapsed preview and complete available expanded text; focused checks pass, full integration gate pending. |
| Expanding a hidden result does not reveal it | Intentional; dismissed as a defect | Preserve the explicit hiding contract. |
| `/hide-tool` refresh can reset individual expansion choices | Accepted, documented limitation | No refresh redesign in this package. Revisit if fullscreen per-row expansion makes the reset disruptive. |
| `/short-paths` refresh resets expansion | Resolved by 0008 | Preserve its row-local invalidation behavior. |

The inspected local setup has hiding enabled and uses regular TUI mode, so the visible-output gap and fullscreen mixed-expansion reset have low current exposure. These settings are evidence of applicability, not permanent assumptions.

The [hide-tool-output guide](../agent/extensions/hide-tool-output/README.md#troubleshooting) already explains both expansion limitations. The [short-paths maintenance notes](../agent/extensions/short-paths/maintenance.md) record the refresh boundary. No new TDR is needed for these accepted behaviors. Pi's public row invalidation API exists, but replacing the hide-toggle refresh across all participating renderers is separate optional work, not a blocker for the Git preview.

The initial narrowing was based on source/docs review. The implementation and executed validation are recorded below; neither is a live-terminal check. Earlier re-checks retain their historical scope. Intentional hiding and accepted refresh behavior are not newly implemented fixes.

## Observation and evidence

At the audit baseline, `renderGitInspectionResult` (`git-inspect/index.ts:526-551`) rendered the entire available output (up to 2,000 lines) when output was not hidden. Its registered `renderResult` at `:614` did not use `_options`, including expanded state. This defeated a compact fullscreen default; the implementation below addresses this rendering gap.

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

## Implementation and validation

The change is limited to `agent/extensions/git-inspect/` and this finding:

- Visible collapsed results show the first **five visual lines**, plus at most one bounded expansion-hint line and one bounded truncation-warning line. Long wrapped lines cannot grow the collapsed result beyond that budget.
- Expanded results render all available text blocks without adding another output cap or altering content/details. Pi's public `truncateToVisualLines`, native expansion hint, and TUI width utilities handle wrapping and ANSI/Unicode widths; no private host imports or UI traversal were added.
- Existing success/process-cap notices and text-only error truncation notices remain discoverable outside the preview. Expansion retains the original notice with its complete limit/reason text. Small, fully visible notices are not duplicated.
- The result slot consistently reuses and clears its `Container`, preventing stale output, hints, or warnings across partial/final/error/empty/hidden transitions. Explicit hiding is checked before output rendering, including for expanded errors.
- Execution, parameter schemas, argument preparation, model-facing results, process capture limits, and line/byte limits are unchanged. `/hide-tool` refresh and `/short-paths` invalidation were not changed.

### Executed checks

From `agent/extensions/`, with the approved private, canonical session scratch root and caller-created `.step1-test-root-ready` sentinel. `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR` both pointed to that root; `PI_CODING_AGENT_DIR` pointed to a synthetic scratch agent directory. No personal settings or real user data served as fixtures.

```bash
node --test git-inspect/index.test.ts hide-tool-output/index.test.ts hide-tool-output/renderStrategy.test.ts git-inspect/rendering.test.ts
npm run typecheck
```

- **Test-first:** the new nine-test renderer suite initially had **7 failures and 2 passes**, exposing ignored expansion, unbounded wrapped lines, missing collapsed warnings, and the public host row's unbounded preview. The planned consistent-`Container` reuse regression also failed because the old renderer switched component types; that switch alone is not claimed as a host defect. The passing controls characterized pre-existing small-result and explicit-hiding behavior.
- **Final focused run:** **23 tests passed; 0 failed, cancelled, or skipped**. The new tests cover collapsed/expanded output through the existing 2,000-line bound; a nearly 50 KB single line; ANSI, tabs, wide Unicode/emoji/combining marks; resize/invalidation; text-block filtering; partial/errors without details; success/process-cap/error notices; component reuse; and hidden expanded errors.
- **Public host regression:** the actual exported `ToolExecutionComponent` receives expanded/partial/error context and reuses its result slot correctly with synthetic content. This is an in-process host-component check, not an end-to-end terminal reproduction.
- **Typechecking:** final `npm run typecheck` passed, including all five existing host-link checks. A scoped Git Inspect check also passed using the repository compiler options (`tsc --ignoreConfig --noEmit --target ES2024 --module NodeNext --moduleResolution NodeNext --allowImportingTsExtensions --strict --skipLibCheck --types node git-inspect/index.ts git-inspect/index.test.ts git-inspect/rendering.test.ts`). An earlier repository check encountered concurrent in-progress `trash-history/index.test.ts` errors; the final rerun passed without edits to that area.
- A read-only scout inspected the installed rendering contracts and public seam; the parent verified the public exports and implemented/tested the change. The scout ran no tests.

### Retained limitations and pending integration

- Hiding, including hidden errors, is **intentional and preserved**, not fixed by making expansion bypass it.
- `/hide-tool` can still reset individual expansion choices: **accepted, unchanged**. `/short-paths` row-local invalidation remains the separate resolved 0008 behavior.
- Expansion cannot recover text discarded by the existing model/process output limits. Very narrow widths may abbreviate the hint or warning; full available text and notices remain accessible by expansion when hiding is off.
- **`npm run verify` was deliberately not run:** the user reserved the full verification gate for integration. Re-run it with approved scratch after combining concurrent work before marking integration complete. No live-terminal, provider, MCP, personal configuration, or `/reload` validation was performed.
- `fixme/README.md` was not edited under the explicit write boundary; its index status may still say Open until integration updates it.

Refresh redesign tests are not required unless that separate accepted scope is reopened.

Related: [0008: loader state synchronization](0008-short-paths-loader-state.md).

## Historical re-checks

### Re-check after 0008

0008 is resolved. Public-loader tests verify synchronized path preferences across separate jiti instances; actual public `ToolExecutionComponent` tests verify `/short-paths` redraws existing rows without changing mixed expansion or result-line counts. Pi 1.0.0 exposes the supported `ToolRenderContext.invalidate()` callback, so this path does not require global expansion changes or private UI traversal. Final checks passed **17 focused, 26 related, and 547 full-gate tests**, plus TypeScript and five valid host links. See 0008 for review reconciliation, actual-host GC evidence and limits.

**Status remains Open:** `/hide-tool` still uses global-expansion refresh, and source inspection still shows `git_inspect.renderResult()` ignoring expanded options. The related Git tests passing do not establish the compact/expanded acceptance criteria. Explicit hiding remains unchanged and was regression-tested; no Ctrl+O bypass, Git renderer change, or unrelated refresh fix was implemented here.

### Re-check after 0009

**Still Open:** source inspection confirms global `/hide-tool` expansion refresh and Git's ignored expansion options remain. Related rendering tests pass, but do not establish these criteria; [0009](0009-wrapped-built-in-configuration.md#resolution-and-validation) changes configuration only.
