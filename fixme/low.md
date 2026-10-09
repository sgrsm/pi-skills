### 4. Low — hidden `edit` summaries ignore the newly extended `outputPad` setting (resolved)

**Status:** Resolved.

**Files:** `agent/extensions/short-paths/toolCallSummary.ts`, `agent/extensions/pi-compatibility/short-paths-loader.test.ts`

**Original finding:** The hidden self-rendered `edit` summary did not apply `context.outputPad`. Fresh summaries retained one column at `outputPad: 0`, while reused native components could retain earlier padding.

**Resolution:** Apply `box.setPaddingX(context.outputPad ?? 1)` on every self-shell render, including reused components. Vertical padding and default-shell behavior are unchanged. User and maintainer documentation now describe padding behavior.

**Regression coverage:** The loader fixture explicitly supplies `outputPad`. Tests independently assert indentation for both values on the first render, changes in both directions, and native → hidden → native transitions with component identity preserved.

### 5. Low — document and test the new CLI modifier syntax at local integration boundaries (resolved)

**Status:** Resolved.

**Files:** `agent/extensions/subagent/agents.ts`, `agent/extensions/subagent/agents.test.ts`, `agent/extensions/pi-compatibility/cli-tool-selection.test.ts`

**Original finding:** Discovery accepted modifier frontmatter that became an invalid mixed CLI argument when the launcher appended plain `escalate_to_parent`. CLI modifiers also did not withdraw default-active local extension tools, unlike explicit exclusions.

**Resolution:** Reject trimmed `+`/`-` frontmatter entries early with a path-qualified diagnostic naming the offending entry. Existing plain allowlists and agent definitions remain unchanged. User guidance distinguishes agent allowlists, CLI modifiers, and explicit `--exclude-tools`; Pi's modifier behavior itself is unchanged.

**Regression coverage:** Discovery tests cover string/array modifiers, valid neighboring definitions, and project-to-user fallback. Public-parser and real offline CLI tests cover modifier selection, explicit exclusions, plain allowlists, mixed-list rejection, and startup/reload behavior.

### 6. Low / informational — Clarify is not reported as `blocked`

Clarify’s TUI selector and custom-answer editor use `ctx.ui.custom()`. Pi v1.1.0’s program-status implementation covers standard selectors, inputs, and editors, but not custom components.

Consequently, a supporting dashboard can show **working** while Clarify waits for the user. There is no public extension API to correct this directly.

**Action:** Document the limitation or report it upstream. Do not replace the custom selector solely for status reporting, since that would sacrifice its existing interaction features.
