## Subagents
- Within current policy, delegate non-trivial focused or splittable inspection/review/analysis for parallelism/context hygiene; skip simple or high-overhead cases.
- Use read-only `scout`/`reviewer-readonly`/`planner-readonly` for focused or parallel angles; chain dependent flows; use write-capable agents only when explicit/approved.
- Keep child prompts narrow; require path/line evidence; synthesize one deduped final answer.

## Git
- Never perform destructive or history-altering Git operations: do not rewrite/delete existing history or refs, or discard working-tree, index, or stash data. This includes amend, rebase, reset, history-filtering tools, direct ref/tag changes, force/mirror pushes, clean, restore, and stash drop/clear. Commit atop `HEAD` only on explicit request; push only when asked. For tests requiring branch/history changes, use a temporary agent-owned branch.

## Shell
- In agent/non-interactive shells, run SDKMAN commands as `source "$HOME/.sdkman/bin/sdkman-init.sh" && sdk ...`.
