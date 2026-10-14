# Expected: java-clean-code on no-material-findings

Tests: clean code gets a short "no material findings" answer instead of invented low-value comments.

## Must report

None. The method is short, names are clear, required arguments are checked, the rates are named constants, and the single conditional is readable.

## May report

None.

## Must not report

- Repeated Switches, OCP, or a strategy for the VIP and standard branch; one two-way branch is not repeated variation.
- Value objects for the discount rates.
- `Optional` or other changes to the `Objects.requireNonNull` checks.
- Magic literal for the rates; they are already named.
- A findings section padded with Minor items, or praise for the code.
