# Clean Code and Refactoring Rules

On-demand index for detailed Java clean-code rules inspired by *Clean Code*, *Refactoring*, and common Java practice. For normal audits, load `clean-code-checklist.md` instead of these detailed examples.

Use detailed topic files only when the checklist is insufficient, the user asks for examples, or the audit is broad/exhaustive.

| Need | Load |
|---|---|
| Names, methods, comments, formatting, local flow | [Naming, methods, comments, and formatting rules](rules-naming-methods.md) |
| Classes, objects, nulls, exceptions, external boundaries | [Classes, objects, error handling, and boundary rules](rules-classes-boundaries.md) |
| Tests, safe refactoring, characterization tests | [Tests and refactoring rules](rules-tests-refactoring.md) |
| Shared mutable state, immutability, locks, thread-safety | [Concurrency and state rules](rules-concurrency-state.md) |

For broad or exhaustive audits, load only the topic files relevant to the observed issues; load all topic files only when the user explicitly asks for comprehensive clean-code calibration.

## Global caveats

- Treat rules as heuristics, not slogans.
- Do not recommend extraction, wrappers, `Optional`, value objects, or indirection unless the observed code shows readability, correctness, testability, or change-safety cost.
- Respect the project Java version and framework constraints.
- Be careful with JPA entities, proxies, transactions, reflection, serialization, Lombok, records, builders, mutable DTOs, and framework-required constructors.
- Use `../../java-clean-solid/references/solid-checklist.md` when the root cause is responsibility boundaries, inheritance contracts, interface shape, dependency direction, or change ripple.
