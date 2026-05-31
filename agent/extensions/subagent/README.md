# Subagent extension

Adds multi-agent delegation to Pi via a `subagent` tool.

## What it does

- Spawns isolated child `pi` processes as sub-agents
- Supports single, parallel, and chained delegation modes
- Streams progress/results back to the parent agent
- Lets delegated child sessions escalate user questions or broader approval needs back to the parent agent
- Lets the main agent act as orchestrator and merge sub-agent outputs

## Policy modes

The extension supports 4 global modes, configured with `/subagents`:

- `off` - disable subagents completely
- `manual` - only explicit user requests may use subagents
- `ask` - explicit requests run immediately; otherwise Pi asks before spawning subagents (`Allow once` / `Allow for current session` / `Deny`)
- `auto` - Pi may autonomously use read-only multi-agent fan-out within guardrails

Default:

- `ask`

Examples:

- `/subagents` - show current mode and effective limits
- `/subagents ui` - open interactive mode/limit config in the terminal UI
- `/subagents off`
- `/subagents manual`
- `/subagents ask`
- `/subagents auto`
- `/subagents concurrency 8`
- `/subagents concurrency default`
- `/subagents max-tasks 16`
- `/subagents max-tasks default`
- `/subagents reset-limits`
- `/subagents cancel-session-approval`

## Parallel limits

Effective parallel execution limits now come from merged Pi settings under the custom `subagents` block:

```json
{
  "subagents": {
    "maxConcurrency": 8,
    "maxParallelTasks": 16
  }
}
```

Where:

- `maxConcurrency` = how many subagent processes may run at the same time
- `maxParallelTasks` = how many tasks a single parallel `subagent` call may request

Settings are read from the normal Pi locations:

- global: `~/.pi/agent/settings.json`
- project override: `.pi/settings.json`

Notes:

- `/subagents ui`, `/subagents concurrency ...`, and `/subagents max-tasks ...` save global defaults to `~/.pi/agent/settings.json`
- project `.pi/settings.json` values still override the effective limits for that project

Guardrails:

- ordinary PR reviews and small tasks should be handled directly unless the user explicitly asks for multi-agent work
- non-explicit auto mode is capped at 3 agents
- write-capable agents are not auto-approved without an explicit user request
- project-local agents require confirmation by default
- delegated child sessions inherit only read-only nested delegation approval by default
- delegated child sessions can use `escalate_to_parent` to ask the parent agent to obtain clarification or broader approval

## Built-in agents

Global agent prompts live in `~/.pi/agent/agents/`:

- `scout` - fast codebase discovery
- `planner` - implementation planning, with optional Markdown plan output
- `reviewer` - review / correctness / security analysis, with optional Markdown report output, subagent delegation, and parent escalation
- `worker` - general-purpose implementation and analysis

You can also add project-local agents in `.pi/agents/` inside a repo and opt into them with `agentScope: "both"`.

## Example prompts

- `Spawn 3 sub-agents to investigate auth, caching, and tests, then merge the results into one report.`
- `Use sub-agents to review this refactor from three angles: correctness, performance, and maintainability.`
- `Have a reviewer write its findings to reports/review.md.`
- `Have a planner save the implementation plan to docs/implementation-plan.md.`
- `Ask a reviewer to fan out into focused subreviews, then merge them into one report.`
- `If a delegated reviewer needs a user decision, have it escalate the question back to the parent agent.`
- `Delegate discovery to a scout, then create a plan, then have a worker implement it.`

## Notes

- In `ask` mode, choosing `Allow for current session` auto-approves later non-explicit subagent requests for the rest of that session, until you run `/subagents cancel-session-approval`.
- The parent agent remains the orchestrator. It is expected to review sub-agent outputs, de-duplicate them, and present a single final answer to the user.
- Nested clarification and approval do not bubble to the user automatically. Delegated children should use `escalate_to_parent`, and the parent agent should ask the user at the top level before continuing.
- When `escalate_to_parent` uses `requestType: "clarify"`, Pi prefers the top-level interactive clarify UI when it is available; otherwise the parent still surfaces the request in text.
- `escalate_to_parent` is only active inside delegated child sessions, not in the top-level assistant session.
- Broader nested delegation beyond the inherited read-only scope should be approved or handled by the parent agent explicitly.
