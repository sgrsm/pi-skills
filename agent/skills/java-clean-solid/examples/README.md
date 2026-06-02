# java-clean-solid evaluation fixtures

These examples are calibration data for future skill edits. They are not required runtime references. See `../../java-clean-shared/examples/RUNBOOK.md` for the manual evaluation loop.

- `fat-interface.input.java` / `fat-interface.expected.md`: should report ISP with concrete client coupling.
- `valid-application-service.input.java` / `valid-application-service.expected.md`: should not flag a cohesive application service solely because it orchestrates several collaborators.
