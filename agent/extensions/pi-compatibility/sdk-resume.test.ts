import assert from "node:assert/strict";
import test from "node:test";
import { assertRegisteredLateTools, declared, lateNames, off, withResumeFixture } from "./resumeFixture.ts";

// Contract controls, not a claim that SDK/CLI creation-time restoration works.
// Positive restoration acceptance checks live in sdk-resume.diagnostic.ts.
test("/tree restores the persisted loadout through late tool registration", async () => {
	await withResumeFixture(async (h) => {
		const control = await h.sdk(false, off, true);
		assertRegisteredLateTools(control.registered);
		assert.deepEqual([...control.afterRegistration].sort(), [...declared].sort());
	});
});

test("resume keeps registered indirect tools callable independently of declaration restoration", async () => {
	await withResumeFixture(async (h) => {
		const baseline = await h.sdk();
		assertRegisteredLateTools(baseline.registered);
		for (const name of lateNames.slice(1)) assert.ok(baseline.callable.includes(name));
		assert.equal(baseline.callable.includes(lateNames[0]!), baseline.afterRegistration.includes(lateNames[0]!));
	});
});

test("local off modes and relay preserve the host resume baseline and enforce local availability", async (t) => {
	await withResumeFixture(async (h) => {
		const baseline = await h.sdk();
		for (const relay of [false, true]) for (let mask = 0; mask < 8; mask++) {
			await t.test(`${relay ? "child" : "top"}, off mask ${mask}`, async () => {
				const state = { clarify: !(mask & 1), search: !(mask & 2), delegation: !(mask & 4), relay };
				const actual = await h.sdk(true, state);
				assertRegisteredLateTools(actual.registered);
				for (const name of lateNames) {
					assert.equal(actual.afterRegistration.includes(name), baseline.afterRegistration.includes(name),
						"local extensions must neither discard nor invent restored declarations");
				}
				for (const name of lateNames.slice(1)) assert.ok(actual.callable.includes(name));
				const locals = [state.clarify ? "clarify" : "", state.search ? "web_search" : "",
					state.delegation ? "subagent" : "", state.relay ? "escalate_to_parent" : ""].filter(Boolean);
				for (const phase of ["before", "afterStartup", "afterRegistration"] as const) {
					assert.deepEqual([...actual[phase]].sort(), [...baseline[phase], ...locals].sort());
				}
				for (const name of ["clarify", "subagent", "escalate_to_parent"]) assert.ok(!actual.callable.includes(name));
				assert.equal(actual.callable.includes("web_search"), state.search);
			});
		}
	});
});

test("actual CLI --session preserves transcript identity and local-all-off parity", { timeout: 50_000 }, async () => {
	await withResumeFixture(async (h) => {
		const baseline = await h.cli(false);
		const local = await h.cli(true);
		for (const snapshot of [baseline, local]) {
			assert.equal(snapshot.before.reason, "startup", "CLI startup --session differs from in-process resume events");
			assert.deepEqual(snapshot.before.declared, declared);
			assertRegisteredLateTools(snapshot.registered);
		}
		assert.deepEqual(local, baseline, "off modes must preserve the host baseline, whether restoration works or not");
	});
});
