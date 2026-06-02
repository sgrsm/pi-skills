# Java clean-skill fixture runbook

These fixtures calibrate `java-clean-code`, `java-clean-solid`, and `java-clean-audit`. They are regression data for prompt edits, not required runtime references.

## Quick check

Run the structural fixture check from `/Users/sergey/.pi`:

```bash
agent/skills/java-clean-shared/examples/check-fixtures.sh
```

The script verifies every `*.input.*` fixture under `java-clean-code/examples` and `java-clean-solid/examples` has a matching `*.expected.md` file.

## Manual evaluation loop

For each fixture pair:

1. Invoke the relevant skill on the `*.input.*` file.
2. Compare the response to the matching `*.expected.md` file.
3. Check especially:
   - no false-positive finding is invented
   - severity is reasonable
   - evidence is observable in the fixture
   - impact is concrete, not preference-based
   - recommended refactor is the smallest safe next step
   - unrelated pre-existing issues are ignored for diff fixtures
   - framework mechanics are not flagged without concrete cost

## Fixture map

Clean-code fixtures:

- `java-clean-code/examples/long-method.input.java`: positive long/mixed method case.
- `java-clean-code/examples/false-positive-orchestration.input.java`: clear orchestration method; should not be flagged solely for several collaborator calls.
- `java-clean-code/examples/diff-review-unrelated-smells.input.diff`: diff-scope restraint; should ignore unrelated pre-existing smells.
- `java-clean-code/examples/framework-dto-entity.input.java`: Spring/JPA/Lombok/DTO false-positive guard.
- `java-clean-code/examples/no-material-findings.input.java`: clean narrow-scope case; should return no material findings.

SOLID fixtures:

- `java-clean-solid/examples/fat-interface.input.java`: positive ISP case.
- `java-clean-solid/examples/valid-application-service.input.java`: cohesive application service; should not be flagged solely for several collaborators.

## Expected-output tolerance

Exact wording can vary. Treat a run as acceptable when it preserves the expected semantics: same material findings, no forbidden false positives, similar severity, evidence-based impact, and incremental refactoring advice.
