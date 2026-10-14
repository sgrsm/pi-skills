# Pi 1.1.0 → 1.2.0: compatibility

## Assessment context

- **Run:** `20261015-000127`, 2026-10-15 00:01:27 CEST (UTC+02:00).
- **Versions:** requested baseline **1.1.0**, requested target **1.2.0**; installed selector and executed CLI **1.2.0**.
- **Baseline provenance:** explicit user-supplied upgrade interval, corroborated by installed 1.1.0 packages and version-bound maintenance/TDR evidence. No inferred upgrade history.
- **Repository:** `main`, HEAD `21f23bd66afe9e1efbbec9d126ced49c83638e94`; initially clean, one commit ahead of upstream.
- **Overall status:** **Partial assurance:** the bounded offline/source assessment and documented checks were executed, but the target verification gate is not green and extended/live acceptance remains unverified.
- **Category status:** assessed across all discovered runtime extensions and shared infrastructure; two confirmed validation-adapter incompatibilities require follow-up. No production-extension regression demonstrated within the checked scope.
- **Sibling reports:** [Simplification and debt](02-simplification-and-debt.md) · [API opportunities](03-api-opportunities.md).

> **Post-audit follow-up:** C1 has been verified and addressed in the repository; see [C1 follow-up resolution](#c1-follow-up-resolution). C2 remains open. The original assessment and validation record below describe the audit run and are retained as historical evidence.

## Executive result

Two upgrade-related compatibility findings affect the **validation code**, not a demonstrated production workflow regression:

1. **C1, P1:** structured-prompt fixtures still call the old three-argument `ExtensionRunner.emitBeforeAgentStart()` API. This blocks TypeScript and prevents those tests from invoking any extension handler.
2. **C2, P2:** the focused-overlay wheel control assumes a raw-input fallback intentionally removed in Pi 1.2.0.

The five stale host-package symlinks were corrected only after separate user approval. No extension source, tests, configuration, TDRs, dependencies, or installed host code were remediated. The full runtime suite was executed independently after the combined gate stopped at TypeScript: **702 tests, 686 pass, 16 fail, no cancellation/skip/TODO**. The failures are accounted for below. All 12 runtime extensions loaded through the target's public loader without errors in isolated configuration.

Outstanding clarify and SDK/CLI-resume diagnostics still fail. These are unchanged debt, not additional upgrade findings; see the [TDR dispositions](02-simplification-and-debt.md#every-tdr-disposition).

## Required compatibility follow-up

### C1 — P1: update structured-prompt test calls to the new trigger API

**Affected:** [structured-prompt.test.ts](../../agent/extensions/pi-compatibility/structured-prompt.test.ts), calls at lines 45 and 119; validation for clarify, permissions, and subagent prompt contributions.

**Pi change and causality:** 1.1.0 declares `emitBeforeAgentStart(prompt, images, systemPromptOptions)`; 1.2.0 declares `emitBeforeAgentStart(trigger, systemPromptOptions)`. The trigger is a discriminated user/custom union. Installed `dist/core/extensions/runner.d.ts` moves from the three-argument declaration at baseline line 194 to the two-argument declaration at target line 196; `runner.js`, `emitBeforeAgentStart`, confirms the corresponding implementation. This is part of the released [custom-run lifecycle change](https://github.com/earendil-works/pi/pull/10739), not an inferred cause from a failed target test alone.

**Observed impact:** `npm run verify` reports exactly two `TS2554: Expected 2 arguments, but got 3` errors. Direct runtime tests pass `undefined` as the new options argument and fail in `normalizeBuildSystemPromptOptions()` while reading `customPrompt`, before extension handlers execute. The 16 reported full-suite failures comprise this test, 13 nested structured-prompt cases, their aggregate parent, and the separate C2 wheel failure. There are not 16 independent runtime defects.

**Recommended bounded fix:** change both calls to, for example:

```ts
runner.emitBeforeAgentStart(
  { messageType: "user", prompt: "Synthetic prompt" },
  options,
);
```

Parameterize the helper with a typed trigger and add a synthetic custom-message case. Verify owned sections, unrelated and late sections, repeat/reload behavior, no forced prompt replacement, cancellation/failure cleanup, and no `prompt` assumption on custom events. Use an inline trigger or `Parameters<ExtensionRunner["emitBeforeAgentStart"]>[0]`; the trigger alias is not re-exported from the package root. Update the owning compatibility coverage notes if scope changes.

**Alternatives:** a public SDK/sendMessage fixture would additionally test actual custom-run scheduling and busy-start behavior, but costs more setup. Prefer the direct-runner repair for the existing matrix, followed by one bounded SDK case if maintaining end-to-end custom-trigger coverage. A cross-version adapter is unnecessary unless support for both hosts is an explicit requirement. Do not remove cases or weaken assertions to make the gate green.

**Validation:** source comparison and both TypeScript/runtime failures confirm causality. A separate scratch-only public-runner probe successfully invoked the actual local handlers with both target event variants and retained all three owned sections plus an unrelated section, with no handler errors or forced replacement. That smaller probe does **not** replace the failed durable matrix or demonstrate `pi.sendMessage(..., { triggerTurn: true })` scheduling through `AgentSession`.

**Confidence:** high. This is test-call-site drift; no required change was identified in the three production handlers, which consume `systemPromptOptions`, not `prompt`/`images`.

#### C1 follow-up resolution

**Status: addressed.** Both call sites now use Pi 1.2.0's two-argument API, with the trigger type derived from `Parameters<ExtensionRunner["emitBeforeAgentStart"]>[0]`. The existing matrix runs for both user and synthetic custom-message triggers, with an observed-event assertion that custom triggers carry their message and no user-only fields. Alternating triggers on one runner preserve reused sections. Scratch preparation failure and shutdown cancellation are checked for both variants; the existing section ownership, late contributions, reload, policy, and deliberate full-prompt replacement assertions remain intact. Production extension handlers and installed host code were not changed.

The direct-runner repair was selected over a cross-version adapter or SDK scheduling fixture: this repository validates its selected host, and the existing matrix tests event/section composition rather than end-to-end run scheduling. Owning coverage and maintenance notes now describe both variants and explicitly exclude `AgentSession` scheduling, busy-start races, and queued delivery.

**Follow-up validation on Pi 1.2.0:** the original two TS2554 errors and all 15 structured-prompt failures were reproduced before the repair. Afterward, the focused suite passed **34/34**, and `npm run typecheck` passed against verified 1.2.0 host links. `npm run verify` reached the full runtime suite: **721 tests, 720 pass, one failure**, exclusively the unchanged C2 focused-overlay wheel control. Unchanged positive host diagnostics were also rerun: all **11** still fail under TDR-1201/TDR-1202. No skipped/cancelled/TODO tests, green full-gate claim, or host-debt resolution is implied.

### C2 — P2: replace the obsolete overlay raw-wheel control

**Affected:** [clarify-input.test.ts](../../agent/extensions/pi-compatibility/clarify-input.test.ts), wheel case in the focused custom-overlay control (around lines 53–67); [clarifyUiFixture.ts](../../agent/extensions/pi-compatibility/clarifyUiFixture.ts); owning [coverage notes](../../agent/extensions/pi-compatibility/host-contract-coverage.md#clarify-inputtestts-and-clarify-inputdiagnosticts).

**Pi change:** 1.2.0 intentionally fixes [focused overlays blocking transcript wheel scrolling](https://github.com/earendil-works/pi/issues/10769). In baseline `pi-tui/dist/tui-alt-screen.js`, an unhandled wheel is deferred to the focused overlay's raw `handleInput()`. Target `handleViewportInput()` instead sends an unhandled wheel to `routeWheel()`. Keyboard deferral remains. The [target TUI contract](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/tui.md#handle-mouse-input) specifies normalized mouse handling and nearest-ScrollView fallback.

**Observed impact:** the target suite fails only the wheel member of that overlay-control loop. A bounded baseline/target renderer probe, with input positioned inside the rendered overlay bounds, observed:

| Probe | 1.1.0 | 1.2.0 |
| --- | --- | --- |
| Overlay has only raw input handler | Raw wheel delivered once; transcript stays at 30 | No raw wheel; transcript moves 30 → 33 |
| Overlay handles normalized wheel and returns `handled: true` | One normalized event; transcript stays at 30 | One normalized event; transcript stays at 30 |

The production Clarify selector uses the non-overlay dock, not this proposed-overlay presentation. Its outstanding dock wheel problem is independently reproduced by the positive diagnostic. This control failure is **not** evidence of a newly broken production selector or an unblocked overlay remedy.

**Recommended bounded fix:** retain the four keyboard overlay controls. Replace the wheel member with small, explicitly host-contract probes: normalized handling consumes the event without transcript movement; an unhandled wheel falls through to transcript scrolling on the selected target. Keep the unresolved production-dock acceptance check separate. Position synthetic mouse input using actual overlay bounds. Update the compatibility maintainer notes and qualify the TDR's historical raw-wheel workaround statement.

**Alternatives:** dropping only the stale wheel control is smaller but loses useful routing coverage. A test-only wrapper forwarding normalized events into Clarify's raw handler can work, but risks implying a production design or safe overlay remedy. Prefer independent probe components. Do not change the copied close adapter, add version-pinned success expectations, or migrate production Clarify to overlays as part of this validation repair.

**Validation/confidence:** high, confirmed by target failure, version-specific host source, baseline/target renderer measurements, and focused independent read-only review. Normalized `handleMouse()` already existed at baseline; it is not a newly introduced 1.2 API. The lifecycle blocker remains; see [TDR-1201](02-simplification-and-debt.md#every-tdr-disposition).

## Scope and activation inventory

Discovery used current filesystem entrypoints, resource-selection fields, package manifests, owning guides, and maintenance notes, excluding dependency/vendor trees. No disabled runtime entrypoint or explicit resource exclusion was found. Saved modes inspected were limited to non-sensitive activation fields: clarify/search have no override and default on; subagent is `auto`; hiding and short paths are on. Loader availability is not proof of every live UI workflow.

| Runtime extension | Activation / current purpose | Target evidence and remaining limits |
| --- | --- | --- |
| [clarify](../../agent/extensions/clarify/README.md) | Loaded; on by default; model-only questions/custom answers | Loader, local tests, FIFO/cancellation, mode guards and event-variant probe. C1/C2 affect controls; fullscreen debt remains. No live terminal acceptance. |
| [permissions](../../agent/extensions/permissions/README.md) | Loaded; default ordinary guards plus always-on P0; owns Bash and supplies scratch | Guard/path/dialog/scratch and cross-extension tests passed. Custom/MCP effects remain outside policy. C1 blocks the durable prompt matrix, not guard execution. |
| [subagent](../../agent/extensions/subagent/README.md) | Loaded; saved auto policy; child-only escalation remains scoped | Policy, trust, child/process/accounting, exposure/activation and offline CLI controls passed. No live child-provider/MCP acceptance; transient trust debt remains. |
| [git-inspect](../../agent/extensions/git-inspect/README.md) | Loaded; fixed read-only Git operations | Operation, bounds, renderer and metadata tests passed. Host metadata inspected passively; no arbitrary Git commands or mutations used. |
| [web-search](../../agent/extensions/web-search/README.md) | Loaded; defaults on; SearXNG tool | Local schema/availability/truncation tests passed. Research query returned no search results; this was not a search-service acceptance test. |
| [handoff](../../agent/extensions/handoff/README.md) | Loaded commands; persistent handoff/continuation workflow | File/context/summary tests passed; public serializer baseline/target probe confirms thinking omission. No live nested model summary. |
| [codex-verbosity](../../agent/extensions/codex-verbosity/README.md) | Loaded hook/command; only supported direct legacy requests are modified | Conservative-selection tests passed; provider-event/SDK/adapter comparison supports unchanged identity limitation. No credentialed request. |
| [mcp-status](../../agent/extensions/mcp-status/README.md) | Loaded footer producer when effective config has displayable servers | Projection/trust/state tests passed. Reads config, not MCP resource-list JSON; 1.2 resource-count change does not affect it. No live connection or dashboard test. |
| [response-timer](../../agent/extensions/response-timer/README.md) | Loaded lifecycle/footer producer | Timer tests passed; event hook tolerates both variants. New codemode-row timing is not response-total timing. No live footer acceptance. |
| [trash-history](../../agent/extensions/trash-history/README.md) | Loaded command; age-filtered Trash/archive workflow | Fixture-based scope/revalidation/archive/confirmation tests passed. No actual Trash/personal sessions. All-projects policy remains unselected. |
| [hide-tool-output](../../agent/extensions/hide-tool-output/README.md) | Loaded; saved hiding on; renderer wrappers | Wrapper/render strategy, actual host row and selection/resize controls passed. Preserve permissions' Bash ownership and short-path integration. No live terminal smoke test. |
| [short-paths](../../agent/extensions/short-paths/README.md) | Loaded; saved shortening on | Separate-loader order/reload/bus, host row reuse, narrow/wide rendering and native parity controls passed. Edit-preview filesystem/live terminal coverage remains outside these fixtures. |

**Shared infrastructure, separately assessed:** [dialog queue/UI/harness, footer helpers and tool availability](../../agent/extensions/shared/README.md); [host dependency resolution](../../agent/extensions/pi-host-deps/README.md); package/TypeScript scripts; and all [pi-compatibility coverage](../../agent/extensions/pi-compatibility/README.md), including loader/wrapped-builtins, structured prompts, model-only real codemode, CLI selection, SDK resume and UI guards. Only permissions and clarify participate in the shared FIFO. The availability helper still preserves pending names but cannot seed names omitted by host resume construction.

## Canonical validation record

### Environment and authorized setup

- Repository root verified from the skill's location as `/Users/sergey/.pi`, with `agent/extensions/` and `tdr/` present.
- Launcher: `/Users/sergey/.pi/agent/bin/pi`; managed selector `agent/install/current-version` reads `1.2.0`; `pi --version` prints `1.2.0`.
- Target host (`HOST`): `/Users/sergey/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent`. Baseline comparison imports used the corresponding `1.1.0` tree without switching the active installation. Current-session codemode declarations also exhibit target constraint annotations; no contradictory stale-runtime evidence was found.
- Node `v22.19.0`, npm `11.21.0`, TypeScript `6.0.3`, Darwin `25.6.0 arm64`. Node meets the target's `>=22.19.0` requirement.
- Initially all five peer links resolved to 1.1.0, correctly rejected by `check:pi-host-deps` with the explicit target override. **The user separately approved refreshing only these links and preparing test scratch.** `sync:pi-host-deps` then linked coding-agent, agent-core, ai and tui to target 1.2.0, and typebox to target-tree `1.3.27`; the non-mutating check passed. No dependency installation occurred; no nested extension-owned host tree was found.
- Scratch was a new canonical child beneath this session's approved Pi scratch, not the managed session root. It was current-user-owned, real, private `0700`, with a caller-created real `0600` `.step1-test-root-ready` marker. `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR` both selected that child; fixture safety checks passed. The managed root was not chmodded, renamed, or removed.
- All validation subprocesses used `PI_HOST_PACKAGE_ROOT="$HOST"`. Fixtures isolated agent config, HOME where required, and disposable/in-memory sessions. Offline CLI/SDK fixtures used isolated environments with no model network; the retained CLI startup fixture uses only a deliberately invalid, non-persistent placeholder key. No personal transcript, usable/personal credentials, provider requests, live MCP, real Trash, or downloaded executable code was used as a fixture.

### Executed checks and results

Commands below ran from `agent/extensions/` with the environment above. Scratch-only source/probe artifacts were not committed or used to patch the target.

| Check | Result | Evidence strength / interpretation |
| --- | --- | --- |
| `pi --version`, selector/package metadata, package-link inspection | Target 1.2.0; initial links stale | Reproducible installed/CLI evidence, not a claim that prior reports were a green full baseline. |
| `npm run check:pi-host-deps` before approved setup | Exit 1; five target mismatches | Prevented accidental 1.1 validation. |
| Approved `npm run sync:pi-host-deps`, then `npm run check:pi-host-deps` | Exit 0; all five verified | Authorized setup only; source/configuration untouched. |
| `npm run verify` | Exit 2 in TypeScript; two TS2554 errors | Full documented gate attempted. It did not reach its test stage; C1 is the blocker. |
| Independent `npm test` | Exit 1; 702 tests, 686 pass, 16 fail | Complete documented normal test discovery ran despite the typecheck failure. Failure accounting is C1 (14 leaf failures plus aggregate parent) and C2 (one wheel control). No unrelated failure backlog inferred. |
| `npm run diagnose:pi-host` | Exit 1; all 11 positive requirements fail | Seven clarify requirements and four SDK/actual-CLI restoration cases remain unmet. These are not new upgrade findings or successful acceptance. |
| Version-checked actual `showExtensionCustom()` scratch probe on 1.1.0 and 1.2.0 | Same lifecycle observations on both | Private method imported only in scratch; public fake-terminal TuiAltScreen state, no interactive session. Normal completion removes owned overlay, restores editor focus, disposes once. Stacked search is removed instead of the owned dialog; pre-install completion removes an unrelated overlay. See below. |
| Baseline/target public-renderer wheel probes | Changed fallback; normalized handling works on both | Confirms C2 with pointer within actual overlay bounds; not live terminal evidence. |
| Baseline/target public `serializeConversation()` probe | 1.1 includes synthetic thinking; 1.2 omits it; both retain visible answer | Demonstrated already-consumed handoff benefit, not a model-summary quality measurement. |
| Target public `discoverAndLoadExtensions()` on all dynamically discovered runtime entrypoints | 12 loaded, zero errors | Isolated config; factory-loading smoke check, not every command's acceptance. |
| Target public runner, actual clarify/permissions/subagent/response-timer registrations, synthetic user and custom triggers | Both variants completed without handler errors; all owned sections plus unrelated section retained; no forced replacement | Bounded direct-event evidence. The failed durable structured-prompt matrix and full AgentSession scheduling remain unverified. |
| Passive real-codemode `describeTool("git_inspect")` / web-search catalog inspection | Target integer/range/maxItems annotations visible for Git Inspect | No tool execution, provider/MCP operation, or personal transcript inspection. See [API report](03-api-opportunities.md). |

**Positive diagnostic detail:** PageDown leaves question position 1 while transcript moves 30 → 31; PageUp leaves question position 40 while transcript moves 30 → 29; wheel leaves question position 1 while transcript moves 30 → 33. Regular-mode mouse ownership, 80×24 help visibility and the two copied-adapter lifecycle requirements also fail. SDK and actual CLI resume, with and without local extensions, select `read` plus three synthetic late tools in the transcript but expose `read,bash,edit,write` after registration. Working tree/navigation, indirect-callability and local-withdrawal controls passed separately.

**Actual-host lifecycle detail:** on both versions normal completion leaves no owned overlay and disposes once; stacked-search completion leaves the disposed owned overlay mounted, does not preserve search focus, and disposes once. Completion synchronously inside the factory or in its pre-install microtask removes an unrelated overlay; the never-installed component is not disposed by the raw host (zero calls). The observational probe's exit 0 means measurement completed, **not** that positive lifecycle acceptance passed. This independently corroborates the adapter and prevents declaring TDR-1201 resolved from copied test logic.

### Gaps and next bounded checks

1. After separately authorized C1/C2 repairs, rerun the complete `npm run verify` and unchanged positive diagnostics. No claim of a green target gate is made here.
2. The direct-event probe does not exercise actual custom-trigger startup, queued `nextTurn` delivery, busy-state races, abort during startup, or prompt stability after a model/tool step. A synthetic offline/fake-adapter SDK test is the next bounded step, not a live provider call.
3. No live TUI/Ghostty/dashboard, real external editor, live MCP/OAuth/provider, or genuine model-backed handoff/subagent workflow acceptance was attempted. Fake-terminal wheel injection is not terminal-driver/trackpad evidence. No new authorization is implied by this report.
4. Extended TDR closure checks remain outstanding: clarify resize/layout and teardown matrix, resume/fork/continue/switch and restrictive-selection precedence, transient child trust, effective storage policy, physical provider identity, and arbitrated custom-dialog status. Their current dispositions do not require pretending these acceptance checks passed.
5. Source inspection and tests are bounded evidence, not a blanket compatibility guarantee.

## Research and attribution limits

The installed package identifies **earendil-works/pi** as canonical upstream. The official release API and installed changelog agree that the only release after baseline through target is **1.2.0** (release published 2026-10-12); the queried release list also showed 1.2.0 as latest stable. No newer/main-only proposal was substituted for target behavior.

Primary external sources: [v1.2.0 release notes](https://github.com/earendil-works/pi/releases/tag/v1.2.0), [official release API](https://api.github.com/repos/earendil-works/pi/releases/tags/v1.2.0), [release list](https://api.github.com/repos/earendil-works/pi/releases?per_page=12), [v1.2.0 extension contracts](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/extensions.md), [v1.2.0 TUI contracts](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/tui.md). Web search returned no matching release results; direct official HTTP retrieval succeeded, so this did not leave a release-notes research gap.

Three read-only user-scoped scouts covered disjoint extension clusters and assigned all six TDRs; a focused reviewer challenged wheel/lifecycle causality, status ownership and test-call drift. Parent execution and source comparisons reconciled their findings. In particular, initial source screening missed C1, which the full gate exposed; no scout's source-only result was promoted to runtime proof. No historical audit directory existed to supply a completed report baseline; maintenance/TDR history retains only its stated scope.

**Final mutation boundary:** only separately approved peer-link refresh, approved scratch/test artifacts, and the three reports were written. Source, durable tests, TDRs, settings, installed packages, Git history/index and user data were not changed.
