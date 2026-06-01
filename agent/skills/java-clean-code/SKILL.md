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

- Always load [Clean code checklist](references/clean-code-checklist.md) before concluding.
- For package/module/repo audits or actionable refactoring plans, also load [Shared audit playbook](../java-clean-shared/references/audit-playbook.md).
- Load [Detailed clean code and refactoring rules](references/clean-code-and-refactoring-rules.md) only when the checklist is insufficient, the user asks for examples, or the audit is broad/exhaustive.
- Do not load the sibling SOLID reference by default. Load `../java-clean-solid/references/solid-checklist.md` only when the root issue is class or interface design.

## Review stance

- Use neutral, professional language.
- Focus on observable code, impact, and specific refactoring steps.
- Prioritize correctness, readability, maintenance, testability, and change safety.
- State the smallest safe next step.
- Do not add praise-only sections or subjective compliments.
- Apply rules pragmatically. Do not recommend extraction, wrappers, `Optional`, value objects, or indirection unless they improve clarity, correctness, testability, or change safety in the observed code.

## Java/framework caveats

- Respect the project Java version before suggesting records, sealed classes, switch expressions, or pattern matching.
- Do not treat Spring, JPA, serialization, or framework annotations as design problems unless they create concrete coupling, lifecycle, or testing cost.
- Be careful with JPA entities, proxies, transactions, reflection, serialization, and framework-required constructors.
- Prefer `Optional` mainly for return values; do not mechanically replace every nullable field or parameter.

## Typical output

Use the shortest report that fits the scope. Omit empty sections.

1. Scope and assumptions
2. Findings, ordered by severity and refactoring payoff
3. Smallest safe refactoring order

For each finding include:

- Severity: Critical / Major / Moderate / Minor
- Rule or smell
- Location
- Evidence
- Impact
- Smallest safe refactor
- Labels: 1-3 benefit labels

Limit to the top material findings unless the user asks for an exhaustive review.
