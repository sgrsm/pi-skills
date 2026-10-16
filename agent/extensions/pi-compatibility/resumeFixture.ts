import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile, realpath, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createAgentSession, createAgentSessionFromServices, createAgentSessionRuntime, createEventBus, discoverAndLoadExtensions,
	ModelRuntime, SessionManager, SettingsManager, VERSION,
	type AgentSession, type AgentSessionServices, type CreateAgentSessionOptions, type CreateAgentSessionRuntimeFactory,
	type EventBus, type LoadExtensionsResult, type ResourceLoader, type SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { withTestScratchFixture, type TestScratchFixture } from "../permissions/testScratch.ts";

export const lateNames = ["mcp__resume__direct", "mcp__resume__deferred", "mcp__resume__codemode"];
export const declared = ["read", ...lateNames];
// Local tools eligible for a resumed transcript that deliberately records them as selected.
export const localNames = ["clarify", "web_search", "subagent", "escalate_to_parent"];
export const declaredWithLocals = [...declared, ...localNames];
// Loadout at each leaf of the branched transcript (see `sessionFile`) and of the second session in runtime switches.
export const branchLoadouts = {
	full: declared,
	narrow: ["read", lateNames[2]!],
	alt: ["read", lateNames[0]!, lateNames[1]!],
	other: ["read", lateNames[2]!],
};
const localPaths = ["clarify", "web-search", "subagent"].map((name) =>
	fileURLToPath(new URL(`../${name}/index.ts`, import.meta.url)));
const envKeys = ["PI_CODING_AGENT_DIR", "PI_SUBAGENT_PARENT_ESCALATION", "PI_SUBAGENT_DEPTH",
	"PI_SUBAGENT_INHERITED_APPROVAL", "PI_SUBAGENT_INHERITED_APPROVAL_SCOPE"];
// Saved local modes. `depthCap` makes the nested depth reach the configured delegation cap.
export interface Modes { clarify: boolean; search: boolean; delegation: boolean; relay: boolean; depthCap?: boolean }
export const off: Modes = { clarify: false, search: false, delegation: false, relay: false };
// Host selection options shared by the public SDK and the actual CLI flags that map to them.
export interface Selection { tools?: string[]; excludeTools?: string[]; noTools?: "all" | "builtin"; defaultTools?: string[] }
type SessionStart = SessionStartEvent;

// Isolated offline fixtures shared by contract tests.
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

interface TranscriptOptions {
	dir?: string; id?: string; cwd?: string; mtimeSeconds?: number;
	// Adds two alternative branches with distinct loadouts; the last entry (the resumed leaf) is on `alt`.
	branched?: boolean;
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
	// Late tools register inactive on an explicit event, so activation defaults cannot mask restoration.
	// `resume-started` forwards session_start (reason, previous session) to the test through the event bus.
	await fixture.writeFile(syntheticPath, `export default (pi) => {
		pi.on("session_start", (event) => pi.events.emit("resume-started", event));
		pi.events.on("resume-register", () => {
			for (const exposure of ["direct", "deferred", "codemode"]) pi.registerTool({
				name: "mcp__resume__" + exposure, label: exposure, description: "Offline resume fixture",
				exposure, defaultActive: false, parameters: { type: "object", properties: {} },
				execute: async () => ({ content: [], details: undefined }),
			});
		});
	};`);
	let sequence = 0;

	async function modes(value: Modes, defaultTools?: string[]) {
		for (const [file, state] of [
			["clarify.json", { enabled: value.clarify }], ["web-search.json", { enabled: value.search }],
			["subagent-policy.json", { mode: value.delegation ? "ask" : "off" }],
			["settings.json", { subagents: { maxParallelTasks: 8, maxConcurrency: 5, maxDelegationDepth: value.depthCap ? 2 : null },
				...(defaultTools ? { defaultTools } : {}) }],
		] as const) await writeFile(await fixture.assertMutationTarget(join(agentDir, file)), JSON.stringify(state), { mode: 0o600 });
		process.env.PI_SUBAGENT_PARENT_ESCALATION = value.relay ? "1" : "0";
		process.env.PI_SUBAGENT_DEPTH = value.depthCap ? "2" : "0";
	}

