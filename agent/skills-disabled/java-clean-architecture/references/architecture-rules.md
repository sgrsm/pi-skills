# Architecture Rules

This file covers larger structural guidance for Java code audits. It is influenced by clean architecture, package design, and pragmatic refactoring practice.

Examples are simplified. The point is dependency direction and responsibility placement, not a specific framework.

Scope note: this file focuses on packages, modules, layers, and boundaries. Use the sibling `java-clean-code` skill for local code smells and `java-clean-solid` for class and interface design.

## 1. Let the architecture scream the domain

- **Idea:** The top-level package structure should reveal the business capabilities of the system before it reveals frameworks.
- **Labels:** `modularity`, `readability`, `maintenance`

**Bad**
```text
com.example.controller
com.example.service
com.example.repository
com.example.util
```

**Good**
```text
com.example.billing
com.example.orders
com.example.identity
```

## 2. Keep dependencies pointing inward toward policy

- **Idea:** Business rules should not depend on outer details like HTTP, databases, or vendor SDKs.
- **Labels:** `modularity`, `coupling`, `testability`, `maintenance`

**Bad**
```java
package com.example.domain;

import org.springframework.jdbc.core.JdbcTemplate;

class InvoicePolicy {
    JdbcTemplate jdbcTemplate;
}
```

**Good**
```java
package com.example.domain;

class InvoicePolicy {
    Money lateFeeFor(Invoice invoice) { ... }
}
```

## 3. Separate domain, application, adapters, and infrastructure concerns

- **Idea:** Domain code models business rules, application code orchestrates use cases, adapters translate, and infrastructure integrates.
- **Labels:** `modularity`, `cohesion`, `maintenance`, `testability`

**Bad**
```java
class OrderController {
    void checkout(Request req) {
        Order order = mapper.readValue(req.body(), Order.class);
        validate(order);
        jdbcTemplate.update("insert ...");
        kafkaTemplate.send("orders", order);
    }
}
```

**Good**
```java
class OrderController {
    ReceiptResponse checkout(Request req) {
        CheckoutCommand command = requestMapper.toCommand(req);
        Receipt receipt = checkoutUseCase.checkout(command);
        return responseMapper.toResponse(receipt);
    }
}
```

## 4. Keep frameworks at the edge

- **Idea:** Framework annotations and types are fine at boundaries, but core business logic should not require the framework to exist.
- **Labels:** `modularity`, `coupling`, `testability`, `extensibility`

**Bad**
```java
@Entity
class PricingPolicy {
    @Autowired TaxClient taxClient;
}
```

**Good**
```java
class PricingPolicy {
    Money price(Order order, TaxRate taxRate) { ... }
}
```

## 5. Keep controllers and transport handlers thin

- **Idea:** Entry points should parse input, delegate, and map output. They should not hold business rules.
- **Labels:** `modularity`, `testability`, `maintenance`, `cohesion`

**Bad**
```java
@PostMapping("/checkout")
Receipt checkout(@RequestBody CheckoutRequest request) {
    if (request.items().isEmpty()) throw new IllegalArgumentException();
    Money total = request.items().stream().map(Item::price).reduce(ZERO, Money::add);
    ...
}
```

**Good**
```java
@PostMapping("/checkout")
ReceiptResponse checkout(@RequestBody CheckoutRequest request) {
    Receipt receipt = checkoutUseCase.checkout(mapper.toCommand(request));
    return mapper.toResponse(receipt);
}
```

## 6. Put business rules in domain objects or cohesive domain services

- **Idea:** When the domain is non-trivial, avoid pushing all real behavior into application services while domain objects become data bags.
- **Labels:** `modularity`, `cohesion`, `encapsulation`, `maintenance`

**Bad**
```java
class Order {
    private Status status;
    private Money total;
}

class OrderService {
    void markPaid(Order order) {
        if (order.getTotal().isPositive()) {
            order.setStatus(Status.PAID);
        }
    }
}
```

**Good**
```java
class Order {
    void markPaid() {
        if (total.isPositive()) {
            status = Status.PAID;
        }
    }
}
```

## 7. Use repositories and gateways as boundary abstractions

- **Idea:** Core logic should depend on intent-level abstractions, not storage or transport mechanics.
- **Labels:** `modularity`, `coupling`, `testability`, `maintenance`

**Bad**
```java
class CustomerService {
    private final JdbcTemplate jdbcTemplate;
}
```

**Good**
```java
interface CustomerRepository {
    Optional<Customer> findById(CustomerId id);
    Customer save(Customer customer);
}
```

## 8. Do not leak persistence or transport models across layers

- **Idea:** JPA entities, HTTP request DTOs, and message payloads should not become universal domain objects.
- **Labels:** `modularity`, `coupling`, `maintenance`, `correctness`

**Bad**
```java
class PricingService {
    Money price(OrderEntity entity) { ... }
}
```

**Good**
```java
class PricingService {
    Money price(Order order) { ... }
}
```

## 9. Keep mapping at boundaries

- **Idea:** Translate between DTOs, persistence models, and domain models at the edges, not all over the codebase.
- **Labels:** `modularity`, `maintenance`, `readability`, `coupling`

**Bad**
```java
class Order {
    static Order fromRequest(CheckoutRequest request) { ... }
    OrderEntity toEntity() { ... }
}
```

