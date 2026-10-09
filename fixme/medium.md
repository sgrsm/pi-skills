### 1. Medium — v1.1.0 breaks the extension verification gate

**Files:** `agent/extensions/pi-compatibility/clarifyUiFixture.ts:30–36`, `agent/extensions/pi-compatibility/trash-confirmation.test.ts:32–37`

Pi v1.1.0 adds the required `Terminal.setProgramStatus()` method for OSC 7501 reporting. Both fake-terminal fixtures omit it.

- Against **v1.0.4**, the unchanged extension code typechecks.
- Against **v1.1.0**, `npm run verify` stops at typechecking with four diagnostics arising from these two fixtures.
- These are test-fixture incompatibilities, not failures of the running Clarify or Trash extensions.

**Action:** Add `setProgramStatus() {}` to both fake terminals, then rerun the verification gate.

### 2. Medium — refresh host links before relying on upgrade validation

**Paths:** `agent/extensions/node_modules/@earendil-works/*`, `agent/extensions/node_modules/typebox`  
**Guidance:** `agent/extensions/pi-host-deps/README.md:26`

All five host-package links still target **v1.0.3**, although the active release is v1.1.0. The explicit v1.1.0 host-link check rejects them.

The stale links predate this upgrade; the **new v1.1.0 consequence** is managed-release pruning. Subsequent updates retain only the active release and the release performing the update, putting the old linked tree at risk of removal. Direct tests and TypeScript validation would otherwise continue using old packages.

This does **not** mean normal Pi-loaded extensions run against v1.0.3: Pi’s extension loader aliases these imports to its own host packages.

**Action:** Refresh the links explicitly:

```bash
cd ~/.pi/agent/extensions
PI_HOST_PACKAGE_ROOT="$HOME/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-coding-agent" \
  npm run sync:pi-host-deps
```

Update the guidance that ordinary updates leave paths unchanged to distinguish managed, versioned installs. No dependency installation is needed.

### 3. Medium, conditional — new program-status reporting exports subagent prompt/task text

**Files:** `agent/extensions/subagent/index.ts:1241`, `:1587–1600`, `:2784–2793`

Pi v1.1.0 sends standard dialog titles to supporting terminals and dashboards as OSC 7501 `blocked` messages. The subagent extension uses detailed, multiline titles containing:

- a preview of the latest user prompt;
- delegated task previews;
- child clarification questions and reasons.

The host forwards the **whole title**, subject to sanitization and a 2 KiB cap, rather than just its first line. A synthetic protocol probe confirmed that prompt text survives into the status message.

This is a new metadata channel, not evidence of network transmission or a privilege-boundary bypass. It applies when the terminal supports the protocol or `PI_PROGRAM_STATUS=1` is set.

**Action:** Use content-free dialog titles and retain request details in the visible dialog/preview. Until then, use `PI_PROGRAM_STATUS=0` if terminal/dashboard status metadata should not contain task content.
