import assert from "node:assert/strict";
import { realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import {
	AgentSession, createAgentSession, createEventBus, discoverAndLoadExtensions, ModelRuntime,
	SessionManager, SettingsManager,
	type CreateAgentSessionOptions, type LoadExtensionsResult, type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { withTestScratchFixture, type TestScratchFixture } from "../permissions/testScratch.ts";

const localNames = ["clarify", "web_search", "subagent", "escalate_to_parent"];
const lateNames = ["mcp__synthetic__direct", "mcp__synthetic__deferred", "mcp__synthetic__codemode"];
const envKeys = ["PI_CODING_AGENT_DIR", "PI_SUBAGENT_PARENT_ESCALATION", "PI_SUBAGENT_DEPTH",
	"PI_SUBAGENT_INHERITED_APPROVAL", "PI_SUBAGENT_INHERITED_APPROVAL_SCOPE"];
const localPaths = ["clarify", "web-search", "subagent"].map((name) =>
	fileURLToPath(new URL(`../${name}/index.ts`, import.meta.url)));

interface Modes {
	clarify?: boolean;
	search?: boolean;
	mode?: "off" | "manual" | "ask" | "auto";
	relay?: boolean;
	depth?: number;
	maxDepth?: number | null;
}

// Uses the actual public loader, SDK selection and AgentSession restoration/reload,
// not an array-only activation mock. Late tools are synthetic: no MCP or model calls.
async function withActivationFixture(run: (h: Awaited<ReturnType<typeof activationFixture>>) => Promise<void>) {
	await withTestScratchFixture(async (fixture) => {
		assert.equal(await realpath(tmpdir()), await realpath(fixture.approvedRoot));
		const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
		let h: Awaited<ReturnType<typeof activationFixture>> | undefined;
		try {
			h = await activationFixture(fixture);
			await run(h);
		} finally {
			try { await h?.close(); }
			finally {
				for (const key of envKeys) {
					if (savedEnv[key] === undefined) delete process.env[key];
					else process.env[key] = savedEnv[key];
				}
			}
		}
	});
}

async function activationFixture(fixture: TestScratchFixture) {
	const agentDir = join(fixture.root, "agent");
	await fixture.mkdir(agentDir);
	process.env.PI_CODING_AGENT_DIR = agentDir;
	for (const key of envKeys.slice(1)) delete process.env[key];
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"), modelsPath: null,
		modelsStorePath: join(agentDir, "models-store.json"),
		allowModelNetwork: false, refreshOnCreate: false,
	});
	const syntheticPath = join(fixture.root, "late-tools.ts");
	await fixture.writeFile(syntheticPath, `export default (pi) => {
		// Selection-only codemode placeholder: this fixture does not test its renderer or sandbox.
		pi.registerTool({ name: "codemode", label: "Codemode", description: "Selection fixture",
			defaultActive: false, parameters: { type: "object", properties: {} },
			execute: async () => ({ content: [], details: undefined }),
		});
		const register = () => {
			for (const exposure of ["direct", "deferred", "codemode"]) pi.registerTool({
				name: "mcp__synthetic__" + exposure, label: exposure, description: "Synthetic restoration fixture",
				exposure, defaultActive: false, parameters: { type: "object", properties: {} },
				execute: async () => ({ content: [{ type: "text", text: "synthetic" }], details: undefined }),
			});
			pi.registerTool({ name: "activation_probe", label: "Probe", description: "Inspect callable tools",
				defaultActive: false, parameters: { type: "object", properties: {} },
				async execute(_id, _params, _signal, _update, ctx) {
					const rejected = [];
					for (const name of ["clarify", "subagent", "escalate_to_parent"]) {
						const result = await ctx.executeTool(name, {});
						if (result.isError) rejected.push(name);
					}
					return { content: [], details: { callable: ctx.tools.map((tool) => tool.name), rejected } };
				},
			});
		};
		pi.events.on("0005-register-late", register);
		pi.events.on("0005-tool-choice", (names) => pi.setActiveTools(names));
	};`);
	const sessions = new Set<AgentSession>();

	async function writeModes(modes: Modes = {}) {
		for (const [name, state] of [
			["clarify.json", { enabled: modes.clarify ?? true }],
			["web-search.json", { enabled: modes.search ?? true }],
			["subagent-policy.json", { mode: modes.mode ?? "ask" }],
			["settings.json", { subagents: { maxParallelTasks: 8, maxConcurrency: 5, maxDelegationDepth: modes.maxDepth ?? null } }],
		] as const) await writeFile(await fixture.assertMutationTarget(join(agentDir, name)), JSON.stringify(state), { mode: 0o600 });
		process.env.PI_SUBAGENT_PARENT_ESCALATION = modes.relay ? "1" : "0";
		process.env.PI_SUBAGENT_DEPTH = String(modes.depth ?? 0);
	}

	async function create(modes: Modes = {}, selection: Pick<CreateAgentSessionOptions, "tools" | "excludeTools" | "noTools"> & { defaultTools?: string[] } = {}, restored = false, reverse = false) {
		await writeModes(modes);
		const events = createEventBus();
		let loaded: LoadExtensionsResult;
		const paths = (reverse ? [...localPaths].reverse() : localPaths).concat(syntheticPath);
		const resourceLoader: ResourceLoader = {
			getExtensions: () => loaded,
			getSkills: () => ({ skills: [], diagnostics: [] }),
			getPrompts: () => ({ prompts: [], diagnostics: [] }),
			getThemes: () => ({ themes: [], diagnostics: [] }),
			getAgentsFiles: () => ({ agentsFiles: [] }),
			getSystemPrompt: () => undefined, getSystemPromptSource: () => undefined,
			getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
			extendResources() {},
			async reload() {
				loaded = await discoverAndLoadExtensions(paths, fixture.project, agentDir, events);
				assert.deepEqual(loaded.errors, []);
			},
		};
		await resourceLoader.reload();
		const settingsManager = SettingsManager.inMemory(selection.defaultTools === undefined ? {} : { defaultTools: selection.defaultTools });
		const manager = SessionManager.inMemory(fixture.project);
		let session: AgentSession;
		if (restored) {
			// Pi 1.3 restores a transcript loadout in the public constructor only when `usesDefaultTools` is
			// true (the SDK sets it for default-selection sessions). Omitting `initialActiveToolNames` alone
			// no longer requests restoration. This checks the restoration seam, not SDK resume selection.
			manager.appendMessage({ role: "system", content: "", timestamp: 1,
				toolsAdded: ["read", ...localNames, ...lateNames].map((name) => ({ name, description: name, parameters: {} })),
			});
			session = new AgentSession({ agent: new Agent({ streamFn: () => { throw new Error("Model requests are forbidden in activation fixtures"); } }), cwd: fixture.project, sessionManager: manager,
				settingsManager, resourceLoader, modelRuntime, usesDefaultTools: true,
				sessionStartEvent: { type: "session_start", reason: "resume" } });
		} else {
			({ session } = await createAgentSession({ ...selection, cwd: fixture.project, agentDir,
				settingsManager, sessionManager: manager, resourceLoader, modelRuntime }));
		}
		sessions.add(session);
		const errors: unknown[] = [];
		await session.bindExtensions({ mode: "print", onError: (error) => errors.push(error) });
		assert.deepEqual(errors, []);
		return { session, events, errors,
			async close() {
				try { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); }
				finally { session.dispose(); sessions.delete(session); }
			},
			async reload() { await session.reload(); assert.deepEqual(errors, []); },
			registerLate() { events.emit("0005-register-late", undefined); assert.deepEqual(errors, []); },
		};
	}
	return { create, writeModes,
		async close() {
			for (const session of sessions) {
				try { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); }
				finally { session.dispose(); }
			}
		},
	};
}

