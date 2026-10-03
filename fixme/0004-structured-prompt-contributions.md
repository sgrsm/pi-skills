# 0004: Stop forcing the entire prompt for additive extension guidance

- **Status:** Resolved — confirmed on Pi 1.0.0; fixed by this work package
- **Priority:** Medium; MCP impact latent in audited configuration
- **Evidence:** Reproduced through the actual host prompt runner/builder
- **Areas:** `clarify`, `permissions`, `subagent` — one change set
- **Instructions:** [Package workflow and validation](README.md)

## Problem and evidence

The following `before_agent_start` handlers return a complete `systemPrompt` just to append guidance:

- `clarify/index.ts:718-731`: interactive policy or no-UI note.
- `permissions/index.ts:121-125`: scratch-directory hint.
- `subagent/index.ts:2617-2633`: delegation policy.

In Pi 1.0.0, `HOST/dist/core/extensions/runner.js` translates that return into `forceSystemPrompt`. `core/system-prompt.js:121-124` then renders forced text instead of structured sections. Built-in MCP contributes `sections.mcp_servers` later in load order, so it is absent from the effective provider prompt.

A probe loaded the actual local handlers, appended a synthetic late MCP section using `loadExtensionFromFactory()`, and called `emitBeforeAgentStart()` and `buildSystemPrompt()`: the section existed in options but not in rendered text. All three additive handlers should be fixed together; leaving any one forcing the prompt retains the failure.

## Reproduce / test first

**Committed regression:** add a `pi-compatibility` test capturing all three local handlers with a fake/public ExtensionAPI runner and a late section contributor. Assert local guidance remains structured, late sections survive, and no forced replacement is returned or set.

**Optional host probe:** use the actual runner/builder to assert the final rendered prompt includes both local guidance and the late section. Private builder/loader functions follow the README's test-seam policy. No live MCP connection or model request is necessary.

Test repeated turns, active/inactive clarify/subagents, no-UI mode, differing session scratch ids, and reload. Retain exact policy semantics.

## Recommended fix

Mutate documented `event.systemPromptOptions.sections` or `promptGuidelines` using stable extension-owned keys. Use sections for multiline policy/scratch guidance. Do not render the entire prompt and feed it back as a replacement.

Ensure updates replace the extension's contribution instead of accumulating duplicates. Remove owned content when it no longer applies. Preserve unrelated sections and respect deliberately forced prompts from other extensions without attempting to override them.

## Acceptance criteria

- None of these additive handlers sets/returns a whole prompt replacement.
- Late MCP and other extension sections reach the effective prompt.
- Clarification, delegation policy, and scratch hints remain behaviorally equivalent in all modes.
- Each contribution appears once; disabling/removing a policy does not leave stale guidance.
- Structured prompt delta/cache behavior is not defeated by local additive handlers.
- Relevant READMEs and compatibility tests describe the structured contract.

## Validation

Focused `pi-compatibility/*.test.ts`, owning tests, and `npm run verify` with approved scratch.

Related: [0005: MCP loadout restoration](0005-tool-activation-and-mcp-restoration.md). They affect the same integration but have independent causes/tests; neither fix substitutes for the other.

## Confirmation and resolution

Rechecked at repository HEAD `f17698a97bbc2e4a84db6a656ab8a6f75fbbe7b7`, installed **`@earendil-works/pi-coding-agent@1.0.0`**, Node **v22.19.0**. The original evidence above is retained as the audit snapshot; its line numbers have moved.

**Confirmed, not already resolved.** All three current handlers still returned whole-prompt text. Earlier 0002/0003 work changed dialogs or retained characterization tests, not this prompt contract. Relevant configuration had clarify's default enabled state, subagent mode `auto`, and the only configured MCP server disabled with the `codemode-deferred` exposure alias. No personal prompt/extension override was configured in the inspected settings. Thus the late-MCP symptom remained latent locally, but the whole-prompt composition defect was reproducible independently of a live server.

### Current host contract and reproduction

