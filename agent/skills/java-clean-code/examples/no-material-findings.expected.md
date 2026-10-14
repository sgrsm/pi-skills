# Expected: java-clean-code on no-material-findings

Tests: clean code gets a short "no material findings" answer instead of invented low-value comments.

## Must report

None. The method is short, names are clear, required arguments are checked, the rates are named constants, and the single conditional is readable.

## May report

- A short paragraph on the look-alikes that were checked (the VIP and standard branch, the repeated return expression).
- A To verify line on how `Money` rounds a percentage discount.

## Must not report

- Repeated Switches, OCP, or a strategy for the VIP and standard branch; one two-way branch is not repeated variation.
- Value objects for the discount rates.
- `Optional` or other changes to the `Objects.requireNonNull` checks.
- Magic literal for the rates; they are already named.
- `Money` rounding as a numbered finding; the code that rounds isn't in scope.
- A findings section padded with Minor items, praise, or a list of what the code does well (small, `final`, stateless, null-checked).
