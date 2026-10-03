# 0014: Honor project scope with custom session storage

- **Status:** Open
- **Priority:** Medium when custom storage is configured; latent in audited setup
- **Evidence:** Source-verified
- **Area:** `agent/extensions/trash-history`
- **Instructions:** [Package workflow and validation](README.md)

## Problem and evidence

Pi supports `sessionDir`, `PI_CODING_AGENT_SESSION_DIR`, and `--session-dir`. A custom directory can be flat and contain sessions from multiple cwd values; host session listing filters by stored cwd (`HOST/dist/core/session-manager.js`, session listing).

Trash-history uses `ctx.sessionManager.getSessionDir()` for current-project scope (`index.ts:809`) and assumes the directory is project-specific. In a flat custom directory it can include other projects. All-projects instead uses `join(getAgentDir(), "sessions")` (`:115`), ignoring custom storage.

The audited user settings do not configure a custom directory, so the ordinary layout is unaffected.

## Reproduce / test first

Create a disposable custom directory containing valid, old JSONL sessions for two cwd values plus the active session. Run the command through injected dependencies with dry-run/recorded executor, never real Trash.

Assert current-project includes only ctx.cwd and all-projects uses the effective configured storage root. Cover settings/env/CLI precedence through host/session construction where practical, named sessions, malformed/missing-cwd headers, and default per-project layout.

## Recommended fix

- Resolve the effective storage location from supported session/context/settings APIs rather than assuming a global default.
- Distinguish the default project-directory tree from custom flat storage.
- Filter current-project candidates using validated session-header cwd identity, not only the containing directory.
- Define all-projects as all valid sessions in the effective configured storage location; do not scan unrelated ancestor directories to find more projects.
- Preserve existing canonical-path, link, ownership, active-session, revalidation, archive, and no-UI safeguards.
- Fail closed if safe scope/root resolution is unavailable; report the limitation rather than guessing.

## Acceptance criteria

- Current-project cannot move another project's session merely because both share a custom directory.
- All-projects uses the configured storage root and still protects the active session.
- Default storage behavior and dry-run/audit reporting remain compatible.
- Malformed/ambiguous session identity is skipped safely.
- Every actual candidate still passes the existing mutation/revalidation boundary.
- README explains custom-directory scope and precedence.

## Validation

`node --test trash-history/index.test.ts`; storage-precedence integration tests if practical; `npm run verify` with approved scratch.

Related: [0001: visible confirmations](0001-trash-history-fullscreen-confirmation.md). Fix confirmation safety first; it does not solve incorrect scope.