- `HOST/docs/extensions.md` documents mutable `event.systemPromptOptions`, preferring sections/guidelines over an exact whole-prompt override. `HOST/examples/extensions/prompt-customizer.ts` demonstrates stable section assignment/removal.
- `HOST/dist/core/extensions/runner.js`, `emitBeforeAgentStart()`, normalizes one shared options object and translates a returned `systemPrompt` into `forceSystemPrompt`. The renderer gives that forced text precedence over sections.
- `HOST/dist/core/package-manager.js`, `resourcePrecedenceRank()`, orders built-ins after file/package extensions. Built-in MCP's `before_agent_start` handler assigns/deletes `sections.mcp_servers` after waiting for direct servers.
- `HOST/dist/core/agent-session.js`, `_preparePromptAndToolLoadout()` and `_installAgentForcedPromptProjection()`, persists structured section deltas but projects forced text over the provider-facing prompt. Missing current keys become `null` removals in `diffSystemPromptSections()`.

The committed regression uses **public `discoverAndLoadExtensions` and `ExtensionRunner`**, a real in-memory `SessionManager`, fake UI/theme, isolated scratch configuration, and synthetic late MCP/other-extension handlers. The final handler reads `event.systemPrompt`, exercising the actual host renderer without importing its private builder. The defect-confirming test-first run passed **12 controls and failed 13 tests** (11 new subtests, their parent, and the owning scratch-hint regression). The late section was present in options but absent from rendered text; no handler errors or external calls were needed. Fixture/theme prerequisites were corrected before this meaningful red run.

### Changes

- Clarify writes/replaces `sections.clarify_policy`, using the original interactive policy or no-UI note; disabled/inactive clarify deletes only that key.
- Permissions writes/replaces `sections.permissions_scratch`, preserving the exact one-line hint and lazy workspace creation. Ordinary off mode still advertises scratch; actual guards are unchanged.
- Subagent writes/replaces `sections.subagent_policy` while delegation or child escalation is active; otherwise it deletes only that key. The policy builder and all seven arguments, including project trust and approval state, are unchanged.
- None returns a prompt replacement, reads the rendered prompt to rebuild it, clears another extension's force, or mutates unrelated sections. No dependency, tool activation/exposure/allowlist, guard, grant, dialog, cancellation, or lifecycle policy changed.
- Updated owning READMEs, compatibility coverage, and existing permissions/project-trust tests to supply/assert the supported structured event contract.

**Deliberately forced prompts:** these handlers now respect an exact replacement regardless of registration order. Their sections remain available to the structured transcript but are not injected into the forced provider prompt. Previously a forcing extension loaded *before* the local handlers received appended local guidance; that was the same whole-prompt chaining defect, not the supported override contract. This is the explicit exception to unchanged guidance visibility, settled by this package's instruction to respect deliberate forces. Enforcement remains outside prompt text and is unchanged. The READMEs explain this limitation. Structured guidance, including the scratch path, now participates in host transcript sections/deltas rather than only forced request text.

### Independent review and remediation

Two independent read-only reviewer subagents challenged host composition/delta correctness and safety/coverage/scope, using source and validation logs; neither ran tests. Neither found a new production-code defect.

Parent verification confirmed their actionable documentation/test observations:

- The forced-before-order log proved the visibility difference; READMEs now explicitly say guidance is absent from a forced provider prompt rather than claiming it “still” takes precedence.
- The old reload test changed session ids, so it could not prove real-style same-id reload stability. Coverage now checks fresh loader/runtime instances on the same event bus with the same manager/id, plus new ids on the same runtime.
- A failed child-policy assertion could leak test environment into later subtests (also visible in the red log). Cleanup is now exception-safe. Each turn resets/requires a fresh rendered snapshot; shutdown errors are not silently swallowed.
- Added disabled-but-active clarify, session/write-approved and inherited-broad policy checks, explicit active tools in mode-only cases to decouple them from 0005, and fail-closed `TMPDIR` validation against approved scratch.

These were test/docs refinements, not additional runtime fixes. Post-review focused and full validation was rerun. No substantial change to the reviewed production behavior required a further review.

