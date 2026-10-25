# Host-contract coverage and limitations

Maintainer notes for the larger `pi-compatibility` tests. For the file index and commands, see the [README](./README.md). For the short-paths tests, see [short-paths loader coverage](./short-paths-loader.md).

Related integration rules are in [extension maintenance](../maintenance.md): [shared interactive dialogs](../maintenance.md#shared-interactive-dialogs), [structured prompt contributions](../maintenance.md#structured-prompt-contributions), and [tool availability at startup](../maintenance.md#tool-availability-at-startup).

## Conventions

- Prefer public Pi exports (`discoverAndLoadExtensions`, `ExtensionRunner`, `AgentSession`, `createAgentSession`, `SessionManager`, `ExtensionSelectorComponent`, pi-tui screens) over copied host logic. Do not commit private host imports or absolute installed-host paths.
- Tests that load extensions or create files need the [approved scratch setup](../permissions/README.md#safe-test-scratch-setup). Set both `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR` to the approved root; several tests assert that they match. Fixtures use isolated agent configuration and in-memory or disposable sessions, restore environment variables, and shut down and invalidate runtimes. They never use personal settings, session files, credentials, live providers, or live MCP servers.
- **Contract regressions** protect working behavior and local safety invariants in `*.test.ts`. Previously outstanding resume and Clarify positive requirements are now normal regressions, including actual CLI/public-host integration. No separate diagnostic files remain. A green gate is limited to the documented acceptance scope and does not resolve unrelated host debt; after upgrades compare copied adapters with the actual host and rerun independent integration controls.

## Pi 1.1.0 revalidation

Runtime contract checks and public loading of all local runtime extensions succeeded using Pi 1.1.0 host packages and isolated configuration. Keep extension verification separate from resolution of host debt:

- **Verification gate (Pi 1.1.0 historical result; positive requirements are now normal regressions):** the fake terminals in `clarifyUiFixture.ts` and `trash-confirmation.test.ts` implement the required `Terminal.setProgramStatus()` method as a no-op. This satisfies the host interface without testing OSC 7501 reporting. Verify host-package links before running checks so direct imports and declarations come from the host version under review. `npm run verify` checks host links, TypeScript, and normal contract tests, not outstanding host acceptance diagnostics.
- **Clarify (Pi 1.1.0 result, superseded by the Pi 1.3.0 overlay selector in [`clarify-input.test.ts`](#clarify-inputtestts-and-clarify-hosttestts)):** working fullscreen mouse-ownership and Home/End controls remained intact; positive PageUp/PageDown/wheel, regular-mode mouse-ownership and help-visibility requirements still failed. A separate version-checked invocation of the actual Pi 1.1.0 `showExtensionCustom()` method also reproduced removal of stacked search while leaving the disposed owned overlay mounted, and removal of an unrelated overlay on completion before installation. Normal mounted completion removed the owned overlay and disposed it once. This corroborates the adapter; it does not unblock the overlay remediation.
- **Resume (Pi 1.1.0 result, superseded by Pi 1.3.0 normal tests in [`sdk-resume.test.ts`](#sdk-resumetestts)):** positive SDK and actual CLI `--session` restoration checks still failed with and without local extensions. Working `/tree`, indirect-callability and local-availability controls remain separate from creation-time restoration.

Live-terminal, live MCP and live provider compatibility were not tested. The earlier Pi 1.0.0/1.0.3 investigation baselines below and in the [owning TDRs](../../../tdr/README.md) are retained; passing characterization tests is not a guarantee or a debt resolution.

## `trash-confirmation.test.ts`

Protects safe, visible Trash approval at fullscreen sizes.

- Uses the public `ExtensionSelectorComponent` and pi-tui with a fake terminal. The fixed-dock layout is a manual copy of Pi 1.0's `chat-viewport` contract, including a three-line footer; compare it with the host layout after upgrades.
- A legacy full-report control reproduces clipped choices, which shows that the fixture really exercises fullscreen clipping.
- Both choices and the navigation help must remain visible at 80×24, 40×24, and 30×24, with a large preview and long paths.
- Initial Enter selects Cancel, Escape cancels exactly once without a selection, and approval requires navigating to the affirmative choice.

## `clarify-input.test.ts` and `clarify-host.test.ts`

Protect Clarify's inline selector and answer editor; see [Clarify maintenance](../clarify/maintenance.md#docked-selector). Both use the normal editor slot below the transcript. Completion always goes through the host callback; normalized wheel events are consumed over the panel, and actions follow injected keybindings.

- `clarifyUiFixture.ts` shares public `TuiAltScreen`/`TuiMainScreen` resizable fake terminals, user keybindings, a transcript and fixed dock. Its test-only `custom()` adapter mirrors Pi 1.4's inline-dialog stack and identity-specific overlay close path. Screen bounds are located from rendered panel text, not a host layout inspection API; full-frame content comparisons check unclipped output at supported sizes.
- Input routing: fullscreen Ctrl+PageUp/PageDown, Home/End and wheel scroll the question. Plain fullscreen PageUp/PageDown scrolls the conversation instead. Regular mode keeps plain page keys. Remapped actions work. Wheel stays consumed at both question boundaries; wheel over the conversation remains available.
- Layout: `clarify/dock.test.ts` protects non-overlay presentation for both stages, conversation visibility and a compact height budget. The renderer matrix checks width/height safety with wide text, many choices, descriptions and resize. At ordinary sizes the composed screen contains the complete panel; tiny-terminal checks cover component output and screen width, not guaranteed dock visibility. Descriptions are marked when clipped. Readable question context takes priority over decoration.
- Lifecycle: selection/Escape/abort, queued/displayed cancellation, shutdown/reload, synchronous/microtask pre-install cancellation, fresh repeated interactions, late input/abort, exactly-once disposal, FIFO and the inline-selector → inline-editor exchange. RPC still uses basic dialogs. Independent overlay controls retain coverage of the shared helper's identity-specific close path.
- Pointer defaults: selector drags select its text, OSC 8 link clicks activate links, and neither completes the dialog. The fixture captures clipboard and URL operations rather than performing them. Independent overlay wheel probes exercise normalized coordinate/delta handling and transcript fallback without the adapter.
- Search opened before the exchange is restored afterward. Search or an unrelated overlay opened above a displayed inline panel can lose focus to the main editor when that panel closes; the overlay remains mounted. These are explicit host-limit characterizations, to revisit when Pi fixes editor-slot focus restoration.
- Answer editor: bounded natural height and cursor-preserving output, full composed content at supported sizes, resize, hints where space permits, bracketed paste with large-paste expansion, external-editor shortcut interception, Escape and draft restoration, wheel isolation. The shared helper's unbounded default, explicit inline layout, overlay and RPC paths are also covered in `../shared/dialogUi.test.ts`.
- `clarify-host.test.ts` independently runs real `InteractiveMode` in a bounded offline subprocess with an in-memory session and fake terminal, in fullscreen and regular mode. Public `ctx.ui.custom()` supplies the live TUI; `AgentSession.getToolDefinition()` supplies the real tool and context. Checks include the transcript above the panel, extra widgets, fullscreen transcript paging, question paging/wheel, resize, pointer selection, both editor stages, search-before restoration and search-above focus limitation, cancellation and queue ordering. No private host imports or members are used.

Limits:

- The height budget reserves room for ordinary chrome, not arbitrary widgets, pending messages or unusually large footers. Very short screens can clip the editor slot behind host chrome; enlarge the terminal. The answer editor may shorten away its question context; the complete question remains in the transcript. Click-to-position inside it is not forwarded.
- The real-host child disables copy-on-select and reads on-screen highlights; it does not open URLs. The fixture alone tests link activation with a capturing opener. Polling waits are bounded.
- Raw never-installed components are not disposed by the host, so `showCancellableCustom()` remains required. Host wheel non-leak checks compare the transcript before opening and after closing to avoid mistaking a changed viewport height for scrolling.
- Renderers are real but terminals are fake. Mouse-mode and injected-event assertions do not establish live trackpad behavior or terminal-specific key encoding. No current live-terminal validation is claimed.
- The copied adapter alone cannot detect host changes. After upgrades compare actual installation/completion, fullscreen dock and focus behavior and rerun the independent host test.

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

## `git-inspect-catalog.test.ts`

Protects that the model-facing codemode catalog presents `git_inspect` parameter limits.

- Loads the local `git-inspect` extension and the public `createCodemodeExtension()` in an isolated, offline, in-memory session, then runs `describeTool("git_inspect")` in the real sandbox. Asserts the `maxCount` (`@integer`, `@minimum 1`, `@maximum 100`) and `paths` (`@maxItems 20`) tags, and that the script made no nested tool calls. Failure messages include the sandbox output.
- Pins current host schema formatting, not a public API guarantee; revisit the regexes if a Pi upgrade changes the description format.
- Never invokes `git_inspect`, Git or a provider. Execution and result rendering are covered by `git-inspect/index.test.ts` and `git-inspect/rendering.test.ts`.

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
