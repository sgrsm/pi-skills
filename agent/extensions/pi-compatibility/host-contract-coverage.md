# Host-contract coverage and limitations

Maintainer notes for the larger `pi-compatibility` tests. For the file index and commands, see the [README](./README.md). For the short-paths tests, see [short-paths loader coverage](./short-paths-loader.md).

Related integration rules are in [extension maintenance](../maintenance.md): [shared interactive dialogs](../maintenance.md#shared-interactive-dialogs), [structured prompt contributions](../maintenance.md#structured-prompt-contributions), and [tool availability at startup](../maintenance.md#tool-availability-at-startup).

## Conventions

- Prefer public Pi exports (`discoverAndLoadExtensions`, `ExtensionRunner`, `AgentSession`, `createAgentSession`, `SessionManager`, `ExtensionSelectorComponent`, pi-tui screens) over copied host logic. Do not commit private host imports or absolute installed-host paths.
- Tests that load extensions or create files need the [approved scratch setup](../permissions/README.md#safe-test-scratch-setup). Set both `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR` to the approved root; several tests assert that they match. Fixtures use isolated agent configuration and in-memory or disposable sessions, restore environment variables, and shut down and invalidate runtimes. They never use personal settings, session files, credentials, live providers, or live MCP servers.
- **Contract regressions** protect working behavior and local safety invariants in `*.test.ts`. **Outstanding host acceptance checks** live in `*.diagnostic.ts` and run explicitly through `npm run diagnose:pi-host`; they assert desired behavior and fail nonzero while tracked debt remains. They are neither skipped nor TODOs. A green contract gate is not evidence that host debt is fixed. Revalidate diagnostics and any copied host adapters on upgrades, and promote verified fixes into the normal suite.

## Pi 1.1.0 revalidation

Runtime contract checks and public loading of all local runtime extensions succeeded using Pi 1.1.0 host packages and isolated configuration. Keep extension verification separate from resolution of host debt:

- **Verification gate:** the fake terminals in `clarifyUiFixture.ts` and `trash-confirmation.test.ts` implement the required `Terminal.setProgramStatus()` method as a no-op. This satisfies the host interface without testing OSC 7501 reporting. Verify host-package links before running checks so direct imports and declarations come from the host version under review. `npm run verify` checks host links, TypeScript, and normal contract tests, not outstanding host acceptance diagnostics.
- **Clarify:** working fullscreen mouse-ownership and Home/End controls remain intact; positive PageUp/PageDown/wheel, regular-mode mouse-ownership and help-visibility requirements still fail. A separate version-checked invocation of the actual Pi 1.1.0 `showExtensionCustom()` method also reproduced removal of stacked search while leaving the disposed owned overlay mounted, and removal of an unrelated overlay on completion before installation. Normal mounted completion removed the owned overlay and disposed it once. This corroborates the adapter; it does not unblock the overlay remediation.
- **Resume:** positive SDK and actual CLI `--session` restoration checks still fail with and without local extensions. Working `/tree`, indirect-callability and local-availability controls remain separate from creation-time restoration.

Live-terminal, live MCP and live provider compatibility were not tested. The earlier Pi 1.0.0/1.0.3 investigation baselines below and in the [owning TDRs](../../../tdr/README.md) are retained; passing characterization tests is not a guarantee or a debt resolution.

## `trash-confirmation.test.ts`

Protects safe, visible Trash approval at fullscreen sizes.

- Uses the public `ExtensionSelectorComponent` and pi-tui with a fake terminal. The fixed-dock layout is a manual copy of Pi 1.0's `chat-viewport` contract, including a three-line footer; compare it with the host layout after upgrades.
- A legacy full-report control reproduces clipped choices, which shows that the fixture really exercises fullscreen clipping.
- Both choices and the navigation help must remain visible at 80×24, 40×24, and 30×24, with a large preview and long paths.
- Initial Enter selects Cancel, Escape cancels exactly once without a selection, and approval requires navigating to the affirmative choice.

## `clarify-input.test.ts` and `clarify-input.diagnostic.ts`

Protect working routes and test outstanding requirements separately; see [TDR-20261009-1201](../../../tdr/20261009-1201-clarify-fullscreen-input-host-blocker.md). Fullscreen mouse-mode ownership is corrected locally, and Home/End routing works on the tested Pi 1.0.3 and revalidated Pi 1.1.0/1.2.0. Question PageUp/PageDown/wheel routing, regular-mode mouse ownership and help clipping remain **open** on Pi 1.3.0. That release fixes the host overlay-ownership prerequisite, not the local selector. The copied overlay close adapter now mirrors identity-specific completion after comparison with the actual 1.3 host. No installed-host patch or production overlay redesign is included.

- `clarifyUiFixture.ts` shares public `TuiAltScreen`/`TuiMainScreen` fake-terminal fixtures, the simplified fixed-dock composition, and the test-only `custom()` adapter.
- Normal contract tests require fullscreen creation, selection, Escape, and abort to leave host mouse modes untouched, restore editor focus, and retain post-dialog wheel routing. They also protect Home/End question scrolling, regular-mode interaction/setup/cleanup, and the four focused-overlay keyboard routes (PageUp/PageDown/Home/End).
- Independent wheel probes mount small components with public `showOverlay()`, render them, and derive SGR pointer coordinates from the actual overlay bounds. They verify normalized event coordinates/deltas, consumption without transcript movement, and transcript fallback when a normalized handler declines the event or is absent. None may receive raw wheel input. The probes bypass the copied custom-dialog completion adapter and do not demonstrate a safe production overlay design.
- Pi 1.2.0 intentionally removed the earlier focused-overlay raw-SGR wheel fallback. Normalized `handleMouse()` consumption predates that release; the old wheel control was a baseline-specific routing observation, not a current remedy for Clarify.
- Diagnostics require PageUp/PageDown/wheel to scroll the question, help to remain visible, and regular mode to leave mouse modes alone. These remaining positive requirements fail on Pi 1.0.3, Pi 1.1.0, and Pi 1.2.0; the scoped fix preserves regular-mode behavior without weakening its outstanding acceptance requirement.
- Normal adapter lifecycle regressions require owned-dialog removal without stealing stacked search or an unrelated overlay on pre-install cancellation. Additional controls cover normal exactly-once completion, synchronous/microtask early completion and exactly-once local-wrapper pre-install disposal, including unrelated focus preservation. Production Clarify stays in the non-overlay dock; its wheel acceptance check and the shared `scrollingInputs` wheel fixture remain unchanged.
- A separate scratch-only, version-checked invocation of the actual Pi 1.0.3 `showExtensionCustom()` method confirmed the stacked-search and pre-install failures, including completion inside the factory; normal mounted completion was a positive control. The TDR retains reconstruction steps, not private committed imports.

The adapter hard-codes completion behavior and cannot independently detect a host regression. A version-checked actual-host probe on Pi 1.3 verified normal completion, stacked search, synchronous/microtask completion and local-wrapper pre-install abort; raw never-installed components are not disposed by the host, so the wrapper remains required. After an upgrade, inspect the actual close path and reconstruct the real-method probe before changing adapter expectations or declaring the lifecycle fixed. Mouse-write assertions check ownership; injected wheel events check renderer routing, not Ghostty's wheel-to-arrow fallback. Live-terminal confirmation covers macOS/Ghostty trackpad scrolling after normal option selection only; Escape, abort, and other terminal/input combinations remain unverified live.

## `dialog-concurrency.test.ts`

Protects shared scheduling for permissions and clarify.

- Fake dialogs check that each selector/custom-instructions exchange keeps the FIFO until it completes.
- The public loader loads the extensions as separate module/API instances in both registration orders, then covers shutdown/invalidation and fresh instances on the same event bus.
- Clarify state comes from a scratch wrapper, not personal settings.

Subagent approval/escalation, handoff, and Trash confirmation are not enrolled in this queue and are not covered by its scheduling guarantee.

## `structured-prompt.test.ts`

Protects additive structured prompt contributions. See [structured prompt contributions](../maintenance.md#structured-prompt-contributions) for the contract.

- Uses the public loader and `ExtensionRunner.emitBeforeAgentStart(trigger, options)`, an in-memory `SessionManager`, a fake UI/theme, and synthetic late contributors that stand in for MCP/other extensions. The trigger type is derived from the public runner method. The last handler reads `event.systemPrompt` through the real host renderer, not a copied prompt builder, and reports the received trigger so custom events must carry their message without user-only `prompt`/`images` fields.
- Asserts that local handlers leave `forceSystemPrompt` unset; their owned sections keep guidance, unrelated sections, and late contributions without duplicates. Scratch must exist before it is advertised; preparation failures and shutdown during preparation are reported through the host and remove stale scratch guidance for both trigger variants. Test scratch creation stays inside a disposable fixture through a scoped, restored test `TMPDIR`.
- Runs the same matrix for user and custom-message triggers: repeated/reused options, alternating trigger variants on one runner, no-UI mode, inactive tools and saved off modes, manual/ask/auto policies, child-only escalation, session/write approvals, inherited read-only and broad approval, depth caps, new session ids on one runtime, fresh-loader reload with the same session id, and deliberate whole-prompt overrides before and after the local handlers.
- The runner's returned `messages` contains handler contributions, not the starting custom message; local section-only handlers leave it empty. Direct runner calls do not exercise `AgentSession` scheduling via `pi.sendMessage(..., { triggerTurn: true })`, busy-start races, or queued delivery. The fixture does not measure provider cache behavior and uses no MCP connections or model requests.

## `tool-activation.test.ts`

Protects optional-tool availability without losing restored tools. See [tool availability at startup](../maintenance.md#tool-availability-at-startup).

- Uses the public loader, SDK tool selection, `AgentSession`, and in-memory sessions. Late synthetic direct, deferred, and codemode tools register **inactive**, so later activation proves restoration rather than a registration default.
- Covers every combination of saved clarify/search/delegation off modes, top-level/child relay, and independently varied registration order, in constructor transcript restoration and in actual reload and fresh runtimes. Public `/tree` restoration is covered with delegation off or depth-capped.
- Also covers manual/ask/auto policies, fresh and reloaded depth caps, changed saved state, explicit persisted toggles, active and callable sets for available and withdrawn tools, model-only nested-call rejection, direct child escalation, unrelated session tool choices, `defaultTools`, `+codemode`, allowlists/exclusions (including late restoration), and no-tools options.
- The codemode placeholder checks selection only, not the real sandbox or loadout renderer. The constructor-restoration case constructs `AgentSession` directly, omits `initialActiveToolNames` and sets `usesDefaultTools: true`, which is the host's restoration request since Pi 1.3; without that flag the transcript is not restored. It checks the direct-constructor restoration seam; `sdk-resume.test.ts` separately covers SDK resume, actual CLI resume/continue/fork and runtime switch/fork.

## `cli-tool-selection.test.ts`

Protects the documented difference between `--tools` modifiers and `--exclude-tools` through the host's public `parseArgs()` and a real offline CLI process.

- The parser checks cover modifier lists, modifier-plus-exclusion, plain allowlists, and the mixed modifier/plain-name shape that an unvalidated agent `+name` would produce after the launcher appends `escalate_to_parent`.
- Each process case starts the installed CLI in RPC mode with isolated configuration/HOME, an allowlisted credential-free environment, `--offline`, the real local clarify/web-search/subagent extensions, built-in codemode and a probe extension. It sends one reload slash command through RPC and compares active tools at startup and reload. No model prompt, provider request or MCP server is used.
- Pins that `-clarify,-subagent,-web_search` modifiers leave those tools active, explicit exclusions remove them, plain allowlists replace defaults, and mixed lists fail at the CLI. These are host-behavior characterizations: a host change that makes modifiers withdraw extension tools would fail the first case and require revisiting the user guidance.
- Agent-frontmatter rejection itself is covered by `subagent/agents.test.ts`. This file does not run a delegated child.

## `model-only-codemode.test.ts`

Protects the direct-only invocation boundary for `clarify`, `subagent`, and `escalate_to_parent` with the real public `createCodemodeExtension()` in `on` and `only` modes.

- Loads the actual local workflow extensions with isolated saved state, an offline runtime, and an in-memory session. Checks model-only exposure, active/callable sets, model-facing descriptions and rendered guidance, and the agent's request projection. A callable `read` control remains declared in `on` and is hidden in `only`; workflow declarations remain visible in both.
- Runs catalog/property checks in the real QuickJS sandbox. Workflow names are absent from `ALL_TOOLS`, search and descriptions, and property access produces a missing-member error. A callable `read` discovery control remains available.
- Does not invoke nested tools, child processes, dialogs, providers or MCP servers. It does not validate nested delegation lifecycle/accounting or prove that models always follow the prompt guidance. Policy-section availability and no-UI fallback remain covered by `structured-prompt.test.ts`.

## `wrapped-builtins.test.ts`

Protects [built-in replacement configuration](../short-paths/maintenance.md#built-in-replacement-configuration).

- Public loader/SDK native controls cover defaults/modifiers, explicit/restrictive selection, exclusions, no-tools options, reload choices, callable sets and declaration metadata.
- Scratch PNG/text reads cover false/true/default settings, hiding, project overrides, immediate changes/reload, cwd, offsets/limits, cancellation, model context and complete result parity. Direct definitions prevent host post-result normalization from masking resize drift.
- Codemode is selection-only; SDK options exercise shared CLI selection, not a wrapper-enabled CLI subprocess. No live terminal/provider/MCP or positive SDK/CLI resume-restoration claim.

## `sdk-resume.test.ts`

Protects resumed tool-loadout restoration since Pi 1.3.0 through public SDK APIs and the actual bundled CLI. Earlier Pi 1.0.x/1.1.0 releases dropped the transcript's declarations at SDK/CLI construction; this file no longer preserves that omission and does not gate on a Pi version.

- `resumeFixture.ts` is the single shared fixture. It writes real disposable version-3 JSONL transcripts (system loadout, user entries never submitted to a model), reopens them with `SessionManager.open()` and registers synthetic direct/deferred/codemode late tools **inactive** on an explicit event, so an activation default cannot mask a restoration failure. Isolated agent directory, fake HOME, offline model runtime, allowlisted credential-free CLI environment and bounded child output/time apply throughout. The direct case does not imply that ordinary auto-active direct MCP tools were ever affected.
- **Creation-time restoration:** four positive cases (SDK and actual CLI `--session`, each host-only and with the local extensions saved off) require the active set after late registration to equal the recorded `read` plus the late tools. The CLI start reason is `startup` while the SDK fixture requests `resume`; both paths are executed separately.
- **Selection precedence:** one case table runs through the actual CLI and the public SDK. Modifiers apply to the restored names; a plain allowlist replaces the loadout; an allowlist entry beginning `mcp__` also filters MCP tools; exclusions win; `--no-tools` empties everything; settings `defaultTools` do not replace a restored transcript loadout while a plain allowlist beats them. Registration (excluded or filtered tools are not registered), startup selection parity between SDK and CLI, and callability are checked. **`--no-builtin-tools`:** this is an explicit selection mode and bypasses transcript restoration, including late extension declarations, as documented in the Pi 1.3.0 CHANGELOG entry for #10785. It does not prohibit registered extension tools in general.
- **Local startup policy**, phase-specific (declared at construction, after `session_start`, after late registration) for 16 saved-off/relay states plus depth-capped top-level/child states. With a transcript that does **not** select local tools, enabled `clarify`, `web_search` and `subagent` still add themselves in `session_start` (the documented saved-on policy); an eligible, unselected relay tool stays inactive. With a transcript that **does** select them, only eligible locals are active; withdrawn, depth-capped or relay-ineligible names are not resurrected. A depth cap is applied by the subagent `session_start` handler, so a recorded `subagent` is still declared between construction and `session_start`; normal host modes bind before prompting, and the execution depth guard remains authoritative even for SDK callers. Registered exposure (hidden when withdrawn), active declaration and nested callability (only available `web_search`) stay separate assertions. The CLI repeats the restrictive cases with recorded locals: exclusions, a plain allowlist, a depth cap, relay eligibility and all modes saved off.
- **Declaration versus callability:** deferred and codemode tools stay callable once registered whether or not they are declared; a direct tool is callable only when active. The tests assert this for restored, unselected, `/tree`, reload and runtime sessions.
- **Seams kept separate:** `/tree` navigation to three branches with distinct loadouts; `reload()` before and after late registration (pending names survive); actual CLI `--continue` with an isolated session directory, a deterministic newest session (explicit modification times), an older session with a different loadout and a newer foreign-project decoy; actual CLI `--fork` with a deterministic session ID; public `AgentSessionRuntime.switchSession()` and `fork()` (before/at positions, distinct branch loadouts), checking session identity, start reason, `previousSessionFile`, header lineage and that the source transcript is unchanged. Restrictive options are re-applied to runtime replacements. The runtime methods are the ones RPC `switch_session` and interactive resume/fork use, but this file does not execute the RPC protocol or the interactive picker. A Pi 1.3 tree characterization separately shows invocation modifiers are not re-applied on navigation, while exclusions remain enforced.
- **Not covered:** interactive `/resume`/`--resume` picker, RPC `switch_session` messages, cross-project session prompts, `--continue` against the default session directory, a CLI `/reload` of a resumed session, `tool_search`/codemode/MCP behavior (no real MCP server or built-in extensions), provider requests and real terminals. Characterization of host precedence is not a guarantee for other Pi versions; after an upgrade, read the host `sdk`/`agent-session` selection code and rerun the table before changing expectations.
- Off, depth-cap, relay, pending-name, load-order and restrictive-selection controls for the direct `AgentSession` constructor are in `tool-activation.test.ts`.