Optional suggestions to add a full provider/`AgentSession` cache test were not promoted to required production changes: the public runner regression and version-checked differ probe cover the contract without a paid model request. Older-host fallback and disagreement between an earlier handler's `selectedTools` edits and the live active set were pre-existing/unsupported here; neither was reproduced as a new defect or broadened into this work package. No in-scope reviewer blocker remains.

### Actual validation

Commands ran from `agent/extensions/` with `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR` set to the private canonical approved session root containing the caller-created `.step1-test-root-ready` sentinel.

**Final retained state:**

- `node --test pi-compatibility/structured-prompt.test.ts permissions/index.test.ts subagent/projectTrust.test.ts`: **43 passed**.
- `node --test pi-compatibility/*.test.ts clarify/index.test.ts permissions/index.test.ts`: **72 passed**.
- `npm run test:permissions`: **125 passed**.
- `npm run test:subagent`: **108 passed** (runtime unchanged after this run; also covered by the final full gate).
- `npm run verify`: **all five host links valid, TypeScript passed, 356 tests passed**.
- All final runs: **0 failed/cancelled/skipped**. An intermediate full gate caught the old project-trust test's incomplete fake event and whole-prompt expectation; adapting that test restored its original trusted/untrusted assertions without weakening them.

**Supplementary actual-host scratch probe:** resolved the current host root through its peer link, version-checked **1.0.0**, and used `pathToFileURL` to import the private builder/differ only in scratch. With actual local handlers it verified:

1. Local and synthetic late MCP guidance render together, with no forced replacement.
2. Unchanged turns produce no section delta.
3. Inactive policies produce only `clarify_policy: null` and `subagent_policy: null`, preserving scratch/MCP/unrelated sections.
4. A changed session id replaces only `permissions_scratch`.

No private package subpath or absolute installed-host path is committed. The probe initially encountered the ESM-only package's absent `require` export; resolving the documented peer link allowed the probe to execute successfully rather than skipping it.

Artifacts:

`/private/var/folders/br/m0tzwhrx6t77qjyr7846jwyc0000gn/T/pi/session-01a10140-f649-76ee-8c18-52f1e855080f/`

Key files: `0004-before.log`, `0004-after.log`, `0004-review-final.log`, `0004-focused-post-review.log`, `0004-permissions-final.log`, `0004-subagent-final.log`, `0004-verify-post-review.log`, and `0004-host-probe.mjs` / `.log`. These are ephemeral supplementary evidence, not test prerequisites.

**Limits:** synthetic late sections and in-memory session state, not enabled real MCP or end-to-end provider/transcript persistence. No live provider cache/token savings were measured, and no live-terminal smoke test was needed for these non-UI edits. No live destructive operation, dependency installation, real configuration/session mutation, or model request was used to reproduce/validate the issue.

### Acceptance and related findings

All 0004 acceptance criteria are satisfied at the supported structured host boundary: no local force; late sections reach the effective rendered prompt; policy/scratch text preserved in applicable modes; deterministic single contributions and owned removal; host section deltas remain usable; READMEs and regressions document the contract. Deliberate foreign forces remain intentional opaque overrides, as above. Provider-specific cache efficiency is not claimed.

- **0002 remains Resolved, unaffected:** dialog/guard/runtime mechanisms are unchanged; full permissions, clarify and cross-extension scheduling/cancellation coverage passes.
- **0003 remains Deferred, unaffected:** fullscreen input/mouse code is unchanged; its passing characterization tests still record defects rather than satisfying its deferred acceptance criteria.
- **0005 remains Open:** the supplementary probe independently called actual `AgentSession.prototype.setActiveToolsByName()` with synthetic loadout/pending state. Real top-level subagent startup still subtracts escalation and clears the synthetic pending MCP name. Prompt composition cannot repair restored-tool loss; no activation workaround was added.
- Other shared-owner packages **0006, 0015 and 0016** were inspected: result/accounting, child process/MCP startup, and annotation/permission-surface mechanisms are unchanged. Their independent acceptance criteria were not executed or closed.

No other finding was resolved by 0004, and no user decision remains for this package.
