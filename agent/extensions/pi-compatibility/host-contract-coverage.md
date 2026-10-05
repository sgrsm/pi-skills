# Host-contract coverage and limitations

Maintainer notes for the larger `pi-compatibility` tests. For the file index and commands, see the [README](./README.md). For the short-paths tests, see [short-paths loader coverage](./short-paths-loader.md).

Related integration rules are in [extension maintenance](../maintenance.md): [shared interactive dialogs](../maintenance.md#shared-interactive-dialogs), [structured prompt contributions](../maintenance.md#structured-prompt-contributions), and [tool availability at startup](../maintenance.md#tool-availability-at-startup).

## Conventions

- Prefer public Pi exports (`discoverAndLoadExtensions`, `ExtensionRunner`, `AgentSession`, `createAgentSession`, `SessionManager`, `ExtensionSelectorComponent`, pi-tui screens) over copied host logic. Do not commit private host imports or absolute installed-host paths.
- Tests that load extensions or create files need the [approved scratch setup](../permissions/README.md#safe-test-scratch-setup). Set both `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR` to the approved root; several tests assert that they match. Fixtures use isolated agent configuration and in-memory or disposable sessions, restore environment variables, and shut down and invalidate runtimes. They never use personal settings, session files, credentials, live providers, or live MCP servers.
- **Contract regressions** protect working behavior and local safety invariants in `*.test.ts`. **Outstanding host acceptance checks** live in `*.diagnostic.ts` and run explicitly through `npm run diagnose:pi-host`; they assert desired behavior and fail nonzero while tracked debt remains. They are neither skipped nor TODOs. A green contract gate is not evidence that host debt is fixed. Revalidate diagnostics and any copied host adapters on upgrades, and promote verified fixes into the normal suite.

## `trash-confirmation.test.ts`

Protects safe, visible Trash approval at fullscreen sizes.

- Uses the public `ExtensionSelectorComponent` and pi-tui with a fake terminal. The fixed-dock layout is a manual copy of Pi 1.0's `chat-viewport` contract, including a three-line footer; compare it with the host layout after upgrades.
- A legacy full-report control reproduces clipped choices, which shows that the fixture really exercises fullscreen clipping.
- Both choices and the navigation help must remain visible at 80×24, 40×24, and 30×24, with a large preview and long paths.
- Initial Enter selects Cancel, Escape cancels exactly once without a selection, and approval requires navigating to the affirmative choice.

## `clarify-input.test.ts` and `clarify-input.diagnostic.ts`

Protect working routes and test outstanding requirements separately; see [TDR-0003](../../../tdr/0003-clarify-fullscreen-input-host-blocker.md). On the tested Pi 1.0.3, fullscreen Home/End routing works, but the remaining input/layout/mouse defects and host overlay-completion blocker are still **open**. No local runtime fix or installed-host patch is included.

- `clarifyUiFixture.ts` shares public `TuiAltScreen`/`TuiMainScreen` fake-terminal fixtures, the simplified fixed-dock composition, and the test-only `custom()` adapter.
- Normal contract tests require Home/End to scroll the question without moving the transcript; they also protect regular-mode interaction and focused-overlay input controls.
- Diagnostics require PageUp/PageDown/wheel to scroll the question, help to remain visible, and the extension to leave mouse modes alone. These positive requirements fail on Pi 1.0.3; no test asserts that the bugs should persist.
- Adapter lifecycle diagnostics require owned-dialog removal without stealing stacked search or an unrelated overlay on pre-install cancellation. The overlay wheel control exercises raw-SGR fallback, not normalized mouse support.
- A separate scratch-only, version-checked invocation of the actual Pi 1.0.3 `showExtensionCustom()` method confirmed the stacked-search and pre-install failures, including completion inside the factory; normal mounted completion was a positive control. The TDR retains reconstruction steps, not private committed imports.

The adapter hard-codes completion behavior and cannot independently detect an identity-safe host correction. After an upgrade, inspect the actual close path and reconstruct the real-method probe before changing adapter expectations or declaring the lifecycle fixed. No live-terminal validation is claimed.

## `dialog-concurrency.test.ts`

Protects shared scheduling for permissions and clarify.

- Fake dialogs check that each selector/custom-instructions exchange keeps the FIFO until it completes.
- The public loader loads the extensions as separate module/API instances in both registration orders, then covers shutdown/invalidation and fresh instances on the same event bus.
- Clarify state comes from a scratch wrapper, not personal settings.

Subagent approval/escalation, handoff, and Trash confirmation are not enrolled in this queue and are not covered by its scheduling guarantee.

## `structured-prompt.test.ts`

Protects additive structured prompt contributions. See [structured prompt contributions](../maintenance.md#structured-prompt-contributions) for the contract.

- Uses the public loader and `ExtensionRunner`, an in-memory `SessionManager`, a fake UI/theme, and synthetic late contributors that stand in for MCP/other extensions. The last handler reads `event.systemPrompt` through the real host renderer, not a copied prompt builder.
- Asserts that local handlers leave `forceSystemPrompt` unset; their owned sections keep guidance, unrelated sections, and late contributions without duplicates.
- Covers repeated/reused options, no-UI mode, inactive tools and saved off modes, manual/ask/auto policies, child-only escalation, session/write approvals, inherited read-only and broad approval, depth caps, new session ids on one runtime, fresh-loader reload with the same session id, and deliberate whole-prompt overrides before and after the local handlers.
- Does not measure provider cache behavior and uses no MCP connections or model requests.

## `tool-activation.test.ts`

Protects optional-tool availability without losing restored tools. See [tool availability at startup](../maintenance.md#tool-availability-at-startup).

- Uses the public loader, SDK tool selection, `AgentSession`, and in-memory sessions. Late synthetic direct, deferred, and codemode tools register **inactive**, so later activation proves restoration rather than a registration default.
- Covers every combination of saved clarify/search/delegation off modes, top-level/child relay, and independently varied registration order, in constructor transcript restoration and in actual reload and fresh runtimes. Public `/tree` restoration is covered with delegation off or depth-capped.
- Also covers manual/ask/auto policies, fresh and reloaded depth caps, changed saved state, explicit persisted toggles, active and callable sets for available and withdrawn tools, model-only nested-call rejection, direct child escalation, unrelated session tool choices, `defaultTools`, `+codemode`, allowlists/exclusions (including late restoration), and no-tools options.
- The codemode placeholder checks selection only, not the real sandbox or loadout renderer. The constructor-restoration case deliberately omits `initialActiveToolNames`; it does not fix or claim to fix the separate SDK/CLI resume defect below.

## `wrapped-builtins.test.ts`

Protects [built-in replacement configuration](../short-paths/maintenance.md#built-in-replacement-configuration).

- Public loader/SDK native controls cover defaults/modifiers, explicit/restrictive selection, exclusions, no-tools options, reload choices, callable sets and declaration metadata.
- Scratch PNG/text reads cover false/true/default settings, hiding, project overrides, immediate changes/reload, cwd, offsets/limits, cancellation, model context and complete result parity. Direct definitions prevent host post-result normalization from masking resize drift.
- Codemode is selection-only; SDK options exercise shared CLI selection, not a wrapper-enabled CLI subprocess. No live terminal/provider/MCP or positive SDK/CLI resume-restoration claim.

## `sdk-resume.test.ts` (contract controls)

Protects working controls without asserting omission as desired behavior. The separate **open** [host defect](../../../tdr/0004-sdk-cli-resume-tool-restoration-host-defect.md) was reproduced on Pi 1.0.3 with public SDK construction and the actual CLI, both with and without local extensions. No host patch or local workaround exists.

- `resumeFixture.ts` shares isolated offline fixtures between contract tests and diagnostics. It reopens a real disposable JSONL transcript with `SessionManager.open()` and validates transcript identity and registered late-tool names/exposures.
- Normal tests protect positive `/tree` restoration, indirect callability, every local off-mode/relay combination's availability and parity with the host baseline, and actual CLI transcript/parity controls. Parity expectations use each baseline phase rather than freezing its omitted loadout.
- The CLI runs `--session` in offline RPC mode with isolated configuration/HOME, an allowlisted credential-free environment, bounded output/timeouts, and orderly stdin shutdown. No prompt/provider request or live MCP connection is used.
- Synthetic direct/deferred/codemode tools register inactive, so activation defaults cannot mask restoration. The direct case does not imply that ordinary auto-active direct MCP tools all fail.
- There is no exact host-version gate in these tests. Diagnostics report the version and test behavior instead.
- Local parity cannot prove pending-name preservation when the host never seeds those names; `tool-activation.test.ts` covers the separate positive local preservation contract.

## `sdk-resume.diagnostic.ts`

Requires the selected transcript declarations to restore through late registration in ordinary SDK construction and actual CLI `--session`, each with and without local extensions. These positive acceptance checks fail on the tested Pi 1.0.3 and print selected versus active loadouts. They are excluded from normal contract discovery only by the explicit `.diagnostic.ts` convention, not skips or weakened assertions. Run `npm run diagnose:pi-host` after upgrades; a verified fix should be promoted into the normal suite. TDR closure additionally requires the selection-precedence and safety checks listed in the owning record.
