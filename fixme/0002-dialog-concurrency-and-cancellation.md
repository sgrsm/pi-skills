# 0002: Serialize interactive dialogs and settle cancelled work

- **Status:** Resolved
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

## Resolution

Implemented for the two owning extensions, `permissions` and `clarify`, against installed Pi **1.0.0**, Node **v22.19.0**.

- Added `shared/dialogQueue.ts`: one abort-aware session FIFO, shared through Pi's public event bus even when jiti loads separate helper/API instances. Whole selector/custom-instructions exchanges own the lock. Shutdown/reload aborts displayed and queued work, removes the rendezvous subscription, and fresh runtimes receive a fresh queue. Read-only/noninteractive work is not serialized.
- File, Git, and dependency approvals re-check enablement and existing scoped grants after acquiring the lock. Late answers cannot grant cancelled requests. No-UI blocks and Priority 0 denials remain outside the queue. Read-only Git/project discovery now also receives the captured operation/session signal, so shutdown during preflight cannot continue through stale API calls.
- `/permissions` uses the same FIFO, gathers current grants when its interaction opens, and applies Clear before releasing the lock.
- Clarify remains model-only, declares sequential execution, observes both its execution signal and `ctx.signal`, and preserves `User cancelled the clarification.` on cancellation. Custom completion and disposal are idempotent, including the factory/installation microtask window.
- TUI permission choices use a compact three-line title; bounded request details are persistent warning notifications (ordinary info notifications coalesce in Pi). RPC selectors contain bounded request details directly. Details are capped at 8,000 characters. Oversized permission requests fail closed: only Deny/Custom instructions are offered, with explicit truncation/no-approval notices; invalid RPC replies cannot create grants for hidden scopes. The cap does not change actual grant scope.
- Pi 1.0 `ui.editor()` has no cancellation signal. With explicit user approval, RPC custom answers use cancellable `ui.input()` instead; prefill becomes a placeholder. TUI custom answers retain an in-Pi prefilled multiline editor. Also with explicit user approval, these editors disable external-editor launch (normally Ctrl+G): the host external-editor process has no abort handle and can restart the terminal after cancellation.
- Updated owning/shared/compatibility READMEs and the index. No personal settings, dependency links, trust rules, tool allowlists/exposure, or other work packages changed.

### Reproduction and review verification

The smallest focused test-first run passed 4 existing/control tests and failed **41** regressions: overlapping nested approvals, parallel clarify dialogs, and missing sequential metadata. The public `discoverAndLoadExtensions` regression also reproduced overlap across actual loader instances. No guarded execute function ran.

A reviewer subagent inspected the implementation. Parent verification confirmed and remediated the omitted `test:permissions` entry, RPC scope visibility, stale `/permissions` state, and missing lifecycle/UI coverage. Review regressions failed before their fixes. The external-editor configuration observation was superseded by the explicitly approved no-external-editor behavior; a fake terminal test reproduced the attempted uncancellable launch before the fix. Added both loader registration orders and real shutdown/invalidation/new-instance reload on the same bus, custom UI pre-install/synchronous/throw/pre-abort branches, narrow host selector dock-fit checks, and TUI permission-editor cancellation. Tests inject clarify state rather than using personal configuration as a fixture.

The follow-up reviewer identified that front-truncating oversized approval details could conceal later scopes while still permitting approval. Parent verification reproduced this in both RPC and TUI with a synthetic multi-target `tee` call (no execution). Two further test-first failures were remediated by removing all approval choices for oversized requests, validating replies against displayed choices, and making truncation explicit. Focused tests also protect Unicode-safe truncation. No remaining in-scope reviewer blocker was left unaddressed.

### Actual validation

All commands ran from `agent/extensions/` with `PI_PERMISSIONS_TEST_SCRATCH_ROOT` and `TMPDIR` set to a caller-created private session scratch root containing `.step1-test-root-ready`:

- `npm run test:permissions`: **125 passed**, 0 failed/cancelled/skipped, including the new permission and shared dialog regressions.
- `node --test clarify/index.test.ts`: **14 passed**, 0 failed/cancelled/skipped.
- `node --test pi-compatibility/dialog-concurrency.test.ts`: **4 passed**, 0 failed/cancelled/skipped.
- `npm run verify`: valid host links, TypeScript passed, **323 tests passed**, 0 failed/cancelled/skipped.

Artifacts: `/var/folders/br/m0tzwhrx6t77qjyr7846jwyc0000gn/T/pi/session-01a0ff3f-506d-7099-ac28-3563e25ed9e5/dialog-tests/` (`test-first.log`, `review-test-first.log`, `analysis-test-first.log`, `scope-test-first.log`, `permissions-final.log`, `clarify-final.log`, `compatibility-final.log`, `verify-final.log`).

Tests use fake dialogs/signals/terminal writes and disposable loader fixtures. No live outside-cwd mutations, Trash operations, model calls, or external MCP servers were used. No live-terminal test was performed.

### Remaining boundaries

- Scheduling coordinates the owning permissions and clarify interactions, including `/permissions`. Subagent escalation/approval, handoff, Trash, and other unrelated extension dialogs are not enrolled in this change set; a raw host dialog can still replace an interaction. The shared helper is available for future coordinated migrations. This limitation is recorded rather than silently broadening the selected package.
- Pi's RPC protocol has no dialog-dismissal event. Cancellation removes pending select/input requests and settles owned work, but the RPC client controls whether an obsolete dialog remains visible. Late client replies cannot approve cancelled work.
- Clarify's existing fullscreen keyboard/mouse ownership issues remain in 0003; this package changes cancellation cleanup, not that interaction contract.
