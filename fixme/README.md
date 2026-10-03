# Pi extension compatibility work packages

Actionable backlog from the Pi **1.0.0** compatibility/regression audit of the local extensions in `agent/extensions/`. Each finding document contains enough context, evidence, proposed remediation, and acceptance criteria to serve as an implementation brief.

## Audit baseline and confidence

- Repository baseline: `49d40c286ea2800f7188e5d4b03bb940f7e2d9a1`.
- Host: `@earendil-works/pi-coding-agent@1.0.0`; Node `v22.19.0`.
- All five host dependency links were valid; TypeScript passed; **252 tests passed, none failed or skipped**.
- All 12 runtime extensions loaded through the actual Pi/jiti loader without errors.
- Existing passing tests do not cover every host integration boundary.
- **Reproduced** means an isolated probe using actual host methods/components, with synthetic state or fake terminal buffers—not an end-to-end live-terminal or enabled-MCP test.
- **Source-verified** means supported by local/host source, but not exercised end to end.
- **Verify first** means a lower-confidence review observation or optional improvement; reproduce before changing behavior.
- Findings include older gaps and latent configuration issues; they are not all regressions introduced in 1.0.0. The only configured MCP server was disabled.

The ten findings in the audit summary are covered below. Additional lower-priority review observations are retained as explicitly qualified work packages rather than silently promoted to confirmed bugs.

## Recommended order

| Order | Work package | Priority / evidence | Source | Status |
|---|---|---|---|---|
| 1 | [0001: visible, safe Trash confirmation](0001-trash-history-fullscreen-confirmation.md) | High / reproduced | Audit summary | Resolved |
| 2 | [0002: concurrent approval and clarification dialogs](0002-dialog-concurrency-and-cancellation.md) | High / permissions reproduced | Audit summary | Resolved |
| 3 | [0003: fullscreen clarify input and mouse ownership](0003-clarify-fullscreen-input.md) | Medium / input reproduced | Audit summary | Deferred |
| 4 | [0004: structured prompt contributions](0004-structured-prompt-contributions.md) | Medium / reproduced, MCP latent | Audit summary | Resolved |
| 5 | [0005: startup loadouts and MCP restoration](0005-tool-activation-and-mcp-restoration.md) | Medium / reproduced, MCP latent | Audit summary | Open |
| 6 | [0006: failed subagent results and usage](0006-subagent-failure-results.md) | Medium / renderer reproduced | Audit summary | Open |
| 7 | [0007: nested-call file lists in handoffs](0007-handoff-nested-file-operations.md) | Medium / source-verified | Audit summary | Open |
| 8 | [0008: short-paths state across loader instances](0008-short-paths-loader-state.md) | Medium / reproduced | Audit summary | Open |
| 9 | [0009: wrapped built-in configuration contracts](0009-wrapped-built-in-configuration.md) | Low–medium / source-verified | Additional observation | Open |
| 10 | [0010: MCP footer parsing and exposure drift](0010-mcp-status-config-drift.md) | Low / source-verified | Audit summary | Open |
| 11 | [0011: Codex provider and virtual-model coverage](0011-codex-verbosity-provider-coverage.md) | Low / source-verified | Audit summary | Open |
| 12 | [0012: native tool expansion and refresh state](0012-tool-rendering-expansion.md) | Low / verify UX contract first | Additional observation | Open |
| 13 | [0013: footer timer lifecycle, themes, and docs](0013-footer-lifecycle-and-theme-drift.md) | Low / mixed evidence | Additional observation | Open |
| 14 | [0014: custom session-directory cleanup scope](0014-trash-history-custom-session-directory.md) | Medium if configured / source-verified, latent | Additional observation | Open |
| 15 | [0015: unnecessary MCP startup in children](0015-subagent-mcp-startup.md) | Low / verify first, latent | Additional observation | Open |
| 16 | [0016: tool annotations and permission boundaries](0016-tool-annotations-and-permission-scope.md) | Low / metadata and documentation gap | Additional observation | Open |

0003 was reconfirmed on Pi 1.0.0. Its custom-overlay approach exposed unsafe stacked/pre-install completion in the host; the user chose to defer the runtime fix pending a host correction. Only characterization coverage/docs were retained; the original defect remains. See the finding for final validation (**342 tests**, TypeScript) and the actual-host scratch probe.

0004 was confirmed and resolved on Pi 1.0.0: clarify, permissions and subagent now contribute stable structured sections instead of forcing the whole prompt. Public loader/runner regressions preserve late MCP/extension guidance, modes, owned removal, same-id reload and deliberate foreign forces. Final verification: **356 tests passed**, valid host links and TypeScript; a version-checked scratch builder/differ probe verified unchanged-turn/no-delta, owned removals and scratch-only replacement. Two independent read-only reviews led to test/docs refinements, not further runtime changes. No provider cache measurement or real MCP connection was used. **0005 remains Open**: its independent startup-restoration loss still reproduced. See 0004 for evidence, limits and related rechecks.

Order reflects actual exposure in the audited configuration, not severity alone. Move 0014 earlier if custom session storage is enabled. Update Status to Resolved, Closed-not-reproduced, or Deferred with evidence in the owning document.

[0017: built-in feature overlap](0017-extension-feature-overlap.md) records the retirement assessment. It is a completed assessment, **not** an instruction to disable extensions.

## Change-set boundaries and parallel work

