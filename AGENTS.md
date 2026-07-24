# Local Agent Guidance

Applies to work in this local `.pi` config repo.

## Project purpose and scope
- Contains local customization for Pi agent, including extensions, skills, and config.

## Operational guidelines
- Your role as assistant is to propose, create, and maintain skills and extensions and advise human user about fixes and improvements and Pi's capabilities.
- Never mutate existing git branches/commits. If needed for testing - create temporary agent-owned branches.

## Extensions

- New custom extensions go in `agent/extensions/<name>/index.ts`, not `agent/extensions/<name>.ts`.
- Before changing extension dependencies or Pi host-package links, read `agent/extensions/maintenance.md`.

## Human-Facing READMEs

- New extensions/skills must include a directory-local `README.md`; update it when behavior, usage, requirements, commands/tools, examples, or troubleshooting changes.
- Skill READMEs: quickstart cheat sheets with when to use, useful inputs, example prompts, expected output, and links to deeper files. Avoid copying `SKILL.md` except brief summaries that save navigation.
- Extension READMEs: lean, task-oriented, human-friendly guides covering purpose, requirements, quickstart, common commands/configuration/workflows, user-visible behavior, examples, and troubleshooting.
- Include technical details only when they affect what users do, configure, expect, or troubleshoot; keep internal wiring, lifecycles, test invariants, policy permutations, and process mechanics in code/tests or maintainer docs.
- Follow nearby READMEs for style.

## Testing and Validation

- For non-trivial executable-code changes, default to test-first:
  1. Add/update focused tests for the requirement, expected behavior, or regression.
  2. Implement the change.
  3. Run focused tests and relevant typecheck/lint when practical; report skipped validation and why.
- Use existing test frameworks/conventions; do not add a new framework unless explicitly asked.
- If changed code lacks tests, add the smallest practical focused test; do not backfill broad coverage unless asked.
- Docs, comments, formatting, simple config changes, and mechanical refactors do not require test-first. Executable-code refactors still need relevant validation when practical.
- If test-first is impractical, explain why and use another validation method.
