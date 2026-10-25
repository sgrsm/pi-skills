# Clarify maintenance

Maintainer notes for [`clarify`](./README.md). User-facing behavior, commands and workarounds stay in the README.

## Source map

- `index.ts` — tool registration (`exposure: "model-only"`, `executionMode: "sequential"`), `/clarify`, hooks, the selector call (`showClarifySelector()`), RPC/basic selector (`showClarifyBasicSelect()`).
- `selector.ts` — the inline selector component (`createClarifySelector()`), shared dock budget (`clarifyDockHeight()`) and option-line rendering.
- `../shared/dialogQueue.ts`, `../shared/dialogUi.ts` — session queue, cancellable custom component/editor (`showCancellableCustom()` forwards optional host `custom()` options), bounded RPC details.
- `../shared/toolAvailability.ts` — startup availability.
- Tests: `index.test.ts`, `dock.test.ts`, `../pi-compatibility/clarify-input.test.ts`, `../pi-compatibility/clarify-host.test.ts` (with `clarifyHostChild.ts`), `../pi-compatibility/dialog-concurrency.test.ts`, `../pi-compatibility/ui-mode-guards.test.ts`, `../pi-compatibility/tool-activation.test.ts`, `../pi-compatibility/structured-prompt.test.ts`.

## Hooks

- `session_start` (clarify) reloads saved mode, calls the availability setter, adds the tool to the active set only when enabled, and refreshes the footer.
- `session_shutdown` is registered by `getSessionDialogQueue()` in `../shared/dialogQueue.ts`, not by `clarify/index.ts`; it cancels displayed and queued interactions, including on reload.
- `tool_call` blocks `clarify` while disabled; `execute()` rechecks inside the queue lock.
- `before_agent_start` owns the `clarify_policy` prompt section (see below).

## Dialog lifecycle

