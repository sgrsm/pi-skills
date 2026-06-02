# java-clean-code evaluation fixtures

These examples are calibration data for future skill edits. They are not required runtime references.

- `long-method.input.java` / `long-method.expected.md`: should report phase mixing and suggest incremental extraction.
- `false-positive-orchestration.input.java` / `false-positive-orchestration.expected.md`: should not flag a clear orchestration method solely because it has several collaborator calls.
