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

const envKeys = ["PI_CODING_AGENT_DIR", "PI_SUBAGENT_PARENT_ESCALATION", "PI_SUBAGENT_DEPTH",
	"PI_SUBAGENT_INHERITED_APPROVAL", "PI_SUBAGENT_INHERITED_APPROVAL_SCOPE"];
const gitInspectPath = fileURLToPath(new URL("../git-inspect/index.ts", import.meta.url));

test("real codemode describeTool presents git_inspect schema constraints without calling the tool", async () => {
	await withTestScratchFixture(async (fixture) => {
		const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
		let session: AgentSession | undefined;
		try {
			const agentDir = join(fixture.root, "agent");
			await fixture.mkdir(agentDir);
			for (const key of envKeys) delete process.env[key];
			process.env.PI_CODING_AGENT_DIR = agentDir;
			const codemodePath = join(fixture.root, "codemode.ts");
			await fixture.writeFile(codemodePath, `import { createCodemodeExtension } from "@earendil-works/pi-coding-agent";
export default createCodemodeExtension({ mode: "on" });`);
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
					loaded = await discoverAndLoadExtensions([gitInspectPath, codemodePath], fixture.project, agentDir, events);
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

			assert.ok(session.getCallableToolNames().includes("git_inspect"));
			const codemode = session.agent.state.tools.find((tool) => tool.name === "codemode")!;
			// Catalog only: describeTool() never invokes git_inspect, so no Git process starts.
			const result = await codemode.execute("git-inspect-catalog", {
				code: `text(String(await describeTool("git_inspect")));`,
			}, new AbortController().signal);
			const output = result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
			const diagnostic = `codemode output:\n${output}`;
			assert.deepEqual((result.details as { calls?: unknown[] } | undefined)?.calls, [], "nested tool calls");
			assert.match(output, /Script completed/, diagnostic);

			const maxCount = output.match(/\/\/ [^\n]*\n\s*\/\/ ([^\n]*)\n\s*maxCount\?:/)?.[1] ?? "";
			assert.match(maxCount, /@integer/, diagnostic);
			assert.match(maxCount, /@minimum 1\b/, diagnostic);
			assert.match(maxCount, /@maximum 100\b/, diagnostic);
			const paths = output.match(/\/\/ ([^\n]*)\n\s*paths\?:/)?.[1] ?? "";
			assert.match(paths, /@maxItems 20\b/, diagnostic);
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
