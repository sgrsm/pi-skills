# Clarify maintenance

Maintainer notes for [`clarify`](./README.md). User-facing behavior, commands and workarounds stay in the README.

## Source map

- `index.ts` — tool registration (`exposure: "model-only"`, `executionMode: "sequential"`), `/clarify`, hooks, the selector call (`showClarifySelector()`), RPC/basic selector (`showClarifyBasicSelect()`).
- `selector.ts` — the overlay selector component (`createClarifySelector()`), its layout budget, overlay placement (`clarifyOverlayOptions()`/`clarifyOverlayHeight()`) and option-line rendering.
- `../shared/dialogQueue.ts`, `../shared/dialogUi.ts` — session queue, cancellable custom component/editor (`showCancellableCustom()` forwards optional host `custom()` options), bounded RPC details.
- `../shared/toolAvailability.ts` — startup availability.
- Tests: `index.test.ts`, `../pi-compatibility/clarify-input.test.ts`, `../pi-compatibility/clarify-host.test.ts` (with `clarifyHostChild.ts`), `../pi-compatibility/dialog-concurrency.test.ts`, `../pi-compatibility/ui-mode-guards.test.ts`, `../pi-compatibility/tool-activation.test.ts`, `../pi-compatibility/structured-prompt.test.ts`.

## Hooks

- `session_start` (clarify) reloads saved mode, calls the availability setter, adds the tool to the active set only when enabled, and refreshes the footer.
- `session_shutdown` is registered by `getSessionDialogQueue()` in `../shared/dialogQueue.ts`, not by `clarify/index.ts`; it cancels displayed and queued interactions, including on reload.
- `tool_call` blocks `clarify` while disabled; `execute()` rechecks inside the queue lock.
- `before_agent_start` owns the `clarify_policy` prompt section (see below).

## Dialog lifecycle

