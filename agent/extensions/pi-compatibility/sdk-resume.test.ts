import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
	createAgentSession, createEventBus, discoverAndLoadExtensions, ModelRuntime,
	SessionManager, SettingsManager, VERSION, type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { withTestScratchFixture, type TestScratchFixture } from "../permissions/testScratch.ts";

const nativeDefaults = ["read", "bash", "edit", "write"];
const lateNames = ["mcp__resume__direct", "mcp__resume__deferred", "mcp__resume__codemode"];
const declared = ["read", ...lateNames];
const localPaths = ["clarify", "web-search", "subagent"].map((name) =>
	fileURLToPath(new URL(`../${name}/index.ts`, import.meta.url)));
const envKeys = ["PI_CODING_AGENT_DIR", "PI_SUBAGENT_PARENT_ESCALATION", "PI_SUBAGENT_DEPTH",
	"PI_SUBAGENT_INHERITED_APPROVAL", "PI_SUBAGENT_INHERITED_APPROVAL_SCOPE"];
interface Modes { clarify: boolean; search: boolean; delegation: boolean; relay: boolean }
const off: Modes = { clarify: false, search: false, delegation: false, relay: false };

// Characterization of OPEN TDR-0004, not an assertion that omission is desired or fixed.
// Re-evaluate these expectations against the host acceptance criteria on upgrade.
async function withResumeFixture(run: (h: Awaited<ReturnType<typeof resumeFixture>>) => Promise<void>) {
	assert.equal(VERSION, "1.0.0", "Re-evaluate the open TDR-0004 characterization after a Pi upgrade");
	await withTestScratchFixture(async (fixture) => {
		assert.equal(await realpath(tmpdir()), await realpath(fixture.approvedRoot), "TMPDIR must point at the approved scratch root before loading extensions");
		const saved = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
		try { await run(await resumeFixture(fixture)); }
		finally {
			for (const key of envKeys) {
				if (saved[key] === undefined) delete process.env[key];
				else process.env[key] = saved[key];
			}
		}
	});
}

