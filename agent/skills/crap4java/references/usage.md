# crap4java usage notes

This file captures the current observed behavior of the local jar so the skill can be refined safely later.

## Observed help output

```text
Usage:
  crap4java            Analyze all Java files under src/
  crap4java --changed  Analyze changed Java files under src/
  crap4java <path...>  Analyze files, source directories directly, or for module dirs analyze <dir>/src/**/*.java
  crap4java --help     Print this help message
```

## Observed execution behavior

- The local jar requires Java 17+ to launch.
- Running the jar outside the target project root can fail with Maven's `MissingProjectException`.
- Running the jar from the actual Maven project root works.
- The wrapper script in `../scripts/scan.sh` addresses this by changing into the target project root before invoking the jar.
- The scanner invokes Maven internally to generate coverage, so the target project's required build JDK, Maven flags, profiles, and skipped plugins must be applied to that internal Maven invocation too.

## Changed-file selection notes

- `--changed` means changed Java files detected by crap4java, currently local working-tree changes under `src/`.
- For branch-diff ranges such as `main...HEAD`, collect paths explicitly with Git and pass the existing Java files as targeted paths.
- Skip deleted files because they cannot be analyzed in the current checkout.
- In multi-module repositories, run from the relevant Maven module root and pass paths relative to that root.

## Current wrapper contracts

Quick scan wrapper:

```bash
/Users/sergey/.pi/agent/skills/crap4java/scripts/scan.sh <project-root>
/Users/sergey/.pi/agent/skills/crap4java/scripts/scan.sh <project-root> --changed
/Users/sergey/.pi/agent/skills/crap4java/scripts/scan.sh <project-root> <path...>
```

Saved report wrapper:

```bash
/Users/sergey/.pi/agent/skills/crap4java/scripts/report.sh <project-root>
/Users/sergey/.pi/agent/skills/crap4java/scripts/report.sh <project-root> --changed
/Users/sergey/.pi/agent/skills/crap4java/scripts/report.sh <project-root> --output-dir <dir>
/Users/sergey/.pi/agent/skills/crap4java/scripts/report.sh <project-root> -- <path...>
```

Environment:

- `CRAP4JAVA_JAR` overrides the default jar location.
- `CRAP4JAVA_JAVA` overrides the Java 17+ executable used to launch the scanner.

## Example output shape

```text
CRAP Report
===========
Method                         Class                                 CC    Cov%     CRAP
----------------------------------------------------------------------------------------
hasJacocoPrepareAgent          crap4java.CoverageRunner               7   87.3%      7.1
...
```

## Interpretation hints

- `CC` appears to mean cyclomatic complexity.
- `Cov%` is coverage percentage when available.
- `CRAP` is the risk score to sort by.
- `N/A` values should be treated as missing coverage data rather than zero coverage unless proven otherwise.

## Saved report defaults

`report.sh` currently writes three files:

- Markdown report: viewer-friendly summary with stats, threshold buckets, top offenders, and scanner exit code
- JSON summary: machine-readable parsed rows, aggregate stats, and scanner exit code
- Raw text: original scanner output

If the scanner exits non-zero after producing output, `report.sh` still renders the Markdown/JSON artifacts from the saved raw output and then exits with the scanner's status.

Default output location:

```text
<project-root>/target/crap4java-reports/
```

Default thresholds used by `report.sh`:

- medium: `>= 10`
- high: `>= 20`
- critical: `>= 30`

Default top list size:

- top offenders: `10`

## Known next refinements

- Add project-type detection guidance for multi-module repos.
- Add HTML output alongside Markdown if needed.
- Add better handling guidance for projects without JaCoCo.
