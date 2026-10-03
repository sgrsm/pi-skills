# 0008: Synchronize short-paths state across Pi loader instances

- **Status:** Open
- **Priority:** Medium
- **Evidence:** Reproduced with the actual jiti extension loader
- **Areas:** `short-paths`, `hide-tool-output`
- **Instructions:** [Package workflow and validation](README.md)

## Problem and evidence

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

## Validation

Add focused short-paths loader tests and run `node --test hide-tool-output/index.test.ts hide-tool-output/renderStrategy.test.ts`; then `npm run verify` with approved scratch.

Related: [0012: expansion and refresh state](0012-tool-rendering-expansion.md).
