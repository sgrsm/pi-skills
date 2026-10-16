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
- Three linked category reports per run, plus a short chat summary with recommended action order.

Each finding includes evidence, a suggested fix or adoption plan, and a recommendation among materially different reasonable approaches. Unrelated pre-existing extension problems and speculative feature wishlists are excluded. Required fixes remain separate from optional improvements.

## Reports

One invocation runs one full audit and writes:

```text
extensions-audit/
└── <YYYYMMDD-HHMMSS>-<baseline-or-unknown>-to-<target>/
    ├── 01-compatibility.md
    ├── 02-simplification-and-debt.md
    └── 03-api-opportunities.md
```

The timestamp uses datetime format `YYYYMMDD-HHMMSS` with a 24-hour clock; the timezone is recorded in each report. An unused suffix is added to the run-directory name if needed to avoid collisions.

- **Compatibility:** required fixes, extension compatibility coverage, detailed assessment context, and validation results.
- **Simplification and debt:** built-in replacement candidates, workaround/limitation improvements, and every TDR's disposition, including non-blocked records.
- **API opportunities:** worthwhile optional uses of new host APIs, concrete benefits, adoption trade-offs, and recommendations.

Each finding has one primary home, with cross-references rather than duplicates. Every document includes a shared context header, sibling links, and relevant gaps. All three are written even when a category has no findings or could not be fully checked. No fourth overview document is required, and historical reports are left in place. The three documents together form one assessment for future baseline use.

## Requirements and limits

The full audit is the default; there is no light/full selection. Validation commands and scratch requirements are discovered from current repository guidance, manifests, and test harnesses, without assuming particular extensions exist. Runtime checks need approved scratch and correctly resolved Pi host packages. Offline tests avoid personal state and live provider/MCP calls.

The audit automatically refreshes routine host-package links and reuses Pi’s ready session scratch for validation. It asks only when additional permission or setup is needed. You can request that links remain unchanged.

Extension fixes, dependency installations, configuration/TDR changes, and extension removal still require separate approval.

If checks cannot run or web access is unavailable, the reports record the gaps rather than claiming complete validation. Known host diagnostics can still fail without indicating a new regression.

For economical delegation, configure `subagents.agentDefaults.scout` with your preferred inexpensive model; the skill does not choose or change models. If delegation is unavailable, the audit continues sequentially.

## Related files

- [SKILL.md](SKILL.md): agent instructions, version selection, scope, and permissions.
- [Audit protocol](references/audit-protocol.md): evidence rules, validation, delegation, TDR dispositions, and report format.
