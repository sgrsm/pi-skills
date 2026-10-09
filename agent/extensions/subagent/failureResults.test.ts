import assert from "node:assert/strict";
import childProcess, { spawn as esmSpawn } from "node:child_process";
import fsPromises from "node:fs/promises";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import test, { after, type TestContext } from "node:test";
import { runToolCall } from "@earendil-works/pi-agent-core";
import { CONFIG_DIR_NAME, createEventBus, ExtensionSelectorComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { stripVTControlCharacters } from "node:util";
import { formatProgramStatus } from "@earendil-works/pi-tui";
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
	waitForKill?: boolean;
	compactionUsage?: unknown;
}

// No real PID, executable, model request or process-group signal is used.
class FakeChild extends EventEmitter {
	readonly stdout = new EventEmitter();
	readonly stderr = new EventEmitter();
	readonly signals: NodeJS.Signals[] = [];
	readonly stdin: EventEmitter & { end(prompt: string): void };
	prompt = "";
	private readonly closeOnKill: boolean;
	constructor(script: ChildScript) {
		super();
		this.closeOnKill = Boolean(script.waitForKill);
		this.stdin = Object.assign(new EventEmitter(), { end: (prompt: string) => {
			this.prompt = prompt;
			queueMicrotask(() => {
				for (const message of script.messages ?? [assistant()]) {
					this.stdout.emit("data", Buffer.from(`${JSON.stringify({ type: "message_end", message })}\n`));
				}
				if (script.stderr) this.stderr.emit("data", Buffer.from(script.stderr));
				if (script.compactionUsage) this.stdout.emit("data", Buffer.from(`${JSON.stringify({
					type: "compaction_end", result: { usage: script.compactionUsage },
				})}\n`));
				script.abort?.abort();
				if (!script.waitForKill) this.emit("close", script.exitCode ?? 0, script.abort ? "SIGTERM" : null);
				script.abortAfterClose?.abort();
			});
		} });
	}
	kill(signal: NodeJS.Signals) {
		this.signals.push(signal);
		if (this.closeOnKill) queueMicrotask(() => this.emit("close", null, signal));
		return true;
	}
}

function registerTool() {
	const tools = new Map<string, any>();
	const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
	const entries: Array<{ type: string; customType: string; data: unknown }> = [];
	subagentExtension({ events: createEventBus(), registerTool: (tool: any) => tools.set(tool.name, tool),
		appendEntry(customType: string, data: unknown) { entries.push({ type: "custom", customType, data }); },
		registerCommand() {}, on(name: string, handler: any) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
			return () => {};
		} } as any);
	return { tool: tools.get("subagent"), handlers, entries };
}

