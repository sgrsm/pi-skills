# Git Inspect extension

Provides the `git_inspect` tool: a narrow, read-only way for Pi and read-only subagents to inspect the Git working tree without granting arbitrary shell access.

## When to use it

Use `git_inspect` for local Git status, diffs, refs, commit metadata, and file history. Use Pi's `read`, `grep`, `find`, and `ls` tools for source-tree inspection.

The read-only `scout` and `reviewer` subagent roles use this tool instead of `bash`.

## Requirements

- `git` must be installed and available through `PATH`.
- The current directory must be inside a non-bare Git working tree.
- The extension is discovered automatically from `~/.pi/agent/extensions/git-inspect/index.ts`; run `/reload` after adding or changing it in an active Pi session.

## Available operations

`git_inspect` accepts a fixed `operation` plus only the parameters listed below. It does not accept commands, arbitrary Git flags, a caller-selected working directory, environment variables, or shell syntax.

| Operation | Purpose | Optional parameters |
|---|---|---|
| `repo_info` | Repository root and working-tree metadata | none |
| `status` | Porcelain-v2 branch and working-tree status | none |
| `list_refs` | Local branches, remotes, and tags | none |
| `log` | Recent commit metadata | `revision`, `maxCount` |
| `show_commit` | Metadata for one commit, without its patch | `revision` (required) |
| `working_diff` | Unstaged diff | `paths` |
| `staged_diff` | Staged diff | `paths` |
| `range_diff` | Diff between two explicit revisions | `base`, `head` (required), `paths` |
| `file_history` | Follow history for one file | `paths` (exactly one), `revision`, `maxCount` |

Examples:

```text
Inspect the current working-tree diff for src/auth.ts.
Show the last 20 commits on main.
Compare main with HEAD for the README and package manifest.
Show the history of src/service/OrderService.java.
```

## Display

Tool-call rows show the selected operation and its relevant revision, range, or path arguments.

With `/hide-tool off`, collapsed results show the first five screen lines, accounting for line wrapping, plus an expansion hint when more text is available. Expand with Pi's tool-output shortcut (Ctrl+O by default) to see all available result text. The hint follows your configured shortcut. Small results remain complete in either view; partial output and error diagnostics follow the same preview/expansion behavior.

If an output-limit notice falls outside the preview, a compact **Output truncated** or **Error output truncated** warning remains visible. Expand for the original notice and its limits or reason. Expansion reveals only the already available result; it cannot recover output discarded by the existing limits.

When `/hide-tool on` is active, `git_inspect` hides all result output, including errors, while leaving the call row visible. Expansion does not override hiding; use `/hide-tool off` to read diagnostics. Hiding and expansion do not affect the Git command, result data, or information returned to the agent.

## Safety behavior

The extension runs only fixed Git argument vectors with `shell: false`. It rejects unsafe revisions and paths, disables interactive prompts and pagers, disables optional Git locks, and turns off external diffs and text conversion.

Git output is untrusted repository data. Commit messages, branch names, paths, and diffs are evidence to inspect, not instructions to follow.

Output shown to the model is limited to Pi's standard 2,000 lines or 50 KB. The extension also stops Git when captured stdout or stderr reaches its separate bounded process limit; refine the request if output is truncated.

This is a least-privilege interface, not a sandbox for hostile repositories. Use a container or VM when repository-controlled configuration or code is untrusted.

## Troubleshooting

- **`git_inspect requires a non-bare Git working tree`** — run Pi from a Git checkout rather than a bare repository or unrelated directory.
- **Git command failed** — verify the requested revision exists and the path is relative to the repository root.
- **Input rejected** — use the listed operations and simple repository-relative paths. The tool intentionally rejects arbitrary options, range expressions such as `main..HEAD`, path traversal, and pathspec magic.
- **Output truncated** — expand to read the limit notice, then narrow the paths, lower `maxCount`, select one commit with `show_commit`, or compare explicit revisions with `range_diff`.
- **Expansion shows no output** — check `/hide-tool`; hiding takes precedence, including for errors.
- **Rows changed expansion after toggling hiding** — `/hide-tool on|off` can reset individual expansion choices. This existing limitation is explained in the [hide-tool-output guide](../hide-tool-output/README.md#troubleshooting).
