# Technical Debt Records

This directory tracks known technical debt that is intentionally not being addressed immediately. Records blocked on Pi upstream host behavior or API support are grouped in [`blocked/`](./blocked/).

| ID | Title | Status | Priority |
|---|---|---|---|
| [TDR-20261009-1200](./20261009-1200-propagate-transient-project-trust-to-subagents.md) | Preserve transient project trust for contained subagent children | Open | Low |
| [TDR-20261009-1204](./blocked/20261009-1204-provider-request-physical-model-identity.md) | Expose physical model identity to provider-request extensions | Blocked — Pi host API enhancement deferred upstream | Low |
| [TDR-20261009-1205](./20261009-1205-trash-history-all-projects-storage-policy.md) | Decide the Trash-history all-projects storage policy | Open — policy decision pending | Medium |
| [TDR-20261009-1206](./blocked/20261009-1206-custom-dialog-blocked-status.md) | Report custom TUI dialogs as blocked in program status | Blocked — no supported scoped/arbitrated custom-dialog status integration | Low |

The owning records explain the evidence, scope and acceptance criteria for each item. Read the relevant record before changing behavior or status; follow its safety boundaries when reproducing an issue.

## Pi 1.3.0 revalidation

- **TDR-20261009-1201 resolved:** supported Clarify overlays and input/layout/lifecycle acceptance completed. The record is deleted; [resolution evidence and practical limits](../extensions-audit/20261016-220621-1.2.0-to-1.3.0/02-simplification-and-debt.md#d2--medium-priority-revisit-the-supported-clarify-overlay-remedy) are retained in the assessment.
- **TDR-20261009-1202 resolved:** SDK/actual-CLI restoration, restriction and lifecycle acceptance completed. The record is deleted; [resolution evidence and limits](../extensions-audit/20261016-220621-1.2.0-to-1.3.0/02-simplification-and-debt.md#d1--medium-priority-finish-local-acceptance-and-documentation-for-restored-resume-tools) are retained in the assessment.
- **TDR-20261009-1204:** request-hook identity remains payload-only; the supported physical-model prerequisite is still missing.
- **TDR-20261009-1206:** custom UI still lacks supported scoped/arbitrated blocked-status integration. The low-level terminal setter is not an equivalent replacement; no live dashboard reproduction is claimed.
- **TDR-20261009-1200 / TDR-20261009-1205:** no upgrade-driven status change; transient trust and the all-projects storage policy remain open.

TDR-1201 and TDR-1202 are closed. The retained assessment distinguishes completed local acceptance from skipped live workflows; historical revalidations below retain their original version scope.

## Pi 1.1.0 revalidation

No record became redundant or unblocked during this revalidation. The original investigation versions and evidence in the owning records remain historical baselines; the following observations supplement them:

- **TDR-20261009-1200:** source comparison with Pi 1.0.4 found no change that propagates process-local parent trust to contained child processes. It remains open.
- **TDR-20261009-1201:** positive input/layout diagnostics still fail. A separate version-checked invocation of the actual host custom-dialog method reproduced stacked-search and pre-install completion failures; normal mounted completion remains a positive control. Fullscreen mouse ownership and Home/End controls still work. The broader remediation remains blocked.
- **TDR-20261009-1202:** positive SDK and actual CLI resume checks still fail, both with and without local extensions. The local startup correction remains separate from the host construction defect.
- **TDR-20261009-1204:** source inspection confirms that the provider-request event remains payload-only and the SDK still discards the adapter's physical model argument. The proposed public API enhancement is not available.
- **TDR-20261009-1205:** the public extension API still does not establish the effective configured session-storage root. The all-projects product policy remains unselected.

See [compatibility revalidation and limits](../agent/extensions/pi-compatibility/host-contract-coverage.md#pi-110-revalidation) for the distinction between runtime contract checks, the blocked verification gate, and outstanding host acceptance checks. No live-terminal or live MCP/provider compatibility checks were performed for this revalidation.

## Earlier revalidation

On the tested Pi 1.0.3, fullscreen clarify Home/End routing improves, but PageUp/PageDown/wheel, mouse/layout issues and unsafe host overlay completion remain; SDK/CLI resumed-tool restoration is still broken independently of the local startup correction. The positive host acceptance diagnostics failed at that baseline; their requirements are now normal regressions following the Pi 1.3.0 remedies. The historical result is not the current disposition. The subagent parallel-cancellation accounting loss confirmed at that baseline has since been fixed; the [subagent documentation](../agent/extensions/subagent/README.md#output-and-cancellation) describes current behavior and accepted recovery limits.
