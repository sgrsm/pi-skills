# TDR-20261009-1202: Restore the transcript tool loadout on SDK/CLI resume

- **Status:** Open — reproduced on Pi 1.0.3; correction requires Pi source/upstream work
- **Priority:** Medium; MCP-specific impact latent while servers are disabled
- **Created:** 2026-10-03
- **Area:** Pi host session construction (`sdk` / `AgentSession`), not local extension startup
- **Origin:** Pi 1.0.0 compatibility investigation, resume validation for the local tool-activation fix; supersedes temporary finding 0018

## Summary and decision

On Pi **1.0.0**, and independently revalidated on **1.0.3**, creating a resumed session through the public SDK or actual CLI does not restore the active branch's selected inactive tool declarations. Late registration therefore cannot activate them from the transcript. This was reproduced **without the local extensions**, and with local extension controls.

The local clarify, web-search and subagent startup defect was independently fixed: `agent/extensions/shared/toolAvailability.ts` uses public hidden re-registration for unavailable tools instead of subtractive `setActiveTools()` calls that discard unrelated pending restoration. That correction preserves **existing pending names**, but cannot fix a host construction path that never establishes them. The user approved closing that local fix and deferring this separate host-owned correction.

**End-to-end SDK/CLI resumed-tool restoration remains broken on the tested host.** No host fix, local workaround, installed-package patch, dependency change or personal configuration change has been made. A runtime fix belongs in a separately authorized Pi source checkout/upstream change.

This record is self-contained. Temporary work-package documents and ephemeral probe artifacts are not required to understand, reproduce or resume the work.

## Confirmed defect, contract and source evidence

Here, **HOST** means the currently installed `@earendil-works/pi-coding-agent` package root. Locate it through public module resolution or `agent/extensions/node_modules/@earendil-works/pi-coding-agent`; do not assume an absolute global installation path. Record the installed version and search by symbol if the version-specific line numbers below move.

The documented contract includes:

- `HOST/docs/cli.md`, Tool search: loaded tools are recorded in the session and stay declared on their branch.
- `HOST/docs/mcp.md:204`, Control tool exposure: indirect access remains available after tree/resume/fork; tools loaded by `tool_search` remain declared on the branch.
- `HOST/docs/session-format.md`, SessionMessageEntry: persisted system messages record tool declarations and subsequent loadout changes.
- `HOST/CHANGELOG.md:43`, 1.0.0 Fixed: deferred MCP tools loaded by `tool_search` being dropped on resume/reload before server reconnection was explicitly identified as a defect to fix.

The documented contracts, no-local-extension baseline and positive `/tree` fixture control together justify classifying the omission as a host defect rather than intended selection.

Installed Pi 1.0.0 source establishes the remaining cause:

1. `dist/core/sdk.js:144-148, 293-306` computes `initialActiveToolNames` from current selection/defaults and supplies it to every new `AgentSession`, including when given `SessionManager.open()` for an existing transcript.
2. `dist/core/agent-session.js:197-202` calls `_restoreToolsFromTranscript()` at construction **only when** `initialActiveToolNames` is `undefined`.
3. `dist/core/agent-session.js:1332-1340`, `_restoreToolsFromTranscript()`, establishes pending names for declared tools that are not yet registered. SDK construction bypasses that branch.
4. `dist/core/agent-session-services.js`, `createAgentSessionFromServices()`, delegates to the SDK. `dist/main.js:674-701` uses these services for the CLI session runtime. Executing the actual bundled CLI corroborated the behavior; this is not inferred solely from unbundled source.
5. `dist/core/agent-session.js:2772-2862`, `_refreshToolRegistry()`, consumes pending names when tools register, but cannot restore declarations that were never placed in the pending loadout.

The distinction matters: the repaired local startup defect **cleared existing pending names**; this host defect **does not seed those names during resumed-session construction**.

## Affected behavior and limits

The lost state is the previously selected **model declaration** of inactive, deferred or codemode tools, including synthetic tools representing late MCP registration.

