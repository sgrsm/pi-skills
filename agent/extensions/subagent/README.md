# Subagent extension

Adds multi-agent delegation to Pi through the `subagent` tool. A delegated child runs in its own `pi` process with an isolated context window.

## What it does

- Runs named agent prompts from `~/.pi/agent/agents` and, when opted in, project-local `.pi/agents`.
- Supports one child, parallel children, or a sequential chain that passes prior output with `{previous}`.
- Streams partial child results back to the parent and tracks nested subagent activity.
- Applies policy, depth, trust, and concurrency guardrails before spawning children.
- Lets delegated children use `escalate_to_parent` to hand user decisions back to the parent session.

Use subagents for explicit delegation requests or large work that can be split cleanly. Avoid them for ordinary PR reviews, small diffs, or simple tasks unless the user asks for multi-agent work.

## Slash command

`/subagents` shows the current mode, effective limits, depth, and configured defaults.

Examples:

```text
/subagents
/subagents show
/subagents help
/subagents ui
/subagents off
/subagents manual
/subagents ask
/subagents auto
/subagents concurrency 8
/subagents concurrency default
/subagents max-tasks 16
/subagents max-tasks default
/subagents reset-limits
/subagents cancel-session-approval
```

Behavior:

- `ui` opens a TUI settings screen for mode, max concurrency, and max parallel tasks. It is available only in TUI mode.
- `off|manual|ask|auto` saves the global policy mode to `~/.pi/agent/subagent-policy.json`.
- `concurrency` and `max-tasks` save global defaults to `~/.pi/agent/settings.json`.
- `reset-limits` removes the global `maxConcurrency` and `maxParallelTasks` overrides.
- `cancel-session-approval` clears the current-session approval created by `ask` mode's `Allow for current session` choice.

Argument completion is provided for the command names and common limit values.

## Tool: `subagent`

The tool accepts exactly one execution mode:

- Single: `{ "agent": "scout", "task": "Map the auth package" }`
- Parallel: `{ "tasks": [{ "agent": "scout", "task": "Inspect auth" }, { "agent": "reviewer-readonly", "task": "Review tests" }] }`
- Chain: `{ "chain": [{ "agent": "scout", "task": "Gather context" }, { "agent": "planner", "task": "Plan from this context: {previous}" }] }`

Common parameters:

- `agent` / `task` - target agent name and delegated instructions.
- `tasks` - array of independent parallel tasks.
- `chain` - array of sequential steps; `{previous}` is replaced with the previous step's final output.
- `cwd` - optional working directory for a child process, resolved relative to the parent `cwd`.
- `model` - optional per-child model override using the same values as `pi --model`.
- `thinking` - optional `off`, `minimal`, `low`, `medium`, `high`, or `xhigh` override.
- `agentScope` - `user` by default; use `project` or `both` to load project-local agents.
- `confirmProjectAgents` - defaults to `true`; prompts before running repo-controlled project agents.

Common built-in agent names are `scout`, `planner`, `planner-readonly`, `reviewer`, `reviewer-readonly`, `worker`, and `consolidator`. Agents are Markdown files with frontmatter such as `name`, `description`, optional `tools`, `model`, and `thinking`. If an agent has a `tools` list, the child process is started with that tool set.

Unknown agent names are blocked by policy before approval prompts or execution; approval cannot make a missing or misspelled agent valid.

Project-local agents require a trusted project when `agentScope` is `project` or `both`; `confirmProjectAgents: false` only skips the extra confirmation after trust is established. If a non-explicit project-local request already asks for policy approval, that approval includes the project-agent source/warning and the duplicate project-local confirmation is skipped for that tool call only. Explicit project-local requests still use the normal project-local confirmation path.

## Tool: `escalate_to_parent`

`escalate_to_parent` is active only inside delegated child sessions. Top-level calls are blocked.

Parameters:

- `requestType` - `clarify` by default, or `approval`.
- `question` - required question for the parent to ask.
- `options` - optional focused choices with optional descriptions.
- `allowCustom` - defaults to `true`.
- `customPrompt` - optional prefilled custom-answer text.
- `reason` - optional context for why the child is blocked.

After a child calls this tool, it should stop. The parent receives an escalation summary and, for `clarify` requests with a TUI available, Pi can ask the top-level user through the interactive clarify UI. The parent then decides whether to rerun the child or handle the follow-up directly.

## Settings and policy

Execution settings live under the `subagents` key:

```json
{
  "subagents": {
    "maxParallelTasks": 8,
    "maxConcurrency": 5,
    "maxDelegationDepth": null,
    "inheritedApprovalScopes": {
      "scout": "read-only"
    },
    "agentDefaults": {
      "scout": {
        "model": "anthropic/claude-haiku-4-5",
        "thinking": "off"
      }
    }
  }
}
```

Sources:

- Global settings: `~/.pi/agent/settings.json`
- Trusted project override: `.pi/settings.json`

Project settings are ignored unless the project is trusted. Project values override global values; `maxConcurrency` is also clipped to `maxParallelTasks`. Hard caps are 64 parallel tasks per call and 32 concurrent child processes.

Keys:

- `maxParallelTasks` - maximum length of a `tasks` array; default `8`.
- `maxConcurrency` - maximum child processes running at once; default `5`.
- `maxDelegationDepth` - `null` means unlimited; `0` blocks new subagents; `2` means `root -> first -> second`, and the second-level child cannot delegate again.
- `inheritedApprovalScopes.<agent>` - nested delegation approval passed to that child: `none`, `read-only`, or `all`.
- `agentDefaults.<agent>` - default child `model` and/or `thinking`; a string value is treated as a model shorthand.

