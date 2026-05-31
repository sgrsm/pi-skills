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

For a full audit, read all of these before concluding:

- [Shared audit playbook](../java-clean-shared/references/audit-playbook.md)
- [Clean code and refactoring rules](../java-clean-code/references/clean-code-and-refactoring-rules.md)
- [SOLID principles](../java-clean-solid/references/solid-principles.md)

## Audit workflow

1. Map the project and identify code and design hotspots.
2. Review SOLID and class design in the hotspot areas.
3. Review local clean-code smells and refactoring opportunities.
4. Prioritize findings by correctness, coupling, cohesion, maintenance, and testability impact.
5. Recommend an incremental refactoring order.

## Output

Default structure:

1. scope and assumptions
2. summary of material risks
3. high-priority findings
4. medium-priority findings
5. low-risk improvements
6. suggested refactoring order

Use neutral, professional language and focus on findings, impact, and next steps.
Do not add praise-only sections or subjective compliments.
Use labels from the shared audit playbook on each finding.
