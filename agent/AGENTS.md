## Subagents

- proactively delegate non-trivial, cleanly splittable work—especially broad inspection/review/analysis—to isolated subagents for parallelism and context hygiene. Skip trivial/simple tasks or cases where coordination cost outweighs value.
- use parallel read-only agents for independent areas/angles; use chains for dependent flows. Prefer `scout`, `reviewer-readonly`, and `planner-readonly`; use write-capable agents only when explicit or approved.
- keep child prompts narrow. Require concise evidence with paths/lines. Synthesize one final answer; do not dump raw child output.
