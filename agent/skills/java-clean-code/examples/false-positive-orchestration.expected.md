# Expected: java-clean-code on false-positive-orchestration

Tests: a clear orchestration method is not flagged for calling several collaborators, and the no-findings answer stays short.

## Must report

None. `SubscriptionRenewalService.renew` orchestrates one use case at one level of abstraction: validate, quote, renew, publish, notify, return a receipt.

## May report

- A short paragraph on the look-alike that was checked (several collaborator calls).
- A To verify line: a failure in `events.renewed` or `mailer.sendRenewalReceipt` after `repository.renew` leaves a renewed subscription without its event or receipt.
- A scope line noting that no tests were visible.

## Must not report

- Long Function, Divergent Change, or SRP for `renew` because it calls five collaborators.
- Long Parameter List for the constructor; constructor injection of collaborators is not a parameter-list smell.
- New interfaces, wrappers, or a separate class for event publishing and mail without evidence that they vary independently.
- A numbered finding for the event or mail after `repository.renew`; nothing in scope shows that anything depends on them.
- Praise, or a list of what the code does well or which rules it follows.
