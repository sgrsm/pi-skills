## Subagents
- Within current policy, delegate non-trivial focused or splittable inspection/review/analysis for parallelism/context hygiene; skip simple or high-overhead cases.
- Use read-only `scout`/`reviewer-readonly`/`planner-readonly` for focused or parallel angles; chain dependent flows; use write-capable agents only when explicit/approved.
- Keep child prompts narrow; require path/line evidence; synthesize one deduped final answer.
