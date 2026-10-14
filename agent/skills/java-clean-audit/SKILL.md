---
name: java-clean-audit
description: Broad Java audit that combines clean code, SOLID and class design, and package architecture into a ranked list of root causes with a refactoring order. Use for an end-to-end review of a Java repository, module, or several packages, or when the user asks for overall code quality, refactoring priorities, or clean code and SOLID together. For a single file, method, class, or diff use java-clean-code or java-clean-solid.
compatibility: Java 8+ with Maven or Gradle; plain Java or Spring. Suggestions follow the Java version found in the build files.
---

# java-clean-audit

Find the few root causes that make this codebase expensive or risky to change, and the order in which to fix them.

## Load before concluding

- [Review contract](../java-clean-shared/references/review-contract.md): scope, evidence, severity, and finding format. Required.
- [Smell catalog](../java-clean-shared/references/smell-catalog.md), all sections. Required.
- Calibration examples for the [local](../java-clean-code/references/calibration.md) and [design](../java-clean-solid/references/calibration.md) lenses: when a hotspot finding is borderline.

## Workflow

1. **Constraints.** Read the build files for the Java version, modules, framework versions, generated sources, and existing guardrails (formatter, Checkstyle, Error Prone, ArchUnit). Note what the user rules out: public APIs, release risk, areas to avoid.
2. **Structure.** Map modules and packages and the package dependency graph. Use `jdeps -verbose:package` on compiled classes when they exist; otherwise search imports per source package (`grep -rn '^import <base.package>\.' --include='*.java' src/main/java`). Note the test layout and which kinds of tests exist.
3. **Hotspots.** Rank files by change frequency and size, for example `git log --since=12.months --name-only --format= -- '*.java' | sort | uniq -c | sort -rn | head -20` next to line counts. If `crap4java` is available and the user wants it, use its complexity-and-coverage ranking too. Pick 3 to 5 hotspots and one or two representative flows from an entry point (controller, listener, scheduled job).
4. **Architecture pass** over the dependency graph: cycles, dependency-rule violations, leaking models, over-exposed APIs.
5. **Design pass** on the hotspots and flows with the `java-clean-solid` principle checks.
6. **Local pass** on the same code with the `java-clean-code` checks. Keep only smells that are root causes, correctness hazards, or high-payoff.
7. **Tests.** Check whether tests protect the hotspots, and whether the design forces heavy setup (a full application context, external services) to test pure logic.
8. **Rank.** Merge symptoms into root causes, then apply the contract's severity and caps.

If history isn't available (no repository, shallow clone), say so in the scope line and pick hotspots by size and structure instead of change frequency.

## Output

Use the contract's report shape with two differences:

- After the scope line, add **Material risks**: at most 5 bullets for module or repository scope, one line each.
- The refactoring order is required. Start with the safety net, then seams, then moves, with each step shippable alone and behavior changes kept apart from structural ones.
