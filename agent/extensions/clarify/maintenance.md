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

Fullscreen mouse-mode ownership is corrected locally: Clarify no longer enables or disables Pi's mouse reporting. On the tested Pi 1.0.3, Home/End routing works; PageUp/PageDown/wheel routing within the question, help clipping, regular-mode mouse ownership, and the host overlay-completion defect remain open. The broader overlay remediation is still deferred. The full evidence, host blocker, scoped correction, safety boundaries and acceptance criteria are in [TDR-20261009-1201](../../../tdr/blocked/20261009-1201-clarify-fullscreen-input-host-blocker.md); do not duplicate them here.

`showClarifySelector()` snapshots `tui.mode === "regular"` at creation and uses that same ownership decision for legacy mouse setup and disposal. Fullscreen emits neither toggle. The non-overlay presentation, raw key/wheel parsing, and terminal-row rendering budget are unchanged. `pi-compatibility/clarify-input.test.ts` protects fullscreen ownership across selection, Escape, and abort, post-dialog wheel routing, working routes, and regular-mode setup/cleanup. `clarify-input.diagnostic.ts` retains the outstanding positive requirements, including removal of regular-mode toggles. Its custom-dialog lifecycle adapter is not an actual host-method invocation; reconstruct the TDR's scratch-only real-host probe after upgrades. Fake-terminal tests do not emulate Ghostty's wheel-to-arrow fallback or establish live-terminal behavior after the correction.

## Program-status limitation

TUI Clarify selection and custom-answer UI use `ctx.ui.custom()`, which Pi 1.1.0 does not report as `blocked` in program status. The evidence, local decision and closure criteria are in [TDR-20261009-1206](../../../tdr/blocked/20261009-1206-custom-dialog-blocked-status.md); do not duplicate them here.

## Startup availability and resume

Do not use subtractive `setActiveTools()` during `session_start`; follow [Tool availability at startup](../maintenance.md#tool-availability-at-startup). Only explicit `/clarify off` removes the tool from the active set. Host SDK/CLI resume omission of selected tool declarations is separate and still open: [TDR-20261009-1202](../../../tdr/blocked/20261009-1202-sdk-cli-resume-tool-restoration-host-defect.md).

## Structured prompt section

The hook writes or deletes `systemPromptOptions.sections.clarify_policy`: UI policy, plain-text note without UI, or removal when disabled/inactive. Tool metadata and the interactive policy share direct-call-only guidance; the no-UI note still asks in plain text rather than advertising a usable tool. Follow [Structured prompt contributions](../maintenance.md#structured-prompt-contributions); do not return `systemPrompt` from this hook.

## Validation

Prepare [approved test scratch](../permissions/README.md#safe-test-scratch-setup), export `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR`, then from `agent/extensions/`:

```bash
node --test clarify/index.test.ts pi-compatibility/clarify-input.test.ts pi-compatibility/dialog-concurrency.test.ts pi-compatibility/ui-mode-guards.test.ts pi-compatibility/structured-prompt.test.ts pi-compatibility/tool-activation.test.ts
npm run verify
```

Tests use injected clarify state (`loadModeState`) and fake dialogs, never personal clarify settings. Run `npm run diagnose:pi-host` separately after host upgrades and before closing TDR-20261009-1201/TDR-20261009-1202; it exits nonzero while the tracked defects persist. A green contract gate does not resolve those defects.