async function withTool(t: TestContext, scripts: ChildScript[], fn: (h: {
	tool: any; ctx: any; children: FakeChild[];
	call: (mode?: string, signal?: AbortSignal, onUpdate?: (partial: any) => void) => Promise<any>;
	handlers: Map<string, Array<(event: any, ctx: any) => any>>;
	entries: Array<{ type: string; customType: string; data: unknown }>;
	writeAgent: (fileName: string, fields: string, source?: "user" | "project") => Promise<string>;
}) => Promise<void>, systemPrompt = "", settings: Record<string, unknown> = {}) {
	const fixture = await createTestScratchFixture();
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const agentDir = path.join(fixture.root, "agent");
	await fixture.mkdir(agentDir);
	await fixture.mkdir(path.join(agentDir, "agents"));
	await fixture.writeFile(path.join(agentDir, "agents/scout.md"), `---\nname: scout\ndescription: Fixture scout\ntools: read\n---\n${systemPrompt}`);
	await fixture.writeFile(path.join(agentDir, "settings.json"), `${JSON.stringify(settings)}\n`);
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
		const { tool, handlers, entries } = registerTool();
		const ctx = { cwd: fixture.project, hasUI: false, mode: "print", isProjectTrusted: () => false,
			sessionManager: { getBranch: () => [] } };
		let callId = 0;
		const call = async (mode = "single", signal?: AbortSignal, onUpdate?: (partial: any) => void) => {
			const items = Array.from({ length: mode === "single" ? 1 : scripts.length }, (_, i) =>
				({ agent: "scout", task: i === 0 ? "Inspect" : "Review {previous}" }));
			// Public host seam exercises the exact thrown-error fallback and returned error contract.
			const id = `failure-fixture-${++callId}`;
			const outcome = await runToolCall({ type: "toolCall", id, name: "subagent", arguments: { mode, items } }, {
				tools: [{ ...tool, execute: (...args: any[]) => tool.execute(...args, ctx) }],
				assistantMessage: assistant() as any, context: { messages: [], tools: [] }, signal, onUpdate,
			});
			for (const handler of handlers.get("tool_execution_end") ?? []) {
				await handler({ toolName: "subagent", toolCallId: id }, ctx);
			}
			return outcome;
		};
		const writeAgent = async (fileName: string, fields: string, source: "user" | "project" = "user") => {
			const agentsDir = source === "project" ? path.join(fixture.project, CONFIG_DIR_NAME, "agents") : path.join(agentDir, "agents");
			if (source === "project") {
				await fixture.mkdir(path.dirname(agentsDir));
				await fixture.mkdir(agentsDir);
			}
			const filePath = path.join(agentsDir, fileName);
			await fixture.writeFile(filePath, `---\n${fields}\n---\nFixture prompt.`);
			return filePath;
		};
		await fn({ tool, ctx, children, call, handlers, entries, writeAgent });
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

test("parallel cancellation retains active-child results and usage after cleanup", { timeout: 5_000 }, async (t) => {
	const abort = new AbortController();
	await withTool(t, [{ waitForKill: true, messages: [assistant(20)] }, { abort, stderr: "cancelled child diagnostic" }], async ({ call, children }) => {
		const outcome = await call("parallel", abort.signal);
		assert.equal(outcome.isError, true);
		assert.equal(outcome.result.isError, true);
		assert.equal(children.length, 2);
		assert.equal(outcome.result.details.results.length, 2);
		assert.ok(outcome.result.details.results.every((r: any) => r.stopReason === "aborted" && r.exitCode !== -1));
		assert.equal(outcome.result.details.results[1].stderr, "cancelled child diagnostic");
		assert.equal(outcome.result.usage.input, 30);
		assert.equal(outcome.result.usage.output, 4);
		assert.equal(outcome.result.usage.totalTokens, 34);
		assert.equal(outcome.result.usage.cost.total, 0.034);
		assert.match(outcome.result.content[0].text, /Parallel aborted: retained 2\/2 task results/);
		assert.match(outcome.result.content[0].text, /cancelled child diagnostic/);
		for (const child of children) assert.deepEqual(child.signals, ["SIGTERM"]);
	});
});

test("parallel cancellation retains completed and aborted work once, without starting queued work", { timeout: 5_000 }, async (t) => {
	const abort = new AbortController();
	const nested = { role: "toolResult", toolName: "subagent", toolCallId: "nested", content: [], isError: false,
		usage: toBillableUsage(usage(30)), details: { mode: "single", results: [{ usage: usage(30) }] }, timestamp: 0 };
	await withTool(t, [
		{ messages: [nested, assistant(20, { content: [{ type: "text", text: "completed finding" }] })], compactionUsage: toBillableUsage(usage(5)) },
		{ abort, stderr: "aborted diagnostic" },
		{ messages: [assistant(1000)] },
	], async ({ call, children, tool }) => {
		const outcome = await call("parallel", abort.signal);
		assert.equal(outcome.isError, true);
		assert.equal(outcome.result.isError, true);
		const results = outcome.result.details.results;
		assert.equal(results.length, 2);
		assert.equal(children.length, 2, "queued third child must not start");
		assert.equal(results[0].exitCode, 0);
		assert.equal(results[1].stopReason, "aborted");
		assert.equal(results[1].stderr, "aborted diagnostic");
		assert.equal(outcome.result.usage.input, 65, "direct, nested and compaction usage counted once");
		assert.equal(outcome.result.usage.output, 8);
		assert.equal(outcome.result.usage.totalTokens, 73);
		assert.ok(Math.abs(outcome.result.usage.cost.total - 0.073) < 1e-12);
		assert.match(outcome.result.content[0].text, /Parallel aborted: retained 2\/3 task results/);
		assert.match(outcome.result.content[0].text, /completed finding/);
		assert.match(outcome.result.content[0].text, /aborted diagnostic/);
		assert.deepEqual(children[1].signals, ["SIGTERM"]);
		for (const expanded of [false, true]) {
			const text = render(tool, { content: outcome.result.content, details: outcome.result.details }, expanded, outcome.toolCall.arguments);
			assert.match(text, /Parallel aborted/);
			assert.match(text, /✗/);
			assert.doesNotMatch(text, /waiting|running|queued/);
		}
	}, "", { subagents: { maxConcurrency: 1 } });
});

test("parallel abort during next-child preparation retains only completed results and renders an error", async (t) => {
	const abort = new AbortController();
	await withTool(t, [{}, {}, {}], async ({ call, children, tool }) => {
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
			const outcome = await call("parallel", abort.signal);
			assert.equal(outcome.isError, true);
			assert.equal(outcome.result.details.results.length, 1);
			assert.equal(outcome.result.details.results[0].exitCode, 0);
			assert.equal(outcome.result.usage.input, 10);
			assert.equal(children.length, 1);
			assert.equal(promptPaths.length, 2);
			for (const expanded of [false, true]) {
				const text = render(tool, { content: outcome.result.content, details: outcome.result.details }, expanded, outcome.toolCall.arguments);
				assert.match(text, /Parallel aborted: retained 1\/3 task results/);
				assert.match(text, /✗/);
				assert.doesNotMatch(text, /waiting|running|queued/);
			}
			for (const promptPath of promptPaths) await assert.rejects(fsPromises.access(promptPath), { code: "ENOENT" });
		} finally { write.mock.restore(); }
	}, "Fixture system prompt", { subagents: { maxConcurrency: 1 } });
});

