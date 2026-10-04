# 0014: Honor project scope in shared or custom session storage

- **Status:** Open — current-project identity safeguard complete; all-projects storage policy still requires a decision
- **Priority:** Medium for shared/custom storage; latent in the inspected default-layout setup
- **Evidence:** Current-project defect reproduced test-first with disposable fixtures and recorded executors; host contracts source-verified; no real Trash operations performed
- **Area:** `agent/extensions/trash-history`
- **Instructions:** [Package workflow and validation](README.md)

## Current disposition and implementation scope

The current-project identity safeguard is implemented: validated session-header cwd now constrains project membership during selection and immediate-before-action revalidation, including archive selection. A shared containing directory is not proof of membership. The existing containment, confirmation, active-file, cutoff, named-session, archive, and no-UI safeguards remain in place. This is partial completion, not resolution of the all-projects storage-policy finding.

Keep this minimal safeguard separate from comprehensive custom-root support. The active manager's `getSessionDir()` is observable through the public extension context, but is not necessarily the configured storage root: opening/resuming a session may make it the file's parent. CLI storage overrides are not directly exposed through that context. `SessionManager.usesDefaultSessionDir()` is absent from the public `ReadonlySessionManager` type; do not cast/import private host state to invent reliable configuration detection.

### Decision required before all-projects implementation

The original requirement to always use the effective configured root is not a settled, publicly achievable contract. Choose explicitly before changing all-projects behavior:

1. **Support custom storage:** establish a safe supported source for the intended root, define flat/tree traversal and opened-session behavior, and then test that contract.
2. **Refuse unsupported/unknown storage:** define how the supported default layout is safely established, and fail closed when the intended scope cannot be determined.
3. **Retain conventional-root scope:** deliberately define `--all-projects` as the conventional global store, not the custom store, and make that boundary explicit in the README, preview, and confirmation.

The preferred safety fallback is refusal when the intended scope cannot be established; this document does not choose an all-projects product policy or claim that every custom configuration is detectable. Do not silently implement one of these branches. The current-project safeguard is complete independently; the root-policy decision remains open.

Document the selected supported layouts and limitations in the Trash-history README. Full custom-root support can be deferred; create a TDR only if that capability is required and intentionally retained as debt. A TDR is not a substitute for fixing project selection safety.

The original disposition was source/docs review only. The current-project implementation and actual validation are recorded below; no all-projects policy has been selected.

## Current-project completion and validation

### Implemented safeguard

- The command uses public `ctx.cwd` as the running-project identity. `getSessionDir()` supplies only the scan directory; it is not treated as proof of project membership or as an effective configured global root. Production code uses no unsupported context methods, private host state, or configuration-detection casts.
- Both identities must be unambiguous absolute POSIX paths. Normalization collapses repeated internal separators, `.` components, and trailing separators only. It rejects leading `//`, any `..` component (symlink-sensitive), empty/relative values, control characters, backslashes, and leading/trailing whitespace. It does not resolve filesystem aliases, fold case, normalize Unicode, expand `~`, or guess a base from directory names.
- Missing/non-string header cwd remains `malformed`. Unusable string identities are reported as `projectIdentity`; valid but different projects as `projectMismatch`. Filtering happens before cutoff/named accounting, so excluded sessions do not inflate named-session totals. An unavailable, ambiguous, or throwing running-cwd read fails closed.
- The same check is applied by scan inspection and candidate revalidation. The command reads the public running cwd again for archive-source selection and every serial Trash action, including after a verified archive. Existing observable file drift still reports `changed` before metadata policy checks.
- Shared custom directories and opened/resumed-session shared parents are covered without expanding traversal. The README documents conservative exclusions and remaining storage limitations.

### Executed validation

From `agent/extensions/`, with an approved private scratch root and canonical `TMPDIR`/`PI_PERMISSIONS_TEST_SCRATCH_ROOT`:

- Test-first `node --test trash-history/index.test.ts`: **29 passed, 11 failed**, reproducing the missing identity constraints before executable changes.
- Final focused rerun of the same command: **40 passed**, **0 failed/cancelled/skipped**.
- `npm run typecheck`: passed, including the read-only check of all five existing host-package links and `tsc -p tsconfig.json --noEmit`. No links or dependencies were changed.

Fixtures cover mixed cwd, malformed/ambiguous identities, conservative spelling equivalence and alias exclusions, active/named/cutoff rules, default-layout misfiled sessions, unchanged-snapshot membership revalidation, header drift after confirmation, running-identity change/loss/throw before actions, archive-source filtering, and post-archive revalidation. The opened-session shared-parent case uses public `SessionManager.open()` on disposable JSONL plus a command-context harness; no live `/resume` integration was run. Existing all-projects regression coverage was tightened only to demonstrate unchanged behavior without reading `ctx.cwd`, not to select or validate a new storage policy.

