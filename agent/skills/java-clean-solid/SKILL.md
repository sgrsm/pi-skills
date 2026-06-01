---
name: java-clean-solid
description: Audits Java class and interface design using SOLID principles. Use when reviewing responsibilities, abstractions, polymorphism, inheritance, interface size, dependency inversion, and testability.
compatibility: Best for Java 11+ codebases using Maven or Gradle. Works with plain Java and Spring-style applications.
---

# java-clean-solid

Use this skill when the user wants a Java review focused on SOLID and class-level design.

## Primary focus

- single responsibility and coherent reasons to change
- extension without repeated ripple edits
- safe substitution in inheritance hierarchies
- small role-focused interfaces
- dependency direction and abstractions at useful boundaries
- pragmatic use or removal of indirection

## Boundary

- Use this skill for responsibility boundaries, inheritance contracts, interface shape, dependency direction, coupling, and class-level change cost.
- Use `java-clean-code` for local readability, method design, null/error handling, duplication, and refactoring mechanics.
- If both apply, report the root design issue once and list local code smells as evidence, not duplicate findings.

## References to load

- Always load [SOLID checklist](references/solid-checklist.md) before concluding.
- For package/module/repo audits or actionable refactoring plans, also load [Shared audit playbook](../java-clean-shared/references/audit-playbook.md).
- Load [SOLID principles](references/solid-principles.md) only when the checklist is insufficient, the user asks for examples, or the audit is broad/exhaustive.
- Do not load the sibling clean-code reference by default. Load `../java-clean-code/references/clean-code-checklist.md` only when local smells are needed to support a design finding.

## Review stance

- Use neutral, professional language.
- Use SOLID as a diagnostic lens, not a reason to add ceremony.
- Show concrete design cost: ripple edits, brittle tests, tight coupling, unclear ownership, or contract risk.
- Prefer simpler designs when they are already clear, stable, and easy to test.
- Do not add praise-only sections or subjective compliments.
- Do not recommend abstraction unless it improves clarity, replaceability, testability, or change safety.
- Do not call something a SOLID violation without evidence of cost or risk.

## Java/framework caveats

- Respect the project Java version and framework constraints before suggesting records, sealed hierarchies, modules, or newer language features.
- Do not treat Spring, JPA, serialization, or framework annotations as design problems unless they create concrete coupling, lifecycle, or testing cost.
- Be careful with JPA entities, proxies, transactions, reflection, serialization, and framework-required constructors.

## Typical output

Use the shortest report that fits the scope. Omit empty sections.

1. Scope and assumptions
2. SOLID/design findings, ordered by severity and refactoring payoff
3. Impact on coupling, extensibility, and testability
4. Smallest safe design refactoring order

For each finding include:

- Severity: Critical / Major / Moderate / Minor
- Principle or design smell
- Location
- Evidence
- Impact
- Smallest safe refactor
- Labels: 1-3 benefit labels

Limit to the top material findings unless the user asks for an exhaustive review.
