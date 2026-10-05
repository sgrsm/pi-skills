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

Saved off mode keeps clarify unavailable at startup and `/reload`, even if a tool selection names it. When on, clarify stays model-only, and restrictive CLI tool allowlists/exclusions still win. See [tool availability at startup](../maintenance.md#tool-availability-at-startup).

**Separate Pi 1.0 resume limitation (open):** SDK/CLI resume may omit previously selected tool declarations even without these local extensions. Startup availability does not repair that host behavior; see [TDR-0004](../../../tdr/0004-sdk-cli-resume-tool-restoration-host-defect.md).

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

Clarify calls run sequentially and share a session-local dialog queue with permission approvals. A question and its custom-answer editor stay together; a second question or approval waits until that exchange finishes. Cancelling while queued or displayed, aborting the turn, and session shutdown/reload all return the cancelled result. Late replies are ignored.

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

**Known Pi 1.0.3 fullscreen limitation (open):** Home/End scroll the question in the tested cases, but despite the on-screen help, PageUp/PageDown and wheel input still go to the transcript instead of the question. Long dialogs can also lose their bottom help to clipping. Ask for a shorter question, or start Pi with `pi --tui-mode regular` for regular-mode keyboard scrolling without changing saved settings.

In fullscreen, Clarify leaves Pi in control of mouse handling, so closing a question does not disable transcript scrolling. If wheel/trackpad scrolling is already stuck after using an older version of this extension, restart Pi after updating; `/reload` alone does not restore terminal mouse modes. Regular-mode wheel behavior is unchanged. The remaining fullscreen limitations above are still open; see [maintainer details](./maintenance.md#fullscreen-input-defect).

Tool display states:

- pending call: shows `clarify` plus the question, option preview, and whether custom instructions are included
- selected option: green check with the selected option
- custom answer: green check with `custom:` and the answer
- cancelled: warning `Cancelled`
- error: error text

## Prompt guidance

While clarify is enabled and active, Pi's prompt includes clarification guidance, or a plain-text-instead note when no UI exists. It is omitted when clarify is disabled or inactive. If another extension forces a complete system prompt, the guidance may not reach the model. Hook wiring, prompt-section rules and tests are in [clarify maintenance](./maintenance.md) and [structured prompt contributions](../maintenance.md#structured-prompt-contributions).

There are no user-facing CLI flags for this extension.
