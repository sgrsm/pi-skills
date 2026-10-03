# 0005: Preserve pending restored tools during extension startup

- **Status:** Resolved — local extension defect only
- **Resolution:** Confirmed and fixed on Pi 1.0.0 using public hidden withdrawal. SDK/CLI resume validation subsequently confirmed a separate host defect, tracked as Open in [TDR-0004](../tdr/0004-sdk-cli-resume-tool-restoration-host-defect.md).
- **Priority:** Medium; MCP impact latent while servers are disabled
- **Evidence:** Startup deactivation reproduced against actual host loadout method
- **Areas:** `subagent`, `clarify`, `web-search` — one change set
- **Instructions:** [Package workflow and validation](README.md)

## Problem and evidence

Pi preserves names of restored tools that have not reconnected yet. `HOST/dist/core/agent-session.js:1084-1092` clears these pending names when `setActiveToolsByName()` deactivates any currently active tool; add-only changes preserve them.

Local `direct`/`model-only` tools activate on registration. Startup then removes some:

- `subagent/index.ts:686-693, :2609`: `escalate_to_parent` is disabled in ordinary top-level sessions; subagents-off also removes `subagent`.
- `clarify/index.ts:487-495, :703-706`: persisted clarify-off.
- `web-search/index.ts:282-286, :400-405`: persisted search-off.

A probe seeded a synthetic pending MCP name and used the actual `AgentSession.prototype.setActiveToolsByName` contract. The real subagent startup handler removed `escalate_to_parent` and emptied the pending set. The other removal paths have the same cause.

## Reproduce / test first

**Committed regression:** extend `pi-compatibility` with registration plus startup/reload state. Use a public host session seam or a faithful loadout fake that drops pending names on subtraction. Seed pending synthetic MCP names; assert startup preserves them after the fix. Cover top-level/child escalation, subagents on/off, clarify on/off, search on/off, resume, and reload.

**Optional host probe:** run the same startup handlers against the actual host loadout method with synthetic pending state. Follow the README's test-seam policy instead of hard-coding private import paths.

Existing activation mocks simply track an array and cannot detect this host invariant. Use an isolated host session or faithful contract test, not a live MCP server.

## Recommended fix

- Register conditionally available tools with `defaultActive: false` where needed.
- Load persisted mode/parent-relay state early enough to choose activation deliberately.
- During `session_start`, only add eligible tools; do not register active tools just to subtract them.
- Keep explicit user commands allowed to deactivate tools: intentional user loadout changes may replace restoration.
- Preserve `model-only` exposure for clarify/subagent/escalation and ensure child `--tools` allowlists still permit escalation only where intended.
- Check restrictive CLI tool options and `defaultTools` precedence; avoid inadvertently resurrecting excluded tools.

## Acceptance criteria

- Pending restored MCP names survive startup and reload for all local off-mode combinations.
- Top-level escalation is neither declared nor callable; child relay behavior still works.
- Persisted off modes remain off; explicit toggles continue to work.
- Session tool choices, restrictive child allowlists, and model-only exposure are unchanged.
- Tests catch the original subtractive-startup behavior; READMEs reflect any visible activation changes.

### Approved scope split

The original resume validation was incomplete at the first closure. It has now been executed through public SDK construction from reopened disposable session files and the actual installed CLI. Both reproduce a missing restored loadout **without the local extensions**; local controls leave that already-omitted host state unchanged. Pending-name preservation is proven separately by the positive constructor/tree/reload tests. The user approved closing this package as the **local extension-induced startup defect** and tracking the confirmed host failure separately in [TDR-0004](../tdr/0004-sdk-cli-resume-tool-restoration-host-defect.md).

This closure verifies preservation of **existing pending restored names** and local availability/selection contracts. It does **not** mean end-to-end SDK/CLI resumed-tool restoration is working on Pi 1.0.0: the host does not seed the restored names through that creation path. The original acceptance criteria/history above are retained; the broader resumed-loadout failure is explicitly owned by TDR-0004, not silently considered satisfied here.

## Resolution and confirmation

A read-only scout classified this finding **confirmed** from current local/host source and checked 0004, 0009 and 0015. It had no command-execution tool, so it reported **no fresh runtime validation**; historical probes were supporting evidence, not a new run. The parent then added regressions **before executable changes** and reproduced the defect through public host APIs.

Installed contracts were re-read in `docs/extensions.md`, `docs/sdk.md`, `docs/cli.md`, `docs/mcp.md`, `docs/settings.md`, `docs/configuration.md` and `docs/session-format.md`, plus declarations and examples. On Pi 1.0.0:

- `dist/core/agent-session.js:1084-1097`: subtractive `setActiveToolsByName()` drops unrelated pending names; add-only updates do not.
- `dist/core/agent-session.js:2772-2862`: re-registration refreshes the registry, honors CLI allowlists/exclusions, and restores pending names without the subtractive API's clearing step.
- `dist/core/agent-session.js:2909-2928`: reload seeds pending tools before rebuilding extensions and emitting `session_start`.
- `docs/extensions.md`, Tool exposure: `hidden` re-registration is the supported withdrawal mechanism; available `model-only` tools remain excluded from nested calls.

The user approved using hidden withdrawal. `shared/toolAvailability.ts` retains the original tool definition and re-registers unavailable tools with `exposure: "hidden"` and `defaultActive: false`. Available tools retain their original model-only/direct exposure and ordinary activation defaults. Clarify, web search, delegation and parent relay now apply startup availability without subtracting from the active loadout. Delegation depth caps are applied with the same mechanism once trusted session context is available. Existing tool-call/execution guards remain.

Explicit `/clarify off`, `/web-search off`, and `/subagents off` still intentionally deactivate an active tool before withdrawal; they may replace pending restoration. Child argument/environment construction, tool allowlists, policy/trust/approval rules, output bounds and dialog cleanup were not changed. No dependency links, installed host files, personal settings, or real MCP configuration were changed.

## Regression coverage and executed validation

`pi-compatibility/tool-activation.test.ts` uses `discoverAndLoadExtensions`, SDK selection, `AgentSession`, in-memory `SessionManager`, and isolated scratch configuration. It does not import private host seams. Late synthetic direct, deferred and codemode tools register with `defaultActive: false`, so restored activation cannot be mistaken for registration defaults.

- Before implementation, **30 of 32** startup/restoration cases failed to restore the late tools. The two all-enabled child controls passed. The full initial regression run reported **51 tests: 7 passed, 44 failed**, including parent/subtest accounting and new unavailable-exposure expectations.
- After implementation, all off-mode combinations pass in top-level and child sessions, with registration order varied independently, public-constructor transcript restoration, and actual reload/fresh runtimes. Public `/tree` navigation without summarization also preserves pending names with delegation off or depth-capped.
- Coverage also checks manual/ask/auto policy, saved-state changes, fresh-startup and reloaded depth caps, explicit persisted toggles and intentional restoration replacement, direct child escalation, available/withdrawn callable sets and nested-call rejection, unrelated session choices, ordinary/empty/plain/modifier defaults, `+codemode`, explicit eligible/off selections, restrictive child allowlists with late restoration, exclusions, and no-tools/no-builtins options.
- Before independent review, focused command: `node --test pi-compatibility/*.test.ts clarify/index.test.ts web-search/index.test.ts` — **114 passed**, none failed/skipped.
- `npm run test:subagent` — **108 passed**, none failed/skipped.
- Before independent review, `npm run verify` — valid five host links, TypeScript passed, **410 tests passed**, none failed/skipped. Post-review final revalidation is recorded below.

Validation used the caller-created private scratch/sentinel at `/var/folders/br/m0tzwhrx6t77qjyr7846jwyc0000gn/T/pi/session-01a1015e-67b7-72e1-8586-f6c2d6567182` (canonical `/private/var/...`) with both required environment variables. Test environment changes are restored and runtimes shut down/invalidated. Logs: `0005-red.log`, `0005-green.log`, `0005-focused.log`, `0005-subagent.log`, `0005-verify.log` under that ephemeral root.

### Independent review

A fresh read-only reviewer inspected the diff, new tests/helper, current host contracts and parent validation logs. It independently executed **no tests** because its tool set had no command-execution tool. Verdict: **approve with documentation and test-coverage follow-ups; no blocking runtime defects or runtime fixes required**.

The parent verified and addressed the substantive follow-ups: independently varied registration order, public tree restoration, fresh depth caps, explicit callable-set assertions for hidden/model-only tools, additional named/default selections and restrictive late restoration. The enabled clarify metadata expectation was tightened. At this first review stage, closure text and the startup/restoration claim were narrowed: ordinary startup availability was covered, but pending transcript restoration was exercised through the public constructor and tree/reload paths, not SDK/CLI resume. Intentional explicit-off subtraction was retained because the package explicitly preserves that compatibility contract. No runtime rewrite was required. The missing SDK/CLI validation was subsequently completed in the follow-up below.

First implementation's post-review validation (before the SDK/CLI follow-up) was executed by the parent from `agent/extensions/` with approved canonical scratch:

- Focused compatibility/clarify/search command — **160 passed**.
- `npm run test:subagent` — **108 passed**.
- `npm run verify` — all five host links valid, TypeScript passed, **456 tests passed**.

Every final run reported **0 failed, 0 cancelled, 0 skipped**. Final logs: `0005-final-focused.log`, `0005-final-subagent.log`, `0005-final-verify.log` in the same ephemeral scratch root. The standalone activation suite has **100** tests after review refinements. The local runtime defect was fixed; the later SDK/CLI follow-up established and split the remaining host concern.

