# TDR-0007: Decide the Trash-history all-projects storage policy

- **Status:** Open — policy decision pending
- **Priority:** Medium for shared/custom storage; latent with default per-project storage
- **Created:** 2026-10-04
- **Area:** `agent/extensions/trash-history` (`--all-projects` scope)
- **Origin:** Shared/custom session-storage scope review

## Summary and current state

`/trash-history <days> --all-projects` currently scans the conventional global store, `join(getAgentDir(), "sessions")` (`globalSessionRoot` in `index.ts`), with the existing flat plus direct-child-directory traversal and metadata policy. It does not discover custom storage supplied through `sessionDir`, `PI_CODING_AGENT_SESSION_DIR`, or `--session-dir`.

The current-project identity safeguard is complete and separate: validated session-header cwd must match the running `ctx.cwd` at selection and immediately before each action, including archive selection. A shared containing directory is not project proof. That safeguard does not decide, or fix, all-projects scope.

**No all-projects product policy is selected.** This record does not commit to full custom-root support, and nothing here claims the runtime already provides an effective-configured-root guarantee.

## Constraints

These public-API observations were checked against Pi **1.0.0**. Before revisiting the decision, read the current host session, settings, CLI, and extension documentation and declarations; a newer supported API may change the available choices.

- `ctx.sessionManager.getSessionDir()` is public, but it is not proof of the configured storage root: opening or resuming a session can make it that file's parent.
- CLI storage overrides are not exposed through the public extension context. `usesDefaultSessionDir()` is absent from the public readonly manager type.
- Do not use private host state, private imports, or casts to infer configuration. Do not infer the root from an active session's parent or scan unrelated ancestors.
- Refusal is the preferred safety fallback when a policy-required scope cannot be established, but that is not a selected product policy and does not imply every custom setup is detectable.
- The in-command help still says `--all-projects` includes “every Pi project” (`COMMAND_HELP`, `index.ts:29`). It remains broad until the policy is selected; the README already documents the conventional-root limit.

## Unselected branches

1. **Support custom storage:** identify a supported public source for the intended root; define flat/tree traversal and opened-session behavior.
2. **Refuse unsupported or unknown storage:** define how the supported default layout is safely established, and fail closed when scope cannot be determined.
3. **Explicit conventional-only scope:** keep `--all-projects` as the conventional global store, and say so in help, README, preview, and confirmation.

## Safety boundaries

Preserve canonical containment, link/ownership checks, active-file exclusion, snapshot revalidation, archive verification, confirmation defaults, and no-UI fail-closed behavior. Never add a permanent-delete path. A selected policy must make scope visible before any Trash or archive action.

## Acceptance and closure

Explicitly select the storage policy, then align any required runtime changes with help, README, preview/confirmation, and audit scope language. Add focused policy-specific regressions through supported seams before any executable change:

- Custom: supported root evidence, flat/tree traversal, opened-session parent not mistaken for the root, and precedence only for sources the host publicly supports.
- Refusal: safely established supported layout proceeds; unsupported or unknown scope refuses before scanning or acting. If public evidence cannot establish the layout, refuse rather than promise detection of every custom configuration.
- Conventional-only: scanning stays within the conventional root and supported traversal; no discovery or coverage of custom stores elsewhere is implied, and wording states the boundary.
- All branches: no private host casts; existing safeguards remain covered.

Use disposable fixtures and recorded/injected executors only; never operate on real Trash, session files, or personal settings. Run the focused Trash-history tests and extension typecheck/verification with approved scratch (see the [safe test scratch guidance](../agent/extensions/permissions/README.md#safe-test-scratch-setup)). Close this record only after the chosen policy is reflected in behavior, validated, and documented; current-project completion alone does not close it.
