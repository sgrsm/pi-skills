import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import subagentExtension, { getProjectAgentTrustBlockReason } from "./index.ts";

const PI_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

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

function createCtx(cwd: string, trusted: boolean) {
	let trustChecks = 0;
	return {
		ctx: {
			cwd,
			mode: "print",
			hasUI: false,
			ui: {},
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
	};
}

test("before_agent_start ignores project subagent settings unless the context is trusted", async () => {
	await withIsolatedSettingsFiles(async ({ cwd }) => {
		writeJson(path.join(cwd, ".pi", "settings.json"), {
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
	assert.match(projectReason ?? "", /\.pi\/agents/);
	assert.match(projectReason ?? "", /confirmProjectAgents/);

	const bothReason = getProjectAgentTrustBlockReason("both", false);
	assert.match(bothReason ?? "", /agentScope="both"/);
	assert.match(bothReason ?? "", /agentScope="user"/);
});