### Related re-checks and limits

- **0004 remains Resolved:** its public-loader structured-prompt regressions passed again, including late guidance, modes, owned removals and fresh-instance reload. This package changes availability, not prompt composition.
- **0009 remains Open:** source inspection confirms the wrapper still registers built-in replacements independently and recreates read without effective image options. The new SDK activation matrix verifies host precedence for this package, **not** native/wrapped activation or image-setting parity. No wrapper fix was implemented.
- **0015 remains Open / verify-first:** child arguments/environment and MCP-loading behavior are unchanged. Connection amplification, mock-server startup and owned server cleanup were not exercised; no opt-out was invented.
- The original constructor restoration test omits `initialActiveToolNames`. The follow-up `sdk-resume.test.ts` now exercises actual SDK creation from `SessionManager.open()` and actual bundled CLI `--session`. The formerly source-indicated host omission is **runtime-confirmed**, including a no-local-extension baseline, and remains **Open as TDR-0004**.
- The `+codemode` fixture is a selection-only inactive placeholder, not a sandbox/rendering test. The new SDK/CLI resume tests are characterizations of the separate open host defect, not positive restoration assertions. No provider requests, live terminal, real or mock enabled MCP server, external network operation, dependency installation, commit or push was needed. The optional private-host probe was omitted because committed public-host tests exercise the actual loadout/restoration methods directly.

## SDK/CLI resume follow-up

The missing validation was completed safely using real disposable JSONL files and synthetic late tools. Public SDK `createAgentSession()`/`SessionManager.open()` plus the actual installed package's declared CLI binary both retain `read, bash, edit, write` instead of restoring the transcript's selected late tools. Both no-local-extension controls and local-all-off controls produce the same result. Committed SDK tests also compare all 16 off-mode/relay combinations against that baseline.

`pi-compatibility/sdk-resume.test.ts` initially contained **19 passing, version-checked characterization/parity tests**. Review refinements added a positive `/tree` fixture control plus actual-registration/callability assertions; there is still no positive SDK/CLI creation-restoration result. Passing these tests records the host defect; it does not resolve TDR-0004. Both actual CLI subprocesses exited 0 without extension errors after orderly stdin shutdown. They ran offline with an isolated agent directory, fake HOME, invalid fixture API key, no prompt commands and no server connections. The SDK `resume` event and CLI initial `startup` event were exercised separately. No additional extension runtime change was required.

Initial follow-up validation: **19 tests passed**, TypeScript and all five host links passed. Supplementary executed probe evidence is retained in approved scratch (`0005-sdk-resume-probe.*`, `0005-cli-resume-probe.*`). Full reproduction, limits and future host acceptance criteria are in [TDR-0004](../tdr/0004-sdk-cli-resume-tool-restoration-host-defect.md).

### Follow-up review and final validation

A fresh read-only reviewer approved the split with no blocking defects. It inspected source and parent probe/test logs, but independently executed **no commands/tests**. The parent verified and addressed its findings: registration/exposure and indirect-callability controls, explicit open-defect labeling, narrower parity claims, a same-transcript positive tree control, allowlisted CLI environment without inherited credentials, and clearer documented-contract/validation evidence.

Final parent-executed validation from `agent/extensions/`, with both required variables pointing at approved canonical scratch:

- `node --test pi-compatibility/sdk-resume.test.ts` — **20 passed**: 19 host-omission characterization/local-parity counts plus one positive `/tree` fixture control. **No positive SDK/CLI creation-restoration result is claimed.**
- Focused compatibility/clarify/search command — **180 passed**.
- `npm run test:subagent` — **108 passed**.
- `npm run verify` — all five host links valid, TypeScript passed, **476 tests passed**.

Every final run reported **0 failed, 0 cancelled, 0 skipped**. Logs: `0005-resume-final-tests.log`, `0005-split-final-focused.log`, `0005-split-final-subagent.log`, `0005-split-final-verify.log` in the same approved ephemeral root. SDK/CLI resume validation is no longer missing; it confirms the separate unresolved host behavior. 0005 is closed only for the approved local scope; TDR-0004 remains Open. The 0004 regressions passed again, and 0009/0015 statuses remain unchanged. No extension runtime or installed-host changes were added during this follow-up.

### Re-check after 0009

Activation/restoration tests still pass; 0009 adds no subtractive startup update. **0005 stays Resolved; TDR-0004 stays Open**. See [0009 validation](0009-wrapped-built-in-configuration.md#resolution-and-validation).

Related: [0009: wrapped built-in activation](0009-wrapped-built-in-configuration.md), [0015: child MCP startup](0015-subagent-mcp-startup.md), [TDR-0004: SDK/CLI resume restoration](../tdr/0004-sdk-cli-resume-tool-restoration-host-defect.md).