- `deferred` and `codemode` tools remain indirectly callable after registration, independently of the declared set. This finding does not claim their indirect access is broken.
- Ordinary `direct` MCP tools generally activate on registration, which can mask the omission. The inactive direct control below isolates restoration itself; it does not demonstrate that all direct MCP tools become unusable.
- Local on/off/relay controls leave the **already-omitted host state unchanged**. That parity cannot prove pending-name preservation where none were seeded. The separate positive tests in `agent/extensions/pi-compatibility/tool-activation.test.ts` cover the local constructor/tree/reload preservation contract.
- No actual `tool_search` execution, live MCP connection, provider request, interactive `/resume` picker, CLI `--continue`, real terminal or fork flow was used. The persisted fixture represents the documented selected loadout. RPC `switch_session` was source-inspected through `AgentSessionRuntime.switchSession()`, not independently executed.
- Explicit restrictive tool selections were not used in the missing-restoration reproduction. Any host fix must protect their precedence; existing local activation tests cover allowlist/exclusion compatibility but are not sufficient host-fix acceptance tests.

## Pi 1.0.3 revalidation

The public SDK and actual package-declared CLI were executed with disposable reopened transcripts, isolated configuration, and offline runtimes. Both host-only and local-all-off runs still produced `read, bash, edit, write` after late registration rather than the recorded `read` plus the selected inactive direct/deferred/codemode tools. Registered names/exposures and indirect callability controls confirmed that registration itself succeeded. The same-file `/tree` positive control restored the selected declarations; all local on/off/relay combinations preserved the host baseline and their intended local availability.

The exact Pi 1.0.0 assertion has been removed from normal tests after behavioral revalidation, not merely bumped to accept a newer version. `resumeFixture.ts` now shares the isolated fixtures. `sdk-resume.test.ts` protects working `/tree`, callability, local-availability and CLI/transcript controls without asserting omission as intended behavior. `sdk-resume.diagnostic.ts` requires positive restoration in SDK/CLI runs with and without local extensions and currently fails; it reports the host version and selected/active loadouts.

No prompt, provider request, live MCP connection, personal session, or installed-host patch was used. This revalidation does not cover interactive `/resume`, CLI `--continue`, runtime switch, or fork. A green normal contract gate is not evidence of successful creation-time restoration.

## Reproduction and revalidation

### Durable tests

The portable reproduction is `agent/extensions/pi-compatibility/sdk-resume.test.ts`. It uses public SDK imports, disposable session files and the actual package-declared CLI binary. No private host-method imports or absolute installed-host paths are committed.

From the repository root, after preparing approved scratch as described below:

```bash
export PI_PERMISSIONS_TEST_SCRATCH_ROOT="<approved canonical scratch root>"
export TMPDIR="$PI_PERMISSIONS_TEST_SCRATCH_ROOT"
cd agent/extensions
node --test pi-compatibility/sdk-resume.test.ts
node --test pi-compatibility/*.test.ts clarify/index.test.ts web-search/index.test.ts
npm run test:subagent
npm run verify
node --test pi-compatibility/sdk-resume.diagnostic.ts
```

Normal `*.test.ts` checks protect working contracts and local-availability parity, including the positive `/tree` control. Passing them does **not** demonstrate successful SDK/CLI creation-time restoration. Explicit `*.diagnostic.ts` checks assert the required positive restoration behavior and fail nonzero on the tested Pi 1.0.3; they are neither skipped nor marked TODO. `npm run diagnose:pi-host` runs both this record's and TDR-20261009-1201's outstanding checks. After upgrades, rerun diagnostics and re-evaluate the actual behavior rather than pinning a version or preserving omission as intended behavior.

### Reconstruct the SDK reproduction

