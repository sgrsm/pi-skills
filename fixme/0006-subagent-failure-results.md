# 0006: Preserve failed subagent details and billable usage

- **Status:** Open
- **Priority:** Medium
- **Evidence:** Error renderer failure reproduced; loss of usage/details source-verified
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
