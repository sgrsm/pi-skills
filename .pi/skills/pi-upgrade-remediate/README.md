# pi-upgrade-remediate quickstart

Carry out the actionable findings of this repo's retained Pi upgrade assessment. [pi-upgrade-audit](../pi-upgrade-audit/README.md) produces recommendations; this companion implements and verifies them without running another audit.

## Enable and run

This is a **project-local** skill in `.pi/skills/`, not a global resource in `agent/skills/`. Start Pi at this repository's root, allow trusted project resources to load, and use `/reload` if the session predates the skill. Use the root for normal project-skill discovery, just as with the audit skill.

After an audit, run:

```text
/skill:pi-upgrade-remediate
```

Or ask naturally:

```text
Implement the findings in the retained Pi upgrade assessment.
```

Both are implementation requests and authorize bounded local changes and per-item commits under this skill. Merely discussing, planning or maintaining the skill does not authorize remediation. You can narrow the request:

```text
/skill:pi-upgrade-remediate Only required fixes; leave optional items alone.
/skill:pi-upgrade-remediate Use this session's approved scratch. Do not commit.
/skill:pi-upgrade-remediate Plan only, do not change anything.
```

Optional inputs: an assessment directory, specific item IDs, known local changes, or restrictions such as `Leave host links unchanged`. Arguments are natural language, not a custom command-line syntax.

## What to expect

- Confirmation of each recommendation against the current repository, installed host and owning acceptance criteria.
- Required fixes, recommended debt work, adopt-now opportunities and concrete optional verifications; unchanged coverage and defer/skip decisions are not extra work.
- Dependency-ordered worker implementation and separate independent review/verification when permitted, with parent-owned integration, records and commits.
- Focused tests and the discovered full gate, including positive diagnostics when present. Planned in-scope failures are work to perform, not a reason to stop.
- Current dispositions and durable evidence added to the **existing three reports**, without creating another audit run.
- Deletion of fully resolved TDRs only after closure evidence is preserved and index/inbound references repaired. Partial records stay open; no archive is created.
- One coherent local commit per accepted item, no duplicate implementation or empty commits. Record-only status updates may need a separate commit.
- Autonomous continuation without routine plan approval. Genuine blockers get a focused question with evidence and a recommendation.

The final response summarizes dispositions, commits, verification, deleted TDRs and remaining limits. Re-running recognizes completed items rather than recreating them. An already-completed assessment can therefore yield no changes.

## Safety and limits

Implementation requests authorize bounded local code, tests, docs, report/TDR maintenance, safe documented host-link setup, approved scratch use and local commits, subject to your restrictions and active permissions. Your existing edits and staged data are preserved.

Pi/dependency installation or upgrades, release switching, workflow/configuration changes, extension disabling/removal, live provider/MCP or paid operations and pushing need separate authorization. Personal sessions and credentials are not test fixtures. The workflow never rewrites Git history.

Subagents follow active policy. If unavailable, the parent can continue permitted sequential work but records missing independence. Mandatory acceptance or independent-review requirements remain unmet until actually verified. A required check cannot be silently skipped; live hardware or service limits permit closure only when the owning criteria allow them.

## Related files

- [SKILL.md](SKILL.md): activation, authorization and scope.
- [Remediation protocol](references/remediation-protocol.md): confirmation, delegation, validation, record maintenance, closure and commits.
- [Audit quickstart](../pi-upgrade-audit/README.md): producing the retained assessment.
