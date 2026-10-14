# Design Lens Calibration

Borderline cases for `java-clean-solid`. The principles are paraphrased; judge each one by the cost you can show in the code or its history. The code is illustrative; don't copy the fixes mechanically.

## The principles, stated precisely

- **SRP:** a module answers to one actor, meaning the people or systems whose requests change it. Keep together code that changes for the same reason; separate code that changes for different reasons. "Does one thing" is a rule for functions, not SRP.
- **OCP:** adding a variant of a recurring, stable concept shouldn't mean editing every place that handles the concept. It applies to repeated variation, not to every conditional.
- **LSP:** a subtype keeps the base type's contract: no stronger preconditions, no weaker guarantees, invariants kept, no exceptions the contract doesn't allow. Judge against the documented contract and how callers use the type.
- **ISP:** shape interfaces around what each client calls.
- **DIP:** policy and details both depend on an abstraction that the policy side owns, declared in its package and in its vocabulary. An interface next to its only implementation in an infrastructure package inverts nothing.

## SRP: actors, not method counts

Finding (Major, Divergent Change):

```java
class Employee {
    Money calculatePay() { ... }            // finance rules
    Duration reportHours() { ... }          // operations reporting
    void save() { ... }                     // database schema
    private Duration regularHours() { ... } // shared by both calculations
}
```

Finance asks for an overtime change in `regularHours()`, and the operations report changes with it. Commits such as "change overtime rule" and "add report column" touching the same file strengthen the evidence. Fix: Extract Class per actor (`PayCalculator`, `HourReporter`, `EmployeeRepository`), each with its own hours rule if the two rules can diverge.

Not a finding: an application service whose methods all serve one use case, even with five collaborators.

## OCP: repeated switches, and when a switch is fine

Finding (Major, Repeated Switches): `switch (shipment.carrier())` appears in label generation, tracking-URL building, and cost estimation, each with a `default` branch. A new carrier compiles fine and silently gets the default label, URL, and cost.

Fixes, smallest first:

- Drop the `default` branches and use exhaustive `switch` expressions, so the compiler reports every site when a carrier is added (Java 14+ for enums).
- Move the varying data and behavior onto the `Carrier` enum, as fields or constant-specific methods.
- A strategy per carrier only when carriers are added often or come from other modules.

Not a finding: one switch in one place; exhaustive switches over an enum or sealed hierarchy in Java 17+ code. For a closed set of types with many operations, exhaustive switches are the idiomatic design. Polymorphism suits an open set of types with few operations.

## LSP: the contract, not "different behavior"

Finding (Major, Refused Bequest): the subtype adds a precondition the base type doesn't have.

```java
class DiscountPolicy {
    /** Returns the discount for any positive order total. */
    Money discountFor(Money total) { ... }
}

class BulkDiscountPolicy extends DiscountPolicy {
    @Override
    Money discountFor(Money total) {
        if (total.isLessThan(Money.eur(100))) {
            throw new IllegalArgumentException("bulk discount needs at least 100 EUR");
        }
        ...
    }
}
```

Callers that hold a `DiscountPolicy` now fail on small orders. Fix: return no discount below the threshold, which keeps the contract, or give bulk pricing its own type instead of extending.

Not a finding: `List.of(...).add(...)` throwing `UnsupportedOperationException`. `java.util.Collection` documents its mutators as optional operations. Flag an unmodifiable collection only where a documented contract promises mutability.

## ISP: framework interfaces

Not a finding: a Spring Data `JpaRepository` with dozens of inherited methods. That's a framework convention, and fakes or test slices handle testing.

Finding (Moderate or Major, Fat interface): a hand-written interface where each client uses a different small subset and tests stub methods the client never calls. Fix: a role interface per client; the implementation keeps implementing all of them.

## DIP: who owns the interface

Finding (Major, Abstraction owned by the wrong side):

```java
// com/acme/billing/infra/stripe/StripePayments.java
package com.acme.billing.infra.stripe;

public interface StripePayments {
    Charge createCharge(ChargeCreateParams params); // Stripe SDK types
}

// com/acme/billing/domain/RenewalService.java
package com.acme.billing.domain;

import com.acme.billing.infra.stripe.StripePayments;
```

The domain still imports infrastructure and, through it, Stripe types. Fix: declare `PaymentGateway` in `com.acme.billing.domain` with domain types (`PaymentId charge(CustomerRef customer, Money amount)`), and let the Stripe adapter implement it and map the types.

Not a finding: a Spring service that injects a concrete `PriceFormatter` from the same module. It is in-process, stable, and easy to construct in a test.

## Inheritance used for reuse

Finding (Moderate, Fragile inheritance): `AbstractImporter` has protected mutable fields and a template method that breaks unless subclasses call `super.beforeRow()`. Fix: composition, such as passing a `RowParser` into a `final` importer. If the hierarchy stays, make the hooks abstract and document self-use.

## Indirection that should go

Finding (Minor, Speculative Generality): `OrderService` with a single `OrderServiceImpl`, no other implementation, no test double, and no module boundary. Spring proxies classes without interfaces, so `@Transactional` doesn't need the interface either. Fix: inline the interface.

Finding (Moderate, Middle Man): `OrderController` calls `OrderFacade`, which calls `OrderService`, which calls `OrderManager`, and the facade and manager only forward. Fix: Remove Middle Man, one layer at a time.

Not a finding: an interface that is published API, a module port, required by a framework (Feign, `@HttpExchange`, Spring Data), or implemented by a test fake.

## Anemic model or transaction script

Not a finding: a CRUD service with getter-and-setter entities and simple rules in the services.

Finding (Moderate, Data Class): the rule "a paid invoice can't change its lines" is checked in three services and missed in a fourth. Fix: move it into `Invoice` (`replaceLines(...)` throws when the invoice is paid) and make the setter private.

## Package scope

Finding (Major, Package cycle): `billing` imports `customer.CustomerService` for addresses, and `customer` imports `billing.InvoiceService` for credit checks; a `@Lazy` constructor parameter hides the bean cycle. Fix: break one edge. For example, `customer` declares a `CreditCheck` interface that `billing` implements, or the credit check moves into `billing`.

Context-dependent (Leaking persistence model): REST controllers return JPA entities. Report it when lazy loading fails during serialization or when schema changes break the API. In a small internal CRUD service with neither problem, leave it.
