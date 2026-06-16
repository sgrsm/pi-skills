# Pi compatibility tests

Developer/internal compatibility checks for local Pi extensions. This directory is not a user-facing extension and does not register slash commands, tools, flags, footer status, or runtime hooks.

## What it does

- Keeps small regression tests for extension behavior that depends on Pi host API details.
- Protects cross-extension invariants that are easy to break during extension work but are not a single extension feature by themselves.
- Runs as part of the `agent/extensions` test suite because the files end in `.test.ts`.

## Current checks

### `extension-api.test.ts`

Protects Pi custom-tool API assumptions used by extensions that register tools.

- Scans `clarify/index.ts`, `web-search/index.ts`, and `subagent/index.ts` for `return { ... isError: true ... }` from tool execution paths.
- The invariant is that Pi custom-tool failures should throw `Error` from `execute()` instead of returning a successful-looking tool result marked with `isError: true`.
- Checks the `escalate_to_parent` tool metadata in `subagent/index.ts`.
- The invariant is that `promptSnippet` and every `promptGuidelines` entry for `escalate_to_parent` name the tool explicitly. Pi can compose tool prompt metadata into a flat prompt, so each standalone line must remain clear about which tool it is describing.

### `ui-mode-guards.test.ts`

Protects TUI-only UI gating.

- Imports focused helper predicates from:
  - `clarify/index.ts` - `canUseClarifyCustomSelector`
  - `handoff/index.ts` - `canInstallContinueWarningEditor`
  - `subagent/index.ts` - `canOpenSubagentConfigUi`
- Exercises `tui`, `rpc`, `json`, and `print` mode shapes, including `rpc` with `hasUI: true`.
- The invariant is that custom TUI components and editor wrappers are allowed only when `ctx.mode === "tui"`, not merely when `ctx.hasUI` is true. RPC mode may have UI capabilities such as notifications or selections, but it cannot host terminal-only custom widgets.

## When to add tests here

Add a compatibility test here when a change depends on a Pi host contract or a cross-extension integration point, especially when the behavior could regress silently during unrelated extension edits.

Good candidates:

- version-specific Pi extension API contracts, such as tool execution error semantics;
- prompt metadata requirements that matter because of how Pi composes tool documentation;
- mode/transport distinctions such as `ctx.mode` versus `ctx.hasUI`;
- narrow helper-level checks shared by several extension behaviors.

Prefer the owning extension's own test file for normal feature behavior. Keep this directory focused on compatibility invariants, not broad coverage.

## How to add a test

- Keep tests small and explicit; use `node:test` and `node:assert/strict` like the existing files.
- Prefer exported helper predicates for behavior checks instead of constructing full UI/runtime objects.
- If scanning source text, keep the scanned file list narrow and explain the host contract in the test name.
- When adding a new custom tool that follows the Pi custom-tool failure contract, either add its file to the scoped list in `extension-api.test.ts` or add a more targeted assertion if a source scan would be too brittle.
- If a new TUI-only surface is added, expose a small `can...` helper and extend `ui-mode-guards.test.ts` so `rpc` with `hasUI: true` remains covered.

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
