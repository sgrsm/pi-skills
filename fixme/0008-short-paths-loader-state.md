# 0008: Synchronize short-paths state across Pi loader instances

- **Status:** Resolved
- **Priority:** Medium
- **Evidence:** Confirmed by current source review; reproduced test-first and resolved using the public Pi/jiti loader and actual host row components
- **Areas:** `short-paths`, `hide-tool-output`
- **Instructions:** [Package workflow and validation](README.md)

## Original problem and audit evidence

The line references in this section describe the audit baseline, before the resolution below.

`short-paths/state.ts:23-27` exports a module-level state singleton. `hide-tool-output/index.ts:18-22, :53` imports that getter and holds its returned object.

Pi loads each extension through a separate jiti instance with `moduleCache: false` (`HOST/dist/core/extensions/loader.js:472-476`). The short-paths command and wrapped renderers therefore hold different state objects.

A probe loaded both extensions, used a fake agent directory, and rendered a read path at width 40. `/short-paths off` persisted false, but the wrapped renderer stayed in smart-shortening mode. Expected off output was different. Width matters: a path that already fits can mask this failure.

## Reproduce / test first

**Committed regression:** exercise independently instantiated command/renderer state plus the chosen synchronization channel. Prefer public `discoverAndLoadExtensions()` for a real-loader test using an isolated agent directory with links to the two extension entrypoints.

**Optional host probe:** use private `loadExtensions()` for explicitly selected entrypoints if public discovery is impractical, following the README's test-seam policy. Set an isolated `PI_CODING_AGENT_DIR` containing initial enabled state. Toggle off/on, render a path that exceeds the available width, and compare against explicit smart/off formatting.

Do not rely solely on native Node imports, which can share a module cache and miss the host-loader split. Never toggle the user's actual settings.

## Recommended fix

Use a supported cross-extension synchronization mechanism:

- Prefer a small `pi.events` state-change channel, with each consumer updating its own cache and refreshing tool rows.
- Alternatively re-read persisted state at an appropriate render/update boundary, with sensible error fallback and no excessive I/O.

Keep one owner for persistence, use `withFileMutationQueue()`, and initialize consumers correctly on startup/reload. Correct the READMEs' claim of automatic in-memory sharing. Coordinate refresh behavior with 0012 so synchronization does not erase per-block expansion.

## Acceptance criteria

- Off/on immediately affects all supported wrapped renderers under actual Pi loading.
- Narrow and wide rendering, default/invalid configuration, repeated toggles, and reload are covered.
- No duplicate event subscriptions or stale callbacks survive reload.
- Persistence format/command behavior remain compatible; normal home-path formatting is not confused with smart shortening.
- Hiding output, read-only execution, and session cwd delegation are unchanged.

## Validation commands

From `agent/extensions/`, with both scratch environment variables set as described in the package README:

```text
node --test pi-compatibility/short-paths-loader.test.ts hide-tool-output/index.test.ts hide-tool-output/renderStrategy.test.ts
node --test git-inspect/index.test.ts hide-tool-output/index.test.ts hide-tool-output/renderStrategy.test.ts pi-compatibility/short-paths-loader.test.ts
npm run verify
```

Related: [0012: expansion and refresh state](0012-tool-rendering-expansion.md).

## Confirmation and resolution

Confirmed against installed **Pi 1.0.0 / Node v22.19.0**. The requested read-only scout inspected current source, host docs/declarations, and related findings; it classified this as **confirmed** and made no changes. It had no shell/test tool and executed no tests. Its separate-jiti and public-event-bus conclusions were verified by the parent. Its concern about global expansion was valid for the old refresh, but the parent found the supported row-local alternative in `ToolRenderContext.invalidate()`.

The parent added regressions before executable changes. After correcting scratch-fixture creation/overwrite handling, the test-first public-loader run passed **1 test and failed 6**: four stale `read` headers at width 40 (both extension orders and both hiding modes), missing lifecycle subscriptions, and a failed save that had already changed command state. This is a fresh reproduction, not reliance on the historical optional probe. Missing/invalid/saved-off configuration was already passing.

### Implementation and preserved contracts

- `short-paths/state.ts` exposes the saved-state loader and a versioned `short-paths:state-change:v1` channel. Persistence remains `{ "enabled": boolean }`, queued with public `withFileMutationQueue()`. Each write captures its own snapshot; the compatibility cache updates only after a successful write.
- `short-paths/index.ts` owns command persistence, initializes a **per-factory/API** command cache, rereads it at startup, and publishes committed preferences. Failed saves do not change command state or notify consumers. Status, usage, completions, repeated-toggle behavior, and non-UI logging remain compatible.
- `hide-tool-output/index.ts` initializes its own cache, subscribes once per session startup, validates payloads, and redraws through public row-local `invalidate()`. Shutdown unsubscribes and clears registrations; host runtime invalidation is an additional subscription backstop. Loading order, renderer-only loading, rows built before startup, repeated startup, fresh reload, and same-runtime session replacement are covered.
- A Symbol-keyed registration belongs to each row's stable renderer state. The extension keeps only weak references, pruned on updates, so discarded transcript rows are not retained and identical call ids cannot overwrite another live row. No private UI traversal, file watcher, timer, or render-time filesystem read was added.
- The `/short-paths` global-expansion flip was removed. Existing rows retain actual mixed expansion and result visibility. Native self-rendered `edit`/`write` calls in visible mode remain native and intentionally do not change with this preference. Hiding, execution/delegation, schemas, result data, allowlists, and permissions-owned Bash were not changed. Existing cwd/read-only Git tests pass.
- Owning READMEs describe commands, failure/reload behavior, visible native-header exceptions, and cross-session limits without depending on temporary findings. Durable [state/rendering maintenance notes](../agent/extensions/short-paths/maintenance.md) and [regression coverage notes](../agent/extensions/pi-compatibility/short-paths-loader.md) hold the implementation contracts and test limits. Compatibility helper exports remain; direct `saveShortPathsState()` calls do not broadcast.

