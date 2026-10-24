# Pi 1.4.0: API opportunities

**No optional API adoption needs action now.** Keep native defaults; defer worker tuning. [Overall triage](01-compatibility.md#at-a-glance).

**Audit:** 20261024-143437 CEST (UTC+02:00); requested/verified target **1.4.0**. Reference **1.3.0** inferred from completed assessment through `a437cc1`, not confirmed upgrade history.  
**State at audit:** `0ea1be4cb8b1a49d1b812a7f4e2e5f9129a563dd`, initially clean; offline/source assessment complete, verification gate red (C1); category complete.  
**Editorial rewrite only:** recorded evidence and dispositions unchanged; no checks rerun.

[Compatibility/validation](01-compatibility.md) · [Simplification/debt](02-simplification-and-debt.md)

## Worker capacity

- **Impact/timing:** Potential latency benefit, not a demonstrated local problem. **Defer** until real same-process codemode queues become disruptive.
- **Evidence:** [Pi 1.4 codemode](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/codemode.md#limits) waits up to 60 seconds for a worker, bounded by the script deadline, rather than immediately rejecting at capacity. Default is two; `PI_CODEMODE_MAX_WORKERS` permits more. Source-supported, not saturation-tested; each worker may use 256 MB.
- **Recommendation:** Keep defaults and consolidate scripts where practical. If latency warrants tuning, measure admission/deadline/cancellation/worker-exit and memory behavior offline before a small process-local override. More workers trade memory/concurrency for latency. Do not change the subagent scheduler: children are separate processes, not this pool.

## Screening outcome

Release/declaration screening found no worthwhile local consumer for the other new APIs. Skip explicit client identity integration: Handoff already uses the host registry, and app attribution cannot fix [physical request identity](02-simplification-and-debt.md#tdr-dispositions). Classifier images, model-subpath aliases and terminal-exit hooks need no local migration.

Resume activation and dialog stacking belong to C1/D1, not additional adoption work. Earlier formatter/serialization/catalog improvements remain complete. Real-sandbox controls passed, but worker saturation/performance and live provider/terminal/MCP behavior remain unverified; [recorded validation](01-compatibility.md#validation) is unchanged.
