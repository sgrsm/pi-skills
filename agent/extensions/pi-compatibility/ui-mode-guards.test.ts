import assert from "node:assert/strict";
import test from "node:test";
import { canUseClarifyCustomSelector } from "../clarify/index.ts";
import { canInstallContinueWarningEditor } from "../handoff/index.ts";
import { canOpenSubagentConfigUi } from "../subagent/index.ts";

const uiModes = [
	{ mode: "tui", expectedTuiOnly: true },
	{ mode: "rpc", expectedTuiOnly: false },
	{ mode: "json", expectedTuiOnly: false },
	{ mode: "print", expectedTuiOnly: false },
] as const;

test("TUI-only extension UI is gated by ctx.mode, not ctx.hasUI", () => {
	for (const { mode, expectedTuiOnly } of uiModes) {
		const ctx = { mode, hasUI: mode === "tui" || mode === "rpc" };
		assert.equal(canUseClarifyCustomSelector(ctx), expectedTuiOnly, `clarify custom selector in ${mode}`);
		assert.equal(canOpenSubagentConfigUi(ctx), expectedTuiOnly, `/subagents ui in ${mode}`);
		assert.equal(canInstallContinueWarningEditor(ctx), expectedTuiOnly, `handoff editor wrapper in ${mode}`);
	}
});
