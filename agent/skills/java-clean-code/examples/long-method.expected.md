# Expected: java-clean-code on long-method

Tests: phase mixing is reported once, with Extract Function as the first step and the orchestration kept visible.

## Must report

- **Moderate** · Long Function / mixed abstraction levels · `CheckoutService.checkout`. Evidence: validation, the subtotal loop, tax, the state change, persistence, mail text, and event publishing sit at different levels of abstraction in one method. Acceptable first fix: Extract Function for pricing (subtotal and tax), optionally also for validation, labeled `refactoring`; `save`, mail, and event calls stay visible in `checkout`.

## May report

- Hidden clock: `Instant.now()` makes the checkout timestamp hard to test; inject a `Clock`.
- Magic literal: tax rate `0.20` as a named constant or a tax policy.
- Tax rounding (Context-dependent): `BigDecimal` tax without scale or rounding, depending on the currency rules.
- Non-atomic side effects, as a To verify line: a mail or publish failure after `repository.save` leaves a checked-out order without its `OrderCheckedOut` event.

## Must not report

- New collaborator classes (validator, pricer, mailer wrapper) as the first step.
- Hiding persistence, mail, and event publishing behind a vague helper such as `afterCheckout`.
- Replacing the `IllegalArgumentException` null check with `Objects.requireNonNull` labeled as a `refactoring`. It changes the exception type, so it may appear only as a `behavior change`.
- The save-then-notify ordering rated Critical, or called a swallowed exception; nothing is swallowed and nothing in scope shows what consumes the event.
- More than 5 findings.
