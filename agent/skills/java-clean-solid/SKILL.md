---
name: java-clean-solid
description: Reviews Java class, interface, and package design through SOLID, coupling, and cohesion, covering responsibility boundaries, inheritance and substitutability, interface shape, dependency direction, package cycles and layering, and abstractions that cost more than they give. Use when the question is how types and packages relate, why changes ripple, or what makes code hard to test. For code inside methods use java-clean-code. For a broad repository or module audit use java-clean-audit.
compatibility: Java 8+ with Maven or Gradle; plain Java or Spring. Suggestions follow the Java version found in the build files.
---

# java-clean-solid

Design lens: how responsibilities and dependencies are spread across types and packages, in the terms of *Clean Architecture*, *Refactoring*, and *Effective Java*. Use SOLID to explain a cost you can show, never as a goal in itself.

## Load before concluding

- [Review contract](../java-clean-shared/references/review-contract.md): scope, evidence, severity, and finding format. Required.
- [Smell catalog](../java-clean-shared/references/smell-catalog.md): smell names, look-alikes to skip, first fixes. Required. Report from the Design section, and from the Architecture section at package scope or wider.
- [Calibration examples](references/calibration.md): when applying a principle is borderline, or when the user asks for examples.

## Principle checks

| Principle | Question | Evidence to collect |
|---|---|---|
| SRP | Do different actors (the people or systems that request changes) force edits to this class? | method groups that use disjoint fields and collaborators; unrelated commits in `git log -- <file>` |
| OCP | Does adding the next variant of a recurring concept need edits in several places? | two or more switch or `if` sites on the same type code; `default` branches at those sites |
| LSP | Can callers use every subtype through the base type without checking which one they have? | overrides that throw, do nothing, or tighten preconditions; `instanceof` at call sites; the base type's documented contract |
| ISP | Do clients depend on operations they never call? | the methods each visible client calls (call-site search); test stubs for methods the client doesn't use |
| DIP | Does policy depend on details, and does the policy side own the abstraction it uses? | infrastructure, framework, or vendor imports in core packages; the package that declares the interface; `new` of infrastructure in core code |

## Design advice

- Removing indirection is a valid finding. Shallow, pass-through, and speculative abstractions cost as much as missing ones.
- Put abstractions at volatile, external, cross-module, or test-sensitive boundaries, not around every class.
- Prefer composition and role interfaces over inheritance for reuse.
- Migrate one client or one responsibility at a time. Before changing a hierarchy or a public API, add characterization or contract tests.
- Cite local smells as evidence for the design finding instead of listing them separately.