### Independent review and reconciliation

A fresh read-only reviewer inspected the implementation, new tests, host contracts, and parent logs. It executed no tests and found **no critical defects**, recommending conditional approval after focused refinements and closeout.

- **Callback lifetime (W1): verified in host source and remediated.** The first implementation strongly retained discarded host components until shutdown. Weak, row-owned registrations now avoid that retention. A deterministic real-host same-id regression was added first and failed (one redraw instead of two), then passed after remediation. A supplementary scratch GC probe verified that **24 discarded actual host rows were collected**, with **one redraw request** for the retained live control. No nondeterministic GC assertion was committed.
- **Real host refresh/expansion confidence (W2): addressed.** The earlier fake-context expansion assertion alone was insufficient. Public `ToolExecutionComponent` tests now exercise actual invalidation, both render slots, component reuse, expanded/collapsed result counts (**24/0 lines**), and partial/error results. They verify existing call headers change and revert without losing expansion; no live terminal is implied.
- **Coverage gaps (W3): addressed where portable.** Added renderer-only, pre-start reconciliation, per-smart-renderer narrow-width preconditions, and successful/already/usage/status notification checks. The suggested reused-factory cache issue also reproduced test-first (the second scope incorrectly reported `already off` and suppressed its broadcast), then passed with per-factory caches. The second red phase passed **10 tests and failed 2**. The factory test uses a scratch wrapper and separately scoped buses, not private cached-loader imports or complete independent SDK sessions.
- **Closeout (W4): addressed** in this finding, the index, 0012's stale evidence, and 0017's recommendation.
- The reviewer also suggested isolating arbitrary row-callback throws. No such failure was reproduced: the actual host catches renderer failures in `updateDisplay()`, and the new host-row regressions exercise that supported callback. No additional exception policy or TUI logging behavior was introduced.

The parent verified the findings, made the in-scope corrections, and reran validation. The reviewer did **not** re-review the final remediated state; the final checks below are parent-executed.

### Executed validation and limitations

- Focused command above: **17 passed**, none failed/cancelled/skipped.
- Related command above: **26 passed**, none failed/cancelled/skipped.
- Final `npm run verify`: **547 passed**, none failed/cancelled/skipped; TypeScript passed and all **five host dependency links** were valid. The pre-review full gate passed 543 tests. An intermediate post-review typecheck rejected four implicit-any test-wrapper parameters; those were given the original renderer's parameter types before the successful final gate.
- Supplementary public-host row-lifetime probe: **PASS** on version-checked Pi 1.0.0 with Node `--expose-gc`. Its first setup attempt used CommonJS resolution for an import-only package and failed before fixtures; resolving the current host link and its declared public export corrected the setup.
- All mutations were confined to repository work-package files or disposable fixtures in the approved canonical scratch root. No personal configuration, real user sessions, provider requests, external MCP servers, dependency installation/link changes, commits, or pushes were used.

Evidence artifacts are ephemeral, not prerequisites, under:

`/private/var/folders/br/m0tzwhrx6t77qjyr7846jwyc0000gn/T/pi/session-01a1026c-c2c4-72e1-8586-f6c91b9e0c4d/`

Files: `0008-test-first.log`, `0008-review-test-first.log`, `0008-focused.log`, `0008-related.log`, `0008-verify.log`, `0008-verify-final.log`, `0008-row-lifetime-probe.mjs`, and `0008-row-lifetime-probe.log`.

**Not executed:** a live regular/fullscreen terminal interaction, native edit-preview/file-preflight integration, complete cached-factory independent SDK sessions, or live provider/MCP checks. Public loader/runner and host component checks are real execution with synthetic state and a fake `requestRender`, not end-to-end TUI tests. Changes from other Pi processes/manual file edits are intentionally read only on startup/reload; they are not synchronized live. No required test was skipped.

### Related-finding rechecks

- **0012 remains Open.** Its `/short-paths` refresh portion is verified resolved, including real mixed row expansion; `/hide-tool` still flips global expansion, and visible `git_inspect` still ignores expanded options. Related tests passed, but those independent acceptance criteria were not implemented or established. Its evidence now distinguishes the resolved part from the remaining work.
- **0009 remains Open.** Source inspection still shows directly registered wrappers and delegated read creation without effective image options. Native/wrapped activation parity and image-setting acceptance checks were not run for 0008; no status change or unrelated runtime fix was made.
- **0017 remains Assessment complete — no retirement approved.** Only short-paths' cross-loader repair recommendation was updated; synchronization does not make native path rendering a complete replacement or authorize retirement.

### Re-check after 0009

Public-loader/row tests still pass; 0009 does not change renderers or synchronization. **0008 stays Resolved; 0012 stays Open**. The earlier Open note for 0009 is historical; see its [resolution](0009-wrapped-built-in-configuration.md#resolution-and-validation).
