# 0002: Serialize interactive dialogs and settle cancelled work

- **Status:** Open
- **Priority:** High — tool calls can hang
- **Evidence:** Permissions overlap/orphaning reproduced; parallel clarify overlap source-verified
- **Areas:** `permissions`, `clarify`; shared dialog helper if necessary
- **Instructions:** [Package workflow and validation](README.md)

## Problem and evidence

The `tool_call` handler in `permissions/index.ts:218-221` checks a file grant before prompting; its later Git/package branches do the same. The three `request*Permission` functions at `:369-440` are unqueued. Codemode can make nested calls concurrently. `HOST/dist/core/nested-tool-calls.js` serializes only explicitly sequential calls, and the extension runner's `withUIPrompt()` tracks nesting but does not queue dialogs.

The host's `showExtensionSelector()` replaces the displayed selector without resolving the earlier select promise. A probe emitted two nested `write` permission events, answered Deny in the second selector, and left the first event unresolved. It executed no writes.

`clarify/index.ts` also registers an interactive tool without sequential execution and does not use its execution signal to cancel its custom interaction. Parallel direct clarify calls can compete for the same UI. Long permissions/subagent titles can also be clipped in fullscreen; retain bounded prompts while touching this flow.

## Reproduce / test first

Emit two permission `tool_call` events with distinct ids and the same `parentToolCallId`. Use targets outside cwd but never run their execute functions. Hold the first UI promise; assert the second request cannot display until the first finishes.

Cover file, Git, and dependency requests; Allow once, Allow for session, Deny, custom instructions, abort while queued, abort while displayed, and shutdown/reload. Add a two-call clarify scheduling test.

## Recommended fix

- Introduce a session-scoped, abort-aware FIFO for permission interaction. Keep the whole select/custom-editor exchange inside the lock.
- Re-check enablement and scoped grants after acquiring the lock: an earlier Allow for session may make another prompt unnecessary.
- Pass supported dialog signals (`ctx.signal` / tool execution signal). Settle queued/displayed work fail-closed on cancellation and release the lock in `finally`.
- Mark clarify `executionMode: "sequential"` and make its custom selector/editor cancellation resolve exactly once. If multiple interactive tools still collide, use one shared session dialog queue rather than independent locks that cannot coordinate.
- Keep prompt summaries bounded; do not serialize all read-only or noninteractive tools.

## Acceptance criteria

- At most one owned interaction is displayed; no request is orphaned.
- Session grants eliminate eligible queued duplicate prompts without broadening grant scope.
- Abort/shutdown/reload leaves no unresolved queue or stale context use.
- No-UI guarded calls still block; Priority 0 hard denials never wait for or depend on approval.
- Clarify cancellation returns its existing cancelled result; model-only exposure remains.
- README expectations and focused tests reflect scheduling/cancellation.

## Validation

`npm run test:permissions`, `node --test clarify/index.test.ts`, and `npm run verify` with approved scratch. Use deterministic fake dialogs/signals, not real outside-cwd writes.

Related: [0003: clarify fullscreen input](0003-clarify-fullscreen-input.md). Coordinate changes to `clarify/index.ts`.
