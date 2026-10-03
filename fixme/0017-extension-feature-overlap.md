# 0017: Built-in feature overlap and extension retirement assessment

- **Status:** Assessment complete — no retirement approved
- **Priority:** Informational
- **Evidence:** Local READMEs/runtime, installed built-in list, and Pi 1.0.0 docs
- **Instructions:** [Package workflow](README.md)

## Conclusion

None of the remaining 12 local runtime extensions has a complete built-in replacement. Keep them while fixing their compatibility issues. The custom MCP bridge and IDEA connector were already retired in repository history; do not recreate them.

`HOST/dist/extensions/index.js` lists the shipped built-ins: llama.cpp, codemode, tool-search, and MCP. Permission-gate, subagent, handoff, and renderer implementations under `HOST/examples/extensions/` are examples, not automatically enabled features.

## Assessment and recommended action

| Extension | Overlap | Recommended action |
|---|---|---|
| clarify | Generic host dialogs only; no equivalent model-callable workflow | Keep; fix fullscreen, scheduling, and prompt composition |
| codex-verbosity | Thinking controls are not text verbosity | Keep; fix provider-coverage feedback |
| git-inspect | Bash can run Git, but lacks this fixed read-only interface | Keep; improve visible result expansion/metadata |
| handoff | Native sessions, forks/clones, compaction and summaries | Keep portable documents/injection/continuation; [nested file lists resolved (0007)](0007-handoff-nested-file-operations.md) |
| hide-tool-output | Native collapse/expansion | Keep persistent hide preference; [native-wrapper configuration resolved (0009)](0009-wrapped-built-in-configuration.md) |
| mcp-status | /mcp already provides detailed state/diagnostics | Keep optional always-visible config footer; fix parsing/display drift |
| permissions | No shipped general approval layer or equivalent P0 policy | Keep; fix dialog scheduling and state explicit boundaries |
| response-timer | Host status API and lifecycle hooks only | Keep; fix lifecycle/color/docs drift |
| short-paths | Native home shortening and compact path rendering | Keep user-controlled smart shortening; [cross-loader state resolved (0008)](0008-short-paths-loader-state.md) |
| subagent | Codemode orchestrates tools, not isolated child agents | Keep policy/delegation/relay; fix restoration and failure accounting |
| trash-history | Native /resume supports deleting individual sessions | Keep bulk age/scoped cleanup and verified archives; fix confirmation/custom scope |
| web-search | MCP could supply a separately configured search server | Keep existing SearXNG tool; no current equivalent configured server |

References: owning extension READMEs; `HOST/docs/extensions.md`, `settings.md`, `sessions.md`, `session-format.md`, `slash-commands.md`, `mcp.md`, `security.md`, and changelog 0.99.0–1.0.0.

### Re-check after 0007

The nested-list acceptance criteria are now verified: direct/nested attempts feed the same model/fallback candidates, known record loss is disclosed, and unselected raw branches are excluded. Final checks passed 22 focused and 535 full-gate tests, TypeScript and an in-memory actual-host recorder probe; these do not establish a shipped replacement for portable documents or continuation commands. This updates only handoff's fix recommendation, not the assessment status or retirement authorization. See [0007](0007-handoff-nested-file-operations.md) for evidence and limits.

### Re-check after 0008

Cross-loader preference synchronization and row-local refresh are now verified with the public Pi loader and actual host components. Final validation passed 17 focused and 547 full-gate tests, TypeScript and five host links. This updates only short-paths' repair recommendation; native path display still does not replace its user-controlled smart shortening. Assessment status and retirement authorization are unchanged. See [0008](0008-short-paths-loader-state.md) for review outcomes and limits.

### Re-check after 0009

[Wrapper configuration is resolved](0009-wrapped-built-in-configuration.md#resolution-and-validation); native expansion still does not replace persistent hiding. Assessment status and retirement authorization are unchanged.

## If simplification is requested later

The strongest preference-based retirement candidates are handoff, trash-history, hide-tool-output, short-paths, and mcp-status. These are workflow trade-offs, not obsolete compatibility shims.

Before proposing removal:

1. List the exact functionality/policy lost versus native Pi.
2. Verify actual load order, tools/commands, state files, and consumers.
3. Preserve permissions' ownership of Bash and its hide-tool-output integration.
4. Keep handoff/session/archive data; do not delete state merely because an extension is disabled.
5. Obtain explicit user approval for the changed workflow; disable reversibly before deleting code.
6. Validate that the replacement is shipped/enabled, not merely an example or a potential third-party MCP integration.

## Acceptance criteria for this assessment

- All 12 runtime extensions are accounted for.
- Partial overlap is distinguished from equivalent replacement.
- Already-retired MCP implementations are not treated as remaining backlog.
- No extension is disabled or removed as part of this documentation task.
- Future retirement requires a separate explicit decision, not an agent's inference from the fixme folder.
