# TDR-0005: Retain subagent results and usage on orchestration cancellation and exceptions

- **Status:** Open — parallel cancellation confirmed; exception paths source-supported / verify first
- **Priority:** Medium
- **Created:** 2026-10-03
- **Area:** `agent/extensions/subagent` — local orchestration/accounting, not a confirmed host defect
- **Origin:** Pi 1.0.0 subagent failure-result investigation; follow-up debt identified during independent review

## Summary and decision

Completed single/chain child failures now return error results with collected diagnostics and reported usage. Active child cancellation and cancellation between chain steps, including next-child prompt preparation, retain collected work. Renderer fallback and legacy saved-usage display are also covered by regressions. That completed-child correction is resolved.

Two orchestration paths remain outside that correction:

1. **Confirmed:** cancelling a parallel call throws after its active workers settle, discarding collected results and reported usage from the final parent tool result.
2. **Source-supported, verify first:** unexpected infrastructure or update-callback exceptions can escape single/chain/parallel orchestration after usage has been collected, reaching the host's text-only error fallback. Individual execute-path scenarios have not been reproduced.

The user approved recording this remaining debt separately rather than broadening the completed-child fix. No orchestration recovery redesign is implemented by this record. A future fix changes the existing parallel abort-only contract; obtain maintainer approval for a data-bearing error result and update the README while preserving cancellation's error status.

