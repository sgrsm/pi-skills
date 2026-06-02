# Classes, Objects, Error Handling, and Boundary Rules

Detailed Java clean-code rules and examples. Load this file only when the compact checklist is insufficient for the current finding, the user asks for examples, or the audit is broad/exhaustive.

Apply these as heuristics, not slogans. Do not recommend extra abstraction, wrappers, value objects, or extraction unless the observed code shows readability, correctness, testability, or change-safety cost.

## Classes and Objects

### 27. Keep classes small and focused

- **Why:** A class should have a tight purpose and few reasons to change.
- **Labels:** `cohesion`, `maintenance`, `testability`

**Bad**
```java
class UserService {
    User register(...)
    User login(...)
    void exportCsv(...)
    void sendMarketingEmail(...)
    void migrateLegacyUsers(...)
}
```

**Good**
```java
class RegistrationService { ... }
class AuthenticationService { ... }
class UserExportService { ... }
```

### 28. Prefer high cohesion

- **Why:** Methods and fields in the same class should naturally belong together.
- **Labels:** `cohesion`, `maintenance`, `testability`

**Bad**
```java
class ReportService {
    TaxPolicy taxPolicy;
    PasswordEncoder passwordEncoder;
    SmsClient smsClient;
}
```

**Good**
```java
class ReportService {
    TaxPolicy taxPolicy;
    ReportFormatter formatter;
    ReportRepository repository;
}
```

### 29. Put behavior near the data it belongs to

- **Why:** Moving logic to the owning type reduces feature envy and message chains.
- **Labels:** `cohesion`, `encapsulation`, `maintenance`

**Bad**
```java
if (order.getStatus() == PAID && order.getTotal().compareTo(limit) > 0) {
    ...
}
```

**Good**
```java
if (order.isLargePaidOrder(limit)) {
    ...
}
```

### 30. Hide internal state

- **Why:** Exposing mutable internals makes invariants impossible to protect.
- **Labels:** `encapsulation`, `correctness`, `maintenance`

**Bad**
```java
class Cart {
    public List<Item> items = new ArrayList<>();
}
```

**Good**
```java
class Cart {
    private final List<Item> items = new ArrayList<>();

    void add(Item item) { items.add(item); }
    List<Item> items() { return List.copyOf(items); }
}
```

### 31. Prefer composition over inheritance when reuse is the only goal

- **Why:** Inheritance creates tight coupling and fragile hierarchies.
- **Labels:** `coupling`, `extensibility`, `maintenance`

**Bad**
```java
class CachedOrderService extends OrderService {
    ...
}
```

**Good**
```java
class CachedOrderService {
    private final OrderService delegate;
    ...
}
```

### 32. Break up god classes

- **Why:** A class that knows everything and does everything blocks safe change.
- **Labels:** `maintenance`, `testability`, `coupling`

**Bad**
```java
class ApplicationService {
    // validation, mapping, SQL, email, retries, metrics, JSON
}
```

**Good**
```java
class CheckoutService { ... }
class PaymentGateway { ... }
class ReceiptMailer { ... }
```

### 33. Replace primitive obsession with value objects

- **Why:** Rich domain types carry validation and meaning.
- **Labels:** `correctness`, `readability`, `encapsulation`, `maintenance`

**Bad**
```java
void changeEmail(String email) { ... }
```

**Good**
```java
void changeEmail(EmailAddress email) { ... }
```

### 34. Replace data clumps with a dedicated type

- **Why:** Repeated groups of values usually represent one concept.
- **Labels:** `readability`, `maintenance`, `cohesion`

**Bad**
```java
ship(name, street, city, zipCode, country);
```

**Good**
```java
ship(address);
```

### 35. Avoid message chains and train wrecks

- **Why:** Chained navigation leaks structure and increases coupling.
- **Labels:** `coupling`, `encapsulation`, `maintenance`

**Bad**
```java
String city = order.getCustomer().getAddress().getCity();
```

**Good**
```java
String city = order.customerCity();
```

### 36. Remove feature envy by moving behavior

- **Why:** If a method mostly uses another object's data, it may belong closer to that data.
- **Labels:** `cohesion`, `coupling`, `maintenance`

Move behavior to the owning type only when it is domain behavior. Keep presentation formatting, serialization, persistence mapping, and infrastructure concerns at boundaries.

**Bad**
```java
class InvoiceService {
    boolean isOverdue(Invoice invoice, LocalDate today) {
        return !invoice.isPaid() && invoice.dueDate().isBefore(today);
    }
}
```

**Good**
```java
class Invoice {
    boolean isOverdue(LocalDate today) {
        return !paid && dueDate.isBefore(today);
    }
}
```

### 37. Avoid global state and service locators

- **Why:** Hidden dependencies make behavior harder to reason about and test.
- **Labels:** `testability`, `coupling`, `maintenance`

