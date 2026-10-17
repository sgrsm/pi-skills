# Pi upgrade remediation protocol

Apply the intent and authorization rules in [SKILL.md](../SKILL.md). Paths here are relative to the verified repository root unless explicitly linked. This protocol is for implementation follow-up, not release research or a fresh audit.

## 1. Establish context

1. Confirm implementation intent. Without it, provide only read-only analysis, status or a proposal.
2. Inspect branch, HEAD, working/staged changes and relevant history with `git_inspect`. Identify user-owned changes and preserve them throughout.
3. Locate the retained assessment under `extensions-audit/` and read all three sibling reports as one assessment. Default to the sole set. If none exists, sibling reports are missing/unreadable, or multiple sets make the input ambiguous, ask which assessment to use, recommending a complete set when supported. A structurally complete assessment marked partial or containing a red gate is still actionable; that status alone needs no question. Do not generate, consolidate or delete report sets here; suggest `pi-upgrade-audit` if an assessment is needed.
4. Read `agent/extensions/maintenance.md`, current manifests, the TDR index and relevant owning records, extension guides and maintainer notes. Follow current references rather than assuming old paths or validation scripts still exist. Do not revalidate every unrelated TDR.
5. Verify the actual runtime, installed host version and resolved package roots. If the target is missing or conflicts with the runtime, clarify before target-dependent execution; independent inspection can continue. Never silently substitute the latest release or another installed tree.

## 2. Build and confirm the work queue

Extract required fixes, recommended debt work, adopt-now opportunities, concrete optional verification steps, and explicit record-maintenance actions. A verification recommendation must identify a useful check, not merely mention an untested surface.

Exclude unchanged coverage, unrelated pre-existing defects/TDRs, and recorded defer/skip decisions unless the user explicitly reopens them. A TDR's unblocked, partial or inconclusive disposition is not itself authorization for every remaining task. Include the concrete actions the assessment recommends.

Independently confirm each candidate against the current code, target host and owning documentation. Capture the recommended approach, affected files, dependencies, acceptance criteria, validation and safety boundaries. Use report evidence as a lead, not proof; inspect version-specific installed docs/source and bounded behavior where needed, without repeating the release audit.

| Disposition | Required follow-up |
| --- | --- |
| Confirmed pending | Implement and validate. |
| Already addressed | Verify current behavior; reconcile stale status, not duplicate implementation. |
| Stale/invalid recommendation | Record evidence and correct the assessment; do not implement it. |
| Partial/blocked/needs decision | State exactly what remains, continue independent work, and obtain the minimum missing input. |

Recommended local changes define the work list, not extra authority. Retirement, configuration-dependent adoption or other excluded actions need specific authorization; record that dependency rather than silently performing or dropping the recommendation. Unaffected authorized parts may proceed.

Use the recommended approach even when alternatives are listed. Ask only if current evidence, documentation or user restrictions leave a material product/security/support-policy choice unresolved, contradict the recommendation, or require authority outside the skill's bounds. Do not reopen a settled choice or request routine plan approval.

## 3. Order, delegate and integrate

Resolve actual dependencies first, including stale validation infrastructure before downstream acceptance. A known failure with a planned in-scope remedy is work to perform, not itself a blocker.

- Delegate implementation to a **worker** with a focused item, acceptance criteria, file ownership, verified roots, relevant docs, safety/scratch prerequisites and exclusions. Children do not stage, commit or delete TDRs.
- Use a **different agent** for independent review against the requirements and safety contracts. A reviewer may be source-only; label that evidence accordingly. When independent execution is needed, use a non-implementing worker as verifier with no repository edits and only approved scratch writes. Review and verification may share one independent agent if it has the necessary tools.
- Respect active agent policy and limits. Call `subagent` directly; models/thinking stay settings-owned. Do not change policy or use project-controlled agents merely to obtain delegation.
- Parallelize only independent work with disjoint writable files. Shared reports, TDRs/indexes and overlapping manifests/guides belong to the parent; children propose those edits. Integrate, accept and commit items sequentially. Do not attribute a combined working-tree gate to an isolated item or commit without qualifying what else was present.
- The parent checks child claims, reconciles disagreements, removes duplicates, resolves follow-ups and owns final status and commits. Implementer logs are not independent execution. If delegation is unavailable, continue permitted sequential work and parent-run checks, but record the missing independence. Substantive executable changes and TDR closure require independent review before acceptance; without it keep the item partial and uncommitted. Independent execution is additionally required when the owning criteria demand it; parent execution plus separate source review is otherwise acceptable when labeled accurately. Ask for the minimum missing verification, never claim it occurred.