1. Locate the current host and record its version. Read current `docs/sdk.md`, `docs/extensions.md`, `docs/cli.md`, `docs/mcp.md`, `docs/settings.md` and `docs/session-format.md`, relevant declarations, and `examples/sdk/11-sessions.ts` before changing host code.
2. Under approved scratch, create an isolated agent directory and a real version-3 JSONL session with a valid header/cwd and a system message whose `toolsAdded` declares `read`, `mcp__resume__direct`, `mcp__resume__deferred` and `mcp__resume__codemode`. Add a user entry only as recorded history; never submit it to a model. The committed fixture contains the exact entry shape.
3. Open that file with public `SessionManager.open()`. Supply it to `createAgentSession()` with an isolated resource loader, empty in-memory settings and an offline model runtime (`refreshOnCreate: false`, `allowModelNetwork: false`, auth/catalog paths in scratch). Set `sessionStartEvent: { type: "session_start", reason: "resume" }` during creation. Do not supply `tools`, `noTools`, `excludeTools` or a `defaultTools` override.
4. Register a neutral fixture extension that can register the three late tools on a test event. Give each its matching exposure and `defaultActive: false`; `execute()` returns harmless fixture data and is not called. Initially omit all local extensions.
5. Capture `getActiveToolNames()` before startup, call `bindExtensions()` to emit the configured `resume` event, then register the late tools. Assert that the transcript was reopened and that `getAllTools()` reports their actual names/exposures; verify indirect callability for deferred/codemode tools.
6. On Pi 1.0.0 the observed sets are:

   ```text
   Transcript:              read + all three selected synthetic tools
   Before session_start:    read, bash, edit, write
   After session_start:     read, bash, edit, write
   After late registration: read, bash, edit, write
   Restored synthetic declarations: none
   ```

7. Repeat with isolated clarify/web-search/subagent saved modes and top-level/child relay environment. The normal contract tests cover all 16 local on/off × relay combinations and correct local availability relative to the host baseline, whether or not a future host restores declarations. The explicit diagnostics separately require creation-time restoration.
8. Run the same-file positive control: navigate without summarization to the persisted system entry through public `navigateTree()`, then register the same late tools. The declared loadout restores through that seam. This establishes that the transcript/registration fixture is valid; it does not make SDK creation correct.
9. Emit shutdown and dispose every session in cleanup. Restore test-process environment before removing fixture files. No live MCP or provider call is needed.

### Reconstruct the actual CLI reproduction

Use `sdk-resume.test.ts`'s bounded child fixture rather than relying on an SDK-only result:

1. Resolve the current host and launch its declared `package.json` `bin.pi` with the current Node executable. The tested Pi 1.0.0 entry was `dist/bundle/cli.js`.
2. Give the child the scratch JSONL through `--session`, offline RPC mode, an isolated agent directory/fake HOME/cwd, and only an allowlisted environment. Set `PI_CODING_AGENT_DIR` to the isolated agent directory, `PI_SUBAGENT_PARENT_ESCALATION=0`, `PI_SUBAGENT_DEPTH=0`, `PI_OFFLINE=1`, `PI_SKIP_VERSION_CHECK=1`, `PI_TELEMETRY=0` and scratch `TMPDIR`; allow `PATH` for executable lookup, but do not inherit provider keys or auth paths. The retained test is authoritative for the exact child allowlist and private report-path variable.
3. Use `--no-approve --no-extensions --no-skills --no-prompt-templates --no-context-files`. Explicitly load an initial observer and a final late-registration observer; repeat with the three local extensions between them. Built-in MCP, codemode and `tool_search` remain disabled in this isolated reproduction.
4. The committed fixture selects `anthropic/claude-sonnet-4-5` with a deliberately invalid, non-persistent fixture key solely to permit RPC startup. Send **no prompt commands**. Never replace it with a personal credential or a usable key.
5. Capture the reopened transcript declarations and active set in the first observer. The final observer registers the synthetic inactive tools and records active tools plus registered names/exposures. Bound output to 1 MB and each child to 20 seconds; no shell is used.
6. Close stdin for orderly shutdown and verify exit status 0 with no extension errors. Both baseline and local-all-off runs produced the native-default active set rather than the recorded late declarations. Initial CLI `--session` emits `reason: "startup"`, unlike the explicit SDK `resume` event; both creation paths were executed separately.

## Safety and implementation boundaries

