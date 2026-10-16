# Short-paths loader regression coverage

Maintainer notes for `short-paths-loader.test.ts`. For the production integration
contract, see [state and rendering maintenance](../short-paths/maintenance.md).
For user commands, see [short-paths](../short-paths/README.md) and
[hide-tool-output](../hide-tool-output/README.md).

## Test seam

The tests use public `discoverAndLoadExtensions()` and `ExtensionRunner` with an
in-memory session, isolated agent settings and fake UI. The command and wrapped
renderers load through separate jiti instances, in both registration orders.
Native Node imports alone could share module caches and conceal state divergence.

## Committed coverage

- All six supported file tools at narrow and wide widths, with output hidden and
  visible. Every smart renderer has a narrow-width control proving that enabled
  and disabled formatting differ; visible native edit/write calls are exempt.
- Loaded `read` rows with numeric, string, null, omitted, empty, malformed and
  non-finite ranges, hidden and visible, with short paths on and off, through one
  reused component. Narrow/wide and native-header controls are in
  `short-paths/toolCallSummary.test.ts`.
- Repeated on/off commands, successful/already/usage/status notifications,
  no-UI commands, normal home-path formatting and result hiding.
- Missing, malformed, null, non-boolean and saved-off configuration. A safe
  persistence failure verifies that uncommitted state is not published.
- Renderer-only loading without the command owner, and rows built before
  `session_start` when the saved preference changes before startup.
- Idempotent startup, subscription disposal, fresh-loader reload on the same
  bus, and same-runtime session replacement without stale row callbacks.
- Exactly-once fake row invalidation, plus public `ToolExecutionComponent`
  instances exercising real host invalidation, both render slots and
  `lastComponent` reuse. Matching call ids must not suppress a live row's redraw.
- Actual mixed row expansion and unchanged expanded/collapsed result-line
  counts, including partial/error output, with no global expansion calls.
- Hidden `edit` summaries honor `outputPad` 0 and 1 for fresh rows and for one
  reused component moving native → hidden → native while the setting changes.
  Indentation is counted from rendered text, not by comparing renderers.
- A scratch wrapper invokes one command factory twice with separately scoped
  buses. One factory's command cache must not suppress another's broadcast.

Fixtures restore environment variables, shut down and invalidate runtimes, and
never use personal settings, live providers or external MCP servers.

## Limits and supplementary lifetime checks

The factory-reuse wrapper is not a complete cached-loader or independent SDK
session integration test. Real host components use a fake `requestRender`;
passing tests do not imply a live regular/fullscreen terminal smoke test.
Native edit diff preflight is disabled for synthetic paths, so these tests do
not cover edit-preview filesystem integration.

Garbage collection is not asserted in committed tests because its timing is
nondeterministic. To investigate detached-row retention separately:

1. Use an approved disposable fixture and isolate `PI_CODING_AGENT_DIR` before
   loading the extensions. Locate the current host through the dependency link,
   record its version and use its declared public exports.
2. Run a scratch-only probe with Node `--expose-gc`. Construct actual public
   `ToolExecutionComponent` rows from the loaded definitions with a fake UI.
3. Retain one live control. Keep only weak references to the other components,
   yield between GC attempts and avoid dereferencing them between those turns,
   which would keep them alive for the current job.
4. Check that discarded components can be collected and that a subsequent
   preference change redraws the retained control, not detached rows.
5. Report observed collection counts and host/Node versions. A failure to
   collect within a bounded probe is not by itself proof of a strong-reference
   leak; inspect reference ownership before drawing that conclusion.

Do not retain absolute host paths or depend on temporary probe artifacts in
committed tests or production code.

## Run

First follow the [safe scratch setup](../permissions/README.md#safe-test-scratch-setup),
setting both `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR` to the approved
canonical root. From `agent/extensions/`:

```bash
node --test short-paths/toolCallSummary.test.ts pi-compatibility/short-paths-loader.test.ts hide-tool-output/index.test.ts hide-tool-output/renderStrategy.test.ts
npm run verify
```
