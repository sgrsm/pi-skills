# Expected clean-code review

## Findings

- **Severity:** Moderate
  **Rule or smell:** Mixed abstraction levels / phase mixing
  **Location:** `CheckoutService.checkout`
  **Evidence:** The method validates input, calculates totals and tax, mutates order state, persists, formats email text, sends mail, and publishes an event in one flow.
  **Impact:** Pricing, persistence, notification, and event changes all compete inside one method, making behavior harder to test and refactor safely.
  **Smallest safe refactor:** Extract pricing into a `CheckoutPricing` or `OrderPricer`, then extract receipt notification/event publishing only if tests show those phases are independently changing.
  **Labels:** `readability`, `testability`, `maintenance`

## Refactoring order

1. Add behavior tests for subtotal/tax and checkout side effects.
2. Extract price calculation behind a small method or collaborator.
3. Keep orchestration visible; do not hide persistence, mail, and event side effects behind a vague `afterCheckout` helper.
