# Expected: java-clean-code on god-class-root-cause

Tests: many local smells caused by one design problem are reported as one root-cause finding, with the local smells as evidence. The same expectations hold for `java-clean-solid`.

## Must report

- **Major** · Divergent Change / Large Class (SRP) · `CustomerManager`. Evidence: registration, SQL persistence, JSON export, VAT rates, and newsletter sending live in one class, and each method group uses a different subset of the collaborators. The vague class name `CustomerManager`, inline mail building, and literal VAT rates appear as supporting evidence, not as separate findings. Acceptable fix: characterization tests, then Extract Class one responsibility at a time, starting with whichever is under change (for example VAT rates into their own type, then export), labeled `refactoring`.

## May report

- Silent fallback, as a separate finding: `vatRate` returns zero for any unknown country, which silently under-taxes. A fix that throws for unknown countries is a `behavior change`.
- One Mysterious Name finding for the parameters `n`, `e`, `c` and the swappable `String` parameters, fixed by Rename (`refactoring`).
- Non-atomic side effects, as a finding or a To verify line: `register` inserts the row before `mail.send`, so a mail failure reports a failed registration for a customer that now exists; `sendNewsletter` stops at the first failed send and skips the metric.
- A note that the welcome mail and newsletter build messages the same way.
- A To verify line on whether newsletter consent is tracked, since `sendNewsletter` mails every customer.
- A note that `java-clean-solid` can go deeper on the design.

## Must not report

- Five or more separate local findings (names, magic literals, the switch, email validation, duplicated mail building) instead of one root cause.
- Repeated Switches or OCP for the single `vatRate` switch.
- An interface for every collaborator, or a full rewrite as the first step.
- `@Service` or the injected Spring types as problems on their own.
