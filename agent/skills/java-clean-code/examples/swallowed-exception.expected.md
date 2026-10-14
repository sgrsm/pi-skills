# Expected: java-clean-code on swallowed-exception

Tests: a swallowed failure followed by success-path code is Critical, while documented best-effort handling is left alone.

## Must report

- **Critical** · Swallowed exception · `OrderConfirmationService.confirm`, the `payments.capture` try/catch. Evidence: any capture failure, caught as `Exception`, is discarded without logging; the order is then marked paid and saved; nothing in scope implements the "retry later" comment. Acceptable fix: let the failure propagate or translate it before `markPaid`, or record an explicit pending-capture state if retries are intended. Labeled `behavior change` (confirmation now fails or stays pending when capture fails). The broad `catch (Exception)` belongs in this finding, not in a separate one.

## May report

- A Hypothesis to verify whether a retry job exists elsewhere. Even if it does, marking the order paid before capture succeeds remains the finding.

## Must not report

- The analytics try/catch, which is documented best-effort handling that logs with context.
- A custom exception hierarchy as the first step.
- More than one finding for the capture block.
