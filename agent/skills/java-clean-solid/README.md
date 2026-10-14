# java-clean-solid quickstart

Quick guide for asking the agent (Pi or Claude Code) to review Java class, interface, and package design through a pragmatic SOLID lens.

Use it when the main questions are how types and packages relate: responsibility boundaries, inheritance and substitutability, interface size, dependency direction, package cycles, coupling, or code that is hard to test. Use `java-clean-code` for what happens inside methods, and `java-clean-audit` for a broad module or repository audit.

## Useful inputs

Have these ready, or ask the agent to discover them:

- target classes, interfaces, package, module, or diff
- design concern: a SOLID principle, coupling, cohesion, a package cycle, or hard-to-test code
- collaborators or a representative flow to trace
- Java and framework constraints, especially Spring, JPA, serialization, or generated code
- desired depth: top findings, a design trade-off review, or an incremental refactoring plan

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
Does the domain package depend on infrastructure anywhere? Check imports and who owns each interface.
```

## What to expect

A concise design review:

- one or two lines of scope: what was read, the Java version, what was left out
- design findings ordered by severity, each with the principle and smell name, a `path:line` location, evidence of a concrete cost (ripple edits, brittle tests, unclear ownership, tight coupling, contract risk), a fix, and a confidence level
- each fix labeled `refactoring` or `behavior change`, starting with the smallest safe step rather than a rewrite
- at most 5 findings for a few classes or a diff, 10 for a package or module

SOLID is used to explain costs, not as a reason to add abstractions. Expect the agent to also point out abstractions worth removing (pass-through layers, single-implementation interfaces with no purpose), and to leave framework annotations, Lombok, DTOs, records, and Spring Data repositories alone unless they cause a specific problem. On Java 17 and later, exhaustive switches over enums or sealed types aren't treated as OCP violations.

## Related files

- `SKILL.md` - activation, lens, and principle checks
- `references/calibration.md` - borderline cases with code examples
- `examples/README.md` - calibration fixtures for future skill edits
- `../java-clean-shared/references/review-contract.md` - scope, evidence, severity, and finding format
- `../java-clean-shared/references/smell-catalog.md` - smells, look-alikes to skip, and first fixes
