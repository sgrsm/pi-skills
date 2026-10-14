# Java Clean Review Contract

Rules every `java-clean-*` review follows. Each skill's `SKILL.md` adds only its lens.

Sources: *Refactoring* (Fowler, 2nd ed.), *Clean Code* and *Clean Architecture* (Martin), *Effective Java* (Bloch), *Working Effectively with Legacy Code* (Feathers), *A Philosophy of Software Design* (Ousterhout), *Tidy First?* (Beck). Use their canonical smell and refactoring names. The [smell catalog](smell-catalog.md) lists them with the calibration these skills apply.

## Scope

| Request | Read | Report |
|---|---|---|
| Diff or PR | changed lines, their direct callers and callees, related tests | issues the change introduces or makes worse; pre-existing issues only when they block or endanger the change |
| File, class, or method | the target, its direct collaborators, its tests | issues in the target |
| Package or module | build files, package structure, entry points, hotspots, tests | root causes across classes |
| Repository | module map, package dependencies, hotspots, representative flows | the few root causes with the highest cost |

When the request doesn't fix the scope, pick the narrowest one that fits and state it. Skip generated and vendored code (`target/`, `build/`, `generated-sources`, annotation-processor output).

## What counts as material

Report a finding only when fixing it would do at least one of these for code in scope:

- remove a plausible defect or a failure-handling risk;
- noticeably cut the cost or risk of changes the code is likely to see (ripple edits, misleading contracts, logic that can't be tested cheaply);
- stop readers from misreading the code.

Code that breaks a rule of thumb but is simple, stable, readable, and easy to test is not material. If nothing is material, use the short no-findings report described under "Report shape and caps".

## Gathering evidence

Run the cheap check before reporting:

- Search call sites and implementations before claiming duplication, dead code, a single implementation, unused interface methods, or what callers expect.
- Read the relevant tests before claiming missing coverage or brittle tests.
- Use history for change-related claims (divergent change, shotgun surgery, hotspots): `git log --format=%s -- <file>` for reasons a file changed, `git log --name-only --format= -- <path>` for files that change together.
- Read the Java version from the build (`maven.compiler.release` or `source`, Spring Boot's `<java.version>`, Gradle `toolchain` or `sourceCompatibility`) and don't suggest features it lacks.

Base each numbered finding on code you read. Conclusions drawn from how visible code uses a type count: a `void close()` followed by `save(account)` shows that `close` changes the object. Claims about the internals of code you can't see (an implementation, a caller, a collaborator's contract) don't; they go under **To verify**.

Give each numbered finding a confidence:

- **Direct:** the code, or a check you ran, proves it.
- **Context-dependent:** the evidence is in the code you read, but the cost depends on runtime, framework, or domain facts you can't confirm (proxy rules, currency rounding, how often a path runs). State the assumption.

## Severity

Rate by consequence, not by smell name:

- **Critical:** a plausible defect now: lost or corrupted data, a failure reported as success, a broken invariant, a race, or a transaction or contract that callers rely on and that doesn't hold.
- **Major:** likely changes become expensive or risky: ripple edits across classes, dependency cycles, a class that most changes in its area must touch (a god class), logic that needs heavy setup to test, or a misleading contract that invites defects.
- **Moderate:** the cost stays local; one method, or one class with a single responsibility, is harder to read, test, or change safely.
- **Minor:** low-payoff cleanup. Report it only when the cap leaves room.

Raise a level for code that changes often or sits on a critical path. Lower one for stable code nobody needs to change. Use exactly one level per finding; when it depends on an assumption, rate it for that assumption and state the assumption under Confidence.

## Refactoring or behavior change

A refactoring keeps observable behavior. Label every fix with one of:

- `refactoring`
- `behavior change: <what changes>`, for example a different exception type, rejecting a `null` that used to be ignored, a new failure mode, or different transaction or call ordering. Present these as decisions for the user, not as cleanup.

Recommend the smallest named step first (Rename, Extract Function, Move Function, Split Phase, Inline, Separate Query from Modifier, and so on). When no test would catch a mistake in the change, make characterization tests the first step. Keep structural changes and behavior changes in separate commits.

## Finding format

Order findings by severity, then by payoff. Report one finding per root cause and cite its symptoms as evidence. Name the smell as the catalog does, and add the principle when it explains the cost (`SRP / Divergent Change`). Give locations as `path:line`.

```markdown
### 1. Major · Feature Envy · `src/main/java/com/acme/billing/InvoiceService.java:42`
**Evidence:** `isOverdue` reads only `Invoice` state (`paid`, `dueDate`); `ReminderJob` and `DunningService` repeat the same check (call-site search).
**Impact:** a change to the overdue rule needs three coordinated edits.
**Fix:** Move Function `isOverdue` to `Invoice` and let callers delegate. `refactoring`
**Confidence:** Direct
```

## Report shape and caps

1. **Scope:** one or two lines on what you read, the Java version, and what you left out.
2. **Findings:** at most 5 for a diff, a file, or a few classes; 10 for a package or module; 15 for a repository, unless the user asks for everything. If more qualify, end the list with one line: `Not listed: N lower-severity findings (areas: ...)`.
3. **To verify:** at most 2 one-line checks, where code in scope relies on behavior you couldn't see and something in scope points to the risk. No severity and no fix. Leave it out when nothing qualifies.
4. **Refactoring order:** only when findings depend on each other or the scope is a package or wider. Safety net first, then seams, then moves, with each step shippable alone. Fix Critical findings as soon as the tests and seams they need exist, before other moves.

When nothing is material, the whole report is the scope line, then `No material findings.` and one sentence naming the main look-alike you checked, then any To verify lines. Don't list the look-alikes, what the code does well, or which rules it follows.

Write neutrally and only about the code. No praise, and don't restate the code back to the user.

## Java and framework constraints

- Treat framework mechanics as findings only when they have a concrete cost: a defect, a proxy or lifecycle bug, coupling that blocks a change, or tests that need a full application context for pure logic. This covers Spring stereotypes and constructor injection, JPA no-arg constructors and mutable fields, Lombok, records, builders, mutable DTOs, and Jackson or serialization hooks.
- Check proxy and lifecycle effects before suggesting a move. Spring's `@Transactional`, `@Async`, and `@Cacheable` don't apply to self-invocation or private methods. JPA entities need proxy-friendly classes and careful `equals` and `hashCode`.
- `Optional` is for return values that may be absent. Don't suggest it for fields, parameters, or framework-bound properties. If the project uses nullness annotations (JSpecify or another `@Nullable`), follow them.
- Code reached through reflection (Spring beans, Jackson, JPA callbacks, `@EventListener`, `@Scheduled`) can look unused. Verify before calling it dead.
