# Subagent maintenance

Maintainer notes for [`subagent`](./README.md). User-facing commands, settings and troubleshooting stay in the README.

## Source map

- `index.ts` — tools, `/subagents`, policy, `execute()` orchestration for `single` / `parallel` / `chain`, result rendering.
- `agents.ts` — per-file YAML/frontmatter validation, tool-list normalization, discovery diagnostics, source precedence.
- `scheduler.ts` — bounded parallel worker pool (`mapWithConcurrencyLimit()`).
- `usageAccounting.ts` — child usage accumulation/aggregation (`aggregateBillableUsage()` in `index.ts` wraps it). Child JSON already includes nested-tool usage; do not re-sum nested `details.results`.
- `childProcessLifecycle.ts`, `processTreeTermination.ts` — bounded process/cleanup handling.
- Tests: `agents.test.ts`, `../pi-compatibility/cli-tool-selection.test.ts`, `failureResults.test.ts`, `scheduler.test.ts`, `usageAccounting.test.ts`, `ux.test.ts`, `resultState.test.ts`, `policy.test.ts`, `projectTrust.test.ts`, lifecycle tests, and `../pi-compatibility/{tool-activation,structured-prompt}.test.ts`.

## Agent discovery contract

`parseFrontmatter()` values are treated as `unknown`. Discovery validates a mapping with non-empty string `name` and `description`, preserving valid string identities and prompts. `parseToolList()` distinguishes invalid values from absent/empty allowlists: CSV and arrays of strings are accepted, whitespace/empty entries are removed, and omitted/null/empty values yield no allowlist. Unsupported non-null types, any non-string array member, and any trimmed entry beginning with `+` or `-` reject the whole definition. Frontmatter is a plain-name allowlist: `buildSubagentChildProcessArgs()` appends plain `escalate_to_parent`, and Pi 1.1.0 rejects a `--tools` list mixing plain names with modifiers, so accepting modifiers would yield an invalid child command (and silently turning them into modifier mode would inherit extra default tools). The diagnostic names the file and offending entry. YAML exceptions are caught per file; they do not interrupt valid neighboring discovery. Model/thinking frontmatter remains ignored.

`AgentDiscoveryResult.diagnostics` contains path-qualified rejection messages. The per-request resolver deduplicates them across cached cwd discoveries. Policy blocks and approval prompts include diagnostics in their reasons; execution reports warnings through `ctx.ui.notify()` or stderr without UI, leaving stdout protocols untouched. Discovery itself has no notification side effects. A rejected project file never enters the name map, so a valid same-name user agent remains the fallback in `both` scope.

`agents.test.ts` exercises real YAML parsing and isolated user/project directories. `failureResults.test.ts` covers policy rejection diagnostics and execution warning delivery with fake children. Keep diagnostics independent of model/thinking selection and project-trust gates.

## Startup tool availability

