---
name: java-clean-solid
description: Audits Java class and interface design using SOLID principles. Use when reviewing responsibilities, abstractions, polymorphism, inheritance, interface size, dependency inversion, and testability.
compatibility: Best for Java 11+ codebases using Maven or Gradle. Works with plain Java and Spring-style applications.
---

# java-clean-solid

Use this skill when the user wants a Java review focused on SOLID and class-level design.

## Primary focus

- single responsibility
- extension without ripple edits
- safe substitution in inheritance hierarchies
- small role-focused interfaces
- dependencies on abstractions instead of details
- pragmatic use of indirection

## References to load

Read these before concluding:

- [Shared audit playbook](../java-clean-shared/references/audit-playbook.md)
- [SOLID principles](references/solid-principles.md)

Optionally load the sibling clean-code skill if needed:

- `../java-clean-code/references/clean-code-and-refactoring-rules.md` for local smells and refactoring mechanics

## Review stance

- Use neutral, professional language.
- Use SOLID as a diagnostic lens, not a reason to add ceremony.
- Show concrete design cost: ripple edits, brittle tests, tight coupling, or contract risk.
- Prefer simpler designs when they are already clear and stable.
- Do not add praise-only sections or subjective compliments.
- Do not recommend abstraction unless it improves clarity, replaceability, or change safety.

## Typical output

Summarize:

1. scope and assumptions
2. primary SOLID issues
3. impact on coupling, extensibility, and testability
4. smallest safe design refactorings

Tag findings with benefit labels from the shared audit playbook.
