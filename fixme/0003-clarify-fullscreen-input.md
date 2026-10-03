# 0003: Make clarify scrolling respect fullscreen input ownership

- **Status:** Open
- **Priority:** Medium
- **Evidence:** Key/wheel consumption and raw mouse sequences reproduced; terminal degradation not live-tested
- **Area:** `agent/extensions/clarify`
- **Instructions:** [Package workflow and validation](README.md)

## Problem and evidence

`clarify/index.ts:229` uses non-overlay `ctx.ui.custom()`. Its component advertises and handles PageUp/PageDown/Home/End/wheel at `:308-369`, writes raw `?1000h/?1006h` on creation, and `?1000l/?1006l` on disposal (constants `:102-103`, enable write `:279`, disposal `:372-374`).

Pi's fullscreen `TuiAltScreen` installs a viewport input listener before the focused component. It consumes these keys/wheel unless deferring to an overlay. Clarify has no normalized `handleMouse` implementation. A fake-terminal probe confirmed all five input classes were consumed and both enable/disable sequences were emitted.

The host owns fullscreen mouse tracking and SGR decoding. Disabling its reporting/encoding may degrade later mouse actions until restart; confirm this on a real terminal before claiming the exact terminal-specific effect.

## Reproduce / test first

Read `HOST/docs/tui.md`, `docs/extensions.md`, and `examples/extensions/overlay-qa-tests.ts`. Build a 40-line clarify question with two options using a fake terminal (80×24), capture the custom component, and exercise the actual host viewport routing. Capture raw terminal writes and component disposal.

Use a small exported component/factory seam if needed. Do not rely only on `ctx.mode` tests: interactive `tui` includes both regular and fullscreen presentation.

## Recommended fix

- Give the selector correct input ownership in fullscreen, preferably a focused overlay with bounded dimensions.
- Use normalized mouse events/scrollable components and injected keybindings; do not manipulate fullscreen mouse modes directly.
- Keep a keyboard-complete interaction in regular mode. Remove unconditional mouse toggles there too unless a documented, scoped ownership/restoration mechanism is necessary.
- Preserve question scrolling, selected-description previews, custom-answer editing, focus, and completion-callback disposal.
- Fit the interaction to actual available bounds, not the entire terminal height when embedded in a smaller dock.

## Acceptance criteria

- Long-question page/home/end/wheel scrolling targets the question, not the transcript, while the dialog is focused.
- Closing/cancelling does not disable host mouse tracking.
- Small terminals, resize, selected descriptions, keyboard selection, and repeated interactions work.
- RPC still uses supported basic dialogs; JSON/print behavior and TUI-only guards remain unchanged.
- Cancellation/focus cleanup agrees with 0002.

## Validation

`node --test clarify/index.test.ts pi-compatibility/ui-mode-guards.test.ts`; add host-routing/component regressions and run `npm run verify`. If practical, manually smoke-test fullscreen and regular modes without changing persisted settings; report skipped live-terminal validation.

Related: [0002: dialog concurrency/cancellation](0002-dialog-concurrency-and-cancellation.md).
