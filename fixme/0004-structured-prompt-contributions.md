# 0004: Stop forcing the entire prompt for additive extension guidance

- **Status:** Open
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
