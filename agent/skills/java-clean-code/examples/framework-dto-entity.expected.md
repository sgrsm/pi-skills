# Expected: java-clean-code on framework-dto-entity

Tests: Spring, JPA, Lombok, and DTO mechanics are not flagged without a concrete cost.

## Must report

None.

## May report

- A Context-dependent or Hypothesis note that `CustomerEntity` doesn't validate `email` at creation, if the agent points to where invalid data could enter.
- A Minor suggestion to use a `record` for `CustomerResponseDto`, only if the build targets Java 16+ and the project doesn't standardize on Lombok DTOs.

## Must not report

- The JPA no-arg constructor or the non-final entity fields.
- `@Data`, `@NoArgsConstructor`, or `@AllArgsConstructor` on the DTO. The `@Data` pitfall with lazy relations and `equals` applies to entities, and this one is on the DTO.
- Mutable DTO fields.
- `@Service`, or a missing interface for `CustomerLookupService` or `CustomerRepository`.
- `Optional` for entity or DTO fields.
