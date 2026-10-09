### 4. Low — hidden `edit` summaries ignore the newly extended `outputPad` setting

**Files:** `agent/extensions/short-paths/toolCallSummary.ts:504–511`, `agent/extensions/pi-compatibility/short-paths-loader.test.ts:107–114`

In v1.1.0, tool rendering honors `outputPad`. The local self-rendered hidden `edit` summary still constructs `Box(1, 1, …)` without applying `context.outputPad`.

Confirmed with a rendering probe:

- `outputPad: 0`: native `edit` has no horizontal padding; hidden `edit` retains one column.
- Reusing a native component can preserve its previous padding, making the result dependent on toggle history.

Your current `outputPad: 1` setting generally masks this.

**Action:** Apply `box.setPaddingX(context.outputPad ?? 1)` on every render. Add explicit padding values to the loader fixture and cover both settings plus component reuse. The existing fixture omits the new field, so its native-versus-native comparisons are not sufficient coverage.

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
