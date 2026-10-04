# Subagent maintenance

Maintainer notes for [`subagent`](./README.md). User-facing commands, settings and troubleshooting stay in the README.

## Source map

- `index.ts` — tools, `/subagents`, policy, `execute()` orchestration for `single` / `parallel` / `chain`, result rendering.
- `scheduler.ts` — bounded parallel worker pool (`mapWithConcurrencyLimit()`).
- `usageAccounting.ts` — child usage accumulation/aggregation (`aggregateBillableUsage()` in `index.ts` wraps it). Child JSON already includes nested-tool usage; do not re-sum nested `details.results`.
- `childProcessLifecycle.ts`, `processTreeTermination.ts` — bounded process/cleanup handling.
- Tests: `failureResults.test.ts`, `scheduler.test.ts`, `usageAccounting.test.ts`, `ux.test.ts`, `resultState.test.ts`, `policy.test.ts`, `projectTrust.test.ts`, lifecycle tests, and `../pi-compatibility/{tool-activation,structured-prompt}.test.ts`.

## Startup tool availability

`subagent` and child `escalate_to_parent` are registered through `registerToolAvailability()` (`../shared/toolAvailability.ts`). `session_start` and `syncSubagentSessionState()` call the availability setters, so saved off mode, a delegation depth cap, and top-level (no relay) escalation withdrawal use hidden re-registration rather than subtractive `setActiveTools()`. See [Tool availability at startup](../maintenance.md#tool-availability-at-startup). Only an explicit `/subagents off` (`setPolicyMode()`) removes `subagent` from the active set. Host SDK/CLI resume omission of selected tool declarations is separate and open: [TDR-0004](../../../tdr/0004-sdk-cli-resume-tool-restoration-host-defect.md).

## Child MCP startup limitation

A child's `--tools` allowlist constrains callable tools, including late MCP registrations; it does **not** suppress enabled MCP-server initialization. When built-in MCP is loaded, Pi starts enabled servers on `session_start` independently of that allowlist. User/trusted-project configuration and extension registrations determine which servers apply. This is a startup/resource concern, not evidence of an allowlist bypass.

Startup cost, first-prompt latency and MCP cleanup behavior in delegated children remain unmeasured. Concurrency may amplify resource use, but no measured impact or process leak is established. **Revisit before routine delegated MCP use:** measure startup, latency and shutdown/abort cleanup in isolation with disposable mock servers, without real credentials or personal configuration. Runtime remediation remains **Deferred** pending that evidence and a separately selected safe child-local control. Existing tool-selection and child-lifecycle tests are not MCP startup/cleanup measurements.

## Structured prompt section

`before_agent_start` writes or deletes `systemPromptOptions.sections.subagent_policy` (via `buildSubagentPolicyPrompt()`), once per submitted prompt, only while `subagent` or `escalate_to_parent` is active. It does not return `systemPrompt`. Follow [Structured prompt contributions](../maintenance.md#structured-prompt-contributions). Policy, approval, trust, depth and allowlist enforcement do not depend on this text.

## Failure results and usage accounting

Pi contract: throwing from `execute()` becomes a text-only error with no `details` or `usage`; returning `isError: true` keeps data (see the installed Pi extensions guide, Tools). The local contract is:

- **Single:** a failed child returns `isError: true` with `details` and `aggregateBillableUsage()` usage. Parent-input requests stay escalation outcomes (`buildParentEscalationResult()`), not failures.
- **Chain:** a failed step returns an error result with all completed steps and usage. Abort before a step, or during next-child prompt preparation, returns `buildChainAbortResult()` (sets `details.errorMessage`) when earlier results exist; with no earlier result it still throws an abort error. Unrelated exceptions are rethrown.
- **Parallel:** normal completion reports per-child failures in a non-error summary with usage. Cancellation is the open exception: `mapWithConcurrencyLimit()` waits for active workers, then throws `AbortError`, so collected results/usage never reach the tool result. Placeholder `allResults` entries (`exitCode: -1`) are not real child results.
- **Rendering:** `renderResult()` validates saved details with `normalizeRenderableSubagentResult()`, normalizes older usage, and falls back to plain text for malformed entries. Persisted data and execution accounting are not changed by rendering.
- Unreported child tokens/cost cannot be recovered; accounting is best-effort.

Open debt (parallel abort-only loss, unexpected-exception paths, optional nested-UI observations, reproduction and acceptance criteria): [TDR-0005](../../../tdr/0005-subagent-orchestration-failure-accounting.md). `failureResults.test.ts` ("parallel cancellation keeps its existing abort-only contract") characterizes the loss; passing it does not mean the debt is resolved, and a fix should replace it with positive expectations.

## Validation

Prepare [approved test scratch](../permissions/README.md#safe-test-scratch-setup), set both `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR` to it, then from `agent/extensions/`:

```bash
npm run test:subagent
npm run verify
```

Tests use fake children and isolated settings; do not use real paid child runs, enabled MCP servers or personal configuration as fixtures.
