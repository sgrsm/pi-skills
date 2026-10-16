# Git Inspect rendering maintenance

Maintainer contract for `git_inspect` result display. For user-visible behavior, see the [Git Inspect guide](README.md#display). Rendering lives in `index.ts` (`renderGitInspectionResult`, `GitInspectionPreview`).

## Display contract

- **Collapsed preview:** show at most five *visual* lines (after wrapping), not logical lines, so a single huge or wide line cannot grow the row. Use Pi's public `truncateToVisualLines` and TUI width utilities; no private host imports or UI traversal.
- **Extra lines:** at most one bounded expansion hint and one bounded truncation warning, each clipped to the available width.
- **Expanded view:** render all available text blocks. It adds no new cap and does not recover output already discarded by the existing result or process capture limits.
- **Notice discoverability:** a success/process-cap or error truncation notice must stay discoverable when it falls outside the preview. Do not add a warning when the original notice is already fully visible in the preview.
- **Narrow widths:** the hint and warning may be abbreviated or clipped. The full available text and original notice remain reachable by expansion when hiding is off.
- **Component reuse:** always reuse the previous `Container` when present and `clear()` it before rendering. Partial, final, error, empty, and hidden results must not leave stale output, hints, or warnings.
- **Hiding:** explicit `/hide-tool on` is checked before output is read and wins over expansion, streaming, and errors. Expansion must never bypass it; changing that needs a separate user decision and README update.

## Preserved boundaries

Rendering must not change execution, parameter schemas, argument preparation, model-facing content or details, process capture limits, or the 2,000-line / 50 KB output limits.

## Refresh behavior

Two refresh paths are intentionally different; do not conflate them:

- **`/hide-tool` toggle (accepted limitation):** `hide-tool-output` refreshes rows by toggling global expansion, which resets per-row expansion choices. Git Inspect does not change this.
- **`/short-paths` (row-local):** uses public per-row `invalidate()` and preserves expansion. See [short-paths maintenance](../short-paths/maintenance.md#redraw-and-row-lifetime).

Replacing the hide-toggle refresh is separate work across all participating renderers, not part of Git preview rendering.

## Regression anchors

`rendering.test.ts` covers collapsed/expanded output, wrapped ANSI/tab/Unicode lines across resize, notices, partial and error results, container reuse, hiding, and the public host `ToolExecutionComponent` with synthetic content. These are in-process synthetic checks, not live-terminal or end-to-end guarantees.

Prepare the [approved scratch setup](../permissions/README.md#safe-test-scratch-setup), keep fixtures disposable, and isolate agent settings. From `agent/extensions/`:

```bash
node --test git-inspect/rendering.test.ts git-inspect/index.test.ts hide-tool-output/index.test.ts hide-tool-output/renderStrategy.test.ts
npm run typecheck
```

`../pi-compatibility/git-inspect-catalog.test.ts` separately loads `git_inspect` in the real codemode sandbox and checks that `describeTool()` shows the schema tags (`@integer`, `@minimum`/`@maximum`, `@maxItems`). It pins current host formatting, not a public API guarantee, and never invokes Git or a provider (it asserts no nested calls). Run it with scratch prepared as above:

```bash
node --test pi-compatibility/git-inspect-catalog.test.ts
```

Run `npm run verify` as the full gate per [extension maintenance](../maintenance.md).
