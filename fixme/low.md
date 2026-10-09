### 4. Low — hidden `edit` summaries ignore the newly extended `outputPad` setting (resolved)

**Status:** Resolved.

**Files:** `agent/extensions/short-paths/toolCallSummary.ts`, `agent/extensions/pi-compatibility/short-paths-loader.test.ts`

**Original finding:** The hidden self-rendered `edit` summary did not apply `context.outputPad`. Fresh summaries retained one column at `outputPad: 0`, while reused native components could retain earlier padding.

**Resolution:** Apply `box.setPaddingX(context.outputPad ?? 1)` on every self-shell render, including reused components. Vertical padding and default-shell behavior are unchanged. User and maintainer documentation now describe padding behavior.

**Regression coverage:** The loader fixture explicitly supplies `outputPad`. Tests independently assert indentation for both values on the first render, changes in both directions, and native → hidden → native transitions with component identity preserved.

### 5. Low — document and test the new CLI modifier syntax at local integration boundaries

**Files:** `agent/extensions/subagent/agents.ts:37–50`, `agent/extensions/subagent/index.ts:1922–1936`, `agent/extensions/pi-compatibility/tool-activation.test.ts:252–276`

Two confirmed limitations:

- Agent frontmatter such as `tools: +codemode` is accepted by discovery, but the launcher appends plain `escalate_to_parent`. Pi v1.1.0 rejects the resulting mixed modifier/allowlist argument.
- `--tools -clarify,-subagent,-web_search,+codemode` does **not** withdraw those default-active local tools. Explicit `--exclude-tools` does.

All four existing agent definitions use plain allowlists and are unaffected. Your `defaultTools: ["+codemode"]` configuration also works.

**Action:** Preserve the frontmatter allowlist contract by rejecting modifier entries early with a path-qualified diagnostic. Document the distinction between modifier selection and explicit exclusions, and add focused coverage for the new CLI path.

### 6. Low / informational — Clarify is not reported as `blocked`

Clarify’s TUI selector and custom-answer editor use `ctx.ui.custom()`. Pi v1.1.0’s program-status implementation covers standard selectors, inputs, and editors, but not custom components.

Consequently, a supporting dashboard can show **working** while Clarify waits for the user. There is no public extension API to correct this directly.

**Action:** Document the limitation or report it upstream. Do not replace the custom selector solely for status reporting, since that would sacrifice its existing interaction features.
