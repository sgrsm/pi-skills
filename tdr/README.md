# Technical Debt Records

This directory tracks known technical debt that is intentionally not being addressed immediately.

| ID | Title | Status | Priority |
|---|---|---|---|
| [TDR-0001](./0001-subagent-tools-frontmatter-yaml-arrays.md) | Accept YAML arrays in subagent `tools` frontmatter | Open | Low |
| [TDR-0002](./0002-propagate-transient-project-trust-to-subagents.md) | Preserve transient project trust for contained subagent children | Open | Low |
| [TDR-0003](./0003-clarify-fullscreen-input-host-blocker.md) | Restore safe fullscreen clarify input | Open — Home/End improve on 1.0.3; lifecycle blocker remains | Medium |
| [TDR-0004](./0004-sdk-cli-resume-tool-restoration-host-defect.md) | Restore the transcript tool loadout on SDK/CLI resume | Open — reproduced on Pi 1.0.3 | Medium |
| [TDR-0005](./0005-subagent-orchestration-failure-accounting.md) | Retain subagent results and usage on orchestration cancellation and exceptions | Open — parallel cancellation confirmed; exceptions verify first | Medium |
| [TDR-0006](./0006-provider-request-physical-model-identity.md) | Expose physical model identity to provider-request extensions | Open — host API enhancement deferred | Low |
| [TDR-0007](./0007-trash-history-all-projects-storage-policy.md) | Decide the Trash-history all-projects storage policy | Open — policy decision pending | Medium |

The owning records explain the evidence, scope and acceptance criteria for each item. Read the relevant record before changing behavior or status; follow its safety boundaries when reproducing an issue.

On the tested Pi 1.0.3, fullscreen clarify Home/End routing improves, but PageUp/PageDown/wheel, mouse/layout issues and unsafe host overlay completion remain; SDK/CLI resumed-tool restoration is still broken independently of the local startup correction. Positive host acceptance diagnostics run explicitly with `npm run diagnose:pi-host` and fail while TDR-0003/TDR-0004 remain open; a green normal contract gate does not resolve them. Subagent parallel-cancellation accounting loss is confirmed; unexpected-exception paths and optional nested UI observations still require reproduction.
