# Pi 1.1.0 → 1.2.0: API opportunities

## Assessment context

- **Run:** `20261015-000127`, 2026-10-15 00:01:27 CEST (UTC+02:00).
- **Versions:** requested baseline **1.1.0**, requested target **1.2.0**; installed selector and executed CLI **1.2.0**.
- **Baseline provenance:** explicit user-supplied upgrade interval, corroborated by installed 1.1.0 packages and version-bound maintenance/TDR evidence. No inferred upgrade history.
- **Repository:** `main`, HEAD `21f23bd66afe9e1efbbec9d126ced49c83638e94`; initially clean, one commit ahead of upstream.
- **Overall status:** **Partial assurance:** the bounded offline/source assessment and documented checks were executed, but the target verification gate is not green and extended/live acceptance remains unverified.
- **Category status:** released API/capability relevance screen complete for current local consumers; one already-active schema-presentation benefit retained. No additional API migration merits implementation now on the evidence available.
- **Sibling reports:** [Compatibility and canonical validation](01-compatibility.md) · [Simplification and debt](02-simplification-and-debt.md).

> **Post-audit follow-up:** [C1 has been addressed](01-compatibility.md#c1-follow-up-resolution) with direct-runner coverage for both event variants. End-to-end custom-run scheduling remains unverified, and C2 remains open. The recommendations below retain their audit-time context.

## Recommendation summary

| Capability / consumer | Recommendation | Action |
| --- | --- | --- |
| Codemode declaration constraints / Git Inspect | **Adopt now, through existing schemas** | Keep existing TypeBox constraints as the source of truth; target already displays them. A small durable catalog regression is optional. No runtime migration required. |
| `reachesTools` / local workflow tools and permissions | **Skip** | No current local tool reaches the parent session's other tools. Do not confuse child-process delegation with parent-registry reach or permission authorization. |
| Namespace `aliases` / local tools | **Skip** | No local namespace consumer or material benefit established. Built-in MCP benefits without a local change. |
| Expanded custom-run `before_agent_start` | **Already consumed; required harness repair is C1** | Do not duplicate a compatibility finding as an optional adoption. Additional SDK scheduling coverage may follow the repair. |
| Supported custom-dialog blocked-status facility | **Defer local integration** | No safe scoped facility shipped in target; retain TDR-1206 and its privacy/arbitration requirements. This is debt, not a new optional API finding. |

There is no substantive unconsumed local API feature warranting a new implementation in this run. The shortlist below records the useful existing consumer and why other released capabilities were screened out, rather than turning release notes into a wishlist.

## A1 — Low priority: retain native schema-constraint presentation for Git Inspect

**Released capability:** 1.2.0 codemode declarations render integer, minimum/maximum, length, pattern, default and related JSON-schema constraints as comment tags. See [release notes](https://github.com/earendil-works/pi/releases/tag/v1.2.0) and [the shipped codemode documentation](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/codemode.md). Installed `@earendil-works/pi-codemode/dist/declarations.js`, constraint-comment rendering, corroborates that this is target behavior, not a proposal.

**Concrete consumer:** [git-inspect/index.ts](../../agent/extensions/git-inspect/index.ts), `GitInspectParams`, around lines 96–97, already uses bounded integer `maxCount` and maximum path-array length. This tool is directly available and callable through codemode. The new presentation helps scripts see constraints before emitting invalid read-only requests, without another local declaration formatter.

**Observed evidence:** passive `describeTool("git_inspect")` through the actual codemode catalog produced:

```ts
// Maximum commits to return (1-100)
// @integer @minimum 1 @maximum 100
maxCount?: number;
// @maxItems 20
paths?: Array<string>;
```

This is demonstrated metadata presentation, not a measurement that models make fewer mistakes. No Git/provider/MCP operation was needed. The ordinary Git Inspect validation and renderer tests also passed on the target.

**Smallest adoption:** no production code change. Continue encoding actual validation constraints in TypeBox and retain operation-specific runtime validation. If extending durable coverage, add one focused real-codemode catalog assertion for `maxCount` and `paths` to an existing compatibility fixture, using no tool invocation or network. Keep direct-tool guidance useful; codemode tags are not a reason to delete all human-readable bounds or operation-specific rules.

**Alternatives and cost:** retain current schemas and rely only on host tests, which costs nothing but leaves local presentation drift untested; or hand-maintain duplicate range text/TypeScript declarations, which increases drift and prompt maintenance. Prefer the existing schema-driven path, with the small optional regression only when touching this area. No scheduling, activation, exposure or approval semantics change.

**Safety/compatibility limits:** tags do not authorize tools, enforce path policy, or replace the conservative operation validator. Do not encode new schema constraints merely because the renderer can display them. For example, [web-search](../../agent/extensions/web-search/index.ts) currently normalizes/clamps `limit`; adding strict integer/range schema rejection would change accepted input behavior rather than transparently adopt this display feature. Preserve that choice unless separately requested.

**Recommendation:** **adopt now by retaining the already-active integration**. Effort is zero for production; optional coverage is small. Confidence is high in target presentation, with no evidence for a broader behavior or performance claim.

## Other released surfaces screened

| Released change | Current workflow assessment | Decision / evidence boundary |
| --- | --- | --- |
| Tool `reachesTools(input)` returning `"all"` or input words | Target MCP waits for relevant servers and recognizes replacement codemode/tool-search tools by this metadata. Subagent launches a separate Pi process; Git Inspect/search execute directly; renderer wrappers do not call other tools; permissions observes guarded events. | **Skip local adoption.** A real future parent-registry orchestrator should declare truthful reach and test late registration/readiness/cancellation. Metadata is an unverified declaration, not a safety or authorization grant. No live MCP readiness acceptance was attempted. |
| Namespace aliases and normalized namespace lookup | Built-in MCP adds server-name aliases; local runtime tools do not define a grouped namespace or implement discovery. | **Skip.** Do not invent namespaces merely to consume the field. Retaining current individual tool names has no migration cost. |
| `before_agent_start` custom-message union and custom-trigger runs; busy-start semantics | Clarify, permissions, subagent and response-timer already use the hook without reading user-only fields. New custom turns now receive their setup. Handoff's busy path already queues `followUp`. | Required fixture adaptation is [C1](01-compatibility.md#c1--p1-update-structured-prompt-test-calls-to-the-new-trigger-api). Direct user/custom runner probe passed; actual startup races, queue delivery and post-tool prompt stability were not executed. Do not advertise end-to-end custom-run coverage yet. |
| `serializeConversation()` thinking omission | Handoff already calls the public helper. | Already-realized improvement [S1](02-simplification-and-debt.md#s1--low-priority-already-realized-host-improvement-leaner-handoff-serialization), not a second API finding. |
| Codemode elapsed/total row time | Local response-timer measures response lifecycle, not one script. | Partial overlap only; no useful removal or API migration. See the retirement screen. |
| Codemode MCP result declarations, arbitrary structured-content values, output joining/options-line fixes | No local MCP bridge or custom codemode implementation remains. Current model-only tools continue to be excluded from nested access by the real sandbox tests. | Native benefit, no local migration. Preserve local output truncation/persistence; improved host output joining does not make those bounds obsolete. |
| MCP resource-presence boolean/no eager enumeration, OAuth cancellation fixes | MCP-status projects configuration fields, not resource counts or runtime connection state. No local OAuth implementation to remove. | No local API adoption. Do not use the upstream cancellation correction to relax permissions or claim live MCP compatibility. |
| Published Pi config/theme schemas | No extension-owned Pi theme was found; local extensions consume supplied theme helpers and keep extension-specific configuration contracts. | No upgrade-driven extension migration identified. Adding editor `$schema` fields would be optional configuration work, not authorized by this audit and not a runtime compatibility remedy. |
| Clipboard OSC52 opt-in | No concrete local clipboard customization/replacement consumer established. | **Skip within this audit.** User-specific remote clipboard preference is not an extension API opportunity. |
| Per-key OpenRouter model catalog, provider timeout/retry fixes | No local custom catalog, OpenRouter-specific extension, or provider transport shim affected; Codex physical request identity remains absent. | Native provider improvements, no local migration. No credentials or model request used to validate them. |
| Print token-limit nonzero exit | Subagent children use `--mode json -p`; target's changed exit logic is in text print mode. | Source-screened, not a child compatibility finding or adoption opportunity. |
| Normalized mouse handling / terminal program-status setter | Both APIs predate baseline. Wheel fallback changes in target; low-level status bypasses reporter ownership. | Not new API opportunities. C2 owns the test repair; TDR-1201/TDR-1206 own remediation limits. |
| Removed unreleased experimental stack | Local extensions use published imports, not the removed source-only experimental/plugin exports. | No local consumer; no migration. |

## Adoption order and validation limits

1. Resolve [C1/C2](01-compatibility.md#required-compatibility-follow-up) and rerun the gate before optional changes.
2. Retain the existing schema/public-serializer benefits. If durable coverage is added, keep it focused and synthetic; no new framework, live provider or live MCP fixture is needed.
3. Defer blocked-status and other debt integrations until their actual supported prerequisites exist. New metadata must not expand enforcement policy or loosen P0, trust, model-only or no-UI constraints.

All recommendations are non-remediating. The complete validation results and material gaps live in the [compatibility report](01-compatibility.md#canonical-validation-record). The optional metadata behavior is demonstrated; proposed future regressions and full custom-run scheduling are not presented as executed. Official release/tagged documentation and installed source, not current-main proposals, determine the target capability screen.
