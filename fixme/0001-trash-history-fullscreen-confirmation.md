# 0001: Keep Trash confirmation choices visible in fullscreen

- **Status:** Resolved
- **Priority:** High — potentially misleading destructive-action confirmation
- **Evidence:** Reproduced with actual host selector/layout and fake terminal buffers
- **Area:** `agent/extensions/trash-history`
- **Instructions:** [Package workflow and validation](README.md)

## Problem and evidence

`index.ts:922-925` passes the entire `formatScanReport()` result to `ctx.ui.confirm()`, despite already publishing a preview. The report grows by project count and up to 30 session details plus headings/omission text.

Pi 1.0.0 defaults to fullscreen. `HOST/dist/modes/interactive/interactive-mode.js` (`showExtensionConfirm`) combines title/message into a selector with `["Yes", "No"]`. `components/extension-selector.js` defaults to index zero. `chat-viewport.js` places the selector in the shrinking editor dock.

An 80×24 host layout with ten eligible projects produced a 30-line confirmation. Both choices were clipped; Enter still selected Yes. No files were moved during the probe.

## Reproduce / test first

**Optional host probe:** construct synthetic `ScanResult` candidates across ten cwd values, call `formatScanReport()`, and render the current confirmation through `ExtensionSelectorComponent`, `createChatViewport()`, and `renderLayoutFrame()` at 80×24. Assert both choices and navigation hints are visible after the fix. Resolve private layout functions according to the README's test-seam policy.

**Committed regression:** extend `trash-history/index.test.ts` to capture bounded confirmation text/options for many projects, `--details`, archive mode, and long paths. Verify cancellation-first selection and explicit approval. Never invoke real `/usr/bin/trash`; use injected dependencies.

## Recommended fix

1. Keep the full report in the existing preview.
2. Replace the confirmation body with a bounded summary: eligible count/bytes, named-session policy, archive yes/no, and reference to the preview.
3. Keep paths/details out of the selector title; bound wrapped lines, not only character count.
4. Use a standard `ctx.ui.select` with Cancel/No first and a clearly labelled affirmative option. Enter on the initial selection must cancel; map only the explicit affirmative option to approval. Do not retain default-Yes `confirm`.
5. Apply bounded-title review to long permissions/subagent selectors too, but keep independent behavior changes in [0002](0002-dialog-concurrency-and-cancellation.md).

## Acceptance criteria

- Confirmation action choices and help remain visible at 80×24 and narrow-width tests.
- Detailed reporting, dry-run, archive verification, active-session checks, no-UI refusal, and fail-closed behavior are unchanged.
- Cancel/Escape never performs archive/Trash work; approval requires a visible affirmative selection.
- Large reports do not turn the confirmation into a scrolling transcript.
- README describes the preview/confirmation split.

## Resolution

- The full `formatScanReport()` remains in the existing preview, including every eligible project, optional bounded details, and the planned archive path.
- `createTrashHistoryConfirmation()` produces a six-line scalar-only summary: scope, eligible count/bytes, named-session policy, archive yes/no, and a reference to the preview. No paths or detailed report rows enter the selector.
- Approval now uses public `ctx.ui.select()` with **Cancel** first and **Move to Trash** or **Archive, then Trash** second. Only an exact match for the affirmative option approves the batch; cancellation and unexpected responses leave all sources untouched and do not create an archive.
- Scanning scope, preflights, archive verification, action-time revalidation, active-session exclusions, dry-run, and no-UI refusal are unchanged. Independent permission/subagent selector behavior and custom-session-directory scope remain outside this package.
- The extension README now explains the preview/confirmation split and cancellation-first interaction.

## Validation

Validated against the currently installed Pi **1.0.0** and Node **v22.19.0**, using only synthetic state, a fake terminal, injected executable dependencies, and the user-approved private session scratch root:

- Test-first owning regression: **20 passed / 10 failed** before implementation, including rejection of the old default-Yes `confirm()` call. No real Trash executable was invoked.
- `node --test trash-history/index.test.ts pi-compatibility/trash-confirmation.test.ts`: **33 passed**, none failed or skipped. Covers large reports, `--details`, archive mode, long project/archive paths, named policy, initial cancellation, Escape/undefined and unexpected responses, and existing approval/action safety checks.
- Committed host compatibility checks use public `ExtensionSelectorComponent`, `TuiAltScreen`, and stack/scroll APIs with a manual Pi 1.0 fixed-dock contract and three-line footer. A legacy full-report control reproduces clipped choices through this same fixture. Actual wrapped selector lines are budgeted, and both action choices plus navigation/select/cancel help are visible at **80×24, 40×24, and 30×24**.
- Supplementary version-checked scratch probe resolves the installed host root and explicitly imports its private `createChatViewport()` by file URL. A synthetic 32-session, ten-project detailed report with long paths reproduced **102 selector lines**, clipped Yes/No, and initial Enter selecting Yes. The replacement rendered **15 lines at width 80** and **16 at widths 40/30**, with both choices/help visible and initial Enter selecting Cancel, with and without archive mode. No files were moved.
- `npm run verify`: host dependency-link checks and TypeScript passed; **257 tests passed**, none failed or skipped. `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR` pointed to the approved session scratch root. No dependency links, personal settings, or real session data were changed.

### Reviewer validation

The requested read-only `reviewer` subagent found no runtime correctness or safety issues and returned **Approve with minor changes**. Parent verification and remediation:

- **Confirmed and fixed:** the host Escape test originally expected `undefined` both before input and after cancellation, so it could pass when Escape did nothing. An in-memory scratch preload made only Escape a no-op: the old test still passed. The revised test tracks selection callbacks separately and requires exactly one cancellation callback for Escape. The same mutation now fails at the cancellation assertion; the unmodified host passes.
- **Adopted test-strengthening suggestions:** added the committed legacy-clipping control, identified the manual host-layout contract in maintainer documentation, and used a three-line footer matching the stock host's maximum.
- **Verified, not reproduced:** the speculative concern about local extension status text wrapping into many footer lines does not apply to the stock Pi 1.0 `FooterComponent`: it sanitizes and truncates all extension statuses into one third line. No footer/runtime changes were made.
- Re-ran the supplementary host probe and retained its output as `trash-layout-probe.log` in approved session scratch. Final focused tests and the full verification gate passed with the counts above.

No unrelated selector behavior, session-directory scope, settings, dependencies, or real user state was changed.

Related: [0014: custom session-directory scope](0014-trash-history-custom-session-directory.md). Do not combine the scope fix unless deliberately implementing both.
