# Pi compatibility tests

Developer/internal compatibility checks for local Pi extensions. This directory is not a user-facing extension and does not register slash commands, tools, flags, footer status, or runtime hooks.

## What it does

- Keeps small regression tests for extension behavior that depends on Pi host API details.
- Protects cross-extension invariants that are easy to break during extension work but are not a single extension feature by themselves.
- Runs as part of the `agent/extensions` test suite because the files end in `.test.ts`.

## Current checks

### `config-paths.test.ts`

Protects rebrand-safe config path handling across local extensions.

- Scans focused runtime files in `clarify`, `web-search`, `handoff`, and `subagent`.
- The invariant is that config-sensitive runtime code uses Pi's public helpers such as `getAgentDir()` and `CONFIG_DIR_NAME` instead of hardcoded `.pi` literals or direct `PI_CODING_AGENT_DIR` fallbacks.

### `extension-api.test.ts`

Protects custom-tool prompt metadata and the chosen exposure of workflow tools.

- Checks that `clarify`, `subagent`, and `escalate_to_parent` use model-only exposure when available, or hidden/inactive registration when unavailable, excluding programmatic nested calls.
- Captures registered prompt metadata from `clarify`, `git-inspect`, `web-search`, and `subagent`.
- The invariant is that every `promptSnippet` and `promptGuidelines` entry names its tool explicitly. Pi composes tool prompt metadata into a flat prompt, so each standalone line must remain clear about which tool it is describing.

### `ui-mode-guards.test.ts`

Protects TUI-only UI gating.

- Imports focused helper predicates from:
  - `clarify/index.ts` - `canUseClarifyCustomSelector`
  - `handoff/index.ts` - `canInstallContinueWarningEditor`
  - `subagent/index.ts` - `canOpenSubagentConfigUi`
- Exercises `tui`, `rpc`, `json`, and `print` mode shapes, including `rpc` with `hasUI: true`.
- The invariant is that custom TUI components and editor wrappers are allowed only when `ctx.mode === "tui"`, not merely when `ctx.hasUI` is true. RPC mode may have UI capabilities such as notifications or selections, but it cannot host terminal-only custom widgets.

### `trash-confirmation.test.ts`

Protects safe, visible Trash approval against the host selector and fullscreen layout contracts.

- Uses public `ExtensionSelectorComponent` and pi-tui APIs with a fake terminal; the fixed-dock layout is a manual copy of Pi 1.0's `chat-viewport` contract, including a three-line footer.
- Includes a legacy full-report control that reproduces clipped choices, proving the fixture exercises fullscreen clipping.
- Checks both choices and navigation help at 80×24, 40×24, and 30×24 with a large detailed preview and long paths.
- Checks that initial Enter selects Cancel, Escape invokes cancellation exactly once without selection, and approval requires navigating to the affirmative option.

### `clarify-input.test.ts`

Characterizes existing fullscreen input and dialog-lifecycle defects, rather than treating them as intentional behavior. See the durable [fullscreen dialog host-blocker record](../../../tdr/0003-clarify-fullscreen-input-host-blocker.md).

- Uses public `TuiAltScreen`/`TuiMainScreen` with fake terminal input and buffers, a simplified fixed-dock composition, and a faithful local model of `custom()` installation/completion.
- Reproduces fullscreen page/home/end/wheel interception, bottom-help clipping, and clarify's mouse-mode writes; regular-mode keyboard selection/scrolling and raw-SGR wheel handling are controls. Fullscreen captures also confirm host tracking was enabled before clarify's interaction writes.
- The overlay wheel control covers the host's raw-SGR fallback, not normalized mouse support in the unchanged selector.
- A **test-only** custom-overlay adapter demonstrates restored input routing, then reproduces the cancellation blocker: stacked transcript search is popped instead of the owned dialog, and cancellation before installation can pop an unrelated overlay.
- No private host imports are committed. The host-blocker record describes the supplementary version-checked completion probe and how to reconstruct it.

Revisit these characterization expectations when changing clarify's fullscreen behavior or updating Pi. The local custom-dialog model will not automatically detect an identity-safe completion change in Pi: compare it with the actual host `showExtensionCustom()` close path and reconstruct the optional probe after a version change. Passing the characterizations records existing defects; it does not demonstrate their resolution.

### `dialog-concurrency.test.ts`

Protects shared scheduling across permissions and clarify. Fake dialogs check that each selector/custom-instructions exchange owns the FIFO until it completes. The public Pi loader exercises separately loaded module/API instances in both registration orders, then shutdown/invalidation and fresh instances on the same event bus. Clarify state is supplied by a scratch test wrapper, never personal settings.