	const systemEntry = (id: string, parentId: string | null, at: number, toolsAdded: readonly string[], toolsRemoved: readonly string[] = []) => ({
		type: "message", id, parentId, timestamp: new Date(at).toISOString(), message: {
			role: "system", content: "Offline resume fixture", timestamp: at,
			...(toolsAdded.length ? { toolsAdded: toolsAdded.map((name) => ({ name, description: name, parameters: { type: "object", properties: {} } })) } : {}),
			...(toolsRemoved.length ? { toolsRemoved: toolsRemoved.map((name) => ({ name })) } : {}),
		},
	});
	const userEntry = (id: string, parentId: string, at: number) => ({
		type: "message", id, parentId, timestamp: new Date(at).toISOString(), message: {
			role: "user", content: "Recorded fixture only; never submitted to a model", timestamp: at,
		},
	});
	// A real version-3 JSONL transcript: system loadout, then user entries (never submitted to a model). The
	// branched shape forks after `user` into `narrow` (drops direct+deferred) and `alt` (drops codemode).
	async function sessionFile(selected: readonly string[], options: TranscriptOptions = {}) {
		const id = options.id ?? `resume-fixture-${sequence++}`;
		const dir = options.dir ?? fixture.root;
		const file = join(dir, `${id}.jsonl`);
		const entries: unknown[] = [
			{ type: "session", version: 3, id, timestamp: new Date(0).toISOString(), cwd: options.cwd ?? fixture.project },
			systemEntry("loadout", null, 1, selected),
			userEntry("user", "loadout", 2),
		];
		if (options.branched) {
			entries.push(
				systemEntry("narrow", "user", 3, [], [lateNames[0]!, lateNames[1]!]), userEntry("user2", "narrow", 4),
				systemEntry("alt", "user", 5, [], [lateNames[2]!]), userEntry("user3", "alt", 6),
			);
		}
		await fixture.writeFile(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
		if (options.mtimeSeconds !== undefined) await utimes(await fixture.assertMutationTarget(file), options.mtimeSeconds, options.mtimeSeconds);
		return file;
	}

	function resourceLoaderFor(paths: string[], events: EventBus) {
		let loaded: LoadExtensionsResult | undefined;
		const resourceLoader: ResourceLoader = {
			getExtensions: () => loaded!, getSkills: () => ({ skills: [], diagnostics: [] }),
			getPrompts: () => ({ prompts: [], diagnostics: [] }), getThemes: () => ({ themes: [], diagnostics: [] }),
			getAgentsFiles: () => ({ agentsFiles: [] }), getSystemPrompt: () => undefined,
			getSystemPromptSource: () => undefined, getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
			extendResources() {},
			async reload() {
				loaded = await discoverAndLoadExtensions(paths, fixture.project, agentDir, events);
				assert.deepEqual(loaded.errors, []);
			},
		};
		return resourceLoader;
	}

	// Binds extensions, registers the late tools and records what each phase selected. `between` runs after
	// startup and before registration (for /tree and reload controls); `afterRegistration` after it.
	async function observe(session: AgentSession, events: EventBus, starts: SessionStart[], hooks: {
		between?: () => Promise<void>; afterRegistration?: () => Promise<void>;
	} = {}) {
		const errors: unknown[] = [];
		const before = session.getActiveToolNames();
		await session.bindExtensions({ mode: "print", onError: (error) => errors.push(error) });
		const start = starts[0]!;
		assert.ok(start, "session_start reached the observer");
		const afterStartup = session.getActiveToolNames();
		await hooks.between?.();
		events.emit("resume-register", undefined);
		await hooks.afterRegistration?.();
		assert.deepEqual(errors, []);
		const header = session.sessionManager.getHeader();
		return { before, afterStartup, afterRegistration: session.getActiveToolNames(), callable: session.getCallableToolNames(),
			// Registered local-tool exposure ("direct" for tools without an explicit value); undefined when unregistered.
			localExposure: Object.fromEntries(localNames.map((name) => [name, session.getToolDefinition(name)?.exposure ?? (session.getToolDefinition(name) ? "direct" : undefined)])),
			registered: session.getAllTools().filter((tool) => lateNames.includes(tool.name)).map((tool) => ({ name: tool.name, exposure: tool.exposure })),
			start, sessionId: session.sessionManager.getSessionId(), sessionFile: session.sessionFile,
			parentSession: header?.parentSession,
		};
	}

	async function assertTranscript(manager: SessionManager, selected: readonly string[]) {
		assert.equal(manager.getHeader()?.cwd, fixture.project);
		const transcript = manager.buildSessionContext().messages.find((message) => message.role === "system");
		assert.deepEqual(transcript?.toolsAdded?.map((tool) => tool.name), selected);
	}

	// `selected` is the loadout the transcript records: `declared` omits local tools, while
	// `declaredWithLocals` records them, so both resume transcripts can be compared.
	async function sdk(options: {
		locals?: boolean; state?: Modes; selected?: readonly string[]; selection?: Selection; branched?: boolean;
		// Navigate with /tree to an entry (without summaries) before the late tools register.
		tree?: string; reload?: "before-registration" | "after-registration";
	} = {}) {
		const selected = options.selected ?? declared;
		await modes(options.state ?? off, options.selection?.defaultTools);
		const file = await sessionFile(selected, { branched: options.branched });
		const manager = SessionManager.open(file);
		if (!options.branched) await assertTranscript(manager, selected);
		const events = createEventBus();
		const starts: SessionStart[] = [];
		events.on("resume-started", (event) => starts.push(event as SessionStart));
		const resourceLoader = resourceLoaderFor((options.locals ? localPaths : []).concat(syntheticPath), events);
		await resourceLoader.reload();
		const { defaultTools, ...toolOptions } = options.selection ?? {};
		const { session } = await createAgentSession({
			cwd: fixture.project, agentDir, sessionManager: manager,
			settingsManager: SettingsManager.inMemory(defaultTools ? { defaultTools } : {}),
			resourceLoader, modelRuntime, sessionStartEvent: { type: "session_start", reason: "resume" },
			...toolOptions satisfies Pick<CreateAgentSessionOptions, "tools" | "excludeTools" | "noTools">,
		});
		try {
			return await observe(session, events, starts, {
				async between() {
					if (options.tree) {
						await fixture.assertMutationTarget(file);
						assert.equal((await session.navigateTree(options.tree, { summarize: false })).cancelled, false);
					}
					if (options.reload === "before-registration") await session.reload();
				},
				async afterRegistration() { if (options.reload === "after-registration") { await session.reload(); events.emit("resume-register", undefined); } },
			});
		} finally {
			try { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); }
			finally { session.dispose(); }
		}
	}

