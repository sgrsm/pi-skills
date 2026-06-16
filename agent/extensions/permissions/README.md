# Permissions extension

Adds interactive guards around selected mutating actions. It is enabled by default for each Pi session and stores approvals only for the current session.

## What it guards

### File/path mutations outside the current working directory

Prompts before:

- `write` or `edit` tool calls targeting paths outside `cwd`
- `bash` commands that appear to mutate paths outside `cwd`, including deletes, write redirections, `mv`, `mkdir`, `touch`, `truncate`, `ln`, `chmod`, `chown`, `chgrp`, `cp`/`install` destinations, `tee`, `sed -i`, and `find -delete`

Output suppression to the exact null device (`>/dev/null`, `2>/dev/null`, `&>/dev/null`, append variants, or `tee /dev/null`) is ignored. Other destructive or metadata-changing operations against `/dev/null`, such as `rm /dev/null` or `chmod /dev/null`, are still guarded.

Paths inside the current working directory are not guarded by this extension.

### Git mutations on existing non-agent branches

Prompts before protected `git` operations on an existing branch that is not considered agent-created:

- `git merge`, `git pull`, `git rebase`, `git reset`
- `git cherry-pick`, `git revert`
- `git commit --amend`
- force pushes
- branch delete, rename, force/reset operations

Branches with these prefixes are treated as agent branches and bypass this guard:

- `pi/`
- `agent/`
- `codex/`

The extension also tracks branches created successfully by Pi during the session and treats them as agent-created later.

### Package/dependency acquisition

Prompts before package install, update, download, or execute commands for supported managers, including:

- Node: `npm`, `npx`, `yarn`, `pnpm`, `bun`, `bunx`
- Python: `pip`, `python -m pip`, `uv`, `uvx`, `poetry`, `pipenv`
- System/language tools: `brew`, `apt`, `apt-get`, `dnf`, `yum`, `cargo`, `go`, `gem`

Maven and Gradle commands are intentionally excluded.

## Prompt choices

When a guarded action is detected in the interactive UI, Pi asks how to proceed:

- `Allow once` - allow this tool call only
- `Allow for current session` - store a scoped session grant
- `Deny` - block the tool call
- `Custom instructions` - block the tool call and pass the provided instructions back to the agent

Session grant scopes are narrow:

- file/path grants: same operation under the listed target scope and nested paths
- git grants: same operation, repository, and branch
- dependency grants: same package manager, operation class, and project root

In non-interactive/no-UI mode, guarded actions are blocked instead of prompting.

## Slash command

`/permissions` shows current state and active session grants.

Examples:

```text
/permissions
/permissions on
/permissions off
/permissions clear
```

Arguments:

- `on` - enable permission guards
- `off` - disable permission guards for the current session
- `clear` - clear file, git, and dependency session grants

Running `/permissions` with active grants opens a small UI choice to keep or clear grants. Agent-created branch tracking is kept when grants are cleared.

Argument completions are provided for `on`, `off`, and `clear`.

## Examples of guarded commands

These examples trigger prompts when the agent runs them through the `bash` tool:

```bash
echo "hello" > /tmp/pi-out.txt
git reset --hard HEAD~1
git rebase main
npm install
npx create-vite@latest
sudo apt-get install ripgrep
```

These examples are normally not guarded by this extension:

```bash
npm test
npm run build
mvn test
gradle build
some-command >/dev/null
some-command 2>/dev/null
some-command | tee /dev/null
```

## Tools, flags, and events

Registered tools:

- none

Observed tool calls:

- `write`
- `edit`
- `bash`

Extension-specific CLI flags/settings:

- none; use `/permissions on` and `/permissions off` for session-local control

Pi events used:

- `session_start` - restore tracked agent-created branches and update footer status
- `tool_call` - inspect guarded tool calls before execution
- `tool_result` - record successful agent-created git branches
- `session_shutdown` - reset enabled state, session grants, and pending branch tracking work

## Footer status

In the terminal UI, the extension keeps a footer status visible. The status key/order and legacy-key cleanup come from the shared footer status helper imported as `../shared/footerStatus.ts` (`agent/extensions/shared/footerStatus.ts`).

```text
permissions: on •
permissions: off •
permissions: 3 (fs×2, git) •
permissions: 3 (fs, deps×2) •
```

Runtime states:

- `permissions: on •` - guards are enabled and there are no active session grants
- `permissions: off •` - guards are disabled for the current session; this disabled state takes precedence over grant counts in the footer
- `permissions: <n> (...) •` - guards are enabled and there are active session grants from `Allow for current session`
- no footer item - the terminal UI is unavailable (`hasUI` is false)

Grant detail labels:

- `fs` - file/path grants
- `git` - git grants
- `deps` - package/dependency grants
- `×<n>` - more than one grant in that category