function assertAvailability(session: AgentSession, modes: Modes) {
	const eligible = [modes.clarify ?? true, modes.search ?? true,
		(modes.mode ?? "ask") !== "off" && (modes.maxDepth == null || (modes.depth ?? 0) < modes.maxDepth), modes.relay ?? false];
	const active = session.getActiveToolNames();
	const callable = session.getCallableToolNames();
	for (const [i, name] of localNames.entries()) {
		assert.equal(active.includes(name), eligible[i], name);
		assert.equal(callable.includes(name), name === "web_search" && eligible[i], `${name} callability`);
		assert.equal(session.getToolDefinition(name)?.exposure ?? "direct", eligible[i] ? (name === "web_search" ? "direct" : "model-only") : "hidden", name);
	}
}

// All saved off-mode combinations, both top-level and child relay, across fresh
// public-constructor restoration and real /reload with fresh loader instances.
test("constructor restoration and reload preserve pending tools for every local off-mode combination", { timeout: 60_000 }, async (t) => {
	await withActivationFixture(async (h) => {
		for (const restored of [false, true]) for (const relay of [false, true]) for (const reverse of [false, true]) for (let mask = 0; mask < 8; mask++) {
			const modes: Modes = { clarify: !(mask & 1), search: !(mask & 2), mode: mask & 4 ? "off" : "ask", relay };
			await t.test(`${restored ? "constructor restoration" : "reload"}, ${relay ? "child" : "top"}, ${reverse ? "reverse" : "forward"} order, off mask ${mask}`, async () => {
				const s = await h.create(modes, {}, restored, reverse);
				try {
					if (!restored) {
						s.registerLate();
						s.session.setActiveToolsByName([...s.session.getActiveToolNames(), ...lateNames]);
						await s.reload();
					}
					s.registerLate();
					for (const name of lateNames) assert.ok(s.session.getActiveToolNames().includes(name), `${name} must restore`);
					assertAvailability(s.session, modes);
				} finally { await s.close(); }
			});
		}
	});
});

