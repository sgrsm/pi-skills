import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import subagentExtension, { getProjectAgentTrustBlockReason } from "./index.ts";

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

test("invalid subagent modes reject from execute before child work starts", async () => {
	const { tool } = registerSubagentTool();
	const cwd = mkdtempSync(path.join(tmpdir(), "pi-subagent-invalid-modes-"));
	try {
		const { ctx } = createCtx(cwd, true);
		const invalidParams = [
			{ agent: "scout", task: "Do not run", tasks: [{ agent: "scout", task: "Do not run" }] },
			{ agent: "scout", task: "Do not run", chain: [{ agent: "scout", task: "Do not run" }] },
			{ agent: "scout", task: "Do not run", tasks: [] },
			{},
			{ agent: "scout" },
			{ task: "Do not run" },
			{ tasks: [] },
			{ chain: [] },
		];

		for (const params of invalidParams) {
			await assert.rejects(
				() => tool.execute("invalid-mode-test", params, new AbortController().signal, undefined, ctx),
				/Invalid parameters\. Provide exactly one mode\./,
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
						tasks: [
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
			agent: "repo-reviewer",
			task: "Do not run",
			tasks: [],
			agentScope: "project",
		};
		const malformedCtx = createCtx(cwd, true, true);
		assert.equal(
			await toolCallHandler({ toolName: "subagent", toolCallId: "malformed-project", input: malformed }, malformedCtx.ctx),
			undefined,
		);
		await assert.rejects(
			() => tool.execute("malformed-project", malformed, new AbortController().signal, undefined, malformedCtx.ctx),
			/Invalid parameters\. Provide exactly one mode\./,
		);
		assert.equal(malformedCtx.getTrustChecks(), 0, "malformed modes should reject before trust checks");
		assert.deepEqual(malformedCtx.getLifecycleSideEffects(), {
			policyPrompts: 0,
			projectAgentConfirmations: 0,
			footerUpdates: 0,
		});

		const malformedProjectEntries = [
			{ agent: "", task: "Do not run", agentScope: "project" },
			{ agent: "repo-reviewer", task: " \t\n", agentScope: "project" },
			{
				tasks: [
					{ agent: "repo-reviewer", task: "Do not run" },
					{ agent: " \t", task: "Do not run" },
				],
				agentScope: "project",
			},
			{
				tasks: [
					{ agent: "repo-reviewer", task: "Do not run" },
					{ agent: "repo-reviewer", task: "" },
				],
				agentScope: "project",
			},
			{
				chain: [
					{ agent: "repo-reviewer", task: "Do not run" },
					{ agent: "", task: "Do not run" },
				],
				agentScope: "project",
			},
			{
				chain: [
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
				/Invalid parameters\. Provide exactly one mode\./,
			);
			assert.equal(entryCtx.getTrustChecks(), 0, "malformed entries should reject before trust checks");
			assert.deepEqual(entryCtx.getLifecycleSideEffects(), {
				policyPrompts: 0,
				projectAgentConfirmations: 0,
				footerUpdates: 0,
			});
		}

		const overLimit = {
			tasks: [
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
						agent: "local-agent",
						task: "Do not run",
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
					agent: "local-agent",
					task: "Do not discover",
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
