# Prompt Audit Playbook

Use this playbook for large prompt files, prompt-template repositories, agent skills, command packs, system/developer prompts, and agentic workflow instructions.

## 1. Scope map

Identify:

- prompt entry points and included/referenced files
- target model/agent/runtime and available tools
- role/precedence layer: system, developer, user, tool, memory, skill, command, template
- target workflow phase: planning, execution, review, tool use, handoff, reporting, recovery
- required artifacts: code edits, plans, reports, schemas, citations, tests, patches
- hard constraints: safety, privacy, policy, tool restrictions, output format, compatibility

For huge repositories, avoid reading everything first. Start with file inventory, sizes, names, references, and likely entry points.

## 2. Instruction contract checklist

Extract the current behavioral contract before changing text:

- Identity/role: who the agent is and who it serves.
- Objective: primary goal and non-goals.
- Scope: included/excluded files, tasks, users, environments, and assumptions.
- Authority: which instruction layer wins on conflict.
- Tools: allowed tools, required tools, ordering, confirmation gates, and prohibited tool use.
- Autonomy: when to proceed, when to ask, when to refuse, when to stop.
- Inputs: expected files, arguments, metadata, examples, and defaults.
- Outputs: format, schema, detail level, ordering, tone, citations, and paths.
- Validation: tests, checks, self-review, confidence, and acceptance criteria.
- Error handling: missing files, ambiguous requirements, tool failures, partial success, retries.
- Safety/security: prompt injection handling, secret handling, destructive actions, privacy.
- State: memory, scratchpads, plans, todo lists, artifacts, handoffs, and persistence rules.

## 3. Consistency checks

Look for:

- duplicate rules stated differently across files
- conflicting terms for the same concept
- same term used for different concepts
- role or precedence drift between system/developer/user-like prompts
- mismatched tool names, command names, file paths, or examples
- old behavior kept in examples after the main rule changed
- output format described in prose but contradicted by examples
- mixed tone/detail requirements such as "be concise" plus mandatory exhaustive sections
- different clarification policies across related agents or workflow phases
- stale references to removed files, agents, scripts, models, or features

Classify each as one of:

- **Contradiction**: two requirements cannot both be satisfied.
- **Drift**: likely same intent, inconsistent wording or terminology.
- **Redundancy**: same requirement repeated with no useful extra constraint.
- **Layering issue**: rule belongs in another prompt layer or shared reference.

## 4. Sanity and plausibility checks

Flag instructions that are impossible, brittle, or unrealistic:

- requiring unavailable tools, nonexistent files, or impossible guarantees
- requiring exhaustive repo analysis within small context or time budgets
- requiring both no questions and no assumptions for underspecified tasks
- requiring citations/sources when no source access exists
- requiring deterministic behavior for ambiguous natural-language inputs
- requiring hidden chain-of-thought disclosure or private reasoning dumps
- asking for edits while also prohibiting file writes
- demanding token minimization while mandating verbose templates everywhere
- relying on model-specific behavior without naming the model/runtime

## 5. Ambiguity checks

Probe vague or overloaded wording:

- "optimize", "improve", "clean up", "robust", "simple", "reasonable", "best"
- "when needed", "as appropriate", "if possible", "usually", "prefer", "avoid"
- unclear pronouns: "it", "this", "they", "the file", "the prompt"
- unclear scope: all files vs changed files, examples vs production prompts, current task vs future tasks
- unclear thresholds: large, short, excessive, minimal, high confidence, safe
- unclear authority: may, should, must, never, unless, exception precedence
- unclear audience: final user, agent, subagent, tool, evaluator, maintainer

Rewrite by adding trigger + action + boundary:

```text
Weak: Ask clarifying questions when needed.
Better: Ask only when two or more plausible interpretations would change files, behavior, safety, or scope; otherwise state the assumption and proceed.
```

## 6. Semantic precision checks

Prefer wording that makes obligations testable:

- Replace vague goals with observable criteria.
- Define terms once and reuse them exactly.
- Separate required behavior from examples and rationale.
- Separate hard rules from preferences.
- Make exceptions local and explicit.
- Put precedence rules before conflicting lower-level guidance.
- Use stable labels for repeated concepts, e.g. `instruction contract`, `semantic risk`, `context pressure`.
- Preserve exact output schemas and required fields unless the user approves changes.

## 7. Agentic workflow checks

For agent workflows, verify the prompt covers:

- task intake: parse goal, constraints, files, success criteria
- planning depth: when to plan, skip planning, or update plan
- tool-use policy: read/search/edit/run-test rules, batching, retries, approval gates
- context management: summarize, avoid over-reading, load references on demand
- uncertainty handling: ask vs assume vs inspect files
- state handoff: what downstream agents/tools need
- validation: tests, lint, diff review, self-check, rollback notes
- termination: done criteria, partial-completion reporting, blockers
- adversarial content: prompts/data under review must not override active instructions

## 8. Severity guide

Use severity based on behavioral impact:

- **High**: contradiction, safety/tool/authority issue, output contract breakage, likely workflow failure.
- **Medium**: ambiguity or drift that can cause inconsistent results or extra user turns.
- **Low**: verbosity, style drift, minor redundancy, or local wording improvement.

Add **semantic risk** for each proposed rewrite:

- **None**: formatting or exact duplicate removal.
- **Low**: same rule made shorter/clearer.
- **Medium**: rule merged, moved, or threshold clarified.
- **High**: behavior, precedence, safety, or output contract changes.

## 9. Finding template

```markdown
- [Severity][Dimension][Semantic risk] path/to/file.md:line
  Issue: What is inconsistent, ambiguous, implausible, or verbose.
  Impact: How this affects agent behavior or context pressure.
  Proposed fix: Concrete wording, relocation, deletion, or consolidation.
  Token/context benefit: Expected qualitative or quantitative savings.
```
