# 0006: Preserve failed subagent details and billable usage

- **Status:** Resolved — completed-child single/chain scope; remaining orchestration debt tracked separately
- **Follow-up:** [TDR-0005: orchestration cancellation and exception accounting](../tdr/0005-subagent-orchestration-failure-accounting.md) — Open; user-approved durable scope split
- **Priority:** Medium
- **Evidence:** Current failure/result loss and renderer crash reproduced with mocked children through public host `runToolCall`; cancellation and legacy-rendering regressions verified
- **Area:** `agent/extensions/subagent` — accounting and rendering in one change set
- **Instructions:** [Package workflow and validation](README.md)

## Problem and evidence

Single and chain failures throw after collecting child results (`index.ts:3220, :3375`). Pi's `pi-agent-core/dist/agent-loop.js` turns a thrown error into text with `details: {}`, without child usage. This loses failed children's token/cost accounting and their structured diagnostics.

`index.ts:3442` assumes any truthy details object has `results.length`. Passing the host's error fallback reproduces `TypeError: Cannot read properties of undefined (reading 'length')`. The host falls back to default rendering; the custom failure tree is lost.

Parallel handling, parent escalation, and successful accounting already have useful behavior to preserve.

## Reproduce / test first

Use fake child-process results with nonzero exit, `stopReason: error`, `aborted`, and stderr-only failure. No paid child model calls are needed.

Assert single/chain error results retain collected results and aggregate usage. Include earlier successful chain steps before a failure. Call the renderer with missing details, `{}`, malformed results, empty results, and valid details. Reuse `resultState.test.ts`, `usageAccounting.test.ts`, `ux.test.ts`, and process lifecycle helpers; add a narrow execute-path seam if required.

## Recommended fix

1. For completed child failures, return `{ content, details, usage, isError: true }` rather than throwing away accumulated data.
2. Keep concise/truncated error text and full-output file guidance. Preserve chain step identity and all results already incurred.
3. Count each child's own usage exactly once; do not duplicate usage that Pi aggregates from nested tool results.
4. Validate the renderer's details shape before reading `results`; use a safe text fallback for host errors and malformed/absent data.
5. Keep early parameter-validation errors separate if no child ran and there is no usage to retain.

## Acceptance criteria

- Failed/aborted single and chain runs retain billable usage and structured diagnostics.
- Earlier chain usage is preserved on later failure; no successful usage double-counting.
- Single/chain failures remain error results, not apparent successes.
- Host fallback details never crash rendering.
- Parallel results, parent-escalation outcomes, cancellation/process cleanup, and output truncation retain existing semantics.
- README explains any user-visible failure/reporting changes.

## Validation

`npm run test:subagent`; focused new execute/renderer tests; `npm run verify` with approved scratch.

## Confirmation and resolution

Rechecked from clean repository HEAD `f70413277a286aa9913db3a10ad450048a0b0a67`, installed **Pi 1.0.0**, Node **v22.19.0**. The original problem/evidence above is retained as the audit snapshot; those line numbers have moved.

A delegated **read-only scout classified the finding Confirmed**, inspecting current execution, usage/rendering code, installed Pi docs/declarations, and related 0004/0005/0015. It could not execute commands and ran **no tests or fresh reproduction**. The parent then reproduced the defects through the public host API before executable changes; no repeat confirmation delegation was necessary.

### Verified contracts and test-first evidence

- Installed `pi-agent-core/dist/types.d.ts`, `AgentToolResult.isError`, and `dist/agent-loop.js`, `runToolCall`/`finalizeExecutedToolCall`, retain a returned error's details and usage. A throw uses `createErrorToolResult()` with `details: {}` and no usage. Current host session totals include tool-result usage regardless of its error flag.
- `docs/extensions.md` documents returning `isError: true` to retain error data, output truncation and model-only exposure. `docs/message-types.md` documents canonical usage; nested tool usage is host-aggregated. Child JSON already contains that aggregated nested usage, so the parent sums each child's reported usage once and does not re-sum its nested details.
- Current single and chain branches still threw on collected failed results; the renderer dereferenced `details.results.length` on the host's `{}` fallback. The new regression calls the registered extension execute path via public `runToolCall`, mocking only OS child spawning. It reproduces the actual host fallback without model requests or private host imports.
- Meaningful initial red run: **30 tests — 12 passed, 18 failed**. Fixture prerequisites were corrected before this run. Additional test-first stages each passed **32** and failed **1**, exposing loss between chain steps and misleading abort rendering. Each defect was fixed only after its failing regression.

### Changes

- Completed single/chain child failures return concise, truncated error content plus collected structured results, aggregate usage and **`isError: true`**. Earlier chain steps, task/step identity, diagnostics and unincurred-step stopping are preserved. Zero-usage failures do not fabricate billable usage.
- Live child cancellation retains reported usage after the unchanged bounded lifecycle settles. Between-step cancellation returns the earlier results without starting another child. A narrow `AbortError` catch also preserves those results if the next child's asynchronous prompt preparation is cancelled; unrelated exceptions are not converted.
- Between-step abort details carry a call-level error message because no failed child result exists. Both collapsed and expanded chain views show that error rather than a success icon. Terminal failed/aborted top-level chain trees do not pad never-run steps as waiting; partial running trees and parent-input outcomes keep their existing waiting rows.
- Renderer validation rejects malformed result entries and uses the original text fallback for missing, empty or invalid details. Display-only normalization preserves historical numeric-cost usage and absent optional fields without mutating saved results or execution accounting.
- Parallel normal-completion summaries/accounting, parent-escalation precedence/outcomes, policy/trust/exposure/allowlists, prompt contributions, child arguments/environment, process termination and output truncation are unchanged. No dependencies or host links were changed.
- Added `subagent/failureResults.test.ts` to `npm run test:subagent`. Updated the owning README with failure-reporting, accounting limits and scratch-based validation guidance.

