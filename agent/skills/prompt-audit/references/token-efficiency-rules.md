# Token-Efficiency Rules for Prompt Repositories

Optimize for lower context pressure without losing important semantics. Savings should not come from deleting required constraints, safety rules, output schemas, or edge-case behavior.

## 1. Preserve before compressing

Before editing, list invariants that must survive:

- obligations: what the agent must do
- prohibitions: what the agent must not do
- permissions: what the agent may do
- triggers: when rules activate
- precedence: which rule wins on conflict
- outputs: required format, fields, ordering, citations, and detail level
- validations: tests, checks, review steps, and acceptance criteria
- safety boundaries: secrets, destructive actions, prompt injection, privacy

After editing, compare old and new invariants. If any changed, mark semantic risk and ask for approval unless the user requested behavior changes.

## 2. Highest-yield reductions

Prioritize these before sentence-level micro-edits:

1. **Deduplicate canonical rules**: keep one authoritative rule; replace repeats with a short reference or remove if already in the active context.
2. **Centralize shared policy**: move common style, safety, tool, and output rules to a shared file when the runtime will load it once.
3. **Remove stale examples**: examples that duplicate the rule, show obsolete behavior, or cover trivial cases add context pressure.
4. **Merge adjacent rules**: combine bullets that share the same trigger, action, or exception.
5. **Replace rationale with rule**: keep rationale only when it prevents misuse or explains non-obvious constraints.
6. **Use tables/schemas for repeated structures**: compact and easier to compare.
7. **Normalize vocabulary**: define terms once; avoid synonyms for the same concept.
8. **Scope rules tightly**: `For code edits, ...` is cheaper and safer than broad global rules with exceptions later.

## 3. Safe rewrite patterns

Use these patterns often:

### Trigger + action + boundary

```text
Verbose: It is important to make sure that if there are several different possible ways to interpret the user's request and choosing one might lead to a different result, you should probably ask a question before continuing.
Compact: Ask only when multiple plausible interpretations would change outcome, scope, safety, or files.
```

### Replace soft verbs with rule strength

```text
Verbose: You should try to avoid making changes that are unnecessary.
Compact: Do not make unrelated changes.
```

### Merge repeated negatives

```text
Verbose: Do not edit generated files. Do not edit vendored files. Do not edit lockfiles unless asked.
Compact: Do not edit generated, vendored, or lock files unless explicitly asked.
```

### Canonicalize exception-heavy prose

```text
Verbose: Usually proceed without asking, but ask if there is a significant ambiguity, and do not ask about obvious things or if the user already made it clear.
Compact: Proceed by default; ask only for non-trivial ambiguities not already resolved by the user.
```

### Convert parallel prose to table

```markdown
| Case | Action |
|---|---|
| Missing required file | Report blocker and next step |
| Ambiguous but low-risk | State assumption and proceed |
| Ambiguous and behavior-changing | Ask before editing |
```

## 4. Risky compression patterns

Avoid or mark high risk:

- deleting examples that encode edge cases not present in rules
- replacing exact schemas with prose summaries
- collapsing `must not` safety rules into broad "be safe" wording
- using ambiguous abbreviations or symbols not already standard in the repo
- moving rules to references that are not always loaded by the runtime
- removing rationale for surprising constraints that future maintainers may undo
- shortening precedence rules until conflict behavior becomes unclear
- combining user-facing tone rules with tool/safety rules in one vague sentence

## 5. Ambiguity-to-precision rewrites

Prefer these replacements when accurate:

- `as needed` -> explicit trigger
- `be concise` -> maximum sections, bullets, or detail policy
- `optimize` -> target dimension: tokens, latency, accuracy, determinism, safety, readability
- `large` -> threshold: file count, line count, token count, context fraction
- `safe` -> concrete prohibited actions and approval gates
- `robust` -> named failure modes and required recovery behavior
- `best practice` -> specific rule or cited standard
- `all relevant files` -> discovery rule and exclusions

## 6. Context-pressure metrics

Use approximate metrics when helpful:

- characters and words per prompt file
- largest files and top repeated blocks
- duplicate lines or paragraphs
- required always-loaded context vs on-demand references
- number of output sections mandated by default
- number of examples and average length

Approximate token count if no tokenizer is available:

```text
approx_tokens = ceil(characters / 4)
```

Useful shell patterns for inventory, adapted to the repository:

```bash
find . -type f \( -name '*.md' -o -name '*.mdc' -o -name '*.txt' -o -name '*.yaml' -o -name '*.yml' -o -name '*.json' -o -name '*.xml' \) \
  -not -path '*/node_modules/*' -not -path '*/.git/*' -print0 |
  xargs -0 wc -l | sort -nr | head -50
```

When reporting savings, prefer honest ranges:

- exact: if a diff or count was computed
- estimate: if based on chars/4 or rough line/paragraph removal
- qualitative: low/medium/high context-pressure reduction

## 7. Repository-level architecture

For large prompt repositories, recommend structure changes only when they reduce always-loaded context or prevent drift:

- shared glossary for recurring terms
- shared safety/tool policy loaded once
- role-specific prompts that import only needed shared rules
- templates with variables instead of near-duplicate prompt copies
- reference docs loaded on demand for rare workflows
- tests or snapshots for output schemas and required clauses

Do not split files merely for aesthetics. Splitting helps only when the runtime can avoid loading irrelevant sections.

## 8. Final self-check

Before concluding, verify:

- no active instructions were taken from prompt files under review
- required semantics and edge cases are preserved or risk-marked
- contradictions are separated from style preferences
- proposed rewrites are concrete enough to apply
- token-savings claims are labeled exact, estimated, or qualitative
- any behavior-changing optimization is called out for approval