async function resumeFixture(fixture: TestScratchFixture) {
	const agentDir = join(fixture.root, "agent");
	await fixture.mkdir(agentDir);
	process.env.PI_CODING_AGENT_DIR = agentDir;
	for (const key of envKeys.slice(1)) delete process.env[key];
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"), modelsPath: null,
		modelsStorePath: join(agentDir, "models-store.json"), refreshOnCreate: false, allowModelNetwork: false,
	});
	const syntheticPath = join(fixture.root, "late.ts");
	await fixture.writeFile(syntheticPath, `export default (pi) => pi.events.on("resume-register", () => {
		for (const exposure of ["direct", "deferred", "codemode"]) pi.registerTool({
			name: "mcp__resume__" + exposure, label: exposure, description: "Offline resume fixture",
			exposure, defaultActive: false, parameters: { type: "object", properties: {} },
			execute: async () => ({ content: [], details: undefined }),
		});
	});`);
	let sequence = 0;

	async function modes(value: Modes) {
		for (const [file, state] of [
			["clarify.json", { enabled: value.clarify }], ["web-search.json", { enabled: value.search }],
			["subagent-policy.json", { mode: value.delegation ? "ask" : "off" }],
			["settings.json", { subagents: { maxParallelTasks: 8, maxConcurrency: 5, maxDelegationDepth: null } }],
		] as const) await writeFile(await fixture.assertMutationTarget(join(agentDir, file)), JSON.stringify(state), { mode: 0o600 });
		process.env.PI_SUBAGENT_PARENT_ESCALATION = value.relay ? "1" : "0";
		process.env.PI_SUBAGENT_DEPTH = "0";
	}
	async function sessionFile() {
		const id = `resume-fixture-${sequence++}`;
		const file = join(fixture.root, `${id}.jsonl`);
		const entries = [
			{ type: "session", version: 3, id, timestamp: new Date(0).toISOString(), cwd: fixture.project },
			{ type: "message", id: "loadout", parentId: null, timestamp: new Date(1).toISOString(), message: {
				role: "system", content: "Offline resume fixture", timestamp: 1,
				toolsAdded: declared.map((name) => ({ name, description: name, parameters: { type: "object", properties: {} } })),
			} },
			{ type: "message", id: "user", parentId: "loadout", timestamp: new Date(2).toISOString(), message: {
				role: "user", content: "Recorded fixture only; never submitted to a model", timestamp: 2,
			} },
		];
		await fixture.writeFile(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
		return file;
	}
	async function sdk(withLocals = false, state: Modes = off, restoreThroughTree = false) {
		await modes(state);
		const file = await sessionFile();
		const manager = SessionManager.open(file);
		const header = manager.getHeader();
		assert.equal(header?.cwd, fixture.project);
		const transcript = manager.buildSessionContext().messages.find((message) => message.role === "system");
		assert.deepEqual(transcript?.toolsAdded?.map((tool) => tool.name), declared);
		const events = createEventBus();
		const loaded = await discoverAndLoadExtensions((withLocals ? localPaths : []).concat(syntheticPath), fixture.project, agentDir, events);
		assert.deepEqual(loaded.errors, []);
		const resourceLoader: ResourceLoader = {
			getExtensions: () => loaded, getSkills: () => ({ skills: [], diagnostics: [] }),
			getPrompts: () => ({ prompts: [], diagnostics: [] }), getThemes: () => ({ themes: [], diagnostics: [] }),
			getAgentsFiles: () => ({ agentsFiles: [] }), getSystemPrompt: () => undefined,
			getSystemPromptSource: () => undefined, getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
			extendResources() {}, async reload() {},
		};
		const { session } = await createAgentSession({
			cwd: fixture.project, agentDir, sessionManager: manager, settingsManager: SettingsManager.inMemory(),
			resourceLoader, modelRuntime, sessionStartEvent: { type: "session_start", reason: "resume" },
		});
		const errors: unknown[] = [];
		try {
			const before = session.getActiveToolNames();
			await session.bindExtensions({ mode: "print", onError: (error) => errors.push(error) });
			const afterStartup = session.getActiveToolNames();
			if (restoreThroughTree) {
				await fixture.assertMutationTarget(file);
				assert.equal((await session.navigateTree("loadout", { summarize: false })).cancelled, false);
			}
			events.emit("resume-register", undefined);
			assert.deepEqual(errors, []);
			return { before, afterStartup, afterRegistration: session.getActiveToolNames(), callable: session.getCallableToolNames(),
				registered: session.getAllTools().filter((tool) => lateNames.includes(tool.name)).map((tool) => ({ name: tool.name, exposure: tool.exposure })),
			};
		} finally {
			try { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); }
			finally { session.dispose(); }
		}
	}

	async function cli(withLocals: boolean) {
		await modes(off);
		const file = await sessionFile();
		const report = await fixture.assertMutationTarget(join(fixture.root, `report-${sequence}.json`));
		await fixture.assertMutationTarget(`${report}.before`);
		const beforePath = join(fixture.root, `before-${sequence}.ts`);
		const afterPath = join(fixture.root, `after-${sequence}.ts`);
		await fixture.writeFile(beforePath, `import { writeFileSync } from "node:fs";
			export default pi => pi.on("session_start", (event, ctx) => writeFileSync(process.env.PI_0005_REPORT + ".before", JSON.stringify({
				reason: event.reason, active: pi.getActiveTools(),
				declared: ctx.sessionManager.buildSessionContext().messages.find(m => m.role === "system")?.toolsAdded?.map(t => t.name),
			}), { mode: 0o600 }));`);
		await fixture.writeFile(afterPath, `import { readFileSync, writeFileSync } from "node:fs";
			export default pi => pi.on("session_start", () => {
				for (const exposure of ["direct", "deferred", "codemode"]) pi.registerTool({
					name: "mcp__resume__" + exposure, label: exposure, description: "Offline resume fixture", exposure,
					defaultActive: false, parameters: { type: "object", properties: {} }, execute: async () => ({ content: [], details: undefined }),
				});
				writeFileSync(process.env.PI_0005_REPORT, JSON.stringify({
					before: JSON.parse(readFileSync(process.env.PI_0005_REPORT + ".before", "utf8")), after: pi.getActiveTools(),
					registered: pi.getAllTools().filter(t => t.name.startsWith("mcp__resume__")).map(t => ({ name: t.name, exposure: t.exposure })),
				}), { mode: 0o600 });
			});`);
		// Resolve the installed CLI through its declared public bin, not a private host method.
		const hostRoot = await realpath(fileURLToPath(new URL("../node_modules/@earendil-works/pi-coding-agent", import.meta.url)));
		const hostPackage = JSON.parse(await readFile(join(hostRoot, "package.json"), "utf8")) as { version: string; bin: { pi: string } };
		assert.equal(hostPackage.version, VERSION);
		const paths = [beforePath, ...(withLocals ? localPaths : []), afterPath];
		const child = spawnSync(process.execPath, [
			join(hostRoot, hostPackage.bin.pi), "--mode", "rpc", "--offline", "--no-approve",
			"--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
			"--session", file, "--model", "anthropic/claude-sonnet-4-5", "--api-key", "0005-offline-not-a-real-key",
			...paths.flatMap((path) => ["--extension", path]),
		], {
			// Do not inherit provider keys, auth paths, or unrelated PI_* configuration.
			cwd: fixture.project, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: fixture.fakeHome,
				TMPDIR: fixture.approvedRoot, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1",
				PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", PI_SUBAGENT_PARENT_ESCALATION: "0",
				PI_SUBAGENT_DEPTH: "0", PI_0005_REPORT: report },
			input: "", encoding: "utf8", timeout: 20_000, killSignal: "SIGKILL", maxBuffer: 1_000_000,
		});
		assert.equal(child.error, undefined, child.error?.message);
		assert.equal(child.status, 0, `${child.stderr}\n${child.stdout}`);
		assert.ok(!child.stdout.includes('"type":"extension_error"'), child.stdout);
		return JSON.parse(await readFile(report, "utf8")) as {
			before: { reason: string; active: string[]; declared: string[] }; after: string[];
			registered: Array<{ name: string; exposure: string }>;
		};
	}
	return { sdk, cli };
}