test("parallel cancellation keeps retained parent requests diagnostic without prompting again", async (t) => {
	const abort = new AbortController();
	const escalation = { role: "toolResult", toolName: "escalate_to_parent", toolCallId: "question", content: [],
		details: { requestType: "clarify", question: "Choose retained option?", options: [], allowCustom: true }, isError: false, timestamp: 0 };
	await withTool(t, [{ messages: [assistant(), escalation], exitCode: 1 }, { abort }], async ({ call, tool }) => {
		const outcome = await call("parallel", abort.signal);
		assert.equal(outcome.isError, true);
		assert.equal(outcome.result.details.results[0].parentEscalations.length, 1);
		assert.equal(outcome.result.usage.input, 20);
		assert.match(outcome.result.content[0].text, /Choose retained option\?/);
		for (const expanded of [false, true]) {
			const text = render(tool, { content: outcome.result.content, details: outcome.result.details }, expanded, outcome.toolCall.arguments);
			assert.match(text, /Parallel aborted/);
			assert.match(text, /✗/);
			assert.match(text, /Choose retained option\?/);
		}
	}, "", { subagents: { maxConcurrency: 1 } });
});

test("parallel abort during initial prompt preparation fabricates no results or usage", async (t) => {
	const abort = new AbortController();
	await withTool(t, [{}], async ({ call, children }) => {
		const originalWrite = fsPromises.writeFile;
		const write = t.mock.method(fsPromises, "writeFile", async (...args: Parameters<typeof originalWrite>) => {
			const result = await originalWrite(...args);
			if (String(args[0]).endsWith("prompt-scout.md")) abort.abort();
			return result;
		});
		try {
			const outcome = await call("parallel", abort.signal);
			assert.ok(abort.signal.aborted);
			assert.equal(outcome.isError, true);
			assert.deepEqual(outcome.result.details, {});
			assert.equal(outcome.result.usage, undefined);
			assert.equal(children.length, 0);
		} finally { write.mock.restore(); }
	}, "Fixture system prompt");
});

