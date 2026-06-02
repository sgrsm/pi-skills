# Concurrency and State Rules

Detailed Java clean-code rules and examples. Load this file only when the compact checklist is insufficient for the current finding, the user asks for examples, or the audit is broad/exhaustive.

Apply these as heuristics, not slogans. Do not recommend extra abstraction, wrappers, value objects, or extraction unless the observed code shows readability, correctness, testability, or change-safety cost.

## Concurrency and State

### 61. Separate concurrency policy from business logic

- **Why:** Mixing thread management with domain rules multiplies complexity.
- **Labels:** `concurrency`, `maintenance`, `testability`

**Bad**
```java
void settle(Order order) {
    new Thread(() -> paymentGateway.charge(order)).start();
}
```

**Good**
```java
void settle(Order order) {
    settlementExecutor.submit(() -> paymentGateway.charge(order));
}
```

### 62. Minimize shared mutable state

- **Why:** Shared mutation is the root of many concurrency bugs.
- **Labels:** `concurrency`, `correctness`, `maintenance`

**Bad**
```java
class Counter {
    int value;
}
```

**Good**
```java
class Counter {
    private final AtomicInteger value = new AtomicInteger();
}
```

### 63. Prefer immutability where practical

- **Why:** Immutable objects are easier to reason about and safer to share.
- **Labels:** `correctness`, `concurrency`, `readability`, `maintenance`

**Bad**
```java
class Money {
    BigDecimal amount;
    void add(BigDecimal other) { amount = amount.add(other); }
}
```

**Good**
```java
record Money(BigDecimal amount) {
    Money add(Money other) { return new Money(amount.add(other.amount)); }
}
```

### 64. Keep synchronized sections small

- **Why:** Large locked regions reduce throughput and increase deadlock risk.
- **Labels:** `concurrency`, `performance`, `maintenance`

**Bad**
```java
synchronized (lock) {
    validate(order);
    price(order);
    repository.save(order);
}
```

**Good**
```java
price(order);
synchronized (lock) {
    repository.save(order);
}
```

### 65. Document thread-safety and ownership assumptions

- **Why:** Concurrency bugs often come from undocumented expectations.
- **Labels:** `concurrency`, `correctness`, `maintenance`, `diagnostics`

**Bad**
```java
class Cache {
    private final Map<String, String> values = new HashMap<>();
}
```

**Good**
```java
/** Not thread-safe. One instance per request. */
class RequestCache {
    private final Map<String, String> values = new HashMap<>();
}
```

