import assert from "node:assert/strict";
import childProcess, { spawn as esmSpawn } from "node:child_process";
import fsPromises from "node:fs/promises";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import test, { after, type TestContext } from "node:test";
import { runToolCall } from "@earendil-works/pi-agent-core";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { createTestScratchFixture } from "../permissions/testScratch.ts";
import { createUsageStats, toBillableUsage } from "./usageAccounting.ts";

// Import config-sensitive modules only after isolating their module-level paths.
const moduleFixture = await createTestScratchFixture();
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const moduleAgentDir = path.join(moduleFixture.root, "agent");
await moduleFixture.mkdir(moduleAgentDir);
await moduleFixture.writeFile(path.join(moduleAgentDir, "subagent-policy.json"), '{"mode":"ask"}\n');
process.env.PI_CODING_AGENT_DIR = moduleAgentDir;
const { default: subagentExtension } = await import("./index.ts");
after(async () => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
	await moduleFixture.cleanup();
});

function usage(input: number) {
	return { ...createUsageStats(), input, output: 2, totalTokens: input + 2,
		cost: { input: input / 1000, output: 0.002, cacheRead: 0, cacheWrite: 0, total: (input + 2) / 1000 } };
}

function assistant(input = 10, overrides: Record<string, unknown> = {}) {
	return { role: "assistant", content: [{ type: "text", text: "child output" }],
		api: "anthropic-messages", provider: "anthropic", model: "fixture", timestamp: 0,
		usage: toBillableUsage(usage(input)), stopReason: "stop", ...overrides };
}

interface ChildScript {
	messages?: unknown[];
	stderr?: string;
	exitCode?: number;
	abort?: AbortController;
	abortAfterClose?: AbortController;
}

// No real PID, executable, model request or process-group signal is used.
class FakeChild extends EventEmitter {
	readonly stdout = new EventEmitter();
	readonly stderr = new EventEmitter();
	readonly signals: NodeJS.Signals[] = [];
	readonly stdin: EventEmitter & { end(prompt: string): void };
	prompt = "";
	constructor(script: ChildScript) {
		super();
		this.stdin = Object.assign(new EventEmitter(), { end: (prompt: string) => {
			this.prompt = prompt;
			queueMicrotask(() => {
				for (const message of script.messages ?? [assistant()]) {
					this.stdout.emit("data", Buffer.from(`${JSON.stringify({ type: "message_end", message })}\n`));
				}
				if (script.stderr) this.stderr.emit("data", Buffer.from(script.stderr));
				script.abort?.abort();
				this.emit("close", script.exitCode ?? 0, script.abort ? "SIGTERM" : null);
				script.abortAfterClose?.abort();
			});
		} });
	}
	kill(signal: NodeJS.Signals) { this.signals.push(signal); return true; }
}

function registerTool() {
	const tools = new Map<string, any>();
	const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
	subagentExtension({ events: createEventBus(), registerTool: (tool: any) => tools.set(tool.name, tool),
		registerCommand() {}, on(name: string, handler: any) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
			return () => {};
		} } as any);
	return { tool: tools.get("subagent"), handlers };
}