The command/UI currently edit only mode, `maxConcurrency`, and `maxParallelTasks`; edit `maxDelegationDepth`, `inheritedApprovalScopes`, and `agentDefaults` by hand.

Model/thinking selection precedence is:

1. tool-call `model` / `thinking`
2. `subagents.agentDefaults.<agent>`
3. agent frontmatter defaults
4. the workflow-start model/thinking lock

Each top-level `subagent` call snapshots the parent session's current model and thinking level. Per-child overrides affect that child invocation, but do not change the workflow lock inherited by deeper descendants.

Policy modes:

- `off` - disables the `subagent` tool.
- `manual` - uses the same delegation eligibility as `auto`, but top-level use requires an explicit subagent/delegation request; non-explicit calls are blocked instead of prompting.
- `ask` - default. Uses the same delegation eligibility as `auto`, but valid explicit requests run immediately while non-explicit requests prompt in the TUI with `Allow once`, `Allow for current session`, or `Deny`; current-session approval lets eligible non-explicit calls run. Without UI, non-explicit requests are blocked.
- `auto` - may auto-approve eligible non-explicit read-only multi-agent work within configured task/concurrency limits; write-capable and project-local agents require approval unless explicitly requested; unknown agent names are blocked.

Delegated sessions can also inherit `read-only` or `all` nested approval from their parent; `manual`, `ask`, and `auto` all pass read-only nested delegation approval to allowed child calls by default, and `off` mode and depth caps still win.

Shared delegation guardrails for `manual`, `ask`, and `auto`:

- use subagents for clearly decomposable, mostly read-only, multi-surface work;
- single-agent non-explicit delegation is not auto-approved;
- parallel/chain task count is governed by configured `maxParallelTasks` and `maxConcurrency`; there is no separate auto-mode agent cap;
- ordinary PR reviews are not auto-delegated;
- write-capable and project-local agents require explicit request/approval, or are blocked without UI; unknown agent names are always blocked.

`ask` prompts before non-explicit calls unless current-session approval applies and auto-equivalent eligibility passes; `manual` blocks non-explicit top-level calls. `Allow for current session` does not disable future project-local confirmations; a project-local skip only applies to the same tool call whose policy approval included the project-agent warning.

A `read-only` inherited approval scope allows only known user-scoped agents whose declared tools do not include `edit` or `write`; agents without a tool list are treated as write-capable.

## Examples

Parallel investigation:

```json
{
  "tasks": [
    { "agent": "scout", "task": "Map auth entry points" },
    { "agent": "scout", "task": "Map caching and persistence" },
    { "agent": "reviewer-readonly", "task": "Look for risky test gaps" }
  ]
}
```

Sequential handoff:

```json
{
  "chain": [
    { "agent": "scout", "task": "Inspect the billing module" },
    { "agent": "planner", "task": "Create a concise plan from: {previous}" },
    { "agent": "worker", "task": "Implement the plan: {previous}", "thinking": "high" }
  ]
}
```

Project-local agent:

```json
{
  "agent": "repo-reviewer",
  "task": "Review the local migration guide",
  "agentScope": "both"
}
```

Child escalation:

```json
{
  "requestType": "clarify",
  "question": "Which compatibility path should I assume?",
  "options": [
    { "label": "Keep legacy behavior" },
    { "label": "Use the new behavior" }
  ],
  "reason": "The delegated review depends on product direction."
}
```

## Events and hooks

The extension registers these Pi events:

- `session_start` - reloads policy, clears runtime activity, enables child-only escalation when applicable, and refreshes active tools/status.
- `session_tree` - resyncs active tools and status when navigating session branches.
- `before_agent_start` - appends current subagent policy, limits, depth, and escalation guidance to the agent prompt.
- `tool_call` - enforces policy, depth, project trust, and child-only escalation rules before execution.
- `tool_execution_update` - updates nested runtime activity from streaming child results.
- `tool_execution_end` - clears per-call approval and activity tracking.

No custom CLI flags or keyboard shortcuts are registered.

## Visual and status indicators

The footer indicator uses the shared local-extension footer status helper at `../shared/footerStatus.ts` (`agent/extensions/shared/footerStatus.ts`) for its stable status key/order and to clear legacy footer keys.

TUI footer status examples:

```text
subagents: ask •
subagents: ask (session-approved) •
subagents: manual •
subagents: auto • r:2|q:3 •
subagents: auto • r:2→3|q:2→4 •
subagents: off •
```

Footer state rules:

- In non-TUI contexts, no footer indicator is rendered.
- Idle TUI sessions show `subagents: <mode> •`, where `<mode>` is `off`, `manual`, `ask`, or `auto`.
- Ask mode with current-session approval shows `subagents: ask (session-approved) •`.
- While subagent work is in flight, a runtime activity segment is inserted before the trailing `•`: `r:<counts>` for running children, `q:<counts>` for queued children, or both as `r:<counts>|q:<counts>`.
- Counts are grouped by delegation depth with `→`; the first number is direct children and later numbers are nested generations. Interior zeroes may appear when deeper generations are active, and trailing zeroes are omitted.
- When no running or queued tasks remain, the runtime activity segment is omitted.

Tool display:

- Calls show `subagent <agent> [scope]`, `subagent parallel (<n> tasks) [scope]`, or `subagent chain (<n> steps) [scope]` with short task previews.
- Results include an activity tree with statuses such as `[running]`, `[done]`, `[failed]`, and `[waiting on parent/user]`.
- Icons summarize outcome: `✓` success, `✗` failure, `⏳` running, and `◐` mixed parallel results.
- Collapsed results show recent output and tool calls; `Ctrl+O` expands full task/output details where available.
- Very large visible outputs are truncated using Pi's standard limits, with the full output saved to a temporary file and linked in the truncation marker.
