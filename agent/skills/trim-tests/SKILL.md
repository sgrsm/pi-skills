---
name: trim-tests
description: Reviews Java/Spring Boot test suites for redundancy, unnecessary runtime cost, and brittle ceremony. Use when reducing suite size or maintenance cost without weakening business- or operational-critical guarantees.
compatibility: Java and Spring Boot projects using Maven or Gradle; best suited to JUnit 5, Mockito, Spring Boot Test, MockMvc/WebTestClient, and common container or stub-based integrations.
---

# trim-tests

## Default posture

- Default to read-only recommendations; edit tests only when explicitly asked.
- Optimize confidence against maintenance and runtime cost, not LOC, coverage, or test-count targets.
- Preserve observable business and operational guarantees. Shared line execution does not prove duplication.
- Follow repository instructions and enforced quality gates; flag a conflict rather than bypassing them. Wasteful test conventions may be challenged; name each proposed or applied departure in the report.

## Reference

Read [Review playbook](references/review-playbook.md) before concluding a non-trivial review or applying changes.

## Workflow

1. **Scope.** Identify the feature/flow, production code, tests, build tool, Java/Spring Boot versions, frameworks, repository instructions, and quality gates (coverage or mutation thresholds, mandated test layers). For branch work, inspect the diff and directly affected tests.
2. **Map guarantees.** Infer critical guarantees from requirements, production branches, API/event schemas, persistence, security, transactions, retries, idempotency, and failure handling. Treat uncertain guarantees as questions, not disposable behavior.
3. **Inventory ownership.** For each test or coherent group, record its layer/runtime cost, entry point, real versus mocked collaborators, observable assertion, unique guarantee, overlap, and setup/fixture brittleness. Group tests by role to keep the inventory short.
4. **Design the target.** Assign each retained guarantee to the cheapest credible layer using the target shape below.
5. **Find waste.** Look for cross-layer scenario duplication, avoidable context or container startup, low-value wiring/configuration checks, overspecified mocks, implementation-detail assertions, combinatorial fixtures, copied setup, and tests already owned elsewhere.
6. **Recommend actions.** Label each `keep`, `delete`, `merge`, `convert` (to a unit or narrower slice, naming the destination test), or `simplify`. For each deletion or merge, name the retained test and assertion that would fail for the relevant regression (a context that fails to start counts), or explain why the removed test protects no application-specific guarantee. Executing the same path or loading the same bean is not enough.
7. **Validate preservation.** Check that each retained business and operational guarantee still has an owning test, and state residual uncertainty. For requested edits, run the smallest practical baseline, then focused tests and relevant build checks.

## Preferred target shape

For each feature or coherent flow, start from this shape as a hypothesis, not a quota: one happy-flow integration test, focused unit tests, and specialized boundary tests only where needed. Avoid per-method and per-requirement test quotas; one test may own several tightly related assertions.

### Happy-flow integration

- Enter through the real HTTP, messaging, scheduling, or facade boundary.
- Exercise the primary success path with enough Spring wiring.
- Assert externally visible output and essential persisted or emitted effects.
- Keep setup representative and contract-focused; do not create a mega-test or mirror unit branch coverage and intermediate interactions.

### Focused unit tests

- Use plain JUnit with Mockito or small fakes for class-owned decisions, branch boundaries, validation/error translation, contract-significant collaborator calls, separable retry/idempotency logic, and expensive edge-case matrices.
- Avoid Spring startup, broad fixture graphs, incidental call-order verification, trivial delegation, and framework-generated behavior.

### Specialized boundary tests

- Add these only for distinct guarantees the happy flow and units cannot credibly protect, such as API/security, JPA/query/transaction, message/broker, external-protocol, retry/fallback, or conditional-configuration behavior.
- Use the narrowest credible slice, contract, persistence, or infrastructure test; do not re-prove Spring Boot or library behavior.

## Guardrails

- Do not trade away distinct negative-path, security, transaction, concurrency, idempotency, retry, schema, compatibility, or incident-regression guarantees to reach the preferred shape.
- For each proposed deletion, look for regression intent in the test's name, comments, and issue references; when intent is still unclear, inspect relevant history. Preserve unresolved incident-derived guarantees or ask for confirmation.
- Do not mock the class under test, private/static internals, DTO accessors, records, Lombok output, or Spring merely to retain a test.
- Keep a test only for a distinct guarantee or diagnostic role; prefer deleting an unnecessary test over building utilities for it.
- Recommend a production seam only when it also improves design or isolates a real boundary, not solely to ease testing.
- Use parameterization and shared fixtures only when they reduce duplication that remains after redundant tests are removed, without hiding scenario intent.

## Output

Use the shortest evidence-based report that fits the scope. Lead with prioritized actions, each with location, action label, evidence, retained guarantee owner, and risk. Then state scope, assumptions, unresolved risks, and the validation run or planned.

Add the current suite shape, proposed portfolio by layer, or a critical-guarantee map only when it helps the decision. Give LOC, runtime, or maintenance savings only with a defensible basis, labeled as estimates when unmeasured.

Separate safe removals from decisions needing product or operational confirmation. If the suite is already lean, say so and do not invent reductions.