async function withTool(t: TestContext, scripts: ChildScript[], fn: (h: {
	tool: any; ctx: any; children: FakeChild[]; call: (mode?: string, signal?: AbortSignal) => Promise<any>;
	handlers: Map<string, Array<(event: any, ctx: any) => any>>;
	writeAgent: (fileName: string, fields: string) => Promise<string>;
}) => Promise<void>, systemPrompt = "") {
	const fixture = await createTestScratchFixture();
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const agentDir = path.join(fixture.root, "agent");
	await fixture.mkdir(agentDir);
	await fixture.mkdir(path.join(agentDir, "agents"));
	await fixture.writeFile(path.join(agentDir, "agents/scout.md"), `---\nname: scout\ndescription: Fixture scout\ntools: read\n---\n${systemPrompt}`);
	await fixture.writeFile(path.join(agentDir, "settings.json"), "{}\n");
	process.env.PI_CODING_AGENT_DIR = agentDir;
	const children: FakeChild[] = [];
	const spawn = t.mock.method(childProcess, "spawn", () => {
		const script = scripts[children.length];
		assert.ok(script, "unexpected child invocation");
		const child = new FakeChild(script);
		children.push(child);
		return child;
	});
	syncBuiltinESMExports();
	try {
		assert.equal(esmSpawn, spawn, "ESM spawn must be mocked before executing any child path");
		const { tool, handlers } = registerTool();
		const ctx = { cwd: fixture.project, hasUI: false, mode: "print", isProjectTrusted: () => false,
			sessionManager: { getBranch: () => [] } };
		let callId = 0;
		const call = async (mode = "single", signal?: AbortSignal) => {
			const items = Array.from({ length: mode === "single" ? 1 : scripts.length }, (_, i) =>
				({ agent: "scout", task: i === 0 ? "Inspect" : "Review {previous}" }));
			// Public host seam exercises the exact thrown-error fallback and returned error contract.
			const id = `failure-fixture-${++callId}`;
			const outcome = await runToolCall({ type: "toolCall", id, name: "subagent", arguments: { mode, items } }, {
				tools: [{ ...tool, execute: (...args: any[]) => tool.execute(...args, ctx) }],
				assistantMessage: assistant() as any, context: { messages: [], tools: [] }, signal,
			});
			for (const handler of handlers.get("tool_execution_end") ?? []) {
				await handler({ toolName: "subagent", toolCallId: id }, ctx);
			}
			return outcome;
		};
		const writeAgent = async (fileName: string, fields: string) => {
			const filePath = path.join(agentDir, "agents", fileName);
			await fixture.writeFile(filePath, `---\n${fields}\n---\nFixture prompt.`);
			return filePath;
		};
		await fn({ tool, ctx, children, call, handlers, writeAgent });
		for (const child of children) {
			assert.equal(child.listenerCount("close"), 0, "lifecycle listeners released");
			assert.equal(child.stdout.listenerCount("data"), 0);
		}
	} finally {
		spawn.mock.restore();
		syncBuiltinESMExports();
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		await fixture.cleanup();
	}
}

const failures: Array<[string, ChildScript]> = [
	["nonzero exit", { exitCode: 2 }],
	["provider error", { messages: [assistant(10, { stopReason: "error", errorMessage: "provider failed" })] }],
	["provider aborted", { messages: [assistant(10, { stopReason: "aborted", errorMessage: "provider cancelled" })] }],
	["stderr diagnostic", { exitCode: 1, stderr: "stderr-only diagnostic" }],
];
for (const [label, failure] of failures) {
	for (const mode of ["single", "chain"]) {
		test(`${mode} ${label} retains failed details and incurred usage`, async (t) => {
			const scripts = mode === "chain" ? [{ messages: [assistant(20)] }, failure, {}] : [failure];
			await withTool(t, scripts, async ({ call, children, tool }) => {
				const outcome = await call(mode);
				assert.equal(outcome.isError, true);
				assert.equal(outcome.result.isError, true);
				const results = outcome.result.details.results;
				assert.equal(results.length, mode === "chain" ? 2 : 1);
				assert.equal(children.length, results.length, "chain stops before unincurred step");
				assert.equal(outcome.result.usage.input, mode === "chain" ? 30 : 10);
				assert.equal(outcome.result.usage.output, results.length * 2);
				assert.equal(outcome.result.usage.cost.total, mode === "chain" ? 0.034 : 0.012);
				assert.match(outcome.result.content[0].text, mode === "chain" ? /Chain stopped at step 2 \(scout\):/ : /Agent .*:/);
				const failed = results.at(-1);
				assert.equal(failed.task, mode === "chain" ? "Review child output" : "Inspect");
				if (mode === "chain") assert.deepEqual(results.map((r: any) => r.step), [1, 2]);
				if (failure.stderr) assert.equal(failed.stderr, failure.stderr);
				if (mode === "chain") {
					for (const expanded of [false, true]) {
						const text = render(tool, outcome.result, expanded, outcome.toolCall.arguments);
						assert.doesNotMatch(text, /waiting/, "terminal failed chains must not advertise unrun work");
					}
				}
			});
		});
	}
}

for (const mode of ["single", "chain"]) {
	test(`${mode} live cancellation retains consumed usage and releases child listeners`, async (t) => {
		const abort = new AbortController();
		await withTool(t, mode === "chain" ? [{ messages: [assistant(20)] }, { abort }, {}] : [{ abort }], async ({ call, children }) => {
			const outcome = await call(mode, abort.signal);
			assert.equal(outcome.isError, true);
			assert.equal(outcome.result.details.results.at(-1).stopReason, "aborted");
			assert.equal(outcome.result.usage.input, mode === "chain" ? 30 : 10);
			assert.equal(children.length, mode === "chain" ? 2 : 1);
			assert.deepEqual(children.at(-1)!.signals, ["SIGTERM"]);
		});
	});
}

