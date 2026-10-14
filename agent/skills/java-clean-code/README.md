# java-clean-code quickstart

Quick guide for asking the agent (Pi or Claude Code) to review Java methods, classes, files, or diffs for readability and safe refactoring.

Use it when the main questions are inside the code: naming, method shape, duplication, comments, null and `Optional` contracts, exception handling, hidden side effects, shared mutable state, or tests that get in the way of refactoring. Use `java-clean-solid` for class, interface, or package design, `java-clean-audit` for a broad module or repository audit, and `trim-tests` to slim down a test suite.

## Useful inputs

Have these ready, or ask the agent to discover them:

- target files, method, class, or diff
- review mode: changed lines only, whole file, or a small package
- Java version and framework constraints, if the build files don't show them
- pain point: long methods, duplication, unclear names, null contracts, exceptions, brittle tests, or general readability
- desired depth: top findings, everything, or a step-by-step refactoring plan

## Example prompts

```text
Use java-clean-code to review src/main/java/com/acme/Foo.java for readability and safe refactoring opportunities.
```

```text
Review this Java diff for clean-code issues. Ignore unrelated pre-existing smells unless they affect the changed code.
```

```text
Check the billing package for long methods, duplication, and unclear names. Give the smallest safe refactoring steps.
```

```text
Review the error handling in PaymentService. Which catch blocks hide failures?
```

```text
Look at OrderService.placeOrder and suggest an incremental cleanup plan without changing behavior.
```

## What to expect

A short report:

- one or two lines of scope: what was read, the Java version, what was left out
- findings ordered by severity, each with a smell name from *Refactoring* or *Clean Code*, a `path:line` location, evidence, impact, a fix, and a confidence level
- each fix labeled `refactoring` (behavior stays the same) or `behavior change` (a decision for you, such as throwing where the code used to ignore `null`)
- at most 5 findings for a file or diff, plus a one-line count of lower-severity items left out
- a refactoring order when findings depend on each other

When the code is fine, you get one or two sentences saying so. Several local smells caused by one design problem show up as a single design finding. Layout issues your formatter would fix aren't reported.

Claims about usage or duplication are checked with a code search first. Points that depend on runtime or domain knowledge the agent can't see are marked as context-dependent or as something for you to verify.

## Related files

- `SKILL.md` - activation and lens
- `references/calibration.md` - borderline cases with code examples
- `examples/README.md` - calibration fixtures for future skill edits
- `../java-clean-shared/references/review-contract.md` - scope, evidence, severity, and finding format
- `../java-clean-shared/references/smell-catalog.md` - smells, look-alikes to skip, and first fixes
