import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { withTestScratchFixture } from "../permissions/testScratch.ts";

// Actual-host evidence for TDR-20261009-1201: Pi's real InteractiveMode (public root export) runs in
// a bounded, isolated subprocess with a fake Terminal, an offline in-memory session runtime and the
// real Clarify extension. See clarifyHostChild.ts for what the child exercises and its limits. This is
// a fake terminal: it says nothing about Ghostty/terminal input translation or real mouse hardware.
const child = fileURLToPath(new URL("./clarifyHostChild.ts", import.meta.url));
const commonScenarios = [
	"selection restores focus, editor text and leaves mouse modes alone",
	"queued cancellation and FIFO ordering",
	"pre-install abort preserves an unrelated overlay below",
	"custom answer exchange: overlay selector, then overlay editor, then result",
	"custom answer: Escape cancels the editor overlay and restores the main editor",
	"session reload/shutdown cancels displayed and queued interactions",
];
const fullscreenScenarios = [
	...commonScenarios,
	"PageDown scrolls the question and not the transcript",
	"PageUp scrolls the question and not the transcript",
	"Home scrolls the question and not the transcript",
	"End scrolls the question and not the transcript",
	"wheel scrolls the question and not the transcript",
	"wheel over the dialog, including at both boundaries, never scrolls the transcript",
	"resizes re-budget the real overlay and stay inside the terminal",
	"abort with transcript search above removes only the clarify overlay",
	"search opened first: the selector isolates focus and scroll, and Escape restores the search",
	"dragging over the selector selects the dialog text, not the transcript beneath it",
	"custom-answer editor abort with search above keeps the search focused",
	"search opened first: the whole custom-answer exchange ends back on the search",
	"answer editor overlay: bounds, hardware cursor, footer and paste at real terminal sizes",
	"answer editor overlay: wheel over it never scrolls the transcript",
];

for (const mode of ["fullscreen", "regular"] as const) {
	test(`actual InteractiveMode (${mode}) hosts the Clarify overlay selector through its public lifecycle`, { timeout: 90_000 }, async (t) => {
		await withTestScratchFixture(async (fixture) => {
			const agentDir = `${fixture.root}/agent`;
			await fixture.mkdir(agentDir);
			const run = spawnSync(process.execPath, [child, mode], {
				cwd: fixture.project,
				// Do not inherit provider keys, auth paths, or unrelated PI_* configuration.
				env: {
					PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: fixture.fakeHome, TMPDIR: fixture.approvedRoot,
					PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0",
				},
				input: "", encoding: "utf8", timeout: 60_000, killSignal: "SIGKILL", maxBuffer: 5_000_000,
			});
			assert.equal(run.error, undefined, run.error?.message);
			assert.equal(run.status, 0, `${run.stderr}\n${run.stdout.slice(-2000)}`);
			const report = JSON.parse(run.stdout.trim().split("\n").at(-1)!) as {
				version: string; mode: string; results: Array<{ name: string; ok: boolean; error?: string }>;
			};
			t.diagnostic(`Pi ${report.version}; ${report.results.length} actual-host scenarios; fake terminal`);
			assert.equal(report.version, VERSION);
			assert.equal(report.mode, mode);
			const expected = mode === "fullscreen" ? fullscreenScenarios : commonScenarios;
			assert.deepEqual(report.results.map((result) => result.name).filter((name) => expected.includes(name)).sort(), [...expected].sort(),
				"every expected scenario ran (none silently dropped)");
			assert.deepEqual(report.results.filter((result) => !result.ok).map(({ name, error }) => ({ name, error: error?.split("\n")[0] })), []);
		});
	});
}
