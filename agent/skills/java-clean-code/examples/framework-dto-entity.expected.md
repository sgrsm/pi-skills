# Expected clean-code review

No material clean-code findings in scope.

Do **not** flag these framework mechanics by default:

- JPA no-arg constructor
- mutable JPA fields required by persistence
- Lombok DTO annotations
- mutable response DTO fields
- Spring `@Service`

Only flag them if surrounding evidence shows concrete cost, such as broken invariants, lifecycle bugs, serialization problems, hidden coupling, or tests that require unnecessary framework startup.

Acceptable minor follow-up only if evidence exists:

- validate `CustomerEntity` invariants at creation boundaries
- prefer immutable DTOs if the project supports them and mutation has caused bugs
