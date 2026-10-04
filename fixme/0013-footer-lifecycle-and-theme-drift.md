# 0013: Correct footer theme/documentation drift

- **Status:** Resolved — presentation/docs scope; lifecycle concerns remain verify-first and deprioritized
- **Priority:** Low
- **Evidence:** Semantic color correction verified test-first; docs/theme-refresh contract source-verified and documented; practical setup-error and stale-context failures not reproduced
- **Areas:** `response-timer`, `shared`; `mcp-status` for existing refresh/lifecycle compatibility
- **Instructions:** [Package workflow and validation](README.md)

## Current disposition and implementation scope

| Subfinding | Disposition | Remaining action |
|---|---|---|
| Finished checkmark semantic coloring | Resolved | Uses `success`; README describes semantic coloring without a fixed-shade promise. |
| Shared README omitted MCP | Resolved | MCP is documented in the managed order and consumer list; runtime keys/order are unchanged. |
| Idle statuses retain old ANSI colors after a theme change | Accepted host/API limitation, documented | Shared maintenance describes refresh-on-next-write and MCP's existing polling; no new polling or private listeners. |
| Timer could keep ticking after pre-run setup failure | Verify-first, deprioritized | Reproduce a reachable host failure before changing lifecycle behavior. |
| Interval callback could access a stale context | Verify-first, deprioritized | Establish a reachable lifecycle failure before adding guards or generation tracking. |

The inspected setup uses a fixed dark theme, so idle recoloring has little current impact. Pi-managed shutdown/reload emits `session_shutdown` before invalidating contexts (`HOST/dist/core/agent-session-runtime.js`; `HOST/dist/core/agent-session.js`, `reload`), and both extensions already stop intervals in their shutdown handlers. A pre-run setup window exists in source, but the review did not demonstrate a practical failure in it. Neither observation is proven impossible or fixed.

