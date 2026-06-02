# Subagent extension

Adds multi-agent delegation to Pi via a `subagent` tool.

## What it does

- Spawns isolated child `pi` processes as sub-agents
- Supports single, parallel, and chained delegation modes
- Locks each delegated workflow to the parent session's current model/thinking unless explicitly overridden
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
    "maxParallelTasks": 16,
    "maxDelegationDepth": 2,
    "inheritedApprovalScopes": {
      "consolidator": "read-only",
      "planner": "read-only",
      "planner-readonly": "read-only",
      "reviewer": "read-only",
      "reviewer-readonly": "read-only",
      "scout": "read-only",
      "worker": "read-only"
    }
  }
}
```

Where:

- `maxConcurrency` = how many subagent processes may run at the same time
- `maxParallelTasks` = how many tasks a single parallel `subagent` call may request
- `maxDelegationDepth` = max delegated child depth below the root session; `2` means `root -> first -> second`
- `inheritedApprovalScopes.<agent>` = override the nested delegation scope inherited by that child agent (`none`, `read-only`, or `all`)

Settings are read from the normal Pi locations:

- global: `~/.pi/agent/settings.json`
- project override: `.pi/settings.json`

Notes:

- `/subagents ui`, `/subagents concurrency ...`, and `/subagents max-tasks ...` save global defaults to `~/.pi/agent/settings.json`
- `subagents.maxDelegationDepth`, `subagents.inheritedApprovalScopes`, and `subagents.agentDefaults` are currently edited manually in settings.json
- project `.pi/settings.json` values still override the effective subagent settings for that project

Guardrails:

- ordinary PR reviews and small tasks should be handled directly unless the user explicitly asks for multi-agent work
- non-explicit auto mode is capped at 3 agents
- write-capable agents are not auto-approved without an explicit user request
- project-local agents require confirmation by default
- delegated child sessions inherit only read-only nested delegation approval by default, unless `subagents.inheritedApprovalScopes` overrides a child agent's scope
- delegated child sessions can be capped with `subagents.maxDelegationDepth`; for example, `2` allows `root -> first -> second` and blocks a third nested generation
- delegated child sessions can use `escalate_to_parent` to ask the parent agent to obtain clarification or broader approval

## Model selection

Each top-level `subagent` tool call snapshots the parent session's current model and thinking level, then passes that lock to every child `pi` process in the delegated workflow. This prevents unrelated `/model` changes in other sessions from changing models mid-workflow.

Per-subagent selection precedence:

1. task-level `model` / `thinking` override
2. settings.json `subagents.agentDefaults.<agent>.{model,thinking}`
3. agent frontmatter `model` / `thinking` default
4. inherited workflow-start model / thinking lock

Supported override fields:

- single mode: `{ agent, task, model?, thinking?, cwd? }`
- parallel mode: `tasks: [{ agent, task, model?, thinking?, cwd? }, ...]`
- chain mode: `chain: [{ agent, task, model?, thinking?, cwd? }, ...]`

Notes:

- `model` accepts the same values as `pi --model`, such as `anthropic/claude-sonnet-4-5` or a model alias/pattern.
- `thinking` accepts `off`, `minimal`, `low`, `medium`, `high`, or `xhigh`.
- If you override only `thinking`, the subagent keeps its inherited or agent-default model.
- If you override only `model`, the subagent still inherits/defaults its thinking level via the precedence above.
- Settings-based agent defaults override agent frontmatter, so you can change persistent defaults without editing the agent prompt files.
- Task or agent overrides affect that delegated child invocation. Descendants without their own override still inherit the workflow-start lock.

Example settings:

```json
{
  "subagents": {
    "agentDefaults": {
      "scout": {
        "model": "anthropic/claude-haiku-4-5",
        "thinking": "off"
      },
      "planner": {
        "model": "anthropic/claude-sonnet-4-5",
        "thinking": "high"
      },
      "worker": {
        "model": "anthropic/claude-sonnet-4-5",
        "thinking": "high"
      }
    }
  }
}
```

Examples:

- Single: `{ "agent": "scout", "task": "Map the auth code", "model": "anthropic/claude-haiku-4-5", "thinking": "off" }`
- Parallel task: `{ "agent": "planner", "task": "Create a plan", "model": "anthropic/claude-sonnet-4-5", "thinking": "high" }`
- Chain step: `{ "agent": "worker", "task": "Implement {previous}", "model": "anthropic/claude-sonnet-4-5", "thinking": "high" }`

## Built-in agents

Global agent prompts live in `~/.pi/agent/agents/`:

- `scout` - fast codebase discovery, with optional read-only helper delegation when depth allows
- `planner` - implementation planning, with optional Markdown plan output and read-only helper delegation
- `planner-readonly` - read-only planning and decomposition
- `reviewer` - review / correctness / security analysis, with optional Markdown report output, read-only helper delegation, and parent escalation
- `reviewer-readonly` - read-only review specialist for nested analysis
- `worker` - general-purpose implementation and analysis, with read-only nested delegation
- `consolidator` - synthesis/final report writing, with optional read-only helper delegation

You can also add project-local agents in `.pi/agents/` inside a repo and opt into them with `agentScope: "both"`.

Agent frontmatter can also set defaults for that named agent:

```markdown
---
name: scout
description: Fast recon
tools: read, grep, find, ls
model: anthropic/claude-haiku-4-5
thinking: off
---
```

## Example prompts

- `Spawn 3 sub-agents to investigate auth, caching, and tests, then merge the results into one report.`
- `Use sub-agents to review this refactor from three angles: correctness, performance, and maintainability.`
- `Have a reviewer write its findings to reports/review.md.`
- `Have a planner save the implementation plan to docs/implementation-plan.md.`
- `Ask a reviewer to fan out into focused subreviews, then merge them into one report.`
- `If a delegated reviewer needs a user decision, have it escalate the question back to the parent agent.`
- `Delegate discovery to a scout, then create a plan, then have a worker implement it.`
- `Use a top-level scout to map this package, and let it delegate once to scout or planner-readonly for focused read-only follow-up if needed.`
- `Use planner-readonly as the top-level agent for a read-only implementation plan, and let it delegate once to scout for discovery or reviewer-readonly for validation.`
- `Have reviewer write reports/review.md, but keep any delegated children read-only: scout, planner-readonly, or reviewer-readonly.`

## Notes

- In `ask` mode, choosing `Allow for current session` auto-approves later non-explicit subagent requests for the rest of that session, until you run `/subagents cancel-session-approval`.
- The parent agent remains the orchestrator. It is expected to review sub-agent outputs, de-duplicate them, and present a single final answer to the user.
- Nested clarification and approval do not bubble to the user automatically. Delegated children should use `escalate_to_parent`, and the parent agent should ask the user at the top level before continuing.
- When `escalate_to_parent` uses `requestType: "clarify"`, Pi prefers the top-level interactive clarify UI when it is available; otherwise the parent still surfaces the request in text.
- `escalate_to_parent` is only active inside delegated child sessions, not in the top-level assistant session.
- Broader nested delegation beyond the inherited read-only scope should be approved or handled by the parent agent explicitly, unless you intentionally configured a broader child scope via `subagents.inheritedApprovalScopes`.
- With `maxDelegationDepth = 2`, read-only top-level subagents such as `scout`, `planner-readonly`, or `reviewer-readonly` may still delegate once, but their children are leaves.
