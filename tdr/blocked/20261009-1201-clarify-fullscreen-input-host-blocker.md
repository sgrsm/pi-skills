# TDR-20261009-1201: Restore safe fullscreen clarify input

- **Status:** Open — broader remediation is blocked by the host lifecycle defect; input/layout issues also remain
- **Priority:** Medium
- **Created:** 2026-10-03
- **Area:** `agent/extensions/clarify`; Pi custom-dialog integration
- **Origin:** Pi 1.0.0 compatibility investigation, work package 0003

## Summary and decision

Clarify's fullscreen selector still loses question PageUp/PageDown/wheel input to the transcript on the tested Pi 1.0.3. Home/End scroll the question in the tested cases, but long dialogs can still have their bottom help clipped. A scoped local correction now leaves fullscreen mouse modes under Pi's ownership; regular-mode mouse setup/cleanup remains unchanged. The remaining defects are not intentional behavior or evidence of resolution.

The earlier focused custom overlay repaired input routing in isolation, but Pi 1.0.0's overlay-completion lifecycle was unsafe under stacked dialogs and cancellation before installation. The user chose to defer that broader runtime fix until the host is corrected, rather than introduce a larger extension-owned overlay controller. That attempted runtime/helper implementation was withdrawn; its tests and documentation were retained. The mouse-ownership-only correction below does not introduce overlays or change the completion contract.

This record is self-contained. It does not require the original audit/work-package files or ephemeral probe artifacts to understand or resume the work.

## Confirmed defects and impact

The investigation used Pi **1.0.0**, Node **v22.19.0**, and repository HEAD `0a5f25053f4df1a85cdf86bc995621bcc7a92676`. Host dependency links were valid. The inspected configuration had no TUI-mode override; the installed host defaults to fullscreen.

In that investigated version of `agent/extensions/clarify/index.ts`, `showClarifySelector()`:

- Opens a non-overlay `ctx.ui.custom()` component in the input dock.
- Handles and advertises PageUp/PageDown/Home/End/wheel scrolling, but has no normalized `handleMouse()` handler.
- Writes `\x1b[?1000h\x1b[?1006h` when created and `\x1b[?1000l\x1b[?1006l` when disposed, in both fullscreen and regular modes.
- Budgets rendering against terminal height rather than the smaller fullscreen dock.

Actual public `TuiAltScreen` routing with fake terminal input reproduced all five scrolling input classes moving the transcript instead of the question. A simplified fixed-dock composition reproduced clipped bottom help at 80×24. Captured writes confirmed that the fullscreen host enabled mouse tracking before clarify emitted its conflicting toggles. Regular-mode keyboard selection, description previews, and raw-SGR wheel handling worked in controls.

No live-terminal smoke test was performed. Disabling fullscreen reporting/encoding may degrade later mouse actions, but the exact terminal-specific effect remains unverified. Regular mode has terminal-owned scrollback, not host-owned fullscreen mouse tracking.

**Temporary user workaround:** ask for shorter questions or start Pi with `pi --tui-mode regular` for keyboard scrolling without changing saved settings. This is not a resolution.

## Host blocker: completion does not identify its own overlay

Here, `HOST` means the currently installed `@earendil-works/pi-coding-agent` package root; `pi-tui` means the linked `@earendil-works/pi-tui` package. The installed source established this contract:

1. `HOST/dist/modes/interactive/interactive-mode.js`, `InteractiveMode.showExtensionCustom()`, completes an overlay using `this.ui.hideOverlay()`.
2. `pi-tui/dist/tui.js`, `hideOverlay()`, pops the most recently added overlay, not the overlay belonging to that custom interaction.
3. Fullscreen `handleViewportInput()` processes transcript search before its ordinary focused-overlay deferral.
4. `HOST/docs/tui.md` explicitly prohibits calling `OverlayHandle.hide()` on an overlay created by `ctx.ui.custom()`; completion must use the supplied callback.

Two concrete failures were reproduced:

- **Stacked search:** open a custom overlay, open transcript search above it, then programmatically abort the custom interaction. Completion pops search and leaves the disposed/cancelled custom dialog mounted and focused. Its already-settled completion callback cannot dismiss it, producing a dead modal.
- **Before installation:** complete during the factory/installation microtask window while another overlay is open. The custom overlay never mounts, but completion still pops the unrelated overlay.

Public TUI tests with a faithful local custom-dialog adapter reproduced both cases. A version-checked scratch probe invoking the **actual** `InteractiveMode.prototype.showExtensionCustom` independently confirmed them using synthetic UI state. This was not a live session or terminal test.

Two independent read-only reviewers identified the lifecycle hazard; parent probes verified it. An attempted three-line description cap was also reproduced as a regression and removed with the withdrawn patch. A follow-up disposition review found no blocker to deferral. Reviewer assessments were source/log inspections, not independently executed tests.

## Pi 1.0.3 revalidation

