import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
	createAgentSession, createEventBus, discoverAndLoadExtensions, ModelRuntime,
	SessionManager, SettingsManager,
	type AgentSession, type LoadExtensionsResult, type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { withTestScratchFixture } from "../permissions/testScratch.ts";

const workflowNames = ["clarify", "subagent", "escalate_to_parent"];
const envKeys = ["PI_CODING_AGENT_DIR", "PI_SUBAGENT_PARENT_ESCALATION", "PI_SUBAGENT_DEPTH",
	"PI_SUBAGENT_INHERITED_APPROVAL", "PI_SUBAGENT_INHERITED_APPROVAL_SCOPE"];
const localPaths = ["clarify", "subagent"].map((name) =>
	fileURLToPath(new URL(`../${name}/index.ts`, import.meta.url)));

for (const mode of ["on", "only"] as const) {
	test(`real codemode ${mode} preserves direct-only workflow declarations and sandbox exclusion`, async () => {
		await withTestScratchFixture(async (fixture) => {
			const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
			let session: AgentSession | undefined;
			try {
				const agentDir = join(fixture.root, "agent");
				await fixture.mkdir(agentDir);
				for (const key of envKeys) delete process.env[key];
				process.env.PI_CODING_AGENT_DIR = agentDir;
				process.env.PI_SUBAGENT_PARENT_ESCALATION = "1";
				await fixture.writeFile(join(agentDir, "clarify.json"), JSON.stringify({ enabled: true }));
				await fixture.writeFile(join(agentDir, "subagent-policy.json"), JSON.stringify({ mode: "auto" }));
				const codemodePath = join(fixture.root, "codemode.ts");
				await fixture.writeFile(codemodePath, `import { createCodemodeExtension } from "@earendil-works/pi-coding-agent";
export default createCodemodeExtension({ mode: ${JSON.stringify(mode)} });`);
				const modelRuntime = await ModelRuntime.create({
					authPath: join(agentDir, "auth.json"), modelsPath: null,
					modelsStorePath: join(agentDir, "models-store.json"),
					allowModelNetwork: false, refreshOnCreate: false,
				});
				const settingsManager = SettingsManager.inMemory({ defaultTools: ["+codemode"] });
				const events = createEventBus();
				let loaded: LoadExtensionsResult;
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
						loaded = await discoverAndLoadExtensions([...localPaths, codemodePath], fixture.project, agentDir, events);
						assert.deepEqual(loaded.errors, []);
					},
				};
				await resourceLoader.reload();
				({ session } = await createAgentSession({ cwd: fixture.project, agentDir, settingsManager,
					sessionManager: SessionManager.inMemory(fixture.project), resourceLoader, modelRuntime }));
				session.agent.streamFunction = () => { throw new Error("Model requests are forbidden in codemode fixtures"); };
				const errors: unknown[] = [];
				await session.bindExtensions({ mode: "print", onError: (error) => errors.push(error) });
				assert.deepEqual(errors, []);

				const declared = session.agent.state.tools;
				for (const name of workflowNames) {
					assert.equal(session.getToolDefinition(name)?.exposure, "model-only", name);
					assert.ok(session.getActiveToolNames().includes(name), name);
					assert.ok(!session.getCallableToolNames().includes(name), name);
					const description = declared.find((tool) => tool.name === name)!.description;
					assert.match(description, new RegExp(`Call ${name} directly as a model tool`), name);
					assert.ok(!description.includes(`Codemode: \`tools.${name}(args)\``), name);
				}
				// Inspect the real request projection: active direct tools are hidden only in "only" mode.
				const projected = await session.agent.transformContext!([{
					role: "system", content: session.systemPrompt, timestamp: Date.now(),
					toolsAdded: declared.map(({ name, description, parameters }) => ({ name, description, parameters })),
				}], new AbortController().signal);
				const system = projected.find((message) => message.role === "system")!;
				assert.equal(system.role, "system");
				if (system.role !== "system") throw new Error("Expected a projected system message");
				const projectedNames = system.toolsAdded?.map((tool) => tool.name) ?? [];
				for (const name of workflowNames) assert.ok(projectedNames.includes(name), name);
				assert.equal(projectedNames.includes("read"), mode === "on");
				assert.match(session.systemPrompt, /Call clarify directly/);
				assert.match(session.systemPrompt, /Call subagent directly/);
				assert.match(session.systemPrompt, /Call escalate_to_parent directly/);

				// Execute the real sandbox, but never invoke a nested tool or start a child/dialog.
				const codemode = declared.find((tool) => tool.name === "codemode")!;
				const result = await codemode.execute("catalog-only", { code: `
const names = ${JSON.stringify(workflowNames)};
text({ catalog: ALL_TOOLS.filter(tool => names.includes(tool.name)) });
text({ search: (await searchTools("clarify subagent escalate_to_parent", { limit: 100 })).filter(tool => names.includes(tool.name)) });
text({ missingDescriptions: (await Promise.all(names.map(name => describeTool(name)))).every(value => value === undefined) });
text({ callableControl: ALL_TOOLS.some(tool => tool.name === "read") && (await describeTool("read")) !== undefined });
for (const name of names) {
  try { tools[name]; text("Unexpected callable workflow tool: " + name); }
  catch (error) { text(String(error)); }
}` }, new AbortController().signal);
				const output = result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
				assert.match(output, /Script completed/);
				assert.ok(output.includes('"catalog":[]'));
				assert.ok(output.includes('"search":[]'));
				assert.ok(output.includes('"missingDescriptions":true'));
				assert.ok(output.includes('"callableControl":true'));
				for (const name of workflowNames) assert.ok(output.includes(`tools.${name} does not exist`), name);
				assert.doesNotMatch(output, /Unexpected callable workflow tool/);
				assert.deepEqual(errors, []);
			} finally {
				try {
					if (session) {
						try { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); }
						finally { session.dispose(); }
					}
				} finally {
					for (const key of envKeys) {
						if (savedEnv[key] === undefined) delete process.env[key];
						else process.env[key] = savedEnv[key];
					}
				}
			}
		});
	});
}
