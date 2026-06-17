## Subagents

- Within current subagent policy, delegate non-trivial splittable inspection/review/analysis for parallelism and context hygiene; skip simple or high-overhead cases.
- Use parallel read-only `scout`/`reviewer-readonly`/`planner-readonly` for independent angles; chain dependent flows. Use write-capable agents only when explicit/approved.
- Keep child prompts narrow; require path/line evidence; synthesize one deduped final answer.
