# Expected: java-clean-code on diff-review-unrelated-smells

Tests: a diff review stays on the changed lines and ignores pre-existing smells the change doesn't touch.

## Must report

None. The change makes `normalizeEmail` locale-safe with `Locale.ROOT`.

## May report

- A one-line note that `LegacyReportService` has pre-existing issues outside the diff's scope.
- A suggestion to apply the same `Locale.ROOT` fix to other case conversions in the class, if the agent searched the file and found some.

## Must not report

- Findings about `processEverything` or the class's responsibilities.
- Refactoring plans for code the diff doesn't change.
- The `Locale.ROOT` change itself as a problem.
