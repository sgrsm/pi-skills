# SOLID Checklist

Compact review checklist for Java SOLID and class-design audits. Use it as the default reference; load `solid-principles.md` only when examples or deeper principle calibration are needed.

Use SOLID to explain concrete design cost, not to enforce ceremony.

## Taxonomy

Use [shared taxonomy](../../java-clean-shared/references/taxonomy.md) for severity, evidence strength, benefit labels, and finding schema.

## Principle matrix

| Principle | Flag when evidence shows | Prefer | Guardrail |
|---|---|---|---|
| SRP | one class changes for unrelated reasons; mixes business rules, mapping, persistence, HTTP, reporting, migration, or notification | split by coherent responsibility or use case; move behavior to its owner | an application service may orchestrate several collaborators if it owns one cohesive use case |
| OCP | adding a stable business variation requires repeated edits to existing conditionals or switches across the codebase | introduce a strategy, policy, subtype, registry, or other variation point | do not create plugin points for one unlikely variation or a simple readable branch |
| LSP | subtype strengthens preconditions, weakens guarantees, throws unsupported core operations, or forces callers to `instanceof` | narrow the base contract; split interfaces; replace inheritance with composition | check the documented/base contract before flagging different-but-valid subtype behavior |
| ISP | clients depend on fat interfaces they do not use; tests require broad mocks; implementations throw unsupported methods | split role-focused interfaces around client needs | do not split an interface when all real clients genuinely use all operations |
| DIP | core/business logic constructs or imports volatile infrastructure, framework, HTTP, SQL, vendor SDK, or hard-to-test details | depend on domain-facing abstractions at volatile/test-sensitive boundaries; plug infrastructure in from outside | do not create an interface for every class; prefer abstractions where change or testing pressure exists |

## Cross-cutting design smells

- **God class:** many unrelated responsibilities and collaborators. Usually SRP plus coupling/testability issue.
- **Shotgun surgery:** one change requires many scattered edits. Often OCP/SRP boundary issue.
- **Divergent change:** one class changes for many unrelated reasons. Usually SRP issue.
- **Brittle inheritance:** subclasses override to disable or change core behavior. Usually LSP issue.
- **Speculative generality:** abstraction exists without real variation or test/change benefit. Remove or simplify.
- **Framework lock-in:** domain/use-case logic depends on framework lifecycle or vendor details. Usually DIP issue only when it harms testing, portability, or change safety.

## Refactoring moves

Prefer the smallest move that addresses the evidence:

- extract class around one responsibility
- move method/field to the owning type
- split fat interface by client role
- replace inheritance with composition when reuse is the only reason for inheritance
- introduce strategy/policy only for repeated stable variation
- define domain-facing ports at external or volatile boundaries
- move framework/vendor details to adapters
- remove unused abstractions or pass-through interfaces
- add characterization or contract tests before changing inheritance or public APIs

## False-positive guards

Do not report a SOLID violation solely because:

- a class has several collaborators; orchestration may be its cohesive responsibility
- a switch exists; it may be local, stable, and clearer than polymorphism
- an interface has multiple methods; clients may genuinely use the full role
- a concrete class is injected; abstractions help mainly at volatile, external, cross-module, or test-sensitive boundaries
- framework annotations are present; show concrete lifecycle, coupling, or testing cost
- the design violates a slogan but is already simple, stable, readable, and easy to test

## Finding standard

Use the finding schema from the shared taxonomy. For very short reviews, omit low-value fields only when there are no material findings.
