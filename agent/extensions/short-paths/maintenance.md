# Short-paths state and rendering maintenance

Maintainer notes for the integration between `short-paths` and `hide-tool-output`.
For commands and user-visible behavior, see the [short-paths guide](README.md) and
[hide-tool-output guide](../hide-tool-output/README.md).

## State ownership and synchronization

Pi can import each extension through a separate jiti instance. An imported
module singleton is therefore not a reliable cross-extension communication
channel. A cached factory may also be invoked for different runtimes; keep
command and consumer caches local to each factory/API instance.

- `short-paths/index.ts` owns command persistence. Its cache is initialized from
  the saved file and reread on `session_start`.
- `short-paths/state.ts` resolves `short-paths.json` through `getAgentDir()`. The
  format remains `{ "enabled": boolean }`; missing or invalid data defaults to
  `true`. Set `PI_CODING_AGENT_DIR` before loading when using isolated settings.
- Each save snapshots its input and writes through public
  `withFileMutationQueue()`. Update command state and publish only after a
  successful write. A failed save must not announce an uncommitted preference.
- Committed commands emit `short-paths:state-change:v1` on `pi.events` with an
  `{ enabled: boolean }` payload.
- `hide-tool-output` reads its own initial cache, then replaces its subscription
  at `session_start`. It rereads the file and ignores invalid event payloads.
  Startup reconciliation must also update rows built before that event.
- `session_shutdown` unsubscribes and clears row registrations. Pi's runtime
  invalidation additionally removes tracked event subscriptions; do not depend
  on that backstop instead of explicit lifecycle cleanup.

The event channel is session-local. Separate processes or independent event
buses do not synchronize live; startup/reload picks up the saved preference.
There is no file watcher or render-time filesystem read.

### Compatibility helper exports

`getShortPathsState()` returns a module-local compatibility cache, not shared
state across extensions or the command's per-runtime cache. A successful
`saveShortPathsState()` updates that compatibility cache, but the helper alone
does not broadcast. Consumers needing immediate command-style updates should
use the owning command/event flow rather than relying on shared imports.

Rendering helpers are exported from `toolCallSummary.ts` and re-exported by
`index.ts`: `smartShortenPath`, `renderSmartToolCall`, and
`renderSmartVisibleToolCall`.

## Redraw and row lifetime

On Pi 1.0.0, public `ToolRenderContext.invalidate()` invalidates one host tool
component, rebuilds its display, and requests a render. It preserves the row's
expansion state. Use this callback rather than toggling global expansion to
refresh path summaries; do not traverse private UI containers.

`hide-tool-output` stores a Symbol-keyed registration on the stable
`context.state` object owned by each row. The registration holds the current
invalidation callback, while the extension keeps only `WeakRef`s to
registrations and prunes dead references on preference changes.

Important invariants:

- A strong global callback registry would retain detached host rows and their
  arguments/results after compaction or chat rebuilds.
- A weak reference to a callback alone is insufficient: the callback needs a
  strong owner within the live row, or it may disappear while the row is live.
- Register by row state, not only `toolCallId`; separate components must not
  overwrite each other's redraw registration.
- Repeated rendering updates a registration without adding another reference.
  Reentrant host invalidation must not duplicate redraws.
- Clear registrations at shutdown so old-session rows cannot be refreshed by a
  new session. Pi exposes no renderer-disposal hook for individual removed rows.

## Rendering boundaries

- Hidden mode uses compact summaries for read/edit/write/grep/find/ls.
- Visible default-shell tools use the smart header wrapper. Visible
  self-rendered edit/write calls retain the native renderer; path toggles do not
  alter those headers.
- Disabling smart shortening does not disable normal home-directory formatting.
- Tool execution remains delegated against the active session cwd. Changes to
  path state must not affect schemas, result data, activation or allowlists.
- Bash belongs to the permissions extension. Do not register a competing Bash
  definition here or change its guarded execution to fix display behavior.
- `/hide-tool` still refreshes through a global expansion toggle. Its potential
  reset of mixed row expansion is separate from path-state synchronization;
  preserve explicit hiding semantics when changing that behavior.

Recheck current host declarations and installed `docs/extensions.md` and
`docs/tui.md` when upgrading Pi; do not substitute private production imports.

## Built-in replacement configuration

File wrappers use `defaultActive: false` so host defaults, reload choices and allowlists control selection. Do not reconcile loadouts during `session_start`: subtraction can discard pending restored tools.

Read forwards `pi.getSettings().images?.autoResize ?? true` at execution, after runtime binding. Changes apply immediately to wrapped reads; native read picks them up on reload. Preserve delegated arguments, context, results and native metadata.

See [wrapper coverage and limitations](../pi-compatibility/host-contract-coverage.md#wrapped-builtinstestts).

## Validation

See the [loader regression coverage and limitations](../pi-compatibility/short-paths-loader.md).
Prepare the [approved scratch setup](../permissions/README.md#safe-test-scratch-setup)
before running tests. From `agent/extensions/`:

```bash
node --test pi-compatibility/wrapped-builtins.test.ts pi-compatibility/short-paths-loader.test.ts hide-tool-output/index.test.ts hide-tool-output/renderStrategy.test.ts
npm run verify
```

Keep fixtures disposable and isolate agent settings; never toggle personal
settings merely to validate synchronization. For general dependency and test
workflow, see [extension maintenance](../maintenance.md).