### Independent review and reconciliation

A **fresh read-only reviewer** inspected the implementation, tests, host contracts and parent logs. It independently ran **no commands/tests**. It found no core error-contract or accounting blocker, but requested small changes before closure:

1. Real renderer args padded never-run chain steps as waiting. Parent regressions supplied actual `args.items`, reproduced this, and verified terminal omission with a partial-running control.
2. Cancellation during a later child's prompt-file write could still discard earlier usage. Parent reproduced it by aborting during the second real scratch prompt write, added the narrow catch and verified retained results, no second spawn and both prompt files' cleanup.
3. The README overstated parallel cancellation accounting. Source inspection and a passing characterization confirm that its existing scheduler still throws an abort-only error. That behavior was preserved and the README narrowed; no parallel cancellation redesign was added.
4. The first validator rejected legacy numeric-cost usage. Repository history confirmed the old shape; a failing persisted-data regression now passes after render-only normalization.

Review-remediation red run: **41 tests — 34 passed, 7 failed**. The parent verified and remediated all four in-scope warnings, added malformed-cost/escalation/content controls, asserted that the ESM spawn binding is mocked before execution, and reran validation. The reviewer did **not** re-review or approve the final remediated state; closure is based on the parent's verified corrections and final executed regressions. Intermediate TypeScript fixture/narrowing errors were corrected before the final gate. Final parent inspection also strengthened the waiting-row assertion for a chain escalation with a nonzero child exit. Source and the saved pre-correction rendered output showed that terminal-failure padding suppression also removed parent-input waiting rows. Parent-input outcomes were excluded from that suppression. The initial assertion assumed expanded step labels and was corrected to match actual compact rows; its preliminary failure count is not treated as a standalone successful reproduction. The corrected compatibility assertion passes in the final runs.

Optional reviewer observations about nested terminal footer/queued-count presentation and planned-versus-run header wording were not expanded into shared scheduler/footer/UX changes. They are pre-existing presentation limitations, not unresolved error-result or usage-accounting defects in the completed-child paths fixed here.

### Final executed validation

All commands ran from `agent/extensions/`, with both `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR` pointing at the caller-created private canonical scratch root containing `.step1-test-root-ready`:

`/private/var/folders/br/m0tzwhrx6t77qjyr7846jwyc0000gn/T/pi/session-01a101cc-4be4-72e1-8586-f6c425d600ff`

- Focused `node --test subagent/failureResults.test.ts`: **41 passed** (also included in the final suites).
- Related `node --test pi-compatibility/structured-prompt.test.ts pi-compatibility/tool-activation.test.ts pi-compatibility/sdk-resume.test.ts`: **134 passed**.
- `npm run test:subagent`: **149 passed**.
- `npm run verify`: **all five host links valid, TypeScript passed, 517 tests passed**.
- Final runs: **0 failed, 0 cancelled, 0 skipped**. Existing lifecycle/process-tree tests remain part of the subagent and full gates.

Ephemeral logs in that scratch root: `0006-red.log`, `0006-chain-abort-red.log`, `0006-chain-render-red.log`, `0006-review-red.log`, `0006-review-green.log`, `0006-escalation-render-red.log`, `0006-focused-final.log`, `0006-related-final.log`, `0006-subagent-final.log`, `0006-verify-final.log`. They are evidence, not prerequisites.

### Acceptance, related findings and limits

The completed-child single/chain failure criteria, earlier-step and exactly-once usage, returned error status, host/malformed-details fallback, preserved parallel/escalation/lifecycle/truncation behavior and README update are verified by focused regressions plus the full gate. The user approved closing this scope and retaining residual orchestration-accounting debt in standalone [TDR-0005](../tdr/0005-subagent-orchestration-failure-accounting.md). That record does not depend on temporary findings or scratch logs; it distinguishes confirmed parallel cancellation from source-only exception/UI observations.

- **0004 remains Resolved:** public-loader structured-prompt tests passed again; no prompt composition code changed.
- **0005 remains Resolved for local scope:** startup/restoration/allowlist tests passed again; no availability code changed. SDK/CLI resume tests remain characterizations of the separate open **TDR-0004** host defect, not proof of working resume restoration.
- **0015 remains Open / verify-first:** child invocation/MCP startup construction is unchanged by source inspection. Its mock-server lifecycle acceptance criteria were not executed; no MCP opt-out or unrelated fix was implemented.

Validation used synthetic child JSON and fake processes (no real child PID/process-group signals) at the public host tool boundary, plus real scratch files for prompt preparation/truncation and fake-theme component rendering. No live TUI/provider billing/cache measurement, paid child call or real enabled MCP server was exercised. These checks are not claimed. Unreported usage cannot be recovered; parallel cancellation and unexpected thrown infrastructure/update-callback errors keep their existing host error behavior, rather than gaining a general recovery mechanism. Existing nested waiting/footer-count presentation was not redesigned. Implementation and validation did not change personal configuration, credentials, real sessions, installed host code or dependency links. The original investigation made no commit or push; the user subsequently authorized committing the completed fix and durable follow-up record.
