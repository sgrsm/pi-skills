# TDR-20261009-1200: Preserve transient project trust for contained subagent children

- **Status:** Open
- **Priority:** Low
- **Created:** 2026-09-22
- **Area:** `agent/extensions/subagent`
- **Origin:** Pi 0.87.0 extension compatibility audit

## Summary

The subagent extension correctly prevents parent project trust from crossing into external child working directories. For a child contained within the parent working directory, however, it currently expresses trust only by omitting `--no-approve`.

Omitting that flag lets a child process use a persisted trust decision, but it does not explicitly carry a trust decision that exists only in the parent process, such as a temporary interactive decision or a parent started with `--approve`. A non-interactive child can consequently treat the contained project as untrusted and omit project-local resources.

This is not a Pi 0.87.0 regression or upgrade blocker. It is a pre-existing process-boundary gap exposed while auditing child Pi invocation behavior.

## Evidence

`agent/extensions/subagent/index.ts:1889-1904` constructs child arguments as follows:

```ts
const args: string[] = ["--mode", "json", "-p", "--no-session"];
if (externalChildCwd) args.push("--no-approve");
```

`agent/extensions/subagent/index.ts:1938-1944` derives whether the child is external from the canonical cwd boundary and passes only that boolean into argument construction. It does not pass the parent context's current `ctx.isProjectTrusted()` result.

Tests at `agent/extensions/subagent/projectTrust.test.ts:280-310` verify that:

- external children receive `--no-approve`; and
- contained children do not receive `--no-approve`.

They do not verify propagation of a temporary trusted state through `--approve` or an equivalent explicit mechanism.

## Affected scenario

The gap can appear when all of the following are true:

1. The parent project is trusted for the current process but the decision is not persisted.
2. A subagent child runs in the parent cwd or a canonically contained child cwd.
3. The child needs trusted project-local settings, agents, extensions, or other resources.
4. The child runs non-interactively and cannot prompt to recreate the decision.

Persisted trust decisions and user-scoped agents that do not require project resources are unaffected.

## Consequences

- A contained child may silently omit trusted project settings or resources that were available to the parent.
- Nested delegation using `agentScope: "project"` or `"both"` can behave differently from the trusted parent session.
- The current name `reusesParentProjectTrust` can imply stronger propagation than the child process actually receives.
- A naive fix could create a security regression if approval were propagated to an external or symlink-escaped cwd.

## Proposed remediation

1. Represent child approval behavior explicitly rather than as only `externalChildCwd: boolean`, for example:
   - force untrusted (`--no-approve`);
   - inherit persisted/default resolution (no flag);
   - force trusted for this child (`--approve`).
2. Derive that behavior from both:
   - canonical cwd containment; and
   - the parent context's current `ctx.isProjectTrusted()` value.
3. Pass `--approve` only when the child cwd is canonically contained and the parent context is currently trusted.
4. Continue passing `--no-approve` for external, unresolved, or symlink-escaped child paths.
5. Confirm the intended Pi CLI contract before implementation so explicit approval does not broaden trust beyond the already trusted parent boundary.
6. Update the subagent README to distinguish persisted trust from process-local trust propagation.

## Acceptance criteria

- A trusted parent with a canonically contained child passes an explicit child trust decision.
- An untrusted parent does not implicitly approve a contained child.
- External and unresolved child paths always receive `--no-approve`.
- A symlink that escapes the parent cwd is still classified as external and never receives approval.
- Project-local child settings and agents are available under temporary parent trust for contained paths.
- Tests cover persisted/default trust, temporary trust, untrusted parents, external paths, and symlink escapes.
- The full extension typecheck and test suite pass.

## Security constraint

Trust must never be propagated based on lexical path prefixes alone. Existing real-path containment and fail-closed handling for external or unresolvable paths must remain in place.