## 4. Implement to acceptance

1. Establish a current failure baseline before executable changes where practical. Reproduce the focused defect and inspect the documented gate; qualify reused audit results by version and repository state. Do not label a failure pre-existing merely because the report once had a red gate.
2. Add/update focused tests first, observe the expected failure, then implement the smallest supported remedy. Existing red acceptance checks may supply the regression. If test-first is impractical, explain why and use another validation method. Docs/comments/configuration-only work and mechanical refactors need no artificial red test; executable refactors still need validation.
3. Preserve positive requirements, safety boundaries and intentional policy. Never delete or weaken assertions, introduce skips, freeze a defect as intended behavior or blindly bump version expectations to get green results. Promote verified diagnostic requirements into normal tests without duplicating fixtures or losing their checks.
4. A copied host adapter cannot independently detect host changes. Compare it with the actual selected host and prefer public integration seams. Keep necessary private-method probes scratch-only, version-checked and explicitly qualified; never add private installed-host imports to production or retained tests, or patch the installed host.
5. Update user guides for behavior/usage/support changes and maintainer documents for technical contracts and validation. Keep session/review narratives, temporary audit/work-package references, pass counts and scratch-artifact paths out of READMEs and durable maintainer notes.
6. Obtain independent review/verification, implement justified refinements and rerun affected checks. Accept only when the item's actual criteria are met. Required full-gate or cross-item acceptance cannot be replaced by a narrower focused pass.

If acceptance depends on another planned remedy, complete that dependency before declaring success. Keep intermediate work accurately partial. Prefer dependency ordering; if changes truly cannot be separated, integrate them as one coherent unit, explain the original item IDs and do not relax any criterion.

## 5. Validate safely

Discover current commands, environment and prerequisites from manifests, owning guidance and harnesses. Run focused checks per item, the documented typecheck/full test gate before commits when practical, and any separate positive diagnostics/TDR-specific checks that still exist. Do not require historical scripts, extensions, counts or paths. Retiring a diagnostic requires updating its callers, scripts and documentation.

**Host setup:** verify resolution for both declarations and runtime tests. Routine documented host-link refresh is allowed only for verified packages supplied by the selected installed host under the repository's extension dependency tree. Inspect the utility first; verify canonical parent containment; create missing links or refresh symlinks only; rerun the non-mutating check and preserve one host-selection environment. Do not replace real files/directories, switch installs or broaden setup. Item-required local manifest edits are distinct from executing installs; dependency installation/upgrades or lockfile regeneration need separate authorization.

**Scratch:** reuse scratch already authorized by session/caller instructions, including Pi's supplied ready scratch, without asking again. Verify the current harness's canonical path, ownership, private mode, containment and readiness-marker requirements. Validate an existing marker; create a missing one only within the verified authorized root. Place fixtures and subprocess artifacts in approved descendants. Never modify the managed root itself, substitute personal HOME/repository scratch or bypass safety checks. If authorization or safety is missing, request the precise setup rather than repairing the root.

**Isolation:** use disposable/in-memory sessions, isolated configuration and bounded processes/output. Do not use personal sessions or credentials as fixtures. Live/paid/provider/MCP or hardware checks need separate authorization. If required acceptance needs such a check, keep the item/TDR partial or blocked and name the authorization or manual step. Record optional or expressly practical-limit checks as unclaimed only when the actual criteria permit it.

**Results:** distinguish new regressions, confirmed baseline failures and planned remaining remedies; inspect mixed nonzero results rather than treating all failures as one cause. Known in-scope failures must be worked through. Unrelated failures remain explicit validation limits, not new implementation scope, and no red gate is called green. If an owning criterion requires a clean gate, do not claim completion without it.