test("tree restoration preserves late tools with delegation off or depth-capped", async (t) => {
	await withActivationFixture(async (h) => {
		for (const capped of [false, true]) for (const relay of [false, true]) {
			await t.test(`${capped ? "depth cap" : "off"}, ${relay ? "child" : "top"}`, async () => {
				const modes: Modes = { relay, ...(capped ? { depth: 2, maxDepth: 2 } : { mode: "off" }) };
				const s = await h.create(modes);
				try {
					// Navigate without summary/model requests to a transcript with not-yet-registered tools.
					const target = s.session.sessionManager.appendMessage({ role: "system", content: "", timestamp: 1,
						toolsAdded: ["read", ...localNames, ...lateNames].map((name) => ({ name, description: name, parameters: {} })),
					});
					s.session.sessionManager.appendCustomEntry("after-restored-loadout", {});
					assert.equal((await s.session.navigateTree(target, { summarize: false })).cancelled, false);
					assertAvailability(s.session, modes);
					s.registerLate();
					for (const name of lateNames) assert.ok(s.session.getActiveToolNames().includes(name), name);
				} finally { await s.close(); }
			});
		}
	});
});

test("depth caps withdraw delegation during fresh SDK startup and constructor restoration", async (t) => {
	await withActivationFixture(async (h) => {
		for (const restored of [false, true]) for (const relay of [false, true]) {
			await t.test(`${restored ? "constructor restoration" : "SDK startup"}, ${relay ? "child" : "top"}`, async () => {
				const modes: Modes = { depth: 2, maxDepth: 2, relay };
				const s = await h.create(modes, {}, restored);
				try {
					assertAvailability(s.session, modes);
					s.registerLate();
					for (const name of lateNames) assert.equal(s.session.getActiveToolNames().includes(name), restored, name);
				} finally { await s.close(); }
			});
		}
	});
});

