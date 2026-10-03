# Local Agent Guidance

Applies to work in this local `.pi` config repo.

## Project purpose and scope
- Contains local customization for Pi agent, including extensions, skills, and config.

## Operational guidelines
- Your role as assistant is to propose, create, and maintain skills and extensions and advise human user about fixes and improvements and Pi's capabilities.

## Extensions

- New custom extensions go in `agent/extensions/<name>/index.ts`, not `agent/extensions/<name>.ts`.
- Before changing extension dependencies or Pi host-package links, read `agent/extensions/maintenance.md`.

## Human-Facing READMEs

- New extensions/skills must include a directory-local `README.md`; update it when behavior, usage, requirements, commands/tools, examples, or troubleshooting changes.
- Skill READMEs: quickstart cheat sheets with when to use, useful inputs, example prompts, expected output, and links to deeper files. Avoid copying `SKILL.md` except brief summaries that save navigation.
- **Extension READMEs are user guides:** explain what the extension does, how to enable/configure/use it, what users should expect, examples, troubleshooting, practical limitations, and safety warnings.
- **Do not use extension READMEs as implementation or validation reports.** Put internal architecture, lifecycle/event wiring, implementation contracts, test matrices, developer reproduction procedures, and maintenance workflows in durable directory-local maintainer documents. Prefer existing appropriate documents and link to them briefly.
- Include a technical detail in an extension README only when it directly helps users use, configure, understand a limitation, or troubleshoot the extension. Describe the user-visible consequence rather than the internal mechanism where possible.
- Do not add temporary audit/work-package references, session or review narratives, passing-test counts, or ephemeral scratch-artifact paths to READMEs or durable maintainer documents. Preserve unresolved-defect warnings; never present characterization coverage as a guarantee.
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
