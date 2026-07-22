# Subagent extension

Adds multi-agent delegation to Pi through the `subagent` tool. Each delegated child runs in its own `pi` process with an isolated context window.

Use subagents for explicit delegation requests or non-trivial work that benefits from focused investigation or clean decomposition. Avoid them for small tasks and ordinary reviews unless the user asks for delegation.

## Requirements

- macOS is the primary host platform.
- Linux is supported on a best-effort basis.
- Windows is unsupported.
- Agent definitions must exist in the user agent directory (`~/.pi/agent/agents` by default) or an enabled project agent directory (`.pi/agents` by default).

## Quick start

Single agent:

```json
{ "agent": "scout", "task": "Map the authentication package" }
```

Parallel investigation:

```json
{
  "tasks": [
    { "agent": "scout", "task": "Inspect authentication" },
    { "agent": "reviewer-readonly", "task": "Review authentication tests" }
  ]
}
```

Sequential handoff:

```json
{
  "chain": [
    { "agent": "scout", "task": "Inspect the billing module" },
    { "agent": "planner", "task": "Plan improvements from: {previous}" }
  ]
}
```

## `/subagents` command

`/subagents` shows the current policy mode, limits, delegation depth, and configured defaults.

Common commands:

```text
/subagents ui
/subagents off|manual|ask|auto
/subagents concurrency 8
/subagents max-tasks 16
/subagents reset-limits
/subagents cancel-session-approval
```

- `ui` edits mode and limits in TUI mode.
- `concurrency default` and `max-tasks default` restore the corresponding defaults.
- `reset-limits` removes both saved limit overrides.
- `cancel-session-approval` clears approvals granted with `Allow for current session`.

Mode is saved in `~/.pi/agent/subagent-policy.json` by default. Limits are saved under `subagents` in `~/.pi/agent/settings.json`.

## `subagent` tool

A call must use exactly one mode:

- `agent` and `task` for one child.
- `tasks` for independent parallel children.
- `chain` for sequential steps. `{previous}` is replaced with the preceding step's final output.

Optional fields:

- `cwd` - child working directory, resolved relative to the parent working directory.
- `model` - per-child model override using the same values as `pi --model`.
- `thinking` - `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`.
- `agentScope` - `user` (default), `project`, or `both`.
- `confirmProjectAgents` - whether to confirm before running project-controlled agents; defaults to `true`.

Common built-in agent names are `scout`, `planner`, `planner-readonly`, `reviewer`, `reviewer-readonly`, `worker`, and `consolidator`. Unknown names are blocked before approval or execution.

## Agents and project trust

Agents are Markdown files with frontmatter such as `name`, `description`, `tools`, `model`, and `thinking`. A declared `tools` list controls the tools available to that child.

User agents are loaded by default. Project agents require `agentScope: "project"` or `"both"`, a trusted project, and usually confirmation. `confirmProjectAgents: false` skips only the extra agent-source confirmation; it does not bypass trust or policy checks.

## Child escalation

Delegated children can call `escalate_to_parent` when they need a user decision. Top-level sessions cannot use this tool.

The request includes a required `question` and can set `requestType` (`clarify` or `approval`), focused `options`, custom-answer controls, and a `reason`. After escalating, the child should stop; the parent decides whether to ask the user, rerun the child, or continue directly.

## Settings

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

Global settings live in `~/.pi/agent/settings.json` by default; trusted projects can override them in `.pi/settings.json`. Untrusted project settings are ignored. `maxConcurrency` is clipped to `maxParallelTasks`; hard caps are 32 concurrent children and 64 parallel tasks per call.

`maxDelegationDepth: null` means unlimited. `0` blocks delegation. An inherited approval scope is `none`, `read-only`, or `all`; agents without a declared tool list are treated as write-capable.

Model and thinking selection use this order:

1. tool-call override;
2. `agentDefaults`;
3. agent frontmatter;
4. workflow-start model and thinking settings.

## Policy modes

- `off` - disables delegation.
- `manual` - allows only explicit top-level delegation requests.
- `ask` - default; explicit valid requests run, while other eligible requests require TUI approval.
- `auto` - may automatically run eligible read-only work.

Depth and task limits always apply. Unknown agents are blocked. Write-capable and project-local agents require an explicit request or approval. Inherited read-only approval applies only to known user agents whose declared tools exclude `edit` and `write`. Session approval does not permanently disable project-agent confirmation. Without UI, requests that require confirmation are blocked.

## Output and cancellation

The TUI footer shows the policy mode and compact running/queued counts. Tool results show an activity tree; `Ctrl+O` expands task, error, and usage details.

Large child outputs use Pi's standard truncation limits. The complete output is saved to a temporary file and linked from the truncation marker.

Usage from completed child work is aggregated into the parent session. Usage from failed or cancelled work is best effort.

Top-level children run in POSIX process groups so cancelling them also cleans up nested work. Cancellation is bounded and reports when process cleanup cannot be confirmed.

## Troubleshooting

- **Unknown agent:** check the agent name and configured agent scope.
- **Project agent blocked:** trust the project and use `agentScope: "project"` or `"both"`.
- **Approval blocked:** use TUI mode, make the delegation request explicit, or adjust the policy mode.
- **Too many tasks:** raise `maxParallelTasks` or reduce the `tasks`/`chain` length.
- **Child cleanup unconfirmed:** inspect the returned diagnostic; the child or an inherited pipe may still be active.
- **Output truncated:** open the temporary file shown in the result marker.
