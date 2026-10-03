# 0013: Correct footer theme/documentation drift

- **Status:** Open — definite presentation/docs corrections; lifecycle concerns remain verify-first
- **Priority:** Low
- **Evidence:** Color/docs/theme-refresh behavior source-verified; practical setup-error and stale-context failures not reproduced
- **Areas:** `response-timer`, `shared`; `mcp-status` for existing refresh/lifecycle compatibility
- **Instructions:** [Package workflow and validation](README.md)

## Current disposition and implementation scope

| Subfinding | Disposition | Remaining action |
|---|---|---|
| Finished checkmark uses a muted token despite the green promise | Definite, inexpensive correction | Use semantic `success` coloring and remove the fixed-shade promise. |
| Shared README omits MCP | Definite documentation correction | Add MCP to the managed order and consumer list without changing keys/order. |
| Idle statuses retain old ANSI colors after a theme change | Accepted host/API limitation to document | Describe refresh-on-next-write; preserve MCP's existing polling, with no new polling or private listeners. |
| Timer could keep ticking after pre-run setup failure | Verify-first, deprioritized | Reproduce a reachable host failure before changing lifecycle behavior. |
| Interval callback could access a stale context | Verify-first, deprioritized | Establish a reachable lifecycle failure before adding guards or generation tracking. |

The inspected setup uses a fixed dark theme, so idle recoloring has little current impact. Pi-managed shutdown/reload emits `session_shutdown` before invalidating contexts (`HOST/dist/core/agent-session-runtime.js`; `HOST/dist/core/agent-session.js`, `reload`), and both extensions already stop intervals in their shutdown handlers. A pre-run setup window exists in source, but the review did not demonstrate a practical failure in it. Neither observation is proven impossible or fixed.

Put the shared status-color refresh contract in directory-local maintenance documentation, with a short response-timer troubleshooting note if useful to users. No TDR is needed for cosmetic drift or this accepted theme limitation. The lifecycle observations remain here as qualified follow-ups, not requirements for completing the definite corrections.

This disposition is source/docs review only; no new lifecycle reproduction or tests were run. Historical re-checks below do not override this narrowed scope.

## Related observations

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

## Validation

`node --test response-timer/index.test.ts mcp-status/index.test.ts shared/footerStatus.test.ts`; `npm run verify` with approved scratch for the token change. Docs-only edits need consistency/link review rather than the full executable gate. If lifecycle work is reopened, record the actual host reproduction and any unsupported-seam limits separately.

## Historical re-checks

### Re-check after 0010

**Status remains Open.** Source re-check confirms 0010 changes configuration projection/cache scope, not lifecycle handlers or stale-context boundaries. Existing footer/timer tests pass, but do not verify this package's setup-error/stale-context acceptance criteria; no status promotion is justified. See [0010's resolution](0010-mcp-status-config-drift.md#resolution-and-validation).

Related: [0010: MCP config projection](0010-mcp-status-config-drift.md); coordinate changes to mcp-status without conflating config semantics with status lifecycle.