function assertRegisteredLateTools(registered: Array<{ name: string; exposure?: string }>) {
	assert.deepEqual(registered, lateNames.map((name) => ({ name, exposure: name.slice("mcp__resume__".length) })), "Late tools really registered with the intended exposures");
}

test("positive /tree control: the same persisted transcript is restorable outside SDK creation", async () => {
	await withResumeFixture(async (h) => {
		const control = await h.sdk(false, off, true);
		assertRegisteredLateTools(control.registered);
		assert.deepEqual([...control.afterRegistration].sort(), [...declared].sort());
	});
});

test("open TDR-0004: SDK resume omits transcript tools even without local extensions", async () => {
	await withResumeFixture(async (h) => {
		const baseline = await h.sdk();
		assertRegisteredLateTools(baseline.registered);
		assert.deepEqual(baseline.before, nativeDefaults);
		assert.deepEqual(baseline.afterStartup, nativeDefaults);
		assert.deepEqual(baseline.afterRegistration, nativeDefaults, "Characterizes the host defect, NOT intended restoration");
		for (const name of lateNames.slice(1)) assert.ok(baseline.callable.includes(name), "indirect access is unaffected");
		assert.ok(!baseline.callable.includes(lateNames[0]!));
	});
});

test("open TDR-0004: SDK omission characterization and local availability parity for every off-mode combination", async (t) => {
	await withResumeFixture(async (h) => {
		const baseline = await h.sdk();
		for (const relay of [false, true]) for (let mask = 0; mask < 8; mask++) {
			await t.test(`${relay ? "child" : "top"}, off mask ${mask}`, async () => {
				const state: Modes = { clarify: !(mask & 1), search: !(mask & 2), delegation: !(mask & 4), relay };
				const actual = await h.sdk(true, state);
				assertRegisteredLateTools(actual.registered);
				for (const name of lateNames) assert.ok(!actual.afterRegistration.includes(name), "Open host omission characterization must be re-evaluated when restoration is fixed");
				for (const name of lateNames.slice(1)) assert.ok(actual.callable.includes(name), "Registered indirect tools remain callable");
				const locals = [state.clarify ? "clarify" : "", state.search ? "web_search" : "",
					state.delegation ? "subagent" : "", state.relay ? "escalate_to_parent" : ""].filter(Boolean);
				for (const names of [actual.before, actual.afterStartup, actual.afterRegistration]) {
					assert.deepEqual([...names].sort(), [...baseline.before, ...locals].sort());
				}
				for (const name of ["clarify", "subagent", "escalate_to_parent"]) assert.ok(!actual.callable.includes(name));
				assert.equal(actual.callable.includes("web_search"), state.search);
			});
		}
	});
});

test("open TDR-0004: actual CLI --session reproduces the same host omission with and without local extensions", { timeout: 50_000 }, async () => {
	await withResumeFixture(async (h) => {
		const baseline = await h.cli(false);
		const local = await h.cli(true);
		for (const snapshot of [baseline, local]) {
			assert.equal(snapshot.before.reason, "startup", "CLI startup --session differs from in-process resume events");
			assert.deepEqual(snapshot.before.declared, declared, "the real CLI opened the seeded session file");
			assertRegisteredLateTools(snapshot.registered);
			assert.deepEqual(snapshot.before.active, nativeDefaults);
			assert.deepEqual(snapshot.after, nativeDefaults, "Characterizes the open host defect, NOT desired restoration");
		}
		assert.deepEqual(local, baseline, "Local off modes leave the already-omitted host state unchanged; pending-name preservation is tested separately");
	});
});