Before the scoped correction below, public fullscreen renderer tests confirmed that Home/End moved the question without scrolling the transcript, while PageUp/PageDown/wheel moved only the transcript. Captured extension writes enabled and disabled mouse reporting in both TUI modes, and the simplified 80×24 dock clipped navigation help. Regular-mode interaction and focused-overlay routing were positive controls; that revalidation did not change the runtime selector.

Source inspection of Pi 1.0.3 still shows `showExtensionCustom()` calling topmost `hideOverlay()`. A scratch-only, version-checked invocation of the actual method on synthetic public `TuiAltScreen` state confirmed:

- Normal mounted completion removes the owned overlay, restores editor focus, and disposes once.
- Completion with transcript search stacked above removes search while leaving the disposed owned overlay mounted.
- Completion synchronously inside the factory, or after factory return but before installation, removes an unrelated overlay even though the owned one never installs. The raw host control does not dispose the never-installed component.

These are executed actual-method probes, not conclusions drawn from the adapter or the higher version number. They use fake terminal input and isolated synthetic state, not a live session. Live-terminal mouse effects, complete resize/layout acceptance, and the larger remediation remain unverified or deferred.

Working routes and controls belong in `clarify-input.test.ts`. Outstanding positive requirements belong in `clarify-input.diagnostic.ts`; `npm run diagnose:pi-host` exits nonzero while they remain broken. The shared `clarifyUiFixture.ts` adapter still models the observed close path and cannot independently detect a future host correction.

## Scoped fullscreen mouse-mode correction

The reported macOS/Ghostty symptom is trackpad gestures recalling prompt history after a Clarify dialog closes. The selector's disable sequences can leave the terminal translating wheel gestures into arrow keys instead of reporting mouse events to Pi.

`showClarifySelector()` now snapshots the supplied renderer's `tui.mode === "regular"` and uses that same decision for mouse setup and disposal. Fullscreen sends neither enable nor disable sequences, including on selection, Escape, and abort. Regular mode retains its existing raw-SGR wheel behavior and paired mouse toggles; removing those toggles remains an outstanding diagnostic requirement, not part of this correction.

The current non-overlay dock, shared FIFO, permission handling, and host completion lifecycle are unchanged. The host overlay blocker therefore still prevents the broader overlay remediation, but does not block this ownership-only correction.

The fullscreen ownership requirement is promoted into `clarify-input.test.ts`, covering creation/cleanup and post-dialog transcript wheel routing through the public renderer. Regular-mode setup/cleanup and input remain controls. These fake-terminal checks do not emulate Ghostty's wheel-to-arrow fallback; live-terminal verification of the correction remains separate. The earlier investigation and Pi 1.0.3 revalidation above describe the state before this scoped runtime correction.

## Reproduction and revalidation

### Durable tests

From the repository root, after preparing approved scratch as described below:

```bash
export PI_PERMISSIONS_TEST_SCRATCH_ROOT="<approved canonical scratch root>"
export TMPDIR="$PI_PERMISSIONS_TEST_SCRATCH_ROOT"
cd agent/extensions
node --test clarify/index.test.ts pi-compatibility/clarify-input.test.ts pi-compatibility/ui-mode-guards.test.ts shared/dialogUi.test.ts pi-compatibility/dialog-concurrency.test.ts
npm run verify
node --test pi-compatibility/clarify-input.diagnostic.ts
```

The contract tests and explicit diagnostics capture the actual clarify component through its registered tool with injected enabled state; they never use personal clarify configuration. `clarifyUiFixture.ts` shares public `TuiAltScreen`/`TuiMainScreen` fake-terminal fixtures and a test-only custom-dialog installation/completion adapter.

Contract tests protect working behavior. Diagnostics assert the remaining **positive acceptance requirements** and intentionally fail on the tested Pi 1.0.3; they do not assert that defects should persist and are not silently skipped or marked TODO. The overlay wheel control exercises raw-SGR fallback, not normalized mouse support in the unchanged extension. The adapter hard-codes the observed completion contract and will **not automatically detect** an identity-safe change in the actual host method. Reconstruct the actual-method probe below after upgrades; promote verified corrections into the normal suite.

### Reconstruct the actual-host lifecycle probe

Do not rely only on the adapter or a higher Pi version number:

1. Locate the current host through the extension package's module resolution or its `node_modules/@earendil-works/pi-coding-agent` link. Record the installed version; re-read current `docs/tui.md`, `docs/extensions.md`, declarations, and `examples/extensions/overlay-qa-tests.ts` under that host root before proceeding.
2. Inspect `showExtensionCustom()` and the renderer's overlay-removal implementation. Compare the actual close path with the committed adapter.
3. If the public API does not expose the relevant host completion method, use a **scratch-only, version-checked** explicit file import of `dist/modes/interactive/interactive-mode.js` via `pathToFileURL`. Do not commit a private subpath import or an absolute installation path. A missing/changed private seam must be reported, not silently treated as a pass.
4. Create a public `TuiAltScreen` with an 80×24 fake terminal capturing `start(onInput)` and writes; attach a synthetic transcript `ScrollView`. Do not construct a real interactive session.
5. Invoke the actual `InteractiveMode.prototype.showExtensionCustom.call()` on synthetic state containing `ui: tui`, `editor: { getText: () => "" }`, and the public keybindings manager. Supply a small component with a disposal counter and capture the completion callback; use `{ overlay: true }`. Wait for installation, render, and open search through the captured terminal callback. In Pi 1.0.0 with default bindings, `\x1b[102;6u` matches `tui.altScreen.search`; verify the current binding rather than assuming it remains unchanged.
6. Complete the custom interaction while search is above it. Under the corrected contract, the owned dialog must be removed, the unrelated overlay must remain usable, and disposal must occur exactly once.
7. Separately mount an unrelated overlay, then complete synchronously inside the custom factory before returning its component. The unrelated overlay must survive and the uninstalled interaction must leave no stale state. Also cover abort after factory return but before installation with the local cancellable helper.
8. Stop the fake renderer in cleanup. Record executed probes separately from source inspection and any skipped live-terminal checks.

