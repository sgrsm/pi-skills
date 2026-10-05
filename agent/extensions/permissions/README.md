# Permissions extension

Provides ready-to-use session scratch and asks before selected mutations outside your working directory, protected Git operations, and dependency acquisition. It is enabled by default for each Pi session; ordinary approvals last only for that session. Catastrophic-deletion protection is always active.

## Enable and use

Pi loads the extension from its extensions directory. No additional settings or flags are required. Use `/permissions` to inspect approvals, or `/permissions on` and `/permissions off` to control ordinary prompts for the current session. Turning ordinary prompts off does **not** disable catastrophic-deletion protection.

## Ready-to-use scratch

Pi is given a private, session-specific directory under your system temp location. The directory is already prepared when Pi receives its path: **no setup approval is needed**. Ask Pi to put temporary scripts, downloads, logs, and other disposable files there instead of using `/tmp`.

For example:

> Put the temporary script and its output in the session scratch directory supplied by Pi. Create a work subdirectory if needed, and use explicit destination filenames.

In the examples below, replace `<scratch>` with the path supplied by Pi:

```bash
mkdir -p "<scratch>/work"
cp report.txt "<scratch>/work/report.txt"
printf 'hello\n' > "<scratch>/out.txt"
```

Recognized file mutations below scratch do not need an ordinary file-permission prompt. Equivalent macOS `/var/...` and `/private/var/...` paths are supported. Scratch auto-approval does not add a session grant or increase the footer count.

### Scratch actions that still prompt

The extension manages the scratch root. Do not ask Pi to create, change permissions on, rename, or delete that root. Other sessions' scratch directories and other temp locations remain guarded.

| Action | What to expect |
| --- | --- |
| Write `<scratch>/out.txt` or create `<scratch>/work` | No ordinary file-permission prompt |
| `mkdir -p "<scratch>"` or `chmod 700 "<scratch>"` | Root-level mutation still requires approval; setup is unnecessary |
| `cp report.txt "<scratch>"` | The root is the destination, so it still requires approval; use `<scratch>/report.txt` instead |
| Delete or rename `<scratch>` | Still guarded |
| Mutate a different session's scratch or another temp path | Still guarded |
| Install dependencies or perform a protected Git operation in scratch | Separate dependency or Git approval may still be needed |

Use straightforward paths without parent traversal (`..`). Names such as `..cache` are ordinary child names, but paths with `..`, broken symlinks, or symlinks that lead outside scratch do not qualify for scratch auto-approval. If one command includes both eligible scratch targets and guarded targets, the command can still prompt.

`TMPDIR` is **not changed**. Programs that choose their own default temp location are not automatically redirected to session scratch.

<a id="examples-of-guarded-commands"></a>

## What ordinary permissions guard

### File/path mutations outside the current working directory

Prompts before `write` or `edit` calls outside the working directory and recognized Bash mutations there, such as deletion, redirection, move/copy, creation, permission changes, and in-place editing. Eligible session-scratch paths are the exception described above.

Paths inside the working directory do not need ordinary file approval. Deleting that directory itself or a protected ancestor is still blocked by catastrophic-deletion protection. Conventional output suppression to `/dev/null` does not prompt; deleting or changing permissions on the null device remains guarded.

### Git mutations on existing non-agent branches

Protected operations include:

- `git merge`, `git pull`, `git rebase`, and `git reset`
- non-dry-run `git clean`, all `git restore`, and `git checkout -- <paths>`
- `git cherry-pick`, `git revert`, and `git commit --amend`
- force pushes and branch delete, rename, force, or reset operations

Branches prefixed with `pi/`, `agent/`, or `codex/`, and branches Pi successfully creates during the session, bypass this ordinary Git guard. `git clean -n` and `git clean --dry-run` are also exempt.

### Package/dependency acquisition

Prompts before supported package install, update, download, or execute commands, including:

- Node: `npm`, `npx`, `yarn`, `pnpm`, `bun`, `bunx`
- Python: `pip`, `python -m pip`, `uv`, `uvx`, `poetry`, `pipenv`
- System/language tools: `brew`, `apt`, `apt-get`, `dnf`, `yum`, `cargo`, `go`, `gem`

Maven and Gradle commands are intentionally excluded.

## Prompt choices

When a guarded action is detected, choose:

- **Allow once** — allow this tool call only.
- **Allow for current session** — remember a scoped approval until the session ends.
- **Deny** — block the tool call.
- **Custom instructions** — block the call and tell Pi how to proceed instead.

Session approvals cover only the same operation and approved scope: file operations within the approved directory, Git operations on the same repository and branch, or dependency operations for the same manager and project. One approval is not general permission to mutate everything nearby.

Permissions and clarify questions appear one at a time. An earlier session approval can eliminate a duplicate prompt only if it covers the requested operation and scope. Cancelling a request, aborting the turn, or reloading/shutting down the session blocks unapproved work; late replies cannot approve cancelled requests.

In the terminal UI, request details appear above a compact selector. If details exceed the display limit, approval is unavailable: only Deny or Custom instructions are offered. Ask Pi to split the action rather than approving scopes you cannot see. RPC clients receive the bounded details in the selector request.

