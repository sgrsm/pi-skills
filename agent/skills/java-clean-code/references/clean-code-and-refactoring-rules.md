# Clean Code and Refactoring Rules

These rules are intentionally practical and opinionated. They are inspired by ideas commonly associated with Robert C. Martin's *Clean Code* and Martin Fowler's *Refactoring*, but they are paraphrased and condensed for code-audit use.

Examples are intentionally tiny. Real code may need a more nuanced trade-off.

Scope note: this file focuses on local code readability, method and class cleanliness, common smells, and safe refactoring moves. Use the sibling `java-clean-solid` skill for explicit SOLID analysis.

## Naming

### 1. Use intention-revealing names

- **Why:** A name should tell the reader what the value or method means.
- **Labels:** `readability`, `maintenance`, `testability`

**Bad**
```java
int d;
```

**Good**
```java
int elapsedDays;
```

### 2. Make meaningful distinctions

- **Why:** Names like `data`, `info`, `manager`, or numbered variants rarely explain the difference between things.
- **Labels:** `readability`, `maintenance`

**Bad**
```java
CustomerData data;
CustomerInfo info;
```

**Good**
```java
CustomerProfile profile;
CustomerBillingDetails billingDetails;
```

### 3. Prefer pronounceable and searchable names

- **Why:** If a name is hard to say or grep, it is harder to discuss and maintain.
- **Labels:** `readability`, `maintenance`

**Bad**
```java
String genymdhms;
```

**Good**
```java
String generatedAtIsoTimestamp;
```

### 4. Avoid encoding type and implementation details in names

- **Why:** Type prefixes and suffixes become noise and often lie after refactoring.
- **Labels:** `readability`, `maintenance`

**Bad**
```java
List<User> userList;
String strName;
```

**Good**
```java
List<User> users;
String name;
```

### 5. Use one word for one concept

- **Why:** `fetch`, `get`, `load`, and `retrieve` should not all mean the same thing in the same module.
- **Labels:** `readability`, `maintenance`

**Bad**
```java
userService.fetchUser(id);
userRepository.getUser(id);
userClient.loadUser(id);
```

**Good**
```java
userService.getUser(id);
userRepository.getById(id);
userClient.getUser(id);
```

### 6. Prefer domain language over vague technical noise

- **Why:** Code should reflect the business problem, not generic words.
- **Labels:** `readability`, `maintenance`

**Bad**
```java
class DataProcessor {
    InvoiceResult process(DataObject data) { ... }
}
```

**Good**
```java
class InvoiceSettlementService {
    InvoiceResult settle(Invoice invoice) { ... }
}
```

### 7. Add enough context, not redundant context

- **Why:** Names need local clarity, but repeating the package or class name everywhere adds noise.
- **Labels:** `readability`, `maintenance`

**Bad**
```java
class Address {
    private String addressStreet;
    private String addressZipCode;
}
```

**Good**
```java
class Address {
    private String street;
    private String zipCode;
}
```

## Functions and Methods

### 8. Keep methods small

- **Why:** Small methods are easier to read, test, and reuse.
- **Labels:** `readability`, `maintenance`, `testability`

**Bad**
```java
void process(Order order) {
    validate(order);
    calculateTotals(order);
    persist(order);
    publishEvent(order);
    sendEmail(order);
}
```

**Good**
```java
void process(Order order) {
    validate(order);
    Order processed = finalizeOrder(order);
    notifyCompletion(processed);
}
```

### 9. Make each method do one thing

- **Why:** Mixed responsibilities create hidden coupling and make changes risky.
- **Labels:** `cohesion`, `maintenance`, `testability`

**Bad**
```java
User register(String email) {
    validateEmail(email);
    User user = repository.save(new User(email));
    auditLog.write("registered " + email);
    mailer.sendWelcome(email);
    return user;
}
```

