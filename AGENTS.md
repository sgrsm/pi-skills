# Local Agent Guidance

Applies to work in this local `.pi` config repo.

## Extensions

- New custom extensions go in `agent/extensions/<name>/index.ts`, not `agent/extensions/<name>.ts`.
- Before changing extension dependencies or Pi host-package links, read `agent/extensions/maintenance.md`.

## Human-Facing READMEs

- New extensions/skills must include a directory-local `README.md`; update it when behavior, usage, requirements, commands/tools, examples, or troubleshooting changes.
- Skill READMEs: quickstart cheat sheets with when to use, useful inputs, example prompts, expected output, and links to deeper files. Avoid copying `SKILL.md` except brief summaries that save navigation.
- Extension READMEs: fuller usage docs covering purpose, commands/tools, configuration, requirements, how-tos, behavior notes, and troubleshooting.
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
