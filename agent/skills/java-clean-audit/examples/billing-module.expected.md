# Expected: java-clean-audit on billing-module

Tests: a module audit ranks root causes across files, finds the package cycle from imports, gives a refactoring order, and leaves clean code alone. The fixture has no git history; the scope line should say so.

## Must report

- **Critical** · Non-atomic side effects (remote call inside a transaction) · `InvoiceService.issue`. Evidence: inside `@Transactional`, the Stripe charge runs before `mail.send` and before the commit; if sending mail or the commit fails, the invoice row and its paid mark roll back while the customer stays charged. Acceptable fix: take the charge and the mail out of the database transaction, for example charge with an idempotency key and record the result, then send mail after commit (`@TransactionalEventListener(phase = AFTER_COMMIT)`) or through an outbox. Labeled `behavior change`.
- **Major** · Package cycle · `com.acme.billing` and `com.acme.customer`. Evidence: `InvoiceService` imports `CustomerService`, `CustomerService` imports `InvoiceService`, and `@Lazy` on the constructor parameter works around the bean cycle. Acceptable fix: break one edge, for example `customer` declares a balance or credit-check interface that `billing` implements, or the credit check moves into `billing`. Labeled `refactoring`.
- **Major** · DIP and mixed responsibilities in `InvoiceService`. Evidence: VAT rules, persistence, static Stripe calls with a global API key set from the environment in the constructor, and mail composition sit in one class; the only VAT test is `@Disabled` because it needs Stripe credentials, so the VAT rule is untested. Acceptable fix: extract VAT calculation as a pure function with unit tests, add a domain-owned `PaymentGateway` port with a Stripe adapter, and move mail composition out. Labeled `refactoring`. Naming SRP is optional when the mixed responsibilities are covered by this finding and the Repeated Switches one.
- **Moderate or Major** · Repeated Switches · `InvoiceService.issue` and `InvoicePdfRenderer.render`. Evidence: both switch on the country string with a silent `default` (zero VAT, empty note), so a new country needs two edits and stays silently untaxed until both are made. Acceptable fix: one owner for per-country VAT rules (an enum or a table) used by both sites; failing fast for unknown countries is a `behavior change`. May be merged into the `InvoiceService` finding if this evidence is kept.

## May report

- `StripeException` is checked, so `@Transactional` doesn't roll back on it by default and the unpaid invoice is committed. It also leaks into the controller signature; this can be part of the DIP finding.
- Utility bucket: `BillingUtils` mixes PDF rendering, IBAN masking, and EU country lookup.
- Mysterious Name: `BillingUtils.toPdf` returns the text's bytes, not a PDF.
- Primitive Obsession: `long customerId`, `String` country codes, and `BigDecimal` amounts without a currency.
- `Customer.stripeCustomerId` puts a vendor identifier on the customer model, within the DIP finding.
- Silent fallback for the zero-VAT `default`, within the Repeated Switches finding or separately.
- Missing safety net as its own finding: the only VAT test is disabled, with characterization tests (a fake gateway or `mockStatic(Charge.class)`) as the first step.
- A To verify line: IT, ES, and NL are listed in `EU_COUNTRIES` but get 0% VAT.

## Must not report

- `InvoiceController`, `IssueInvoiceRequest`, or `InvoiceResponse` as problems; the controller is thin and maps to response records.
- `InvoiceRepository` or `CustomerRepository` as fat interfaces, or JPA mechanics in `Invoice` and `Customer` (protected no-arg constructors, mutable fields).
- Spring annotations, or constructor injection of concrete classes, as problems on their own.
- The Critical finding called a swallowed exception; nothing is swallowed.
- Formatting.
- A hexagonal rewrite of the module or a big-bang package restructure as the first step.
- More than 10 findings, a missing Material risks summary, or a missing refactoring order.

## Expected refactoring order

The steps can vary in detail; the order should keep this shape:

1. The safety net and only the seams the transaction fix needs: typically a payment port (or a static mock of `Charge.create`) and a mail fake, with tests that pin today's behavior for a mail failure.
2. The transaction-boundary fix as its own `behavior change` commit, before the cycle break and the cleanup.
3. VAT calculation extracted into a pure, unit-tested function shared by both switch sites; this may come before step 2 when it is part of the safety net.
4. The `billing` and `customer` cycle broken.
5. Optional cleanup: `BillingUtils`, primitives.
