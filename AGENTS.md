- when creating custom extension, always create dedicated folder:
  correct:     `extensions/<extension_name>/index.ts`
  NOT correct: `extensions/<extension_name>.ts`

- for non-trivial changes to executable code in this repo, especially under `extensions/`, prefer a test-first workflow:
  1. write or update focused tests that capture the requirement, expected behavior, or bug reproduction;
  2. implement or change the code to satisfy those tests.

- use the existing test framework and conventions in the repo; do not introduce a new test framework unless explicitly asked.

- when modifying existing code that predates this guidance and lacks tests, do not treat the absence of tests as a blocker; instead, when practical, add the smallest focused test that captures the changed behavior, bug fix, or requirement.

- do not backfill broad test coverage unless explicitly asked; prefer narrow regression or characterization tests around the code being changed.

- exceptions: docs, comments, formatting, simple config changes, and purely mechanical refactors do not require test-first work.

- if test-first is impractical, explain why and use another validation method.
