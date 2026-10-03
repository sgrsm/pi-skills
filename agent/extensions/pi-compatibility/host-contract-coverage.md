# Host-contract coverage and limitations

Maintainer notes for the larger `pi-compatibility` tests. For the file index and commands, see the [README](./README.md). For the short-paths tests, see [short-paths loader coverage](./short-paths-loader.md).

Related integration rules are in [extension maintenance](../maintenance.md): [shared interactive dialogs](../maintenance.md#shared-interactive-dialogs), [structured prompt contributions](../maintenance.md#structured-prompt-contributions), and [tool availability at startup](../maintenance.md#tool-availability-at-startup).

## Conventions

- Prefer public Pi exports (`discoverAndLoadExtensions`, `ExtensionRunner`, `AgentSession`, `createAgentSession`, `SessionManager`, `ExtensionSelectorComponent`, pi-tui screens) over copied host logic. Do not commit private host imports or absolute installed-host paths.
- Tests that load extensions or create files need the [approved scratch setup](../permissions/README.md#safe-test-scratch-setup). Set both `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR` to the approved root; several tests assert that they match. Fixtures use isolated agent configuration and in-memory or disposable sessions, restore environment variables, and shut down and invalidate runtimes. They never use personal settings, session files, credentials, live providers, or live MCP servers.
- **Guarantees** are behavior the local extensions must keep. **Characterizations** record an existing host or local defect and pass while it persists. A passing characterization is not evidence that the defect is fixed or intended; revisit it whenever the related code or Pi changes.

## `trash-confirmation.test.ts`

Protects safe, visible Trash approval at fullscreen sizes.

- Uses the public `ExtensionSelectorComponent` and pi-tui with a fake terminal. The fixed-dock layout is a manual copy of Pi 1.0's `chat-viewport` contract, including a three-line footer; compare it with the host layout after upgrades.
- A legacy full-report control reproduces clipped choices, which shows that the fixture really exercises fullscreen clipping.
- Both choices and the navigation help must remain visible at 80×24, 40×24, and 30×24, with a large preview and long paths.
- Initial Enter selects Cancel, Escape cancels exactly once without a selection, and approval requires navigating to the affirmative choice.

## `clarify-input.test.ts` (characterization)

Records existing fullscreen input and dialog-lifecycle defects; see the [host-blocker record](../../../tdr/0003-clarify-fullscreen-input-host-blocker.md). Clarify's fullscreen blocker remains **open**: there is no local runtime fix and no host patch.

- Uses public `TuiAltScreen`/`TuiMainScreen` with fake terminal input and buffers, a simplified fixed-dock composition, and a local model of `custom()` installation and completion.
- Reproduces fullscreen PageUp/PageDown/Home/End/wheel interception by the transcript, bottom-help clipping, and clarify's mouse-mode writes. Regular-mode keyboard selection/scrolling and raw-SGR wheel handling are controls. Fullscreen captures also confirm that host tracking was enabled before clarify's own writes.
- The overlay wheel control covers the host's raw-SGR fallback only, not normalized mouse support in the unchanged selector.
- A **test-only** custom-overlay adapter shows that focused overlay routing restores input. It then reproduces the cancellation blockers: a stacked transcript search is popped instead of the owned dialog, and cancellation before installation can pop an unrelated overlay.
- The record describes the supplementary version-checked probe of the host close path and how to reconstruct it.

The local custom-dialog model cannot detect an identity-safe completion change in Pi. After a Pi upgrade or any clarify fullscreen change, compare it with the host `showExtensionCustom()` close path and reconstruct the optional probe.

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

## `sdk-resume.test.ts` (characterization plus controls)

Exercises SDK/CLI resume with the local startup fix, and records the separate **open** [host defect](../../../tdr/0004-sdk-cli-resume-tool-restoration-host-defect.md). On the tested Pi 1.0.0, SDK and CLI session creation omit the selected late tool declarations even without local extensions. This stays broken independently of the local fix; no host patch or local workaround exists.

- A no-local-extension baseline reproduces the omission after reopening a real disposable JSONL transcript with `SessionManager.open()`. Every local off-mode/relay combination keeps the same baseline and has correct local availability.
- The real package-declared CLI binary runs with `--session` in offline RPC mode, comparing baseline and local-all-off startup. Children get isolated agent configuration and HOME, an allowlisted environment without inherited provider keys, bounded output and timeouts, and orderly stdin shutdown. No prompt or provider request is sent.
- Synthetic direct/deferred/codemode tools register inactive, so default activation cannot mask missing restoration. Registered names/exposures and indirect callability are checked. A positive `/tree` control shows that the same persisted fixture is restorable through that path; it does not show that SDK/CLI creation works. The direct case does not imply that ordinary auto-active direct MCP tools all fail.
- The test asserts the Pi version. After an upgrade, re-evaluate the expectations against the record's positive restoration criteria instead of preserving the omission or skipping the check.
- Parity of local off modes with the baseline cannot prove pending-name preservation where the host never seeded names; `tool-activation.test.ts` covers that separately.
