# Tests and Refactoring Rules

Detailed Java clean-code rules and examples. Load this file only when the compact checklist is insufficient for the current finding, the user asks for examples, or the audit is broad/exhaustive.

Apply these as heuristics, not slogans. Do not recommend extra abstraction, wrappers, value objects, or extraction unless the observed code shows readability, correctness, testability, or change-safety cost.

## Tests and Refactoring Practice

### 49. Keep tests fast, independent, repeatable, self-validating, and timely

- **Why:** Slow or flaky tests stop people from refactoring.
- **Labels:** `testability`, `maintenance`, `correctness`

**Bad**
```java
@Test
void createsInvoice() throws Exception {
    Thread.sleep(5000);
    assertTrue(service.createInvoice());
}
```

**Good**
```java
@Test
void createsInvoice() {
    assertThat(service.createInvoice(command)).isTrue();
}
```

### 50. Make tests readable enough to explain behavior

- **Why:** Tests are executable documentation.
- **Labels:** `readability`, `testability`, `maintenance`

**Bad**
```java
@Test
void t1() { ... }
```

**Good**
```java
@Test
void rejects_checkout_when_cart_is_empty() { ... }
```

### 51. Test one concept per test

- **Why:** A focused test fails for one reason and tells a clearer story.
- **Labels:** `testability`, `readability`, `maintenance`

**Bad**
```java
@Test
void user_flow() {
    assertThat(user.register()).isTrue();
    assertThat(user.login()).isTrue();
    assertThat(user.resetPassword()).isTrue();
}
```

**Good**
```java
@Test
void registers_a_new_user() { ... }

@Test
void logs_in_with_valid_credentials() { ... }
```

### 52. Test behavior, not implementation details

- **Why:** Tests that know private structure become brittle.
- **Labels:** `testability`, `maintenance`, `encapsulation`

**Bad**
```java
assertThat(service.internalCache.size()).isEqualTo(1);
```

**Good**
```java
assertThat(service.getById(id)).contains(expectedCustomer);
```

### 53. Add characterization tests before changing legacy code

- **Why:** When behavior is unclear, first record what the system currently does.
- **Labels:** `testability`, `correctness`, `maintenance`

**Bad**
```java
// rewrite legacy parser first, add tests later
```

**Good**
```java
@Test
void preserves_current_whitespace_trimming_behavior() { ... }
```

### 54. Refactor in small, safe steps

- **Why:** Tiny changes are easier to reason about and rollback.
- **Labels:** `maintenance`, `correctness`, `testability`

**Bad**
```java
// rewrite service, repository, DTOs, and tests in one giant commit
```

**Good**
```java
// 1. add tests
// 2. rename methods
// 3. extract class
// 4. move dependency behind interface
```

### 55. Introduce parameter objects for repeated meaningful clusters

- **Why:** A repeated cluster of parameters often hides a concept and is easy to pass incorrectly.
- **Labels:** `readability`, `maintenance`, `testability`, `cohesion`

This is the usual refactoring for rule 12. Do not introduce a parameter object for a one-off call unless it names a real concept or prevents misuse.

**Bad**
```java
book(name, email, phone, street, city, zipCode, date);
```

**Good**
```java
book(new BookingRequest(customerContact, address, date));
```

### 56. Replace repeated conditionals with explicit variation points

- **Why:** Repeated `if` or `switch` logic spreads change across the codebase.
- **Labels:** `maintenance`, `extensibility`, `coupling`

**Bad**
```java
if (type == PREMIUM) {
    return premiumPrice(order);
}
return regularPrice(order);
```

**Good**
```java
return pricingPolicy.forType(type).price(order);
```

### 57. Fix divergent change and shotgun surgery by moving related behavior together

- **Why:** If one business change touches many files, responsibilities are probably scattered.
- **Labels:** `maintenance`, `cohesion`

**Bad**
```java
// adding a new discount rule changes controller, mapper, repository, and formatter
```

**Good**
```java
class DiscountPolicy {
    Money apply(Order order) { ... }
}
```

### 58. Delete speculative generality and lazy abstractions

- **Why:** Unused layers and future-proofing abstractions create cost without value.
- **Labels:** `simplicity`, `maintenance`, `readability`

**Bad**
```java
interface FutureOrderQuantumAdapter {
    void execute(Order order);
}
```

**Good**
```java
class OrderProcessor {
    void process(Order order) { ... }
}
```

### 59. Replace magic numbers and strings with named concepts

- **Why:** Literals hide meaning and invite inconsistency.
- **Labels:** `readability`, `correctness`, `maintenance`

**Bad**
```java
if (retries > 3) { ... }
```

**Good**
```java
if (retries > MAX_RETRY_COUNT) { ... }
```

### 60. Separate phases such as parsing, validation, computation, and persistence

- **Why:** Mixing phases makes code hard to test and change independently.
- **Labels:** `cohesion`, `testability`, `maintenance`

**Bad**
```java
Receipt submit(String json) {
    Order order = mapper.readValue(json, Order.class);
    validate(order);
    repository.save(order);
    return receiptFactory.create(order);
}
```

**Good**
```java
Order order = requestParser.parse(json);
validator.validate(order);
Order saved = repository.save(order);
return receiptFactory.create(saved);
```

