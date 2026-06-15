# Clarify extension

Adds an interactive `clarify` tool that lets Pi stop and ask the user to choose a path before continuing.

## What it does

- Lets the agent ask a focused question with a short list of options.
- Supports optional option descriptions for trade-offs or consequences.
- Allows a custom answer by default, unless the tool call sets `allowCustom: false`.
- Saves the global on/off state in `~/.pi/agent/clarify.json`.
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

## Tool

Tool name: `clarify`

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

If clarify is disabled, the tool call is blocked with: `clarify is disabled. Run /clarify on to enable it.`

## UI and status

Footer status uses the shared helper at `../shared/footerStatus.ts` (`agent/extensions/shared/footerStatus.ts`) so clarify participates in the managed footer order and clears legacy status keys before writing its current state.

When the terminal UI is available, possible footer states are:

- `clarify: on •` - clarify is enabled from saved state or `/clarify on`, and the `clarify` tool is active.
- `clarify: off •` - clarify is disabled by saved state or `/clarify off`, so the tool is removed/blocked.
- no footer indicator - non-UI mode; the extension cannot write terminal footer status and the agent is told to ask in plain text when clarification is needed.

The status is refreshed on session start and when `/clarify on|off` changes the state.

Interactive selector in TUI mode:

- title: `Clarify`
- shows the question, numbered options, and the selected option's description preview
- keys: `↑` / `↓` navigate, `Enter` selects, `Esc` cancels
- long questions can be scrolled with `PgUp`, `PgDn`, `Home`, `End`, or mouse wheel
- choosing `Custom instructions` opens the editor

Tool display states:

- pending call: shows `clarify` plus the question, option preview, and whether custom instructions are included
- selected option: green check with the selected option
- custom answer: green check with `custom:` and the answer
- cancelled: warning `Cancelled`
- error: error text

## Extension hooks

The extension listens for:

- `session_start` - loads saved state, updates active tools, and refreshes footer status
- `tool_call` - blocks `clarify` calls while disabled
- `before_agent_start` - adds clarification guidance to the agent prompt, or tells the agent to ask in plain text when UI is unavailable

There are no user-facing CLI flags for this extension.
