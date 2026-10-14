# Expected: java-clean-solid on valid-application-service

Tests: a cohesive application service is not flagged for SRP because it has several collaborators.

## Must report

None. `CheckoutService` orchestrates one use case, checkout, through role-named collaborators.

## May report

- A Context-dependent correctness note: if `receipts.create` or `events.checkedOut` fails after `paymentGateway.charge`, the customer is charged without a receipt, unless transaction, idempotency, or compensation handling exists outside the fixture.
- A Hypothesis to verify whether `PaymentGateway` is a domain-owned port or a vendor type.

## Must not report

- SRP, Divergent Change, or God Class because of the five collaborators.
- New strategy layers or interfaces without evidence of change pressure.
- Long Parameter List for the constructor.
