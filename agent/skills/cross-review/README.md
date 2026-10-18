# cross-review (prototype)

Has Claude Code and Pi review the same target independently, cross-examine each other's reviews, and converge on one plan, so you don't relay their verdicts by hand. You get a single `final.md`: a consolidated report of the findings, ordered by severity, each with its fix, plus remarks wherever the reviewers left a decision to you. How the reviewers got there is in `details.md`. Once the plan is applied, `verify` has both reviewers check the changes against it.

Use it when you want two independent perspectives on the same target, such as a code or skill review, and an agreed way forward. The skill is shared: Pi loads it from here, and Claude Code through the `~/.claude/skills/cross-review` symlink.

## How a run works

1. **Independent review:** both reviewers get the same brief and review in parallel, without seeing each other.
2. **Cross-examination:** each receives the other's review verbatim, accepts, amends, or rejects each finding, and revisits its own. It then adds any new findings the comparison brings up, numbered after its own (for example A11 or B5).
3. **Unified plan:** one reviewer (the drafter) writes a single numbered plan (U1, U2, ...) of the changes it endorses. The plan also has a **Dispositions** line for every finding, including the new ones, and an **Unresolved** section for disputes. Each Dispositions line uses one of `→ Uk`, `merged into Uk`, `narrowed into Uk`, `withdrawn`, `rejected`, or `disputed`. The other reviewer approves or objects item by item, and the drafter revises.
4. **Stop:** when both sides have no blocking objections left, after the approval-turn cap (default 3), or when a reviewer needs your input. If the approver accepts the plan while the drafter still lists objections, the drafter gets one turn to confirm; objections it keeps end the run as **disputed**.
5. **Final report:** once the plan is settled (converged, disputed, or at the cap), the drafter turns it into the report in `final.md`: findings ordered by severity, each with its location, problem, and fix, then any unresolved disputes. **Remarks** appear only where you have to decide: under a finding when the reviewers disagree about its severity or fix, or proposed different fixes and the better one depends on your preference, and at the end for decisions about the whole report. Caveats and conditions for applying a fix go into the fix itself. The drafter may fold in the approver's last non-blocking amendments that it agrees with, but must not change what the plan does.

A disagreement is **blocking** only if it changes whether something gets changed, what a change does, or whether a Major or Moderate finding is real. Disagreements only about severity, wording preferences, and Minor nits are non-blocking: they never cause another round, and the final report shows them as remarks when they leave you a choice. `details.md` lists them all.

In the conversation, Claude is "Reviewer A" and Pi is "Reviewer B"; neither is told which model the other is. The reports (`final.md`, `details.md`, `verify.md`) call them Claude and Pi; ids keep the letters, so A1 and XA1 are Claude's, B1 and XB1 are Pi's. Reviewers may change a position only for a stated reason. `details.md` lists the position changes reviewers report, so you can spot one side simply giving in. A reviewer can also change its mind without reporting it, so check the plan's Dispositions too. `final.md` warns when they leave out a finding id that a reviewer used for its own findings in its review or cross-examination.

## Requirements

- `claude` and `pi` on `PATH`, both signed in
- Python 3.10 or newer

## Ask an agent

