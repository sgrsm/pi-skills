# Permissions maintenance

The [README](./README.md) is the user guide. Shared extension contracts are in [extension maintenance](../maintenance.md).

## Runtime integration

The extension owns the model-facing `bash` definition and observes `write`, `edit`, and `bash` tool calls. Direct and nested calls use the same recognized path, Git, and dependency guards. Arbitrary custom/MCP effects are outside classification even when they traverse the host's tool-event pipeline. Tool annotations are unverified declarations and are not used as authorization or guard bypasses.

Pi session, agent-start, tool-call/result, user-Bash, and shutdown events maintain session-local permission state, contribute scratch guidance, evaluate guarded actions, and track successfully created agent branches. Ordinary approvals are session-local. Priority 0 analysis precedes ordinary guards and scratch initialization on supported Bash calls, with another check before local execution; terminal `!`/`!!` commands also receive Priority 0 checks.

The catastrophic-deletion recognizer covers common visible direct deletion, traversal deletion, ordinary command composition, common wrappers, literal nested shell payloads, and visible indirect deletion. It does not emulate complete Bash semantics or infer hidden effects inside arbitrary scripts, interpreters, or executables. Unusual syntax without visible deletion evidence is not by itself a reason to hard-deny a command. Stable `P0_*` diagnostics distinguish recognized hard denials from ordinary permission requests.

The Bash backend uses Pi's standard local operations. Some configured custom-shell behavior cannot be forwarded through the extension API; terminal command prefixes are included in the final catastrophic check. These compatibility constraints do not provide containment.

## Ordinary shell command classification

`shell.ts` supplies the shared lexical command splitter for file, Git, and dependency guards. It recognizes unquoted command-boundary newlines and existing control operators, preserves quoted/escaped separators as word content, removes backslash-newline continuations outside single quotes, and skips comments beginning at an unquoted word boundary. Empty quoted words are retained. Visible here-document bodies are skipped through their literal, quote-removed delimiters, including multiple bodies and `<<-` tab stripping; body expansions are not evaluated. This is best-effort lexing, not control-flow evaluation or a complete Bash parser; variable assignments do not establish a substitution environment for later mutation operands.

File analysis requests output-redirection tokenization only; Git and dependency analysis retain input-redirection tokenization too. Keep these existing analyzer differences explicit rather than changing redirection policy while sharing boundary handling. Priority 0 retains its independent recognizer and must not depend on this ordinary-guard helper.

## Session scratch contract

