# 0016: Declare read-only tool hints and make permission limits explicit

- **Status:** Open
- **Priority:** Low; metadata/documentation gap, not a newly demonstrated security bypass
- **Evidence:** Source-verified
- **Areas:** `git-inspect`, `web-search`, permission documentation
- **Instructions:** [Package workflow and validation](README.md)

## Observation and evidence

`git-inspect/index.ts` and `web-search/index.ts` register tools without `annotations`. Pi 1.0.0 exposes MCP-style hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`). Missing hints use conservative defaults in integrations that consume them.

The local permissions extension analyzes bash/write/edit (`permissions/index.ts:196-265`); it is not a general approval layer for arbitrary MCP/custom tools. The host docs show an annotations-based policy as an example, not a shipped automatic guard. A mutating MCP tool can therefore be outside the local extension's ordinary classification even though nested built-in write/edit/bash calls remain guarded.

Annotations are unverified declarations, not sandboxing or authorization.

## Reproduce / test first

Capture registered metadata (the existing `pi-compatibility/extension-api.test.ts` pattern is suitable), and assert the intended hints for each owned tool. Verify a representative nested built-in call still hits permissions, using events only.

Review permissions README scope/trust language against actual dispatch. No destructive MCP call is required.

## Recommended fix and settled scope

- Add accurate hints to git_inspect: read-only, non-destructive, repeatable inspection, local/closed-world behavior.
- Add accurate hints to web_search: read-only/non-destructive retrieval with open-world/network behavior. Verify idempotent meaning before declaring it.
- Document that MCP and arbitrary custom operations are not automatically classified by the current permission policy, and that hints are not security guarantees.
- Do not infer read-only status solely from a tool name or let annotations bypass Priority 0 / existing concrete path guards.

**Do not silently expand approval policy in this change set.** Generic MCP approval is a separate feature decision: it needs explicit settings/defaults, missing-hint behavior, trust boundaries, no-UI fail-closed handling, and the dialog queue from 0002. If requested later, use host annotations as inputs, not proof of safety.

## Acceptance criteria

- Owned tool metadata is truthful and covered by registration tests.
- Tools remain usable through existing direct/codemode exposure.
- Permission documentation accurately states guarded and unguarded surfaces.
- No new prompts or broader grants are introduced by metadata alone.
- Concrete guards, nested event handling, and catastrophic-denial behavior are unchanged.
- READMEs explain only user-relevant limitations, without claiming hostile-code containment.

## Validation

`node --test pi-compatibility/extension-api.test.ts git-inspect/index.test.ts web-search/index.test.ts`; `npm run test:permissions`; `npm run verify` with approved scratch.

Related: [0002: dialog scheduling](0002-dialog-concurrency-and-cancellation.md), required before any future broad interactive approval policy.
