# java-clean-code evaluation fixtures

Calibration data for future skill edits, not runtime references. See `../../java-clean-shared/examples/RUNBOOK.md` for the expected-file format and the evaluation loop.

Findings expected:

- `long-method`: phase mixing reported once; Extract Function first, orchestration kept visible.
- `hidden-side-effect`: a query-looking method that spends points, with its caller as evidence; the fix is a labeled behavior change.
- `swallowed-exception`: a discarded payment failure followed by "mark paid" is Critical; documented best-effort handling is left alone.
- `god-class-root-cause`: many local smells reported as one design root cause, with the local smells as evidence.

Restraint expected:

- `false-positive-orchestration`: a clear orchestration method isn't flagged for calling several collaborators.
- `diff-review-unrelated-smells`: a diff review ignores pre-existing smells the change doesn't touch.
- `framework-dto-entity`: Spring, JPA, Lombok, and DTO mechanics aren't flagged without a concrete cost.
- `no-material-findings`: clean code gets a short answer without invented findings.
