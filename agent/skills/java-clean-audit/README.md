# java-clean-audit quickstart

Quick guide for asking Pi for a broad Java clean-code and SOLID/design audit.

Use this when you want a repo, module, package, or multi-class review that turns many possible smells into a short list of material risks and refactoring priorities. If the request is narrow, use `java-clean-code` for local method/class cleanliness or `java-clean-solid` for class/interface design.

## Useful inputs

Have these ready, or ask Pi to discover them:

- target scope: repository, module, package, files, or diff
- Java version and build tool: Maven, Gradle, profiles, generated sources, or framework constraints
- main goal: maintainability, testability, coupling, readability, refactoring plan, or risk review
- output depth: top findings, exhaustive audit, or step-by-step refactoring order
- constraints: public APIs, legacy behavior, release risk, migration limits, or areas to avoid

## Example prompts

```text
Use java-clean-audit to audit this Java module for clean-code and SOLID issues. Keep it to the top 10 findings.
```

```text
Review src/main/java/com/acme/billing and its tests for maintainability, coupling, and testability. Suggest a safe refactoring order.
```

```text
Audit this repo at a high level. Prioritize root causes over individual naming or formatting comments.
```

```text
Review the changed Java files in this branch and call out only material design or clean-code risks introduced by the diff.
```

```text
Create a concise onboarding-quality refactoring plan for the order-processing package.
```

## What to expect

Expect a concise report with:

- scope and assumptions
- material risks, not a complete nit list
- findings ranked by severity and refactoring payoff
- evidence, impact, and the smallest safe next step
- an incremental refactoring order when the scope is broad enough

Expect Pi to avoid pattern-for-pattern's-sake advice and to treat framework mechanics as issues only when there is concrete coupling, lifecycle, invariant, or testing cost.

## Related files

- `SKILL.md` - activation and agent workflow details
- `../java-clean-shared/references/audit-playbook.md` - deeper audit workflow
- `../java-clean-shared/references/taxonomy.md` - severity, evidence, labels, and finding schema
- `../java-clean-code/references/clean-code-checklist.md` - compact clean-code checklist
- `../java-clean-solid/references/solid-checklist.md` - compact SOLID checklist
