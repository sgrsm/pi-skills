# Extension maintenance

## Pi host dependency links

`agent/extensions` treats Pi host packages as peer dependencies and links them from the installed Pi host's package tree, whether npm/global or managed/versioned.

Host upgrades normally need no local `npm install`, but that does not eliminate link refreshes. In-place npm/global upgrades can keep paths stable; managed host upgrades select a new `install/releases/<version>` tree. Refresh links before validation so checks do not use an old host or a tree later removed by release pruning.

Refresh the host-package symlinks after managed host upgrades, Node/nvm or npm global-prefix changes, or moving/reinstalling the Pi host.

For managed installs, first set `PI_HOST_PACKAGE_ROOT` to the active release using the [managed-install recipe](./pi-host-deps/README.md#managed-install-recipe). Keep the same override for synchronization and validation, including `npm run verify`. See the [utility guide](./pi-host-deps/README.md) for command details and troubleshooting.

From the Pi config root:

```bash
cd agent/extensions
npm run sync:pi-host-deps
npm run typecheck
```

Alternatively, from anywhere, use the standard Pi config path:

```bash
cd ~/.pi/agent/extensions
npm run sync:pi-host-deps
npm run typecheck
```

## Shared interactive dialogs

Permission approvals (including `/permissions`) and clarify exchanges use `shared/dialogQueue.ts` and `shared/dialogUi.ts`. Pi 1.0 tracks UI prompts but does not serialize them: a raw dialog can replace a displayed interaction without settling its promise.

When adding another consumer:

- Obtain the queue with `getSessionDialogQueue(pi)`. Do not substitute an independent lock or module/process-global queue: separately loaded extensions must coordinate, while independent SDK sessions must stay separate. The helper shares the queue through Pi's public session event bus and owns its lifecycle hooks.
- Capture `dialogs.scopeSignal(ctx.signal, executionSignal)` before any asynchronous preflight (omit the execution signal for event/command handlers). Pass it to preflight operations as well as the queued interaction so shutdown/reload cannot resume old work through a stale context.
- Keep the entire selector → custom-answer exchange and its state changes inside `dialogs.run(signal, ...)`. The queue releases its lock in `finally`; consumers must still check cancellation after awaits and before grants, notifications, or other side effects.
- Re-check enablement, scoped grants, and displayed state after acquiring the lock. Gather current state there and apply changes before releasing it; never broaden grant scope to eliminate duplicate prompts.
- Use cancellable UI helpers and supported dialog signals. Racing an abort against a promise alone does not dismiss the underlying interaction. Custom components must complete and dispose exactly once, including cancellation before host installation. Pi 1.0's plain editor and external-editor launch are not abort-aware; preserve the owning READMEs' documented TUI/RPC alternatives.
- Keep Priority 0 hard denials, no-UI blocking, and read-only/noninteractive work outside the dialog queue. Never offer approval for scopes hidden by truncated request details, and validate replies against the choices actually displayed.
- Cover queued/displayed cancellation, the complete custom-answer exchange, scoped-grant reuse, and fresh-instance reload. Cross-extension tests must exercise both registration orders and a new runtime on the same event bus; use fake dialogs and approved scratch fixtures, not personal state or real guarded mutations.

Future enrollment candidates are **subagent approval/escalation, handoff dialogs, and Trash confirmation**. They are not currently coordinated by this queue. Migrate all dialog entry points in a flow; partial enrollment can still replace an owned interaction. Until then, scheduling guarantees apply only to permissions and clarify, not to all extension dialogs.

See the [shared helper overview](./shared/README.md#dialog-helpers), the [permissions guide](./permissions/README.md#prompt-choices), the [clarify guide](./clarify/README.md#tool), and [cross-extension regression coverage](./pi-compatibility/host-contract-coverage.md#dialog-concurrencytestts). Focused tests are in `shared/dialogQueue.test.ts`, `shared/dialogUi.test.ts`, the owning extension tests, and `pi-compatibility/dialog-concurrency.test.ts`.

### Conditional custom/MCP approval policy

The [permissions trust boundary](./permissions/README.md#scope-trust-boundary-and-limitations) covers supported `bash`/`write`/`edit` calls, not arbitrary custom/MCP operations. A generic approval layer requires a separate, explicitly authorized policy decision before implementation: settle settings/defaults, missing-hint behavior, trust boundaries, no-UI fail-closed handling, and coordination of the complete approval flow with the shared dialog queue.

Annotations may inform that policy but are unverified declarations, not proof of safety or authorization; they must not bypass Priority 0 or existing concrete path guards. This is a conditional design constraint, not an approved feature or a requirement to expand current enforcement.

## Structured prompt contributions

Pi composes the system prompt from named sections. `before_agent_start` exposes them as `event.systemPromptOptions.sections` (tag-name keys); Pi records section changes in the transcript as a delta. Returning `systemPrompt` or setting `forceSystemPrompt` instead makes the provider receive that complete replacement for the run, rather than the merged sections. The transcript still records the structured sections (see Pi's extension docs on events, and the session-format docs on system messages).

Local extensions contribute additively, each through one stable section key that it owns:

| Section | Owner | Content |
| --- | --- | --- |
| `clarify_policy` | `clarify/index.ts` | Clarification policy, or a plain-text-fallback note when there is no UI |
| `permissions_scratch` | `permissions/index.ts` | Session scratch-directory guidance |
| `subagent_policy` | `subagent/index.ts` | Delegation mode, limits, and approval/escalation guidance |

When adding or changing a contribution:

- Set or delete only your own section on `sections`; do not return `systemPrompt`, set `forceSystemPrompt`, or edit another extension's section. Pi runs handlers in registration order, so later handlers still see the rendered prompt.
- Apply section setup to both user- and custom-message run starts. On Pi 1.2, `event.messageType` discriminates user events (`prompt`, optional `images`) from custom events (`message`, no `prompt` or `images`). Narrow by `messageType` before using user-only fields; section-only handlers need not read either payload.
- Assign the full text each run from current state instead of appending, so reused options, reload, and repeated turns cannot duplicate guidance.
- Delete the section when its tool is unavailable or inactive (clarify disabled/inactive, neither `subagent` nor `escalate_to_parent` active). Do not leave stale guidance for a tool the model cannot call.
- Keep tool-specific lines explicit about the tool they describe, as for `promptSnippet`/`promptGuidelines`.
- A deliberate whole-prompt override by another extension is that extension's choice; local sections stay structured and are not copied into it.

Regression coverage is in [`pi-compatibility/structured-prompt.test.ts`](./pi-compatibility/host-contract-coverage.md#structured-prompttestts). It renders both trigger variants through the actual host with synthetic late contributors; it does not test `AgentSession` run scheduling or provider cache behavior.

## Tool availability at startup

Optional tools (`clarify`, `web_search`, `subagent`, `escalate_to_parent`) are withdrawn with `shared/toolAvailability.ts`, not with `setActiveTools()` during `session_start`. Pi 1.0's `setActiveToolsByName()` drops unrelated *pending* restored tools (restored declarations whose tools are not registered yet, such as late MCP tools) whenever a loadout removes an active tool. A subtractive reconcile at startup or reload would therefore discard them.

Contract:

- `registerToolAvailability()` re-registers the tool with `exposure: "hidden"` and `defaultActive: false` when unavailable (Pi's documented way to withdraw a tool). Available tools keep their own exposure (`model-only` for the workflow tools) and activation default.
- Host CLI allowlists/exclusions still filter registration on every refresh; local code does not bypass them.
- Intentional user loadout changes (`/clarify`, `/web-search`, `/subagents` toggles) stay in command handlers and may replace a restored loadout.
- `--tools +name/-name` modifiers only adjust the default selection and do not withdraw default-active local tools; explicit `--exclude-tools` does. Agent frontmatter `tools` stays a plain-name allowlist (modifiers are rejected at discovery). User guidance: [tool selection](./subagent/README.md#tool-selection).
- Availability follows saved modes, policy, depth caps, and child relay on fresh start and reload. `clarify`, `subagent`, and `escalate_to_parent` stay model-only, so nested `ctx.executeTool()` calls are rejected.

Regression coverage is in [`pi-compatibility/tool-activation.test.ts`](./pi-compatibility/host-contract-coverage.md#tool-activationtestts), [`pi-compatibility/cli-tool-selection.test.ts`](./pi-compatibility/host-contract-coverage.md#cli-tool-selectiontestts) (actual CLI parser/process) and `pi-compatibility/extension-api.test.ts`, which check this against the public host with late synthetic tools registered inactive.

Known limitation: this protects pending names that the host established. The omission was reproduced on Pi 1.0.3 and revalidated on Pi 1.1.0: SDK and CLI resume do not establish them at session creation, with or without local extensions. That open host defect is independent of this contract; see [resume contract controls and diagnostics](./pi-compatibility/host-contract-coverage.md#sdk-resumetestts-contract-controls) and the [host-defect record](../../tdr/blocked/20261009-1202-sdk-cli-resume-tool-restoration-host-defect.md). Do not add a local workaround without separate authorization.

## Extension retirement

The Pi **1.0.0** assessment found no complete shipped-and-enabled built-in replacement for the 12 local runtime extensions assessed at that version. Partial native overlap, extension examples, and possible third-party MCP integrations are not equivalent replacements. Re-check the current host documentation, examples, enabled configuration, and owning extension guides after upgrades; this version-bound conclusion is neither a permanent keep requirement nor approval to remove anything. The old custom MCP bridge and IDEA connector were already retired and are not remaining compatibility backlog.

Pi **1.1.0** revalidation reached the same retirement conclusion: none of the 12 local runtime extensions has a complete bundled-and-enabled replacement. Program-status reporting, per-tool duration/padding, and the live `/mcp` manager are partial overlaps, not replacements for the local workflows and persistent indicators. The shared dialog queue and tool-availability helper also remain necessary. This supplements, rather than replaces, the Pi 1.0.0 baseline above.

If simplification is requested, the preference-based candidates are `handoff`, `trash-history`, `hide-tool-output`, `short-paths`, and `mcp-status`. Removing them trades away workflow features; it is not cleanup of obsolete compatibility shims.

Before proposing retirement:

- Identify the exact functionality and policy lost, and verify that the replacement is actually shipped and enabled, not merely an example or potential integration.
- Inspect load order, tools/commands, state files, and consumers. Preserve permissions' ownership of Bash and its hide-tool-output integration.
- Preserve handoff documents, sessions, and archives; disabling an extension does not authorize deleting its data.
- Obtain explicit approval for the changed workflow and disable reversibly before deleting code. Recheck the remaining integrations and update user guidance for any approved change.

## Extension verification

First prepare an approved test scratch root as described in the permissions extension's [safe test scratch setup](./permissions/README.md#safe-test-scratch-setup). Then run the combined Pi host declaration, TypeScript, and full test gate from `agent/extensions/`:

```bash
npm run verify
```

`npm run verify` requires `PI_PERMISSIONS_TEST_SCRATCH_ROOT`; it does not create or choose an approved scratch root automatically. It runs contract regressions (`*.test.ts`), not outstanding host acceptance diagnostics (`*.diagnostic.ts`). Run `npm run diagnose:pi-host` with the same scratch setup after Pi upgrades or before closing TDR-20261009-1201/TDR-20261009-1202. Diagnostics execute positive requirements and fail nonzero while debt persists; a green contract gate is not a claim that host debt is resolved.

For the current Pi 1.1.0 runtime-check results and independently failing host acceptance checks, see [compatibility revalidation and limits](./pi-compatibility/host-contract-coverage.md#pi-110-revalidation). A green `npm run verify` does not imply that outstanding host acceptance diagnostics pass.

Run npm dependency commands from `agent/extensions/`, not from `agent/`.