After all implementations are integrated, run the complete discovered gate again. Record exact commands, selected host/environment, outcomes and remaining gaps; earlier or implementer-only logs cannot substitute for fresh final evidence. Keep secrets, personal data and full environment/settings dumps out of every artifact.

## 6. Update the retained assessment

After each accepted item, update its primary finding and current resolution status in the same retained three-report set. Commit these updates with the item. Also reconcile partial, already-addressed, stale and blocked dispositions when known; do not leave discoveries only in chat.

- Keep original audit-time observations as clearly labeled, version-bound history. Add current follow-up evidence rather than presenting old red results as current or erasing useful provenance.
- Give each outcome one primary home and cross-reference it. Keep all three headers, current/category status, TDR rows and links consistent. Superseded recommendations must not still read as pending work.
- Evidence must stand without scratch logs: summarize change, acceptance/regression, exact checks and results with version/state/scope, execution versus inspection, review/verification independence and unclaimed limits. Point-in-time counts belong in the assessment, not durable guides. Prior commit hashes may be useful; do not amend a commit to embed its own hash.
- A compact follow-up row can use: `Item | Disposition | Change/acceptance | Checks and independence | Remaining limits`.

## 7. Resolve TDRs without an archive

Read the owning closure criteria before deciding status. Host unblock, partial improvement and full resolution are separate outcomes. A skipped check permits closure only if the criteria expressly allow that practical limit; do not weaken, silently reinterpret or amend acceptance merely to close the record.

For complete resolution:
1. Preserve a concise resolution summary, acceptance evidence and practical limits in the retained assessment. Keep durable maintenance contracts in their normal home, not a copy of the TDR.
2. Verify the record is tracked and its relevant content is preserved in committed history or the resolution evidence. Preserve any new evidence before deletion; if the record is untracked or has unrelated user-owned edits that cannot be safely separated, keep it and ask. Delete only the fully resolved record, remove its index entry and update current revalidation notes.
3. Repair inbound links and stale identifier references in documents and source comments. Historical mentions may remain if clearly historical and not dangling evidence dependencies.
4. Check links and remaining index entries against actual files. Create no archive; committed history retains the deleted record.

For partial progress, keep the record with accurate status, evidence and remaining work, and align its index row. Do not edit unrelated TDRs. When several items satisfy one TDR, closure belongs with the change satisfying its last required criterion.

## 8. Commit and continue

Create one coherent commit atop HEAD per accepted item, including implementation, tests, docs, reports and affected TDRs. The parent inspects status/staged diffs and stages only the intended changes. Explicit paths alone do not isolate unrelated edits within a shared file; use selective staging when necessary.

Preserve user-owned changes and existing staged data. List blocked items' uncommitted partial work in the assessment and final response, and exclude it from other item commits. If overlapping edits cannot safely be separated, leave the whole item uncommitted and ask a focused question. Never discard working-tree/index/stash data or rewrite history. Do not push without a separate explicit request. Honor `do not commit` and other restrictions throughout.

Already-addressed items require no implementation or empty commit. Necessary record-only reconciliation may be folded into an appropriate item commit, or a nonempty assessment-status commit. Final gate evidence and residual status/link corrections can likewise use a final record-only commit; explain it briefly. Do not amend earlier commits. Repair any later invalidation with new work and accurate status.

Continue autonomously to the next item. For a genuine blocker or unresolved decision, preserve completed work, update the assessment with the precise issue and evidence, continue independent work where safe, and ask through the available clarification mechanism. Offer a recommendation and only the minimum input needed; resume idempotently after the answer.

Before finishing, check every in-scope disposition, report consistency, TDR closures/references, final gate evidence, commits and intended working-tree leftovers. Confirm no unauthorized install, configuration change, external operation or push occurred and no history/user data was discarded. Finish concisely with dispositions, hashes, verification/independence and limits, deleted TDRs and remaining blockers. Do not execute this workflow while maintaining the skill itself.
