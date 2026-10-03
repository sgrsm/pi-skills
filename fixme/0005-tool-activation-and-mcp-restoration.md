# 0005: Preserve pending restored tools during extension startup

- **Status:** Open
- **Priority:** Medium; MCP impact latent while servers are disabled
- **Evidence:** Startup deactivation reproduced against actual host loadout method
- **Areas:** `subagent`, `clarify`, `web-search` — one change set
- **Instructions:** [Package workflow and validation](README.md)

## Problem and evidence

Pi preserves names of restored tools that have not reconnected yet. `HOST/dist/core/agent-session.js:1084-1092` clears these pending names when `setActiveToolsByName()` deactivates any currently active tool; add-only changes preserve them.

Local `direct`/`model-only` tools activate on registration. Startup then removes some:

- `subagent/index.ts:686-693, :2609`: `escalate_to_parent` is disabled in ordinary top-level sessions; subagents-off also removes `subagent`.
- `clarify/index.ts:487-495, :703-706`: persisted clarify-off.
- `web-search/index.ts:282-286, :400-405`: persisted search-off.

A probe seeded a synthetic pending MCP name and used the actual `AgentSession.prototype.setActiveToolsByName` contract. The real subagent startup handler removed `escalate_to_parent` and emptied the pending set. The other removal paths have the same cause.

## Reproduce / test first

**Committed regression:** extend `pi-compatibility` with registration plus startup/reload state. Use a public host session seam or a faithful loadout fake that drops pending names on subtraction. Seed pending synthetic MCP names; assert startup preserves them after the fix. Cover top-level/child escalation, subagents on/off, clarify on/off, search on/off, resume, and reload.

**Optional host probe:** run the same startup handlers against the actual host loadout method with synthetic pending state. Follow the README's test-seam policy instead of hard-coding private import paths.

Existing activation mocks simply track an array and cannot detect this host invariant. Use an isolated host session or faithful contract test, not a live MCP server.

## Recommended fix

- Register conditionally available tools with `defaultActive: false` where needed.
- Load persisted mode/parent-relay state early enough to choose activation deliberately.
- During `session_start`, only add eligible tools; do not register active tools just to subtract them.
- Keep explicit user commands allowed to deactivate tools: intentional user loadout changes may replace restoration.
- Preserve `model-only` exposure for clarify/subagent/escalation and ensure child `--tools` allowlists still permit escalation only where intended.
- Check restrictive CLI tool options and `defaultTools` precedence; avoid inadvertently resurrecting excluded tools.

## Acceptance criteria

- Pending restored MCP names survive startup and reload for all local off-mode combinations.
- Top-level escalation is neither declared nor callable; child relay behavior still works.
- Persisted off modes remain off; explicit toggles continue to work.
- Session tool choices, restrictive child allowlists, and model-only exposure are unchanged.
- Tests catch the original subtractive-startup behavior; READMEs reflect any visible activation changes.

## Validation

`node --test pi-compatibility/*.test.ts clarify/index.test.ts web-search/index.test.ts`, `npm run test:subagent`, then `npm run verify` with approved scratch.

Related: [0009: wrapped built-in activation](0009-wrapped-built-in-configuration.md); coordinate activation contracts without broadening this package.
