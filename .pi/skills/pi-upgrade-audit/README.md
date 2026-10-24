# pi-upgrade-audit quickstart

Run a full post-upgrade audit of this repo's local Pi extensions, maintenance limitations, useful new host APIs, and all technical debt records. The skill recommends changes; it does not apply them.

## Enable and run

This is a **project-local** skill under `.pi/skills/`, not a global skill under `agent/skills/`. Start Pi at this repository's root, allow its trusted project resources to load, and run `/reload` if the session predates the skill.

Supply the upgrade range when you know it:

```text
/skill:pi-upgrade-audit Pi version was upgraded 1.0.0 -> 1.2.0
```

Or check the installed version:

```text
/skill:pi-upgrade-audit
```

Without a range, Pi proceeds against the installed version. It uses trustworthy historical evidence where available and explicitly identifies missing baseline evidence rather than asking you to reconstruct the upgrade.

Useful optional inputs include an earlier report, relevant local changes, or the approved test-scratch location:

```text
/skill:pi-upgrade-audit Pi version was upgraded 1.0.0 -> 1.2.0.
Use the approved test scratch from this session. Do not apply fixes.
```

Arguments are natural-language instructions, not a custom command-line syntax.

## What to expect

- Compatibility checks against the selected Pi release.
- Assessment of new bundled replacements and opportunities to simplify workarounds or accepted limitations.
- Useful new or expanded host APIs mapped to current extension workflows, with recommendations to adopt now, defer, or skip.
- A disposition for every TDR, including non-blocked records.
- Documented tests and host diagnostics, not just source inspection.
- Web research through available HTTP tools or web search when useful.
- Scout-first parallel investigation when policy and available tools permit, with reviewers reserved for deeper analysis.
- Three linked category reports per run, plus a plain-language verdict in chat: whether anything needs attention now, what can wait, and what is reasonable to accept.

Findings are short: practical impact and timing, decisive evidence, and a recommended next step. Alternatives appear only when their trade-off matters. Unrelated pre-existing problems, repeated methodology and speculative feature wishlists are excluded. Required fixes remain separate from optional improvements.

## Read the result quickly

Start with the chat verdict or **At a glance** at the top of the compatibility report. That summary covers all three categories, so you do not need to read every report to decide what matters. It names the affected workflow, explains practical impact, and recommends when to act:

- **Do now:** fix or mitigate before continuing the affected workflow.
- **Before [specific checkpoint]:** maintenance needed before something concrete, such as the next extension change.
- **Can wait:** reasonable to defer within the assessed scope, with the cost/workaround and a revisit trigger stated.
- **Accept for now:** retaining a low-value-to-fix limitation is recommended, with the trade-off explained. This is not approval on your behalf or a closed TDR.
- **Verify first:** a specific missing check prevents a reliable decision; the summary explains the next check and any necessary precaution.

Impact is described as **high**, **medium**, **low**, **maintenance-only**, or **unknown**, separately from timing and evidence confidence. For example, stale test expectations may block reliable validation and need fixing before the next code change without meaning ordinary Pi use is broken. Finding IDs are only cross-references, not severity scores.

## Reports

The investigation and tests remain full; the output is a compact decision record. For a routine audit, reports aim for about **900 / 500 / 300 words or less**, respectively, with shorter quiet categories. Material findings or necessary evidence can justify more. Clean extensions are grouped, every TDR gets a short disposition, and rejected APIs are not listed one by one. No long appendices or historical retellings.

One invocation writes:

```text
extensions-audit/
└── <YYYYMMDD-HHMMSS>-<baseline-or-unknown>-to-<target>/
    ├── 01-compatibility.md
    ├── 02-simplification-and-debt.md
    └── 03-api-opportunities.md
```

The timestamp uses datetime format `YYYYMMDD-HHMMSS` with a 24-hour clock; the timezone is recorded in each report. An unused suffix is added to the run-directory name if needed to avoid collisions.

- **Compatibility:** at-a-glance decisions, required fixes, compact validation results, and grouped coverage/gaps.
- **Simplification and debt:** built-in replacement candidates, workaround/limitation improvements, and every TDR's disposition, including non-blocked records.
- **API opportunities:** worthwhile optional uses of new host APIs, concrete benefits, adoption trade-offs, and recommendations.

Each finding has one primary home, with cross-references rather than duplicates. All three documents are written even when a category has no findings or incomplete checks; no fourth overview is needed.

Only the newest timestamped report set is retained as the current source of truth. It carries forward relevant open findings, current dispositions and essential comparison evidence. Older sets are removed after the replacement is saved and checked; committed snapshots remain in Git history.

## Requirements and limits

The full audit is the default; there is no light/full selection. Validation commands and scratch requirements are discovered from current repository guidance, manifests, and test harnesses, without assuming particular extensions exist. Runtime checks need approved scratch and correctly resolved Pi host packages. Offline tests avoid personal state and live provider/MCP calls.

The audit automatically refreshes routine host-package links and reuses Pi’s ready session scratch for validation. It asks only when additional permission or setup is needed. You can request that links remain unchanged.

Extension fixes, dependency installations, configuration/TDR changes, and extension removal still require separate approval.

If checks cannot run or web access is unavailable, the reports record the gaps rather than claiming complete validation. Known host diagnostics can still fail without indicating a new regression.

For economical delegation, configure `subagents.agentDefaults.scout` with your preferred inexpensive model; the skill does not choose or change models. If delegation is unavailable, the audit continues sequentially.

## Related files

- [SKILL.md](SKILL.md): agent instructions, version selection, scope, and permissions.
- [Audit protocol](references/audit-protocol.md): evidence rules, validation, delegation, TDR dispositions, and report format.
