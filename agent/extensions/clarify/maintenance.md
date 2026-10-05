# Clarify maintenance

Maintainer notes for [`clarify`](./README.md). User-facing behavior, commands and workarounds stay in the README.

## Source map

- `index.ts` — tool registration (`exposure: "model-only"`, `executionMode: "sequential"`), `/clarify`, hooks, selector component (`showClarifySelector()`), RPC/basic selector (`showClarifyBasicSelect()`).
- `../shared/dialogQueue.ts`, `../shared/dialogUi.ts` — session queue, cancellable custom component/editor, bounded RPC details.
- `../shared/toolAvailability.ts` — startup availability.
- Tests: `index.test.ts`, `../pi-compatibility/clarify-input.test.ts`, `../pi-compatibility/dialog-concurrency.test.ts`, `../pi-compatibility/ui-mode-guards.test.ts`, `../pi-compatibility/tool-activation.test.ts`, `../pi-compatibility/structured-prompt.test.ts`.

## Hooks

- `session_start` (clarify) reloads saved mode, calls the availability setter, adds the tool to the active set only when enabled, and refreshes the footer.
- `session_shutdown` is registered by `getSessionDialogQueue()` in `../shared/dialogQueue.ts`, not by `clarify/index.ts`; it cancels displayed and queued interactions, including on reload.
- `tool_call` blocks `clarify` while disabled; `execute()` rechecks inside the queue lock.
- `before_agent_start` owns the `clarify_policy` prompt section (see below).

## Dialog lifecycle

`execute()` captures `dialogs.scopeSignal(executionSignal, ctx.signal)` before validation and keeps the selector → custom-answer exchange inside one `dialogs.run()`. Abort, shutdown/reload and cancelled queue entries all return the ordinary cancelled result. Rules for any dialog consumer are in [Shared interactive dialogs](../maintenance.md#shared-interactive-dialogs).

- TUI selector uses `showCancellableCustom()`; the custom answer uses `showCancellableEditor()` whose external-editor action is intercepted, because Pi 1.0's external editor cannot be cancelled.
- Non-TUI modes (RPC) use `ctx.ui.select()` with `boundedDialogDetails()` (8,000 characters) and `ctx.ui.input()`; `customPrompt` becomes a placeholder. `ctx.mode === "tui"` (not `hasUI`) gates the custom component (`canUseClarifyCustomSelector()`).
- Pi 1.0 does not send RPC clients a dismissal event, so an obsolete RPC dialog can stay visible after the backend request settles.
- Only clarify and permissions are enrolled in the queue.

## Fullscreen input defect

On the tested Pi 1.0.3, fullscreen Home/End routing works; PageUp/PageDown/wheel routing, help clipping, and the mouse-mode ownership conflict remain open. The runtime fix is still deferred pending host overlay-completion correction. The full evidence, host blocker, reproduction, safety boundaries and acceptance criteria are in [TDR-0003](../../../tdr/0003-clarify-fullscreen-input-host-blocker.md); do not duplicate them here.

Pointers when revisiting: the selector writes `ENABLE_MOUSE_SCROLL` in `showClarifySelector()` on creation and `DISABLE_MOUSE_SCROLL` on disposal, in both TUI modes; scrolling uses raw key/wheel parsing rather than normalized `handleMouse()`; rendering budgets against terminal rows, not the smaller fullscreen dock. `pi-compatibility/clarify-input.test.ts` protects working routes and controls; `clarify-input.diagnostic.ts` asserts the outstanding positive requirements and currently fails. Its custom-dialog lifecycle adapter is not an actual host-method invocation; reconstruct the TDR's scratch-only real-host probe after upgrades. Live-terminal mouse effects have not been verified.

## Startup availability and resume

Do not use subtractive `setActiveTools()` during `session_start`; follow [Tool availability at startup](../maintenance.md#tool-availability-at-startup). Only explicit `/clarify off` removes the tool from the active set. Host SDK/CLI resume omission of selected tool declarations is separate and still open: [TDR-0004](../../../tdr/0004-sdk-cli-resume-tool-restoration-host-defect.md).

## Structured prompt section

The hook writes or deletes `systemPromptOptions.sections.clarify_policy`: UI policy, plain-text note without UI, or removal when disabled/inactive. Follow [Structured prompt contributions](../maintenance.md#structured-prompt-contributions); do not return `systemPrompt` from this hook.

## Validation

Prepare [approved test scratch](../permissions/README.md#safe-test-scratch-setup), export `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR`, then from `agent/extensions/`:

```bash
node --test clarify/index.test.ts pi-compatibility/clarify-input.test.ts pi-compatibility/dialog-concurrency.test.ts pi-compatibility/ui-mode-guards.test.ts pi-compatibility/structured-prompt.test.ts pi-compatibility/tool-activation.test.ts
npm run verify
```

Tests use injected clarify state (`loadModeState`) and fake dialogs, never personal clarify settings. Run `npm run diagnose:pi-host` separately after host upgrades and before closing TDR-0003/TDR-0004; it exits nonzero while the tracked defects persist. A green contract gate does not resolve those defects.
