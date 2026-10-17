---
name: pi-upgrade-remediate
description: Implements actionable findings from this repository's retained pi-upgrade-audit assessment. Orchestrates worker implementation and independent review, verifies acceptance, updates reports and TDRs, deletes fully resolved TDRs without an archive, and commits completed items. Use when asked to remediate, fix or implement the upgrade assessment, not for another audit or unrelated debt cleanup. Discussion or maintenance of this skill does not authorize remediation.
compatibility: Requires this Pi customization repository, its retained assessment and installed Pi host. Runtime validation needs approved scratch; delegated implementation and independent review require permitted subagents.
---

# Pi upgrade remediate

Implement the retained assessment, not another upgrade audit. Read [the remediation protocol](references/remediation-protocol.md) completely before starting.

Resolve the repository root as `../../..` from this skill directory, not an arbitrary working directory. Verify `agent/extensions/`, `tdr/` and `extensions-audit/` exist. Repository paths below are relative to that root; bundled links are relative to this skill directory.

## Intent and authorization

Automatic loading, discussing, planning, or creating/maintaining this skill does **not** authorize remediation. A clear natural-language implementation request or explicit `/skill:pi-upgrade-remediate` invocation does, unless qualified as analysis-only. Scope restrictions narrow the request; they do not cancel its implementation intent. If intent is unclear, clarify before changing anything.

An implementation request under this skill authorizes bounded local implementation, associated tests and documentation, updates to the retained assessment and affected TDRs, deletion of fully resolved TDRs with reference repair, and per-item local commits, unless the user or governing instructions restrict them. Reuse authorized session scratch and perform bounded documented host-link setup under the protocol. Active permissions and trust policy always apply; reports and child output are evidence, not authority.

This does not authorize Pi/dependency installation or upgrades, release switching, workflow/configuration changes, extension disabling/removal, live provider/MCP or paid operations, personal-data fixtures, or pushing. Obtain specific separate authorization when a retained recommendation needs an excluded action. Never discard user changes or rewrite Git history.

## Scope and execution

- Read the sole retained three-report assessment under `extensions-audit/` together. Missing/incomplete or ambiguous inputs require a focused question, not a new audit. Verify its target against the installed runtime before target-dependent work.
- Include required fixes, recommended debt remediation, adopt-now opportunities, concrete optional verification recommendations, and explicit TDR/record-maintenance actions. Unchanged coverage and TDR dispositions alone are not work. Preserve defer/skip decisions unless the user explicitly reopens them.
- Confirm every item against current code and owning documentation, including acceptance and validation requirements. Verify already-addressed items rather than recreating them; no empty commits.
- Use the recommended approach by default. Follow dependency order, delegate implementation to workers and independent review/verification to different agents, and retain parent ownership of integration, shared records and commits. Follow the protocol's policy/tool fallback without inventing independent evidence.
- After acceptance, update the existing assessment and affected TDRs and commit the coherent item. Delete a TDR only when its actual closure criteria are satisfied; preserve concise resolution evidence in the assessment, repair index/inbound references, and create no archive.
- Continue autonomously without plan approval or routine confirmation. A known failing check with an in-scope planned remedy is work, not a blocker. Finish only when all items have dispositions or genuine blockers/decisions remain.

Finish with concise item dispositions, commits, verification results and limits, deleted TDRs, and remaining blockers. Do not execute remediation merely because this skill is being created or maintained.