This record is self-contained: temporary work-package documents and expired scratch logs are not prerequisites. Durable reproduction is in [failureResults.test.ts](../agent/extensions/subagent/failureResults.test.ts); user-visible limits are in the [subagent README](../agent/extensions/subagent/README.md#output-and-cancellation).

## Evidence and confidence

### Confirmed parallel cancellation

- `agent/extensions/subagent/scheduler.ts`, `mapWithConcurrencyLimit()`, stores worker results and awaits all active workers. It then throws `createAbortError()` when the signal was aborted, before returning the collected array. Queued work is not started after abort.
- `agent/extensions/subagent/index.ts`, the `requestMode === "parallel"` execute branch, awaits that scheduler before building the summary, `details` and aggregate usage. The scheduler's throw bypasses all three.
- `agent/extensions/subagent/failureResults.test.ts`, **"parallel cancellation keeps its existing abort-only contract"**, executes the registered extension through public `runToolCall`. Mock children emit assistant messages with known usage, abort the call and close. The outcome is `isError: true`, text containing an abort diagnostic, `details: {}`, and no `usage`.

That test is a **passing characterization of the open debt**, not an assertion that accounting works on parallel cancellation. The test's helper mocks `spawn`, asserts that the ESM spawn binding is mocked, uses no real child PID or process-group signal, isolates configuration and releases lifecycle listeners.

### Source-supported unexpected exceptions

- `index.ts`, `runSingleAgent()` / `emitUpdate()`, maintains a `currentResult` with messages, diagnostics and usage mutated by a local `ChildUsageAccumulator`. An update callback may throw after a JSON message has added usage.
- `childProcessLifecycle.ts`, `failProcessing()` / `rejectTerminal()`, preserves the processing exception and rejects only after close or bounded cleanup/termination confirmation. Lifecycle tests reproduce processing failures and cleanup, **not preservation of execute-path usage**.
- The chain execute catch handles only an aborted signal plus an `AbortError` when earlier results exist; unrelated exceptions are rethrown. The single branch and parallel scheduler also allow unexpected exceptions to reach the host.
- Other possible post-collection throws, such as a truncation-file write failure, require focused reproduction before claiming a specific defect. Do not equate a source-traced possibility with an executed accounting-loss test.

### Current Pi contract

Here, **HOST** means the installed `@earendil-works/pi-coding-agent` root, resolved through its peer link or public ESM module resolution; **CORE** is the resolved `@earendil-works/pi-agent-core` package. The tested versions were **1.0.0**, Node **v22.19.0**. Search by symbol if locations move.

- `HOST/docs/extensions.md` and `CORE/dist/types.d.ts`, `AgentToolResult.isError`, support returning `{ content, details, usage, isError: true }` to retain error data.
- `CORE/dist/agent-loop.js`, `createErrorToolResult()`, converts a thrown error to text with `details: {}` and no usage. Public `runToolCall` exercises that same failure contract without provider requests.
- `CORE/dist/agent-loop.js`, `createToolResultMessage()`, copies returned details, usage and error status to the transcript's tool-result message. `HOST/dist/core/agent-session.js` session statistics include tool-result usage even when the result is an error. Its nested-tool execution aggregates nested result usage, so callers report only their own usage. Child JSON already contains nested usage; parent orchestration must not re-sum nested `details.results`.

Transcript propagation and session-statistics aggregation were source-inspected; the executed `runToolCall` reproduction stops before those boundaries. This is a local loss before a result is returned, not evidence that the host rejects returned error usage. Do not patch the installed host or depend on private host internals in production.

## Safe reproduction and validation

Prepare an explicitly approved private scratch root according to the durable [safe test scratch setup](../agent/extensions/permissions/README.md#safe-test-scratch-setup). It must be real, non-symlink, current-user-owned, non-group/world-writable, outside and non-overlapping with HOME/repository/cwd, and contain the caller-created `.step1-test-root-ready` sentinel. Use the existing pinned fixture helper. From the repository root, set both variables and run:

```bash
export PI_PERMISSIONS_TEST_SCRATCH_ROOT="<approved canonical scratch root>"
export TMPDIR="$PI_PERMISSIONS_TEST_SCRATCH_ROOT"
cd agent/extensions
node --test --test-name-pattern='parallel cancellation keeps its existing abort-only contract' subagent/failureResults.test.ts
node --test subagent/failureResults.test.ts
npm run test:subagent
npm run verify
```

The targeted command may filter unrelated tests; use the complete focused/full commands for an unfiltered gate. A passing parallel characterization reproduces the debt on the current runtime. After a fix, replace that characterization with positive retained-result/usage expectations rather than preserving loss as intended behavior.

For a stronger future regression, reuse the fake-child fixture with a low `subagents.maxConcurrency` in its isolated `settings.json` and at least three tasks: let one child complete with known usage, abort while another has reported usage but is still active, and assert that the remaining queued task never starts. Verify retained completed/partial diagnostics separately from cleanup completion.

For exception-path confirmation, inject a sentinel `onUpdate` failure after a usage-bearing message and exercise both a single call and a chain with an earlier completed step through `runToolCall`. Use lifecycle fakes that close on termination; separately inject a scratch-only I/O failure after earlier chain work. Bound timeouts, preserve the original error diagnostic, and classify each scenario from its actual result. No general execute-path exception reproduction has been run yet.

Never run paid child model calls, real enabled MCP servers, dependency installs, real user sessions, or personal credentials/configuration as fixtures. Read the current relevant host docs/declarations and [maintenance guide](../agent/extensions/maintenance.md) before future executable changes.

## Future remediation and acceptance criteria

Add focused positive failing regressions before executable changes. The parallel branch's prefilled `allResults` entries (`exitCode: -1`, `agentSource: "unknown"`) are placeholders, not evidence that a child started or incurred usage; do not recover them as real child results. Keep recovery state scoped to one invocation; do not introduce a global failed-usage store, retry paid work, or mark incomplete children as successful. Close this accounting debt only when:

- Parallel cancellation retains collected completed and already-reported active-child results/usage and remains an error result. It does not fabricate results or usage for unstarted work.
- Confirmed unexpected-exception scenarios preserve usage/results already collected while retaining the original exception diagnostic and error status. Source-only scenarios are reproduced, invalidated with evidence, or explicitly left open rather than silently claimed fixed.
- Each child's direct, nested-tool and compaction usage is counted exactly once; successful paths remain unchanged. Unreported tokens/cost are not estimated or invented.
- Cancellation stops claiming queued tasks, awaits bounded active-child cleanup, preserves owned-process-group rules and cleanup-unconfirmed diagnostics, and releases listeners/resources exactly once. Recovery cannot swallow processing or safety failures.
- Early parameter/trust/approval failures and pre-child aborts remain distinct; no child work or billable usage is fabricated. Parent escalation, normal parallel partial-failure summaries, output truncation/full-output guidance and legacy rendering compatibility are retained.
- Policy, tool exposure/allowlists, project-trust containment, Priority 0 denials and personal configuration remain unchanged. Do not disable safety extensions, widen approval or patch the installed host to make recovery easier.
- Update the subagent README, run focused lifecycle/accounting and full verification gates, obtain an independent review, and record actual results and skipped checks.

The inherent inability to recover usage never reported by a child is not itself a fixable accounting defect. Live provider billing reconciliation is not a prerequisite for deterministic reported-usage regressions.

## Optional UI observations — outside accounting acceptance

A prior source-only review noted nested terminal chains/footer snapshots that may still advertise unrun work as waiting/queued, and suggested clearer planned-versus-run header wording. Relevant symbols are `ux.ts`'s `buildSubagentChildActivityNodes()` and `footerActivity.ts`'s `getNestedActivityFromMessages()` / `getNestedSubagentFooterActivity()`. Direct terminal failure rendering was corrected, but these nested presentations were not independently runtime-reproduced or redesigned. If pursued, first reproduce with synthetic nested final results and actual call arguments; do not promote these observations to confirmed blockers or mix a shared footer/scheduler redesign into this accounting fix.

## Validation history and limits

At creation, parent-executed validation of the completed-child fix passed **41 focused**, **149 subagent**, **134 related-contract**, and **517 full-gate tests**, with TypeScript and all five host links valid; no final tests failed, were cancelled or skipped. The focused suite includes the confirmed parallel-cancellation characterization. Its passing status records the open debt, not its resolution.

A read-only scout and a fresh independent reviewer inspected source/contracts; neither executed tests. The parent reproduced and corrected the completed-child failure, cancellation-window and renderer findings and reran the final gates. The reviewer did not re-review the final remediated runtime or this new record. Exception-accounting scenarios and optional nested UI observations remain source-only. No live provider billing/cache check, real terminal smoke test or enabled MCP connection was run.

Record-creation validation reran the complete focused suite (**41 passed**) and `npm run verify` (**517 passed**, TypeScript and all five host links valid), with no failures/cancellations/skips. A fresh read-only durability reviewer approved this standalone record for commit, verified that the two earlier resolved finding documents had no diff, and checked durable links/symbols and confidence boundaries. It independently executed no tests; optional wording clarifications were verified and applied by the parent. Passing the current characterization still does not resolve this TDR.
