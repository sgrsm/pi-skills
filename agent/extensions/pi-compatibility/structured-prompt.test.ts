import assert from "node:assert/strict";
import { realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
	createEventBus, discoverAndLoadExtensions, ExtensionRunner, SessionManager,
	type BuildSystemPromptOptions, type ExtensionUIContext, type ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import { withTestScratchFixture } from "../permissions/testScratch.ts";

const ownedKeys = ["clarify_policy", "permissions_scratch", "subagent_policy"] as const;
const clarificationPolicy = `Clarification policy:
- If you discover multiple materially different ways to proceed, stop and use clarify before committing to one.
- If you would otherwise make a non-trivial assumption that affects correctness, behavior, scope, safety, or user intent, use clarify first.
- Keep choices focused and distinct. Prefer around 2-5 options plus the custom-instructions path.
- Phrase options as actionable paths, and use descriptions only for brief trade-offs or consequences.
- Do not interrupt for trivial defaults, obvious next steps, or decisions the user already made.
- After the user answers, follow that direction and continue.`;
const clarificationNote = `Clarification note:
- The clarify tool requires interactive UI and is not usable in this mode.
- If user input is required, ask in plain text instead of calling clarify.`;

// Public loader/runner, real in-memory SessionManager, synthetic late MCP guidance.
// Reading event.systemPrompt in the last handler uses the host's actual renderer;
// no private builder import or live MCP/model request is needed.
test("additive prompt contributors preserve the structured host contract", async (t) => {
	await withTestScratchFixture(async (fixture) => {
		assert.equal(await realpath(tmpdir()), fixture.approvedRoot, "TMPDIR must point at the approved scratch root before loading extensions");
		const agentDir = join(fixture.root, "agent");
		await fixture.mkdir(agentDir);
		const envKeys = ["PI_CODING_AGENT_DIR", "PI_SUBAGENT_DEPTH", "PI_SUBAGENT_PARENT_ESCALATION",
			"PI_SUBAGENT_INHERITED_APPROVAL", "PI_SUBAGENT_INHERITED_APPROVAL_SCOPE"];
		const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
		const events = createEventBus();
		let rendered = "";
		const unsubscribe = events.on("structured-prompt-snapshot", (value) => { rendered = String(value); });
		const latePath = join(fixture.root, "late.ts");
		const forcedPath = join(fixture.root, "forced.ts");
		await fixture.writeFile(latePath, `export default (pi) => pi.on("before_agent_start", (event) => {
			event.systemPromptOptions.sections.mcp_servers = "Synthetic late MCP guidance";
			event.systemPromptOptions.sections.other_extension = "Synthetic late extension guidance";
			pi.events.emit("structured-prompt-snapshot", event.systemPrompt);
		});`);
		await fixture.writeFile(forcedPath, `export default (pi) => pi.on("before_agent_start", () => ({ systemPrompt: "Deliberate full replacement" }));`);
		const localPaths = ["clarify", "permissions", "subagent"].map((name) =>
			fileURLToPath(new URL(`../${name}/index.ts`, import.meta.url)));
		const runners = new Set<ExtensionRunner>();
		async function load(paths = [...localPaths, latePath], manager = SessionManager.inMemory(fixture.project)) {
			const loaded = await discoverAndLoadExtensions(paths, fixture.project, agentDir, events);
			assert.deepEqual(loaded.errors, []);
			let active = ["clarify", "subagent", "escalate_to_parent", "bash"];
			loaded.runtime.getActiveTools = () => [...active];
			loaded.runtime.setActiveTools = (tools) => { active = [...tools]; };
			const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, fixture.project, manager, {} as ModelRegistry);
			const errors: unknown[] = [];
			runner.onError((error) => errors.push(error));
			runners.add(runner);
			return {
				runner, manager, errors,
				setActive: (tools: string[]) => { active = tools; },
				async configure(enabled = true, mode = "ask", hasUI = true) {
					await writeFile(await fixture.assertMutationTarget(join(agentDir, "clarify.json")), JSON.stringify({ enabled }), { mode: 0o600 });
					await writeFile(await fixture.assertMutationTarget(join(agentDir, "subagent-policy.json")), JSON.stringify({ mode }), { mode: 0o600 });
					const ui = { ...runner.getUIContext(), theme: {
						fg: (_color: string, text: string) => text, bold: (text: string) => text,
					} as ExtensionUIContext["theme"] };
					runner.setUIContext(hasUI ? ui : undefined, hasUI ? "tui" : "print");
					await runner.emit({ type: "session_start", reason: "reload" });
					assert.deepEqual(errors, []);
				},
				async turn(options: BuildSystemPromptOptions = { cwd: fixture.project, sections: { unrelated: "Keep me" } }) {
					rendered = "";
					const result = await runner.emitBeforeAgentStart("Synthetic prompt", undefined, options);
					assert.deepEqual(errors, []);
					assert.deepEqual(result.messages, []);
					assert.notEqual(rendered, "", "the late contributor must run on every turn");
					return result.systemPromptOptions;
				},
			};
		}
		process.env.PI_CODING_AGENT_DIR = agentDir;
		for (const key of envKeys.slice(1)) delete process.env[key];
		try {
			await fixture.writeFile(join(agentDir, "settings.json"), JSON.stringify({ subagents: {
				maxParallelTasks: 7, maxConcurrency: 3, maxDelegationDepth: 2,
			} }));
			const h = await load();
			await h.configure();
			await t.test("late sections reach the rendered prompt without any forced replacement", async () => {
				const options = await h.turn();
				assert.match(rendered, /Synthetic late MCP guidance/);
				assert.match(rendered, /Synthetic late extension guidance/);
				assert.equal(options.forceSystemPrompt, undefined);
				assert.equal(options.sections.unrelated, "Keep me");
				assert.equal(options.sections.clarify_policy, clarificationPolicy);
				assert.match(options.sections.subagent_policy!, /Current parallel limits: 7 task\(s\).*3 subagent\(s\)/);
				const workspace = join(tmpdir(), "pi", `session-${h.manager.getSessionId()}`);
				assert.equal(options.sections.permissions_scratch, `Use scratch temp dir instead of /tmp: ${workspace}`);
				await assert.rejects(stat(workspace), { code: "ENOENT" });
				for (const key of ownedKeys) assert.equal(rendered.split(`<${key}>`).length - 1, 1, key);
			});
			await t.test("repeated turns replace owned contributions, including reused options", async () => {
				// Real host turns start from fresh base options; reuse also checks defensive ownership/removal.
				const first = await h.turn();
				const second = await h.turn(first);
				assert.equal(second.forceSystemPrompt, undefined);
				assert.deepEqual(second.sections, first.sections);
				for (const key of ownedKeys) assert.equal(rendered.split(`<${key}>`).length - 1, 1, key);
			});
			await t.test("no-UI guidance replaces the interactive policy without duplication", async () => {
				const first = await h.turn();
				await h.configure(true, "ask", false);
				const second = await h.turn(first);
				assert.equal(second.sections.clarify_policy, clarificationNote);
				assert.match(second.sections.subagent_policy!, /Non-explicit calls block because no approval UI is available/);
				assert.doesNotMatch(rendered, /Clarification policy:/);
				assert.equal(second.forceSystemPrompt, undefined);
			});
			await t.test("inactive tools and saved off modes remove stale owned sections only", async () => {
				await h.configure();
				const first = await h.turn();
				h.setActive(["bash"]);
				const inactive = await h.turn(first);
				assert.equal(inactive.sections.clarify_policy, undefined);
				assert.equal(inactive.sections.subagent_policy, undefined);
				assert.equal(inactive.sections.unrelated, "Keep me");
				assert.ok(inactive.sections.permissions_scratch);
				await h.configure(false, "off");
				h.setActive(["clarify", "bash"]); // Disabled state must win even if another loadout activates clarify.
				const off = await h.turn(first);
				assert.equal(off.sections.clarify_policy, undefined);
				assert.equal(off.sections.subagent_policy, undefined);
				assert.equal(off.forceSystemPrompt, undefined);
			});
			for (const mode of ["manual", "ask", "auto"]) {
				await t.test(`${mode} delegation policy retains its mode and UI semantics`, async () => {
					await h.configure(true, mode, false);
					h.setActive(["clarify", "subagent", "bash"]); // Keep prompt tests independent of startup restoration (0005).
					const options = await h.turn();
					assert.match(options.sections.subagent_policy!, new RegExp(`Current subagent mode is ${mode}\\.`));
					assert.equal(options.forceSystemPrompt, undefined);
					if (mode === "auto") assert.match(options.sections.subagent_policy!, /out-of-policy calls block because no approval UI/);
				});
			}
			await t.test("child-only escalation keeps policy when delegation is off or depth-limited", async () => {
				try {
					process.env.PI_SUBAGENT_PARENT_ESCALATION = "1";
					process.env.PI_SUBAGENT_INHERITED_APPROVAL_SCOPE = "read-only";
					await h.configure(true, "off");
					const off = await h.turn();
					assert.match(off.sections.subagent_policy!, /subagent tool is disabled completely/);
					assert.match(off.sections.subagent_policy!, /use escalate_to_parent/);
					process.env.PI_SUBAGENT_DEPTH = "2";
					await h.configure();
					const capped = await h.turn(off);
					assert.match(capped.sections.subagent_policy!, /inherits read-only nested delegation approval/);
					assert.match(capped.sections.subagent_policy!, /maximum delegation depth has already been reached/);
					assert.match(capped.sections.subagent_policy!, /use escalate_to_parent/);
					assert.equal(capped.forceSystemPrompt, undefined);
				} finally {
					for (const key of envKeys.slice(1)) delete process.env[key];
				}
			});
			await t.test("session/write approvals and inherited broad scope retain their policy guidance", async () => {
				await h.configure(true, "ask", false);
				h.manager.appendCustomEntry("subagent-session-approval", { askModeApproved: true, writeCapableApproved: true });
				try {
					process.env.PI_SUBAGENT_INHERITED_APPROVAL_SCOPE = "all";
					const options = await h.turn();
					assert.match(options.sections.subagent_policy!, /inherits broad user approval/);
					assert.match(options.sections.subagent_policy!, /current-session approval for non-explicit write-capable/);
					assert.doesNotMatch(options.sections.subagent_policy!, /Non-explicit calls block because no approval UI/);
					assert.equal(options.forceSystemPrompt, undefined);
				} finally {
					delete process.env.PI_SUBAGENT_INHERITED_APPROVAL_SCOPE;
					h.manager.appendCustomEntry("subagent-session-approval", { askModeApproved: false, writeCapableApproved: false });
				}
			});
			await t.test("a new session id on the same runtime replaces only scratch guidance", async () => {
				await h.configure();
				const first = await h.turn();
				h.manager.newSession();
				await h.configure();
				const second = await h.turn(first);
				assert.notEqual(second.sections.permissions_scratch, first.sections.permissions_scratch);
				assert.equal(second.sections.permissions_scratch, `Use scratch temp dir instead of /tmp: ${join(tmpdir(), "pi", `session-${h.manager.getSessionId()}`)}`);
				assert.deepEqual({ ...second.sections, permissions_scratch: first.sections.permissions_scratch }, first.sections);
			});
			await t.test("fresh loader instances preserve sections and session id on real-style reload", async () => {
				await h.configure();
				const first = await h.turn();
				await h.runner.emit({ type: "session_shutdown", reason: "reload" });
				h.runner.invalidate();
				runners.delete(h.runner);
				const fresh = await load([...localPaths].reverse().concat(latePath), h.manager);
				await fresh.configure();
				const second = await fresh.turn(first);
				assert.deepEqual(second.sections, first.sections);
				assert.equal(second.sections.clarify_policy, clarificationPolicy);
				assert.equal(second.sections.unrelated, "Keep me");
				assert.equal(second.forceSystemPrompt, undefined);
				assert.equal(second.sections.mcp_servers, "Synthetic late MCP guidance");
				assert.equal(second.sections.other_extension, "Synthetic late extension guidance");
				assert.match(rendered, /Synthetic late MCP guidance/);
			});
			for (const position of ["before", "after"]) {
				await t.test(`deliberate whole-prompt replacement ${position} local handlers remains authoritative`, async () => {
					const paths = position === "before" ? [forcedPath, ...localPaths, latePath] : [...localPaths, forcedPath, latePath];
					const forced = await load(paths);
					await forced.configure();
					const options = await forced.turn();
					assert.equal(options.forceSystemPrompt, "Deliberate full replacement");
					assert.equal(rendered, "Deliberate full replacement");
					for (const key of ownedKeys) assert.ok(options.sections[key], key);
				});
			}
		} finally {
			try {
				for (const runner of runners) {
					try { await runner.emit({ type: "session_shutdown", reason: "quit" }); }
					finally { runner.invalidate(); }
				}
			} finally {
				unsubscribe();
				for (const key of envKeys) {
					if (savedEnv[key] === undefined) delete process.env[key];
					else process.env[key] = savedEnv[key];
				}
			}
		}
	});
});