test("chain cancellation between steps retains completed work without starting another child", async (t) => {
	const abortAfterClose = new AbortController();
	await withTool(t, [{ abortAfterClose }, {}], async ({ call, children, tool }) => {
		const outcome = await call("chain", abortAfterClose.signal);
		assert.equal(outcome.isError, true);
		assert.equal(outcome.result.details.results.length, 1);
		assert.equal(outcome.result.details.results[0].exitCode, 0);
		assert.equal(outcome.result.usage.input, 10);
		assert.equal(children.length, 1);
		assert.match(outcome.result.content[0].text, /abort/i);
		// Pi's interactive TUI passes content/details, not the outer isError flag.
		for (const expanded of [false, true]) {
			const text = render(tool, { content: outcome.result.content, details: outcome.result.details }, expanded, outcome.toolCall.arguments);
			assert.doesNotMatch(text, /waiting/);
			assert.match(text, /Chain aborted before step 2/);
			assert.match(text, /✗/);
		}
	});
});

test("chain abort during next-child prompt preparation retains earlier results and cleans prompts", async (t) => {
	const abort = new AbortController();
	await withTool(t, [{}, {}], async ({ call, children }) => {
		const originalWrite = fsPromises.writeFile;
		const promptPaths: string[] = [];
		const write = t.mock.method(fsPromises, "writeFile", async (...args: Parameters<typeof originalWrite>) => {
			const result = await originalWrite(...args);
			if (String(args[0]).endsWith("prompt-scout.md")) {
				promptPaths.push(String(args[0]));
				if (promptPaths.length === 2) abort.abort();
			}
			return result;
		});
		try {
			const outcome = await call("chain", abort.signal);
			assert.equal(outcome.isError, true);
			assert.equal(outcome.result.details.results.length, 1);
			assert.equal(outcome.result.usage.input, 10);
			assert.equal(children.length, 1, "aborted next child was not spawned");
			assert.equal(promptPaths.length, 2, "abort exercised asynchronous preparation, not the loop-top check");
			assert.match(outcome.result.content[0].text, /Chain aborted before step 2/);
			for (const promptPath of promptPaths) await assert.rejects(fsPromises.access(promptPath), { code: "ENOENT" });
		} finally { write.mock.restore(); }
	}, "Fixture system prompt");
});

test("parallel cancellation keeps its existing abort-only contract", async (t) => {
	const abort = new AbortController();
	await withTool(t, [{ abort }, {}], async ({ call, children }) => {
		const outcome = await call("parallel", abort.signal);
		assert.equal(outcome.isError, true);
		assert.deepEqual(outcome.result.details, {});
		assert.equal(outcome.result.usage, undefined);
		assert.match(outcome.result.content[0].text, /abort/i);
		assert.ok(children.length > 0);
	});
});

test("stderr-only child with no usage is still a structured error", async (t) => {
	await withTool(t, [{ messages: [], exitCode: 1, stderr: "startup failed" }], async ({ call }) => {
		const outcome = await call();
		assert.equal(outcome.isError, true);
		assert.equal(outcome.result.details.results[0].stderr, "startup failed");
		assert.equal(outcome.result.usage, undefined);
	});
});

test("child nested tool usage is counted once, not again from nested details", async (t) => {
	const nested = { role: "toolResult", toolName: "subagent", toolCallId: "nested", content: [], isError: true,
		usage: toBillableUsage(usage(30)), details: { mode: "single", results: [{ usage: usage(30) }] }, timestamp: 0 };
	await withTool(t, [{ messages: [nested, assistant(10, { stopReason: "error" })] }], async ({ call }) => {
		const outcome = await call();
		assert.equal(outcome.result.usage.input, 40);
		assert.equal(outcome.result.usage.output, 4);
		assert.equal(outcome.result.usage.totalTokens, 44);
	});
});

