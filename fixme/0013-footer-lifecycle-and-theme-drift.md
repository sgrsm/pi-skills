# 0013: Harden footer status lifecycle and correct theme/documentation drift

- **Status:** Open
- **Priority:** Low
- **Evidence:** Color/docs source-verified; setup-error and stale-context paths need focused reproduction
- **Areas:** `response-timer`, `mcp-status`, `shared`; other status producers only for the same theme contract
- **Instructions:** [Package workflow and validation](README.md)

## Related observations

1. `response-timer/index.ts:51` uses `syntaxComment` for the finished checkmark. Current dark/light/system themes make that muted, while its README promises darker green.
2. The timer starts an interval in `before_agent_start` (`:122`). Host setup can fail before entering the run-finally block that emits `agent_settled`; this could leave a ticking status. This path is source-derived, not reproduced end to end.
3. `response-timer` and `mcp-status` intervals capture extension contexts and have no stale-context exception boundary. Normal shutdown stops them, but late callbacks need deterministic lifecycle tests.
4. Status producers store already-colored ANSI text via `setStatus`. A theme change cannot recolor those strings until they are rewritten. MCP's polling refresh helps; a stopped timer and other idle indicators can remain in old colors.
5. `shared/README.md` omits MCP from the managed display order and consumers, although `shared/footerStatus.ts` includes it.

These belong together because they affect the shared footer-status lifecycle/presentation contract, not the underlying tools.

## Reproduce / test first

Use injected clock/intervals to simulate before-agent-start followed by setup failure without agent_start/settled, shutdown with an already-queued callback, repeated sessions/reload, and stale ctx.ui.setStatus throwing.

Use actual host themes for the finished token, not only a marker theme. Change the injected theme after settlement and verify/document refresh behavior. Compare shared README order to FOOTER_STATUS_ORDER.

## Recommended fix

- Use a semantic `success` token for the finished indicator and describe semantic coloring rather than a fixed shade.
- Do not start a perpetual interval before the host has entered a lifecycle guaranteed to settle. Prefer live updates from `agent_start`; optionally record accepted-input time beforehand without presenting an endlessly running response. Preserve duration semantics explicitly.
- Stop timers idempotently and guard late callbacks by session/generation identity. On stale-context failure, stop the interval instead of retrying forever or throwing uncaught.
- Rebuild colored strings through supported theme/update mechanisms. Do not import private theme listeners; if no public idle-theme notification exists, document the exact limitation instead of adding permanent polling to every status.
- Add MCP to the shared README's order and consumer list.

## Acceptance criteria

- Setup failure, cancellation, shutdown/reload, and late callbacks cannot leave an active interval or uncaught stale-context exception.
- Retries/compaction/queued work still finish at agent_settled, not prematurely at agent_end.
- Finished coloring matches semantic-success documentation.
- Theme-refresh support or its unavoidable limitation is explicit and tested.
- Shared footer ordering/status keys remain unchanged; no custom footer replacement.

## Validation

`node --test response-timer/index.test.ts mcp-status/index.test.ts shared/footerStatus.test.ts`; `npm run verify` with approved scratch. Document any setup-error scenario that cannot be reproduced through a supported host seam.

### Re-check after 0010

**Status remains Open.** Source re-check confirms 0010 changes configuration projection/cache scope, not lifecycle handlers or stale-context boundaries. Existing footer/timer tests pass, but do not verify this package's setup-error/stale-context acceptance criteria; no status promotion is justified. See [0010's resolution](0010-mcp-status-config-drift.md#resolution-and-validation).

Related: [0010: MCP config projection](0010-mcp-status-config-drift.md); coordinate changes to mcp-status without conflating config semantics with status lifecycle.
