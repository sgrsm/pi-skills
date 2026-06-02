# java-clean-code evaluation fixtures

These examples are calibration data for future skill edits. They are not required runtime references. See `../../java-clean-shared/examples/RUNBOOK.md` for the manual evaluation loop.

- `long-method.input.java` / `long-method.expected.md`: should report phase mixing and suggest incremental extraction.
- `false-positive-orchestration.input.java` / `false-positive-orchestration.expected.md`: should not flag a clear orchestration method solely because it has several collaborator calls.
- `diff-review-unrelated-smells.input.diff` / `diff-review-unrelated-smells.expected.md`: should ignore unrelated pre-existing smells during diff review.
- `framework-dto-entity.input.java` / `framework-dto-entity.expected.md`: should not flag Spring/JPA/Lombok/DTO mechanics without concrete cost.
- `no-material-findings.input.java` / `no-material-findings.expected.md`: should return no material findings and avoid invented low-value comments.