`execute()` captures `dialogs.scopeSignal(executionSignal, ctx.signal)` before validation and keeps the selector → custom-answer exchange inside one `dialogs.run()`. Abort, shutdown/reload and cancelled queue entries all return the ordinary cancelled result. Rules for any dialog consumer are in [Shared interactive dialogs](../maintenance.md#shared-interactive-dialogs).

- TUI selector uses `showCancellableCustom()` with `{ overlay: true, overlayOptions }`; the custom answer uses `showCancellableEditor()` with the same presentation (`CLARIFY_OVERLAY_PRESENTATION`), and its external-editor action is intercepted, because Pi 1.0's external editor cannot be cancelled.
- Non-TUI modes (RPC) use `ctx.ui.select()` with `boundedDialogDetails()` (8,000 characters) and `ctx.ui.input()`; `customPrompt` becomes a placeholder. `ctx.mode === "tui"` (not `hasUI`) gates the custom component (`canUseClarifyCustomSelector()`).
- Pi 1.0 does not send RPC clients a dismissal event, so an obsolete RPC dialog can stay visible after the backend request settles.
- Only clarify and permissions are enrolled in the queue.

## Overlay selector

Pi 1.3.0 completes a custom overlay by hiding that interaction's own handle, so Clarify uses the supported route: `ctx.ui.custom(..., { overlay: true })` through `showCancellableCustom()`. Rules to keep:

- **Completion only through the callback.** Never call `OverlayHandle.hide()` (or `onHandle`) from extension code, and never write terminal mouse modes. Pi's docs prohibit direct hiding of a custom overlay; the host owns removal and focus retargeting, and `showCancellableCustom()` still supplies the cleanup the host skips for never-installed components.
- **Layout.** `render(width)` receives only a width. The selector derives its row budget from `tui.terminal.rows` through `clarifyOverlayHeight()`, which mirrors the `maxHeight: "100%"` rule in `clarifyOverlayOptions()`. Percentage sizes are resolved against the live terminal on every render, whereas a numeric margin is resolved once and would push the dialog off tiny terminals, so there is deliberately no margin. The cache is keyed by width and height. The budget is tied to the real renderers by a parity test; if you change the overlay options, change both and that test.
- **Allocation.** Chrome (borders, title, status, help) is shed in tiers as height shrinks; the selected option is never dropped. The question text and option window scroll, the description preview does not, so the former shrink first. There is no fixed description cap: every wrapped description row that fits is shown, otherwise the last row ends with `…`.
- **Input.** Actions use the injected `keybindings` (`tui.select.*` for navigation, confirm/cancel and question paging; `tui.editor.cursorLineStart/End` for top/bottom). The selector owns its selection state instead of `SelectList`, because `SelectList` reads the global keybindings. Wheel arrives as normalized events (`handleMouse()`); only wheel events are consumed, including a wheel at a scroll boundary, so it never falls through to the transcript. Press/drag/release/click return `undefined` on purpose: with an overlay shown the host selects text from the composited screen, so a drag selects the dialog text, and OSC 8 link clicks keep working. Consuming those events would capture the gesture and disable both. Regular mode has no mouse events; it is keyboard-only. The navigation help names the up and down keys separately (`↑/↓`, or e.g. `ctrl+p/ctrl+n`).
- **Custom answer.** Clarify passes the same overlay presentation to `showCancellableEditor(ctx, signal, title, prefill, options)`. A dock editor would be completed by the host's `restoreEditor()`, which refocuses the main editor even with search stacked above, so the editor is an overlay to keep focus identity-correct for the whole displayed exchange (selector, then editor). The optional `options` parameter is typed `CancellableCustomOptions`, which omits `onHandle`; without options the shared editor keeps the host default dock presentation (permissions rely on that), and RPC ignores options. In overlay mode `fitEditorDialogLines()` bounds the output to `tui.terminal.rows` (chrome is shed in order spacer, second hint line, hints, title; then the editor is windowed around its cursor line so the hardware cursor stays visible) and a `handleMouse()` consumes wheel events only. Click-to-position the cursor inside the editor is not forwarded. Both stages are covered in the fixture and in `clarify-host.test.ts`.

Coverage and its limits are in [host-contract coverage](../pi-compatibility/host-contract-coverage.md#clarify-inputtestts-and-clarify-hosttestts). `clarify-input.test.ts` uses public renderers with a test `custom()` adapter that mirrors Pi's close path; `clarify-host.test.ts` drives the real `InteractiveMode` with a fake terminal in a bounded subprocess using public exports only. Neither uses a live terminal: Ghostty wheel/trackpad behavior with the overlay is unverified, and a green gate does not establish it.

After a Pi upgrade, re-read `docs/tui.md`, `docs/extensions.md` and `examples/extensions/overlay-qa-tests.ts` in the installed host, compare `showExtensionCustom()` and the overlay layout code with the adapter and `clarifyOverlayHeight()`, and re-run the host test.

## Program-status limitation

TUI Clarify selection and custom-answer UI use `ctx.ui.custom()`, which Pi 1.1.0 does not report as `blocked` in program status. The evidence, local decision and closure criteria are in [TDR-20261009-1206](../../../tdr/blocked/20261009-1206-custom-dialog-blocked-status.md); do not duplicate them here.

## Startup availability and resume

Do not use subtractive `setActiveTools()` during `session_start`; follow [Tool availability at startup](../maintenance.md#tool-availability-at-startup). Only explicit `/clarify off` removes the tool from the active set. Core SDK/CLI transcript restoration is fixed in Pi 1.3.0; selection/lifecycle controls and their limits are in [resume coverage](../pi-compatibility/host-contract-coverage.md#sdk-resumetestts).

## Structured prompt section

The hook writes or deletes `systemPromptOptions.sections.clarify_policy`: UI policy, plain-text note without UI, or removal when disabled/inactive. Tool metadata and the interactive policy share direct-call-only guidance; the no-UI note still asks in plain text rather than advertising a usable tool. Follow [Structured prompt contributions](../maintenance.md#structured-prompt-contributions); do not return `systemPrompt` from this hook.

## Validation

Prepare [approved test scratch](../permissions/README.md#safe-test-scratch-setup), export `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR`, then from `agent/extensions/`:

```bash
node --test clarify/index.test.ts pi-compatibility/clarify-input.test.ts pi-compatibility/clarify-host.test.ts pi-compatibility/dialog-concurrency.test.ts pi-compatibility/ui-mode-guards.test.ts pi-compatibility/structured-prompt.test.ts pi-compatibility/tool-activation.test.ts
npm run verify
```

Tests use injected clarify state (`loadModeState`) and fake dialogs, never personal clarify settings; the host test uses an isolated agent directory and HOME under the approved scratch root and no network. There is no remaining Clarify diagnostic: the formerly outstanding input, mouse-ownership and layout requirements are normal tests. A green gate still does not replace a live-terminal check.