**Good**
```java
class CheckoutRequestMapper {
    CheckoutCommand toCommand(CheckoutRequest request) { ... }
}

class OrderEntityMapper {
    OrderEntity toEntity(Order order) { ... }
}
```

## 10. Avoid cyclic dependencies between packages and modules

- **Idea:** Cycles lock parts of the system together and destroy modularity.
- **Labels:** `modularity`, `coupling`, `maintenance`, `testability`

**Bad**
```text
orders -> billing -> notifications -> orders
```

**Good**
```text
orders -> billing
orders -> notifications
billing -> shared-kernel
```

## 11. Package by cohesive capability, not by generic technical bucket alone

- **Idea:** Group code that changes together.
- **Labels:** `modularity`, `cohesion`, `maintenance`, `readability`

**Bad**
```text
service/
repository/
controller/
mapper/
```

**Good**
```text
orders/
  api/
  application/
  domain/
  infrastructure/
```

## 12. Use explicit dependency injection and a composition root

- **Idea:** Wiring should be visible and replaceable. Construction logic should not be scattered.
- **Labels:** `modularity`, `testability`, `coupling`, `maintenance`

**Bad**
```java
class RefundService {
    private final PaymentClient client = new PaymentClient();
}
```

**Good**
```java
class RefundService {
    private final PaymentGateway paymentGateway;

    RefundService(PaymentGateway paymentGateway) {
        this.paymentGateway = paymentGateway;
    }
}
```

## 13. Keep transaction boundaries in the application layer

- **Idea:** Transactions usually belong around a use case, not buried deep inside low-level helpers or domain objects.
- **Labels:** `modularity`, `correctness`, `maintenance`, `testability`

**Bad**
```java
class Order {
    @Transactional
    void markPaid() { ... }
}
```

**Good**
```java
class CheckoutUseCase {
    @Transactional
    Receipt checkout(CheckoutCommand command) { ... }
}
```

## 14. Make side effects explicit

- **Idea:** Sending mail, publishing messages, writing files, and calling remote systems should be visible orchestration decisions.
- **Labels:** `modularity`, `correctness`, `testability`, `maintenance`

**Bad**
```java
class Order {
    void markPaid() {
        status = PAID;
        kafkaTemplate.send("paid", id);
    }
}
```

**Good**
```java
class Order {
    void markPaid() {
        status = PAID;
    }
}

class CheckoutUseCase {
    void checkout(...) {
        order.markPaid();
        eventPublisher.publish(new OrderPaid(order.id()));
    }
}
```

## 15. Use value objects to model core concepts

- **Idea:** Domain concepts such as money, email, percentage, quantity, and status transitions deserve explicit types.
- **Labels:** `correctness`, `encapsulation`, `readability`, `modularity`

**Bad**
```java
void updatePrice(BigDecimal amount, String currency) { ... }
```

**Good**
```java
void updatePrice(Money price) { ... }
```

## 16. Keep shared libraries small and boring

- **Idea:** Shared modules should contain stable, generic building blocks, not business rules from many domains.
- **Labels:** `modularity`, `coupling`, `maintenance`

**Bad**
```text
shared/
  OrderDiscountUtils.java
  CustomerScoringUtils.java
  BillingWorkflowHelper.java
```

**Good**
```text
shared/
  ClockProvider.java
  Money.java
  JsonSerializer.java
```

## 17. Minimize visibility across module boundaries

- **Idea:** The smaller the exposed surface, the easier it is to preserve invariants and change internals safely.
- **Labels:** `encapsulation`, `modularity`, `maintenance`

**Bad**
```java
public class OrderValidatorHelper { ... }
public class OrderPersistenceFields { ... }
public class OrderInternalState { ... }
```

**Good**
```java
class OrderValidator { ... }
final class OrderState { ... }
```

## 18. Enforce architecture rules with tests or static checks

- **Idea:** If an architectural boundary matters, automate it.
- **Labels:** `modularity`, `maintenance`, `correctness`, `testability`

**Bad**
```java
// boundary exists only in a wiki page
```

**Good**
```java
@AnalyzeClasses(packages = "com.example")
class ArchitectureTest {
    @ArchTest
    static final ArchRule domainDoesNotDependOnSpring =
        noClasses().that().resideInAPackage("..domain..").should()
            .dependOnClassesThat().resideInAnyPackage("org.springframework..");
}
```

## 19. Prefer stable abstractions at the center, volatile details at the edge

- **Idea:** Policies and business rules should change less often than frameworks and integrations.
- **Labels:** `modularity`, `coupling`, `maintenance`, `extensibility`

**Bad**
```java
class SubscriptionRules {
    private final AwsSesClient sesClient;
}
```

**Good**
```java
class SubscriptionRules {
    private final NotificationGateway notifications;
}
```

## 20. Refactor architecture incrementally at seams

- **Idea:** Large structural cleanup is safer when done through thin adapters, strangler seams, and one dependency direction fix at a time.
- **Labels:** `maintenance`, `testability`, `modularity`, `correctness`

**Bad**
```java
// rewrite the whole module tree in one step
```

**Good**
```java
// introduce gateway interface
// route one use case through it
// migrate callers gradually
```
