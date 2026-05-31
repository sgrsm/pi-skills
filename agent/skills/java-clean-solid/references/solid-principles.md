# SOLID Principles

These are the classic SOLID principles used as a design lens during a Java audit. Apply them pragmatically. A tiny class or module does not need ceremony just to satisfy a slogan.

Scope note: this file focuses on class and interface design. Use the sibling `java-clean-code` skill for line-level smells and refactoring mechanics.

## S — Single Responsibility Principle (SRP)

- **Canonical definition:** "A class should have one, and only one, reason to change."
- **Straight explanation:** One class should own one coherent responsibility. If business-rule changes, API changes, persistence changes, and reporting changes all force edits to the same class, the class is doing too much.
- **Labels:** `cohesion`, `maintenance`, `testability`

### What to look for

- classes with many unrelated methods
- classes that talk to too many different collaborators
- one class mixing validation, persistence, HTTP mapping, and business rules
- changes that routinely touch the same large class for unrelated reasons

**Bad**
```java
class InvoiceService {
    Invoice create(InvoiceRequest request) { ... }
    String toJson(Invoice invoice) { ... }
    void sendEmail(Invoice invoice) { ... }
    void migrateLegacyInvoices() { ... }
}
```

**Good**
```java
class InvoiceCreator {
    Invoice create(InvoiceRequest request) { ... }
}

class InvoiceJsonMapper {
    String toJson(Invoice invoice) { ... }
}

class InvoiceMailer {
    void sendEmail(Invoice invoice) { ... }
}
```

## O — Open/Closed Principle (OCP)

- **Canonical definition:** "Software entities should be open for extension, but closed for modification."
- **Straight explanation:** Adding a new business variation should usually mean adding a new class or strategy, not editing many existing `if` or `switch` blocks across the codebase.
- **Labels:** `extensibility`, `maintenance`, `coupling`

### What to look for

- repeated type checks or switches for the same concept
- adding one new case requires edits in many classes
- stable business variation handled by copy-paste conditionals

**Bad**
```java
enum DiscountType { REGULAR, VIP }

class DiscountService {
    Money apply(DiscountType type, Order order) {
        if (type == DiscountType.VIP) {
            return order.total().multiply(new BigDecimal("0.20"));
        }
        return order.total().multiply(new BigDecimal("0.05"));
    }
}
```

**Good**
```java
interface DiscountPolicy {
    Money apply(Order order);
}

class VipDiscountPolicy implements DiscountPolicy {
    public Money apply(Order order) { ... }
}

class RegularDiscountPolicy implements DiscountPolicy {
    public Money apply(Order order) { ... }
}
```

## L — Liskov Substitution Principle (LSP)

- **Canonical definition:** "Subtypes must be substitutable for their base types."
- **Straight explanation:** If code expects the base type, every subtype should behave in a way that does not break the caller's assumptions. A subtype should not require stronger preconditions, return weaker guarantees, or throw surprising `UnsupportedOperationException` for core behavior.
- **Labels:** `correctness`, `extensibility`, `maintenance`, `testability`

### What to look for

- subclasses that disable inherited behavior
- overridden methods that change semantics in a surprising way
- inheritance used only for code reuse while the actual contract differs
- callers forced to ask `instanceof` before using a subtype

**Bad**
```java
class Bird {
    void fly() { ... }
}

class Penguin extends Bird {
    @Override
    void fly() {
        throw new UnsupportedOperationException();
    }
}
```

**Good**
```java
interface Bird { }

interface FlyingBird extends Bird {
    void fly();
}

class Sparrow implements FlyingBird {
    public void fly() { ... }
}

class Penguin implements Bird { }
```

## I — Interface Segregation Principle (ISP)

- **Canonical definition:** "Clients should not be forced to depend upon interfaces they do not use."
- **Straight explanation:** Prefer smaller, role-focused interfaces over one huge interface that mixes unrelated operations. Consumers should depend only on the capabilities they actually need.
- **Labels:** `coupling`, `testability`, `maintenance`, `readability`

### What to look for

- fat interfaces with many methods
- mock-heavy tests because one dependency exposes too much
- implementations throwing `UnsupportedOperationException`
- one interface mixing read, write, export, admin, and batch behavior

**Bad**
```java
interface UserOperations {
    User findById(String id);
    void save(User user);
    void delete(String id);
    void exportCsv();
    void reindexSearch();
}
```

**Good**
```java
interface UserReader {
    User findById(String id);
}

interface UserWriter {
    void save(User user);
    void delete(String id);
}
```

## D — Dependency Inversion Principle (DIP)

- **Canonical definition:**
  - "High-level modules should not depend on low-level modules. Both should depend on abstractions."
  - "Abstractions should not depend on details. Details should depend on abstractions."
- **Straight explanation:** Core business logic should depend on interfaces that describe what it needs, not directly on framework classes, HTTP clients, SQL libraries, or vendor SDKs. Infrastructure should plug into the core, not drive it.
- **Labels:** `coupling`, `testability`, `maintenance`, `extensibility`

### What to look for

- use-case classes directly constructing infrastructure objects
- domain code importing Spring, JPA, web, or vendor APIs
- high-level services tightly bound to one concrete implementation
- tests needing full framework startup just to exercise business logic

**Bad**
```java
class CheckoutService {
    private final StripeClient stripeClient = new StripeClient();

    Receipt checkout(Order order) {
        stripeClient.charge(order.total());
        return new Receipt(order.id());
    }
}
```

**Good**
```java
interface PaymentGateway {
    void charge(Money amount);
}

class CheckoutService {
    private final PaymentGateway paymentGateway;

    CheckoutService(PaymentGateway paymentGateway) {
        this.paymentGateway = paymentGateway;
    }

    Receipt checkout(Order order) {
        paymentGateway.charge(order.total());
        return new Receipt(order.id());
    }
}
```

## Using SOLID during an audit

SOLID is most useful when it explains a real cost:

- frequent ripple edits
- hard-to-test code
- scattered conditionals
- brittle inheritance
- framework lock-in
- hidden dependencies

Do **not** use SOLID to justify needless indirection. If a simple class is already clear, stable, and easy to test, more abstraction may make it worse.
