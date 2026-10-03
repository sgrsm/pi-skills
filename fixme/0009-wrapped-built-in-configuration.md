# 0009: Preserve host configuration when wrapping built-in tools

- **Status:** Open
- **Priority:** Low–medium; image behavior latent with current settings
- **Evidence:** Source-verified; reproduce effective activation before changing it
- **Area:** `agent/extensions/hide-tool-output`
- **Instructions:** [Package workflow and validation](README.md)

## Problem and evidence

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

### Re-check after 0005

0005 now uses public hidden withdrawal instead of subtractive startup updates. This wrapper does not use that helper; source inspection still shows independently active read/edit/write/grep/find/ls registrations and delegated read creation without effective `images.autoResize` options. 0005’s public SDK selection tests and full verification passed, but native/wrapped parity and image-setting acceptance criteria were not tested here. **Status remains Open**; no wrapper changes were made.

### Re-check after 0008

0008 changed path-state synchronization and renderer invalidation only. Source inspection still shows direct wrapper registrations without `defaultActive: false` and delegated read construction without effective image options; execution, activation, schemas and result data were not modified. Final 0008 validation passed **547 full-gate tests**, TypeScript and five host links, including the existing session-cwd check. Native/wrapped activation parity and image-setting acceptance checks were not executed for this package. **Status remains Open**; passing rendering tests do not verify these independent criteria.

Dependency/coordination: [0005: startup loadouts](0005-tool-activation-and-mcp-restoration.md). The permissions-owned Bash backend's documented custom-shell limitations are not an instruction to replace its guarded operations.
