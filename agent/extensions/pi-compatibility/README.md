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

Checks visible, cancel-first Trash approval at representative narrow fullscreen sizes: initial Enter or Escape cancels, and approval requires deliberate navigation. Uses public selector and pi-tui APIs with a fake terminal.

### `clarify-input.test.ts`

**Characterizes** existing fullscreen clarify input and dialog-lifecycle defects; it is not a guarantee. The [host-blocker record](../../../tdr/0003-clarify-fullscreen-input-host-blocker.md) tracks the open blocker. Passing records the defects, not their resolution.

### `dialog-concurrency.test.ts`

Protects shared scheduling across permissions and clarify, including separately loaded extensions in both registration orders and reload on the same event bus.

### `structured-prompt.test.ts`

Protects additive structured prompt contributions from clarify, permissions, and subagent through the public loader and real prompt renderer. See [structured prompt contributions](../maintenance.md#structured-prompt-contributions).

### `tool-activation.test.ts`

Protects optional-tool availability and preservation of restored tools across startup, reload, `/tree`, and SDK selection. See [tool availability at startup](../maintenance.md#tool-availability-at-startup).

### `sdk-resume.test.ts`

Checks SDK/CLI resume against the local tool-availability fix and **characterizes** the separate open [host defect](../../../tdr/0004-sdk-cli-resume-tool-restoration-host-defect.md): resumed SDK/CLI sessions omit selected late tool declarations even without local extensions. Passing does not mean host restoration works.

### `short-paths-loader.test.ts`

Checks that `/short-paths` updates wrapped summaries across independently loaded extensions while preserving row expansion and cleaning up on reload. See [short-paths loader coverage](short-paths-loader.md).

### `wrapped-builtins.test.ts`

Checks native/wrapped file-tool selection at startup and reload, restrictive SDK/CLI tool options, native declaration metadata, and actual read-image resizing with isolated settings. See [wrapper coverage and limitations](host-contract-coverage.md#wrapped-builtinstestts).

## Maintainer coverage notes

[Host-contract coverage and limitations](host-contract-coverage.md) records what the larger tests cover and do not cover, the guarantee/characterization distinction, and what to re-check after a Pi upgrade.

## Scratch setup

The loader, SDK, CLI, and file-creating tests need the [approved scratch setup](../permissions/README.md#safe-test-scratch-setup). Set both `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR` to the approved root before running them.

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
