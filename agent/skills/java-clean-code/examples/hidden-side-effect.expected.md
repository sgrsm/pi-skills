# Expected: java-clean-code on hidden-side-effect

Tests: a query-looking method that mutates state is reported with its caller as evidence, and the fix is labeled as a behavior change.

## Must report

- **Critical or Major** · Hidden side effect / Command-Query Separation · `LoyaltyService.isEligibleForReward`. Evidence: the `is...` method deducts points, records a claim, and saves the member; `RewardBanner.render` calls it to choose a banner text, so viewing the banner spends the member's points. Acceptable fix: Separate Query from Modifier into an eligibility query and an explicit `claimReward` command, with the banner calling only the query. Labeled `behavior change` (rendering stops deducting points), or the split labeled `refactoring` with the banner change labeled `behavior change`.

## May report

- Magic literal: `1_000` appears twice; a named constant keeps the check and the deduction in step.
- Unsafe compound operation (Context-dependent): check-then-deduct without locking or versioning can double-claim under concurrent requests.
- A To verify line on what `members.get` does for an unknown id.

## Must not report

- The injected `Clock`, which is already the testable choice.
- `pointsBalance` as a problem on its own.
- `Optional` for `members.get` stated as a defect, or offered as the fix without first checking what `get` returns.
- The banner's ternary or strings.