`execute()` captures `dialogs.scopeSignal(executionSignal, ctx.signal)` before validation and keeps the selector → custom-answer exchange inside one `dialogs.run()`. Abort, shutdown/reload and cancelled queue entries all return the ordinary cancelled result. Rules for any dialog consumer are in [Shared interactive dialogs](../maintenance.md#shared-interactive-dialogs).

- TUI selector uses `showCancellableCustom()` without overlay options, replacing the normal editor slot below the transcript. The custom answer uses `showCancellableEditor()` with the same default host presentation and an explicit layout budget (`{ maxRows: clarifyDockHeight }`). Its external-editor action is intercepted because an external process cannot be cancelled safely.
- Non-TUI modes (RPC) use `ctx.ui.select()` with `boundedDialogDetails()` (8,000 characters) and `ctx.ui.input()`; `customPrompt` becomes a placeholder. `ctx.mode === "tui"` (not `hasUI`) gates the custom component (`canUseClarifyCustomSelector()`).
- Pi 1.0 does not send RPC clients a dismissal event, so an obsolete RPC dialog can stay visible after the backend request settles.
- Only clarify and permissions are enrolled in the queue.

## Docked selector

Both stages use supported `ctx.ui.custom()` without `overlay: true`. Pi 1.4.0 installs them in its editor-slot dialog stack; fullscreen lays that slot out below the transcript instead of compositing over it.

- **Completion.** Always use the host callback through `showCancellableCustom()`, including cancellation before installation. Never remove host UI directly or write terminal mouse modes. The shared helper still supports overlay consumers and owns disposal of never-installed components.
- **Layout.** `render(width)` receives no available-height argument. Both stages use `clarifyDockHeight(rows)`: at most half the live terminal height, capped at 16 rows, and leaving six rows for ordinary host chrome. The selector cache includes width and budget. Tiny terminals degrade to one content row, but host minimum sizes, extra widgets, queued-message/status rows or an unusually large footer can still clip the dock. Do not claim visibility at every size.
- **Allocation.** Prefer several question rows over borders/title/status. Within the compact budget, shrink the option window and description preview before reducing the question below three rows. The selected option is never dropped from the component output. Descriptions show the rows that fit and mark clipping with `…`. Short layouts use a dedicated compact selection/cancel hint, not the first line of wrapped full help.
- **Keyboard.** Navigation, confirm/cancel and Home/End use injected keybindings. Question paging accepts `tui.select.pageUp/pageDown` and `tui.editor.pageUp/pageDown`, excluding the fullscreen viewport page keys. Defaults are Ctrl+PageUp/PageDown in fullscreen, plain PageUp/PageDown in regular mode. Fullscreen plain PageUp/PageDown belongs to the transcript because Pi intercepts viewport actions before inline input. Terminals must deliver distinct modified page keys, or users need remapping/wheel/regular mode.
- **Pointer.** Normalized wheel events over the selector scroll the question and are consumed even at boundaries; wheel over the transcript keeps normal behavior. Other gestures follow the host default, including text selection and OSC 8 link activation. Regular mode leaves the mouse to the terminal.
- **Custom answer.** `showCancellableEditor()` accepts a sixth, optional layout argument separate from host custom options. Clarify supplies `{ maxRows: clarifyDockHeight }`; other callers retain their existing default. Bounded output uses `fitEditorDialogLines()`, shedding context and hints before windowing around the cursor, and consumes wheel only. The full question remains in the transcript if the editor title is shortened. Click-to-position inside the editor is not forwarded.
- **Search and picker limitations.** Search opened before a clarification is restored afterward. If search or another overlay opens above an existing inline panel, removing that panel calls the host's editor restoration and can move focus to the main editor while leaving the overlay visible. Do not work around this by patching host focus or overlay handles. Search can be closed with its shortcut. Tests characterize this limitation; update those expectations if the host fixes it. Installing an inline dialog also disposes an active built-in selector in Pi 1.4.0.

Coverage and limits are in [host-contract coverage](../pi-compatibility/host-contract-coverage.md#clarify-inputtestts-and-clarify-hosttestts). The renderer fixture uses public APIs with a copied installation/completion adapter; `clarify-host.test.ts` independently drives real `InteractiveMode` with a fake terminal. Neither substitutes for live-terminal testing.

After a Pi upgrade, re-read installed `docs/tui.md`, `docs/extensions.md` and relevant custom-component examples; compare `showExtensionCustom()`, the editor-slot stack and fullscreen dock/input routing with the fixture, then rerun the actual-host test.

## Program-status limitation

TUI Clarify selection and custom-answer UI use `ctx.ui.custom()`, which Pi 1.1.0 does not report as `blocked` in program status. The evidence, local decision and closure criteria are in [TDR-20261009-1206](../../../tdr/blocked/20261009-1206-custom-dialog-blocked-status.md); do not duplicate them here.

## Startup availability and resume

Do not use subtractive `setActiveTools()` during `session_start`; follow [Tool availability at startup](../maintenance.md#tool-availability-at-startup). Only explicit `/clarify off` removes the tool from the active set. Core SDK/CLI transcript restoration is fixed in Pi 1.3.0; selection/lifecycle controls and their limits are in [resume coverage](../pi-compatibility/host-contract-coverage.md#sdk-resumetestts).

## Structured prompt section

The hook writes or deletes `systemPromptOptions.sections.clarify_policy`: UI policy, plain-text note without UI, or removal when disabled/inactive. Tool metadata and the interactive policy share direct-call-only guidance; the no-UI note still asks in plain text rather than advertising a usable tool. Follow [Structured prompt contributions](../maintenance.md#structured-prompt-contributions); do not return `systemPrompt` from this hook.

## Validation

Prepare [approved test scratch](../permissions/README.md#safe-test-scratch-setup), export `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR`, then from `agent/extensions/`:

```bash
node --test clarify/index.test.ts clarify/dock.test.ts pi-compatibility/clarify-input.test.ts pi-compatibility/clarify-host.test.ts pi-compatibility/dialog-concurrency.test.ts pi-compatibility/ui-mode-guards.test.ts pi-compatibility/structured-prompt.test.ts pi-compatibility/tool-activation.test.ts
npm run verify
```

Tests use injected clarify state (`loadModeState`) and fake dialogs, never personal clarify settings; the host test uses an isolated agent directory and HOME under the approved scratch root and no network. There is no remaining Clarify diagnostic: the formerly outstanding input, mouse-ownership and layout requirements are normal tests. A green gate still does not replace a live-terminal check.
