# 0016: Declare read-only tool hints and make permission limits explicit

- **Status:** Open — permission documentation actionable; metadata is optional low-cost cleanup
- **Priority:** Low; metadata/documentation gap, not a newly demonstrated security bypass
- **Evidence:** Source-verified; no current local annotation-based enforcement identified
- **Areas:** `git-inspect`, `web-search`, permission documentation
- **Instructions:** [Package workflow and validation](README.md)

## Current disposition and implementation scope

Separate two tracks: **permission-boundary documentation is worth addressing now**; **owned-tool hints are inexpensive but nonurgent cleanup**. No local permission policy currently consumes these hints. Adding them does not create approval prompts, constrain custom/MCP execution, or strengthen current authorization.

The [permissions README](../agent/extensions/permissions/README.md#scope-trust-boundary-and-limitations) should explicitly distinguish guarded built-in calls from arbitrary custom/MCP operations, including those reached through codemode. Nested built-in `bash`/`write`/`edit` calls still traverse the existing guards. Priority 0 applies to the supported Bash execution surfaces, not every possible mutating tool. Hints are unverified declarations, not containment or authorization guarantees.

If metadata cleanup is selected, a minimal useful contract is `readOnlyHint: true` for both tools, with `openWorldHint: false` for local Git inspection and `openWorldHint: true` for web retrieval. `destructiveHint: false` can be included if appropriate. Do not require `idempotentHint`; it is meaningful for non-read-only tools, and no idempotency promise is needed for web search.

Keep generic MCP/custom-tool approval out of this package. It is a separate policy feature requiring explicit authorization and defaults; create a TDR only if that capability is wanted and intentionally deferred. No TDR is needed for the small documentation/metadata corrections themselves.

Record documentation completion and metadata completion/accepted deferral separately. Neither documentation nor hints should be presented as broader permission enforcement. This disposition is source/docs review only; no new registration tests or destructive tool probes were run.

## Observation and evidence

`git-inspect/index.ts` and `web-search/index.ts` register tools without `annotations`. Pi 1.0.0 exposes MCP-style hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`). Missing hints use conservative defaults in integrations that consume them.

The local permissions extension observes tool calls (`permissions/index.ts:204-214`) and classifies bash/write/edit (`:349-361`); it is not a general approval layer for arbitrary MCP/custom tools. The host docs show an annotations-based policy as an example, not a shipped automatic guard. A mutating MCP tool can therefore be outside the local extension's ordinary classification even though nested built-in write/edit/bash calls remain guarded.

Annotations are unverified declarations, not sandboxing or authorization.

## Reproduce / test first

For the documentation track, review permissions README scope/trust language against actual dispatch and the documented nested-call contract. No destructive MCP call is required, and docs-only changes do not require adding executable tests.

If metadata cleanup is selected, capture registered metadata (the existing `pi-compatibility/extension-api.test.ts` pattern is suitable) and assert the chosen hints before changing registration. Check preservation through web-search availability re-registration. Verify a representative nested built-in call still hits permissions using events only; do not broaden approval behavior.

## Recommended fix and settled scope

- First document the classified and unclassified surfaces in the permissions README, including codemode-reachable operations, nested built-in calls, and the supported Bash scope of Priority 0.
- Optionally add accurate read-only/local-world hints to git_inspect and read-only/open-world hints to web_search. Do not introduce an unnecessary web-search idempotency promise.
- Keep registration/consumer details in tests or maintainer documentation; a new tool README feature claim is unnecessary when there is no user-visible behavior change.
- Do not infer safety solely from a tool name or let annotations bypass Priority 0 / existing concrete path guards.

**Do not silently expand approval policy in this change set.** Generic MCP approval is a separate feature decision: it needs explicit settings/defaults, missing-hint behavior, trust boundaries, no-UI fail-closed handling, and the dialog queue from 0002. If requested later, use host annotations as inputs, not proof of safety.

## Acceptance criteria by track

### Permission documentation

- The README explicitly states guarded and unguarded surfaces, including arbitrary custom/MCP operations reached through codemode.
- Nested built-in calls remain described as guarded; Priority 0 is not presented as universal protection across all tools.
- Hints are identified as unverified declarations rather than authorization or containment guarantees.
- Documentation makes no claim of hostile-code containment or new enforcement; executable policy is unchanged.

### Metadata cleanup, if selected

- The chosen hints are truthful and covered by registration tests, including web-search availability re-registration.
- Tools remain usable through existing direct/codemode exposure.
- No new prompts, broader grants, or annotation-based policy are introduced.
- Concrete guards, nested event handling, and catastrophic-denial behavior are unchanged.
- Any accepted metadata deferral is recorded explicitly rather than implied to be implemented.

## Validation

Docs-only changes need scope/consistency and link review. If metadata is changed: `node --test pi-compatibility/extension-api.test.ts git-inspect/index.test.ts web-search/index.test.ts`; `npm run test:permissions`; `npm run verify` with approved scratch. Generic approval-policy tests are outside this package.

## Historical re-checks

### Re-check after 0009

**Still Open:** source inspection confirms missing git/web annotations and unchanged permission scope. Passing registration/permission tests and [0009](0009-wrapped-built-in-configuration.md#resolution-and-validation)'s native-wrapper metadata checks do not establish this package's criteria.

Related: [0002: dialog scheduling](0002-dialog-concurrency-and-cancellation.md), required before any future broad interactive approval policy.
