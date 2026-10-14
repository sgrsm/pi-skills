# Expected: java-clean-audit on billing-module

Tests: a module audit ranks root causes across files, finds the package cycle from imports, gives a refactoring order, and leaves clean code alone. The fixture has no git history and leaves some referenced types (`Customer`, `CustomerRepository`) undefined; the scope line should say that history is unavailable.

## Must report

- **Critical** · External side effect inside a transaction · `InvoiceService.issue`. Evidence: inside `@Transactional`, the Stripe charge runs before `mail.send` and before the commit; if sending mail or the commit fails, the invoice row and its paid mark roll back while the customer stays charged. Acceptable fix: take the charge and the mail out of the database transaction, for example charge with an idempotency key and record the result, then send mail after commit (`@TransactionalEventListener(phase = AFTER_COMMIT)`) or through an outbox. Labeled `behavior change`.
- **Major** · Package cycle · `com.acme.billing` and `com.acme.customer`. Evidence: `InvoiceService` imports `CustomerService`, `CustomerService` imports `InvoiceService`, and `@Lazy` on the constructor parameter works around the bean cycle. Acceptable fix: break one edge, for example `customer` declares a balance or credit-check interface that `billing` implements, or the credit check moves into `billing`. Labeled `refactoring`.
- **Major** · DIP and SRP in `InvoiceService`, as one combined finding or two. Evidence: VAT rules, persistence, static Stripe calls with a global API key set from the environment in the constructor, and mail composition sit in one class; the only VAT test is `@Disabled` because it needs Stripe credentials, so the VAT rule is untested. Acceptable fix: first extract VAT calculation as a pure function with unit tests, then add a domain-owned `PaymentGateway` port with a Stripe adapter, then move mail composition out. Labeled `refactoring`.
- **Moderate or Major** · Repeated Switches · `InvoiceService.issue` and `InvoicePdfRenderer.render`. Evidence: both switch on the country string with a silent `default` (zero VAT, empty note), so a new country needs two edits and stays silently untaxed until both are made. Acceptable fix: one owner for per-country VAT rules (an enum or a table) used by both sites; failing fast for unknown countries is a `behavior change`. May be merged into the `InvoiceService` finding if this evidence is kept.

## May report

- Context-dependent: `StripeException` is checked, so `@Transactional` doesn't roll back on it by default and the unpaid invoice is committed. It also leaks into the controller signature; this can be part of the DIP finding.
- Utility bucket (Minor or Moderate): `BillingUtils` mixes PDF rendering, IBAN masking, and EU country lookup.
- Primitive Obsession (Minor): `long customerId`, `String` country codes, and `BigDecimal` amounts without a currency.
- A Hypothesis about hotspots, stated as unverifiable without history.

## Must not report

- `InvoiceController`, `IssueInvoiceRequest`, or `InvoiceResponse` as problems; the controller is thin and maps to response records.
- `InvoiceRepository` as a fat interface, or JPA mechanics in `Invoice` (the protected no-arg constructor, mutable fields).
- Spring annotations, or constructor injection of concrete classes, as problems on their own.
- Formatting.
- A hexagonal rewrite of the module or a big-bang package restructure as the first step.
- More than 10 findings, a missing Material risks summary, or a missing refactoring order.

## Expected refactoring order

The steps can vary in detail; the order should keep this shape:

1. Fix the transaction boundary for the charge and mail, behind a test that simulates a mail failure.
2. Extract VAT calculation into a pure, unit-tested function shared by both switch sites.
3. Introduce the payment port and Stripe adapter, then re-enable or replace the disabled test.
4. Break the `billing` and `customer` cycle.
5. Optional cleanup: `BillingUtils`, primitives.