**Good**
```java
User register(String email) {
    validateEmail(email);
    User user = repository.save(new User(email));
    afterRegistration(user);
    return user;
}
```

### 10. Keep one level of abstraction per method

- **Why:** Mixing business policy with low-level details makes code jerky and hard to scan.
- **Labels:** `readability`, `maintenance`

**Bad**
```java
void generateReport() {
    gatherBillingSummary();
    String path = "/tmp/report-" + LocalDate.now() + ".csv";
    Files.writeString(Path.of(path), buildCsv());
}
```

**Good**
```java
void generateReport() {
    BillingSummary summary = gatherBillingSummary();
    reportWriter.write(summary);
}
```

### 11. Prefer descriptive method names to explanatory comments

- **Why:** A good name keeps the call site readable.
- **Labels:** `readability`, `maintenance`

**Bad**
```java
// ensure the user is active and allowed to borrow books
if (user.isActive() && !user.isBlocked() && user.hasMembership()) {
    ...
}
```

**Good**
```java
if (user.canBorrowBooks()) {
    ...
}
```

### 12. Keep argument lists small

- **Why:** Long parameter lists hide missing abstractions and are easy to misuse.
- **Labels:** `readability`, `maintenance`, `testability`

**Bad**
```java
invoice(total, currency, locale, dueDate, customerType, discountRate);
```

**Good**
```java
invoice(new InvoiceRequest(total, currency, locale, dueDate, customerType, discountRate));
```

### 13. Avoid flag arguments

- **Why:** A boolean often means the method does two different things.
- **Labels:** `readability`, `cohesion`, `maintenance`

**Bad**
```java
sendReport(report, true);
```

**Good**
```java
sendPreviewReport(report);
sendFinalReport(report);
```

### 14. Separate commands from queries

- **Why:** A method should either change state or answer a question, not both.
- **Labels:** `correctness`, `readability`, `testability`

**Bad**
```java
User getOrCreateUser(String email) {
    return repository.findByEmail(email)
        .orElseGet(() -> repository.save(new User(email)));
}
```

**Good**
```java
Optional<User> findUser(String email) {
    return repository.findByEmail(email);
}

User createUser(String email) {
    return repository.save(new User(email));
}
```

### 15. Avoid hidden side effects

- **Why:** Readers should not be surprised by a method that secretly mutates unrelated state.
- **Labels:** `correctness`, `maintenance`, `testability`

**Bad**
```java
BigDecimal total = invoice.calculateTotal(); // also updates invoice status internally
```

**Good**
```java
BigDecimal total = invoice.calculateTotal();
invoice.markCalculated(total);
```

### 16. Prefer guard clauses over deeply nested conditionals

- **Why:** Early exits flatten code and keep the main path visible.
- **Labels:** `readability`, `maintenance`, `correctness`

**Bad**
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

**Good**
```java
void ship(Order order) {
    if (order == null || !order.isPaid() || order.isCancelled()) {
        return;
    }
    warehouse.ship(order);
}
```

### 17. Remove duplication by extraction

- **Why:** Duplication multiplies change cost and defect risk.
- **Labels:** `maintenance`, `correctness`, `testability`

**Bad**
```java
if (user == null || !user.isActive()) {
    throw new IllegalStateException("Inactive user");
}
// ...
if (user == null || !user.isActive()) {
    throw new IllegalStateException("Inactive user");
}
```

**Good**
```java
validateActiveUser(user);
// ...
validateActiveUser(user);
```

### 18. Make temporal coupling explicit

- **Why:** If methods must be called in a certain order, the API should make that order obvious.
- **Labels:** `correctness`, `maintenance`, `testability`

**Bad**
```java
reportBuilder.setData(data);
reportBuilder.setTemplate(template);
reportBuilder.build();
```

**Good**
```java
Report report = reportBuilder
    .withTemplate(template)
    .withData(data)
    .build();
```

### 19. Separate orchestration from detailed work