for (const mode of ["single", "chain", "parallel"]) {
	test(`${mode} successful accounting remains unchanged`, async (t) => {
		await withTool(t, mode === "single" ? [{}] : [{}, {}], async ({ call }) => {
			const outcome = await call(mode);
			assert.equal(outcome.isError, false);
			assert.equal(outcome.result.isError, undefined);
			assert.equal(outcome.result.usage.input, mode === "single" ? 10 : 20);
		});
	});
}

test("parallel partial failure retains its existing non-error summary", async (t) => {
	await withTool(t, [{}, { exitCode: 1, stderr: "failed" }], async ({ call }) => {
		const outcome = await call("parallel");
		assert.equal(outcome.isError, false);
		assert.equal(outcome.result.details.results.length, 2);
		assert.equal(outcome.result.usage.input, 20);
		assert.match(outcome.result.content[0].text, /Parallel: 1\/2 succeeded/);
	});
});

for (const mode of ["single", "chain", "parallel"]) {
	test(`${mode} parent escalation remains a non-error with usage`, async (t) => {
		const escalation = { role: "toolResult", toolName: "escalate_to_parent", toolCallId: "question", content: [],
			details: { requestType: "clarify", question: "Choose?", options: [], allowCustom: true }, isError: false, timestamp: 0 };
		await withTool(t, [{ messages: [assistant(), escalation], exitCode: 1 }, {}], async ({ call, tool }) => {
			const outcome = await call(mode);
			assert.equal(outcome.isError, false);
			assert.equal(outcome.result.usage.input, mode === "parallel" ? 20 : 10);
			assert.match(outcome.result.content[0].text, /Choose\?/);
			if (mode === "chain") {
				assert.match(render(tool, outcome.result, false, outcome.toolCall.arguments), /scout  Review\s+waiting/,
					"parent input keeps waiting steps; it is not a terminal child failure");
			}
		});
	});
}

test("pre-child parameter errors and pre-abort still throw without usage", async (t) => {
	await withTool(t, [], async ({ tool, ctx, children }) => {
		await assert.rejects(tool.execute("invalid", { mode: "single", items: [] }, undefined, undefined, ctx), /items/);
		const abort = new AbortController(); abort.abort();
		await assert.rejects(tool.execute("pre-abort", { mode: "single", items: [{ agent: "scout", task: "Inspect" }] }, abort.signal, undefined, ctx), /abort/i);
		assert.equal(children.length, 0);
	});
});

test("failure output stays truncated with a full-output file", async (t) => {
	const stderr = Array.from({ length: 2200 }, (_, i) => `diagnostic line ${i}`).join("\n");
	await withTool(t, [{ exitCode: 1, stderr }], async ({ call }) => {
		const outcome = await call();
		assert.equal(outcome.isError, true);
		assert.equal(outcome.result.details.results[0].stderr, stderr);
		const text = outcome.result.content[0].text;
		assert.match(text, /Output truncated/);
		const outputPath = text.match(/Full output saved to: ([^\]]+)\]/)?.[1];
		assert.ok(outputPath);
		assert.equal(await readFile(outputPath, "utf8"), stderr);
	});
});

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
function render(tool: any, result: any, expanded: boolean, args = {}, isPartial = false) {
	return tool.renderResult(result, { expanded, isPartial }, theme, { args }).render(120).join("\n");
}

for (const [label, details] of Object.entries({
	absent: undefined, null: null, hostFallback: {}, missingResults: { mode: "single" },
	wrongResults: { mode: "single", results: {} }, stringResults: { mode: "single", results: "bad" },
	nullEntry: { mode: "single", results: [null] }, malformedEntry: { mode: "single", results: [{}] },
	sparseResults: { mode: "single", results: new Array(1) }, invalidMode: { mode: "invalid", results: [] },
	empty: { mode: "single", results: [] },
})) {
	test(`renderer safely falls back for ${label} details`, () => {
		const { tool } = registerTool();
		for (const expanded of [false, true]) {
			assert.match(render(tool, { content: [{ type: "text", text: "host error text" }], details }, expanded), /host error text/);
		}
	});
}

test("renderer preserves legacy persisted usage and optional result fields", () => {
	const { tool } = registerTool();
	const legacyUsage = { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.012, turns: 1 };
	const result = { content: [{ type: "text", text: "stored output" }], details: {
		mode: "chain", agentScope: "user", projectAgentsDir: null, results: [{ agent: "scout", agentSource: "user",
			task: "Inspect", exitCode: 1, step: 1, errorMessage: "stored failure", usage: legacyUsage }],
	} };
	for (const expanded of [false, true]) {
		const text = render(tool, result, expanded);
		assert.match(text, /stored failure/);
		assert.match(text, /\$0\.0120/);
		assert.match(text, /↑10/);
		assert.match(text, /✗/);
	}
	assert.equal(result.details.results[0].usage, legacyUsage, "rendering does not mutate persisted data");
});

