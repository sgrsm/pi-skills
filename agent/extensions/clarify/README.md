# Clarify extension

Adds an interactive `clarify` tool that lets Pi stop and ask the user to choose a path before continuing.

## What it does

- Lets the agent ask a focused question with a short list of options.
- Supports optional option descriptions for trade-offs or consequences.
- Allows a custom answer by default, unless the tool call sets `allowCustom: false`.
- Saves the global on/off state in the Pi agent dir (`~/.pi/agent/clarify.json` by default).
- Falls back to plain-text asking in non-interactive modes because the tool requires UI.

## When it is used

The agent should use `clarify` when:

- there are multiple materially different ways to proceed;
- a non-trivial assumption would affect correctness, behavior, scope, safety, or user intent;
- user direction is needed before committing to one path.

The agent should not use it for trivial defaults, obvious next steps, or decisions already made by the user.

## Slash command

`/clarify` controls whether the tool is available globally.

Examples:

```text
/clarify
/clarify on
/clarify off
```

Behavior:

- `/clarify` shows the current state.
- `/clarify on` enables the tool and saves the state.
- `/clarify off` disables the tool, removes it from active tools, and saves the state.

Argument completion is available for `on` and `off`.

Saved off mode keeps clarify unavailable, even if a tool selection names it. Startup and `/reload` no longer discard pending restored MCP tools when applying that mode. Eligible clarify remains model-only and follows the existing global mode defaults; restrictive CLI allowlists and exclusions still take precedence. An explicit `/clarify off` remains an intentional tool-loadout change.

**Separate Pi 1.0 resume limitation:** SDK/CLI resume may omit previously selected tool declarations even without these local extensions. This startup correction does not repair that host behavior; see [TDR-0004](../../../tdr/0004-sdk-cli-resume-tool-restoration-host-defect.md).

## Tool

Tool name: `clarify`. It is model-only: direct model calls are supported, but codemode scripts and other tools cannot invoke it through `ctx.executeTool()`. The `/clarify` command is unchanged.

Parameters:

- `question` - required question to show the user.
- `options` - suggested choices, usually 2-5 focused options.
- `allowCustom` - optional boolean; defaults to `true`.
- `customPrompt` - optional prefilled text for the custom-answer editor.

Example tool call:

```json
{
  "question": "Which implementation approach should I use?",
  "options": [
    {
      "label": "Small targeted fix",
      "description": "Lowest risk; keeps the current design."
    },
    {
      "label": "Refactor the helper first",
      "description": "More cleanup now; larger change surface."
    }
  ],
  "allowCustom": true
}
```

Possible results:

- selected option: `User selected: 1. Small targeted fix`
- custom answer: `User provided custom instructions: ...`
- cancellation: `User cancelled the clarification.`

Clarify calls run sequentially and share a session-local dialog queue with permission approvals. A question and its custom-answer editor stay together; a second question or approval waits until that exchange finishes. Cancellation while queued or displayed, turn abort, and session shutdown/reload all return the existing cancelled result. Late replies are ignored.

In TUI mode, custom answers use a prefilled multiline editor inside Pi. Its external-editor shortcut (normally Ctrl+G) is disabled so an uncancellable external process cannot restart the terminal after abort; edit inside Pi instead. In RPC mode, custom answers use cancellable text input rather than a multiline editor. `customPrompt` is shown as a placeholder there, not editable prefill. RPC selector details are capped at 8,000 characters.

If clarify is disabled, the tool call is blocked with: `clarify is disabled. Run /clarify on to enable it.`

### Dialog collisions and stale RPC dialogs

Scheduling coordinates clarify and permissions only. Subagent approvals/escalations, handoff dialogs, and Trash confirmations are not yet enrolled. If one opens during a clarification or approval, it can replace the visible dialog and leave work waiting invisibly.

If a dialog unexpectedly replaces another and work stalls, cancel the visible dialog, then abort the turn once the normal editor returns. Retry with the interactive steps separated. Aborting settles the clarify/permission side; an unrelated request may still require reloading or restarting Pi.

In RPC clients, an obsolete dialog may remain visible after abort because Pi 1.0 sends no client-side dismissal event. The cancelled backend request is settled and late replies are ignored; dismiss the obsolete dialog or refresh the client. This RPC visibility limitation does not apply to Pi's terminal UI.

## UI and status

Footer status uses the shared helper at `../shared/footerStatus.ts` (`agent/extensions/shared/footerStatus.ts`) so clarify participates in the managed footer order and clears legacy status keys before writing its current state.

When the terminal UI is available, possible footer states are:

- `clarify: on •` - saved/current clarify mode is on; a restrictive CLI tool selection can still exclude the tool.
- `clarify: off •` - clarify is disabled by saved state or `/clarify off`, so the tool is removed/blocked.
- no footer indicator - non-UI mode; the extension cannot write terminal footer status and the agent is told to ask in plain text when clarification is needed.

The status is refreshed on session start and when `/clarify on|off` changes the state.

Interactive selector in TUI mode:

- title: `Clarify`
- shows the question, numbered options, and the selected option's description preview
- non-selected options use the theme accent color; the selected option uses fixed blue `#0066CC` and bold text
- keys: `↑` / `↓` navigate, `Enter` selects, `Esc` cancels
- in regular mode, long questions can be scrolled with `PgUp`, `PgDn`, `Home`, `End`, or wheel; keyboard scrolling is recommended
- choosing `Custom instructions` opens the cancellable in-Pi editor

**Known Pi 1.0 fullscreen limitation:** despite the on-screen help, question-scrolling keys and wheel input go to the transcript instead of the question. Long dialogs can also lose their bottom help to clipping. Ask for a shorter question or start Pi with `pi --tui-mode regular` for regular-mode keyboard scrolling without changing saved settings.

The selector writes mouse-mode enable/disable sequences in both modes; in fullscreen these conflict with host-owned tracking. Captured writes and source inspection confirm the conflict, but its terminal-specific effect has not been live-tested. [Work package 0003](../../../fixme/0003-clarify-fullscreen-input.md) is confirmed but deferred; no runtime workaround was retained.

Tool display states:

- pending call: shows `clarify` plus the question, option preview, and whether custom instructions are included
- selected option: green check with the selected option
- custom answer: green check with `custom:` and the answer
- cancelled: warning `Cancelled`
- error: error text

## Extension hooks

The extension listens for:

- `session_start` - loads saved state, applies tool availability without replacing pending restoration, and refreshes footer status
- `session_shutdown` - cancels displayed and queued interactions, including on reload
- `tool_call` - blocks `clarify` calls while disabled
- `before_agent_start` - adds clarification guidance to the agent prompt, or tells the agent to ask in plain text when UI is unavailable

Clarification guidance is an additive structured prompt section. It updates rather than accumulating across turns, switches to the plain-text note without UI, and is omitted while clarify is disabled or inactive. Other extensions' later guidance (including MCP) remains available. When another extension deliberately forces a complete prompt, this guidance is not injected into that provider prompt.

There are no user-facing CLI flags for this extension.