Workspace paths are built under `join(os.tmpdir(), "pi", "session-<id>")`. Scratch guidance is contributed through the owned `permissions_scratch` section; a deliberate full-prompt override by another extension may hide it without changing permission checks. Follow the [structured prompt contribution rules](../maintenance.md#structured-prompt-contributions).

- The factory and `session_start` construct workspace metadata only. `before_agent_start` creates or revalidates the base and session directories before contributing the owned `permissions_scratch` section. Direct/nested tool calls without an agent-start event retain an initialization fallback.
- Base and session directories must be real directories owned by the current user. On non-Windows systems they are made private (`0700`). A failed initialization removes any stale scratch section and throws so the host reports the error; it must not advertise a ready path or weaken ordinary guards.
- Capture the session-scoped cancellation signal before asynchronous initialization and check it before and after creation. Shutdown/reload must not publish a late hint. Do not force the full system prompt, change other sections, or modify process/command `TMPDIR` as part of scratch initialization.
- Scratch auto-approval applies only when every recognized outside-`cwd` target qualifies. Root mutations, sibling workspaces, Git/dependency guards, and Priority 0 retain their existing behavior. Auto-approval does not add a session grant. Mixed-request prompt formatting is unchanged.

## Containment

`tempWorkspace.ts` compares canonical paths. Existing destinations resolve through `realpath`; missing destinations resolve through their nearest existing parent. Only missing-path errors allow walking upward. An existing dangling symlink or non-directory ancestor must fail closed, not be treated as a nonexistent directory.

Both the resolved destination and its directory-entry location (canonical parent plus basename) must be strict descendants. This prevents approving mutation of an outside symlink entry merely because it points into scratch. Equivalent aliases of parent directories, including macOS `/var` and `/private/var`, are supported. Canonical equality with the session root never qualifies.

`permissions.ts` retains normalized paths for existing ordinary scope/grant behavior and adds `filesystemPath` metadata when normalization changes the supplied absolute path. Scratch checks use that metadata and refuse literal `..` components conservatively, so lexical normalization cannot erase a symlink/traversal escape. Target deduplication must not discard that distinction. A child name beginning with `..`, such as `..cache`, is not a parent-traversal component.

Recheck containment after workspace creation/validation; do not cache candidate resolutions across mutations or turns. These path checks are accident prevention under the documented trusted-local-environment assumptions, not race-free descriptor-relative mutation or a hostile-code sandbox. General Bash recognition and ordinary cwd/grant classification remain best-effort.

## Dialog and footer integration

Permission approvals and clarify exchanges share the session-local dialog queue. Keep the complete selector/custom-answer exchange and grant updates within that queue, recheck scoped grants when a request reaches the front, and keep no-UI blocks and Priority 0 hard denials outside it. Subagent approvals/escalations, handoff dialogs, and Trash confirmations remain uncoordinated; preserve the user-facing collision warning. See the [shared dialog contract](../maintenance.md#shared-interactive-dialogs).

Request details are capped at 8,000 characters. When complete scopes cannot be displayed, approval choices must be withheld rather than granting hidden scopes. Terminal details use persistent notifications; RPC selectors carry the bounded details themselves. Pi's editor/external-editor cancellation constraints require the existing cancellable terminal/RPC custom-answer routes. Pi 1.0's RPC UI has no client-side dismissal event for cancelled dialogs; cancellation still settles the backend and prevents late approval.

Footer status key/order and legacy-key cleanup use `../shared/footerStatus.ts`. Preserve the shared helper rather than introducing an independent key or ordering convention. User-visible states and labels are described in the [footer guide](./README.md#footer-status).

## Safe test scratch setup

Filesystem-mutating tests require `PI_PERMISSIONS_TEST_SCRATCH_ROOT` with no fallback. The configured directory must already exist as a real, non-symlink, current-user-owned, non-group/world-writable directory that neither equals, contains, nor is contained by the actual HOME, repository, or process cwd. Filesystem `/` is rejected exactly without causing every descendant scratch directory to be rejected. The approved directory must contain a real current-user-owned `.step1-test-root-ready` file created by the approving caller.

Tests create private `permissions-test-*` descendants, pin the approved and generated roots by device/inode, and mutate only strict canonical descendants whose real parent directory already exists. Every mutation helper revalidates both roots' exact identity, ownership, safe/private mode, non-symlink status, and exact canonical location at its boundary and again immediately before path mutation where practical. Cleanup atomically renames the pinned root to a fresh quarantine name inside the approved directory, revalidates identity, non-symlink status, ownership, and canonical containment after the rename and immediately before recursive Node removal, then removes only that quarantine. Any identity, ownership, mode, location, or containment mismatch refuses removal and reports the failure rather than guessing at recovery. Tests never create, rename, or remove the approved base or sentinel.

Path-based checks cannot eliminate a malicious same-user race between validation and mutation. The helper narrows that window by actively enforcing pinned identities at each helper boundary and immediately before mutations, but this is not an OS sandbox or descriptor-relative filesystem transaction.

Run `npm run test:permissions` only with the environment variable set to an explicitly approved Pi session scratch directory. The broader `npm test` and `npm run all-tests` commands, as well as the combined `npm run verify` gate, have the same prerequisite because they discover these test files. Set `TMPDIR` to the approved root too; host-loading tests require temporary files to stay there and several assert that the two variables match.

## Validation

Use the [approved scratch setup](#safe-test-scratch-setup) before running tests from `agent/extensions/`.

- `tempWorkspace.test.ts`: private directories, alias equivalence, missing descendants, root/sibling exclusion, symlink target and entry containment, dangling links, and non-directory ancestors.
- `shell.test.ts`: command boundaries, quoted and escaped separators/newlines, continuation joining, comments, empty quoted words, visible here-document boundaries, and analyzer-specific redirection tokenization.
- `permissions.test.ts`: component-aware lexical containment, preservation/deduplication of unnormalized filesystem targets, multiline mutation attribution, and source/log-redirection separation.
- `git.test.ts` and `package.test.ts`: later guarded commands after newlines, assignment-only commands, directory changes, comments, and continued subcommand words.
- `index.test.ts`: readiness before advertising, failure and cancellation without stale hints, revalidation, scratch approval through tool events (including multiline Bash), actual guarded destinations, root guards, and Priority 0 ordering.
- `pi-compatibility/structured-prompt.test.ts`: public-host prompt composition for user and custom-message run starts, ready directories on session changes/reload, and host-reported preparation failure or shutdown cancellation without a stale section. It scopes test `TMPDIR` to a disposable fixture and restores it afterward.
- `shared/dialogTestHarness.test.ts`: bounded condition-based waiting for asynchronous permission preflight. Dialog tests must not assume filesystem analysis finishes within a fixed number of event-loop turns.

Run `npm run test:permissions`, the structured-prompt test, and `npm run typecheck`; use `npm run verify` for the combined gate. These tests use disposable files and synthetic host interactions, not live providers or real guarded mutations outside approved scratch.
