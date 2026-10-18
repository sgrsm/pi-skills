---
name: cross-review
description: Launches an automated cross-review in which Claude Code and Pi independently review the same target, cross-examine each other, and converge on one plan, then reports the result. Use only when the user explicitly asks for a cross-review, for both agents to review something, for a second opinion from the other agent, or for both agents to verify an applied cross-review plan. Not for an ordinary single-agent review.
---

# cross-review

`scripts/xreview.py` runs two fresh reviewer sessions, Claude Code and Pi. They review the target in parallel, cross-examine each other's reviews, and converge on one plan, writing `final.md` to a run directory. A run makes up to about a dozen agent turns, each of which can take many minutes. You launch the run and report on it; you are not one of the reviewers.

## Write the brief

The reviewers see only the brief, not this conversation, so make it self-contained:

- **Target:** files, directories, or a diff, with paths relative to the working directory.
- **Criteria:** what to check, and any skill the user wants the reviewers to apply.
- **Constraints** the user stated, such as exclusions or a limit on findings.

Keep the brief neutral. Leave out your own findings and any earlier review from this conversation; otherwise the reviews are no longer independent. If the target or the criteria are unclear, ask the user before launching.

## Launch

Set `--cwd` to the repository that owns the target, so both reviewers cite the same paths. Resolve symlinks first: for a skill under `~/.claude/skills/` that links into `~/.pi/agent/skills/`, use `~/.pi`.

Run the script by its absolute path in this skill's directory, passing the brief on stdin:

```bash
python3 <skill-dir>/scripts/xreview.py review --cwd <repo> --name <short-name> --brief - <<'BRIEF'
<brief>
BRIEF
```

- If your shell tool can run a command in the background and notify you when it finishes, run it that way.
- Otherwise add `--detach`. The command returns at once and prints the run directory. When the user asks how the run is going, run `python3 <skill-dir>/scripts/xreview.py status <run-dir>`.

Add `--drafter`, `--max-approval-turns`, `--claude-model`, `--claude-effort`, `--pi-model`, or `--pi-thinking` only when the user asks for them; `review --help` lists all options. After launching, show the user the brief you sent, the options you passed, and the run directory. If the user asks to stop the run, run `python3 <skill-dir>/scripts/xreview.py cancel <run-dir>`.

## Report the result

When the run has finished, read `<run-dir>/final.md`. It has the outcome and the drafter's consolidated report: findings ordered by severity, each with its fix, then unresolved disagreements. Remarks, under a finding or at the end, mark only decisions left to the user: the reviewers disagree, or offered different fixes whose choice is a matter of preference. Report:

- the outcome: converged, disputed, approval cap, a reviewer's question, cancelled, or an error;
- the findings, most severe first, condensed without changing their meaning, each with its remarks;
- remaining blocking disagreements, with both positions;
- any warning, such as findings missing from the plan's Dispositions or a report that couldn't be written;
- the resume commands, if the user may want to continue a reviewer's session.

`details.md` has the reviewers' exchange, notes, position changes, and turns; read it only when `final.md` leaves a question open.

Present the reviewers' positions as theirs, and label any view of your own as yours. If a reviewer asked a question, relay it: the user answers by resuming that reviewer's session. Don't act on the plan unless the user asks.

## Verify applied changes

When the user has applied a cross-review plan and asks both agents to check the changes, run `python3 <skill-dir>/scripts/xreview.py verify <run-dir>`, where `<run-dir>` is that review's run directory. By default it checks the uncommitted changes; pass `--diff <commit-or-range>` for committed ones, or `--patch <file>` for changes outside Git. Launch it the same way as a review, then use the `verify-N` directory it prints with `status` and `cancel`. When it finishes, read `verify.md` and report the outcome, the verdict for each plan item, blocking issues with each reviewer's position, unplanned changes, and any warning.
