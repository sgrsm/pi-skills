# Java Clean Audit Taxonomy

Canonical taxonomy for Java clean-code, SOLID, and broad audit skills.

## Benefit labels

Use 1-3 labels per finding:

- `readability`: easier to understand and scan
- `simplicity`: less unnecessary structure or ceremony
- `maintenance`: cheaper future changes
- `testability`: easier, faster, or more deterministic tests
- `coupling`: fewer unnecessary dependencies or change ripple
- `cohesion`: responsibilities belong together
- `modularity`: clearer module/package boundaries
- `encapsulation`: invariants and internals are protected
- `extensibility`: safer addition of stable variation
- `reusability`: reusable only when reuse is real and low-cost
- `robustness`: better behavior under failure or edge cases
- `correctness`: protects behavior, invariants, data, transactions, or concurrency
- `diagnostics`: failures are easier to detect and explain
- `performance`: avoids material latency, allocation, or throughput cost
- `concurrency`: safer ownership, synchronization, or thread interaction

## Severity

- **Critical:** can cause or hide production failures, data corruption, broken invariants, unsafe concurrency, transaction bugs, or contract violations.
- **Major:** makes change expensive or risky: god classes, deep coupling, repeated conditionals, brittle inheritance, hard-to-test design, serious SOLID violations, or large duplication.
- **Moderate:** localized smells: long methods, poor names, confusing comments, primitive obsession, message chains, nullable contracts, noisy abstractions, or fat interfaces.
- **Minor:** small cleanup with low risk and low payoff.

## Evidence strength

- **Direct:** code in scope proves the issue or risk. State as a finding.
- **Context-dependent:** the code suggests a risk, but framework/runtime/domain context may change the answer. State the assumption or phrase as a risk.
- **Hypothesis:** more information is needed. Use “check whether...” or “verify...”; do not present it as a violation.

If evidence is incomplete, phrase the point as a risk or question, not a definite violation. This is especially important for JPA, transactions, concurrency, inheritance contracts, framework lifecycle, reflection, serialization, and generated/Lombok code.

## Finding schema

For each material finding include:

- **Severity:** Critical / Major / Moderate / Minor
- **Rule / principle:** clean-code rule, SOLID principle, or design smell
- **Location:** path and lines if available
- **Evidence:** observable code facts, not preference
- **Impact:** correctness, change cost, coupling, testability, diagnostics, etc.
- **Smallest safe refactor:** incremental next step, including tests/seams when needed
- **Labels:** 1-3 benefit labels

Omit low-value fields only for very short “no material findings” responses.
