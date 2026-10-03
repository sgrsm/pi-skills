# 0009: Preserve host configuration when wrapping built-in tools

- **Status:** Resolved
- **Priority:** Low–medium; image behavior latent with current settings
- **Evidence:** Confirmed by read-only source review; reproduced test-first and resolved through public Pi loader/SDK and scratch-image regressions
- **Area:** `agent/extensions/hide-tool-output`
- **Instructions:** [Package workflow and validation](README.md)

## Original problem and audit evidence

The line references and behavior in this section describe the audit baseline, before the resolution below.

`hide-tool-output/index.ts:55-76` registers read/edit/write/grep/find/ls as direct extension tools. Registration activates them unless `defaultActive` says otherwise. In particular grep/find/ls become enabled even though native `defaultTools` defaults to read/bash/edit/write.

The wrapper also recreates read definitions without options at execution time. Native Pi passes `images.autoResize` into its read definition (`HOST/dist/core/agent-session.js`, tool registry setup); the wrapper ignores `images.autoResize: false`.

This is configuration drift, not a new 1.0 hard break. A plain extension is allowed to activate its own tools independently of `defaultTools`; the desired parity here is specific to extensions replacing built-in names.

## Reproduce / test first

Construct isolated host sessions with native tools and with these wrappers. Compare effective tools for default settings, `+codemode`, additive/subtractive lists, empty defaults, explicit grep, and restrictive CLI allowlists. Include reload semantics.

For read, mock/spy the tool factory or image-resize operation using a scratch image; assert effective false/true settings reach the delegated read. Preserve ctx.cwd tests.

## Recommended fix

Treat the replacement tools as native-tool replacements, not unrelated always-active extension tools. Use `defaultActive: false` and host default/explicit selection where that yields exact native activation; verify read/edit/write remain selected by ordinary defaults. Do not deactivate tools during `session_start` as a workaround (0005).

Pass documented effective read options from `pi.getSettings()` into definitions while preserving schemas, prompt metadata, structuredContent, annotations, renderShell, and per-session cwd. Do not copy private host constructors or weaken guards.

## Acceptance criteria

- Effective tool selection matches the corresponding unwrapped native configuration at startup.
- Explicit tool selection and reload retain documented host precedence.
- `images.autoResize: false` is honored; default true behavior remains.
- Rendering preferences do not change tool execution or tool-result data.
- Restrictive child/CLI allowlists cannot be bypassed.
- README documents any correction to previously auto-enabled search tools.

## Validation

Focused wrapper and host-activation/image-setting tests; `npm run verify` with approved scratch.

### Earlier rechecks

0005's startup fix and 0008's renderer fix left this finding Open; neither established native/wrapped selection or image-setting parity.

## Resolution and validation

On **Pi 1.0.0 / Node v22.19.0**, a read-only scout confirmed both defects from current source/contracts but executed no tests. Parent-run public loader/SDK and scratch-image regressions reproduced them before implementation: **25 tests, 5 passed and 20 failed**, including parent/subtest counts.

All six replacements now use `defaultActive: false`, letting the host own defaults, explicit selection, allowlists and reload choices. Delegated read receives `pi.getSettings().images?.autoResize ?? true` after runtime binding. The relevant contracts are public `ToolDefinition.defaultActive`, `ExtensionAPI.getSettings()`, `createReadToolDefinition()`, and host `AgentSession._refreshToolRegistry()/reload()`. Cwd, arguments, signal, context, results and metadata remain preserved; no startup loadout subtraction, Bash/permission-policy or rendering changes were added.

Image-setting changes apply on the next wrapped read; native read captures them at runtime build and picks them up on reload. The [user guide](../agent/extensions/hide-tool-output/README.md#tool-selection) explains search-tool opt-in and migration for already-active tools.

A fresh read-only reviewer found **no blocking defects**, inspecting source and parent logs but executing no tests. Its native-timing documentation and argument/cancellation/model-context suggestions were verified and addressed; project-override coverage was also added. The reviewer did not re-review those refinements.

Executed validation:
- Original post-review gate: **34 focused, 143 related and 576 full-gate tests passed**.
- After reducing duplicate documentation/test setup: `node --test pi-compatibility/wrapped-builtins.test.ts hide-tool-output/index.test.ts hide-tool-output/renderStrategy.test.ts` — **32 passed**; `npm run verify` — **574 passed**, TypeScript and five host links valid.
- All final checks: **0 failed, cancelled or skipped**. Fixtures used approved scratch/sentinel with both required environment variables; no personal configuration, real sessions, dependencies or Git history were changed.

[Coverage notes](../agent/extensions/pi-compatibility/host-contract-coverage.md#wrapped-builtinstestts) describe the public-host seams. Update-callback forwarding is source-verified, not streaming-tested. No wrapper-enabled CLI, live terminal/provider/MCP or combined Bash-parity probe was run; existing offline CLI resume tests remain characterizations of the open host defect.

Related rechecks: **0005/0008 remain Resolved; 0012/0016 and TDR-0004 remain Open**. 0017's parity recommendation was updated without retirement approval. No unrelated fixes were implemented.

Dependency/coordination: [0005: startup loadouts](0005-tool-activation-and-mcp-restoration.md). The permissions-owned Bash backend's documented custom-shell limitations are not an instruction to replace its guarded operations.
