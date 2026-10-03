# 0014: Honor project scope in shared or custom session storage

- **Status:** Open — project identity safeguard actionable; all-projects storage policy requires a decision
- **Priority:** Medium for shared/custom storage; latent in the inspected default-layout setup
- **Evidence:** Selection/root assumptions source-verified; no real Trash reproduction performed
- **Area:** `agent/extensions/trash-history`
- **Instructions:** [Package workflow and validation](README.md)

## Current disposition and implementation scope

Current-project selection safety is worth fixing, not dismissing or addressing only through documentation. Validated session-header cwd must constrain project membership both when selecting and when revalidating candidates. A shared containing directory is not proof of membership. Existing containment, confirmation, active-file, cutoff, and named-session safeguards do not enforce that boundary.

Keep this minimal safeguard separate from comprehensive custom-root support. The active manager's `getSessionDir()` is observable through the public extension context, but is not necessarily the configured storage root: opening/resuming a session may make it the file's parent. CLI storage overrides are not directly exposed through that context. `SessionManager.usesDefaultSessionDir()` is absent from the public `ReadonlySessionManager` type; do not cast/import private host state to invent reliable configuration detection.

### Decision required before all-projects implementation

The original requirement to always use the effective configured root is not a settled, publicly achievable contract. Choose explicitly before changing all-projects behavior:

1. **Support custom storage:** establish a safe supported source for the intended root, define flat/tree traversal and opened-session behavior, and then test that contract.
2. **Refuse unsupported/unknown storage:** define how the supported default layout is safely established, and fail closed when the intended scope cannot be determined.
3. **Retain conventional-root scope:** deliberately define `--all-projects` as the conventional global store, not the custom store, and make that boundary explicit in the README, preview, and confirmation.

The preferred safety fallback is refusal when the intended scope cannot be established; this document does not choose an all-projects product policy or claim that every custom configuration is detectable. Do not silently implement one of these branches. The current-project safeguard can be completed independently while the root-policy decision remains open.

Document the selected supported layouts and limitations in the Trash-history README. Full custom-root support can be deferred; create a TDR only if that capability is required and intentionally retained as debt. A TDR is not a substitute for fixing project selection safety.

This disposition is source/docs review only; no new storage integration tests or real file-moving operations were run.

## Problem and evidence

Pi supports `sessionDir`, `PI_CODING_AGENT_SESSION_DIR`, and `--session-dir`. A custom directory can be flat and contain sessions from multiple cwd values; host session listing filters by stored cwd (`HOST/dist/core/session-manager.js`, session listing).

Trash-history uses `ctx.sessionManager.getSessionDir()` for current-project scope (`index.ts:818-824`) and assumes the directory is project-specific. `inspectCandidate()` (`:307-345`) reads and retains header cwd, but does not compare it to the running project's cwd. In a flat custom directory it can include other projects. All-projects instead uses `join(getAgentDir(), "sessions")` (`:115`), ignoring custom storage.

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
