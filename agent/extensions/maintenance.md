# Extension maintenance

## Pi host dependency links

`agent/extensions` treats Pi host packages as peer dependencies and links them from the currently installed global Pi package tree.

After an ordinary `pi update`, no local `npm install` is normally needed.

For command details, environment overrides, and troubleshooting, see [`pi-host-deps/README.md`](./pi-host-deps/README.md).

If switching Node/nvm versions, changing npm global prefix, or moving/reinstalling the global Pi install, refresh the host-package symlinks:

From the Pi config root:

```bash
cd agent/extensions
npm run sync:pi-host-deps
npm run typecheck
```

Alternatively, from anywhere, use the standard Pi config path:

```bash
cd ~/.pi/agent/extensions
npm run sync:pi-host-deps
npm run typecheck
```

## Shared interactive dialogs

Permission approvals (including `/permissions`) and clarify exchanges use `shared/dialogQueue.ts` and `shared/dialogUi.ts`. Pi 1.0 tracks UI prompts but does not serialize them: a raw dialog can replace a displayed interaction without settling its promise.

When adding another consumer:

- Obtain the queue with `getSessionDialogQueue(pi)`. Do not substitute an independent lock or module/process-global queue: separately loaded extensions must coordinate, while independent SDK sessions must stay separate. The helper shares the queue through Pi's public session event bus and owns its lifecycle hooks.
- Capture `dialogs.scopeSignal(ctx.signal, executionSignal)` before any asynchronous preflight (omit the execution signal for event/command handlers). Pass it to preflight operations as well as the queued interaction so shutdown/reload cannot resume old work through a stale context.
- Keep the entire selector → custom-answer exchange and its state changes inside `dialogs.run(signal, ...)`. The queue releases its lock in `finally`; consumers must still check cancellation after awaits and before grants, notifications, or other side effects.
- Re-check enablement, scoped grants, and displayed state after acquiring the lock. Gather current state there and apply changes before releasing it; never broaden grant scope to eliminate duplicate prompts.
- Use cancellable UI helpers and supported dialog signals. Racing an abort against a promise alone does not dismiss the underlying interaction. Custom components must complete and dispose exactly once, including cancellation before host installation. Pi 1.0's plain editor and external-editor launch are not abort-aware; preserve the owning READMEs' documented TUI/RPC alternatives.
- Keep Priority 0 hard denials, no-UI blocking, and read-only/noninteractive work outside the dialog queue. Never offer approval for scopes hidden by truncated request details, and validate replies against the choices actually displayed.
- Cover queued/displayed cancellation, the complete custom-answer exchange, scoped-grant reuse, and fresh-instance reload. Cross-extension tests must exercise both registration orders and a new runtime on the same event bus; use fake dialogs and approved scratch fixtures, not personal state or real guarded mutations.

Future enrollment candidates are **subagent approval/escalation, handoff dialogs, and Trash confirmation**. They are not currently coordinated by this queue. Migrate all dialog entry points in a flow; partial enrollment can still replace an owned interaction. Until then, scheduling guarantees apply only to permissions and clarify, not to all extension dialogs.

See the [shared helper overview](./shared/README.md#dialog-helpers), the [permissions guide](./permissions/README.md#prompt-choices), the [clarify guide](./clarify/README.md#tool), and [cross-extension regression coverage](./pi-compatibility/README.md#dialog-concurrencytestts). Focused tests are in `shared/dialogQueue.test.ts`, `shared/dialogUi.test.ts`, the owning extension tests, and `pi-compatibility/dialog-concurrency.test.ts`.

## Tool availability at startup

Do not reconcile optional-tool availability with subtractive `setActiveTools()` calls during `session_start`: Pi drops unrelated pending restored tools when a loadout removes an active tool. Use `shared/toolAvailability.ts` for hidden withdrawal of unavailable tools while retaining eligible exposure/defaults and host allowlist filtering. Keep intentional user loadout changes in command handlers. See [0005](../../fixme/0005-tool-activation-and-mcp-restoration.md) and `pi-compatibility/tool-activation.test.ts` for the public-host regression contract.

## Extension verification

First prepare an approved test scratch root as described in the permissions extension's [safe test scratch setup](./permissions/README.md#safe-test-scratch-setup). Then run the combined Pi host declaration, TypeScript, and full test gate from `agent/extensions/`:

```bash
npm run verify
```

`npm run verify` requires `PI_PERMISSIONS_TEST_SCRATCH_ROOT`; it does not create or choose an approved scratch root automatically.

Run npm dependency commands from `agent/extensions/`, not from `agent/`.
