### 3. Medium, conditional — new program-status reporting exports subagent prompt/task text

**Files:** `agent/extensions/subagent/index.ts:1241`, `:1587–1600`, `:2784–2793`

Pi v1.1.0 sends standard dialog titles to supporting terminals and dashboards as OSC 7501 `blocked` messages. The subagent extension uses detailed, multiline titles containing:

- a preview of the latest user prompt;
- delegated task previews;
- child clarification questions and reasons.

The host forwards the **whole title**, subject to sanitization and a 2 KiB cap, rather than just its first line. A synthetic protocol probe confirmed that prompt text survives into the status message.

This is a new metadata channel, not evidence of network transmission or a privilege-boundary bypass. It applies when the terminal supports the protocol or `PI_PROGRAM_STATUS=1` is set.

**Action:** Use content-free dialog titles and retain request details in the visible dialog/preview. Until then, use `PI_PROGRAM_STATUS=0` if terminal/dashboard status metadata should not contain task content.
