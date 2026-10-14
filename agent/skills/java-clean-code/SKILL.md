---
name: java-clean-code
description: Reviews Java code inside methods and classes for clean-code problems, covering naming, function design, duplication, comments, null and Optional contracts, exception handling, hidden side effects, shared mutable state, and tests that block refactoring. Use for a Java file, diff, PR, method, or class when the question is readability or safe refactoring. For class, interface, or package design use java-clean-solid. For a broad repository or module audit use java-clean-audit. For trimming test suites use trim-tests.
compatibility: Java 8+ with Maven or Gradle; plain Java or Spring. Suggestions follow the Java version found in the build files.
---

# java-clean-code

Local lens: how the code inside a method or class reads, fails, and changes, in the terms of *Refactoring*, *Clean Code*, and *Effective Java*.

## Load before concluding

- [Review contract](../java-clean-shared/references/review-contract.md): scope, evidence, severity, and finding format. Required.
- [Smell catalog](../java-clean-shared/references/smell-catalog.md): smell names, look-alikes to skip, first fixes. Required. Report from the Local section; use the Design section to recognize root causes.
- [Calibration examples](references/calibration.md): when you are unsure whether something is worth reporting or what the right first fix is, or when the user asks for examples.

## What to check

In rough order of payoff:

1. Failure and state hazards: swallowed or misreported failures, hidden side effects, unclear null contracts, unsafe shared mutable state.
2. Function design: mixed abstraction levels and phases, flag arguments, temporal coupling, deep nesting.
3. Duplicated rules that must change together.
4. Names and comments that mislead or hide intent.
5. Tests: whether they would catch a mistake in the refactoring you suggest, and whether they get in its way.

Leave layout to the project's formatter or linter. Mention formatting only when no such tool is configured and the layout hides structure.

## Design root causes

When several local smells come from one design problem (a god class, a misplaced responsibility, a dependency on infrastructure), report one finding under the design smell's name and use the local smells as its evidence. Mention that `java-clean-solid` can go deeper if the user wants a design review.

## Fix advice

- Prefer a private method (Extract Function) over a new class. Extract a class only when the part has its own state, its own collaborators, or a separate reason to change.
- Keep orchestration visible. Don't hide persistence, messaging, or event publishing behind a vague helper such as `afterSave()`.
- Introduce a new type (value object, parameter object, result type) only when it carries validation or prevents a real mix-up.
