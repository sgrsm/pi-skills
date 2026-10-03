# 0012: Respect native expansion without losing per-block display state

- **Status:** Open — verify intended UX before changing it
- **Priority:** Low; rendering improvement, not an execution failure
- **Evidence:** Source-verified behavior; desired UX requires comparison with current READMEs
- **Areas:** `git-inspect`, `hide-tool-output`, `short-paths`
- **Instructions:** [Package workflow and validation](README.md)

## Observation and evidence

`renderGitInspectionResult` (`git-inspect/index.ts:525-546`) renders the entire available output (up to 2,000 lines) when output is not hidden. Its registered `renderResult` at `:614` does not use `_options`, including expanded state. This defeats a compact fullscreen default.

The wrapped `renderResult()` in `hide-tool-output/index.ts` intentionally returns an empty result component while hiding is enabled. Native expansion therefore cannot reveal a hidden result. This is not automatically a bug: the extension promises a persistent hiding preference.

At the audit baseline, both extensions refreshed rows by flipping `setToolsExpanded()` twice. The host applies this globally and resets per-block expansion state (`HOST/dist/modes/interactive/interactive-mode.js`, `setToolsExpanded`). After 0008, only `hide-tool-output/index.ts`'s `refreshToolRows()` retains that behavior for `/hide-tool`. `/short-paths` uses public per-row invalidation instead, as verified below.

## Reproduce / test first

Review owning READMEs and compare native renderer behavior in fullscreen/regular modes. With synthetic long output, call git renderer collapsed/expanded. Set mixed per-block expansion in a fake/isolated host UI, toggle a display preference, and observe reset behavior.

Test error results, partial results, lastComponent reuse, huge single lines, and ANSI/Unicode widths. No Git mutation is needed.

## Recommended fix and scope

- Give visible git-inspect results a bounded collapsed preview and full expanded view, following host renderer conventions.
- Preserve explicit `/hide-tool on` semantics: do not silently make Ctrl+O bypass hiding. If that UX is wanted, it needs a separate user decision and README change.
- Refresh renderer state through supported invalidation/update APIs where possible, preserving individual blocks' expansion choices.
- If no public refresh API can preserve per-block state, document the limitation and avoid private UI traversal; do not fake success in tests.
- Keep errors diagnosable according to existing hide/show behavior, without changing model-facing output or truncation limits.

## Acceptance criteria

- Visible git-inspect output is compact when collapsed and complete within existing bounds when expanded.
- Preference toggles do not unnecessarily reset unrelated blocks where the public API permits preservation.
- Hidden mode stays consistent with its documented contract.
- No execution/schema/model-result changes; reusable components remain host-compatible.
- Any unavoidable public-API limitation is recorded explicitly.

## Validation

`node --test git-inspect/index.test.ts hide-tool-output/index.test.ts hide-tool-output/renderStrategy.test.ts`; focused refresh tests; `npm run verify` with approved scratch.

Related: [0008: loader state synchronization](0008-short-paths-loader-state.md).

### Re-check after 0008

0008 is resolved. Public-loader tests verify synchronized path preferences across separate jiti instances; actual public `ToolExecutionComponent` tests verify `/short-paths` redraws existing rows without changing mixed expansion or result-line counts. Pi 1.0.0 exposes the supported `ToolRenderContext.invalidate()` callback, so this path does not require global expansion changes or private UI traversal. Final checks passed **17 focused, 26 related, and 547 full-gate tests**, plus TypeScript and five valid host links. See 0008 for review reconciliation, actual-host GC evidence and limits.

**Status remains Open:** `/hide-tool` still uses global-expansion refresh, and source inspection still shows `git_inspect.renderResult()` ignoring expanded options. The related Git tests passing do not establish the compact/expanded acceptance criteria. Explicit hiding remains unchanged and was regression-tested; no Ctrl+O bypass, Git renderer change, or unrelated refresh fix was implemented here.