`subagent` and child `escalate_to_parent` are registered through `registerToolAvailability()` (`../shared/toolAvailability.ts`). `session_start` and `syncSubagentSessionState()` call the availability setters, so saved off mode, a delegation depth cap, and top-level (no relay) escalation withdrawal use hidden re-registration rather than subtractive `setActiveTools()`. See [Tool availability at startup](../maintenance.md#tool-availability-at-startup). Only an explicit `/subagents off` (`setPolicyMode()`) removes `subagent` from the active set. Core SDK/CLI transcript restoration is fixed in Pi 1.3.0; selection/lifecycle controls and their limits are in [resume coverage](../pi-compatibility/host-contract-coverage.md#sdk-resumetestts).

## Child MCP startup limitation

A child's `--tools` allowlist constrains callable tools, including late MCP registrations; it does **not** suppress enabled MCP-server initialization. When built-in MCP is loaded, Pi starts enabled servers on `session_start` independently of that allowlist. User/trusted-project configuration and extension registrations determine which servers apply. This is a startup/resource concern, not evidence of an allowlist bypass.

Startup cost, first-prompt latency and MCP cleanup behavior in delegated children remain unmeasured. Concurrency may amplify resource use, but no measured impact or process leak is established. Existing tool-selection and child-lifecycle tests are not MCP startup/cleanup measurements.

**Measurement before routine delegated MCP use remains needed.** Use an isolated, disposable counting mock in approved scratch, with no real credentials, personal configuration or external service, and bounded timeouts. Record:

- host version, MCP exposure mode and delegated concurrency;
- mock server starts or connections;
- first-prompt delay;
- bounded abort/shutdown observations and which cleanup paths were exercised.

Verify separately that the child's callable registry honors its allowlist; allowlist enforcement and startup are independent properties. Measure codemode, deferred and direct exposure separately, since startup timing and first-prompt waits differ. An in-process fake transport can count connection attempts but cannot establish child stdio-process cleanup; cleanup and control verification require the actual child launcher.

**Conditional remedy.** Only material measured impact warrants selecting a separate, supported child-local control. Any control must:

- keep approved MCP loadouts working for children that need them;
- preserve project-trust behavior and owned-process cleanup;
- not use `--tools`/`--no-tools` as a startup opt-out, or disable all extensions and thereby the safety extensions;
- not alter shared MCP configuration, use real credentials, rely on private or invented flags, or patch the installed host.

If impact is material and no safe control exists, record the measured evidence and a revisit trigger as debt rather than inventing a workaround. No TDR is warranted until measurement supports one. Runtime remediation remains **Deferred**.

## Structured prompt section

`before_agent_start` writes or deletes `systemPromptOptions.sections.subagent_policy` (via `buildSubagentPolicyPrompt()`), once per run start (a user prompt or a custom message with `triggerTurn`), only while `subagent` or `escalate_to_parent` is active. Tool metadata and the policy share direct-call-only guidance. The policy includes delegation invocation guidance only when `subagent` is active and neither off nor depth-capped; escalation guidance requires an active child relay tool. It does not return `systemPrompt`. Follow [Structured prompt contributions](../maintenance.md#structured-prompt-contributions). Policy, approval, trust, depth and allowlist enforcement do not depend on this text.

## Dialog content and program status

Pi 1.1.0 reports complete standard TUI dialog titles through OSC 7501, subject to control-character sanitization and a UTF-8 size cap. Neither operation redacts request content. Keep TUI titles content-free; details belong in a separate visible surface.

- Policy approval in `index.ts` builds the existing detailed prompt once, emits it with `ctx.ui.notify(details, "warning")` in TUI mode, then opens the static-titled selector. Preserve approval choices, session-scope consequences, and project-agent source/trust warnings.
- Live parent clarification is owned by `ux.ts`; orchestration must pass `ctx.mode`. Each actionable TUI occurrence emits one detailed preview before its selector or direct editor. Selecting custom instructions reuses that preview and opens a static-titled editor. Preserve option descriptions, editor prefill, answer mapping, cancellation, and existing preview limits.
- Warning notifications remain in the TUI transcript; ordinary info notifications can coalesce and overwrite each other. Do not replace the preview with an info notification or a line-limited widget.
- Non-TUI/RPC dialogs retain their existing detailed titles and emit no preview notification. RPC is an intentional request/response UI channel, not the interactive terminal status path; clients may ignore fire-and-forget notifications.
- Separate project-agent confirmation already uses a static title and a message body. No-UI blocking and non-actionable/approval-type escalation handling are unchanged.

`ux.test.ts` covers preview placement, static titles, decoded status messages, unchanged RPC content, and clarification answers/cancellation. `failureResults.test.ts` exercises the registered policy hook and live orchestration with fake children and isolated settings, including project-source warnings, approval-state persistence, decoded status messages, and narrow selector rendering. These checks do not exercise a real terminal's protocol negotiation or establish a global privacy guarantee. Subagent dialogs remain outside the shared dialog queue; this content separation does not resolve cross-extension dialog collisions.

## Failure results and usage accounting

Pi contract: throwing from `execute()` becomes a text-only error with no `details` or `usage`; returning `isError: true` keeps data (see the installed Pi extensions guide, Tools). The local contract is:

- **Single:** a failed child returns `isError: true` with `details` and `aggregateBillableUsage()` usage. Parent-input requests stay escalation outcomes (`buildParentEscalationResult()`), not failures.
- **Chain:** a failed step returns an error result with all completed steps and usage. Abort before a step, or during next-child prompt preparation, returns `buildChainAbortResult()` (sets `details.errorMessage`) when earlier results exist; with no earlier result it still throws an abort error. Unrelated exceptions are rethrown.
- **Parallel:** normal completion reports per-child failures in a non-error summary with usage. On cancellation, the unchanged scheduler waits for active workers and throws `AbortError`; the execute branch catches only that error with an aborted signal, then returns real settled results, aggregate reported usage, `details.errorMessage`, and `isError: true`. Aborted active children normally return their diagnostics and reported usage after cleanup. The separate `settledResults` array preserves task order; streaming placeholders and unstarted work are excluded. With no returned result, abort still throws. Cancellation does not reopen retained parent-input requests. Renderers show the call-level error even when retained children all completed or contain escalation metadata.
- **Rendering:** `renderResult()` validates saved details with `normalizeRenderableSubagentResult()`, normalizes older usage, and falls back to plain text for malformed entries. Persisted data and execution accounting are not changed by rendering.
- **Unexpected exceptions (accepted):** infrastructure or update-callback exceptions that escape orchestration reach the host's text-only fallback; already-collected results and usage are not guaranteed to survive. Focused tests reproduce synchronous parallel `onUpdate` failures after a usage-bearing message, including an `AbortError` without an aborted signal. Other execute-path exceptions remain unverified; lifecycle processing-failure tests do not establish general usage preservation. If a worker exception coincides with cancellation, the unchanged scheduler's abort-first precedence can also hide the original exception diagnostic.
- Unreported child tokens/cost cannot be recovered; accounting is best-effort.

**Recovery scope decision:** retain results and reported usage on parallel cancellation, but accept broader exception-recovery limitations rather than add a general recovery redesign. Only terminal results returned by `runSingleAgent()` are recovered; a child that fails processing before returning such a result is outside this guarantee. Do not estimate unreported usage or automatically retry paid work. `failureResults.test.ts` has positive retained-result/usage regressions for cancellation and characterization of the accepted update-callback fallback. Scheduler, child lifecycle, usage aggregation, policy and trust behavior are unchanged.

Nested activity metadata can still advertise waiting/queued work after interruption, including retained escalation requests. This presentation limitation is separate from the final error/result/accounting contract; no footer/activity-tree redesign is included. Any broader recovery or presentation change requires separate approval and updated tests/documentation.

## Validation

Prepare [approved test scratch](../permissions/maintenance.md#safe-test-scratch-setup), set both `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR` to it, then from `agent/extensions/`:

```bash
npm run test:subagent
npm run verify
```

Tests use fake children and isolated settings; do not use real paid child runs, enabled MCP servers or personal configuration as fixtures.
