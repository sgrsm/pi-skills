---
name: java-clean-code
description: Audits Java code for local clean-code issues and refactoring opportunities. Use when reviewing Java classes or methods for naming, method design, duplication, comments, null handling, error handling, tests, and maintainability.
compatibility: Best for Java 11+ codebases using Maven or Gradle. Works with plain Java and Spring-style applications.
---

# java-clean-code

Use this skill when the user wants a Java review focused on local code cleanliness and refactoring.

## Primary focus

- naming clarity and consistent vocabulary
- method size, cohesion, and abstraction level
- explicit side effects and command/query intent
- duplication, local smells, and safe refactoring mechanics
- comments, formatting, and scanability
- null contracts, exceptions, and boundary handling
- tests that support safe refactoring

## Boundary

- Use this skill for local readability, method design, null/error handling, duplication, and refactoring mechanics.
- Use `java-clean-solid` when the root cause is responsibility boundaries, inheritance contracts, interface shape, dependency direction, or change ripple.
- If both apply, report the root design issue once and list local smells as evidence, not duplicate findings.

## References to load

- Always load [Clean code checklist](references/clean-code-checklist.md) and [Shared taxonomy](../java-clean-shared/references/taxonomy.md) before concluding.
- For package/module/repo audits or actionable refactoring plans, also load [Shared audit playbook](../java-clean-shared/references/audit-playbook.md).
- Load [Detailed clean code and refactoring rules](references/clean-code-and-refactoring-rules.md) or its relevant topic files only when the checklist is insufficient, the user asks for examples, or the audit is broad/exhaustive.
- Do not load the sibling SOLID reference by default. Load `../java-clean-solid/references/solid-checklist.md` only when the root issue is class or interface design.

## Scope and brevity

- For diff reviews, prioritize changed lines and directly affected collaborators. Do not report pre-existing unrelated smells unless they materially affect the changed code or refactoring safety.
- Prefer root-cause findings over symptom lists. If many local smells stem from one class or boundary problem, report the root issue once and cite representative symptoms.
- Default to at most 5 findings for narrow reviews and 10 findings for package/module reviews unless the user asks for exhaustive output.
- If there are no material issues in scope, say so briefly and stop. Do not invent low-value findings.

## Review stance

- Use neutral, professional language.
- Focus on observable code, impact, and specific refactoring steps.
- Prioritize correctness, readability, maintenance, testability, and change safety.
- State the smallest safe next step.
- Do not add praise-only sections or subjective compliments.
- Apply rules pragmatically. Do not recommend extraction, wrappers, `Optional`, value objects, or indirection unless they improve clarity, correctness, testability, or change safety in the observed code.
- If evidence is incomplete, phrase the point as a risk or question, not a definite violation.

## Java/framework caveats

- Respect the project Java version before suggesting records, sealed classes, switch expressions, or pattern matching.
- Do not treat Spring, JPA, serialization, or framework annotations as design problems unless they create concrete coupling, lifecycle, or testing cost.
- Be careful with JPA entities, proxies, transactions, reflection, serialization, and framework-required constructors.
- Do not flag Lombok, records, builders, or mutable DTOs by default. Flag them only when they obscure invariants, create framework/lifecycle risk, or make tests/refactoring harder.
- Prefer `Optional` mainly for return values; do not mechanically replace every nullable field or parameter.

## Typical output

Use the shortest report that fits the scope. Omit empty sections.

1. Scope and assumptions
2. Findings, ordered by severity and refactoring payoff
3. Smallest safe refactoring order

For each finding, use the shared taxonomy schema: severity, rule/smell, location, evidence, impact, smallest safe refactor, and 1-3 labels.

Limit to the top material findings unless the user asks for an exhaustive review.
