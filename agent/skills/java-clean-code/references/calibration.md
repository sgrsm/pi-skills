# Local Lens Calibration

Borderline cases for `java-clean-code`. Each section shows where the line sits between "report" and "leave it". The code is illustrative; don't copy the fixes mechanically.

## Orchestration or Long Function

Not a finding: one use case at one level of abstraction, with the side effects in plain sight.

```java
Shipment dispatch(DispatchCommand command) {
    Order order = orders.get(command.orderId());
    Label label = carrier.createLabel(order.shippingAddress(), order.parcels());
    Shipment shipment = shipments.save(Shipment.dispatched(order, label));
    events.publish(new OrderDispatched(order.id(), label.trackingNumber()));
    return shipment;
}
```

Finding (Moderate, Long Function): the same method with an inline parcel-weight loop, a carrier-specific string format, and an inline email body. Readers have to skip details to see the steps.

First fix: Extract Function into private methods such as `totalWeight(order)` and `labelRequest(order)`, `refactoring`. Not three new collaborator classes: a class that wraps one call for one caller is a shallow abstraction.

## Command-query separation

Finding (Major when callers treat it as a read):

```java
Customer findCustomer(Email email) {
    return customers.findByEmail(email)
            .orElseGet(() -> customers.save(Customer.newFrom(email)));
}
```

Fix: rename to `findOrCreateCustomer` (`refactoring`), or split into `findCustomer` returning `Optional` and an explicit `createCustomer`. Whether concurrent callers can create duplicates (unique constraint, retry) is a separate, context-dependent correctness note.

Not a finding: `findOrCreateCustomer`, whose name states the effect; a getter that caches a computed value without observable effects.

## Temporal coupling

Finding (Moderate):

```java
exporter.setRange(range);
exporter.setFormat(Format.CSV);
exporter.export(); // NullPointerException if a setter was skipped
```

Fix: take the inputs as arguments (`exporter.export(range, Format.CSV)`), or make each step's output the next step's input (`ReportData data = loader.load(range); renderer.render(data, Format.CSV);`). A fluent `withRange(...).withFormat(...)` builder enforces neither order nor completeness on its own.

## Guard clauses keep semantics

Finding (Moderate): three nested `if`s around one call.

```java
void ship(Order order) {
    if (order != null) {
        if (order.isPaid()) {
            if (!order.isCancelled()) {
                warehouse.ship(order);
            }
        }
    }
}
```

Fix, `refactoring`:

```java
void ship(Order order) {
    if (order == null || !order.isPaid() || order.isCancelled()) {
        return;
    }
    warehouse.ship(order);
}
```

Rejecting `null` with `Objects.requireNonNull` is a separate question. Raise it as `behavior change: null now throws`, and only when callers suggest a `null` order is a bug.

## Error handling

Finding (Moderate, error handling hides the happy path): validation, mapping, and the service call all sit inside one `try { ... } catch (Exception ex) { ... }` that logs and returns `Result.error()`.

Fix, `refactoring`: extract the try body and keep the handler unchanged.

```java
Result handle(Request request) {
    try {
        return process(request);
    } catch (Exception ex) {
        log.error("Request {} failed", request.id(), ex);
        return Result.error();
    }
}
```

Narrowing `catch (Exception)` to what `process` can throw is a separate behavior change.

Finding (Critical, Swallowed exception): the failure disappears and the next line acts as if it succeeded.

```java
try {
    inventory.reserve(order.items());
} catch (Exception e) {
    // ignore
}
order.confirm();
```

Not a finding: best-effort work that logs with context and says why.

```java
try {
    recommendations.recordPurchase(order.id());
} catch (RecommendationException e) {
    // Recommendations are advisory; checkout must not fail because of them.
    log.warn("Could not record purchase {} for recommendations", order.id(), e);
}
```

## Expected outcomes and failures

Finding (Moderate, exceptions as control flow): a declined payment is thrown as `PaymentDeclinedException` and caught by the only caller to choose a branch.

Fix on Java 21+ (`refactoring` for an internal method; `behavior change` when the method is public API):

```java
sealed interface ChargeResult permits Charged, Declined {}
record Charged(PaymentId paymentId) implements ChargeResult {}
record Declined(String reason) implements ChargeResult {}

switch (gateway.charge(request)) {
    case Charged charged -> order.markPaid(charged.paymentId());
    case Declined declined -> order.markPaymentFailed(declined.reason());
}
```

On Java 17, use the same sealed types with `instanceof` patterns. Keep exceptions for failures that nobody nearby can handle, such as timeouts or broken configuration.

## Null and Optional

Findings (Moderate):

```java
List<Invoice> openInvoices(CustomerId id) {
    return invoicesByCustomer.get(id); // null when the customer has none
}

void notifyCustomer(Optional<Email> cc) { ... }          // Optional parameter

String name = customers.findById(id).get().name();       // no presence check
```

Fixes: return `invoicesByCustomer.getOrDefault(id, List.of())`; overload `notifyCustomer` or accept a nullable `Email`; `findById(id).orElseThrow(() -> new CustomerNotFoundException(id))`.

Not a finding: nullable fields on JPA entities and DTOs that mirror optional columns or JSON properties.

## Message chains over data

Not a finding: `order.shippingAddress().city()` where both are records; `builder.name(n).email(e).build()`; stream pipelines.

Finding (Moderate, Message Chains): `order.getCustomer().getAccount().getRiskProfile().isBlocked()` repeated in four services. Fix: ask the owner (`customer.isBlocked()`). Adding `order.isCustomerAccountBlocked()` only trades the chain for a Middle Man.

## Primitives and literals

Not a finding: `String email` on a request DTO validated with Bean Validation at the boundary; `percent / 100`.

Finding (Moderate, Primitive Obsession): `transfer(long fromAccountId, long toAccountId, long amountCents)` called from many places, plus email format checks copied into four services. Fix: `record AccountId(long value)`, a `Money` type, and an `EmailAddress` record that validates in its constructor. Start at the busiest signature.

## Comments

Not a finding: `// The bank API rejects amounts with more than two decimals; round before sending.`

Finding (Moderate): `// returns active users` above a method that returns all users. Check which one is intended, then fix the code or the comment.

## Tests that block or miss a refactoring

Finding (Moderate, tests that block refactoring): a test verifies every collaborator call in order (`verify(repository).findById(id)`, `verify(mapper).toDto(entity)`, `verify(cache).put(...)`) and fails on any internal rearrangement. Fix: assert the returned value or the stored state; use a fake repository.

Finding (Moderate, Nondeterminism): `if (invoice.dueDate().isBefore(LocalDate.now()))` in domain logic, tested with dates relative to today. Fix: inject a `Clock`, or pass `LocalDate today` into the domain method.

Not a finding: camelCase test names or `@DisplayName` when that is the project's convention.

## Shared mutable state

Finding (Critical when requests run concurrently):

```java
@Service
class QuoteService {
    private Quote current; // written by every request

    Quote quote(QuoteRequest request) {
        current = new Quote(request);
        applyDiscounts();
        return current;
    }
}
```

Fix, `refactoring`: pass the `Quote` through parameters and return values.

Not a finding: a mutable builder or accumulator that never leaves the method or thread that created it.
