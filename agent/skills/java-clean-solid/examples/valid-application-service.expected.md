# Expected: java-clean-solid on valid-application-service

Tests: a cohesive application service is not flagged for SRP because it has several collaborators.

## Must report

None. `CheckoutService` orchestrates one use case, checkout, through role-named collaborators.

## May report

- Non-atomic side effects (Context-dependent), as a finding or a To verify line: if `receipts.create` or `events.checkedOut` fails after `paymentGateway.charge`, the customer is charged without a receipt, unless a transactional caller or an idempotent gateway guards it.
- A To verify line on whether `PaymentGateway` is a domain-owned port or a vendor type.
- A To verify line on whether `checkoutPolicy.validate` rejects a cart that was already checked out, since `checkout` never changes the cart's state.
- A short paragraph on the look-alike that was checked (five collaborators).

## Must not report

- SRP, Divergent Change, or God Class because of the five collaborators.
- New strategy layers or interfaces without evidence of change pressure.
- Long Parameter List for the constructor.
- A Critical rating for the charge-before-receipt concern; a guard could exist in code outside the fixture.
- A principle-by-principle walk-through explaining why each SOLID principle holds.
