import assert from "node:assert/strict";
import test from "node:test";
import {
	assertRegisteredLateTools, declared, declaredWithLocals, lateNames, localNames, off, withResumeFixture,
	type SdkSnapshot,
} from "./resumeFixture.ts";

interface State { clarify: boolean; search: boolean; delegation: boolean; relay: boolean }

// Local tools that are registered and eligible for a state. Eligibility is not activation: a resumed
// transcript decides what is selected, and only some startup handlers add their own tool.
function eligibleLocals(state: State) {
	return [state.clarify && "clarify", state.search && "web_search", state.delegation && "subagent",
		state.relay && "escalate_to_parent"].filter((name): name is string => Boolean(name));
}
const sorted = (names: readonly string[]) => [...names].sort();
const states = [false, true].flatMap((relay) => Array.from({ length: 8 }, (_, mask) => ({
	label: `${relay ? "child" : "top"}, off mask ${mask}`,
	state: { clarify: !(mask & 1), search: !(mask & 2), delegation: !(mask & 4), relay },
})));

function assertLocalAvailability(actual: SdkSnapshot, state: State, locals: string[]) {
	for (const name of localNames) {
		const eligible = locals.includes(name);
		// Registration/exposure: ineligible tools are re-registered hidden; eligible tools keep their intended exposure.
		assert.equal(actual.localExposure[name], eligible ? (name === "web_search" ? "direct" : "model-only") : "hidden", `${name} exposure`);
		// Callability: model-only tools are never nested-callable; only available web search is.
		assert.equal(actual.callable.includes(name), name === "web_search" && state.search, `${name} callability`);
	}
	for (const name of lateNames.slice(1)) assert.ok(actual.callable.includes(name), name);
}

// Contract controls for the public SDK resume path, plus /tree and a CLI parity control as separate
// seams. Ordinary SDK restoration is now positive here. sdk-resume.diagnostic.ts keeps the explicit
// SDK/CLI acceptance probes; resumed CLI selection precedence and fork/continue/switch seams are not
// covered by this file (tracked in TDR-20261009-1202).
test("/tree restores the persisted loadout through late tool registration", async () => {
	await withResumeFixture(async (h) => {
		const control = await h.sdk(false, off, true);
		assertRegisteredLateTools(control.registered);
		assert.deepEqual(sorted(control.afterRegistration), sorted(declared));
	});
});

test("resume restores the recorded loadout and keeps registered indirect tools callable", async () => {
	await withResumeFixture(async (h) => {
		const baseline = await h.sdk();
		assertRegisteredLateTools(baseline.registered);
		// Pi 1.3 restores the transcript's selected loadout for ordinary resume: `read` is active before
		// startup, and the selected late tools become active only once they are registered.
		assert.deepEqual(baseline.before, ["read"]);
		assert.deepEqual(baseline.afterStartup, ["read"]);
		assert.deepEqual(sorted(baseline.afterRegistration), sorted(declared));
		// Callability is separate from declaration: every registered late tool stays callable.
		for (const name of lateNames) assert.ok(baseline.callable.includes(name), name);
	});
});

// The transcript selects only `read` and the late tools. Local tools are not recorded, so the host
// does not select them; enabled local extensions add their own tools in session_start. An unselected
// relay tool is registered and eligible, but no startup handler adds it.
test("resume without recorded local selections follows the transcript, then local startup additions", async (t) => {
	await withResumeFixture(async (h) => {
		const baseline = await h.sdk();
		// Self-contained baseline: parity below is meaningless unless the host baseline itself is correct.
		assert.deepEqual(baseline.before, ["read"]);
		assert.deepEqual(baseline.afterStartup, ["read"]);
		assert.deepEqual(sorted(baseline.afterRegistration), sorted(declared));
		for (const { label, state } of states) {
			await t.test(label, async () => {
				const actual = await h.sdk(true, state);
				const locals = eligibleLocals(state);
				const startupLocals = locals.filter((name) => name !== "escalate_to_parent");
				assertRegisteredLateTools(actual.registered);
				// Phase-specific: `before` is the recorded loadout; startup adds enabled locals;
				// registration adds the selected late tools. Locals neither discard nor invent restored names.
				assert.deepEqual(sorted(actual.before), sorted(baseline.before));
				assert.deepEqual(sorted(actual.afterStartup), sorted([...baseline.afterStartup, ...startupLocals]));
				assert.deepEqual(sorted(actual.afterRegistration), sorted([...baseline.afterRegistration, ...startupLocals]));
				assert.ok(!actual.afterRegistration.includes("escalate_to_parent"), "unselected relay stays inactive");
				assertLocalAvailability(actual, state, locals);
			});
		}
	});
});

// Same states, but the transcript records every local tool: only eligible ones may be active, including
// before startup; withdrawn or relay-ineligible names are not resurrected by the recorded selection.
test("resume with recorded local selections restores only eligible local tools at every phase", async (t) => {
	await withResumeFixture(async (h) => {
		for (const { label, state } of states) {
			await t.test(label, async () => {
				const actual = await h.sdk(true, state, false, declaredWithLocals);
				const locals = eligibleLocals(state);
				assertRegisteredLateTools(actual.registered);
				assert.deepEqual(sorted(actual.before), sorted(["read", ...locals]));
				assert.deepEqual(sorted(actual.afterStartup), sorted(["read", ...locals]));
				assert.deepEqual(sorted(actual.afterRegistration), sorted(["read", ...locals, ...lateNames]));
				for (const name of localNames.filter((name) => !locals.includes(name))) {
					assert.ok(!actual.afterRegistration.includes(name), `${name} is withdrawn despite its recorded selection`);
				}
				assertLocalAvailability(actual, state, locals);
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
