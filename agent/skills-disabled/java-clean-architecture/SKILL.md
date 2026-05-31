---
name: java-clean-architecture
description: Architecture audit skill for Java package, module, and boundary design. Temporarily disabled from automatic invocation while its rules are under review.
compatibility: Best for Java 11+ codebases using Maven or Gradle. Works with plain Java and Spring-style applications.
disable-model-invocation: true
---

# java-clean-architecture

This skill is temporarily disabled. Do not use it in ordinary audits unless the user explicitly asks for architecture-specific guidance.

## Primary focus

- dependency direction
- domain/application/infrastructure separation
- framework code at the edges
- thin controllers and explicit use-case orchestration
- DTO, entity, and domain model separation
- cyclic dependencies and god modules
- transaction and side-effect boundaries

## References to load

Read these before concluding:

- [Shared audit playbook](../java-clean-shared/references/audit-playbook.md)
- [Architecture rules](references/architecture-rules.md)

Optionally load sibling skills if needed:

- `../java-clean-solid/references/solid-principles.md` for DIP/SRP crossover
- `../java-clean-code/references/clean-code-and-refactoring-rules.md` for local smells inside hotspot classes

## Review stance

- Use neutral, professional language.
- Prioritize dependency direction, boundary clarity, and long-term changeability.
- Focus on structural problems before local style issues.
- Explain practical impact: coupling, test cost, framework lock-in, or hidden side effects.
- Do not add praise-only sections or subjective compliments.
- Recommend incremental architectural refactoring, not large single-step rewrites.

## Typical output

Summarize:

1. scope and assumptions
2. highest-risk architecture issues
3. package or module hotspots
4. recommended migration path

Tag findings with benefit labels from the shared audit playbook.
