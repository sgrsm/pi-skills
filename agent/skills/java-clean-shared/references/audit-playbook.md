# Audit Playbook

This document tells the agent how to perform a Java clean-code and design audit.

The reference rules in this skill are paraphrased and distilled from memory and common professional practice inspired by *Clean Code*, *Refactoring*, and SOLID-oriented design ideas. They are intended as practical review heuristics, not as strict legal text or verbatim excerpts.

## Goal

Find the changes that will most improve:

- readability
- simplicity
- maintenance
- testability
- coupling
- cohesion
- modularity
- encapsulation
- extensibility
- reusability
- robustness
- correctness
- diagnostics
- performance
- concurrency

Use these terms as labels on findings. A finding may have multiple labels.

## What to prioritize

Prioritize in roughly this order unless the user says otherwise:

1. correctness risks
2. high coupling, unclear responsibilities, and low cohesion
3. missing or hard-to-write tests
4. duplication and long-term maintenance cost
5. readability and naming issues
6. formatting-only issues

## Severity guide

### Critical

Use when the issue can cause or hide production failures, data corruption, broken invariants, unsafe concurrency, or transaction bugs.

### Major

Use for problems that make change expensive: god classes, deep coupling, repeated conditionals, hard-to-test design, serious SOLID violations, and large duplication.

### Moderate

Use for local smells: long methods, poor names, confusing comments, primitive obsession, message chains, nullable contracts, and noisy abstractions.

### Minor

Use for small cleanup opportunities with low risk and low payoff.

## Audit workflow

### 1. Understand the scope

Determine whether the user wants a review of:

- a whole repository
- one module
- a package
- a single file or diff
- clean code only
- SOLID or class design only
- an actionable refactoring plan

If scope is unclear, infer from the files given and state the assumption.

Use scope tiers to avoid over-reading:

- **Diff review:** prioritize changed lines and directly affected collaborators/tests. Do not report pre-existing unrelated issues unless they materially affect the changed code or refactoring safety.
- **Single file:** inspect the file, immediate collaborators, and relevant tests needed to validate a finding.
- **Package or module:** inspect build files, package structure, representative entry points, key collaborators, and tests.
- **Whole repository:** map modules, hotspots, common abstractions, dependency boundaries, and representative flows before ranking findings.

Do not map the full project or trace unrelated flows for a narrow review unless the evidence requires it.

### 2. Map the project structure

Inspect:

- `pom.xml`
- `build.gradle` / `build.gradle.kts`
- `settings.gradle`
- module folders
- `src/main/java`
- `src/test/java`
- package structure
- test layout
- configuration and wiring

Look for:

- hotspot packages and classes
- large services or managers
- shared utility buckets
- common abstractions and interfaces
- repeated code paths
- dependencies that make tests or refactoring harder

### 3. Trace one or two representative flows

Start at a public entry point, service method, or relevant test, then follow the call chain.

Check whether:

- responsibilities stay clear
- methods keep one level of abstraction
- side effects are explicit
- collaborators are few and meaningful
- data validation and state changes are easy to follow

### 4. Inspect code-level cleanliness

Check for:

- naming quality
- method size and abstraction level
- hidden side effects
- flag arguments
- null-heavy contracts
- weak error handling
- duplication
- comments compensating for unclear code
- primitive obsession
- message chains
- feature envy
- long parameter lists
- god classes
- mixed responsibilities

### 5. Inspect tests

Check whether tests are:

- fast enough to run often
- isolated
- deterministic
- expressive
- focused on behavior
- easy to extend when requirements change

Also check whether the production design makes testing unnecessarily hard.

### 6. Produce findings that are useful

Each finding should be concrete.

Prefer this structure:

- **Severity:** Critical / Major / Moderate / Minor
- **Rule / principle:** e.g. `Small methods`, `SRP`, `Hidden side effect`
- **Location:** path and lines if available
- **Labels:** list of benefit labels
- **Evidence:** what the code currently does
- **Why it matters:** maintenance cost, defect risk, coupling, etc.
- **Suggested refactoring:** smallest safe next step

## Review conventions

- Use neutral, professional language.
- Avoid praise, blame, and emotional qualifiers.
- Focus on evidence, impact, and recommended changes.
- Default to at most 5 findings for narrow reviews and 10 findings for package/module reviews unless the user asks for exhaustive output.
- If there are no material issues in scope, state that briefly and stop. Do not invent low-value findings.

### Prefer evidence over preference

Less useful:

- "Rewrite this method."

Preferred:

- "This class mixes validation, persistence, formatting, and notification logic, which increases change surface and makes isolated unit testing harder."

### Prefer root causes over symptoms

Less useful:

- report 20 naming issues in a god class without mentioning the god class

Preferred:

- identify the god class first, then note naming issues as secondary symptoms

### Prefer incremental refactoring steps

For legacy code, recommend:

1. add characterization tests
2. extract seams
3. move one responsibility at a time
4. rename after behavior is protected by tests

### Record existing constraints only when they affect the recommendation

Examples:

- stable public APIs that limit signature changes
- existing test seams that reduce refactoring risk
- existing value objects or abstractions that should be reused
- framework constraints that affect the migration path

## Common indicators in maintainable Java code

- names are intention-revealing
- methods are small and focused
- classes have cohesive responsibilities
- dependencies are explicit and easy to fake in tests
- value objects capture important concepts
- tests are readable and deterministic
- shared utilities are small and focused
- side effects and exceptions are easy to spot

## Refactoring checklist

When proposing changes, prefer these moves:

- rename for clarity
- extract method
- extract class
- introduce value object
- move method
- move field
- split phase
- replace conditional with polymorphism when variation is stable and repeated
- introduce parameter object
- separate query from modifier
- wrap external API
- remove dead abstraction

## What not to do

- Do not report every small style preference as a major issue.
- Do not force patterns where a simpler class would do.
- Do not recommend inheritance when composition is clearer.
- Do not call something a SOLID violation without showing concrete impact.
- Do not treat every framework annotation or library type as a design problem unless it concretely harms readability, coupling, or testability.