Custom instructions use a multiline editor in Pi's terminal UI. The external-editor shortcut (normally Ctrl+G) is unavailable during that exchange; edit inside Pi. RPC clients use text input instead, where starter text is a placeholder rather than editable prefill.

In non-interactive/no-UI mode, guarded actions are blocked instead of prompting.

## Priority 0 catastrophic-deletion guard

Recognized deletion of filesystem root, your home directory, the command's working directory, or any ancestor of that working directory is blocked. Visible destructive operations with dynamic, malformed, or unsupported targets can also be blocked when they cannot be classified safely. Ordinary cleanup of concrete noncritical paths, including already-absent files, continues through the normal permission rules.

This protection applies to supported `bash` calls, including nested calls, and terminal `!`/`!!` commands. It cannot be bypassed with an ordinary approval, a session grant, scratch auto-approval, no-UI mode, or `/permissions off`. A denial includes a `P0_*` diagnostic and guidance on how to rewrite the action safely.

### Scope, trust boundary, and limitations

This extension guards supported `bash`, `write`, and `edit` calls, **not arbitrary custom or MCP tools**. Built-in calls made through `codemode` retain their guards, but a custom tool that mutates resources on its own is outside this policy. A tool's declared read-only or safety hints are not proof that it is safe and do not authorize bypassing these guards.

Path and command recognition is best-effort, not a complete shell parser. It assumes a trusted Pi installation, extensions, shell environment, and local filesystem. Hidden effects inside scripts or executables, unusual path forms, symlink-heavy layouts, malicious extensions, and filesystem races are not fully contained. Prefer explicit conventional paths and avoid symlink mutation targets when relying on automatic classification. Use a container, remote environment, or VM if you need hostile-code isolation; permissions is accident prevention, not a sandbox.

For recognized simple shell commands, line breaks between commands work like semicolons. Quoted line breaks remain part of an argument; backslash-newline outside single quotes continues the same command. Use explicit destination paths when relying on these checks: arbitrary variables such as `$scratch` and `$log` are not resolved, although `$HOME` and `$PWD` are recognized. Sourcing a script does not by itself make that script a file-mutation target; recognized output redirections still count, and hidden effects inside the script remain outside classification.

Some custom-shell settings cannot be honored by the permissions-protected Bash tool. If a command depends on custom shell behavior, verify its environment rather than treating that configuration as a safety boundary.

Read-only, test, and build commands without a recognized guarded mutation normally continue without a prompt. This does not guarantee that an arbitrary command has no side effects.

## Troubleshooting

### Pi asks to prepare scratch or uses another temp location

Remind Pi that the supplied scratch directory is already ready. Ask it to write a file or create a child directory, not run `mkdir` or `chmod` on the root. For copies, specify the destination filename. A custom prompt can hide the scratch guidance; the permission rules still apply.

### A scratch action still prompts

Check that the target is below the current session's scratch, not the root, a sibling session, or another temp directory. Avoid `..` traversal and broken or escaping symlinks. Check the entire command for other targets, dependency acquisition, or protected Git operations.

### Scratch preparation fails

Pi reports an extension error and does not present the directory as ready. Check that the Pi temp base and session directories are real directories owned by your user, not symlinks or files, and that the temp location is writable. Do not disable guards to work around an unsafe workspace.

### Dialog collisions and stale RPC dialogs

Permissions and clarify questions are coordinated, but subagent approvals/escalations, handoff dialogs, and Trash confirmations are not. One of those dialogs can replace a pending permission or clarification and leave work waiting invisibly.

If this happens, cancel the visible dialog, then abort the turn once the normal editor returns. Retry with the interactive steps separated. An unrelated request may still require reloading or restarting Pi. Do not disable permission guards to work around a UI hang.

In RPC clients, an obsolete dialog can remain visible after abort. The backend request is already cancelled and late replies cannot approve it; dismiss the obsolete dialog or refresh the client. This visibility limitation does not apply to Pi's terminal UI.

## Slash command

```text
/permissions
/permissions on
/permissions off
/permissions clear
```

- No argument shows current state and active session approvals, with an option to keep or clear approvals when any exist.
- `on` enables ordinary permission guards.
- `off` disables ordinary prompts for the session; catastrophic-deletion protection stays active.
- `clear` clears file, Git, and dependency session approvals, but keeps Pi's tracking of agent-created branches.

Argument completion is available for `on`, `off`, and `clear`.

## Footer status

The terminal footer shows whether ordinary guards are enabled and how many session approvals are active:

```text
permissions: on •
permissions: off •
permissions: 3 (fs×2, git) •
permissions: 3 (fs, deps×2) •
```

`fs`, `git`, and `deps` identify approval categories; `×<n>` is the count for that category. `off` takes precedence over approval counts, and scratch auto-approval is not counted. The footer is unavailable in no-UI mode.

## Safe test scratch setup

For development, see the [safe test scratch setup](./maintenance.md#safe-test-scratch-setup).

<a id="tools-flags-and-events"></a>

Lifecycle, implementation contracts, and validation instructions are in [permissions maintenance](./maintenance.md).
