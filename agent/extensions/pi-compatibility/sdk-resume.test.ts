import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
	assertRegisteredLateTools, branchLoadouts, declared, declaredWithLocals, lateNames, localNames, withResumeFixture,
	type Modes, type SdkSnapshot, type Selection,
} from "./resumeFixture.ts";

// Local tools that are registered and eligible for a state. Eligibility is not activation: a resumed
// transcript decides what is selected, and only some startup handlers add their own tool.
function eligibleLocals(state: Modes) {
	return [state.clarify && "clarify", state.search && "web_search", state.delegation && !state.depthCap && "subagent",
		state.relay && "escalate_to_parent"].filter((name): name is string => Boolean(name));
}
const sorted = (names: readonly string[]) => [...names].sort();
const states: Array<{ label: string; state: Modes }> = [false, true].flatMap((relay) => Array.from({ length: 8 }, (_, mask) => ({
	label: `${relay ? "child" : "top"}, off mask ${mask}`,
	state: { clarify: !(mask & 1), search: !(mask & 2), delegation: !(mask & 4), relay },
})));
// Depth-capped rows: delegation is saved on, but the nested depth reached the configured cap.
const cappedStates: typeof states = [false, true].map((relay) => ({
	label: `${relay ? "child" : "top"}, depth cap`,
	state: { clarify: true, search: true, delegation: true, relay, depthCap: true },
}));

function assertLocalAvailability(actual: SdkSnapshot, state: Modes, locals: string[]) {
	for (const name of localNames) {
		const eligible = locals.includes(name);
		// Registration/exposure: ineligible tools are re-registered hidden; eligible tools keep their intended exposure.
		assert.equal(actual.localExposure[name], eligible ? (name === "web_search" ? "direct" : "model-only") : "hidden", `${name} exposure`);
		// Callability: model-only tools are never nested-callable; only available web search is.
		assert.equal(actual.callable.includes(name), name === "web_search" && state.search, `${name} callability`);
	}
	for (const name of lateNames.slice(1)) assert.ok(actual.callable.includes(name), name);
}

// Indirect callability follows registration and exposure, not the declared (active) set: deferred and
// codemode tools stay callable whether or not they are declared; a direct tool needs to be active.
function assertCallability(actual: SdkSnapshot) {
	for (const { name, exposure } of actual.registered) {
		assert.equal(actual.callable.includes(name), exposure !== "direct" || actual.afterRegistration.includes(name), `${name} callability`);
	}
}

// ---------------------------------------------------------------------------------------------
// Positive creation-time restoration through ordinary SDK construction and the actual CLI.
// ---------------------------------------------------------------------------------------------

for (const withLocals of [false, true]) {
	test(`SDK resume restores the selected late declarations (${withLocals ? "local extensions all off" : "host only"})`, async () => {
		await withResumeFixture(async (h) => {
			const actual = await h.sdk({ locals: withLocals });
			assertRegisteredLateTools(actual.registered);
			assert.equal(actual.start.reason, "resume");
			// Pi 1.3 seeds the transcript's selection at construction: `read` is active before startup and the
			// selected late tools join only once they register. defaultActive:false rules out registration defaults.
			assert.deepEqual(actual.before, ["read"]);
			assert.deepEqual(actual.afterStartup, ["read"]);
			assert.deepEqual(sorted(actual.afterRegistration), sorted(declared),
				"ordinary resume must preserve the selected transcript loadout through late registration");
			for (const name of lateNames) assert.ok(actual.callable.includes(name), name);
			assertCallability(actual);
		});
	});
}

for (const withLocals of [false, true]) {
	test(`actual CLI --session restores the selected declarations (${withLocals ? "local extensions all off" : "host only"})`, { timeout: 25_000 }, async () => {
		await withResumeFixture(async (h) => {
			const actual = await h.cli({ locals: withLocals });
			// CLI startup differs from the in-process resume event; both creation paths are executed separately.
			assert.equal(actual.before.reason, "startup");
			assert.deepEqual(actual.before.declared, declared);
			assertRegisteredLateTools(actual.registered);
			assert.deepEqual(sorted(actual.after), sorted(declared),
				"CLI resume must preserve the selected transcript loadout through late registration");
		});
	});
}

