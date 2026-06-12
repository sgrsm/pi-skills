---
name: crap4java
description: Runs the local crap4java scanner against Maven-based Java projects and summarizes high-CRAP methods for refactoring. Use when the user asks for CRAP analysis, risky Java complexity hotspots, changed-file CRAP checks, or refactoring priorities based on complexity and coverage.
compatibility: Requires Java 17+ to launch the scanner, a Maven project root, and the local crap4java jar. Works best on projects with tests and JaCoCo coverage configured.
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
- The local crap4java jar requires Java 17+ to launch.
- The target Maven project may require a different JDK for its build/tests; treat the scanner JVM and Maven build JVM as separate concerns.
- Before running a scan, check the target repository/module instructions for required JDK, Maven flags, profiles, or skipped plugins.
- crap4java invokes Maven internally to generate coverage. If the target project requires Maven flags, ensure those flags are propagated to the internal Maven invocation, for example by using an environment-supported mechanism or a temporary `mvn` wrapper. Do not hard-code repository-specific Maven flags or JDK versions in this shared skill.
- By default, the scanner analyzes Java files under `src/`.
- `--changed` analyzes changed Java files under `src/` as detected by crap4java, currently local working-tree changes rather than branch-diff ranges.
- For branch-diff checks such as `main...HEAD`, collect explicit Java paths with Git and pass existing files as targeted paths. Skip deleted files because they cannot be analyzed in the current checkout.
- Explicit paths can be passed to analyze specific files, source directories, or module directories. In multi-module repositories, run from the relevant Maven module root and pass paths relative to that root.
- The jar path defaults to `/Users/sergey/dev/crap4java/target/crap4java-0.1.0-SNAPSHOT.jar`.
- The jar path can be overridden with `CRAP4JAVA_JAR`.
- The Java executable used to launch the scanner can be overridden with `CRAP4JAVA_JAVA`.

## Workflow

1. Identify the intended project root.
   - Prefer the user's current repo if it contains `pom.xml`.
   - Otherwise locate the nearest Maven root or module root.
2. Confirm the repo looks scannable.
   - `pom.xml` exists, unless the user explicitly points at a module root.
   - `src/` exists, or the user provided explicit file/module paths.
3. Prepare the runtime and build environment.
   - Launch the scanner with Java 17+; use `CRAP4JAVA_JAVA` if the default `java` is older.
   - Configure the Maven build JVM and any required Maven flags/profiles from the target repo's instructions.
   - Because the scanner invokes Maven internally, make sure those target-project Maven requirements apply to the internal invocation too.
   - When using SDKMAN or similar toolchain initializers in shell snippets, initialize them before enabling strict shell modes such as `set -euo pipefail`.
   - Avoid Bash 4-only helpers such as `mapfile` in portable snippets; macOS `/bin/bash` may be Bash 3.2.
4. Choose the right wrapper:

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

5. If the project is multi-module and the root scan fails or is too broad, retry from a more specific module root or pass explicit module directories.
6. Summarize results for the user and point them to the saved report path when `report.sh` was used.

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
2. If `report.sh` saved Markdown/JSON/raw artifacts, point to them; a non-zero scanner exit can still contain parseable CRAP output, for example when a threshold is exceeded.
3. Check whether the chosen directory is the correct Maven root.
4. Check whether Maven and Java are available.
5. Check whether the project has tests and JaCoCo coverage configured.
6. For monorepos, retry from a smaller module root.

## Notes

- Prefer the wrapper scripts over calling the jar directly.
- Both wrappers change into the project root before invoking the jar.
- `report.sh` saves Markdown, JSON, and raw text output files.
- See [usage notes](references/usage.md) for observed local behavior, report defaults, and examples.
