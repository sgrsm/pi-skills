# TDR-20261009-1206: Report custom TUI dialogs as blocked in program status

- **Status:** Open — source-verified on installed Pi 1.1.0; no live dashboard reproduction
- **Priority:** Low; affects status-dashboard accuracy only. Clarify still waits for the user.
- **Created:** 2026-10-09
- **Area:** Pi host program-status reporting (`ExtensionUIContext.custom()`); `agent/extensions/clarify`

## Summary and decision

Pi 1.1.0 reports OSC 7501 program status. While a standard extension selector, input or editor waits for the user, the host reports `blocked` with the dialog title. Custom components shown through `ctx.ui.custom()` are not reported that way. A connected program-status dashboard can therefore show `working` while Clarify waits for a TUI selection or custom answer.

Clarify's behavior is unaffected: it still waits for the user. Only the external status is inaccurate. The Clarify README documents this user-visible limitation; documentation does not fix it.

Local decision: keep Clarify's custom selector and custom-answer editor, because they provide interaction features the standard dialogs do not. Do not use private host APIs, patch the installed package, or write competing raw OSC status output. The footer indicator from `ctx.ui.setStatus()` is not program-status reporting.

## Contract and source evidence

Here, **HOST** is the installed `@earendil-works/pi-coding-agent` package. Locate it through public module resolution or the host links in `agent/extensions/node_modules/`; do not hard-code a global installation path. Observations are for version **1.1.0**; search by symbol after upgrades.

1. `agent/extensions/clarify/index.ts`, `showClarifySelector()`, uses `showCancellableCustom()` from `agent/extensions/shared/dialogUi.ts` for the TUI selector. The TUI custom answer uses the shared `showCancellableEditor()`, which also goes through `ctx.ui.custom()`. Non-TUI modes use `select()` and `input()`.
2. `HOST/dist/modes/interactive/interactive-mode.js`: the standard extension selector, input and editor paths call `programStatus.setBlocked("extension-dialog", …)` when displayed and clear it when hidden. `showExtensionCustom()` does not.
3. `HOST/dist/modes/interactive/program-status-reporter.js` reports the most recent blocked entry; otherwise an active run reports `working`.
4. `HOST/dist/core/extensions/types.d.ts`: `ExtensionUIContext.custom()` and its options expose overlay settings and a handle only. No program-status setter or blocked metadata is public.
5. `HOST/docs/terminal-setup.md#program-status` documents `blocked` as "An extension dialog or login waits for you," with the dialog title as the message. It does not address custom components.

These are source observations. A live terminal or dashboard status reproduction was **not** performed.

## Narrow upstream direction

Prefer an opt-in blocked indicator, or another supported scoped API, for custom interactions. Not every custom UI waits for the user (animations and passive overlays, for example), so the host should not assume it. Final naming and design belong upstream.

Requirements for any such facility:

- Report only while the custom interaction is actually displayed.
- Clear on completion, cancellation, failure and teardown, including reload and shutdown.
- Keep independent waits from clearing each other's status.
- Allow a generic safe label such as `Clarify`. Terminal status metadata must not carry question text or custom-answer text.

## Upstream tracking

No upstream issue is linked yet. This record does not establish whether one already exists. Before filing anything, search upstream for an existing issue; filing requires explicit approval.

## Acceptance and closure

Close this record only after a supported host facility exists and its behavior is verified for:

- TUI selection and TUI custom answers;
- cancellation, failure, reload and shutdown clearing;
- independent waits that do not interfere with each other;
- non-blocking custom UIs that are not misreported;
- the privacy label expectations above.

After host upgrades, recheck the public API and host behavior before changing the local integration. Any executable remediation requires separate approval and focused failing tests first. Make host changes in an authorized Pi source checkout, not the installed package; integrate a supported public API locally only after verifying host support.
