# Test trimming review playbook

Guidance for Java and Spring Boot `trim-tests` reviews; not a quota.

## 1. Map guarantees before counting tests

A valuable test owns a meaningful guarantee with an appropriate failure signal. Start from behavior and risk, not annotations or coverage.

### Business-critical

- calculations, eligibility, state transitions, and invariants;
- meaningful accepted and rejected inputs;
- authorization and tenant/data isolation;
- visible errors and compatibility contracts;
- contract-significant persisted state, emitted events, or calls;
- regressions from incidents or expensive failures.

### Operational-critical

- transactions, rollback, locking, concurrency, and consistency;
- idempotency, deduplication, retry/backoff, and poison-message handling;
- API/message schemas, headers, routing, acknowledgements, and outbox behavior;
- relevant database mappings, custom queries, constraints, and migrations;
- timeouts, circuit breakers, fallbacks, and external protocols;
- security filters and configuration conditions;
- materially fragile or deployment-critical startup/wiring.

Require evidence that a listed risk applies to the scoped feature; do not assume all do.

## 2. Classify existing tests

For each test or coherent parameterized group:

| Field | Record |
|---|---|
| Layer | Plain unit, Spring slice, application integration, infrastructure/contract, or system/E2E |
| Entry point | Real caller boundary used |
| Real collaborators | Real beans, database, broker, filesystem, clock, or external stubs |
| Observable assertion | Output, state, event, protocol, or error checked |
| Unique guarantee | Regression only this test would catch |
| Overlap | Other test already owning the guarantee |
| Cost | Context/container startup, fixtures, mocks, runtime, flakiness, and diagnostic difficulty |
| Decision | Keep, delete, merge, convert, or simplify |

Group tests by role to keep the inventory short.

## 3. Choose the cheapest credible owner

Use the narrowest layer that can genuinely observe the guarantee.

| Guarantee | Usually preferred owner |
|---|---|
| Pure business rule or branch | Plain JUnit unit test |
| One class's orchestration/error decision | Unit test with mocks or small fakes |
| Primary successful feature wiring | One end-to-end-ish Spring integration test |
| HTTP mapping, validation, or security | Happy-flow integration if covered; otherwise focused `@WebMvcTest` or WebFlux equivalent |
| Custom repository query or JPA mapping | Focused `@DataJpaTest` or infrastructure integration test |
| Transaction or locking behavior | Integration test with real transaction/database semantics |
| JSON or event schema | Focused serialization or contract test |
| Broker acknowledgement or routing | Focused broker/infrastructure integration test |
| External protocol mapping | Client contract test with a realistic stub; real service only when necessary |
| Conditional custom configuration | Small context test only when the happy flow does not load and exercise it |

Mocks cannot make a unit test credibly own framework wiring, transactions, queries, serialization, or broker semantics.

## 4. High-yield trimming patterns

- **Duplicate happy paths**
  - **Signal:** Similar success scenarios and assertions across service units, controller slices, repository tests, and `@SpringBootTest`.
  - **Default move:** Let one integration test own cross-layer wiring and the visible happy flow. Keep units for class-owned decisions and boundary tests for unique contracts.
- **Integration matrices**
  - **Signal:** A full context/container starts for every rule variant, invalid input, or collaborator response.
  - **Default move:** Keep one representative success and infrastructure-dependent failures; move business-rule matrices to focused or parameterized units.
- **Heavy unit tests**
  - **Signal:** Spring starts while meaningful collaborators are mocked and only one class is asserted.
  - **Default move:** Construct the class with Mockito or fakes. Keep Spring only when testing injection, proxies, validation, transactions, or configuration.
- **Overspecified interactions**
  - **Signal:** Tests verify getters, mapper calls, incidental call order, `noMoreInteractions`, or exact internal sequences while only the outcome matters.
  - **Default move:** Assert observable results and contract-significant interactions; remove refactoring-sensitive verification.
- **Configuration/wiring ceremony**
  - **Signal:** Tests assert bean existence, annotations, default property binding, standard auto-configuration, or trivial `@Bean` pass-throughs.
  - **Default move:** Delete when the happy-flow context exercises the bean. Retain custom conditions, property transformations, security chains, bean selection, or fragile deployment wiring.
- **Fixture combinatorics**
  - **Signal:** Large builders create near-identical graphs; tests vary irrelevant fields; setup dominates behavior.
  - **Default move:** Use minimal valid fixtures, behavior-named local helpers, and compact parameterized rule tables. Avoid shared fixtures that hide intent or couple unrelated classes.
- **Repeated framework proof**
  - **Signal:** Tests cover standard Jackson, Bean Validation, Spring Data CRUD, Lombok, records, or Boot defaults without custom behavior.
  - **Default move:** Delete; test only custom mapping, configuration, validation composition, or contracts.
- **Exception duplication**
  - **Signal:** The same failure appears at domain, service, controller, and integration layers without layer-specific assertions.
  - **Default move:** Keep the decision at domain/service level and a boundary test only for a distinct status, error body, event, rollback, or other contract.
- **Weak assertion after heavy mocking**
  - **Signal:** Extensive stubbing ends in `notNull`, completion, or a mirrored mock response.
  - **Default move:** Strengthen around a real guarantee or delete; setup complexity does not prove value.

## 5. Distinguish overlap from different risks

Similar execution is legitimate when tests own different guarantees, for example:

- retry eligibility in a unit versus active retry proxy/annotation in integration;
- idempotency decisions versus database uniqueness/locking;
- authorization rules versus enforcement by the web security chain;
- serialization contract versus flow-level business state;
- transaction orchestration versus rollback with a real database.

Name the distinct guarantees before declaring overlap.

## 6. Apply the target shape as a hypothesis

Use the [preferred target shape](../SKILL.md#preferred-target-shape) as a starting hypothesis, not a quota. Avoid per-method and per-requirement test quotas; one test may own several tightly related assertions. Add shared helpers only for material repetition remaining after redundant tests are removed.

## 7. Rank recommendations

| Category | Use when | Action |
|---|---|---|
| Safe trim | Another retained test clearly owns the guarantee, or the test only re-proves framework/library behavior. | Recommend deletion or merge. |
| Structural simplification | A valuable guarantee sits at an unnecessarily expensive layer. | Convert to a unit or narrower slice and name retained assertions. |
| Confirmation required | Intent may encode an undocumented production, regulatory, compatibility, security, or incident-derived requirement. | Ask before deletion. |

Prioritize duplicate slow integrations, then Spring-backed tests that can be units, low-value configuration/framework checks, repeated fixture/mock ceremony, and finally minor assertion/helper cleanup.

## 8. Apply changes safely

When edits are requested:

1. Run focused existing tests when practical and record the baseline.
2. Delete or convert in small groups with explicit guarantee mappings; do not change production behavior unless separately requested.
3. Preserve known-defect regressions unless their guarantee is clearly transferred.
4. Run focused tests after each meaningful group when feedback is reasonably fast, then required module tests and lint/type/static checks.
5. Report unrun tests, environmental failures, uncertain guarantees, and relevant validation results.

When cheap, measure net test LOC, methods/classes removed or converted, Spring context/container starts removed, focused runtime before/after, and duplicated fixture/helper code removed. Measurements support rather than replace the guarantee map.

## 9. Report material actions

| Priority | Location | Action | Why redundant/heavy | Guarantee owner after change | Risk |
|---|---|---|---|---|---|

Then show the portfolio by layer and map critical guarantees to retained owners. Clearly mark assumptions and removals needing confirmation.
