### 2. Medium — correct host-link guidance for managed upgrades

**Paths:** `agent/extensions/node_modules/@earendil-works/*`, `agent/extensions/node_modules/typebox`  
**Guidance:** `agent/extensions/pi-host-deps/README.md:26`

All five host-package links now target **v1.1.0** and pass the explicit host-link check. The link-refresh portion is resolved; the documentation action remains open.

The guidance still says ordinary updates leave paths unchanged, but managed releases use versioned paths. Pi v1.1.0 adds managed-release pruning: subsequent updates retain only the active release and the release performing the update, putting an old linked tree at risk of removal. Direct tests and TypeScript validation would otherwise continue using old packages.

Stale links do **not** mean normal Pi-loaded extensions use the old release: Pi’s extension loader aliases these imports to its own host packages.

**Remaining action:** Update the guidance to distinguish managed, versioned installs. For future upgrades, refresh links to the active release before validation, for example:

```bash
cd ~/.pi/agent/extensions
PI_HOST_PACKAGE_ROOT="$HOME/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-coding-agent" \
  npm run sync:pi-host-deps
```

No dependency installation is needed.

### 3. Medium, conditional — new program-status reporting exports subagent prompt/task text

**Files:** `agent/extensions/subagent/index.ts:1241`, `:1587–1600`, `:2784–2793`

Pi v1.1.0 sends standard dialog titles to supporting terminals and dashboards as OSC 7501 `blocked` messages. The subagent extension uses detailed, multiline titles containing:

- a preview of the latest user prompt;
- delegated task previews;
- child clarification questions and reasons.

The host forwards the **whole title**, subject to sanitization and a 2 KiB cap, rather than just its first line. A synthetic protocol probe confirmed that prompt text survives into the status message.

This is a new metadata channel, not evidence of network transmission or a privilege-boundary bypass. It applies when the terminal supports the protocol or `PI_PROGRAM_STATUS=1` is set.

**Action:** Use content-free dialog titles and retain request details in the visible dialog/preview. Until then, use `PI_PROGRAM_STATUS=0` if terminal/dashboard status metadata should not contain task content.
