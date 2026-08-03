# trim-tests quickstart

Use this skill when a Java + Spring Boot feature has accumulated too many tests across implementation phases and you want a smaller, clearer suite without weakening important guarantees.

The preferred destination is usually one representative happy-flow integration test, focused plain-JUnit unit tests for class-owned business behavior, and only a few specialized Spring or infrastructure tests where real boundary semantics matter.

## Useful inputs

Provide these, or ask Pi to discover them:

- target feature, package, module, files, or branch diff;
- requirements or acceptance criteria, especially critical failure behavior;
- Maven/Gradle command and required profiles;
- known production, security, transaction, messaging, retry, idempotency, or compatibility risks;
- whether you want recommendations only or an applied test refactor;
- desired evidence such as estimated LOC reduction, runtime comparison, or a guarantee-to-test map.

## Example prompts

```text
Use trim-tests to review the tests added for this branch. Suggest safe deletions, merges, and conversions without editing files.
```

```text
Review the checkout feature's Spring Boot tests. Aim for one happy-flow integration test and focused unit tests with mocked collaborators. Preserve payment, idempotency, transaction, and API error guarantees.
```

```text
Find tests in this module that start Spring unnecessarily and show which ones can become plain JUnit + Mockito tests.
```

```text
Map overlapping controller, service, repository, and @SpringBootTest coverage for this feature. Propose the smallest credible target suite and estimate the test LOC reduction.
```

```text
Apply the safe trim plan to these tests, run the focused baseline first, and report which guarantees each retained test owns.
```

## What to expect

By default, Pi performs a read-only review and reports:

- the current test shape and main sources of waste;
- business- and operational-critical guarantees inferred from the code and requirements;
- a proposed portfolio by test layer;
- exact `keep`, `delete`, `merge`, `convert`, or `simplify` actions with file/test locations;
- the retained owner for every guarantee affected by a deletion or merge;
- estimated or measured LOC/runtime/maintenance savings;
- unresolved risks and validation steps.

Pi should not force the preferred one-integration-test shape when distinct security, persistence, transaction, messaging, external-protocol, or configuration behavior requires a real boundary test. It should also avoid retaining tests that only re-prove Spring Boot, JUnit, Mockito, Jackson, Lombok, or other library behavior.

## Related files

- `SKILL.md` - activation rules, workflow, target suite shape, and guardrails
- `references/review-playbook.md` - guarantee mapping, Spring test-layer guidance, trimming patterns, and safe edit workflow
