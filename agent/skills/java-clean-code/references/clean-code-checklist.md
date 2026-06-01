# Clean Code Checklist

Compact review checklist for Java clean-code audits. Use it as the default reference; load the detailed rules file only when examples or deeper calibration are needed.

The rules are practical heuristics inspired by *Clean Code*, *Refactoring*, and common Java practice. Apply them only when the observed code shows readability, correctness, testability, or change-safety cost.

## Benefit labels

Use 1-3 labels per finding: `readability`, `simplicity`, `maintenance`, `testability`, `coupling`, `cohesion`, `modularity`, `encapsulation`, `extensibility`, `reusability`, `robustness`, `correctness`, `diagnostics`, `performance`, `concurrency`.

## Severity guide

- **Critical:** can cause or hide production failures, data corruption, broken invariants, unsafe concurrency, or transaction bugs.
- **Major:** makes change expensive: god classes, deep coupling, repeated conditionals, hard-to-test design, large duplication.
- **Moderate:** local smells: long methods, poor names, confusing comments, primitive obsession, nullable contracts, noisy abstractions.
- **Minor:** small cleanup with low risk and low payoff.

## Review matrix

| Area | Flag when evidence shows | Prefer | Guardrail |
|---|---|---|---|
| Naming | vague names (`data`, `info`, `manager`), inconsistent verbs, encoded types, unsearchable abbreviations | intention-revealing domain names; one word per concept; enough context without repetition | preserve established domain/API terms and Java conventions |
| Methods | long or mixed-purpose methods; multiple abstraction levels; hidden phases | small cohesive methods; one abstraction level; explicit orchestration vs detail work | do not split tiny clear code only to satisfy a size rule |
| Side effects | query-looking methods mutate state; important effects are hidden behind vague helpers | names that reveal command/query intent; visible side effects at orchestration boundaries | `getOrCreate` can be valid if command semantics, transaction, and concurrency behavior are explicit |
| Conditionals | deep nesting; repeated `if`/`switch` for stable business variation; flag arguments | guard clauses; named predicates; polymorphism/strategy for repeated stable variation | avoid abstraction for one unlikely case or simple readable branch |
| Duplication | copied rules, literals, validation, mapping, or conditionals that must change together | extract method/class/value object/policy at the common concept | tolerate incidental similarity until a shared concept is clear |
| Comments | comments restate code, lie, or compensate for unclear names | clearer names and structure; comments for why, trade-offs, invariants, or external constraints | keep useful rationale and warnings; delete commented-out code |
| Formatting/layout | dense code, unrelated code interleaved, variables far from use | scan-friendly formatting; related code close; narrow variable scope | avoid formatting-only findings unless readability materially suffers |
| Classes | low cohesion, utility dumping grounds, feature envy, exposed mutable internals | focused classes; behavior near owning data; encapsulated invariants; composition over inheritance for reuse | distinguish local class smell from broader SOLID/design issue |
| Data modeling | primitive obsession, data clumps, magic literals, long parameter lists | value objects, parameter objects, named constants/concepts | introduce types only when they carry meaning, validation, or reduce misuse |
| Nulls | hidden nullable contracts, defensive null clutter, unclear absence handling | explicit contracts; fail fast for required args; `Optional` for absent return values where idiomatic | do not mechanically replace nullable fields/DTOs/framework-bound values |
| Exceptions | swallowed exceptions, generic errors, leaked vendor/library exceptions | specific exceptions with context; boundary exception translation; visible happy path | avoid wrapping when it erases useful type/context or adds noise |
| Boundaries | core code depends directly on volatile vendor/framework APIs | small adapters/wrappers around volatile, hard-to-test, or vendor-specific boundaries | do not wrap stable standard-library/simple framework APIs by default |
| Tests | slow, flaky, broad, implementation-coupled, or missing around risky refactors | fast deterministic behavior tests; characterization tests before legacy changes | do not require private-method tests; test through meaningful public behavior |
| Refactoring plan | large risky rewrites suggested without safety net | add tests, extract seams, move one responsibility, rename after behavior is protected | prefer incremental steps and rollback-safe changes |
| Concurrency/state | shared mutable state, undocumented ownership/thread-safety, large lock scopes | immutability where practical; explicit ownership; small synchronized regions | respect existing concurrency model and performance constraints |

## Common refactoring moves

Prefer the smallest move that addresses the evidence:

- rename for clarity
- extract method or class
- move method or field
- introduce value object or parameter object
- split phase: parse, validate, compute, persist, notify
- separate query from modifier when mutation is surprising
- replace repeated conditionals with a stable variation point
- wrap an external API at a volatile or test-sensitive boundary
- remove dead, speculative, or lazy abstraction
- add characterization tests before changing unclear legacy behavior

## False-positive guards

Do not report a smell solely because:

- a method has several calls; orchestration can be clear and cohesive
- a class uses framework annotations; show concrete coupling, lifecycle, or testing cost
- a branch or switch exists; show repeated variation or change pain before suggesting polymorphism
- a primitive appears; show missing validation, meaning, or misuse risk before suggesting a value object
- a dependency is concrete; abstractions help mainly at volatile, external, or test-sensitive boundaries
- code violates a slogan but is already simple, stable, readable, and easy to test

## Finding standard

Each material finding should include: severity, rule/smell, location, evidence, impact, smallest safe refactor, and 1-3 benefit labels.