## Safety and implementation boundaries

- Use an explicitly approved session scratch root that neither equals, contains, nor is contained by HOME, repository, or cwd; filesystem `/` is not permitted. It must be real, non-symlink, canonical, current-user-owned, and private (`0700`, not group/world writable), with a real current-user-owned caller-created `.step1-test-root-ready` sentinel. Set both environment variables above to that root; keep temporary probes and fixtures beneath it. Do not use HOME, the repository, personal settings, or real session/MCP data as fixtures.
- Use existing `node:test` conventions. Prefer local exported seams and public host APIs in committed tests. Add the smallest failing acceptance regression before executable changes; keep optional private-host probes in approved scratch only.
- Do not run live Trash/destructive operations, paid model requests, dependency installations, or external MCP services to reproduce this issue.
- Preserve model-only exposure, sequential execution, TUI-only custom-component guards, RPC/basic dialogs, JSON/print no-UI rejection, bounded output, and saved on/off behavior.
- Preserve the session-local FIFO in `shared/dialogQueue.ts`: clarify and permissions exchanges remain serialized, including custom-answer editing. Abort, shutdown/reload, late replies, and completion/disposal before installation must settle exactly once and restore usable focus.
- Limit changes to clarify's selector and genuinely necessary integration helpers. Do not enroll unrelated dialogs, change permission/trust policy or allowlists, repair unrelated prompt/startup activation paths, or independently redesign the custom-answer editor.
- Do not patch the installed host or use private host internals in production. An extension-owned `TUI.showOverlay()` lifecycle controller remains an alternative requiring renewed user approval; this record does not authorize that change.

## Future remediation and acceptance criteria

Revisit after a host correction demonstrates identity-safe custom-overlay completion. Use the current supported contract, not the withdrawn implementation as a patch specification. Close this TDR only when:

- Focused long-question PageUp/PageDown/Home/End/wheel input scrolls the question, not the transcript. Configurable actions use injected keybindings; fullscreen mouse handling uses normalized host events/deltas where supported.
- Opening, closing, and cancelling do not take over or disable host mouse modes. Regular mode remains keyboard-complete without unconditional mouse toggles.
- Actual available bounds are respected across small/narrow terminals, height-only and width resize, long questions, many choices, selected-description previews, and repeated interactions. Do not arbitrarily hide description detail that fits.
- Option selection and custom-answer editing still work; RPC uses supported basic dialogs, and JSON/print/TUI guards remain unchanged.
- Cancellation while queued/displayed, during factory installation, with transcript search or another overlay stacked above/below, and on shutdown/reload leaves no unresolved request, disposed-but-mounted component, stolen unrelated overlay, duplicate disposal, or stale focus.
- Existing permission/clarify queue and safety regressions remain green. Focused contract tests, the positive host diagnostics, typechecking, and the full gate pass with approved scratch, and a focused independent review challenges the host/lifecycle integration.
- Documentation matches actual behavior. Live-terminal checks are performed where practical; skipped checks and reproduction limits are explicitly recorded rather than treated as proof of resolution.

## Validation history and remaining uncertainty

In the deferred investigation's final retained state, the focused command above passed **46 tests**, and `npm run verify` passed host-link checks, TypeScript, and **342 tests**, with no failures/cancellations/skips. These results preserve existing behavior and record the defects; they do not meet the acceptance criteria.

The initial test-first acceptance run had 9 failures and 16 passing controls. A provisional implementation later passed 42 focused tests and a 338-test gate, but two additional reviewer-driven regressions exposed the description-cap and stacked-overlay problems. The runtime patch was withdrawn, illustrating why the earlier green gate was insufficient.

The scoped local correction resolves fullscreen mouse-mode ownership, not the full record. Question PageUp/PageDown/wheel routing, regular-mode mouse ownership, clipping/layout, and host overlay completion remain unresolved on the tested Pi 1.0.3. Small-terminal/resize/repeated-interaction acceptance is not complete. User-confirmed live validation covers macOS/Ghostty trackpad scrolling after normal option selection only; Escape, abort, and other terminal/input combinations remain unverified live. Historical scratch artifacts are not prerequisites: the tests and reconstruction steps above retain the actionable evidence.
