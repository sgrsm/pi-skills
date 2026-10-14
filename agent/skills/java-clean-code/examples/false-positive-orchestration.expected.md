# Expected: java-clean-code on false-positive-orchestration

Tests: a clear orchestration method is not flagged for calling several collaborators.

## Must report

None. `SubscriptionRenewalService.renew` orchestrates one use case at one level of abstraction: validate, quote, renew, publish, notify, return a receipt.

## May report

- A one-line note that no tests were visible to confirm the flow is covered.

## Must not report

- Long Function, Divergent Change, or SRP for `renew` because it calls five collaborators.
- Long Parameter List for the constructor; constructor injection of collaborators is not a parameter-list smell.
- New interfaces, wrappers, or a separate class for event publishing and mail without evidence that they vary independently.
- A findings section padded with Minor items, or praise for the code.
