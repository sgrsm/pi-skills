# Naming, Methods, Comments, and Formatting Rules

Detailed Java clean-code rules and examples. Load this file only when the compact checklist is insufficient for the current finding, the user asks for examples, or the audit is broad/exhaustive.

Apply these as heuristics, not slogans. Do not recommend extra abstraction, wrappers, value objects, or extraction unless the observed code shows readability, correctness, testability, or change-safety cost.

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

- **Why:** Small methods are easier to read, test, and reuse when extraction reveals concepts instead of hiding flow.
- **Labels:** `readability`, `maintenance`, `testability`

Do not flag a method solely because it has several calls. A clear orchestration method can be fine. Flag it when low-level details, phases, or responsibilities obscure the main behavior.

**Bad**
```java
void process(Order order) {
    if (order == null || order.lines().isEmpty()) {
        throw new IllegalArgumentException("empty order");
    }
    BigDecimal total = order.lines().stream()
        .map(line -> line.price().multiply(BigDecimal.valueOf(line.quantity())))
        .reduce(BigDecimal.ZERO, BigDecimal::add);
    order.markPriced(total);
    repository.save(order);
    mailer.send("Processed " + order.id() + " for " + total);
}
```

**Good**
```java
void process(Order order) {
    validator.validate(order);
    Order priced = pricingService.price(order);
    repository.save(priced);
    receiptMailer.sendFor(priced);
}
```

### 9. Make each method do one coherent thing

- **Why:** Mixed responsibilities create hidden coupling and make changes risky.
- **Labels:** `cohesion`, `maintenance`, `testability`

A method may orchestrate one use case, but it should not bury unrelated responsibilities or hide important side effects behind vague helpers.

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
    EmailAddress address = EmailAddress.parse(email);
    User user = userCreator.create(address);
    registrationAudit.recordRegistered(user);
    welcomeMailer.sendTo(user);
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

- **Why:** A query-looking method that mutates state surprises callers and complicates tests.
- **Labels:** `correctness`, `readability`, `testability`

A command may return a value. Flag the code when the name or contract hides mutation, not merely because a method both does work and returns a result. `getOrCreate` can be valid if command semantics, transaction boundary, and concurrency behavior are explicit.

**Bad**
```java
User findUser(String email) {
    return repository.findByEmail(email)
        .orElseGet(() -> repository.save(new User(email)));
}
```

**Good**
```java
Optional<User> findUser(String email) {
    return repository.findByEmail(email);
}

User getOrCreateUser(String email) {
    return userRegistration.findExistingOrCreate(email);
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

Use no-op guard returns only when the method contract makes no-op valid. For invalid input, fail fast instead of silently hiding bugs.

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
    Objects.requireNonNull(order, "order");
    if (!order.isPaid() || order.isCancelled()) {
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

