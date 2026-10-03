# 0007: Include codemode file operations in handoff documents

- **Status:** Open
- **Priority:** Medium
- **Evidence:** Source-verified
- **Area:** `agent/extensions/handoff`
- **Instructions:** [Package workflow and validation](README.md)

## Problem and evidence

`handoff/index.ts:504-545` (`extractFileOps`) collects direct assistant tool calls and tagged compaction/branch summaries. It skips every ordinary `toolResult`.

Pi stores tool calls made inside codemode in `toolResult.nestedCalls.calls`, not as standalone assistant calls. With `+codemode` enabled, the handoff's Relevant Files section omits files read/edited/written inside scripts.

The host's `dist/core/compaction/utils.js:16-21` explicitly handles nested records. Its extractor is an implementation reference, not a public runtime import to depend on.

## Reproduce / test first

Create an active-branch session context containing an assistant codemode call and a tool result with nested records for read, grep, edit, and write. Assert the collector recognizes those paths. Include direct calls and tagged summaries in the same fixture.

Test deduplication, sorted output, absent arguments, non-string paths, nested ids, failed calls, incomplete records, and abandoned branches. Do not execute the scripts or create real handoff documents merely to test the collector.

## Recommended fix

Add a small shared local operation-normalization path within handoff and apply it to direct tool-call blocks and bounded nested-call records. Continue consuming the authoritative current branch via `buildCurrentSessionContext()`.

Mirror current host treatment of recorded operations rather than silently filtering only successful nested calls: direct calls are already collected as attempts. Treat absent/truncated arguments conservatively. If `nestedCalls.complete === false`, acknowledge that file lists may be incomplete rather than inventing paths.

Extend and test the existing `extractFileOps` export (`index.ts:1330`); avoid importing private host compaction modules in production.

## Acceptance criteria

- Direct and nested read/grep/edit/write paths reach Relevant Files.
- Existing summaries, normalization, deduplication, and ordering remain valid.
- Malformed/partial records do not crash or create guessed paths.
- Abandoned session branches do not leak into the handoff.
- Generated fallback and model-written handoffs use the same collected operations.
- README notes nested-call support and bounded-record limitations.

## Validation

`node --test handoff/sessionContext.test.ts` plus focused new collector tests; `npm run verify` with approved scratch. Use synthetic messages and mocked model completion.