Invoke the skill (`/cross-review` in Claude Code, `/skill:cross-review` in Pi) or ask for a cross-review in plain words. The agent writes a self-contained brief, starts the run in the background, shows you the brief and the [run directory](#what-you-get), and reports `final.md` when the run is done. Claude Code is notified when the run finishes; Pi starts it detached, so ask Pi for the status later.

```text
Cross-review the trim-tests skill with guidance-review. No changes.
```

```text
Have both agents review the uncommitted diff in this repo for correctness and missing tests.
```

```text
Cross-review src/main/java/com/acme/billing for clean-code problems, at most eight findings. Let Pi draft the plan.
```

```text
Cross-review the trim-tests skill with guidance-review. Use Claude Opus at xhigh effort, and Pi with gpt-6.1-sol at high thinking.
```

```text
I applied the plan from the last cross-review. Have both agents verify the uncommitted changes.
```

Useful inputs: the target, the criteria or skill to apply, exclusions, and any option below, such as each agent's model and effort. The agent shows you the brief it sent and the options it passed. It leaves its own earlier findings out of the brief, so the reviews stay independent.

## Run it yourself

Write a brief: the target, the criteria, any skill to use, and exclusions. For example:

```text
Review the trim-tests skill: agent/skills/trim-tests/SKILL.md, its README,
and references/. Use the guidance-review skill. Check for stale, imprecise,
or over-prescriptive guidance. Do not change files.
```

Run it from a terminal (it can take a while, so a separate tab or background job works well):

```bash
python3 ~/.pi/agent/skills/cross-review/scripts/xreview.py review --brief brief.md --cwd ~/.pi --name trim-tests
```

Run both reviewers in the repository that owns the target. For shared skills, that's `~/.pi`, so both cite the same paths. `--brief -` reads the brief from stdin.

Progress goes to stderr and to `progress.log` in the run directory. When the run ends, the path of `final.md` is printed on stdout.

With `--detach`, the command returns at once and the run continues in the background. Check on it with:

```bash
python3 ~/.pi/agent/skills/cross-review/scripts/xreview.py status <run-dir>
```

To stop a run and its reviewers, press Ctrl-C in its terminal, or run:

```bash
python3 ~/.pi/agent/skills/cross-review/scripts/xreview.py cancel <run-dir>
```

`final.md` then shows the run as cancelled.

### Useful options

| Option | Purpose |
| --- | --- |
| `--brief-text "..."` | Pass the brief inline instead of a file |
| `--drafter claude\|pi` | Who writes the unified plan (default: `claude`) |
| `--max-approval-turns N` | Approval-turn cap (default: 3) |
| `--claude-model`, `--claude-effort` | Override your Claude Code defaults |
| `--pi-model`, `--pi-thinking` | Override your Pi defaults |
| `--pi-tools LIST` | Pi tool allowlist (default: `read,grep,find,ls,git_inspect,subagent`) |
| `--claude-arg ARG`, `--pi-arg ARG` | Pass an extra CLI argument through (repeatable) |
| `--turn-timeout SECONDS` | Per-turn limit (default: 3600) |
| `--run-dir DIR` | Output directory (default: `~/.local/state/xreview/runs/<timestamp>-<name>`) |
| `--detach` | Return at once; the run continues in the background |

### What you get

Each run writes to its own directory, `~/.local/state/xreview/runs/<YYYYMMDD-HHMMSS>-<name>/` (under `$XDG_STATE_HOME/xreview/runs/` if that is set), no matter which project you start it from; nothing is written to the reviewed project. `--run-dir` picks another location outside the reviewed repository. To find recent runs: `ls -t ~/.local/state/xreview/runs | head`.

The run directory contains:

- `final.md`, the report to act on:
  - the outcome, the reviewers, the run's start and end times, and its wall time;
  - a warning if the latest plan's Dispositions leave out a finding;
  - the drafter's final report: findings ordered by severity, each with its location, problem, fix, and any remarks; unresolved disputes; and remarks about the whole report. Remarks mark only decisions left to you. If the report turn failed, the latest plan and its suggested amendments take its place;
  - when the run didn't converge, the blocking disagreements as each reviewer stated them;
  - resume commands.
- `details.md`, how the run went:
  - the outcome, the working directory, the drafter, and the run's times;
  - the Dispositions warning, if any;
  - remaining blocking disagreements, with both positions;
  - non-blocking notes that are still current. Superseded notes are listed only by item and turn, with their text left in `turns/`: notes from before the latest plan on a finding it disposes of or on an earlier version of a plan item, and notes on an item whose position a later turn changed;
  - the latest plan, followed by **Suggested amendments not in the plan**: the non-blocking notes from the final approval and from the drafter's confirmation;
  - the approver's last response, reported position changes, and resume commands;
  - a turn table with each turn's time and cost, and totals per reviewer. Claude reports a session's cost so far, so each turn shows the increase. Pi reports no cost.
- `turns/`: every prompt and reply, numbered in order
- `brief.md`, `progress.log`, and `run.json` (outcome, start and end times, each reviewer's session and settings, and the turn log); detached runs also write `stderr.log`
- `verify-1/`, `verify-2/`, ...: one directory per [verify run](#verify-applied-changes)

Exit status: `0` converged, `2` stopped unresolved (cap or dispute), `3` a reviewer needs your input, `1` error or cancelled.

### Continuing afterwards

`final.md` lists a command to resume each reviewer's session, with its full review context. You can resume one to apply the plan, or to answer a question it asked. Claude sessions started this way resume from a terminal with `claude --resume`; they may not appear in the desktop app.

## Verify applied changes

After you or an agent apply the plan, have both reviewers check the result:

```bash
python3 ~/.pi/agent/skills/cross-review/scripts/xreview.py verify <run-dir>
```

`verify` resumes both reviewer sessions in the run's working directory, with the settings the run used. Each reviewer gets the final report, or the latest plan if no report was written, and checks the changes against it, giving every plan item a verdict: `implemented`, `partial`, `deviates`, or `missing`. Each also lists unplanned changes and regressions, numbered per reviewer (`XA1`, ... and `XB1`, ...) so the two lists don't collide. Blocking works as in the review: a difference in what a change does, a missing part of a Major or Moderate item, or an unplanned change or regression that matters as much.

- **Which changes:** by default `git diff HEAD`, the uncommitted changes, plus untracked files. `--diff REF` takes a commit, compared with the working tree, or a range such as `main..topic`. The reviewers run `git diff` themselves; the prompt holds only the diffstat. For changes that aren't in Git, `--patch FILE` (or `-` for stdin) puts a patch of up to 200 KB in the prompt instead.
- **`--cross`** adds one turn in which each reviewer confirms or rejects the other's findings and may revise its verdicts. There is no revision loop: verify reports and never re-plans.
- **Output** goes to `<run-dir>/verify-N/`; `final.md` stays as it was. `verify.md` has a table of both reviewers' verdicts per plan item, the blocking issues, non-blocking notes, both verifications in full, and the turn table with costs. `verify.json` holds the outcome, the verdicts, and the turn log.
- `--detach`, `status`, and `cancel` work as for a review; pass `status` and `cancel` the `verify-N` directory. The model, effort, tool, timeout, and extra-argument options override the run's settings.
- A run that ended without agreement is verified against its latest plan, with a warning in `verify.md`. A run that produced no plan can't be verified.

Exit status: `0` verified, `2` deviations found, `3` a reviewer needs your input, `1` error or cancelled.

## Safety

The reviewers are configured for read-only work, but these controls are guardrails, not a sandbox. Existing Claude permission grants may allow additional Bash commands.

- **Claude** gets only the Read, Grep, Glob, Bash, and Skill tools, with no MCP servers and no subagents. It runs with `--permission-mode dontAsk`, so anything not pre-approved is denied. The launcher pre-approves read-only Git commands and denies Git's `--output` option, which writes a file. It reapplies these settings when it resumes a session.
- **Skills:** Claude can load your installed skills, so a brief can name one to apply. A skill adds instructions, not tools, but a skill that declares `allowed-tools` in its frontmatter can pre-approve commands while it runs, so check any skill you name. To stop Claude from loading a skill, deny it with `--claude-arg=--settings --claude-arg='{"permissions":{"deny":["Skill(<name>)"]}}'`. Claude still sees the skill's name and description in its skill list. Pi lists your installed skills too; `--pi-arg=--no-skills` plus `--pi-arg=--skill --pi-arg=<path>` limits it to the skills you name.
- **Pi** gets a read-only tool allowlist. Pi's permissions extension does not guard writes inside the working directory, so the allowlist is what keeps Pi read-only. Don't add `bash`, `edit`, or `write` to `--pi-tools`.
- **Pi delegation** is limited to agents whose tools are all read-only, such as `scout` and `reviewer`. Write-capable agents such as `worker` are blocked, even with the subagent policy in `auto` mode. This uses the subagent extension's [launcher restriction](../../extensions/subagent/README.md#restrict-delegation-from-a-launcher).
- `--claude-arg` and `--pi-arg` can loosen these restrictions; use them with care.
- The run directory must be outside `--cwd`, so reviewers don't read the transcript.

## Limitations

- Two models agreeing is not verification. Shared blind spots survive, so check the plan before acting on it.
- The Dispositions check counts a reviewer's finding ids only where they start a line, as headings, list items, and table rows do. It misses a finding a reviewer never numbered or numbered only mid-sentence.
- The drafter writes the final report alone, after the approval. `details.md` keeps the approved plan; compare the two if a fix in the report looks different from what you expected.
- Each turn at high thinking levels can take many minutes; a full run is up to about a dozen agent turns.
- Pi compaction is disabled in this setup, so a very large target, a long debate, or a verify run on top of a long session can run out of context.
- A reviewer's question (`needs_human`) stops the run. Answer it by resuming that session. There is no resume for the run itself yet.
- Cancelling stops the reviewers, but force-killing xreview itself (`kill -9`) leaves its reviewer processes running.
- If a reviewer applied the plan in its own session, `verify` has it check its own work. The prompt asks it to say so first.

## Troubleshooting

- **`protocol_error`:** a reviewer didn't end its reply with a valid status block, even after one retry. See its reply in `turns/`.
- **`disputed`:** the approver accepted the plan, but the drafter kept objections to it. Both positions are in `final.md`; you decide.
- **`deviations`** (verify): at least one reviewer found a blocking difference between the changes and the plan. `verify.md` lists each reviewer's position.
- **`error`:** an agent CLI call failed or timed out; `final.md` has the message. When one reviewer fails during a parallel phase, the other is stopped too. Check that the CLI works on its own (`claude -p "hi"`, `pi -p "hi"`).
- **`status` says the run stopped early:** the script itself failed. See `stderr.log` (detached runs) or the command's output.
- **Reviewer can't read files:** make sure `--cwd` is the repository that contains the target, and that the brief's paths are relative to it.
