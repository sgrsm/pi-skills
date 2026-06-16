# crap4java scanner notes

Low-level facts about the local scanner and wrappers. Keep agent workflow guidance in `../SKILL.md` and human onboarding in `../README.md`.

## Scanner dependency

The scanner jar is not vendored by this skill. Clone Uncle Bob's `crap4java` repository, build it from source, and set `CRAP4JAVA_JAR` to the generated jar before running the wrappers:

- <https://github.com/unclebob/crap4java>

## Observed jar interface

```text
Usage:
  crap4java            Analyze all Java files under src/
  crap4java --changed  Analyze changed Java files under src/
  crap4java <path...>  Analyze files, source directories directly, or for module dirs analyze <dir>/src/**/*.java
  crap4java --help     Print this help message
```

## Observed execution quirks

- The jar requires Java 17+ to launch.
- Running outside the target Maven root can fail with Maven's `MissingProjectException`.
- The scanner invokes Maven internally to generate coverage, so target-project JDK, Maven profiles, flags, and skipped plugins must apply to that internal Maven run too.
- The wrapper scripts change into the project root before launching the jar. Use `scripts/scan.sh --help` and `scripts/report.sh --help` for current syntax and options.

## Changed-file selection

- `--changed` is scanner-native changed-file selection: local working-tree Java changes under `src/`.
- For branch ranges such as `main...HEAD`, collect paths with Git and pass existing Java files explicitly.
- Skip deleted files; they cannot be analyzed in the current checkout.
- In multi-module repositories, run from the relevant module root and pass paths relative to that root.

## Output shape and interpretation

Observed table columns:

- `Method` - reported method name
- `Class` - containing class
- `CC` - cyclomatic complexity
- `Cov%` - coverage percentage when available
- `CRAP` - risk score when computable

Treat `N/A` coverage or CRAP as missing coverage/parser/instrumentation data, not as zero coverage or zero risk unless the project output proves otherwise.

## Report wrapper behavior

`report.sh` saves Markdown, JSON, and raw scanner output. If the scanner exits non-zero after producing output, the wrapper still renders artifacts from the saved raw output, prints the saved paths, and then exits with the scanner's original status.