**Bad**
```java
EmailClient client = ServiceRegistry.emailClient();
```

**Good**
```java
class ReceiptService {
    private final EmailClient client;

    ReceiptService(EmailClient client) {
        this.client = client;
    }
}
```

### 38. Avoid utility dumping grounds

- **Why:** `Utils` classes often become unowned piles of unrelated logic.
- **Labels:** `cohesion`, `maintenance`

**Bad**
```java
class AppUtils {
    static String formatMoney(...)
    static boolean isAdmin(...)
    static void sendMetric(...)
}
```

**Good**
```java
class MoneyFormatter { ... }
class AuthorizationPolicy { ... }
class MetricsPublisher { ... }
```

### 39. Keep the public API small and intention-revealing

- **Why:** Fewer exposed methods mean fewer ways to misuse a type.
- **Labels:** `encapsulation`, `maintenance`

**Bad**
```java
public class Order {
    public void setStatus(...)
    public void setTotal(...)
    public void setPaidAt(...)
}
```

**Good**
```java
public class Order {
    public void markPaid(Money amount, Instant paidAt) { ... }
}
```

## Error Handling and Boundaries

### 40. Use exceptions for exceptional cases

- **Why:** Error codes make the happy path noisy and easy to ignore.
- **Labels:** `readability`, `correctness`, `maintenance`

**Bad**
```java
int status = paymentGateway.charge(request);
if (status != 0) {
    ...
}
```

**Good**
```java
paymentGateway.charge(request);
```

### 41. Throw specific exceptions with useful context

- **Why:** Specific failures are easier to diagnose and handle.
- **Labels:** `diagnostics`, `correctness`, `maintenance`

**Bad**
```java
throw new RuntimeException("failed");
```

**Good**
```java
throw new PaymentDeclinedException(orderId, paymentProviderCode);
```

### 42. Do not swallow exceptions

- **Why:** Silent failure destroys diagnosability and trust.
- **Labels:** `diagnostics`, `correctness`, `robustness`

**Bad**
```java
try {
    mailer.send(receipt);
} catch (Exception ignored) {
}
```

**Good**
```java
try {
    mailer.send(receipt);
} catch (MessagingException ex) {
    throw new ReceiptDeliveryException(orderId, ex);
}
```

### 43. Avoid returning null when a clearer alternative exists

- **Why:** Null creates defensive clutter and hidden contracts.
- **Labels:** `correctness`, `readability`, `maintenance`, `testability`

**Bad**
```java
User findUser(String email) { return null; }
```

**Good**
```java
Optional<User> findUser(String email) { return Optional.empty(); }
```

### 44. Avoid accepting null unless the contract explicitly requires it

- **Why:** Null-tolerant APIs spread ambiguity.
- **Labels:** `correctness`, `maintenance`, `testability`

**Bad**
```java
void updateAddress(Address address) {
    if (address == null) return;
    ...
}
```

**Good**
```java
void updateAddress(Address address) {
    this.address = Objects.requireNonNull(address);
}
```

### 45. Keep the happy path visible

- **Why:** Error handling should not bury the main behavior.
- **Labels:** `readability`, `maintenance`, `correctness`

**Bad**
```java
Result handle(Request request) {
    try {
        if (request == null) {
            throw new IllegalArgumentException();
        }
        return service.handle(request);
    } catch (Exception ex) {
        logger.error("failed", ex);
        return Result.error();
    }
}
```

**Good**
```java
Result handle(Request request) {
    Objects.requireNonNull(request);
    return service.handle(request);
}
```

### 46. Translate boundary exceptions

- **Why:** External library details should not leak throughout the codebase.
- **Labels:** `coupling`, `maintenance`, `diagnostics`

**Bad**
```java
throw new SQLException(ex);
```

**Good**
```java
throw new CustomerRepositoryException(customerId, ex);
```

### 47. Wrap third-party APIs behind your own interface when useful

- **Why:** Wrappers reduce blast radius when vendors or frameworks change, and make volatile boundaries easier to test.
- **Labels:** `coupling`, `testability`, `maintenance`

Wrap external APIs when they are volatile, hard to test, vendor-specific, or leaking into core logic. Do not wrap stable standard-library or simple framework APIs by default.

**Bad**
```java
Stripe.apiKey = key;
Charge.create(params);
```

**Good**
```java
paymentGateway.charge(request);
```

### 48. Use learning tests for external behavior you depend on

- **Why:** Small focused tests document assumptions about a third-party API.
- **Labels:** `testability`, `maintenance`, `diagnostics`

**Bad**
```java
// no tests around fragile JSON mapper behavior
```

**Good**
```java
@Test
void deserializesLegacyTimestampFormat() {
    assertThat(mapper.readValue(json, Event.class).occurredAt())
        .isEqualTo(expected);
}
```

