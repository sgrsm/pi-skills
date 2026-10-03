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

- Checks that `clarify`, `subagent`, and `escalate_to_parent` use model-only exposure, excluding programmatic nested calls.
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

Characterizes the confirmed, deferred [0003 finding](../../../fixme/0003-clarify-fullscreen-input.md), rather than treating its defects as intentional behavior or claiming its acceptance criteria pass.

- Uses public `TuiAltScreen`/`TuiMainScreen` with fake terminal input and buffers, a simplified fixed-dock composition, and a faithful local model of `custom()` installation/completion.
- Reproduces fullscreen page/home/end/wheel interception, bottom-help clipping, and clarify's mouse-mode writes; regular-mode keyboard selection/scrolling and raw-SGR wheel handling are controls. Fullscreen captures also confirm host tracking was enabled before clarify's interaction writes.
- The overlay wheel control covers the host's raw-SGR fallback, not normalized mouse support in the unchanged selector.
- A **test-only** custom-overlay adapter demonstrates restored input routing, then reproduces the cancellation blocker: stacked transcript search is popped instead of the owned dialog, and cancellation before installation can pop an unrelated overlay.
- No private host imports are committed. A version-checked scratch probe independently exercised the actual host completion method; its results are recorded in the finding.

Revisit these characterization expectations when implementing 0003 or updating Pi. The local custom-dialog model will not automatically detect an identity-safe completion change in Pi: compare it with the actual host `showExtensionCustom()` close path and reconstruct the optional probe after a version change. Passing the characterizations records existing defects; it does not close the finding.

### `dialog-concurrency.test.ts`

Protects shared scheduling across permissions and clarify. Fake dialogs check that each selector/custom-instructions exchange owns the FIFO until it completes. The public Pi loader exercises separately loaded module/API instances in both registration orders, then shutdown/invalidation and fresh instances on the same event bus. Clarify state is supplied by a scratch test wrapper, never personal settings.

Run with the [approved scratch setup](../permissions/README.md#safe-test-scratch-setup), because the loader fixture creates disposable files.

### `structured-prompt.test.ts`

Protects the [0004 structured-prompt contract](../../../fixme/0004-structured-prompt-contributions.md) across clarify, permissions, and subagent.

- Uses the public Pi loader and `ExtensionRunner`, an in-memory `SessionManager`, fake UI/theme, and synthetic late MCP/extension contributors. The last handler reads `event.systemPrompt` through the actual host renderer, not a copied prompt builder.
- Checks that additive handlers leave `forceSystemPrompt` unset; stable owned sections preserve guidance, unrelated sections, and late contributions without duplicates.
- Covers repeated/reused options, no-UI mode, inactive tools and saved off modes, manual/ask/auto policies, child-only escalation, session/write approvals, inherited read-only/broad approval, depth caps, new session ids on the same runtime, fresh-loader reload with the same session id, and deliberate whole-prompt overrides before/after local handlers.
- Uses approved scratch for isolated agent configuration and loader fixtures; restores test-process environment and shuts down and invalidates runtimes. No real session files, MCP connections, or model requests are used. Private host imports are not committed.

Run with the [approved scratch setup](../permissions/README.md#safe-test-scratch-setup). Supplementary version-checked builder/differ probes and their limits are recorded in the finding.

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
