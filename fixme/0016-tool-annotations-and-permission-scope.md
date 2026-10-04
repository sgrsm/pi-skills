# 0016: Declare read-only tool hints and make permission limits explicit

- **Status:** Resolved — documentation and metadata tracks complete; combined integration gate passed
- **Priority:** Low; metadata/documentation gap, not a newly demonstrated security bypass
- **Evidence:** Metadata reproduced test-first; registration/availability and event-only nested-guard regressions pass on Pi 1.0.0; no annotation-based enforcement added
- **Areas:** `git-inspect`, `web-search`, permission documentation
- **Instructions:** [Package workflow and validation](README.md)

## Current disposition and implementation scope

Both explicitly selected tracks are complete, with separate outcomes:

| Track | Outcome | Enforcement consequence |
|---|---|---|
| Permission-boundary documentation | Complete in the [permissions guide](../agent/extensions/permissions/README.md#scope-trust-boundary-and-limitations) | Describes existing classification only; no new authorization or containment. |
| Owned-tool metadata | Complete, test-first | `git_inspect`: `{ readOnlyHint: true, openWorldHint: false }`; `web_search`: `{ readOnlyHint: true, openWorldHint: true }`. No idempotency promise or redundant destructive hint. |

Permissions classifies supported `bash`/`write`/`edit` calls, not arbitrary custom/MCP operations, including those reached through codemode. Nested built-ins still traverse existing guards. Priority 0 applies to the owned Bash tool and supported TUI Bash execution surfaces, not every possible mutating tool. Annotations are unverified declarations, not authorization or containment guarantees; no local permission policy consumes these hints.

Generic MCP/custom-tool approval stays outside this package. It would require a separate explicitly authorized policy decision and defaults. No TDR is needed for these documentation/metadata corrections. Neither track creates prompts, broadens grants, changes tool selection/exposure, or strengthens current authorization.

The 0012 session was confirmed finished before implementation. Its current Git renderer was read and preserved; the only runtime changes here are the two registration annotation objects. Focused validation and the subsequent completed integration pass are recorded separately below.

## Observation and evidence

At the audit baseline, `git-inspect/index.ts` and `web-search/index.ts` registered tools without `annotations`; the selected hints are now present. Pi 1.0.0 exposes MCP-style hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`). Missing hints use conservative defaults in integrations that consume them.

The local permissions extension observes tool calls (`permissions/index.ts:204-214`) and classifies bash/write/edit (`:349-361`); it is not a general approval layer for arbitrary MCP/custom tools. The host docs show an annotations-based policy as an example, not a shipped automatic guard. A mutating MCP tool can therefore be outside the local extension's ordinary classification even though nested built-in write/edit/bash calls remain guarded.

Annotations are unverified declarations, not sandboxing or authorization.

## Reproduce / test first

For the documentation track, review permissions README scope/trust language against actual dispatch and the documented nested-call contract. No destructive MCP call is required, and docs-only changes do not require adding executable tests.

For the selected metadata cleanup, capture registered metadata (the existing `pi-compatibility/extension-api.test.ts` pattern is suitable) and assert the chosen hints before changing registration. Check preservation through web-search availability re-registration. Verify a representative nested built-in call still hits permissions using events only; do not broaden approval behavior.

## Recommended fix and settled scope

- First document the classified and unclassified surfaces in the permissions README, including codemode-reachable operations, nested built-in calls, and the supported Bash scope of Priority 0.
- Add the selected minimal read-only/closed-world hints to git_inspect and read-only/open-world hints to web_search. Do not introduce an unnecessary web-search idempotency promise.
- Keep registration/consumer details in tests or maintainer documentation; a new tool README feature claim is unnecessary when there is no user-visible behavior change.
- Do not infer safety solely from a tool name or let annotations bypass Priority 0 / existing concrete path guards.

**Do not silently expand approval policy in this change set.** Generic MCP approval is a separate feature decision: it needs explicit settings/defaults, missing-hint behavior, trust boundaries, no-UI fail-closed handling, and the dialog queue from 0002. If requested later, use host annotations as inputs, not proof of safety.

## Acceptance criteria by track

### Permission documentation

- The README explicitly states guarded and unguarded surfaces, including arbitrary custom/MCP operations reached through codemode.
- Nested built-in calls remain described as guarded; Priority 0 is not presented as universal protection across all tools.
- Hints are identified as unverified declarations rather than authorization or containment guarantees.
- Documentation makes no claim of hostile-code containment or new enforcement; executable policy is unchanged.

### Metadata cleanup

- The chosen hints are truthful and covered by registration tests, including web-search availability re-registration.
- Tools remain usable through existing direct/codemode exposure.
- No new prompts, broader grants, or annotation-based policy are introduced.
- Concrete guards, nested event handling, and catastrophic-denial behavior are unchanged.
- Documentation and metadata outcomes are recorded separately; neither implies broader permission enforcement.

## Implementation and focused validation

### Documentation outcome

The permissions README now explicitly names the supported and unclassified surfaces, including codemode-reachable custom/MCP operations; distinguishes event dispatch from classification; states that nested built-ins retain existing guards; bounds Priority 0 to supported Bash; and explains that annotations are unverified declarations rather than authorization or containment. Existing hostile-code, shell-recognizer, path/symlink, and race limitations remain. Scope language was checked against current dispatch and the installed complete extension/codemode/MCP docs and annotation declarations; the existing relative links and scope anchor remain valid. No executable permission policy changed.

### Metadata outcome

Only `readOnlyHint` and `openWorldHint` were added to each owned registration. Git's fixed local inspection is closed-world; SearXNG web retrieval is open-world. These describe the tool operation, not a guarantee of zero ancillary I/O: web-search's existing full-output temporary-file persistence is unchanged. No `idempotentHint`, annotation-based enforcement, generic approval, prompt, broader grant, tool-selection, dependency, host-link, or renderer change was introduced.

Registration tests assert the exact minimal hints and existing direct/default-active exposure. Web-search's synthetic saved-state transitions cover hidden → direct → hidden → direct re-registration, preserving annotations, execution, and schema; disabled execution still rejects. The compatibility checks preserve workflow tools' model-only/hidden distinction. Parent-tagged event-only regressions compare nested and direct guarded `write`/`edit`/`bash`, characterize unclassified custom/MCP events without executing them, and retain nested Priority 0 with ordinary permissions off and deliberately misleading read-only metadata.

### Executed checks

From `agent/extensions/` on installed **Pi 1.0.0**, Node **v22.19.0**, using the caller-approved private session scratch root, its caller-created `.step1-test-root-ready` sentinel, and the canonical real path for both `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR`. `PI_CODING_AGENT_DIR` pointed to a synthetic scratch agent directory, not personal state.

- **Test-first:** after correcting a fixture-only overwrite setup error, the registration command below reported **13 passed, 3 failed**, all three failures specifically missing annotations. The event-only permission control passed before runtime edits.
- `node --test pi-compatibility/extension-api.test.ts git-inspect/index.test.ts web-search/index.test.ts`: **16 passed**.
- `npm run test:permissions`: **125 passed**.
- `node --test git-inspect/rendering.test.ts`: **9 passed**, preserving 0012's collapsed/expanded renderer regressions.
- `npm run typecheck`: passed, including all **five existing valid host links** and TypeScript `--noEmit`.
- All final focused suites had **0 failed, cancelled, or skipped**. A read-only scout corroborated dispatch/exposure boundaries; it ran no tests. Parent-run checks establish the recorded results.

### Retained limitations and integration boundary

- Hints do not establish tool safety, containment, or generic custom/MCP authorization. Supported nested built-ins remain guarded; unrelated custom/MCP side effects remain outside classification. Git's closed-world hint describes its fixed repository-inspection domain, not network isolation; no offline/partial-clone lazy-fetch guarantee was tested or added.
- New nested checks exercise synthetic events, not a live codemode script, provider, or MCP connection. The installed documented dispatch contract supplies the host context; registration capture does not claim an end-to-end tool-selection test.
- No destructive MCP probe, live terminal, real session cleanup, personal settings/configuration change, dependency/link change, `/reload`, commit, or repository Git branch/index operation was performed. Existing tests create disposable Git fixtures only in approved scratch.
- **`npm run verify` was reserved for integration**, not run as the implementation session's focused validation. The subsequent combined pass updates `fixme/README.md` and records its actual gate result there. Earlier findings' session-local skipped-gate reports retain their historical scope. Generic approval-policy tests remain outside this package.

## Integration result

After the user confirmed all sessions finished, one integration pass reconciled the current 0012–0015 reports with this change, reviewed their combined diff, and updated [the package index](README.md#integration-of-00120016). An independent read-only reviewer found no blockers; its scope/status warnings were reconciled without editing other owners' runtime code or the compatibility-test README inventory. The reviewer ran no tests.

Parent-run **`npm run verify` passed: 617 tests; 0 failed, cancelled, or skipped**, plus TypeScript and all five existing host-link checks. It used the same approved canonical scratch setup and synthetic agent directory described above. This is the combined integration gate, not an additional claim of live provider/MCP/TUI validation or resolution of retained host/characterization defects. Final edits after the gate record documentation outcomes only; no executable code changed after verification.

## Historical re-checks

### Re-check after 0009

**Still Open:** source inspection confirms missing git/web annotations and unchanged permission scope. Passing registration/permission tests and [0009](0009-wrapped-built-in-configuration.md#resolution-and-validation)'s native-wrapper metadata checks do not establish this package's criteria.

Related: [0002: dialog scheduling](0002-dialog-concurrency-and-cancellation.md), required before any future broad interactive approval policy.
