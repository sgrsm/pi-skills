# 0007: Include codemode file operations in handoff documents

- **Status:** Resolved
- **Priority:** Medium
- **Evidence:** Confirmed by read-only source review and parent-executed in-memory regressions; resolved on Pi 1.0.0
- **Area:** `agent/extensions/handoff`
- **Instructions:** [Package workflow and validation](README.md)

## Original problem and audit evidence

At the audit baseline, `handoff/index.ts:504-545` (`extractFileOps`) collected direct assistant tool calls and tagged compaction/branch summaries. It skipped every ordinary `toolResult`. The original line references below are historical; current implementation references are recorded under Resolution.

Pi stores tool calls made inside codemode in `toolResult.nestedCalls.calls`, not as standalone assistant calls. With `+codemode` enabled, the handoff's file candidates consequently omitted files read/edited/written inside scripts.

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

`node --test handoff/sessionContext.test.ts handoff/fileOps.test.ts handoff/summary.test.ts`; `npm run verify` with approved scratch. Use synthetic messages and mocked model completion.

## Confirmation and decision

A read-only scout classified the finding **confirmed** after inspecting current local code, Pi docs/declarations, the nested recorder, compaction extractor, and branch-context builder. The scout had no command tool: it executed no tests or probes and made no changes. The parent independently located the host through ESM package resolution: Pi **1.0.0**, Node **v22.19.0**. No repeated confirmation investigation was needed.

Evidence at confirmation:

- The original collector handled assistant calls and tagged summaries but no `toolResult.nestedCalls` (historical lines above).
- Host `docs/extensions.md` documents bounded nested records. Public `pi-ai/dist/types.d.ts:398-432` declares optional arguments, `argumentsBytes`, statuses, `calls`, `complete`, and `ToolResultMessage.nestedCalls`.
- Host `dist/core/nested-tool-calls.js:12-76` records at most 256 calls, omits arguments above 8 KiB per call / 32 KiB aggregate, and reports incomplete/unfinished records. Nested ids can have several `/` components; calls at every depth share the flat record.
- Host `dist/core/compaction/utils.js:16-21` collects nested attempts without filtering successful status. Its helper recognizes read/edit/write, not grep; nested grep is the existing local collector's explicit compatibility requirement.
- Current-context construction uses public `buildSessionContext(getEntries(), getLeafId())`, preserving the host projection instead of scanning all raw history.

The parent reproduced the remaining defect test-first. The first collector + baseline run had **6 passes / 8 failures**: nested paths and incomplete notices were missing. One expected punctuation sort order was corrected to the existing `localeCompare` ordering before implementation. The new mocked-summary test file initially failed to load because its local summary-function export seam did not yet exist; that was not a separate runtime defect reproduction.

The scout also noted that model-written Relevant Files sections are intentionally selective. This existing contract was preserved: every collected operation becomes a candidate, not a mandatory final bullet. No overwrite/expanded file-list behavior was introduced.

## Resolution

- `handoff/index.ts:507-572`: one local normalization helper now handles direct and nested read/grep/edit/write attempts. Valid string paths use the existing normalization, deduplication and sorting. Missing/malformed records or arguments cannot crash collection or create guessed paths; script text, result content, error text, and tool-specific details are not mined for paths.
- `FileOps.incomplete` is optional and present only when nested information is missing/unfinished, retaining the old two-list shape for complete contexts. `complete === false`, omitted arguments, malformed records and unfinished calls are treated conservatively. No status or id-depth filter drops known attempts.
- `index.ts:579-664, 997-1070`: the same collected operations feed model candidates and fallback output. Known record loss reaches the model prompt and final document as **“File lists may be incomplete”**, including when the model supplies its own section. Exact echoed notices are not added again. The model's lean selection and fallback's modified-first, 12-file cap remain intact.
- `index.ts:319-321`: authoritative current-branch context is unchanged. Deliberately included branch-summary file tags remain valid, while raw unselected branches and their incomplete flags stay excluded.
- `summarizeCurrentSession` is exported as a local, in-memory test seam; production imports remain public. No private host imports, tool-exposure/permission changes, dialogs, dependency changes, or personal settings changes were introduced.
- The extension README now explains nested support, attempted-versus-successful operations, branch scope, selective output, host bounds and conservative notices.

### Acceptance verification

