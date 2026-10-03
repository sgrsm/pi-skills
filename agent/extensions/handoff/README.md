# Handoff extension

Creates compact Markdown handoff documents for continuing Pi work in a fresh session.

## What it does

- Summarizes the current session into the Pi handoff dir (`~/.pi/handoff/` by default).
- Records the original `cwd`, session file/name when available, and a short list of relevant files, including `read`/`grep`/`edit`/`write` calls made through codemode or other nested tools.
- Requests no prompt-cache retention and uses a fresh request session ID for each model-based summary.
- Lets a new session continue from a saved handoff, or inject a handoff into the current session.
- Falls back to a recent conversation excerpt if model-based summarization is unavailable or fails.

Handoff files are named like this by default:

```text
~/.pi/handoff/YYYYMMDD-HHMMSS-<slug>.md
```

## Relevant Files and record limits

The file list uses the current branch's context, including recorded direct/nested tool calls and file references carried by earlier summaries. Recorded calls are **attempts**: a listed edit or write may have failed or never finished, so check the file before relying on it.

Model-based summaries select relevant files from these hints. When a file list must be added automatically, it prioritizes modified paths and includes at most 12 files.

Handoffs show **“File lists may be incomplete”** when Pi's nested records are known to be missing calls or arguments, malformed, or unfinished. This warning can also reflect missing non-file activity. Older summaries may already have lost detail, and the absence of a warning does not make the list an exhaustive filesystem audit.

For extraction rules, record bounds and validation, see [handoff maintenance](maintenance.md#file-candidates-and-record-limits).

## When to use it

Use `/handoff` before leaving a long or interrupted session, especially when a fresh context would help. In the next session:

- use `/continue` when the session is empty or freshly created;
- use `/inject-handoff` when the current session already has useful context;
- use `/continue-new` when you want Pi to create the fresh session automatically.

## Commands

### `/handoff [title]`

Creates a handoff document from the current session. The optional title is used as the document title and slug source.

Examples:

```text
/handoff
/handoff Auth refactor checkpoint
```

After saving, Pi shows the handoff path and the `/continue <slug>` command to run next.

### `/handoff-list [query]`

Lists recent handoffs, optionally filtered by title, slug, or file name.

- With interactive UI available (TUI or RPC), selecting an item prefills the editor with `/continue <slug>` for an empty session or `/inject-handoff <slug>` when the current session already has context. RPC clients must answer the emitted extension UI request.
- In print or JSON mode, prints up to 20 matching handoffs.

Examples:

```text
/handoff-list
/handoff-list auth
```

### `/continue [slug-or-query]`

Continues from a handoff in an empty or fresh session. It sets the session name to the handoff title and sends a continuation prompt containing the handoff content.

If the current session already has meaningful context, the command warns instead of injecting the handoff. Use `/inject-handoff` or `/continue-new` in that case.

Examples:

```text
/continue
/continue auth-refactor-checkpoint
```

### `/inject-handoff [slug-or-query]`

Injects a handoff into the current session as supplemental context. The injected prompt tells the agent to preserve current context and call out conflicts instead of silently choosing one.

Examples:

```text
/inject-handoff
/inject-handoff auth-refactor
```

### `/continue-new [slug-or-query]`

Waits for the current agent run to finish, creates a fresh session, and continues from the selected handoff there.

Examples:

```text
/continue-new
/continue-new auth-refactor
```

### `/handoff-clear`

Deletes all handoff documents from the Pi handoff dir (`~/.pi/handoff` by default).

```text
/handoff-clear
```

With interactive UI available (TUI or RPC), Pi asks for confirmation before deleting. In print or JSON mode, the delete runs without an interactive confirmation.

## Argument selection and completion

`/continue`, `/inject-handoff`, `/continue-new`, and `/handoff-list` provide handoff argument completions based on recent saved documents.

When no argument is provided:

- with interactive UI available (TUI or RPC), Pi opens a handoff picker;
- in print or JSON mode, Pi uses the newest matching handoff.

Queries match normalized titles, slugs, and file names. Exact slug matches win.

## Tools, flags, and shortcuts

This extension does not register custom tools, CLI flags, or keyboard shortcuts.

## Events and UI behavior

The extension registers these Pi events:

- `session_start` - installs a TUI editor wrapper that can show inline warnings below the editor.
- `input` - clears inline warnings when normal user input arrives; extension-injected input is left alone.
- `agent_start` - clears inline warnings when an agent run begins.

TUI warning states:

- Typing `/continue` in a non-empty session shows: use `/inject-handoff` to merge into the current session, or `/continue-new` for an automatic fresh session.
- Typing `/handoff-clear` shows a destructive-action warning and notes that confirmation will be required.

Notifications are used for save/list/clear progress, queued continuation/injection, warnings, and errors.
