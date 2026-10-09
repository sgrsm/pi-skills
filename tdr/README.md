# Technical Debt Records

This directory tracks known technical debt that is intentionally not being addressed immediately.

| ID | Title | Status | Priority |
|---|---|---|---|
| [TDR-0002](./0002-propagate-transient-project-trust-to-subagents.md) | Preserve transient project trust for contained subagent children | Open | Low |
| [TDR-0003](./0003-clarify-fullscreen-input-host-blocker.md) | Restore safe fullscreen clarify input | Open — revalidated on Pi 1.1.0; lifecycle blocker remains | Medium |
| [TDR-0004](./0004-sdk-cli-resume-tool-restoration-host-defect.md) | Restore the transcript tool loadout on SDK/CLI resume | Open — reproduced on Pi 1.1.0 | Medium |
| [TDR-0005](./0005-subagent-orchestration-failure-accounting.md) | Retain subagent results and usage on orchestration cancellation and exceptions | Open — parallel cancellation confirmed; exceptions verify first | Medium |
| [TDR-0006](./0006-provider-request-physical-model-identity.md) | Expose physical model identity to provider-request extensions | Open — host API enhancement deferred | Low |
| [TDR-0007](./0007-trash-history-all-projects-storage-policy.md) | Decide the Trash-history all-projects storage policy | Open — policy decision pending | Medium |

The owning records explain the evidence, scope and acceptance criteria for each item. Read the relevant record before changing behavior or status; follow its safety boundaries when reproducing an issue.

## Pi 1.1.0 revalidation

No remaining record became redundant or unblocked. The original investigation versions and evidence in the owning records remain historical baselines; the following observations supplement them:

- **TDR-0002:** source comparison with Pi 1.0.4 found no change that propagates process-local parent trust to contained child processes. It remains open.
- **TDR-0003:** positive input/layout diagnostics still fail. A separate version-checked invocation of the actual host custom-dialog method reproduced stacked-search and pre-install completion failures; normal mounted completion remains a positive control. Fullscreen mouse ownership and Home/End controls still work. The broader remediation remains blocked.
- **TDR-0004:** positive SDK and actual CLI resume checks still fail, both with and without local extensions. The local startup correction remains separate from the host construction defect.
- **TDR-0005:** the existing parallel-cancellation characterization still reproduces loss of collected results/usage. New timing and aborted-state fields do not repair that local orchestration path; unexpected-exception scenarios still require reproduction.
- **TDR-0006:** source inspection confirms that the provider-request event remains payload-only and the SDK still discards the adapter's physical model argument. The proposed public API enhancement is not available.
- **TDR-0007:** the public extension API still does not establish the effective configured session-storage root. The all-projects product policy remains unselected.

See [compatibility revalidation and limits](../agent/extensions/pi-compatibility/host-contract-coverage.md#pi-110-revalidation) for the distinction between runtime contract checks, the blocked verification gate, and outstanding host acceptance checks. No live-terminal or live MCP/provider compatibility checks were performed for this revalidation.

## Earlier revalidation

On the tested Pi 1.0.3, fullscreen clarify Home/End routing improves, but PageUp/PageDown/wheel, mouse/layout issues and unsafe host overlay completion remain; SDK/CLI resumed-tool restoration is still broken independently of the local startup correction. Positive host acceptance diagnostics run explicitly with `npm run diagnose:pi-host` and fail while TDR-0003/TDR-0004 remain open; a green normal contract gate does not resolve them. Subagent parallel-cancellation accounting loss is confirmed; unexpected-exception paths and optional nested UI observations still require reproduction.