test("actual CLI --session local-all-off parity with the host-only baseline", { timeout: 50_000 }, async () => {
	await withResumeFixture(async (h) => {
		const baseline = await h.cli({});
		const local = await h.cli({ locals: true });
		assert.deepEqual(sorted(baseline.after), sorted(declared));
		// Session identity differs per fixture transcript; everything the host restored must be identical.
		const comparable = ({ before: { sessionId, file, ...before }, ...rest }: typeof baseline) => ({ before, ...rest });
		assert.deepEqual(comparable(local), comparable(baseline), "saved-off local extensions must not change the restored host loadout");
	});
});

// ---------------------------------------------------------------------------------------------
// Public SDK controls: /tree, reload and registration/callability stay separate seams.
// ---------------------------------------------------------------------------------------------

test("/tree restores the persisted loadout of the navigated branch through late tool registration", async () => {
	await withResumeFixture(async (h) => {
		// Same-file control: the resumed leaf is the `alt` branch; /tree selects other branches' loadouts.
		const resumed = await h.sdk({ branched: true });
		assert.deepEqual(sorted(resumed.afterRegistration), sorted(branchLoadouts.alt));
		for (const [target, expected] of [["narrow", branchLoadouts.narrow], ["loadout", branchLoadouts.full], ["alt", branchLoadouts.alt]] as const) {
			const control = await h.sdk({ branched: true, tree: target });
			assertRegisteredLateTools(control.registered);
			assert.deepEqual(sorted(control.afterRegistration), sorted(expected), `/tree -> ${target}`);
			assertCallability(control);
		}
	});
});

test("reload keeps restored pending declarations, whether or not the late tools registered before it", async () => {
	await withResumeFixture(async (h) => {
		const beforeRegistration = await h.sdk({ reload: "before-registration" });
		assert.deepEqual(sorted(beforeRegistration.afterRegistration), sorted(declared), "pending names survive reload before registration");
		const afterRegistration = await h.sdk({ reload: "after-registration" });
		assert.deepEqual(sorted(afterRegistration.afterRegistration), sorted(declared), "registered names survive reload");
		for (const snapshot of [beforeRegistration, afterRegistration]) {
			assertRegisteredLateTools(snapshot.registered);
			assertCallability(snapshot);
		}
	});
});

test("resume keeps registered indirect tools callable and distinguishes them from the declared set", async () => {
	await withResumeFixture(async (h) => {
		// Transcript selects only `read`: late tools register but are neither restored nor resurrected, yet
		// deferred/codemode tools remain callable (callability does not depend on the declared set).
		const unselected = await h.sdk({ selected: ["read"] });
		assertRegisteredLateTools(unselected.registered);
		assert.deepEqual(sorted(unselected.afterRegistration), ["read"]);
		assert.deepEqual(sorted(unselected.callable.filter((name) => lateNames.includes(name))), sorted(lateNames.slice(1)),
			"a registered but undeclared direct tool is not callable; deferred and codemode tools are");
		assertCallability(unselected);
		const selected = await h.sdk({});
		assert.ok(selected.callable.includes(lateNames[0]!), "a declared direct tool is callable");
		assertCallability(selected);
	});
});