The shared status-color refresh contract is now in [directory-local maintenance](../agent/extensions/shared/maintenance.md#footer-status-color-refresh), linked briefly from the shared README and response-timer troubleshooting note. No TDR is needed for cosmetic drift or this accepted theme limitation. The lifecycle observations remain here as qualified follow-ups, not requirements for completing the definite corrections.

The lifecycle disposition remains source/docs review only. The focused validation below does not reproduce a reachable host lifecycle failure. Historical re-checks below do not override this narrowed scope.

## Original related observations

The following records the pre-correction evidence; the muted token and shared README omissions are now corrected.

1. `response-timer/index.ts:51` uses `syntaxComment` for the finished checkmark. Current dark/light/system themes make that muted, while its README promises darker green.
2. The timer starts an interval in `before_agent_start` (`:122`). Host setup can fail before entering the run-finally block that emits `agent_settled`; this could leave a ticking status. This path is source-derived, not reproduced end to end.
3. `response-timer` and `mcp-status` intervals capture extension contexts and have no stale-context exception boundary. Normal shutdown stops them. A synthetic stale callback can probe robustness, but does not establish that the managed host lifecycle reaches that state.
4. Status producers store already-colored ANSI text via `setStatus`. A theme change cannot recolor those strings until they are rewritten. MCP's polling refresh helps; a stopped timer and other idle indicators can remain in old colors.
5. `shared/README.md` omits MCP from the managed display order and consumers, although `shared/footerStatus.ts` includes it.

These observations share a footer owner, but the definite presentation/docs corrections and speculative lifecycle hardening are separate work tracks.

## Reproduce / test first

For the definite correction, assert the semantic `success` token with an injected marker theme and check the installed host theme/type contract. Do not require a private built-in theme loader. Compare the shared README's order and consumers to `FOOTER_STATUS_ORDER` and the actual producers.

Preserve tests for timer completion at `agent_settled`, shutdown cleanup, and MCP's existing theme refresh. An optional focused response-timer test can invoke a saved fake tick after shutdown and assert no status write; that is a local regression, not proof of a real queued-callback failure.

If lifecycle work is reopened, first demonstrate a reachable host setup failure or context invalidation path. Injected throwing callbacks alone are insufficient to promote the concern to a reproduced runtime defect.

## Recommended fix and scope

- Use a semantic `success` token for the finished indicator and describe semantic coloring rather than a fixed shade.
- Add MCP to the shared README's order and consumer list.
- Document that stored status colors refresh on the next write; MCP already refreshes through its existing polling. Do not add permanent polling, private theme listeners, or a custom footer replacement.
- Preserve current timer start/duration semantics and settlement behavior. Moving live updates to `agent_start`, broad exception handling, and generation tracking are not part of the definite correction.
- If a lifecycle failure is later reproduced, scope its remedy separately and preserve duration semantics explicitly.

## Acceptance criteria

- Finished coloring uses `success` and matches semantic-color documentation.
- Shared README order/consumers include MCP; footer ordering/status keys remain unchanged.
- Documentation states the refresh-on-next-write limitation and distinguishes MCP's existing periodic refresh.
- Existing start/duration semantics, shutdown cleanup, and completion at `agent_settled` remain unchanged, including retries/compaction/queued work.
- No new polling, private theme APIs, or custom footer replacement is introduced.
- Completing these corrections does not claim to resolve or guarantee the unreproduced lifecycle paths; retain their qualified disposition.

## Resolution and validation

Implemented only the definite presentation/documentation scope against installed **Pi 1.0.0**, Node **v22.19.0**:

- `response-timer/index.ts` now uses bold semantic `success` for the stopped checkmark, retaining `accent` for the running symbol and `dim` for the duration. Its narrow theme type follows the token change; no timer startup, duration, settlement, or cleanup logic changed.
- The response-timer README replaces the darker-green promise with theme-dependent semantic-color wording and explains stopped-versus-running recoloring.
- The shared README includes MCP between subagents and response timer and lists `mcp-status/index.ts` as a consumer. `shared/footerStatus.ts`, status keys/order, and all MCP runtime code are unchanged.
- [Shared maintenance](../agent/extensions/shared/maintenance.md#footer-status-color-refresh) owns the refresh-on-next-write contract and distinguishes MCP's existing once-per-second polling from the timer's running-only interval and event-driven idle producers. No new polling, private theme listener, custom footer, exception boundary, or generation tracking was introduced.

Actual validation:

1. **Test-first red:** updated the existing injected marker-theme formatter regression before changing runtime code. `node --test response-timer/index.test.ts` reported **3 passed, 1 failed**, specifically the old `syntaxComment` output versus expected `success`.
2. **Focused green:** from `agent/extensions/`, `node --test response-timer/index.test.ts mcp-status/index.test.ts shared/footerStatus.test.ts` reported **19 passed** (4 timer, 13 MCP, 2 shared), with **0 failed/cancelled/skipped**. This preserves local coverage of start/reset timing, final completion at `agent_settled`, shutdown interval cleanup, MCP theme recoloring on an existing poll, and footer ordering/legacy cleanup. It is not end-to-end retry, compaction, or queued-work validation.
3. **Typecheck:** `npm run typecheck` passed, including the read-only check of all **five valid host dependency links** and TypeScript `--noEmit`. No dependency or link repair was performed.
4. **Documentation consistency:** read-only assertions matched the README's six-status order to `FOOTER_STATUS_ORDER`, verified all six consumer paths, semantic timer wording, relative Markdown link targets, and the shared refresh anchor. Final scoped diff review confirms the token/type-only runtime change.
5. **Installed contract review:** read the installed extension, theme, and TUI documentation, the status-line example, and relevant declarations/source. `ThemeColor`/`Theme.fg()` accept `success`; TUI docs explicitly explain that a redraw cannot remove old ANSI colors embedded in application state. The public UI's current-theme getter, stored status strings, and key sorting match the documented contract. A read-only scout independently corroborated producer refresh triggers and the MCP omission; it ran no tests or probes.

The caller-approved session scratch root was created privately with the `.step1-test-root-ready` sentinel. Both `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR` used its canonical real path, keeping logs and temporary artifacts outside HOME/repository/cwd.

### Remaining dispositions and skipped validation

- **Presentation/docs scope is resolved;** immediate idle recoloring remains an accepted limitation, not a new runtime fix.
- **Setup-error and stale-context concerns remain verify-first and deprioritized.** Normal shutdown/reload cleanup is source-supported and local cleanup tests pass; no reachable host failure was reproduced or ruled out. Reopen lifecycle changes only with a real host reproduction and a separately scoped remedy preserving duration semantics.
- **Full `npm run verify` / all-tests gate was deliberately not run:** reserved for integration while other sessions are active. The focused suite and typecheck above are the executed checks, not a full-gate claim.
- No new optional post-shutdown fake-tick test or lifecycle probe was added. The existing MCP fake-tick test is local coverage, not reproduction of a real queued-callback host failure.
- No live-terminal theme switch, provider call, enabled MCP connection, `/reload`, settings/configuration/dependency/host-link change, commit, or Git branch/index operation was performed. `fixme/README.md` was intentionally left unchanged under the caller's write ownership; unrelated concurrent changes were preserved.

## Historical re-checks

### Re-check after 0010

**Status remains Open.** Source re-check confirms 0010 changes configuration projection/cache scope, not lifecycle handlers or stale-context boundaries. Existing footer/timer tests pass, but do not verify this package's setup-error/stale-context acceptance criteria; no status promotion is justified. See [0010's resolution](0010-mcp-status-config-drift.md#resolution-and-validation).

Related: [0010: MCP config projection](0010-mcp-status-config-drift.md); coordinate changes to mcp-status without conflating config semantics with status lifecycle.
