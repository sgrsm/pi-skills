---
name: java-clean-code
description: Audits Java code for local clean-code issues and refactoring opportunities. Use when reviewing Java classes or methods for naming, method design, duplication, comments, null handling, error handling, tests, and maintainability.
compatibility: Best for Java 11+ codebases using Maven or Gradle. Works with plain Java and Spring-style applications.
---

# java-clean-code

Use this skill when the user wants a Java review focused on local code cleanliness and refactoring.

## Primary focus

- naming clarity
- method size and cohesion
- abstraction level
- side effects and hidden behavior
- duplication and code smells
- comments vs self-explanatory code
- null handling and API clarity
- exceptions and boundary handling
- tests that support safe refactoring

## References to load

Read these before concluding:

- [Shared audit playbook](../java-clean-shared/references/audit-playbook.md)
- [Clean code and refactoring rules](references/clean-code-and-refactoring-rules.md)

Optionally load the sibling SOLID skill if the audit clearly becomes broader:

- `../java-clean-solid/references/solid-principles.md` for class and interface design issues

## Review stance

- Use neutral, professional language.
- Focus on observable code, impact, and specific refactoring steps.
- Prioritize readability, maintenance, testability, and correctness.
- State the smallest safe next step.
- Do not add praise-only sections or subjective compliments.
- Distinguish local code smells from deeper class-design issues.

## Typical output

Summarize:

1. scope and assumptions
2. high-priority findings
3. secondary findings
4. low-risk improvements
5. recommended refactoring order

Tag findings with benefit labels from the shared audit playbook.
