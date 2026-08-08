# trash-history

Recovery-first cleanup for old Pi session files on **macOS**. It moves eligible session JSONL files to macOS Trash; it never permanently deletes them.

## Command

```text
/trash-history <days> [--archive] [--include-named] [--all-projects] [--dry-run] [--details]
```

Running `/trash-history` without arguments prints this schema, a concise explanation of every argument, and the safe example `/trash-history 60 --dry-run`; it does not scan or change files.

`<days>` is a strict non-negative base-10 integer. A file is eligible only when its last-modified time is **strictly before** the one fixed cutoff calculated as `now - days × 86,400,000 ms`.

Examples:

```text
/trash-history 30 --dry-run                    # current project (default)
/trash-history 90 --include-named              # current project, including named sessions
/trash-history 365 --all-projects --dry-run    # standard global Pi session root
/trash-history 365 --all-projects --details    # add a bounded per-session summary before confirmation
/trash-history 365 --all-projects --archive    # make one verified ZIP, then confirm Trash operations
/trash-history 365 --all-projects              # confirm before Trash operations
```

- `--archive` requires a verified ZIP before any Trash action. It writes one archive to `~/.pi/archives/` named `<current-datetime>-sessions-<from-date>_<to-date>.zip`, for example `2026-03-01T00-00Z-sessions-2025-03-02_2026-02-26.zip`. The datetime is UTC through minutes; the from/to dates are the UTC last-modified date range of the sessions actually archived. It preserves paths relative to the selected Pi session root, avoiding basename collisions when sessions from many projects are archived together.
- `--include-named` includes sessions with a nonempty name in their latest `session_info` entry. Named sessions are skipped by default.
- `--all-projects` includes sessions from every Pi project. Without it, the command scans only the current project's session storage; `/trash-history 60` therefore retains its project-local behavior.
- `--dry-run` scans and reports what would be eligible. It does not ask for confirmation and never invokes Trash.
- `--details` appends at most 30 eligible-session rows, ordered by size. Each row is only `date · size · cwd`; if more rows exist, the report says how many were omitted.
- `--dry-run --archive` only reports the planned archive name. It neither creates the archive directory nor writes a ZIP.
- Normal runs first show a bounded preview that identifies its scope and then require confirmation. In a non-interactive Pi mode they fail closed without moving anything; use `--dry-run` for a report instead.
- Invalid input is rejected, including missing days, decimal/scientific/signed values, leading-zero values, unknown flags, duplicate flags, and extra positional tokens. Flags may be in any order, but each may appear only once. A syntactically valid day count whose calculated cutoff is outside JavaScript's representable `Date` range is also rejected before scanning.

## What it scans

By default, the extension obtains the current project's actual runtime session directory from `ctx.sessionManager.getSessionDir()`; it does not construct a home-directory path. In this current-project scope, it scans only `.jsonl` files immediately in that directory and does not descend into child directories.

With `--all-projects`, it resolves the conventional global Pi session root as `join(getAgentDir(), "sessions")`. In this all-projects scope, it scans only:

1. `.jsonl` files immediately in that global root, and
2. `.jsonl` files immediately in each direct project-directory child.

Neither scope descends further.

A file is eligible only if its first JSONL entry is a Pi session header: `type: "session"` with the documented session identity fields (`id`, `timestamp`, and `cwd`; legacy headers may omit `version`). Arbitrary JSONL, empty-object JSONL, session-info-only files, and malformed headers are skipped as malformed.

It never moves directories. Every preview, confirmation, completion report, and audit record identifies whether it used `current-project` or `all-projects` scope.

## Preview and confirmation output

The standard preview and confirmation are structured and bounded. They show the scope, cutoff, and eligible session count and size. By default, they also show the count and size of **stale named sessions protected by the default policy**. With `--include-named`, they instead show the count and size of named sessions included. A named session that is active, unsafe, malformed, or too recent is not counted in either named-session total.

With `--archive`, the preview and confirmation also show the planned ZIP name. A successful completion report identifies the verified archive and its compressed size before reporting Trash outcomes.

After a confirmed batch, the completion report separately shows:

- `Moved to Trash`: the count and displayed size for files whose source path was successfully verified gone from the Pi session store;
- action-time skips, compactly grouped by reason with count and size; and
- action-time failures with count and size.

Those three outcomes reconcile to the original eligible selection. Moving a session to macOS Trash removes it from Pi session storage, but does **not** necessarily free disk space. Actual disk space is reclaimed only when macOS Trash is emptied.

Eligible candidates are summarized by the validated session-header `cwd`, compacted relative to the user's home directory when possible. Every eligible project is listed, ordered by eligible bytes, with `session count | size | project`.

Reports deliberately do **not** print session storage JSONL filenames, raw paths, session UUIDs, messages, or other session content. Use `--details` when a larger—but still bounded and metadata-only—candidate summary is needed.

## Safety behavior

Before a file can be selected, the extension canonicalizes the root and candidate and checks containment. It skips symlinks, non-regular files, files with more than one hard link, malformed or unreadable JSONL, and unsafe paths. The active file observed during the scan is excluded, including canonical-path aliases and matching file identity.

The scan creates a snapshot. Immediately before each serial Trash operation, the extension reads the active session again and revalidates regular-file and single-link status, containment, identity/unchanged metadata, cutoff, active-session exclusion, and named-session policy. Observable revalidation failures are skipped and reported.

On macOS, the extension first verifies that `/usr/bin/trash` is executable. It then invokes that fixed executable via Pi's argument-based command API using an absolute validated path. It does not use shell interpolation, Finder scripting, `rm`, `unlink`, or a permanent-delete fallback on session files. A successful command is counted as moved only after the original source path is gone; nonzero exits, thrown errors, timeouts, or a source path still present are failures.

With `--archive`, it also requires the fixed macOS `/usr/bin/env`, `/usr/bin/zip`, and `/usr/bin/unzip` tools. After confirmation, it revalidates every candidate, creates the ZIP in batches from the canonical session-root working directory, verifies the ZIP CRCs and its exact entry count, and confirms every archived source remained unchanged. It finalizes the ZIP without replacing an existing archive and only then starts serial Trash operations. Any archive creation, validation, source-drift, destination, or finalization failure aborts the complete Trash batch. A failed run can leave a private `.partial-<uuid>` ZIP in `~/.pi/archives/`; it is not trustworthy and no eligible session is moved by that run.

A compact, non-LLM audit entry is appended to the current session when possible, including the selected scope and when a completed scan has no candidates. The direct `/usr/bin/trash <path>` API has an unavoidable final pathname race: without a Pi-wide cooperating lock, another Pi process can change which session is active after the scan or immediately-before-action check. The extension therefore excludes the active file it observes at both checks and fails closed when it detects drift, but does not promise absolute active-session exclusion or complete race detection.

## Requirements and troubleshooting

- The command is macOS-only. Other platforms do not scan or change files.
- `/usr/bin/trash` must exist and be executable. If its preflight check fails, the entire batch is left untouched.
- `--archive` additionally requires `/usr/bin/env`, `/usr/bin/zip`, and `/usr/bin/unzip`, plus a writable `~/.pi/archives/`. Its archive directory is restricted to the current user and completed ZIPs are permissioned for that user.
- Start with `--dry-run`, especially for a low cutoff such as `0`.
- Trash is a recovery mechanism. Moving files there does not necessarily free disk space; emptying Trash later is the separate, permanent action that reclaims it.