test("policy modes, depth caps and changed saved state withdraw only local tools on reload", async (t) => {
	await withActivationFixture(async (h) => {
		for (const mode of ["off", "manual", "ask", "auto"] as const) {
			await t.test(mode, async () => {
				const s = await h.create({ mode, relay: true });
				try {
					assertAvailability(s.session, { mode, relay: true });
					s.registerLate();
					s.session.setActiveToolsByName([...s.session.getActiveToolNames(), ...lateNames]);
					const modes: Modes = { clarify: false, search: false, mode, relay: true, depth: 2, maxDepth: 2 };
					await h.writeModes(modes);
					await s.reload();
					assertAvailability(s.session, modes);
					s.registerLate();
					for (const name of lateNames) assert.ok(s.session.getActiveToolNames().includes(name), name);
				} finally { await s.close(); }
			});
		}
	});
});

test("SDK tool options and defaultTools retain host precedence at startup and reload", async (t) => {
	await withActivationFixture(async (h) => {
		const cases = [
			{ name: "defaults", selection: {}, native: ["read", "bash", "edit", "write"], locals: ["clarify", "web_search", "subagent"] },
			{ name: "+codemode defaults", selection: { defaultTools: ["+codemode"] }, native: ["read", "bash", "edit", "write", "codemode"], locals: ["clarify", "web_search", "subagent"] },
			{ name: "empty defaults suppress native only", selection: { defaultTools: [] }, native: [], locals: ["clarify", "web_search", "subagent"] },
			{ name: "plain defaults", selection: { defaultTools: ["grep"] }, native: ["grep"], locals: ["clarify", "web_search", "subagent"] },
			{ name: "modifier defaults", selection: { defaultTools: ["+grep", "-bash"] }, native: ["read", "edit", "write", "grep"], locals: ["clarify", "web_search", "subagent"] },
			{ name: "named delegation", selection: { tools: ["read", "subagent"] }, native: ["read"], locals: ["subagent"] },
			{ name: "named clarification", selection: { tools: ["read", "clarify"] }, native: ["read"], locals: ["clarify"] },
			{ name: "default modifiers are not extension denylists", selection: { defaultTools: ["-clarify", "+web_search"] }, native: ["read", "bash", "edit", "write"], locals: ["clarify", "web_search", "subagent"] },
			{ name: "restrictive child tools", selection: { tools: ["read", "grep", "find", "escalate_to_parent"], defaultTools: ["+write"] }, native: ["read", "grep", "find"], locals: ["escalate_to_parent"], relay: true },
			{ name: "top explicitly names escalation", selection: { tools: ["read", "escalate_to_parent"] }, native: ["read"], locals: [] },
			{ name: "no tools", selection: { noTools: "all" as const }, native: [], locals: [] },
			{ name: "no builtins", selection: { noTools: "builtin" as const }, native: [], locals: ["clarify", "web_search", "subagent"] },
			{ name: "exclusions win", selection: { tools: ["read", "clarify", "subagent", "web_search"], excludeTools: ["clarify", "subagent", "web_search"] }, native: ["read"], locals: [] },
			{ name: "off wins over named defaults", selection: { defaultTools: localNames }, native: [], locals: [], off: true },
			{ name: "off wins over explicit tools", selection: { tools: localNames }, native: [], locals: [], off: true },
		];
		for (const c of cases) await t.test(c.name, async () => {
			const s = await h.create({ relay: c.relay, ...(c.off ? { clarify: false, search: false, mode: "off" as const } : {}) }, c.selection);
			try {
				const expected = [...c.native, ...c.locals].sort();
				assert.deepEqual(s.session.getActiveToolNames().sort(), expected);
				await s.reload();
				assert.deepEqual(s.session.getActiveToolNames().sort(), expected);
				// Attempts to activate unavailable/excluded tools cannot escape the registry.
				s.events.emit("0005-tool-choice", [...s.session.getActiveToolNames(), ...localNames]);
				for (const name of localNames.filter((name) => !(c.locals as string[]).includes(name))) {
					assert.ok(!s.session.getActiveToolNames().includes(name), name);
				}
			} finally { await s.close(); }
		});
	});
});

