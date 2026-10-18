# guidance-review quickstart

Use this skill to review or improve a small agent-facing guidance file, such as `AGENTS.md`, `CLAUDE.md`, an individual `SKILL.md`, or a small related set of instructions. It balances coherence, precision, structure, and economy rather than trying to produce the shortest possible text.

## Useful inputs

For a standard review, provide only the target file or text. The skill supplies the review criteria and defaults to read-only suggestions; you do not need to repeat its instructions.

Add instructions only to authorize edits or supply task-specific priorities, constraints, or context, such as the intended agent or instruction layer when it affects interpretation.

## Example prompts

Default review:

```text
/skill:guidance-review AGENTS.md
```

Apply behavior-preserving improvements:

```text
/skill:guidance-review AGENTS.md. Apply behavior-preserving improvements.
```

Add a task-specific constraint:

```text
/skill:guidance-review AGENTS.md. Focus on clarification rules; leave the Git section unchanged.
```

## What to expect

A few important observations and concrete wording, or a brief summary of applied edits. Actual defects are distinguished from optional style preferences. If the text is already clear enough, the skill can recommend leaving it unchanged.

Reviews are read-only unless you explicitly authorize edits. Contradictions are not silently resolved by choosing a policy, and proposed behavior changes require approval unless that specific change is already authorized.

This is not a repository-wide prompt audit. It does not require severity ratings, token counts, or a formal report. Flexible wording is not automatically a defect, and shorter text is not automatically better.

## Use in Pi

Run `/reload` after installing or changing the skill, then invoke `/skill:guidance-review` with your request. If the command is unavailable, check that this directory is in a discovered skills location and inspect startup diagnostics.

## Use in Claude Code

Invoke `/guidance-review` with your request; the examples above use Pi's `/skill:` prefix, which Claude Code does not use. The skill is shared by symlinking this directory into `~/.claude/skills/`. If the command is unavailable, start a new session.

See [SKILL.md](SKILL.md) for the review guidance.
