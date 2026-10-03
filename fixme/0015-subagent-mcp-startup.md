# 0015: Avoid unnecessary MCP startup in restricted child sessions

- **Status:** Open — verify first
- **Priority:** Low; latent while all MCP servers are disabled
- **Evidence:** Host lifecycle/source observation; process amplification not reproduced with live servers
- **Area:** `agent/extensions/subagent`
- **Instructions:** [Package workflow and validation](README.md)

## Observation

Each child is a separate Pi process and normally loads built-in extensions, including MCP. MCP connects enabled servers on session_start/background startup. A restrictive `--tools` list prevents the child from reaching excluded tools, but may not prevent their servers from starting.

Once an MCP server is enabled, concurrent delegation (audited user `subagents.maxConcurrency` 12; code default 5, hard cap 32 in `subagent/settingsState.ts:48, :53`) could create unnecessary subprocesses/connections for read-only children that cannot use those tools. This is a resource/lifecycle concern, not evidence of an allowlist bypass.

Inspect `subagent/index.ts` child argument/environment construction, `HOST/docs/cli.md`, `docs/mcp.md`, and `dist/extensions/mcp/index.js`.

## Reproduce / test first

Use a disposable local mock MCP server that records starts/connections and exposes no external capabilities. Start a child configured only for read/grep/find; assert its callable registry excludes MCP and measure whether the mock server starts anyway.

Use bounded timeouts and existing child-process lifecycle tests. Do not enable the real IntelliJ server or any network service. Verify codemode/deferred/direct exposures separately because startup timing differs.

## Recommended fix

If reproduced, use a documented child-local way to suppress unneeded built-in MCP loading when the child's effective allowlist excludes all MCP tools. Allow MCP for children whose explicitly approved loadout needs it.

Do not change global/project mcp.json, copy credentials into scratch, disable all extensions (which removes local guards), or treat `--no-tools` as a server opt-out. Preserve project-trust inheritance and owned-process cancellation.

If the host provides no safe public child-only control, record the limitation and its measured impact; do not invent a private flag or patch the host installation.

## Acceptance criteria

- Restricted children cannot call MCP/codemode outside their allowlist, before and after the change.
- A verified supported opt-out avoids unnecessary mock-server startup without disabling safety extensions.
- Permitted children retain required MCP functionality.
- Concurrent children and abort/shutdown leave no owned server/process leaks.
- User settings and real credentials/config remain untouched.
- If not reproduced or not safely fixable, resolution includes precise evidence and limitations.

## Validation

`npm run test:subagent`; a focused mocked MCP lifecycle test; `npm run verify` with approved scratch.

Existing transient-project-trust debt remains separate in [TDR-0002](../tdr/0002-propagate-transient-project-trust-to-subagents.md).
