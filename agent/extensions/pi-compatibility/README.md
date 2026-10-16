# Pi compatibility tests

Developer/internal compatibility checks for local Pi extensions. This directory is not a user-facing extension and does not register slash commands, tools, flags, footer status, or runtime hooks.

## What it does

- Keeps small regression tests for extension behavior that depends on Pi host API details.
- Protects cross-extension invariants that are easy to break during extension work but are not a single extension feature by themselves.
- Runs contract regressions as part of the `agent/extensions` test suite (`*.test.ts`).
- Keeps positive acceptance checks for unresolved host debt in explicit diagnostics (`*.diagnostic.ts`), outside the normal success gate. Diagnostics execute real checks and fail nonzero while the required behavior is broken; they are not skipped or marked TODO.

## Current checks

### `config-paths.test.ts`

Protects rebrand-safe config path handling across local extensions.

- Scans focused runtime files in `clarify`, `web-search`, `handoff`, and `subagent`.
- The invariant is that config-sensitive runtime code uses Pi's public helpers such as `getAgentDir()` and `CONFIG_DIR_NAME` instead of hardcoded `.pi` literals or direct `PI_CODING_AGENT_DIR` fallbacks.

### `extension-api.test.ts`

Protects custom-tool prompt metadata and the chosen exposure of workflow tools.

- Checks that `clarify`, `subagent`, and `escalate_to_parent` use model-only exposure when available, or hidden/inactive registration when unavailable, excluding programmatic nested calls.
- Captures registered prompt metadata from `clarify`, `git-inspect`, `web-search`, and `subagent`.
- Checks direct-call-only guidance for model-only workflow tools and the single-call parallel delegation shape.
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

Protects the Clarify overlay selector and answer editor with the public fullscreen and regular renderers and fake terminals: PageUp/PageDown/Home/End/wheel scroll the question and not the transcript (including wheel at both scroll boundaries); fullscreen and regular mode never toggle terminal mouse modes; actions follow injected keybindings; layout stays within the terminal across a size matrix (small, narrow, height-only and width-only resize, many choices, long descriptions, wide characters); and a lifecycle matrix covers queued/displayed cancellation, stacked search or unrelated overlays above/below, synchronous/microtask installation, shutdown/reload, repeated interactions and exactly-once completion. Completion goes through a test `custom()` adapter that mirrors Pi 1.3's identity-specific close path, so these checks do not by themselves prove host behavior. See the [coverage limits](host-contract-coverage.md#clarify-inputtestts-and-clarify-hosttestts).

### `clarify-host.test.ts`

Runs the real `InteractiveMode` (public root export) in a bounded, isolated subprocess (`clarifyHostChild.ts`) with a fake terminal, an offline in-memory session runtime and the real Clarify extension, in fullscreen and regular mode. It checks input routing, boundary wheel, resize, completion/cancellation focus, search stacked above or opened before each stage (selector and answer editor), pointer text selection over the dialog, the answer editor overlay (bounds, cursor, footer, paste, wheel), queued/FIFO and the custom-answer exchange, and shutdown/reload through the host's own `showExtensionCustom()` path. It needs the same approved scratch setup as the other tests and no network. It is not a live-terminal test and does not emulate Ghostty or real mouse hardware.

### `dialog-concurrency.test.ts`

Protects shared scheduling across permissions and clarify, including separately loaded extensions in both registration orders and reload on the same event bus.

### `structured-prompt.test.ts`

Protects additive structured prompt contributions from clarify, permissions, and subagent for both user and custom-message run starts through the public loader and real prompt renderer. See [structured prompt contributions](../maintenance.md#structured-prompt-contributions) and [coverage limits](./host-contract-coverage.md#structured-prompttestts).

### `cli-tool-selection.test.ts`

Protects the documented `--tools` modifier versus `--exclude-tools` behavior with the host's CLI parser and a real offline CLI process (startup and `/reload`). See [coverage notes](./host-contract-coverage.md#cli-tool-selectiontestts).

### `tool-activation.test.ts`

Protects optional-tool availability and preservation of restored tools across startup, reload, `/tree`, and SDK selection. See [tool availability at startup](../maintenance.md#tool-availability-at-startup).

### `model-only-codemode.test.ts`

Checks that real codemode in both `on` and `only` modes preserves direct model declarations and guidance for workflow tools while excluding them from script discovery and access. See [coverage and limitations](host-contract-coverage.md#model-only-codemodetestts).

### `sdk-resume.test.ts`

Protects resumed tool-loadout restoration with isolated, offline fixtures: no provider request, live MCP server or personal session is used.

- Ordinary SDK construction from a reopened transcript and the actual bundled CLI `--session` must restore the selected late tool declarations, with and without the local extensions (saved off).
- One case table runs resumed selection precedence through both the public SDK and the actual CLI: no options, `+name`/`-name` modifiers, plain allowlists, MCP-filtering allowlists, exclusions, `--no-tools`, `--no-builtin-tools` and `defaultTools` settings.
- Local startup availability is checked for 16 saved-off/relay states plus depth-capped states, with and without local tools recorded in the transcript, including the declaration, registration and callability distinction.
- Actual CLI `--continue` (isolated session directory) and `--fork` (deterministic ID) and public runtime `switchSession()`/`fork()` check the session identity, start reason, lineage and per-branch loadout.
- `/tree` and `reload()` are separate controls from creation-time restoration.

Coverage limits are in [host-contract coverage](host-contract-coverage.md#sdk-resumetestts). The tests do not require a particular Pi version.

### `short-paths-loader.test.ts`

Checks that `/short-paths` updates wrapped summaries across independently loaded extensions while preserving row expansion and cleaning up on reload. See [short-paths loader coverage](short-paths-loader.md).

### `wrapped-builtins.test.ts`

Checks native/wrapped file-tool selection at startup and reload, restrictive SDK/CLI tool options, native declaration metadata, and actual read-image resizing with isolated settings. See [wrapper coverage and limitations](host-contract-coverage.md#wrapped-builtinstestts).

## Maintainer coverage notes

[Host-contract coverage and limitations](host-contract-coverage.md) records what the larger tests cover and do not cover, the guarantee/characterization distinction, and what to re-check after a Pi upgrade.

## Pi 1.1.0 status

The fake-terminal fixtures support Pi 1.1.0's required `Terminal.setProgramStatus()` method. These renderer/input tests do not exercise OSC 7501 reporting. Host-package links must resolve to the version under test; old peer links are not upgrade-validation evidence.

At the Pi 1.1.0 baseline the positive resume and Clarify diagnostics failed. On Pi 1.3.0 those requirements are normal tests; `clarify-host.test.ts` independently exercises actual host custom-dialog completion rather than relying only on the copied adapter. See [revalidation evidence and limits](host-contract-coverage.md#pi-110-revalidation) and the [current TDR index](../../../tdr/README.md#pi-110-revalidation). Earlier investigation baselines remain in the owning records.

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

Run the full extension contract test suite:

```bash
npm test
```

All previously outstanding resume and Clarify host requirements run in the normal gate. For focused actual-host validation after upgrades, use the approved scratch setup and run:

```bash
node --test pi-compatibility/sdk-resume.test.ts pi-compatibility/clarify-input.test.ts pi-compatibility/clarify-host.test.ts
```

A green gate covers the documented offline/fake-terminal contracts, not live hardware, providers or MCP services. See the owning coverage limits before making a closure claim.

Optional validation before broader extension work:

```bash
npm run typecheck
```

If typechecking reports missing or stale Pi host package links, refresh them first:

```bash
npm run sync:pi-host-deps
```
