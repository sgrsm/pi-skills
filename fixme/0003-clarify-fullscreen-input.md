# 0003: Make clarify scrolling respect fullscreen input ownership

- **Status:** Deferred — confirmed; runtime fix withheld by user choice pending a host correction
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

## Current investigation and disposition

Revalidated at repository HEAD `0a5f25053f4df1a85cdf86bc995621bcc7a92676`, with installed **Pi 1.0.0**, Node **v22.19.0**. All five host links were valid. Relevant user settings have no `tuiMode`/fullscreen override and no custom keybindings file; the installed settings manager defaults to fullscreen. No personal settings or dependency links were changed.

**The original defect is confirmed, not already resolved or invalid.** Work package 0002 changed scheduling/cancellation but explicitly left this issue open. Current code still mounts a non-overlay selector, lacks normalized `handleMouse`, and emits raw mouse-mode enable/disable sequences. Actual public TUI routing with fake terminal input consumes PageUp/PageDown/Home/End/wheel before the component; captured interaction writes include both `?1000` and `?1006` enable/disable sequences while the renderer remains active. No terminal-specific degradation was live-tested.

### Why the recommended overlay fix was not retained

A test-first implementation used the supported `ctx.ui.custom(..., { overlay: true })` contract, normalized wheel events, injected keybindings, and bounds-aware rendering. It repaired the isolated scrolling behavior, but independent review exposed a host lifecycle defect:

- `HOST/dist/modes/interactive/interactive-mode.js`, `showExtensionCustom()`, completes an overlay by calling `this.ui.hideOverlay()`.
- `pi-tui/dist/tui.js`, `hideOverlay()`, pops the most recently added overlay, **not the specific custom component's overlay**.
- Fullscreen transcript search is processed before ordinary focused-overlay deferral. Opening search over clarify and then programmatically aborting the clarification pops search and leaves the disposed/cancelled clarification mounted and focused. Its settled completion callback cannot dismiss it: a dead modal remains.
- Completing in the factory/installation microtask window can instead remove an unrelated, previously open overlay.
- The host TUI documentation explicitly prohibits calling `OverlayHandle.hide()` on an overlay created by `ctx.ui.custom()`. No unsupported identity-removal workaround or private production import was added.

Both cases were reproduced with public TUI APIs and a faithful local custom-dialog adapter. A **supplementary version-checked private-host scratch probe** then called the actual `InteractiveMode.prototype.showExtensionCustom` with synthetic UI state and a fake terminal, independently confirming both results. The host root was resolved through the current package link and imported via `pathToFileURL`; no absolute host path or private subpath import is committed.

The user chose **“Defer the runtime fix pending a host correction”** rather than a larger public `TUI.showOverlay()`-owned lifecycle controller. All attempted runtime/helper/harness changes were undone using targeted edits. Final `clarify/index.ts`, `shared/dialogUi.ts`, `shared/dialogTestHarness.ts`, and `shared/dialogUi.test.ts` are unchanged from HEAD.

### Retained changes

- Added `pi-compatibility/clarify-input.test.ts`: explicit characterizations of the current input/mouse defects, regular-mode controls, and test-only custom-overlay routing/lifecycle probes. These passing tests **record known defects; they are not passing acceptance criteria** and must be revisited when the host/extension changes.
- Added missing owning regressions for RPC basic selection/descriptions and JSON/print no-UI rejection.
- Updated the owning and compatibility READMEs and this backlog entry. No tool exposure, activation, queue behavior, permission policy, configuration, real session data, or MCP services changed.

### Independent review and parent verification

One read-only scout checked host routing contracts; two independent read-only reviewers challenged host integration and lifecycle/test coverage. A follow-up read-only disposition review inspected the restored runtime, retained tests/docs, host source, and validation logs, finding no final in-scope blocker. All reviewer assessments were source/log inspections, not independently executed tests.

Parent verification reproduced the stacked-overlay cancellation defect and the attempted implementation's unnecessary three-line description cap with **two failing focused regressions**. Both implementation problems were removed by withdrawing the runtime patch, not reported as repaired host behavior.

Other review observations:

