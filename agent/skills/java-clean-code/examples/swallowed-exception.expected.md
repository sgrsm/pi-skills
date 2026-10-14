# Expected: java-clean-code on swallowed-exception

Tests: a swallowed failure followed by success-path code is Critical, while documented best-effort handling is left alone.

## Must report

- **Critical** · Swallowed exception · `OrderConfirmationService.confirm`, the `payments.capture` try/catch. Evidence: any capture failure, caught as `Exception`, is discarded without logging; the order is then marked paid and saved; nothing in scope implements the "retry later" comment. Acceptable fix: let the failure propagate or translate it before `markPaid`, or record an explicit pending-capture state if retries are intended. Labeled `behavior change` (confirmation now fails or stays pending when capture fails). The broad `catch (Exception)`, the missing log, and the misleading comment belong in this finding.

## May report

- A To verify line on whether a retry job exists elsewhere. Even if it does, marking the order paid before capture succeeds remains the finding.
- Non-atomic side effects, as a separate finding or a To verify line: if `orders.save` fails after a successful capture, the customer is charged but the order isn't recorded as paid.

## Must not report

- The analytics try/catch, which is documented best-effort handling that logs with context.
- A custom exception hierarchy as the first step.
- Separate findings for the broad catch, the missing log, or the misleading comment.
