import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createAgentSession, createEventBus, discoverAndLoadExtensions, ModelRuntime,
	SessionManager, SettingsManager, VERSION, type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { withTestScratchFixture, type TestScratchFixture } from "../permissions/testScratch.ts";

export const lateNames = ["mcp__resume__direct", "mcp__resume__deferred", "mcp__resume__codemode"];
export const declared = ["read", ...lateNames];
// Local tools eligible for a resumed transcript that deliberately records them as selected.
export const localNames = ["clarify", "web_search", "subagent", "escalate_to_parent"];
export const declaredWithLocals = [...declared, ...localNames];
const localPaths = ["clarify", "web-search", "subagent"].map((name) =>
	fileURLToPath(new URL(`../${name}/index.ts`, import.meta.url)));
const envKeys = ["PI_CODING_AGENT_DIR", "PI_SUBAGENT_PARENT_ESCALATION", "PI_SUBAGENT_DEPTH",
	"PI_SUBAGENT_INHERITED_APPROVAL", "PI_SUBAGENT_INHERITED_APPROVAL_SCOPE"];
interface Modes { clarify: boolean; search: boolean; delegation: boolean; relay: boolean }
export const off: Modes = { clarify: false, search: false, delegation: false, relay: false };

// Isolated offline fixtures shared by contract tests and explicit host diagnostics.
export async function withResumeFixture(run: (h: Awaited<ReturnType<typeof resumeFixture>>) => Promise<void>) {
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
	async function sessionFile(selected: readonly string[]) {
		const id = `resume-fixture-${sequence++}`;
		const file = join(fixture.root, `${id}.jsonl`);
		const entries = [
			{ type: "session", version: 3, id, timestamp: new Date(0).toISOString(), cwd: fixture.project },
			{ type: "message", id: "loadout", parentId: null, timestamp: new Date(1).toISOString(), message: {
				role: "system", content: "Offline resume fixture", timestamp: 1,
				toolsAdded: selected.map((name) => ({ name, description: name, parameters: { type: "object", properties: {} } })),
			} },
			{ type: "message", id: "user", parentId: "loadout", timestamp: new Date(2).toISOString(), message: {
				role: "user", content: "Recorded fixture only; never submitted to a model", timestamp: 2,
			} },
		];
		await fixture.writeFile(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
		return file;
	}
	// `selected` is the loadout the transcript records: `declared` omits local tools, while
	// `declaredWithLocals` records them, so both resume transcripts can be compared.
	async function sdk(withLocals = false, state: Modes = off, restoreThroughTree = false, selected: readonly string[] = declared) {
		await modes(state);
		const file = await sessionFile(selected);
		const manager = SessionManager.open(file);
		const header = manager.getHeader();
		assert.equal(header?.cwd, fixture.project);
		const transcript = manager.buildSessionContext().messages.find((message) => message.role === "system");
		assert.deepEqual(transcript?.toolsAdded?.map((tool) => tool.name), selected);
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
				// Registered local-tool exposure ("direct" for tools without an explicit value); undefined when unregistered.
				localExposure: Object.fromEntries(localNames.map((name) => [name, session.getToolDefinition(name)?.exposure ?? (session.getToolDefinition(name) ? "direct" : undefined)])),
				registered: session.getAllTools().filter((tool) => lateNames.includes(tool.name)).map((tool) => ({ name: tool.name, exposure: tool.exposure })),
			};
		} finally {
			try { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); }
			finally { session.dispose(); }
		}
	}

	async function cli(withLocals: boolean) {
		await modes(off);
		const file = await sessionFile(declared);
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

export function assertRegisteredLateTools(registered: Array<{ name: string; exposure?: string }>) {
	assert.deepEqual(registered, lateNames.map((name) => ({ name, exposure: name.slice("mcp__resume__".length) })), "Late tools really registered with the intended exposures");
}

export type SdkSnapshot = Awaited<ReturnType<Awaited<ReturnType<typeof resumeFixture>>["sdk"]>>;
