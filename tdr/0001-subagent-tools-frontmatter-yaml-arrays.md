# TDR-0001: Accept YAML arrays in subagent `tools` frontmatter

- **Status:** Resolved
- **Priority:** Low
- **Created:** 2026-09-22
- **Area:** `agent/extensions/subagent`
- **Origin:** Pi 0.87.0 extension compatibility audit

## Summary

Subagent discovery originally assumed that `tools` frontmatter was a comma-separated string. Pi parses frontmatter as YAML, so a valid YAML array caused discovery to call `.split()` on a non-string. The defect remained reproducible with Pi 1.0.3.

Current user agent definitions use comma-separated strings and were unaffected. This was not a Pi 0.87.0 regression or upgrade blocker, but it prevented compatibility with another valid form accepted by Pi's official subagent example.

## Original evidence

The pre-resolution loader in `agent/extensions/subagent/agents.ts` declared frontmatter as `Record<string, string>` and normalized tools with:

```ts
const tools = frontmatter.tools
  ?.split(",")
  .map((t: string) => t.trim())
  .filter(Boolean);
```

Both of these forms are valid YAML:

```yaml
tools: read, grep, find
```

```yaml
tools: [read, grep, find]
```

The second produces an array at runtime and therefore has no `.split()` method. Unsupported non-null scalars and maps also threw; malformed YAML could throw before normalization. One bad definition could interrupt discovery of valid neighboring files.

Pi's installed subagent example accepts strings and arrays, filters out non-string array members, and treats unsupported or empty values as no allowlist. Copying that fallback exactly would silently remove a restriction: the local child launcher omits `--tools` when no allowlist exists. Although policy treats such agents as write-capable, that does not preserve the author's intended tool restriction.

## Resolution

Use strict per-file validation rather than silently discarding invalid tool values:

1. Treat raw frontmatter values as `unknown`; require a YAML mapping with non-empty string `name` and `description`.
2. Normalize comma-separated strings and YAML string arrays, including block sequences. Trim tool names and remove empty entries while preserving order and duplicates.
3. Preserve no-explicit-allowlist behavior for omitted, `null`, empty-string, and empty-array values. Empty does **not** mean zero tools.
4. Reject unsupported non-null types and any array containing a non-string member. Reject malformed YAML at the individual file boundary. Do not turn these failures into an unrestricted agent.
5. Continue discovering valid neighboring definitions and return path-qualified rejection diagnostics. Policy blocks/approval prompts include the diagnostics; execution reports warnings through UI notifications or stderr without UI.
6. Preserve source precedence: valid project definitions override same-name user definitions in `both` scope; rejected files do not enter the name map.
7. Document supported forms, empty-value semantics, invalid-definition handling, and source fallback in `agent/extensions/subagent/README.md`.

Discovery contracts and validation commands are maintained in `agent/extensions/subagent/maintenance.md`. Focused discovery tests are in `agents.test.ts`, with warning-delivery and policy-path coverage in `failureResults.test.ts`; the focused package test script includes both.

## Acceptance criteria

- A comma-separated `tools` string continues to produce the same allowlist.
- Inline and block YAML string arrays produce equivalent allowlists.
- Omitted/null/empty values produce no explicit allowlist.
- Unsupported types and mixed/nested arrays reject only the malformed definition, with a path-qualified diagnostic.
- Malformed YAML and invalid required fields do not prevent valid neighboring definitions from loading.
- User/project scope and valid same-name project precedence remain unchanged; rejected project definitions leave valid user definitions available in `both` scope.
- Diagnostics are visible for policy-blocked calls and for executions with or without UI, without contaminating stdout protocols.
- Model and thinking frontmatter remain ignored.
- Focused tests and the full extension typecheck/test gate pass before this record is marked resolved.

## Verification scope

The full extension contract gate is `npm run verify`. Pi 1.0.3 revalidation separated working host/local contracts from outstanding positive host acceptance checks under `npm run diagnose:pi-host`; those diagnostics continue to fail for the independent debt in TDR-0003 and TDR-0004. This record's resolution does not claim fullscreen clarify or SDK/CLI resume restoration is fixed. The frontmatter regression coverage and full contract gate meet this record's acceptance criteria.

## Scope notes

This resolution does not enable `model` or `thinking` agent frontmatter. Those values remain controlled through `subagents.agentDefaults` in settings. It does not introduce tool-name registry validation or change project trust, delegation approval, duplicate-name handling, or empty-list semantics.