- **Why:** A method that coordinates collaborators should not also contain low-level parsing, mapping, and persistence details.
- **Labels:** `cohesion`, `maintenance`

**Bad**
```java
void importUsers(Path csv) {
    for (String line : Files.readAllLines(csv)) {
        String[] parts = line.split(",");
        repository.save(new User(parts[0], parts[1]));
    }
}
```

**Good**
```java
void importUsers(Path csv) {
    List<User> users = csvUserReader.read(csv);
    userBatchPersister.saveAll(users);
}
```

## Comments and Formatting

### 20. Let code explain the what; comments should explain why

- **Why:** Comments often rot. Prefer expressive code first.
- **Labels:** `readability`, `maintenance`

**Bad**
```java
// increment retry count
retryCount++;
```

**Good**
```java
retryCount++;
```

### 21. Avoid redundant or misleading comments

- **Why:** Wrong comments are worse than no comments.
- **Labels:** `readability`, `correctness`, `maintenance`

**Bad**
```java
// returns active users
List<User> findUsers() {
    return repository.findAll();
}
```

**Good**
```java
List<User> findActiveUsers() {
    return repository.findByStatus(Status.ACTIVE);
}
```

### 22. Delete commented-out code

- **Why:** Version control already stores history.
- **Labels:** `readability`, `maintenance`

**Bad**
```java
// old tax logic kept just in case
// total = total.multiply(new BigDecimal("1.18"));
```

**Good**
```java
total = taxPolicy.apply(total);
```

### 23. Keep related code close together

- **Why:** Readers should not jump across the file to understand one concept.
- **Labels:** `readability`, `maintenance`, `cohesion`

**Bad**
```java
class InvoiceService {
    void approve(...) { ... }
    // 200 lines later
    void validateApproval(...) { ... }
}
```

**Good**
```java
class InvoiceService {
    void approve(...) {
        validateApproval(...);
        ...
    }

    void validateApproval(...) { ... }
}
```

### 24. Format for scanning

- **Why:** Layout is part of communication. Dense code hides structure.
- **Labels:** `readability`, `maintenance`

**Bad**
```java
if(valid){doWork();doMore();log();}
```

**Good**
```java
if (valid) {
    doWork();
    doMore();
    log();
}
```

### 25. Use blank lines to separate concepts

- **Why:** Visual grouping helps the reader identify phases.
- **Labels:** `readability`, `maintenance`

**Bad**
```java
validate(order);
price(order);
repository.save(order);
mailer.send(order);
```

**Good**
```java
validate(order);
price(order);

repository.save(order);

mailer.send(order);
```

### 26. Declare variables close to where they are used

- **Why:** Large variable scope increases cognitive load and mutation risk.
- **Labels:** `readability`, `maintenance`, `correctness`

**Bad**
```java
String normalizedEmail;
User user;
// many lines later
normalizedEmail = email.trim().toLowerCase();
user = repository.findByEmail(normalizedEmail).orElseThrow();
```

**Good**
```java
String normalizedEmail = email.trim().toLowerCase();
User user = repository.findByEmail(normalizedEmail).orElseThrow();
```

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

- **Why:** If a method mostly uses another object's data, it probably belongs there.
- **Labels:** `cohesion`, `coupling`, `maintenance`

**Bad**
```java
class InvoicePrinter {
    String print(Invoice invoice) {
        return invoice.getCustomerName() + ": " + invoice.getTotal();
    }
}
```

**Good**
```java
class Invoice {
    String printableSummary() {
        return customerName + ": " + total;
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

### 47. Wrap third-party APIs behind your own interface

- **Why:** Wrappers reduce blast radius when vendors or frameworks change.
- **Labels:** `coupling`, `testability`, `maintenance`

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

### 55. Replace long parameter lists with parameter objects

- **Why:** A cluster of parameters often hides a concept.
- **Labels:** `readability`, `maintenance`, `testability`, `cohesion`

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