for (const name of ["Error", "AbortError"]) {
	test(`parallel unexpected ${name} without cancellation still reaches the host fallback`, async (t) => {
		const error = new Error("sentinel update failure"); error.name = name;
		await withTool(t, [{}], async ({ call }) => {
			const outcome = await call("parallel", undefined, () => { throw error; });
			assert.equal(outcome.isError, true);
			assert.deepEqual(outcome.result.details, {});
			assert.equal(outcome.result.usage, undefined);
			assert.match(outcome.result.content[0].text, /sentinel update failure/);
			assert.doesNotMatch(outcome.result.content[0].text, /Parallel aborted/);
		});
	});
}

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
		for (const mode of ["single", "chain", "parallel"]) {
			await assert.rejects(tool.execute("pre-abort", { mode, items: [{ agent: "scout", task: "Inspect" }] }, abort.signal, undefined, ctx), /abort/i);
		}
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

test("parallel cancellation diagnostics retain truncation and full-output guidance", async (t) => {
	const abort = new AbortController();
	const stderr = Array.from({ length: 2200 }, (_, i) => `cancel diagnostic ${i}`).join("\n");
	await withTool(t, [{ abort, stderr }], async ({ call }) => {
		const outcome = await call("parallel", abort.signal);
		assert.equal(outcome.isError, true);
		assert.equal(outcome.result.details.results[0].stderr, stderr);
		const text = outcome.result.content[0].text;
		assert.match(text, /Parallel aborted/);
		assert.match(text, /Output truncated/);
		const outputPath = text.match(/Full output saved to: ([^\]]+)\]/)?.[1];
		assert.ok(outputPath);
		t.after(async () => {
			await fsPromises.unlink(outputPath);
			await fsPromises.rmdir(path.dirname(outputPath));
		});
		assert.match(await readFile(outputPath, "utf8"), /cancel diagnostic 2199/);
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

// The interactive host forwards select/editor titles into this public serializer.
function decodedBlockedTitle(title: string): string {
	const frame = formatProgramStatus({ state: "blocked", kind: "question", message: title });
	const encoded = /:msg=([^\x1b]+)/.exec(frame)?.[1];
	assert.ok(encoded, "title must produce a status message");
	return Buffer.from(encoded, "base64").toString("utf8");
}

for (const mode of ["tui", "rpc"]) {
	for (const choice of ["Allow once", "Allow for current session", "Deny", undefined]) {
		test(`${mode} policy approval keeps decisions and separates TUI status from details (${choice ?? "cancel"})`, async (t) => {
			await withTool(t, [], async ({ ctx, handlers, entries, children, writeAgent }) => {
				await writeAgent("worker.md", "name: worker\ndescription: Synthetic writer\ntools: write");
				const prompt = "Inspect PROMPT-SENTINEL-91a.";
				const task = "TASK-SENTINEL-d02: Inspect the synthetic module.";
				const calls: string[] = [];
				const notifications: string[] = [];
				let title = "";
				ctx.hasUI = true;
				ctx.mode = mode;
				ctx.sessionManager.getBranch = () => [{ type: "message", message: { role: "user", content: prompt } }, ...entries];
				ctx.ui = {
					notify(message: string, type: string) { assert.equal(type, "warning"); calls.push("notify"); notifications.push(message); },
					async select(value: string, options: string[]) {
						calls.push("select"); title = value;
						assert.deepEqual(options, ["Allow once", "Allow for current session", "Deny"]);
						if (mode === "tui") {
							initTheme("dark", false);
							const selector = new ExtensionSelectorComponent(value, options, () => {}, () => {});
							try {
								for (const width of [80, 40, 30]) {
									const lines = selector.render(width).map(stripVTControlCharacters);
									assert.ok(lines.length <= 21, `approval choices must fit the fullscreen dock at width ${width}`);
									for (const text of [...options, "navigate", "select", "cancel"]) assert.ok(lines.join("\n").includes(text), text);
								}
							} finally { selector.dispose(); }
						}
						return choice;
					},
					setStatus() {},
					theme: { fg(_color: string, text: string) { return text; } },
				};
				const outcome = await handlers.get("tool_call")![0]({ toolName: "subagent", toolCallId: "approval-status",
					input: { mode: "single", items: [{ agent: "worker", task }] } }, ctx);
				assert.deepEqual(calls, mode === "tui" ? ["notify", "select"] : ["select"]);
				const details = mode === "tui" ? notifications[0] : title;
				for (const content of [prompt, task, "Reason:", "Write-capable agents: worker", "auto-approve future non-explicit write-capable"]) {
					assert.ok(details.includes(content), content);
				}
				if (mode === "tui") {
					assert.equal(title, "Subagent delegation approval\nSee request details above.");
					assert.equal(decodedBlockedTitle(title), "Subagent delegation approval See request details above.");
				}
				assert.equal(Boolean(outcome?.block), choice !== "Allow once" && choice !== "Allow for current session");
				assert.deepEqual(entries.map((entry) => entry.data), choice === "Allow for current session"
					? [{ askModeApproved: true, writeCapableApproved: true }] : []);
				assert.equal(children.length, 0, "a preview never launches a child");
			});
		});
	}
}

test("TUI policy preview retains project-agent source and trust warnings", async (t) => {
	await withTool(t, [], async ({ ctx, handlers, writeAgent }) => {
		const agentPath = await writeAgent("worker.md", "name: worker\ndescription: Synthetic project writer\ntools: write", "project");
		let preview = "";
		ctx.hasUI = true;
		ctx.mode = "tui";
		ctx.isProjectTrusted = () => true;
		ctx.ui = {
			notify(message: string, type: string) { assert.equal(type, "warning"); preview = message; },
			async select(title: string) {
				assert.equal(title, "Subagent delegation approval\nSee request details above.");
				assert.ok(preview.includes(path.dirname(agentPath)), "source warning is visible before selecting");
				assert.match(preview, /Project-local agent confirmation covered by this policy approval/);
				assert.match(preview, /repo-controlled/);
				return "Deny";
			},
			setStatus() {},
			theme: { fg(_color: string, text: string) { return text; } },
		};
		const outcome = await handlers.get("tool_call")![0]({ toolName: "subagent", toolCallId: "project-preview",
			input: { mode: "single", items: [{ agent: "worker", task: "Inspect project task" }], agentScope: "both" } }, ctx);
		assert.equal(outcome.block, true);
	});
});

for (const mode of ["tui", "rpc"]) {
	test(`${mode} live orchestration uses the correct clarification UI mode and preserves details`, async (t) => {
		const escalation = { role: "toolResult", toolName: "escalate_to_parent", toolCallId: "question", content: [],
			details: { requestType: "clarify", question: "QUESTION-SENTINEL: Choose?", reason: "REASON-SENTINEL: Product direction.",
				options: [{ label: "Continue", description: "DESCRIPTION-SENTINEL: Keep behavior." }], allowCustom: true }, isError: false, timestamp: 0 };
		await withTool(t, [{ messages: [assistant(), escalation] }], async ({ ctx, call }) => {
			const notifications: string[] = [];
			let title = "";
			ctx.hasUI = true;
			ctx.mode = mode;
			ctx.ui = {
				notify(message: string, type: string) { assert.equal(type, "warning"); notifications.push(message); },
				async select(value: string) { title = value; return "1. Continue"; },
				async editor() { throw new Error("no editor expected"); },
				setStatus() {},
				theme: { fg(_color: string, text: string) { return text; } },
			};
			const outcome = await call();
			const details = mode === "tui" ? notifications[0] : title;
			for (const sentinel of ["QUESTION-SENTINEL", "REASON-SENTINEL", "DESCRIPTION-SENTINEL", "Original delegated task: Inspect"]) {
				assert.ok(details?.includes(sentinel), sentinel);
			}
			assert.equal(notifications.length, mode === "tui" ? 1 : 0);
			if (mode === "tui") assert.equal(decodedBlockedTitle(title), "Subagent clarification See request details above.");
			assert.equal(outcome.result.details.parentEscalationResolutions[0].answer, "Continue");
			assert.match(outcome.result.content[0].text, /User selected: 1\. Continue/);
		});
	});
}

