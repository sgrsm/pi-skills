# Expected: java-clean-solid on sealed-exhaustive-switch

Tests: exhaustive switches over a sealed hierarchy on Java 21 are recognized as idiomatic, not as an OCP violation.

## Must report

None. `PaymentMethod` is a closed set; both switches are exhaustive with no `default`, so adding a variant fails compilation at every site.

## May report

- A short paragraph on the look-alike that was checked (two switches on the same type).
- A note that unused pattern variables could use unnamed patterns (`_`) after moving to Java 22+.
- `Wallet`'s generated `toString()` includes `token`, as a finding or a To verify line about logging.
- A To verify line that `BANK_TRANSFER_FEE` is fixed in EUR while the other fees follow the amount's currency.

## Must not report

- Repeated Switches, OCP, or Replace Conditional with Polymorphism for the two switches.
- A visitor, or fee and description methods moved onto the records as a requirement.
- Value objects for `last4` or `token` without evidence of validation spread or mix-ups.
- Praise, or more than a short paragraph justifying the switches.
