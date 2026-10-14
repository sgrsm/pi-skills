# Java clean-skill fixture runbook

Fixtures calibrate `java-clean-code`, `java-clean-solid`, and `java-clean-audit`. They are regression data for skill edits, not runtime references.

## Layout

- `<skill>/examples/<name>.input.<ext>`: a single-file input, either Java source or a diff.
- `<skill>/examples/<name>.input/`: a multi-file input (a small project tree), used for audits.
- `<skill>/examples/<name>.expected.md`: the expected semantics, in three required sections:
  - `## Must report`: findings that must appear, with severity (a range when either is defensible), smell, location, evidence, and acceptable fixes. `None.` for restraint fixtures.
  - `## May report`: correct but optional observations. They don't count as false positives.
  - `## Must not report`: false positives, wrong fixes, and format violations that fail the run.

Each skill's `examples/README.md` lists its fixtures and what each one tests.

## Structural check

From `~/.pi`:

```bash
agent/skills/java-clean-shared/examples/check-fixtures.sh
```

It checks that every input has an expected file with the three sections and that no expected file has lost its input. After changing the script, run its tests:

```bash
agent/skills/java-clean-shared/examples/check-fixtures.test.sh
```

## Evaluation loop

1. Copy the input outside the skills tree under a neutral name, because fixture names such as `no-material-findings` give the answer away. Name a Java file after its main type, a diff `change.diff`, and a directory after its module, for example `dir=$(mktemp -d) && cp agent/skills/java-clean-code/examples/long-method.input.java "$dir/CheckoutService.java" && echo "$dir"`.
2. In a fresh session, invoke the fixture's skill on the copy. Ask for a diff review for `.diff` inputs and a module audit for directory inputs. In headless Claude Code runs, block the expected files with `--disallowedTools "Read(~/.pi/agent/skills/**/examples/**)" "Read(~/.claude/skills/**/examples/**)"`.
3. Compare the response with the expected file:
   - every Must report item appears, with severity in the stated range;
   - nothing from Must not report appears;
   - every other finding is listed under May report, or is clearly correct;
   - each fix is labeled `refactoring` or `behavior change`, and the first step is the smallest safe one;
   - the report follows the review contract's shape and caps.
4. When a run produces a correct finding the expected file doesn't list, add it to May report instead of changing the skill.

Fixtures use domain types they don't define (`Order`, `Money`, `Customer`). Treat them as ordinary domain types unless the fixture says otherwise. Multi-file fixtures have no git history; the agent should say so and pick hotspots by size and structure instead.