- Source inspection showed that a dock dialog from an unenrolled extension can take focus behind the proposed clarify overlay; this collision was not executed as a probe. That collision regression was not shipped. Enrolling unrelated dialogs remains outside 0003 and the existing 0002 boundary.
- Raw-wheel fallback settings, remapped-key UX, layout jitter, and unbound scrolling actions concerned the withdrawn implementation; no such new runtime behavior remains.
- Hardened the final fixture to require a fresh dialog record per open. Follow-up doc/coverage observations were verified: captured fullscreen host enables before interaction writes, exercised regular-mode raw-SGR wheel input, reproduced clipped bottom help, and clarified the test adapter's limits. No runtime changes were needed for these refinements.
- A test assumption that explicit `tui.setFocus(editor)` should preserve overlay focus was rejected after inspecting the public host contract; ordinary renders preserve focus, explicit reassignment can change it. Likewise, resize need not preserve an end anchor after shrinking; scroll clamping is the supported behavior.
- The existing custom-answer editor's long title/dock clipping is pre-existing and was not implemented as an independent fix.

### Actual validation

All commands ran from `agent/extensions/` with `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR` set to the private, canonical current-session scratch root containing the caller-created `.step1-test-root-ready` sentinel.

**Final retained state:**

- `node --test clarify/index.test.ts pi-compatibility/clarify-input.test.ts pi-compatibility/ui-mode-guards.test.ts shared/dialogUi.test.ts pi-compatibility/dialog-concurrency.test.ts`: **46 passed**, 0 failed/cancelled/skipped.
- `npm run verify`: valid host links, TypeScript passed, **342 tests passed**, 0 failed/cancelled/skipped.
- Optional actual-host completion probe: **both host lifecycle defects reproduced** using synthetic state; no live terminal, model request, external service, or real configuration fixture.

**Earlier investigation, not the final patch:** the initial acceptance run failed 9 regressions and passed 16 controls before executable changes. The attempted fix passed a 42-test focused suite and a 338-test full gate, but subsequent reviewer regressions failed twice and exposed why those passing suites were insufficient. The runtime patch was withdrawn; these earlier results do not establish resolution.

Artifacts are in:

`/private/var/folders/br/m0tzwhrx6t77qjyr7846jwyc0000gn/T/pi/session-01a0ff89-f7e5-740f-abc4-86ebaaaa5d78/clarify-tests/`

Files include `test-first.log`, `review-test-first.log`, `deferred-focused.log`, `deferred-verify.log`, `host-overlay-probe.mjs`, `host-overlay-probe.log`, and archived `attempted-acceptance-tests.ts.txt`. Scratch evidence is supplementary and ephemeral; committed characterizations reconstruct the relevant contracts.

Live fullscreen/regular terminal smoke tests were not performed. Passing fake-terminal tests cannot establish terminal-specific mouse degradation.

### Acceptance in the retained state

| Criterion | Evidence-based disposition |
|---|---|
| Focused question scrolling, not transcript | **Unmet:** all five input classes are intercepted in the actual fullscreen TUI. |
| Closing/cancelling preserves host mouse tracking | **Unmet:** captured host enables are followed by clarify's conflicting disables; exact terminal-specific effects remain untested. |
| Small terminals, resize, descriptions, keyboard selection, repeated interactions | **Not satisfied as a whole:** bottom-help clipping is reproduced; regular-mode selection/descriptions work in controls. Small-terminal/resize/repeated-interaction acceptance was not revalidated for the unchanged selector. |
| RPC/basic dialogs, JSON/print behavior, TUI guards | **Verified unchanged:** owning regressions and mode-guard tests pass. |
| Cancellation/focus cleanup agrees with 0002 | **Existing dock behavior preserved:** runtime/queue are unchanged; existing cancellation/lifecycle tests pass and a regular-mode control restores editor focus. The rejected overlay approach fails this criterion. |

### Related packages and follow-up

- **0002 remains Resolved and unaffected.** Final queue/UI runtime files are unchanged; existing scheduling, cancellation, shutdown/reload, cross-extension loader, no-UI/hard-denial, and scoped-grant coverage passes in the final gate. The new host blocker is specific to the unshipped custom-overlay approach, not a reason to reopen the existing dock-based 0002 resolution.
- **0004 and 0005 remain Open and unaffected by source inspection.** Whole-prompt contributions and subtractive startup activation paths are unchanged. Their independent acceptance criteria were not re-probed, so neither is closed.
- On any Pi version change, compare the actual `showExtensionCustom()` close path with the committed test adapter; the adapter alone cannot detect a host correction. Reconstruct the version-checked actual-host probe and revalidate identity-safe completion, including stacked search and completion before installation, before reviving the recommended fix. A future extension-owned public overlay controller would require renewed authorization under the user's deferral choice.
- No decision remains pending in this task. **0003 is Deferred, not Resolved.** Its original input/mouse defects remain.
