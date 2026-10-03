# Technical Debt Records

This directory tracks known technical debt that is intentionally not being addressed immediately.

| ID | Title | Status | Priority |
|---|---|---|---|
| [TDR-0001](./0001-subagent-tools-frontmatter-yaml-arrays.md) | Accept YAML arrays in subagent `tools` frontmatter | Open | Low |
| [TDR-0002](./0002-propagate-transient-project-trust-to-subagents.md) | Preserve transient project trust for contained subagent children | Open | Low |
| [TDR-0003](./0003-clarify-fullscreen-input-host-blocker.md) | Restore safe fullscreen clarify input | Open — blocked on host correction | Medium |
| [TDR-0004](./0004-sdk-cli-resume-tool-restoration-host-defect.md) | Restore the transcript tool loadout on SDK/CLI resume | Open — host correction required | Medium |

TDR-0001 and TDR-0002 were created from the Pi 0.87.0 extension compatibility audit. Neither item was a Pi 0.87.0 upgrade blocker; the extension typecheck and all 268 tests passed against that version.

TDR-0003 records confirmed Pi 1.0.0 clarify input/mouse defects and the host overlay-completion blocker that led to deferring the runtime fix. It contains standalone evidence, reproduction steps, safety boundaries, and acceptance criteria; no temporary audit/work-package files are required to resume it.

TDR-0004 records the confirmed Pi 1.0.0 SDK/CLI resume-loadout defect reproduced without local extensions. The separate local startup fix is complete, but end-to-end resumed-tool restoration remains broken. The record includes durable tests, standalone reproduction, safety boundaries, validation/review history and host-fix acceptance criteria; it does not depend on temporary work-package documents or scratch logs.
