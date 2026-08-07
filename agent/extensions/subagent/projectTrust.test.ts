import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import subagentExtension, {
	buildSubagentChildProcessArgs,
	getChildCwdTrustBoundary,
	getProjectAgentTrustBlockReason,
	loadSubagentExecutionSettingsForChildCwd,
	prepareSubagentArguments,
	resolveConfiguredSubagentModelSelection,
} from "./index.ts";

const PI_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function writeJson(filePath: string, value: unknown): void {
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

async function withIsolatedSettingsFiles<T>(fn: (paths: { agentDir: string; cwd: string }) => T | Promise<T>): Promise<T> {
	const root = mkdtempSync(path.join(tmpdir(), "pi-subagent-project-trust-settings-"));
	const previousAgentDir = process.env[PI_AGENT_DIR_ENV];
	const agentDir = path.join(root, "agent");
	const cwd = path.join(root, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	process.env[PI_AGENT_DIR_ENV] = agentDir;
	try {
		return await fn({ agentDir, cwd });
	} finally {
		if (previousAgentDir === undefined) delete process.env[PI_AGENT_DIR_ENV];
		else process.env[PI_AGENT_DIR_ENV] = previousAgentDir;
		rmSync(root, { recursive: true, force: true });
	}
}

function registerSubagentTool() {
	const tools = new Map<string, any>();
	const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
	const pi = {
		registerTool(tool: any) {
			tools.set(tool.name, tool);
		},
		registerCommand() {},
		on(eventName: string, handler: (event: any, ctx: any) => any) {
			const existing = handlers.get(eventName) ?? [];
			existing.push(handler);
			handlers.set(eventName, existing);
		},
		getActiveTools() {
			return ["subagent"];
		},
		setActiveTools() {},
		getThinkingLevel() {
			return "medium";
		},
	};

	subagentExtension(pi as any);
	const tool = tools.get("subagent");
	assert.ok(tool, "subagent tool should be registered");
	return { tool, handlers };
}

function createCtx(cwd: string, trusted: boolean, hasUI = false) {
	let trustChecks = 0;
	let policyPrompts = 0;
	let projectAgentConfirmations = 0;
	let footerUpdates = 0;
	return {
		ctx: {
			cwd,
			mode: hasUI ? "interactive" : "print",
			hasUI,
			ui: {
				async select() {
					policyPrompts++;
					return "Allow once";
				},
				async confirm() {
					projectAgentConfirmations++;
					return true;
				},
				setStatus() {
					footerUpdates++;
				},
				theme: { fg(_color: string, text: string) { return text; } },
			},
			model: undefined,
			sessionManager: {
				getBranch() {
					return [];
				},
			},
			isProjectTrusted() {
				trustChecks++;
				return trusted;
			},
		},
		getTrustChecks() {
			return trustChecks;
		},
		getLifecycleSideEffects() {
			return { policyPrompts, projectAgentConfirmations, footerUpdates };
		},
	};
}

test("before_agent_start ignores project subagent settings unless the context is trusted", async () => {
	await withIsolatedSettingsFiles(async ({ cwd }) => {
		writeJson(path.join(cwd, CONFIG_DIR_NAME, "settings.json"), {
			subagents: {
				maxParallelTasks: 2,
				maxConcurrency: 1,
				maxDelegationDepth: 0,
			},
		});

		const { handlers } = registerSubagentTool();
		const [beforeAgentStart] = handlers.get("before_agent_start") ?? [];
		assert.ok(beforeAgentStart, "before_agent_start handler should be registered");

		const untrustedResult = await beforeAgentStart({ systemPrompt: "Base prompt" }, createCtx(cwd, false).ctx);
		assert.match(
			untrustedResult?.systemPrompt ?? "",
			/Current parallel limits: 8 task\(s\) per call, with up to 5 subagent\(s\) running at once\./,
		);
		assert.match(untrustedResult?.systemPrompt ?? "", /Max delegation depth for this session is ∞\./);

		const trustedResult = await beforeAgentStart({ systemPrompt: "Base prompt" }, createCtx(cwd, true).ctx);
		assert.match(
			trustedResult?.systemPrompt ?? "",
			/Current parallel limits: 2 task\(s\) per call, with up to 1 subagent\(s\) running at once\./,
		);
		assert.match(trustedResult?.systemPrompt ?? "", /Max delegation depth for this session is 0\./);
	});
});

test("canonical subagent parameters keep model selection out of LLM tool calls and adapt legacy calls", () => {
	const { tool } = registerSubagentTool();
	assert.deepEqual(tool.parameters.required, ["mode", "items"]);
	for (const legacySelector of ["agent", "task", "tasks", "chain", "cwd", "model", "thinking"]) {
		assert.equal(legacySelector in tool.parameters.properties, false, `${legacySelector} must not be a top-level parameter`);
	}

	const itemProperties = tool.parameters.properties.items.items.properties;
	assert.equal("model" in itemProperties, false, "model must not be a per-item parameter");
	assert.equal("thinking" in itemProperties, false, "thinking must not be a per-item parameter");

	assert.deepEqual(
		prepareSubagentArguments({ agent: "scout", task: "Inspect auth", cwd: "packages/auth", model: "test/model" }),
		{
			mode: "single",
			items: [{ agent: "scout", task: "Inspect auth", cwd: "packages/auth" }],
		},
	);
	assert.deepEqual(
		prepareSubagentArguments({
			mode: "single",
			items: [{ agent: "scout", task: "Inspect auth", model: "provider/model", thinking: "minimal" }],
		}),
		{
			mode: "single",
			items: [{ agent: "scout", task: "Inspect auth" }],
		},
	);
	assert.deepEqual(
		prepareSubagentArguments({
			tasks: [{ agent: "scout", task: "Inspect auth" }],
			agentScope: "both",
		}),
		{
			mode: "parallel",
			items: [{ agent: "scout", task: "Inspect auth" }],
			agentScope: "both",
		},
	);
	assert.deepEqual(
		prepareSubagentArguments({ chain: [{ agent: "planner", task: "Plan from: {previous}" }] }),
		{
			mode: "chain",
			items: [{ agent: "planner", task: "Plan from: {previous}" }],
		},
	);
});

test("child model selection uses only local agent defaults", () => {
	assert.deepEqual(
		resolveConfiguredSubagentModelSelection("scout", {
			agentDefaults: {
				scout: { model: "github-copilot/gpt-5.6-luna", thinking: "high" },
			},
		}),
		{ model: "github-copilot/gpt-5.6-luna", thinking: "high" },
	);
	assert.deepEqual(resolveConfiguredSubagentModelSelection("reviewer-readonly", { agentDefaults: {} }), {});
});

test("external child cwd ignores target project settings", async () => {
	await withIsolatedSettingsFiles(async ({ agentDir, cwd }) => {
		const externalCwd = path.join(path.dirname(cwd), "external-project");
		mkdirSync(externalCwd, { recursive: true });
		writeJson(path.join(agentDir, "settings.json"), {
			subagents: { maxParallelTasks: 6, maxConcurrency: 4, maxDelegationDepth: 3 },
		});
		writeJson(path.join(cwd, CONFIG_DIR_NAME, "settings.json"), {
			subagents: { maxParallelTasks: 2, maxConcurrency: 1, maxDelegationDepth: 2 },
		});
		writeJson(path.join(externalCwd, CONFIG_DIR_NAME, "settings.json"), {
			subagents: { maxParallelTasks: 1, maxConcurrency: 1, maxDelegationDepth: 0 },
		});

		const child = loadSubagentExecutionSettingsForChildCwd(cwd, externalCwd, true);

		assert.equal(child.reusesParentProjectTrust, false);
		assert.deepEqual(child.executionSettings.limits, {
			maxParallelTasks: 6,
			maxConcurrency: 4,
			maxDelegationDepth: 3,
		});
		assert.deepEqual(child.executionSettings.sources, {
			maxParallelTasks: "global",
			maxConcurrency: "global",
			maxDelegationDepth: "global",
		});
	});
});

test("external project and both scopes block before target project-agent discovery", async () => {
	await withIsolatedSettingsFiles(async ({ cwd }) => {
		const externalCwd = path.join(path.dirname(cwd), "external-project");
		mkdirSync(path.join(externalCwd, CONFIG_DIR_NAME, "agents"), { recursive: true });
		writeFileSync(
			path.join(externalCwd, CONFIG_DIR_NAME, "agents", "external-agent.md"),
			"---\nname: external-agent\ndescription: Must not be discovered\ntools: read\n---\nDo not load me.\n",
			"utf-8",
		);
		const { handlers } = registerSubagentTool();
		const [toolCallHandler] = handlers.get("tool_call") ?? [];
		assert.ok(toolCallHandler, "subagent tool_call handler should be registered");

		for (const agentScope of ["project", "both"] as const) {
			const { ctx, getTrustChecks } = createCtx(cwd, true);
			const result = await toolCallHandler(
				{
					toolName: "subagent",
					toolCallId: `external-${agentScope}`,
					input: {
						mode: "single",
						items: [{ agent: "external-agent", task: "Do not discover", cwd: externalCwd }],
						agentScope,
					},
				},
				ctx,
			);

			assert.equal(result?.block, true);
			assert.match(result?.reason ?? "", /outside the parent session cwd/);
			assert.equal(getTrustChecks(), 1, "the parent project trust may be consulted but must not extend externally");
		}
	});
});

test("external user-scoped child invocation disables approval", () => {
	assert.ok(buildSubagentChildProcessArgs({ tools: ["read"] }, {}, true).includes("--no-approve"));
	assert.equal(buildSubagentChildProcessArgs({ tools: ["read"] }, {}, false).includes("--no-approve"), false);
});

test("contained child cwd uses its canonical path and retains parent project behavior", () => {
	const root = mkdtempSync(path.join(tmpdir(), "pi-subagent-contained-boundary-"));
	try {
		const parentCwd = path.join(root, "parent");
		const canonicalChildCwd = path.join(parentCwd, "nested");
		const symlinkPath = path.join(parentCwd, "alias");
		mkdirSync(canonicalChildCwd, { recursive: true });
		symlinkSync(canonicalChildCwd, symlinkPath);

		const child = getChildCwdTrustBoundary(parentCwd, symlinkPath);

		assert.equal(child.reusesParentProjectTrust, true);
		assert.equal(child.executionCwd, realpathSync(canonicalChildCwd));
		assert.equal(getProjectAgentTrustBlockReason("both", child.reusesParentProjectTrust), null);
		assert.equal(buildSubagentChildProcessArgs({ tools: ["read"] }, {}, false).includes("--no-approve"), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("symlink escapes from the parent cwd are external", () => {
	const root = mkdtempSync(path.join(tmpdir(), "pi-subagent-symlink-boundary-"));
	try {
		const parentCwd = path.join(root, "parent");
		const externalCwd = path.join(root, "external");
		const symlinkPath = path.join(parentCwd, "escaped");
		mkdirSync(parentCwd, { recursive: true });
		mkdirSync(externalCwd, { recursive: true });
		symlinkSync(externalCwd, symlinkPath);

		const child = getChildCwdTrustBoundary(parentCwd, symlinkPath);

		assert.equal(child.reusesParentProjectTrust, false);
		assert.equal(child.executionCwd, symlinkPath);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("invalid canonical subagent requests reject from execute before child work starts", async () => {
	const { tool } = registerSubagentTool();
	const cwd = mkdtempSync(path.join(tmpdir(), "pi-subagent-invalid-modes-"));
	try {
		const { ctx } = createCtx(cwd, true);
		const invalidParams = [
			{},
			{ mode: "parallel", items: [] },
			{ mode: "single", items: [{ agent: "scout", task: "Do not run" }, { agent: "scout", task: "Do not run" }] },
			{ mode: "invalid", items: [{ agent: "scout", task: "Do not run" }] },
			{ mode: "parallel", items: [{ agent: "", task: "Do not run" }] },
			{ mode: "chain", items: [{ agent: "scout", task: " \t\n" }] },
		];

		for (const params of invalidParams) {
			await assert.rejects(
				() => tool.execute("invalid-mode-test", params, new AbortController().signal, undefined, ctx),
				/Invalid parameters\./,
			);
		}
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("parallel task limits reject from execute with configured-limit guidance", async () => {
	await withIsolatedSettingsFiles(async ({ agentDir, cwd }) => {
		writeJson(path.join(agentDir, "settings.json"), {
			subagents: { maxParallelTasks: 1, maxConcurrency: 1 },
		});

		const { tool } = registerSubagentTool();
		const { ctx } = createCtx(cwd, true);
		await assert.rejects(
			() =>
				tool.execute(
					"parallel-limit-test",
					{
						mode: "parallel",
						items: [
							{ agent: "scout", task: "Do not run" },
							{ agent: "scout", task: "Do not run" },
						],
					},
					new AbortController().signal,
					undefined,
					ctx,
				),
			/Too many parallel tasks \(2\)\. Max is 1\. Configure via \/subagents max-tasks <n> or settings\.json subagents\.maxParallelTasks\./,
		);
	});
});

test("structural project-agent calls reach execute only to reject before policy UI, confirmation, footer, or child work", async () => {
	await withIsolatedSettingsFiles(async ({ agentDir, cwd }) => {
		writeJson(path.join(agentDir, "settings.json"), {
			subagents: { maxParallelTasks: 1, maxConcurrency: 1 },
		});
		mkdirSync(path.join(cwd, CONFIG_DIR_NAME, "agents"), { recursive: true });
		writeFileSync(
			path.join(cwd, CONFIG_DIR_NAME, "agents", "repo-reviewer.md"),
			"---\nname: repo-reviewer\ndescription: Project reviewer\ntools: read\n---\nReview the project.\n",
			"utf-8",
		);

		const { tool, handlers } = registerSubagentTool();
		const [toolCallHandler] = handlers.get("tool_call") ?? [];
		assert.ok(toolCallHandler, "subagent tool_call handler should be registered");

		const malformed = {
			mode: "single",
			items: [],
			agentScope: "project",
		};
		const malformedCtx = createCtx(cwd, true, true);
		assert.equal(
			await toolCallHandler({ toolName: "subagent", toolCallId: "malformed-project", input: malformed }, malformedCtx.ctx),
			undefined,
		);
		await assert.rejects(
			() => tool.execute("malformed-project", malformed, new AbortController().signal, undefined, malformedCtx.ctx),
			/Invalid parameters\./,
		);
		assert.equal(malformedCtx.getTrustChecks(), 0, "malformed modes should reject before trust checks");
		assert.deepEqual(malformedCtx.getLifecycleSideEffects(), {
			policyPrompts: 0,
			projectAgentConfirmations: 0,
			footerUpdates: 0,
		});

		const malformedProjectEntries = [
			{ mode: "single", items: [{ agent: "", task: "Do not run" }], agentScope: "project" },
			{ mode: "single", items: [{ agent: "repo-reviewer", task: " \t\n" }], agentScope: "project" },
			{
				mode: "parallel",
				items: [
					{ agent: "repo-reviewer", task: "Do not run" },
					{ agent: " \t", task: "Do not run" },
				],
				agentScope: "project",
			},
			{
				mode: "parallel",
				items: [
					{ agent: "repo-reviewer", task: "Do not run" },
					{ agent: "repo-reviewer", task: "" },
				],
				agentScope: "project",
			},
			{
				mode: "chain",
				items: [
					{ agent: "repo-reviewer", task: "Do not run" },
					{ agent: "", task: "Do not run" },
				],
				agentScope: "project",
			},
			{
				mode: "chain",
				items: [
					{ agent: "repo-reviewer", task: "Do not run" },
					{ agent: "repo-reviewer", task: "\n  " },
				],
				agentScope: "project",
			},
		];
		for (const [index, malformedEntry] of malformedProjectEntries.entries()) {
			const entryCtx = createCtx(cwd, true, true);
			assert.equal(
				await toolCallHandler(
					{ toolName: "subagent", toolCallId: `malformed-entry-${index}`, input: malformedEntry },
					entryCtx.ctx,
				),
				undefined,
			);
			await assert.rejects(
				() => tool.execute(`malformed-entry-${index}`, malformedEntry, new AbortController().signal, undefined, entryCtx.ctx),
				/Invalid parameters\./,
			);
			assert.equal(entryCtx.getTrustChecks(), 0, "malformed entries should reject before trust checks");
			assert.deepEqual(entryCtx.getLifecycleSideEffects(), {
				policyPrompts: 0,
				projectAgentConfirmations: 0,
				footerUpdates: 0,
			});
		}

		const overLimit = {
			mode: "parallel",
			items: [
				{ agent: "repo-reviewer", task: "Do not run A" },
				{ agent: "repo-reviewer", task: "Do not run B" },
			],
			agentScope: "project",
		};
		const overLimitCtx = createCtx(cwd, true, true);
		assert.equal(
			await toolCallHandler({ toolName: "subagent", toolCallId: "over-limit-project", input: overLimit }, overLimitCtx.ctx),
			undefined,
		);
		await assert.rejects(
			() => tool.execute("over-limit-project", overLimit, new AbortController().signal, undefined, overLimitCtx.ctx),
			/Too many parallel tasks \(2\)\. Max is 1\./,
		);
		assert.deepEqual(overLimitCtx.getLifecycleSideEffects(), {
			policyPrompts: 0,
			projectAgentConfirmations: 0,
			footerUpdates: 0,
		});
	});
});

test("project-local agent scopes are blocked when the project is not trusted", async () => {
	const { tool } = registerSubagentTool();
	const cwd = mkdtempSync(path.join(tmpdir(), "pi-subagent-trust-"));
	try {
		const { ctx, getTrustChecks } = createCtx(cwd, false);

		await assert.rejects(
			() =>
				tool.execute(
					"trust-test",
					{
						mode: "single",
						items: [{ agent: "local-agent", task: "Do not run" }],
						agentScope: "project",
						confirmProjectAgents: false,
					},
					new AbortController().signal,
					undefined,
					ctx,
				),
			/Blocked: project-local agents require project trust.*agentScope="project".*confirmProjectAgents/s,
		);
		assert.equal(getTrustChecks(), 1, "project scope should consult ctx.isProjectTrusted() before discovery");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("tool_call policy blocks project-local scopes before runtime discovery when untrusted", async () => {
	const { handlers } = registerSubagentTool();
	const [toolCallHandler] = handlers.get("tool_call") ?? [];
	assert.ok(toolCallHandler, "subagent tool_call handler should be registered");

	const cwd = mkdtempSync(path.join(tmpdir(), "pi-subagent-trust-policy-"));
	try {
		const { ctx, getTrustChecks } = createCtx(cwd, false);
		const result = await toolCallHandler(
			{
				toolName: "subagent",
				toolCallId: "trust-policy-test",
				input: {
					mode: "single",
					items: [{ agent: "local-agent", task: "Do not discover" }],
					agentScope: "both",
					confirmProjectAgents: false,
				},
			},
			ctx,
		);

		assert.equal(result?.block, true);
		assert.match(result?.reason ?? "", /Blocked: project-local agents require project trust.*agentScope="both"/s);
		assert.equal(getTrustChecks(), 1, "policy path should consult ctx.isProjectTrusted() before discovery");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("project trust gate blocks project/both scopes but not user scope", () => {
	assert.equal(getProjectAgentTrustBlockReason("user", false), null);
	assert.equal(getProjectAgentTrustBlockReason("user", true), null);
	assert.equal(getProjectAgentTrustBlockReason("project", true), null);
	assert.equal(getProjectAgentTrustBlockReason("both", true), null);

	const projectReason = getProjectAgentTrustBlockReason("project", false);
	assert.match(projectReason ?? "", /agentScope="project"/);
	assert.match(projectReason ?? "", new RegExp(escapeRegex(`${CONFIG_DIR_NAME}/agents`)));
	assert.match(projectReason ?? "", /confirmProjectAgents/);

	const bothReason = getProjectAgentTrustBlockReason("both", false);
	assert.match(bothReason ?? "", /agentScope="both"/);
	assert.match(bothReason ?? "", /agentScope="user"/);
});
