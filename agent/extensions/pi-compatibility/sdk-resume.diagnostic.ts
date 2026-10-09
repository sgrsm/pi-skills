import assert from "node:assert/strict";
import test from "node:test";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { assertRegisteredLateTools, declared, lateNames, off, withResumeFixture } from "./resumeFixture.ts";

// Deliberately outside *.test.ts: these are positive acceptance checks for open
// TDR-20261009-1202, not assertions that the known omission should persist. Run via
// npm run diagnose:pi-host; failures are real unresolved debt, never skips/TODOs.
for (const withLocals of [false, true]) {
	test(`TDR-20261009-1202: SDK resume restores selected late declarations (${withLocals ? "local extensions" : "host only"})`, async (t) => {
		t.diagnostic(`Pi ${VERSION}; offline reopened-transcript SDK fixture`);
		await withResumeFixture(async (h) => {
			const actual = await h.sdk(withLocals, off);
			assertRegisteredLateTools(actual.registered);
			for (const name of lateNames.slice(1)) assert.ok(actual.callable.includes(name));
			t.diagnostic(JSON.stringify({ selected: declared, active: actual.afterRegistration }));
			assert.deepEqual([...actual.afterRegistration].sort(), [...declared].sort(),
				"ordinary resume must preserve the selected transcript loadout through late registration");
		});
	});
}

for (const withLocals of [false, true]) {
	test(`TDR-20261009-1202: actual CLI --session restores selected declarations (${withLocals ? "local extensions" : "host only"})`, { timeout: 25_000 }, async (t) => {
		t.diagnostic(`Pi ${VERSION}; offline CLI --session fixture`);
		await withResumeFixture(async (h) => {
			const actual = await h.cli(withLocals);
			assert.deepEqual(actual.before.declared, declared);
			assertRegisteredLateTools(actual.registered);
			t.diagnostic(JSON.stringify({ selected: declared, active: actual.after }));
			assert.deepEqual([...actual.after].sort(), [...declared].sort(),
				"CLI resume must preserve the selected transcript loadout through late registration");
		});
	});
}
