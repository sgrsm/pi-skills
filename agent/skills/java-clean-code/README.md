# java-clean-code quickstart

Quick guide for asking Pi to review Java methods, classes, and small packages for readability and safe refactoring opportunities.

Use this for files, diffs, methods, classes, or small packages where the main questions are readability, naming, method size/cohesion, duplication, null/error handling, comments, or test support. Use `java-clean-solid` instead when the root question is responsibility boundaries, interfaces, inheritance, dependency direction, or class-level change cost.

## Useful inputs

Have these ready, or ask Pi to discover them:

- target files, package, or diff
- review mode: narrow review, changed-lines-only review, or package-level scan
- Java/framework constraints that affect refactoring suggestions
- pain point: long methods, duplication, unclear naming, null contracts, exceptions, brittle tests, or general readability
- desired output depth: top findings only, exact refactoring steps, or a patch-ready plan

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
Review these tests for maintainability and whether they support safe refactoring of the production code.
```

```text
Look at OrderService.placeOrder and suggest an incremental cleanup plan without changing behavior.
```

## What to expect

Expect a short, evidence-based review with:

- scope and assumptions
- the top material findings, ordered by severity and payoff
- concrete locations and observable evidence
- impact on readability, maintenance, correctness, diagnostics, or testability
- the smallest safe refactor for each finding

Expect Pi not to invent low-value findings when the code is acceptable. It should avoid blanket advice such as “extract everything,” “wrap everything,” or “replace every nullable value with Optional.”

## Related files

- `SKILL.md` - activation and agent workflow details
- `references/clean-code-checklist.md` - compact checklist used for most reviews
- `references/clean-code-and-refactoring-rules.md` - detailed rule index for deeper audits
- `examples/README.md` - calibration fixtures for future skill edits
- `../java-clean-shared/references/taxonomy.md` - severity, evidence, labels, and finding schema