- Use an explicitly approved, real, non-symlink, canonical, current-user-owned, non-group/world-writable scratch root outside HOME, repository and cwd; prefer `0700`. It must neither equal, contain nor be contained by those protected paths, and must contain the caller-created, real current-user-owned `.step1-test-root-ready` sentinel. Filesystem `/` is rejected. Generated fixture roots must be exactly `0700`. Set both variables shown above; the pinned fixture helper checks the required root/sentinel safety and identities. See the durable [safe scratch setup](../agent/extensions/permissions/README.md#safe-test-scratch-setup).
- Keep sessions, configuration, auth/catalog paths, fake HOME, observers and reports under disposable fixture roots. Use the existing pinned fixture helpers; revalidate mutation targets before direct writes or host operations where practical. Do not use personal session/MCP data as fixtures.
- Do not run paid model calls, dependency installations, enabled external MCP servers, real Trash operations or other guarded mutations to reproduce this issue. Do not change personal configuration.
- Prefer public host APIs for retained tests; isolate any genuinely necessary private probe in approved scratch, version-check it and record skipped/missing seams explicitly. Do not import private host internals in production extensions.
- Add positive failing restoration regressions before executable host changes. Do not simply omit `initialActiveToolNames` unconditionally: explicit `--tools`, exclusions, no-tools options, default-tool precedence, project trust and existing reload semantics must remain correct.
- Do not emulate private pending state in local extensions, patch the installed host, or add a local workaround without separate authorization. The existing hidden-withdrawal fix and model-only/allowlist/safety contracts must remain intact. Read the durable [extension maintenance guide](../agent/extensions/maintenance.md) before any separately authorized host-link/dependency change in this repository.

## Future host remediation and acceptance criteria

In an authorized Pi source checkout, distinguish intentional current-invocation loadout replacement from ordinary resumed-session construction. Restore the appropriate active-branch declarations, including pending names for selected tools not yet registered. Close this TDR only when:

- Ordinary SDK construction from a reopened transcript and actual CLI `--session` retain selected inactive/deferred/codemode declarations through late registration.
- The same restoration works with and without local extensions. Saved off modes, depth caps and top-level relay withdrawal remain enforced; repeat the local controls after the host is corrected, because today's omitted baseline can mask their effect.
- Explicit restrictive selections, exclusions, no-tools/no-builtins options and documented `defaultTools` precedence remain intact. Restoration cannot resurrect prohibited or unselected tools.
- Indirect callable exposure remains unchanged; activation defaults cannot accidentally pass a restoration regression.
- Resume, fork, tree and reload are distinguished and tested through relevant public seams. Required creation-time restoration is not replaced with a tree-only positive control.
- Promote the positive restoration diagnostics into normal contract regressions when a verified fixed host is available. Record the host version, actual SDK/CLI results, focused/full gates and any skipped checks before closing this record.
- Documentation reflects actual behavior, and an independent review challenges host selection, restoration and safety boundaries. No provider calls or personal-state fixtures are used for validation.

## Validation history and remaining uncertainty

The investigation used Pi **1.0.0**, Node **v22.19.0**. Initial public SDK and actual bundled CLI probes reproduced the omission both without local extensions and with local-all-off controls. Both CLI children exited 0 without extension errors. The first retained resume suite passed **19 tests**; review refinements added a same-transcript positive tree control and explicit registered-tool/exposure/callability assertions, restricted the child environment and clarified characterization labels.

Final retained investigation validation passed **20 resume tests** (19 omission-characterization/local-parity counts and one positive tree control), **180 focused tests**, **108 subagent tests**, and **476 full-suite tests**, with all five host links and TypeScript passing and no failures/cancellations/skips. These results preserve the local fix and record the open host defect; they do not meet the positive SDK/CLI restoration acceptance criteria.

The fresh read-only reviewer approved the host/local scope split with no blocking defects. Its findings on evidence controls, labeling, parity claims, credential inheritance and validation bookkeeping were verified and addressed before the final rerun. Reviewer results were source/log inspections, not independently executed tests.

The documentation migration to this TDR received a fresh read-only durability review. It confirmed that the evidence, reproduction, limits, safety boundaries and acceptance criteria were retained without requiring temporary documents or scratch artifacts. Its minor wording/scratch-contract findings were addressed. Migration validation reran the **20-test resume suite** and `npm run verify` with **476 passing tests**, valid host links and TypeScript; no failures/cancellations/skips. Only documentation and test labels changed, not runtime behavior. No commit, installed-host patch or personal-configuration change was made during the migration.

Historical scratch scripts/logs were supplementary evidence only. The durable tests and reconstruction steps above retain the actionable information; neither deleted work-package records nor expired scratch artifacts are prerequisites. SDK/CLI creation-time restored declarations remain unresolved on the tested Pi 1.0.3, and the interactive/continue/switch/fork/live-MCP/provider paths listed under limits were not independently runtime-verified.
