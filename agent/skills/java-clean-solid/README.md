# java-clean-solid quickstart

Quick guide for asking Pi to review Java class and interface design through a pragmatic SOLID lens.

Use this when the main questions are responsibility boundaries, coupling, inheritance contracts, interface size, dependency direction, extensibility, or testability. Use `java-clean-code` instead for local readability, method shape, naming, duplication, null/error handling, or comments.

## Useful inputs

Have these ready, or ask Pi to discover them:

- target classes, interfaces, package, module, or diff
- design concern: Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, or Dependency Inversion principles, coupling, cohesion, or hard-to-test code
- collaborators or representative flow to trace
- Java/framework constraints, especially Spring, JPA, serialization, or generated code
- desired output depth: top findings, design trade-off review, or incremental refactoring plan

## Example prompts

```text
Use java-clean-solid to review PaymentService and its collaborators for responsibility boundaries and testability.
```

```text
Review this package for SOLID issues. Prioritize concrete coupling and change-ripple risks over style preferences.
```

```text
Check whether this interface is too broad for its clients and suggest a safe split if needed.
```

```text
Review this inheritance hierarchy for substitution risks and brittle extension points.
```

```text
Look at the new branch diff and report only material class-design issues introduced or exposed by the change.
```

## What to expect

Expect a concise design review with:

- scope and assumptions
- SOLID/design findings ranked by severity and refactoring payoff
- evidence of concrete cost: ripple edits, brittle tests, unclear ownership, tight coupling, or contract risk
- impact on coupling, extensibility, cohesion, or testability
- the smallest safe design refactor, not a full rewrite

Expect Pi to use SOLID as a diagnostic tool, not as a reason to add abstractions. It should not flag framework annotations, Lombok, DTOs, records, or builders unless they create a specific lifecycle, invariant, coupling, or testing problem.

## Related files

- `SKILL.md` - activation and agent workflow details
- `references/solid-checklist.md` - compact checklist used for most reviews
- `references/solid-principles.md` - deeper SOLID notes for broad or tricky audits
- `examples/README.md` - calibration fixtures for future skill edits
- `../java-clean-shared/references/taxonomy.md` - severity, evidence, labels, and finding schema
