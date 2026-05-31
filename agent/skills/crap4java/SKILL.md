---
name: crap4java
description: Runs the local crap4java scanner against Maven-based Java projects and summarizes high-CRAP methods for refactoring. Use when the user asks for CRAP analysis, risky Java complexity hotspots, changed-file CRAP checks, or refactoring priorities based on complexity and coverage.
compatibility: Requires Java, a Maven project root, and the local crap4java jar. Works best on projects with tests and JaCoCo coverage configured.
---

# crap4java

Use this skill when the user wants a CRAP analysis for a Java project.

## What this skill does

- Runs the local `crap4java` jar through stable wrapper scripts.
- Ensures execution happens from the target project root so Maven-based coverage generation works.
- Summarizes the highest-CRAP methods and classes.
- Saves viewer-friendly Markdown reports with overall stats, threshold buckets, and a top-offenders table when the user wants an artifact.
- Suggests concrete refactoring and test-improvement targets.

## Important assumptions

- The scanner currently expects to run from the Maven project root.
- The target project should usually contain a `pom.xml`.
- By default, the scanner analyzes Java files under `src/`.
- `--changed` analyzes changed Java files under `src/`.
- Explicit paths can be passed to analyze specific files, source directories, or module directories.
- The jar path defaults to `/Users/sergey/dev/crap4java/target/crap4java-0.1.0-SNAPSHOT.jar`.
- The jar path can be overridden with `CRAP4JAVA_JAR`.

## Workflow

1. Identify the intended project root.
   - Prefer the user's current repo if it contains `pom.xml`.
   - Otherwise locate the nearest Maven root or module root.
2. Confirm the repo looks scannable.
   - `pom.xml` exists, unless the user explicitly points at a module root.
   - `src/` exists, or the user provided explicit file/module paths.
3. Choose the right wrapper:

For quick console output:

```bash
/Users/sergey/.pi/agent/skills/crap4java/scripts/scan.sh <project-root>
/Users/sergey/.pi/agent/skills/crap4java/scripts/scan.sh <project-root> --changed
/Users/sergey/.pi/agent/skills/crap4java/scripts/scan.sh <project-root> <path...>
```

For a saved viewer-friendly artifact:

```bash
/Users/sergey/.pi/agent/skills/crap4java/scripts/report.sh <project-root>
/Users/sergey/.pi/agent/skills/crap4java/scripts/report.sh <project-root> --changed
/Users/sergey/.pi/agent/skills/crap4java/scripts/report.sh <project-root> --output-dir <dir>
/Users/sergey/.pi/agent/skills/crap4java/scripts/report.sh <project-root> -- <path...>
```

4. If the project is multi-module and the root scan fails or is too broad, retry from a more specific module root or pass explicit module directories.
5. Summarize results for the user and point them to the saved report path when `report.sh` was used.

## How to summarize results

Focus on the most actionable hotspots first:

- Highest `CRAP` score first.
- Methods with both high `CC` and low `Cov%`.
- Clusters of risky methods in the same class.
- `N/A` coverage rows as separate parser or instrumentation gaps.

When helpful, produce a short table such as:

- method
- class
- CC
- coverage
- CRAP
- why it is risky
- likely fix (refactor, split method, add tests, simplify branching)

For conversational summaries, do not invent a hard threshold unless the user gives one. If needed, describe buckets like "highest", "moderate", and "low" risk.

When using `report.sh`, the saved report defaults to these CRAP thresholds unless overridden:

- medium: `>= 10`
- high: `>= 20`
- critical: `>= 30`

## Failure handling

If the scan fails:

1. Report the exact command and the key error.
2. Check whether the chosen directory is the correct Maven root.
3. Check whether Maven and Java are available.
4. Check whether the project has tests and JaCoCo coverage configured.
5. For monorepos, retry from a smaller module root.

## Notes

- Prefer the wrapper scripts over calling the jar directly.
- Both wrappers change into the project root before invoking the jar.
- `report.sh` saves Markdown, JSON, and raw text output files.
- See [usage notes](references/usage.md) for observed local behavior, report defaults, and examples.
