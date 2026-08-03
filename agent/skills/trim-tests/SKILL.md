---
name: trim-tests
description: Reviews Java Spring Boot tests for safe reductions in redundancy, overlap, weight, and ceremony. Use when trimming test LOC without weakening business- or operational-critical guarantees, typically toward one happy-flow integration test plus focused unit tests.
compatibility: Java and Spring Boot projects using Maven or Gradle; best suited to JUnit 5, Mockito, Spring Boot Test, MockMvc/WebTestClient, and common container or stub-based integrations.
---

# trim-tests

## Default posture

- Default to read-only recommendations; edit tests only when explicitly asked.
- Optimize confidence against maintenance and runtime cost, not LOC, coverage, or test-count targets.
- Preserve observable business and operational guarantees. Shared line execution does not prove duplication.
- For each feature or coherent flow, prefer:
  1. one end-to-end-ish happy-flow integration test through the real entry point and meaningful Spring wiring; and
  2. lightweight isolated unit tests for class-owned business branches and failures, using mocked collaborators or small fakes.
- Add integration, slice, contract, persistence, or infrastructure tests only for distinct guarantees the happy flow and units cannot credibly protect.
- Follow repository instructions and conventions unless they cause the material waste under review.

## Reference

Read [Review playbook](references/review-playbook.md) before concluding a non-trivial review or applying changes.

## Workflow

1. **Scope.** Identify the feature/flow, production code, tests, build tool, Java/Spring Boot versions, frameworks, and repository instructions. For branch work, inspect the diff and directly affected tests.
2. **Map guarantees.** Infer critical guarantees from requirements, production branches, API/event schemas, persistence, security, transactions, retries, idempotency, and failure handling. Treat uncertain guarantees as questions, not disposable behavior.
3. **Inventory ownership.** For each test or coherent group, record its layer/runtime cost, entry point, real versus mocked collaborators, observable assertion, unique guarantee, overlap, and setup/fixture brittleness.
4. **Design the target.** Assign each retained guarantee to the cheapest credible layer using the target shape below.
5. **Find waste.** Look for cross-layer scenario duplication, repeated context startup, low-value wiring/configuration checks, overspecified mocks, implementation-detail assertions, combinatorial fixtures, copied setup, and tests already owned elsewhere.
6. **Recommend actions.** Use `keep`, `delete`, `merge`, `convert to unit`, `convert to narrower slice`, or `simplify`; name the destination test for each moved guarantee.
7. **Validate preservation.** Map retained business and operational guarantees to their tests and state residual uncertainty. For requested edits, run the smallest practical baseline, then focused tests and relevant build checks.

## Preferred target shape

### Happy-flow integration

- Enter through the real HTTP, messaging, scheduling, or facade boundary.
- Exercise the primary success path with enough Spring wiring.
- Assert externally visible output and essential persisted or emitted effects.
- Keep setup representative and contract-focused; do not create a mega-test or mirror unit branch coverage and intermediate interactions.

### Focused unit tests

- Use plain JUnit with Mockito or small fakes for class-owned decisions, branch boundaries, validation/error translation, contract-significant collaborator calls, separable retry/idempotency logic, and expensive edge-case matrices.
- Avoid Spring startup, broad fixture graphs, incidental call-order verification, trivial delegation, and framework-generated behavior.

### Specialized exceptions

- Protect distinct API/security, JPA/query/transaction, message/broker, external-protocol, retry/fallback, or conditional-configuration guarantees.
- Use the narrowest credible slice, contract, persistence, or infrastructure test; do not re-prove Spring Boot or library behavior.

## Guardrails

- Do not trade away distinct negative-path, security, transaction, concurrency, idempotency, retry, schema, compatibility, or incident-regression guarantees to reach the preferred shape.
- Do not mock the class under test, private/static internals, DTO accessors, records, Lombok output, or Spring merely to retain a test.
- Keep a test only for a distinct guarantee or diagnostic role; prefer deleting an unnecessary test over building utilities for it.
- Recommend a production seam only when it also improves design or isolates a real boundary, not solely to ease testing.
- Use parameterization and shared fixtures only when they reduce duplication without hiding scenario intent.

## Output

Use the shortest evidence-based report that fits the scope:

1. scope and assumptions;
2. current suite shape and main waste;
3. critical-guarantee map and proposed portfolio;
4. prioritized actions with file/test locations and `keep/delete/merge/convert/simplify` labels;
5. estimated LOC/runtime/maintenance reduction, labeled as estimated when unmeasured;
6. validation plan and unresolved risks.

For every deletion or merge, name the retained guarantee owner. Separate safe removals from decisions needing product or operational confirmation. If the suite is already lean, say so and do not invent reductions.