| Criterion | Evidence |
|---|---|
| Direct/nested read/grep/edit/write candidates | `fileOps.test.ts` mixed direct/nested/summary fixture; `summary.test.ts` checks actual model prompt and fallback/document paths |
| Summaries, normalization, deduplication, ordering | Mixed compaction/branch tags, `@`, blank/root paths, overlap and sorted-list regressions |
| Malformed/partial data and no guessed paths | Invalid containers/arguments, omitted arguments, dropped-record marker, deep ids, failed/unfinished attempts and no script/error/details inference |
| Abandoned branches excluded | Public current-leaf projection test checks both raw paths and incomplete flags |
| Model and fallback parity | Mocked model, no model, thrown completion and empty completion; selection/cap, complete-record negative notice, echoed notice and suffixed heading checks |
| Documentation and bounded-record caveat | Directory-local README; final-output notice regressions plus actual-host recorder probe |

## Independent review and reconciliation

A fresh read-only reviewer found **no blocking runtime defects**. It inspected local/host source and all handoff tests, but had no command tool and executed no validation itself. The parent verified its suggestions and added a fixture typed against public `NestedToolCalls`, a complete-record prompt negative check, and notice-echo/suffixed-heading coverage; README wording now states that non-file record loss can also trigger a conservative notice. These were test/docs refinements, not additional runtime changes. Final validation below was rerun after them; the refined tests/docs were not sent through a second review.

Optional observations were not promoted into defects: the completeness bit cannot identify which dropped calls touched files, exact notice deduplication is document-wide, and a missing persisted top-level result provides no nested record to inspect. No scope expansion or unrelated fix followed.

## Executed validation and limitations

Parent-executed checks, distinct from the subagents' source-only reports:

- Baseline `node --test handoff/sessionContext.test.ts`: **4 passed**.
- Final focused command above: **22 passed**, none failed/cancelled/skipped.
- Final `npm run verify`: **535 passed**, none failed/cancelled/skipped; TypeScript passed and all five host dependency links were valid.
- The first full gate had **521 passes / 1 failure (522 tests counted)** because the structured-prompt fixture compared canonical `/private/var/...` with aliased `/var/...`. Setting **both** `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR` to the canonical approved session root fixed the setup, without code/config changes. Its nested checks ran on the successful retry.
- Supplementary **inline, version-checked private-host probe** passed on Pi 1.0.0. Resolved the host root through `import.meta.resolve`, then explicitly imported `NestedCallRecorder` with `pathToFileURL` (not a committed/production import). In memory, recorded read/grep, failed edit, successful write, oversized-argument write, unfinished write, and enough extra reads to exceed 256; verified omitted/dropped paths were not invented, known attempts survived, and a model-written section showed the notice. A second recorder with five approximately 7 KiB argument payloads verified aggregate omission. This is an actual recorder/component probe, not live codemode or terminal execution; no probe file is required.

Full-gate fixtures used the caller-created sentinel and private current-user-owned approved session scratch outside HOME/repository/cwd. Logs are ephemeral under `/private/var/folders/br/m0tzwhrx6t77qjyr7846jwyc0000gn/T/pi/session-01a1020f-d2d1-72e1-8586-f6c7948e92fe/`: `0007-focused.log`, `0007-verify.log` (initial setup failure), `0007-verify-canonical.log`. They are not prerequisites for reproducing the repository regressions.

Skipped deliberately: live provider/model requests, enabled MCP servers, live TUI/codemode execution, real handoff creation/deletion, installs, commits and pushes. Bounded/missing records cannot recover omitted paths; earlier summaries may already have lost detail. File candidates remain attempts, and model output remains selective—not an exhaustive filesystem audit.

## Related rechecks

- **0017:** updated only the handoff recommendation to reference the verified nested-list resolution. The overall assessment remains complete with no retirement approved; portable documents/continuation still have no complete shipped replacement.
- **0009:** source recheck of `hide-tool-output/index.ts` shows built-in names/arguments are preserved, so the collector remains compatible. Its independent activation/resize-option issues are unchanged; native/wrapped parity acceptance was not established by these handoff tests. **Remains Open**; no wrapper changes.
- **0016:** source recheck still finds missing owned annotations and the existing bash/write/edit-focused permission boundary. Handoff collection does not change metadata, hooks, guards or exposure. The full gate passed their existing tests, not the finding's unimplemented acceptance criteria. **Remains Open**; no policy changes.
- No shared executable file outside handoff was changed. Other finding/TDR statuses were not changed. Passing known-debt characterizations in the full gate does not resolve those debts.
