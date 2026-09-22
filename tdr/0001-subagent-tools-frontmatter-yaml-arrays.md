# TDR-0001: Accept YAML arrays in subagent `tools` frontmatter

- **Status:** Open
- **Priority:** Low
- **Created:** 2026-09-22
- **Area:** `agent/extensions/subagent`
- **Origin:** Pi 0.87.0 extension compatibility audit

## Summary

Subagent discovery assumes that the `tools` frontmatter value is a comma-separated string. Pi parses frontmatter as YAML, so a valid YAML array produces an array value and causes discovery to call `.split()` on a non-string.

Current user agent definitions use comma-separated strings and are unaffected. This debt is not a Pi 0.87.0 regression or upgrade blocker, but it prevents compatibility with another valid form used by Pi's official subagent example.

## Evidence

`agent/extensions/subagent/agents.ts:60-69` declares the parsed frontmatter as `Record<string, string>` and normalizes tools with:

```ts
const tools = frontmatter.tools
  ?.split(",")
  .map((t: string) => t.trim())
  .filter(Boolean);
```

Because `parseFrontmatter()` uses a YAML parser, both of these forms are syntactically valid:

```yaml
tools: read, grep, find
```

```yaml
tools: [read, grep, find]
```

The second form produces an array at runtime and therefore has no `.split()` method.

The current definitions under `agent/agents/*.md` all use the first, comma-separated form. Pi's installed subagent example normalizes the frontmatter from `unknown` and accepts either strings or arrays.

## Consequences

- Importing an agent definition that uses array-valued `tools` can throw during discovery.
- One malformed or unsupported agent file may prevent other agents in the same discovery operation from loading.
- Agent definitions compatible with Pi's official example may not be compatible with this local extension.
- The failure mode is less clear than rejecting or safely ignoring an invalid value.

## Proposed remediation

1. Model raw frontmatter values as `unknown`, not `string`.
2. Add a small `parseToolList(value: unknown)` normalizer that:
   - splits comma-separated strings;
   - accepts arrays;
   - retains only string members;
   - trims values and removes empty entries;
   - returns `undefined` for unsupported or empty values rather than throwing.
3. Keep model and thinking selection settings-owned; this change should affect only `tools` parsing.
4. Document both supported `tools` forms in `agent/extensions/subagent/README.md`.

## Acceptance criteria

- A comma-separated `tools` string continues to produce the same allowlist.
- `tools: [read, grep]` produces `['read', 'grep']`.
- Empty strings and empty arrays produce no allowlist.
- Non-string values and non-string array members do not crash discovery.
- A bad `tools` value in one agent file does not prevent valid neighboring agents from being discovered.
- Focused tests cover string, array, empty, mixed, and malformed values.
- The full extension typecheck and test suite pass.

## Scope notes

This record does not propose enabling `model` or `thinking` agent frontmatter. Those values are intentionally controlled through `subagents.agentDefaults` in settings.