All executor calls were injected/recorded. Archive fixtures use placeholder ZIP bytes and synthetic ZIP/unzip responses to test selection, ordering, and failure boundaries, not actual ZIP-tool integration. No real Trash, actual session files, personal settings, provider/MCP calls, or live UI were used.

A read-only scout verified the installed public identity/opening contracts; an independent read-only reviewer found no blockers and requested small non-vacuity, throwing-cwd, all-projects-independence, and README clarifications. Those refinements were applied before the final parent-run tests/typecheck. Neither subagent ran tests; the reviewer did not re-review the refined state.

The full `npm run verify` gate is deliberately left to integration. `fixme/README.md` was not edited, per this change's ownership boundary.

### Still pending — all-projects policy

`--all-projects` runtime behavior is unchanged: it uses `join(getAgentDir(), "sessions")` and the existing flat/direct-child traversal and metadata policy. The choices above remain undecided. There is no comprehensive custom-root support or effective-configured-root guarantee. The in-command help's broad “every Pi project” wording and any policy-specific preview/confirmation changes remain for the explicit all-projects decision. This document stays **Open**; only current-project completion is recorded here.

## Original problem and evidence

Pi supports `sessionDir`, `PI_CODING_AGENT_SESSION_DIR`, and `--session-dir`. A custom directory can be flat and contain sessions from multiple cwd values; host session listing filters by stored cwd (`HOST/dist/core/session-manager.js`, session listing).

Before this safeguard, Trash-history used `ctx.sessionManager.getSessionDir()` for current-project scope (audit baseline `index.ts:818-824`) and assumed the directory was project-specific. `inspectCandidate()` (baseline `:307-345`) read and retained header cwd, but did not compare it to the running project's cwd. In a flat custom directory it could include other projects. All-projects used, and still uses, `join(getAgentDir(), "sessions")` (baseline `:115`), ignoring custom storage.

The same containing-directory assumption can fail after `--session <path>` or `/resume`: `SessionManager.open()` derives the session directory from the file's parent when no session directory is supplied (`HOST/dist/core/session-manager.js:1326-1346`). A session opened from shared storage can therefore expose this issue without a configured custom root.

The inspected settings/layout use ordinary per-project storage, and the inspected process has no session-dir environment override. The shared-directory scenario is latent in that setup, but directory layout is still not an identity guarantee.

## Reproduce / test first

Create a disposable custom directory containing valid, old JSONL sessions for two cwd values plus the active session. Run the command through injected dependencies with dry-run/recorded executor, never real Trash.

Assert current-project includes only the running project's validated cwd identity, including when the active session was opened from a shared directory. Cover missing, empty, relative, or malformed cwd values; named sessions; active-session protection; the default per-project layout; and project filtering at the revalidation boundary.

Add all-projects tests after selecting its storage policy. Cover the chosen traversal/refusal behavior and settings/env/CLI precedence through supported host/session construction only where that policy needs it. Do not assume the manager directory and configured root are interchangeable.

## Recommended fix and scope

- First enforce current-project membership using validated session-header cwd and the running project's public context/session identity. Define conservative normalization explicitly; skip ambiguous identities rather than guessing from a directory name.
- Apply the same membership check during candidate selection and immediate-before-action revalidation, including archive selection.
- Resolve the all-projects policy decision separately; use only supported evidence of the selected storage boundary. Do not scan unrelated ancestors or infer the configured root solely from the active session's parent.
- Preserve existing canonical-path, link, ownership, active-session, revalidation, archive, and no-UI safeguards.
- Fail closed when required project identity or the chosen storage boundary cannot be established safely.
- Update README scope language to match the implemented policy. Documentation alone is not sufficient for the current-project selection bug.

## Acceptance criteria

- Current-project cannot move another project's session merely because both share a directory, whether configured or reached by opening/resuming a session.
- Project membership is enforced at selection and revalidation; malformed/ambiguous identities are skipped safely.
- Default-layout sessions with matching project identity and existing dry-run/audit behavior remain compatible; any newly excluded identities are reported clearly.
- Every actual candidate still passes the existing mutation/revalidation boundary, including archive and active-session safeguards.
- README explains current-project identity filtering and any remaining storage limitation without implying full custom-root support.
- Before all-projects work is declared complete, its policy is explicitly selected, tested, and reflected in user-visible scope/root language. No configured-root guarantee is required unless that policy is chosen.
- Current-project completion and any deferred all-projects/custom-root work are recorded separately; partial completion does not close the whole finding.

## Validation

`node --test trash-history/index.test.ts`; focused mixed-cwd/opened-session and revalidation regressions; policy-specific storage integration tests when practical; `npm run verify` with approved scratch. Use disposable fixtures and recorded executors only, never real Trash.

Related: [0001: visible confirmations](0001-trash-history-fullscreen-confirmation.md) is resolved. Its confirmation safety does not solve incorrect project scope.
