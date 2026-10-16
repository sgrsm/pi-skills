# Handoff maintenance

Maintainer notes for the [handoff extension](README.md). Commands, examples and user-visible limitations stay in the README.

## File candidates and record limits

`index.ts` uses `buildCurrentSessionContext()` (the public Pi `buildSessionContext()` with the current leaf) for both conversation text and file candidates. It does not scan abandoned branches. A branch summary included in the selected context can still carry summarized file references from the branch it describes; compaction can already have lost detail.

`extractFileOps()` collects:

- Direct assistant `toolCall` arguments and the host's flat `toolResult.nestedCalls.calls` records: `read`/`grep` contribute read paths; `edit`/`write` contribute modified paths.
- `<read-files>` and `<modified-files>` blocks in compaction and branch summaries.

For direct and nested arguments, `addPath()` accepts string `path` values, strips a leading `@`, normalizes inline whitespace, and ignores empty paths and `.`/`./`. Sets deduplicate paths and the output arrays are sorted. Tagged summary paths are collected separately. Paths are recorded **attempts**, not verified filesystem outcomes: failed and unfinished calls remain candidates even if the parent tool result is an error. Do not infer paths from script text, ordinary result text, arbitrary `details`, or error messages.

### Host record bounds and incomplete notices

Pi 1.0.0 keeps nested-call metadata, never nested results, on the parent tool result. Its documented bounds are 256 calls per result, 8 KiB of arguments per call and 32 KiB of arguments per result. Oversized arguments are omitted; dropped metadata sets `complete: false`. Recheck the current installed Pi extension guide and `NestedToolCallRecord` declarations before changing this integration.

The extractor marks candidates incomplete for malformed containers/records, missing completeness, missing arguments, omitted arguments (`argumentsBytes`), or an `unfinished` status. Missing/malformed path arguments are ignored rather than guessed. A malformed path alone does not necessarily set the incomplete flag, and absent nested records cannot reveal activity the host never recorded. Loss from a non-file tool may set the flag too; the notice is intentionally conservative.

`buildSummaryUserPrompt()` includes the incomplete-record notice with candidate hints. `ensureRelevantFilesSection()` also preserves that notice in the saved document, inserting it into a model-written Relevant Files section if needed without replacing the model's selection or duplicating the notice.

### Model selection and fallback

The model receives read/modified candidates as hints and chooses materially relevant files. If it supplies a Relevant Files section, keep that selection. If the section is absent, `buildRelevantFilesSection()` adds a list capped by `MAX_RELEVANT_FILES` (12), taking modified paths first and then read-only paths; overlap is shown once as read and modified. The no-model/error fallback uses the same candidate collection and cap. Do not turn this candidate list into an exhaustive filesystem audit or a successful-change ledger.

## Validation

Focused regressions live in `fileOps.test.ts` and `summary.test.ts`: direct/nested parity, path normalization, failed/unfinished attempts, malformed or bounded records, notice placement/deduplication, model-selected file lists, the fallback cap, and exclusion of abandoned branches. A summary test also checks that assistant thinking blocks never reach the mocked model input or the returned `conversationText` (relying on the host's `serializeConversation()` omitting thinking), while visible text, tool calls and tool results remain. Summary tests use a mocked model and a no-model fallback, not live codemode/MCP/provider sessions.

Prepare the [approved scratch setup](../permissions/README.md#safe-test-scratch-setup), setting both `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR`, then run from `agent/extensions/`:

```bash
node --test handoff/fileOps.test.ts handoff/summary.test.ts
npm run verify
```

Use disposable session fixtures and mocked model completion; do not create or clear personal handoffs to validate extraction. Current host references are `docs/extensions.md` (nested tools), `docs/session-format.md` (active-branch context), and the exported message declarations. For general maintenance, see [extension maintenance](../maintenance.md).