// The transcript selects only `read` and the late tools. Local tools are not recorded, so the host
// does not select them; enabled local extensions add their own tools in session_start. An unselected
// relay tool is registered and eligible, but no startup handler adds it.
test("resume without recorded local selections follows the transcript, then local startup additions", async (t) => {
	await withResumeFixture(async (h) => {
		const baseline = await h.sdk({});
		// Self-contained baseline: parity below is meaningless unless the host baseline itself is correct.
		assert.deepEqual(baseline.before, ["read"]);
		assert.deepEqual(baseline.afterStartup, ["read"]);
		assert.deepEqual(sorted(baseline.afterRegistration), sorted(declared));
		for (const { label, state } of [...states, ...cappedStates]) {
			await t.test(label, async () => {
				const actual = await h.sdk({ locals: true, state });
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
// before startup; withdrawn, depth-capped or relay-ineligible names are not resurrected by the recorded selection.
test("resume with recorded local selections restores only eligible local tools at every phase", async (t) => {
	await withResumeFixture(async (h) => {
		for (const { label, state } of [...states, ...cappedStates]) {
			await t.test(label, async () => {
				const actual = await h.sdk({ locals: true, state, selected: declaredWithLocals });
				const locals = eligibleLocals(state);
				assertRegisteredLateTools(actual.registered);
				// The subagent depth cap is applied by its session_start handler, so between construction and
				// session_start a recorded `subagent` is still declared. No prompt can run in that window.
				const constructed = state.depthCap && state.delegation ? [...locals, "subagent"] : locals;
				assert.deepEqual(sorted(actual.before), sorted(["read", ...constructed]));
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

// ---------------------------------------------------------------------------------------------
// Resumed selection precedence: one case table, run through the actual CLI and the public SDK.
// ---------------------------------------------------------------------------------------------

interface PrecedenceCase {
	name: string; args: string[]; selection: Selection; expected: string[];
	// Late tools the host keeps registered under this selection; defaults to all three.
	registered?: string[];
}
const precedence: PrecedenceCase[] = [
	{ name: "no options restore the recorded loadout", args: [], selection: {}, expected: declared },
	{ name: "+modifier adds to the restored loadout", args: ["--tools", "+bash"], selection: { tools: ["+bash"] }, expected: [...declared, "bash"] },
	{ name: "-modifier removes from the restored loadout", args: ["--tools", "-read"], selection: { tools: ["-read"] }, expected: lateNames },
	{ name: "-modifier removes a restored late tool", args: ["--tools", "-mcp__resume__direct,+grep"], selection: { tools: ["-mcp__resume__direct", "+grep"] },
		expected: ["read", "grep", ...lateNames.slice(1)] },
	{ name: "plain allowlist replaces the recorded loadout", args: ["--tools", "read,grep"], selection: { tools: ["read", "grep"] }, expected: ["read", "grep"] },
	{ name: "an allowlist entry for an MCP tool filters MCP tools", args: ["--tools", "read,mcp__resume__direct"],
		selection: { tools: ["read", "mcp__resume__direct"] }, expected: ["read", lateNames[0]!], registered: [lateNames[0]!] },
	{ name: "exclusions remove restored tools", args: ["--exclude-tools", "read,mcp__resume__direct"], selection: { excludeTools: ["read", "mcp__resume__direct"] },
		expected: lateNames.slice(1), registered: lateNames.slice(1) },
	{ name: "exclusions win over a modifier", args: ["--tools", "+bash", "--exclude-tools", "bash,read"], selection: { tools: ["+bash"], excludeTools: ["bash", "read"] },
		expected: lateNames },
	{ name: "--no-tools disables every tool", args: ["--no-tools"], selection: { noTools: "all" }, expected: [], registered: [] },
	// Documented host behavior: the Pi 1.3.0 CHANGELOG entry for #10785 says resume restores the session's tools
	// unless `--tools` with names, `--no-tools` or `--no-builtin-tools` selects tools explicitly. So no restoration
	// happens here, selected late extension tools included.
	{ name: "--no-builtin-tools suppresses transcript restoration entirely", args: ["--no-builtin-tools"], selection: { noTools: "builtin" }, expected: [] },
	{ name: "defaultTools settings do not replace the restored loadout", args: [], selection: { defaultTools: ["grep"] }, expected: declared },
	{ name: "a plain allowlist beats defaultTools", args: ["--tools", "read,bash"], selection: { tools: ["read", "bash"], defaultTools: ["+grep"] }, expected: ["read", "bash"] },
];

test("resumed selection precedence matches between the public SDK and the actual CLI", { timeout: 120_000 }, async (t) => {
	await withResumeFixture(async (h) => {
		for (const c of precedence) {
			await t.test(c.name, async () => {
				const cli = await h.cli({ args: c.args, defaultTools: c.selection.defaultTools });
				const sdk = await h.sdk({ selection: c.selection });
				assert.deepEqual(sorted(cli.after), sorted(c.expected), "actual CLI --session");
				assert.deepEqual(sorted(sdk.afterRegistration), sorted(c.expected), "public SDK");
				assert.deepEqual(sorted(cli.before.active), sorted(sdk.afterStartup), "startup selection is shared");
				const registered = c.registered ?? lateNames;
				assert.deepEqual(sorted(cli.registered.map((tool) => tool.name)), sorted(registered), "CLI registration");
				assert.deepEqual(sorted(sdk.registered.map((tool) => tool.name)), sorted(registered), "SDK registration");
				assertCallability(sdk);
				// Restoration must never resurrect tools the selection excludes or never allowed.
				for (const name of [...cli.after, ...sdk.afterRegistration]) {
					assert.ok(!(c.selection.excludeTools ?? []).includes(name), `${name} is excluded`);
				}
			});
		}
	});
});

test("actual CLI withdraws recorded local tools whose extensions are saved off", { timeout: 25_000 }, async () => {
	await withResumeFixture(async (h) => {
		// The transcript records every local tool, but all local modes are saved off: nothing local is restored.
		const actual = await h.cli({ locals: true, selected: declaredWithLocals });
		assert.deepEqual(actual.before.declared, declaredWithLocals, "the transcript really records the local tools");
		assertRegisteredLateTools(actual.registered);
		assert.deepEqual(sorted(actual.after), sorted(declared));
	});
});

test("actual CLI keeps restrictive selection authoritative over recorded local tools", { timeout: 60_000 }, async () => {
	await withResumeFixture(async (h) => {
		const allOn: Modes = { clarify: true, search: true, delegation: true, relay: false };
		const plain = await h.cli({ locals: true, state: allOn, selected: declaredWithLocals });
		assert.deepEqual(sorted(plain.after), sorted([...declared, "clarify", "web_search", "subagent"]), "recorded eligible locals restore; the relay tool is ineligible at top level");
		const excluded = await h.cli({ locals: true, state: allOn, selected: declaredWithLocals, args: ["--exclude-tools", "subagent,web_search"] });
		assert.deepEqual(sorted(excluded.after), sorted([...declared, "clarify"]));
		const allowlisted = await h.cli({ locals: true, state: allOn, selected: declaredWithLocals, args: ["--tools", "read,clarify"] });
		assert.deepEqual(sorted(allowlisted.after), ["clarify", "read"]);
		const capped = await h.cli({ locals: true, state: { ...allOn, depthCap: true }, selected: declaredWithLocals });
		assert.deepEqual(sorted(capped.after), sorted([...declared, "clarify", "web_search"]), "a depth-capped subagent is withdrawn despite its recorded selection");
		const child = await h.cli({ locals: true, state: { ...allOn, relay: true }, selected: declaredWithLocals });
		assert.deepEqual(sorted(child.after), sorted([...declaredWithLocals]), "a recorded relay tool is restored for a child session");
		const topLevelRelay = await h.cli({ locals: true, state: allOn, selected: declaredWithLocals });
		assert.ok(!topLevelRelay.after.includes("escalate_to_parent"), "a recorded relay tool is not resurrected at top level");
	});
});

// ---------------------------------------------------------------------------------------------
// Continue, fork and runtime session replacement.
// ---------------------------------------------------------------------------------------------

test("actual CLI --continue resumes the newest project session in an isolated session directory", { timeout: 50_000 }, async () => {
	await withResumeFixture(async (h) => {
		const result = await h.cli({ entry: "continue" });
		// Deterministic identity: the newest session of this project, not the older or foreign-cwd decoys.
		assert.equal(result.before.sessionId, result.continued?.newestId);
		assert.notEqual(result.before.sessionId, result.continued?.olderId);
		assert.notEqual(result.before.sessionId, result.continued?.foreignId);
		assert.equal(result.before.file, result.continued?.newestFile);
		assert.equal(result.before.parent, undefined);
		assert.equal(result.before.reason, "startup");
		assert.deepEqual(result.before.declared, declared);
		assert.deepEqual(sorted(result.after), sorted(declared));
		// The older session has a different recorded loadout; it must not leak into the continued one.
		assert.deepEqual(result.continued?.olderDeclared, ["read", lateNames[0]]);
		assert.equal(result.continued?.sessionFilesAfter, result.continued?.sessionFilesBefore, "--continue opens the existing file instead of creating one");
	});
});

test("actual CLI --fork creates a lineage-linked session that keeps the recorded loadout", { timeout: 50_000 }, async () => {
	await withResumeFixture(async (h) => {
		const result = await h.cli({ entry: "fork" });
		assert.equal(result.before.sessionId, "resume-fork-fixed");
		assert.equal(result.before.parent, result.forked?.sourceFile);
		assert.notEqual(result.before.file, result.forked?.sourceFile);
		assert.equal(result.before.reason, "startup");
		assert.deepEqual(result.before.declared, declared);
		assert.deepEqual(sorted(result.after), sorted(declared));
		assert.equal(result.forked?.sourceUnchanged, true, "the source transcript is not modified by the fork");
		assert.equal(result.forked?.sessionFilesAfter, (result.forked?.sessionFilesBefore ?? 0) + 1);
	});
});

test("runtime switchSession replaces the loadout with the target session's own recorded selection", async () => {
	await withResumeFixture(async (h) => {
		const rt = await h.runtime({ branched: true });
		try {
			const first = await rt.observe();
			assert.equal(first.start.reason, "startup");
			assert.deepEqual(sorted(first.afterRegistration), sorted(branchLoadouts.alt));
			const switched = await rt.switchSession(rt.otherFile);
			assert.equal(switched.start.reason, "resume");
			assert.equal(switched.start.previousSessionFile, rt.sourceFile);
			assert.equal(switched.sessionId, rt.otherId);
			assert.equal(switched.parentSession, undefined, "switching opens an existing session; it has no fork lineage");
			assertRegisteredLateTools(switched.registered);
			// The other session's loadout is distinct: nothing from the first session's registered tools leaks in.
			assert.deepEqual(sorted(switched.afterRegistration), sorted(branchLoadouts.other));
			assertCallability(switched);
			assert.deepEqual(sorted(switched.callable.filter((name) => lateNames.includes(name))), sorted(lateNames.slice(1)),
				"the undeclared direct tool is registered but not callable; deferred and codemode remain callable");
			const back = await rt.switchSession(rt.sourceFile);
			assert.equal(back.start.reason, "resume");
			assert.equal(back.start.previousSessionFile, rt.otherFile);
			assert.equal(back.sessionId, first.sessionId);
			assert.deepEqual(sorted(back.afterRegistration), sorted(branchLoadouts.alt));
		} finally { await rt.dispose(); }
	});
});

test("runtime fork carries the loadout at the fork point and records lineage", async (t) => {
	await withResumeFixture(async (h) => {
		for (const { name, entryId, position, expected } of [
			{ name: "before the narrow branch's user message", entryId: "user2", position: "before", expected: branchLoadouts.narrow },
			{ name: "before the active branch's user message", entryId: "user3", position: "before", expected: branchLoadouts.alt },
			{ name: "before the first user message", entryId: "user", position: "before", expected: branchLoadouts.full },
			{ name: "at the narrow branch's user message", entryId: "user2", position: "at", expected: branchLoadouts.narrow },
		] as const) {
			await t.test(name, async () => {
				const rt = await h.runtime({ branched: true });
				try {
					const first = await rt.observe();
					assert.deepEqual(sorted(first.afterRegistration), sorted(branchLoadouts.alt), "the source session is resumed on its own leaf loadout before the fork");
					const before = await readFile(rt.sourceFile, "utf8");
					const forked = await rt.fork(entryId, position);
					assert.equal(forked.start.reason, "fork");
					assert.equal(forked.start.previousSessionFile, rt.sourceFile);
					assert.equal(forked.parentSession, rt.sourceFile);
					assert.notEqual(forked.sessionId, first.sessionId);
					assert.notEqual(forked.sessionFile, rt.sourceFile);
					assertRegisteredLateTools(forked.registered);
					assert.deepEqual(sorted(forked.afterRegistration), sorted(expected));
					assertCallability(forked);
					assert.equal(await readFile(rt.sourceFile, "utf8"), before, "forking leaves the source transcript unchanged");
				} finally { await rt.dispose(); }
			});
		}
	});
});

// A restrictive selection is passed to every runtime factory call, so it is re-applied to each replacement session
// (as the CLI does). Each row lists the expected active set for the source session, after `switchSession` to the
// other session (read + codemode), after switching back, and after a fork before the narrow branch (read + codemode).
test("runtime replacement re-applies a restrictive selection to each replacement session", async (t) => {
	const [direct, deferred, codemode] = lateNames as [string, string, string];
	type Row = { name: string; selection: Selection; source: string[]; other: string[]; forked: string[]; excluded: string[] };
	for (const { name, selection, source, other, forked, excluded } of [
		{ name: "exclusions", selection: { excludeTools: ["read", direct] }, source: [deferred], other: [codemode], forked: [codemode], excluded: ["read", direct] },
		{ name: "modifiers", selection: { tools: ["-read", "+grep"] }, source: [direct, deferred, "grep"], other: [codemode, "grep"], forked: [codemode, "grep"], excluded: ["read"] },
		{ name: "plain allowlist", selection: { tools: ["read", "grep"] }, source: ["read", "grep"], other: ["read", "grep"], forked: ["read", "grep"], excluded: [] },
		{ name: "--no-tools", selection: { noTools: "all" }, source: [], other: [], forked: [], excluded: [] },
	] satisfies Row[]) {
		await t.test(name, async () => {
			await withResumeFixture(async (h) => {
				const rt = await h.runtime({ branched: true, selection });
				try {
					const first = await rt.observe();
					assert.deepEqual(sorted(first.afterRegistration), sorted(source), "source session");
					const switched = await rt.switchSession(rt.otherFile);
					assert.equal(switched.start.reason, "resume");
					assert.deepEqual(sorted(switched.afterRegistration), sorted(other), "switched session");
					const back = await rt.switchSession(rt.sourceFile);
					assert.deepEqual(sorted(back.afterRegistration), sorted(source), "switched back");
					const fork = await rt.fork("user2", "before");
					assert.equal(fork.start.reason, "fork");
					assert.deepEqual(sorted(fork.afterRegistration), sorted(forked), "forked session");
					for (const snapshot of [first, switched, back, fork]) {
						assertCallability(snapshot);
						for (const tool of excluded) assert.ok(!snapshot.afterRegistration.includes(tool), `${tool} is excluded`);
					}
				} finally { await rt.dispose(); }
			});
		});
	}
});

// Characterization of Pi 1.3.0 (not a guarantee): `/tree` navigation reseeds the active set from the target
// branch's recorded loadout without the construction-time `--tools +name`/`-name` modifiers, while the host
// still applies allowlists and exclusions to that reseeded set.
test("/tree navigation reseeds from the transcript; modifiers apply only at construction, restrictions remain", async (t) => {
	const [direct, deferred, codemode] = lateNames as [string, string, string];
	for (const { name, selection, resumed, navigated } of [
		{ name: "+modifier", selection: { tools: ["+grep"] }, resumed: ["read", direct, deferred, "grep"], navigated: ["read", codemode] },
		{ name: "-modifier", selection: { tools: ["-read"] }, resumed: [direct, deferred], navigated: ["read", codemode] },
		{ name: "exclusion", selection: { excludeTools: ["read"] }, resumed: [direct, deferred], navigated: [codemode] },
	] satisfies Array<{ name: string; selection: Selection; resumed: string[]; navigated: string[] }>) {
		await t.test(name, async () => {
			await withResumeFixture(async (h) => {
				assert.deepEqual(sorted((await h.sdk({ branched: true, selection })).afterRegistration), sorted(resumed), "construction applies the selection");
				const tree = await h.sdk({ branched: true, selection, tree: "narrow" });
				assert.deepEqual(sorted(tree.afterRegistration), sorted(navigated), "after /tree to the narrow branch");
				assertCallability(tree);
			});
		});
	}
});