test("restricted child reload restores only permitted late tools", async () => {
	await withActivationFixture(async (h) => {
		const s = await h.create({ relay: true }, {
			tools: ["read", "escalate_to_parent", ...lateNames], excludeTools: [lateNames[2]!],
		});
		try {
			s.registerLate();
			s.events.emit("0005-tool-choice", [...s.session.getActiveToolNames(), ...lateNames]);
			await s.reload();
			s.registerLate();
			const expected = ["read", "escalate_to_parent", ...lateNames.slice(0, 2)].sort();
			assert.deepEqual(s.session.getActiveToolNames().sort(), expected);
			s.events.emit("0005-tool-choice", [...expected, ...localNames, ...lateNames]);
			assert.deepEqual(s.session.getActiveToolNames().sort(), expected);
			assert.ok(!s.session.getCallableToolNames().includes(lateNames[2]!));
			for (const name of ["clarify", "subagent", "escalate_to_parent"]) assert.ok(!s.session.getCallableToolNames().includes(name));
		} finally { await s.close(); }
	});
});

test("reload preserves unrelated session tool choices", async () => {
	await withActivationFixture(async (h) => {
		const s = await h.create({}, { defaultTools: ["+codemode"] });
		try {
			s.registerLate();
			// A deliberately inactive native tool and unselected registered MCP tools stay off.
			s.session.setActiveToolsByName(s.session.getActiveToolNames().filter((name) => name !== "read"));
			await s.reload();
			s.registerLate();
			const active = s.session.getActiveToolNames();
			assert.ok(!active.includes("read"));
			assert.ok(active.includes("write"));
			assert.ok(active.includes("codemode"));
			for (const name of lateNames) assert.ok(!active.includes(name), "unselected tools are not restored");
		} finally { await s.close(); }
	});
});

test("explicit mode commands still toggle, persist and intentionally replace a restored loadout", async () => {
	await withActivationFixture(async (h) => {
		const s = await h.create({ relay: true });
		try {
			for (const [command, name] of [["clarify", "clarify"], ["web-search", "web_search"], ["subagents", "subagent"]]) {
				s.registerLate();
				s.session.setActiveToolsByName([...s.session.getActiveToolNames(), ...lateNames]);
				await s.reload(); // late tools are pending again, while this local tool is active.
				await s.session.prompt(`/${command} off`);
				assert.ok(!s.session.getActiveToolNames().includes(name));
				s.registerLate();
				for (const late of lateNames) assert.ok(!s.session.getActiveToolNames().includes(late), "explicit off may replace restoration");
				await s.reload();
				assert.ok(!s.session.getActiveToolNames().includes(name), "saved off stays off");
				await s.session.prompt(`/${command} ${command === "subagents" ? "ask" : "on"}`);
				assert.ok(s.session.getActiveToolNames().includes(name));
				await s.reload();
				assert.ok(s.session.getActiveToolNames().includes(name), "saved on stays on");
			}
		} finally { await s.close(); }
	});
});

test("model-only tools cannot be nested; child relay still executes directly", async () => {
	await withActivationFixture(async (h) => {
		const s = await h.create({ relay: true, mode: "ask" });
		try {
			assert.equal(s.session.getToolDefinition("clarify")?.exposure, "model-only");
			const relay = s.session.agent.state.tools.find((tool) => tool.name === "escalate_to_parent")!;
			const result = await relay.execute("relay-fixture", { question: "Need parent input?" }, undefined);
			assert.match((result.content[0] as { text: string }).text, /Stop here and wait for the parent/);
			s.registerLate();
			s.events.emit("0005-tool-choice", [...s.session.getActiveToolNames(), "activation_probe"]);
			const probe = s.session.agent.state.tools.find((tool) => tool.name === "activation_probe")!;
			const nested = await probe.execute("probe-fixture", {}, undefined);
			const details = nested.details as { callable: string[]; rejected: string[] };
			assert.deepEqual(details.rejected, ["clarify", "subagent", "escalate_to_parent"]);
			for (const name of details.rejected) assert.ok(!details.callable.includes(name), name);
		} finally { await s.close(); }
	});
});
