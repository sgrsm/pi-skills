# Permissions extension

Adds interactive guards around selected mutating actions. It is enabled by default for each Pi session and stores ordinary approvals only for the current session. A separate Priority 0 catastrophic-deletion guard is always active and non-grantable.

## Priority 0 catastrophic-deletion guard

The extension applies an always-on, non-grantable catastrophic-deletion check to model Bash and TUI `!`/`!!` commands, including a final check before local execution. Recognized hard denials cannot be bypassed with ordinary approvals, session grants, scratch auto-approval, no-UI mode, or `/permissions off`.

Protected canonical targets are:

- filesystem root
- HOME
- the command `cwd`
- every ancestor of that `cwd`

The bounded recognizer covers common visible direct deletion, traversal deletion, ordinary command composition, common wrappers, literal nested shell payloads, and visible indirect deletion. It hard-denies exact protected roots and visible destructive operations whose dynamic, malformed, or unsupported targets cannot be classified safely. Concrete noncritical cleanup, including ordinary nonexistent targets, continues through the normal permission policy.

The recognizer intentionally does not emulate complete Bash semantics or infer hidden effects inside scripts, interpreters, or executables. Commands without visible deletion evidence are not blocked merely because unusual syntax could theoretically conceal behavior. Denials include stable `P0_*` diagnostics and actionable guidance. This is a practical accident-prevention classifier, not a shell parser or arbitrary-code containment boundary.

### Scope, trust boundary, and limitations

The guard assumes a trusted Pi host, ordinary local process environment, executable lookup, and global/user extensions. It is not designed to contain deliberate evasion, hostile local state, hidden behavior in arbitrary code, malicious extensions, or filesystem races. Users who need hostile-code containment should run Pi in a suitable container, remote environment, or VM.

Ordinary path permission classification is best-effort and may be conservative or incomplete for nonstandard path forms and symlink-heavy layouts. Prefer explicit conventional paths, and avoid using symlinks as mutation targets or within the session scratch workspace when relying on automatic classification.

The permissions-owned Bash backend uses Pi's standard local operations. Some configured custom-shell behavior cannot be forwarded through the extension API; TUI command prefixes are still included in the final catastrophic check. These compatibility constraints are not security controls.

## Safe test scratch setup

Filesystem-mutating tests require `PI_PERMISSIONS_TEST_SCRATCH_ROOT` with no fallback. The configured directory must already exist as a real, non-symlink, current-user-owned, non-group/world-writable directory that neither equals, contains, nor is contained by the actual HOME, repository, or process cwd. Filesystem `/` is rejected exactly without causing every descendant scratch directory to be rejected. The approved directory must contain a real current-user-owned `.step1-test-root-ready` file created by the approving caller.

Tests create private `permissions-test-*` descendants, pin the approved and generated roots by device/inode, and mutate only strict canonical descendants whose real parent directory already exists. Every mutation helper revalidates both roots' exact identity, ownership, safe/private mode, non-symlink status, and exact canonical location at its boundary and again immediately before path mutation where practical. Cleanup atomically renames the pinned root to a fresh quarantine name inside the approved directory, revalidates identity, non-symlink status, ownership, and canonical containment after the rename and immediately before recursive Node removal, then removes only that quarantine. Any identity, ownership, mode, location, or containment mismatch refuses removal and reports the failure rather than guessing at recovery. Tests never create, rename, or remove the approved base or sentinel.

Path-based checks cannot eliminate a malicious same-user race between validation and mutation. The helper narrows that window by actively enforcing pinned identities at each helper boundary and immediately before mutations, but this is not an OS sandbox or descriptor-relative filesystem transaction.

Run `npm run test:permissions` only with that environment variable set to an explicitly approved Pi session scratch directory. The broader `all-tests` command now has the same prerequisite because it discovers these test files.

## What ordinary permissions guard

### File/path mutations outside the current working directory

Prompts before:

- `write` or `edit` tool calls targeting paths outside `cwd`
- recognized Bash mutations outside `cwd`, including common deletion, redirection, move/copy, creation, metadata-change, and in-place-edit forms

Conventional output suppression to the null device is ignored; destructive or metadata-changing operations against the null device remain guarded.

Paths inside the current working directory are not guarded by the ordinary prompt policy. Exact deletion of canonical `cwd` or a protected ancestor is still hard-denied by Priority 0.

The extension also provides a per-session Pi temp workspace under `join(os.tmpdir(), "pi", "session-<id>")`. Before each agent turn, Pi gets a compact one-line hint (`Use scratch temp dir instead of /tmp: <path>`). Mutations strictly below that session workspace are auto-approved and the workspace is created on first use with private `0700` permissions. Mutating the workspace root itself, sibling session workspaces, or other temp paths is still guarded.

### Git mutations on existing non-agent branches

Prompts before protected `git` operations on an existing branch that is not considered agent-created:

- `git merge`, `git pull`, `git rebase`, `git reset`
- non-dry-run `git clean` (`git clean -n` and `git clean --dry-run` are exempt)
- all `git restore` commands
- explicit path checkout with `git checkout -- <paths>`
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

Auto-approval for the Pi temp workspace does not create a visible session grant and does not count in the footer.

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
- `off` - disable ordinary permission prompts for the current session; catastrophic deletion protection remains active
- `clear` - clear file, git, and dependency session grants

Running `/permissions` with active grants opens a small UI choice to keep or clear grants. Agent-created branch tracking is kept when grants are cleared.

Argument completions are provided for `on`, `off`, and `clear`.

## Examples of guarded commands

These examples trigger prompts when the agent runs them through the `bash` tool:

```bash
echo "hello" > /tmp/pi-out.txt
rm -rf /tmp/pi/session-other
git reset --hard HEAD~1
git rebase main
npm install
npx create-vite@latest
sudo apt-get install ripgrep
```

Read-only, test, and build commands without a recognized guarded mutation normally continue without a prompt. Conventional null-output suppression is not treated as a filesystem mutation, and eligible mutations below the session temp workspace are auto-approved.

## Tools, flags, and events

The extension owns the model-facing `bash` tool and observes `write`, `edit`, and `bash` calls. It uses Pi session, agent-start, tool-call/result, user-Bash, and shutdown events to maintain session-local permission state, advertise the scratch workspace, evaluate guarded actions, and track agent-created branches.

There are no extension-specific CLI flags or settings; use `/permissions on` and `/permissions off` for session-local control.

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
- `permissions: off •` - ordinary guards are disabled for the current session; catastrophic deletion protection remains active, and this ordinary disabled state takes precedence over grant counts in the footer
- `permissions: <n> (...) •` - guards are enabled and there are active session grants from `Allow for current session`
- no footer item - the terminal UI is unavailable (`hasUI` is false)

Grant detail labels:

- `fs` - file/path grants
- `git` - git grants
- `deps` - package/dependency grants
- `×<n>` - more than one grant in that category
