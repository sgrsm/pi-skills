# java-clean-audit quickstart

Quick guide for asking the agent (Pi or Claude Code) for a broad Java audit that covers clean code, SOLID and class design, and package architecture.

Use it for a repository, a module, or several packages, when you want many possible smells turned into a short list of root causes and a refactoring order. For a single file, class, or diff, use `java-clean-code` for code inside methods or `java-clean-solid` for class and interface design.

## Useful inputs

Have these ready, or ask the agent to discover them:

- target scope: repository, module, or packages
- Java version and build tool, if the build files don't make them clear (profiles, generated sources)
- main goal: maintainability, testability, coupling, a refactoring plan, or a risk review
- output depth: top findings, an exhaustive audit, or a step-by-step refactoring order
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
Audit the order and payment modules. Use git history to find the hotspots first.
```

```text
Create a concise onboarding-quality refactoring plan for the order-processing package.
```

## What to expect

The agent reads the build files, maps package dependencies, ranks hotspots by change frequency and size from git history, and then reviews those hotspots. The report contains:

- one or two lines of scope, including the Java version and whether history was available
- a Material risks summary of up to 5 bullets
- findings ranked by severity, each with evidence, impact, a fix labeled `refactoring` or `behavior change`, and a confidence level
- at most 10 findings for a module or 15 for a repository, plus a one-line count of what was left out
- a refactoring order that starts with tests and seams and keeps each step shippable on its own

Expect root causes rather than a list of nits, and no pattern-for-pattern's-sake advice. Framework mechanics are reported only when they cause a concrete coupling, lifecycle, invariant, or testing problem.

## Troubleshooting

- **No hotspot ranking:** the repository has no git history (for example a shallow clone or an exported folder). The agent says so and treats change-frequency claims as hypotheses. Fetch full history for better ranking.
- **No package dependency graph from `jdeps`:** it needs compiled classes. Build the project first, or the agent falls back to searching imports.

## Related files

- `SKILL.md` - activation and audit workflow
- `examples/README.md` - calibration fixtures for future skill edits
- `../java-clean-shared/references/review-contract.md` - scope, evidence, severity, and finding format
- `../java-clean-shared/references/smell-catalog.md` - smells, look-alikes to skip, and first fixes
- `../java-clean-code/references/calibration.md` and `../java-clean-solid/references/calibration.md` - borderline cases with code examples