test("partial chain rendering keeps waiting steps while work is running", () => {
	const { tool } = registerTool();
	const result = { content: [], details: { mode: "chain", agentScope: "user", results: [{
		agent: "scout", agentSource: "user", task: "Inspect", exitCode: -1, messages: [], parentEscalations: [], usage: usage(10),
	}] } };
	const args = { mode: "chain", items: [{ agent: "scout", task: "Inspect" }, { agent: "scout", task: "Review" }] };
	assert.match(render(tool, result, false, args, true), /waiting/);
});

for (const [label, override] of Object.entries({
	badCost: { usage: { ...usage(10), cost: "invalid" } },
	badEscalations: { parentEscalations: [null] }, badContent: { messages: [{ role: "assistant", content: [null] }] },
})) {
	test(`renderer falls back for malformed ${label} in otherwise valid details`, () => {
		const { tool } = registerTool();
		const result = { content: [{ type: "text", text: "fallback diagnostic" }], details: { mode: "single", results: [{
			agent: "scout", agentSource: "user", task: "Inspect", exitCode: 1, messages: [], parentEscalations: [], usage: usage(10), ...override,
		}] } };
		for (const expanded of [false, true]) assert.match(render(tool, result, expanded), /fallback diagnostic/);
	});
}

test("discovery warnings reach UI or stderr once per execution without blocking valid children", async (t) => {
	for (const hasUI of [false, true]) {
		await withTool(t, [{}, {}], async ({ ctx, call, children, writeAgent }) => {
			const filePath = await writeAgent("broken.md", "name: broken\ndescription: Broken tools\ntools: [read, false]");
			const warnings: string[] = [];
			ctx.hasUI = hasUI;
			ctx.ui = {
				notify(message: string, type: string) { assert.equal(type, "warning"); warnings.push(message); },
				setStatus() {},
				theme: { fg(_color: string, text: string) { return text; } },
			};
			const stderr = t.mock.method(console, "error", (message: string) => warnings.push(message));
			try {
				const outcome = await call("parallel");
				assert.equal(outcome.isError, false);
				assert.equal(children.length, 2);
				assert.equal(warnings.length, 1, "cached discoveries must not repeat rejection warnings");
				assert.ok(warnings[0].includes(filePath));
				assert.match(warnings[0], /tools/);
				assert.equal(stderr.mock.callCount(), hasUI ? 0 : 1);
			} finally {
				stderr.mock.restore();
			}
		});
	}
});

test("policy rejection for malformed requested agents includes the file path and reason", async (t) => {
	await withTool(t, [], async ({ ctx, handlers, children, writeAgent }) => {
		const filePath = await writeAgent("broken.md", "name: broken\ndescription: Broken tools\ntools: 42");
		const [handler] = handlers.get("tool_call") ?? [];
		assert.ok(handler);
		const decision = await handler({ toolName: "subagent", toolCallId: "bad-tools-policy",
			input: { mode: "single", items: [{ agent: "broken", task: "Do not run" }] } }, ctx);
		assert.equal(decision.block, true);
		assert.ok(decision.reason.includes(filePath));
		assert.match(decision.reason, /tools/);
		assert.equal(children.length, 0);
	});
});

test("renderer preserves valid failure diagnostics and usage in collapsed and expanded views", () => {
	const { tool } = registerTool();
	const result = { content: [{ type: "text", text: "Agent error" }], details: {
		mode: "single", agentScope: "user", projectAgentsDir: null, results: [{ agent: "scout", agentSource: "user",
			task: "Inspect", exitCode: 1, stopReason: "error", errorMessage: "provider failed", stderr: "stderr detail",
			messages: [], parentEscalations: [], usage: usage(10) }],
	} };
	for (const expanded of [false, true]) {
		const text = render(tool, result, expanded);
		assert.match(text, /provider failed/);
		assert.match(text, /stderr detail/);
		assert.match(text, /\$0\.0120/);
		assert.match(text, /✗/);
	}
});
