# Pi 1.4.0: simplification and debt

**No urgent simplification or newly unblocked TDR.** Keep all extensions; only dialog guidance needs routine follow-up. [Overall triage](01-compatibility.md#at-a-glance).

**Audit:** 20261024-143437 CEST (UTC+02:00); requested/verified target **1.4.0**. Reference **1.3.0** inferred from completed assessment through `a437cc1`, not confirmed upgrade history.  
**State at audit:** `0ea1be4cb8b1a49d1b812a7f4e2e5f9129a563dd`, initially clean; offline/source assessment complete, verification gate red (C1); category complete.  
**Editorial rewrite only:** recorded evidence and dispositions unchanged; no checks rerun.

[Compatibility/validation](01-compatibility.md) · [API opportunities](03-api-opportunities.md)

## Dialog guidance (D1)

- **Impact/timing:** Maintenance-only; can wait. Warnings about collisions with permission, Handoff, Trash and subagent dialogs are too broad.
- **Evidence:** [Pi 1.4's interactive stack](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/src/modes/interactive/interactive-mode.ts) restores standard/inline dialogs after newer ones close. Recorded public-host probes reproduce the 1.3 failure and pass five scenarios in each 1.4 fake-terminal mode. High confidence for that path, not RPC/overlay arbitration.
- **Recommendation:** Update [shared guidance](../../agent/extensions/maintenance.md#shared-interactive-dialogs) and permissions/clarify troubleshooting; add a public-host stack/focus/cancellation regression and rerun focused/full suites after C1. **Keep the transaction queue and cancellation helpers:** native stacking does not replace FIFO, complete approval exchanges or grant rechecks. Deferring docs/tests is reasonable; removing the queue would lose safety guarantees.

## TDR dispositions

| Record | Disposition | Decisive evidence and remaining action |
| --- | --- | --- |
| [1200: transient trust](../../tdr/20261009-1200-propagate-transient-project-trust-to-subagents.md) | Still open | Child arguments omit explicit contained-parent transient trust. Decide precedence before remediation; preserve canonical containment and external/unresolved `--no-approve`. Acceptance remains incomplete. |
| [1204: physical request identity](../../tdr/blocked/20261009-1204-provider-request-physical-model-identity.md) | Still blocked | Request event remains payload-only; new client identity names the app, not the physical model. Keep conservative Codex coverage pending supported forwarding/acceptance; no routed-request validation. |
| [1205: Trash storage scope](../../tdr/20261009-1205-trash-history-all-projects-storage-policy.md) | Policy pending | Conventional root only; readonly manager supplies no configured-root provenance. Select conventional-only/custom-support/refusal policy before changes. No private inference or permanent deletion. |
| [1206: custom-dialog status](../../tdr/blocked/20261009-1206-custom-dialog-blocked-status.md) | Still blocked | Public options lack scoped blocked metadata; fake-terminal controls report standard dialogs blocked, custom UI not. Await supported arbitration; no raw competing status writes. Lifetime/privacy acceptance remains unmet. |

Optional version-evidence/locator updates are record maintenance, not new defects. No record was closed or its status changed.

## Retained closure evidence

### TDR-1201: Clarify overlay remedy (resolved)

Closed on Pi 1.3 (`86c2c39`): supported callback-owned selector/editor overlays met input/layout/focus/cancellation/disposal acceptance; positive requirements became normal tests. The recorded 1.4 gate passed actual-host regressions. No live trackpad/terminal, real clipboard/link, busy-reload or provider-loop proof; shared dock/RPC/status limitations remain. [Coverage](../../agent/extensions/pi-compatibility/host-contract-coverage.md#clarify-inputtestts-and-clarify-hosttestts).

### TDR-1202: SDK/CLI resumed tools (resolved)

Closed on Pi 1.3 (`2767936`): SDK/CLI restoration, restrictions, continue/fork, runtime replacement and tree/reload acceptance completed. Recorded 1.4 core controls still pass; C1 is separate expectation drift, not the original omission. Picker/RPC protocol, default/cross-project storage, resumed CLI reload and live provider/MCP acceptance remain unclaimed. [Coverage](../../agent/extensions/pi-compatibility/host-contract-coverage.md#sdk-resumetestts).

## Unchanged coverage

No complete bundled-and-enabled replacement was demonstrated. Existing permissions/trust, queue/RPC/editor, storage, footer, recovery and rendering limits remain; see [shared maintenance](../../agent/extensions/maintenance.md), [subagent limits](../../agent/extensions/subagent/maintenance.md) and [validation gaps](01-compatibility.md#coverage-and-gaps). Prior read-range adoption, Handoff thinking-omission and Git catalog regressions remain complete, not pending work.
