---
name: java-clean-audit
description: Broad Java audit across clean code and SOLID. Use when the user wants an end-to-end review of a Java repo, module, or package for readability, maintenance, testability, coupling, and class-level design.
compatibility: Best for Java 11+ codebases using Maven or Gradle. Works with plain Java and Spring-style applications.
---

# java-clean-audit

Use this umbrella skill when the user wants a broad Java audit.

## When to use this skill

Use it for broad-scope reviews, for example:

- clean code and SOLID
- repo- or module-level Java audit
- overall code quality and refactoring priorities
- design review across multiple classes

If the request is narrow, prefer a focused skill instead:

- `java-clean-code`
- `java-clean-solid`

## References to load

For a full audit, read these before concluding:

- [Shared audit playbook](../java-clean-shared/references/audit-playbook.md)
- [Shared taxonomy](../java-clean-shared/references/taxonomy.md)
- [Clean code checklist](../java-clean-code/references/clean-code-checklist.md)
- [SOLID checklist](../java-clean-solid/references/solid-checklist.md)

Load detailed topic references only for hotspot areas where the compact checklists are insufficient, the user asks for examples, or the audit is broad/exhaustive:

- [Clean code and refactoring rule index](../java-clean-code/references/clean-code-and-refactoring-rules.md)
- [SOLID principles](../java-clean-solid/references/solid-principles.md)

## Audit workflow

1. Map the project and identify code and design hotspots.
2. Review SOLID and class design in the hotspot areas.
3. Review local clean-code smells and refactoring opportunities.
4. Prioritize findings by correctness, coupling, cohesion, maintenance, and testability impact.
5. Recommend an incremental refactoring order.

## Review stance

- Prefer root-cause findings over symptom lists; do not report local symptoms separately when one design root cause explains them.
- Do not recommend patterns, abstractions, wrappers, or value objects without concrete correctness, change-safety, or testability cost.
- If evidence is incomplete, phrase the point as a risk or question, not a definite violation.
- Do not treat framework annotations, Lombok, records, builders, mutable DTOs, JPA mechanics, or serialization hooks as issues without concrete coupling, lifecycle, invariant, or testing cost.

## Output

Use the shortest report that fits the scope. Default to at most 10 findings for package/module audits and 15 for repo-wide audits unless the user asks for exhaustive output.

Default structure:

1. scope and assumptions
2. summary of material risks
3. findings ordered by severity and refactoring payoff
4. suggested refactoring order

Use neutral, professional language and focus on findings, impact, and next steps.
Do not add praise-only sections or subjective compliments.
If there are no material issues in scope, say so briefly and stop.
Use severity, evidence strength, labels, and finding schema from the shared taxonomy.
