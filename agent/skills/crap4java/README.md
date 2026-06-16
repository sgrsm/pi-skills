# crap4java quickstart

Quick guide for asking Pi to run CRAP analysis on Maven-based Java code.

CRAP analysis is most useful when you want to find methods that are both complex and weakly covered by tests. The local skill depends on Uncle Bob's [`crap4java`](https://github.com/unclebob/crap4java): clone that repository, build it from source, and point Pi at the generated jar.

## Useful scan inputs

Have these ready, or ask Pi to discover them:

- target repo/module root
- local scanner jar path, usually via `CRAP4JAVA_JAR`
- any project-specific JDK, Maven profiles, flags, or skipped plugins needed for tests/coverage
- desired scope: full project, changed files, a branch diff, one module, or explicit files/directories
- whether you want only a console summary or saved Markdown/JSON/raw artifacts

For wrapper syntax and options, use `scripts/scan.sh --help` or `scripts/report.sh --help`. For observed scanner quirks, see `references/scanner-notes.md`.

## Example prompts

```text
Run crap4java on this Maven repo and summarize the highest-risk methods.
```

```text
Run crap4java on local changed Java files only. Save a report artifact and call out methods with high complexity and low coverage.
```

```text
Check CRAP risk for Java files changed in main...HEAD. Skip deleted files and pass the remaining paths explicitly.
```

```text
Run crap4java for module-a and suggest the top refactoring and test-improvement targets.
```

```text
Use CRAP4JAVA_JAR=/path/to/crap4java.jar and Java 17 at /path/to/java17/bin/java. Analyze src/main/java/com/acme/Foo.java.
```

```text
Generate a crap4java report under /tmp/crap4java-reports with the top 20 offenders.
```

## What to expect

Expect a short summary of:

- command/scope used
- worst CRAP hotspots
- high-complexity plus low-coverage methods
- risky clusters in the same class
- missing coverage/parser gaps, if any
- concrete next steps: add tests, simplify branching, split methods, or fix coverage setup

## Related files

- `SKILL.md` - activation and workflow details for Pi
- `references/scanner-notes.md` - observed scanner/wrapper quirks and low-level notes
- `scripts/scan.sh` - quick scan wrapper
- `scripts/report.sh` - saved report wrapper