Run with the [approved scratch setup](../permissions/README.md#safe-test-scratch-setup), because the loader fixture creates disposable files.

### `structured-prompt.test.ts`

Protects additive structured-prompt contributions across clarify, permissions, and subagent.

- Uses the public Pi loader and `ExtensionRunner`, an in-memory `SessionManager`, fake UI/theme, and synthetic late MCP/extension contributors. The last handler reads `event.systemPrompt` through the actual host renderer, not a copied prompt builder.
- Checks that additive handlers leave `forceSystemPrompt` unset; stable owned sections preserve guidance, unrelated sections, and late contributions without duplicates.
- Covers repeated/reused options, no-UI mode, inactive tools and saved off modes, manual/ask/auto policies, child-only escalation, session/write approvals, inherited read-only/broad approval, depth caps, new session ids on the same runtime, fresh-loader reload with the same session id, and deliberate whole-prompt overrides before/after local handlers.
- Uses approved scratch for isolated agent configuration and loader fixtures; restores test-process environment and shuts down and invalidates runtimes. No real session files, MCP connections, or model requests are used. Private host imports are not committed.

Run with the [approved scratch setup](../permissions/README.md#safe-test-scratch-setup). These tests do not measure provider cache behavior or use live MCP connections.

### `tool-activation.test.ts`

Protects optional-tool availability and preservation of restored tools with the public loader, SDK selection, `AgentSession`, and in-memory sessions.

- Late synthetic direct, deferred, and codemode tools register inactive, so their eventual activation proves restoration rather than default activation. No live MCP server or provider request is used.
- Covers every combination of saved clarify/search/delegation off modes, top-level/child relay, and independently varied registration order in public-constructor transcript restoration and actual reload/fresh runtimes. Also covers public `/tree` restoration with delegation off or depth-capped.
- Covers manual/ask/auto policies, fresh and reloaded depth caps, saved-state changes, explicit persisted toggles, active/callable sets for available and withdrawn tools, model-only nested-call rejection, direct child escalation, unrelated session choices, `defaultTools`, `+codemode`, allowlists/exclusions (including late restoration), and no-tools options.
- The codemode placeholder checks selection only, not the real sandbox or loadout renderer. The public constructor restoration case deliberately omits `initialActiveToolNames`; it does not claim to fix the SDK’s separate resume-selection behavior.

Run with the [approved scratch setup](../permissions/README.md#safe-test-scratch-setup). All configuration writes target disposable fixtures, and environment/runtime state is restored or invalidated afterward.

### `sdk-resume.test.ts`

Exercises SDK/CLI resume integration for the local tool-activation fix and retains **characterizations of the separate open [TDR-0004 host defect](../../../tdr/0004-sdk-cli-resume-tool-restoration-host-defect.md)**. Passing these tests does not mean host restoration works.

- Reopens real disposable JSONL transcripts through `SessionManager.open()` and creates sessions through the public SDK. A no-local-extension baseline reproduces omission of selected late declarations; all 16 local off-mode/relay combinations retain the same baseline and correct local availability.
- Runs the actual package-declared CLI binary with `--session` in offline RPC mode, comparing baseline and local-all-off startup. No prompt or provider request is sent. Children have isolated agent configuration/fake HOME, an allowlisted environment without inherited provider keys, bounded output/timeouts, and orderly stdin shutdown.
- Synthetic direct/deferred/codemode tools register inactive so default activation cannot mask missing restoration. Registered names/exposures and indirect callability are explicitly checked. A positive `/tree` control proves the same persisted fixture is restorable through that seam, not that SDK/CLI creation works. The direct control does not imply ordinary auto-active direct MCP tools all fail.
- Version-checked for Pi 1.0.0; after an upgrade, re-evaluate the characterizations against TDR-0004's positive restoration criteria instead of preserving the defect as intended behavior or silently skipping it.

Run with the [approved scratch setup](../permissions/README.md#safe-test-scratch-setup), setting both `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR` to the approved root. No personal session files, credentials, host patches, or enabled MCP servers are used.

### `short-paths-loader.test.ts`

Checks that `/short-paths` updates wrapped summaries across independently loaded extensions while preserving row expansion and cleaning up on reload.

Run with the [approved scratch setup](../permissions/README.md#safe-test-scratch-setup). See the durable [test coverage and limitations](short-paths-loader.md) for maintainer details.

## When to add tests here

Add a compatibility test here when a change depends on a Pi host contract or a cross-extension integration point, especially when the behavior could regress silently during unrelated extension edits.

Good candidates:

- version-specific Pi extension API contracts, such as execution context and nested-call semantics;
- prompt metadata requirements that matter because of how Pi composes tool documentation;
- mode/transport distinctions such as `ctx.mode` versus `ctx.hasUI`;
- config-dir or agent-dir contracts where public helpers must be used instead of hardcoded paths;
- narrow helper-level checks shared by several extension behaviors.

Prefer the owning extension's own test file for normal feature behavior. Keep this directory focused on compatibility invariants, not broad coverage.

## How to add a test

- Keep tests small and explicit; use `node:test` and `node:assert/strict` like the existing files.
- Prefer exported helper predicates for behavior checks instead of constructing full UI/runtime objects.
- If scanning source text, keep the scanned file list narrow and explain the host contract in the test name.
- If a new TUI-only surface is added, expose a small `can...` helper and extend `ui-mode-guards.test.ts` so `rpc` with `hasUI: true` remains covered.
- If a runtime extension starts reading or writing Pi config paths directly, extend `config-paths.test.ts` so helper-based path resolution stays enforced.

## Commands

Run from `agent/extensions`:

```bash
node --test pi-compatibility/*.test.ts
```

Run the full extension test suite:

```bash
npm test
```

Optional validation before broader extension work:

```bash
npm run typecheck
```

If typechecking reports missing or stale Pi host package links, refresh them first:

```bash
npm run sync:pi-host-deps
```