	// Public AgentSessionRuntime replacement (RPC switch_session / fork use the same methods). Each session is
	// created by a fresh factory call with fresh extension instances and a fresh event bus.
	// The same selection options (the CLI flags' public SDK equivalents) are passed to every factory call,
	// as the CLI does for sessions it replaces.
	async function runtime(options: {
		locals?: boolean; state?: Modes; selected?: readonly string[]; branched?: boolean; selection?: Selection;
	} = {}) {
		const selected = options.selected ?? declared;
		await modes(options.state ?? off, options.selection?.defaultTools);
		const { defaultTools, ...toolOptions } = options.selection ?? {};
		const sourceFile = await sessionFile(selected, { branched: options.branched });
		const otherId = `resume-other-${sequence++}`;
		const otherFile = await sessionFile(branchLoadouts.other, { id: otherId });
		let events: EventBus | undefined;
		let starts: SessionStart[] = [];
		const factory: CreateAgentSessionRuntimeFactory = async ({ cwd, agentDir: dir, sessionManager, sessionStartEvent }) => {
			events = createEventBus();
			starts = [];
			const current = starts;
			events.on("resume-started", (event) => current.push(event as SessionStart));
			const resourceLoader = resourceLoaderFor((options.locals ? localPaths : []).concat(syntheticPath), events);
			await resourceLoader.reload();
			const services: AgentSessionServices = {
				cwd, agentDir: dir, modelRuntime, settingsManager: SettingsManager.inMemory(defaultTools ? { defaultTools } : {}), resourceLoader, diagnostics: [],
			};
			return { ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, ...toolOptions })),
				services, diagnostics: services.diagnostics };
		};
		const host = await createAgentSessionRuntime(factory, { cwd: fixture.project, agentDir, sessionManager: SessionManager.open(sourceFile) });
		const observeCurrent = () => observe(host.session, events!, starts);
		return {
			sourceFile, otherFile, otherId,
			observe: observeCurrent,
			async switchSession(path: string) {
				assert.equal((await host.switchSession(path)).cancelled, false);
				return observeCurrent();
			},
			async fork(entryId: string, position: "before" | "at") {
				assert.equal((await host.fork(entryId, { position })).cancelled, false);
				return observeCurrent();
			},
			dispose: () => host.dispose(),
		};
	}

	interface CliOptions {
		locals?: boolean; state?: Modes; selected?: readonly string[]; args?: string[]; defaultTools?: string[];
		// `session` opens the transcript file; `continue` picks the newest project session in an isolated session
		// directory; `fork` forks the transcript into a new, deterministically named session.
		entry?: "session" | "continue" | "fork";
	}
	async function cli(options: CliOptions = {}) {
		const entry = options.entry ?? "session";
		const selected = options.selected ?? declared;
		await modes(options.state ?? off, options.defaultTools);
		const sessionDir = join(fixture.root, `sessions-${sequence}`);
		await fixture.mkdir(sessionDir);
		const dir = entry === "session" ? undefined : sessionDir;
		const file = await sessionFile(selected, { dir, id: entry === "session" ? undefined : "resume-cli-newest", mtimeSeconds: entry === "session" ? undefined : 1_500_000_000 });
		let entryArgs = ["--session", file];
		const extra: { olderId?: string; foreignId?: string; foreignFile?: string; olderFile?: string } = {};
		if (entry === "continue") {
			// Older same-project session with a different loadout, and the newest session of another project.
			extra.olderId = "resume-cli-older";
			extra.olderFile = await sessionFile(["read", lateNames[0]!], { dir, id: extra.olderId, mtimeSeconds: 500_000_000 });
			extra.foreignId = "resume-cli-foreign";
			extra.foreignFile = await sessionFile(["read"], { dir, id: extra.foreignId, cwd: join(fixture.root, "foreign-project"), mtimeSeconds: 2_000_000_000 });
			entryArgs = ["--continue", "--session-dir", sessionDir];
		} else if (entry === "fork") entryArgs = ["--fork", file, "--session-dir", sessionDir, "--session-id", "resume-fork-fixed"];
		const sourceBefore = await readFile(file, "utf8");
		const filesBefore = (await readdir(sessionDir)).filter((name) => name.endsWith(".jsonl")).length;
		const report = await fixture.assertMutationTarget(join(fixture.root, `report-${sequence}.json`));
		await fixture.assertMutationTarget(`${report}.before`);
		const beforePath = join(fixture.root, `before-${sequence}.ts`);
		const afterPath = join(fixture.root, `after-${sequence}.ts`);
		await fixture.writeFile(beforePath, `import { writeFileSync } from "node:fs";
			export default pi => pi.on("session_start", (event, ctx) => writeFileSync(process.env.PI_0005_REPORT + ".before", JSON.stringify({
				reason: event.reason, active: pi.getActiveTools(),
				declared: ctx.sessionManager.buildSessionContext().messages.find(m => m.role === "system")?.toolsAdded?.map(t => t.name),
				sessionId: ctx.sessionManager.getSessionId(), file: ctx.sessionManager.getSessionFile(),
				parent: ctx.sessionManager.getHeader()?.parentSession,
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
		const paths = [beforePath, ...(options.locals ? localPaths : []), afterPath];
		const child = spawnSync(process.execPath, [
			join(hostRoot, hostPackage.bin.pi), "--mode", "rpc", "--offline", "--no-approve",
			"--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
			...entryArgs, "--model", "anthropic/claude-sonnet-4-5", "--api-key", "0005-offline-not-a-real-key",
			...(options.args ?? []),
			...paths.flatMap((path) => ["--extension", path]),
		], {
			// Do not inherit provider keys, auth paths, or unrelated PI_* configuration.
			cwd: fixture.project, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: fixture.fakeHome,
				TMPDIR: fixture.approvedRoot, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1",
				PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0",
				PI_SUBAGENT_PARENT_ESCALATION: process.env.PI_SUBAGENT_PARENT_ESCALATION ?? "0",
				PI_SUBAGENT_DEPTH: process.env.PI_SUBAGENT_DEPTH ?? "0", PI_0005_REPORT: report },
			input: "", encoding: "utf8", timeout: 20_000, killSignal: "SIGKILL", maxBuffer: 1_000_000,
		});
		assert.equal(child.error, undefined, child.error?.message);
		assert.equal(child.status, 0, `${child.stderr}\n${child.stdout}`);
		assert.ok(!child.stdout.includes('"type":"extension_error"'), child.stdout);
		const filesAfter = (await readdir(sessionDir)).filter((name) => name.endsWith(".jsonl")).length;
		const result = JSON.parse(await readFile(report, "utf8")) as {
			before: { reason: string; active: string[]; declared: string[]; sessionId: string; file: string; parent?: string }; after: string[];
			registered: Array<{ name: string; exposure: string }>;
		};
		sequence++;
		return { ...result,
			continued: entry === "continue" ? { newestId: "resume-cli-newest", newestFile: file, ...extra,
				olderDeclared: (await readFile(extra.olderFile!, "utf8")).split("\n").map((line) => line && JSON.parse(line)).find((e) => e?.message?.role === "system")?.message.toolsAdded.map((t: { name: string }) => t.name) as string[],
				sessionFilesBefore: filesBefore, sessionFilesAfter: filesAfter } : undefined,
			forked: entry === "fork" ? { sourceFile: file, sourceUnchanged: (await readFile(file, "utf8")) === sourceBefore,
				sessionFilesBefore: filesBefore, sessionFilesAfter: filesAfter } : undefined,
		};
	}
	return { sdk, cli, runtime };
}

export function assertRegisteredLateTools(registered: Array<{ name: string; exposure?: string }>) {
	assert.deepEqual(registered, lateNames.map((name) => ({ name, exposure: name.slice("mcp__resume__".length) })), "Late tools really registered with the intended exposures");
}

export type SdkSnapshot = Awaited<ReturnType<Awaited<ReturnType<typeof resumeFixture>>["sdk"]>>;