Keep one document's closely related fixes together: all three structured-prompt contributors in 0004; all startup-deactivation paths in 0005; subagent error accounting plus error rendering in 0006; MCP alias/validation/display parity in 0010.

Independent documents need not be combined merely because they touch one extension. Avoid concurrent edits to the same files; overlapping owners are:

- clarify: 0002, 0003, 0004, 0005.
- permissions: 0002, 0004; 0016 also touches its documentation.
- subagent: 0004, 0005, 0006, 0015.
- web-search: 0005, 0016; 0013 may touch idle status refresh.
- hide-tool-output: 0008, 0009, 0012.
- short-paths: 0008, 0012.
- git-inspect: 0012, 0016.
- mcp-status: 0010, 0013.
- trash-history: 0001, 0014.

Finish 0002 before subsequent edits to clarify in 0003/0004/0005. Address 0005 before or alongside 0009 because both involve tool activation. Other shared-file work should use sequential implementation or explicit ownership coordination, not concurrent uncoordinated edits.

Existing unrelated debt remains in [`tdr/`](../tdr/README.md); do not duplicate or opportunistically implement it.

## Agent quickstart

Example prompt:

> Implement `fixme/0001-trash-history-fullscreen-confirmation.md`. Read `fixme/README.md`, add focused regression tests first, preserve the stated scope, and report validation. Do not commit or change personal settings.

For any work package:

1. Read repository guidance, the owning extension README, and `agent/extensions/maintenance.md`.
2. Re-read the currently installed Pi documentation and declarations. Audit line numbers below refer to the baseline; search by named symbol if they moved.
3. Reproduce the issue without changing real user state. For verify-first items, narrow or close the finding with evidence if it no longer holds.
4. Add the smallest practical failing `node:test` regression before executable changes. Use owning tests for feature behavior and `pi-compatibility/` for host/cross-extension contracts.
5. Implement only the selected package. Preserve trust policy, tool exposure/allowlists, Priority 0 hard denials, bounded output, and session cleanup.
6. Update directory-local READMEs for changed usage or expectations. Record resolution and actual validation in the finding document and this index; retain the history.
7. Ask the user only if the desired outcome requires a material choice not settled by the package. Do not broaden security policy, provider support, or extension retirement implicitly.

### Host references

The audited host was installed at:

`/Users/sergey/.nvm/versions/node/v22.19.0/lib/node_modules/@earendil-works/pi-coding-agent`

Documents use **HOST** for that package root. Locate the current host instead of assuming that path remains valid. Read relevant `HOST/docs/*.md` completely and consult `HOST/examples/`. Use host internals to understand/reproduce contracts, not as production extension imports. Check dependencies before changing links; do not run `sync:pi-host-deps` unless necessary and authorized.

### Test-seam policy

Committed regressions should prefer local exported helpers and public host APIs, for example `ExtensionRunner`, `AgentSession`, `createAgentSession*`, `discoverAndLoadExtensions`, `ExtensionSelectorComponent`, and pi-tui's `TuiAltScreen`. Check the current package exports before choosing a seam. Existing `pi-compatibility` tests use local imports and a fake `ExtensionAPI`; preserve that portability where it adequately captures the contract.

Several reproduction recipes name private host functions (`loadExtensions`, `loadExtensionFromFactory`, `buildSystemPrompt`, `createChatViewport`, `renderLayoutFrame`). Those are **optional host probes**, not instructions to add unsupported package subpath imports. Resolve the currently installed host root from the extension package's module resolution/host link, use `pathToFileURL` for an explicit file import, and never commit the absolute nvm path. Isolate/version-check private probes and report missing seams explicitly.

If no portable public integration seam exists, commit a faithful local contract regression and retain the private-host probe in approved scratch as supplementary evidence. A missing private seam may skip that optional probe with a reason; it must not silently skip required behavior regressions or justify production imports of private host internals.

### Validation and scratch safety

Run commands from `agent/extensions/`. Focused commands are given per finding. Before any filesystem-mutating test, follow [safe test scratch setup](../agent/extensions/permissions/README.md#safe-test-scratch-setup).

Use an explicitly approved, private, real, current-user-owned session scratch root outside HOME/repository/cwd. It must contain the caller-created `.step1-test-root-ready` sentinel. The permissions fixture requires `PI_PERMISSIONS_TEST_SCRATCH_ROOT`. Also set `TMPDIR` so ordinary `mkdtemp(tmpdir())` fixtures in other tests stay inside that approved root:

```bash
export PI_PERMISSIONS_TEST_SCRATCH_ROOT="<approved scratch root>"
export TMPDIR="$PI_PERMISSIONS_TEST_SCRATCH_ROOT"
cd agent/extensions
npm run verify
```

Do not use HOME, the repository, or real session/MCP configuration as a fixture. Do not run live Trash operations, paid model calls, real dependency installs, or enabled external MCP servers just to reproduce these findings. Mock external operations or use disposable scratch fixtures. Preserve all existing Git history and user data.

Original optional artifacts were retained under:

`/var/folders/br/m0tzwhrx6t77qjyr7846jwyc0000gn/T/pi/session-01a0fee5-284d-7732-80fa-3294f2f91b91/compatibility-check/`

Files: `verify.log`, `runtime-probes.mjs`, `runtime-probes.log`, `ui-probes.mjs`, `ui-probes.log`. These are ephemeral evidence, not prerequisites; each finding describes how to reconstruct its probe.
