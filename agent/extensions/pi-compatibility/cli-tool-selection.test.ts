import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseArgs, VERSION } from "@earendil-works/pi-coding-agent";
import { withTestScratchFixture } from "../permissions/testScratch.ts";

// The actual CLI parser and a real offline CLI process (RPC reload command, no model prompt or MCP server).
// Covers the documented distinction between `--tools` modifiers and explicit `--exclude-tools`.
const defaults = ["read", "bash", "edit", "write"];
const locals = ["clarify", "subagent", "web_search"];
const localPaths = ["clarify", "web-search", "subagent"].map((name) =>
	fileURLToPath(new URL(`../${name}/index.ts`, import.meta.url)));

test("CLI parser separates plain allowlists, modifier lists and explicit exclusions", () => {
	const parsed = (...args: string[]) => parseArgs(args);

	const modifiers = parsed("--tools", "-clarify,-subagent,-web_search,+codemode");
	assert.deepEqual(modifiers.tools, ["-clarify", "-subagent", "-web_search", "+codemode"]);
	assert.deepEqual(modifiers.diagnostics, []);

	const exclusions = parsed("--tools", "+codemode", "--exclude-tools", "clarify, subagent,web_search");
	assert.deepEqual(exclusions.tools, ["+codemode"]);
	assert.deepEqual(exclusions.excludeTools, locals);
	assert.deepEqual(exclusions.diagnostics, []);

	// Shape that a frontmatter modifier becomes after the launcher appends escalate_to_parent.
	const mixed = parsed("--tools", "+codemode,escalate_to_parent");
	assert.equal(mixed.tools, undefined);
	assert.equal(mixed.diagnostics.length, 1);
	assert.equal(mixed.diagnostics[0]?.type, "error");
	assert.match(mixed.diagnostics[0]?.message ?? "", /cannot be mixed/);

	const allowlist = parsed("--tools", "read,grep,escalate_to_parent");
	assert.deepEqual(allowlist.tools, ["read", "grep", "escalate_to_parent"]);
	assert.deepEqual(allowlist.diagnostics, []);
});

async function runCli(args: string[], { expectSuccess = true } = {}) {
	return withTestScratchFixture(async (fixture) => {
		assert.equal(await realpath(process.env.TMPDIR ?? ""), await realpath(fixture.approvedRoot), "TMPDIR must name the approved scratch root");
		const agentDir = join(fixture.root, "agent");
		await fixture.mkdir(agentDir);
		const report = await fixture.assertMutationTarget(join(fixture.root, "report.jsonl"));
		const probePath = join(fixture.root, "probe.ts");
		await fixture.writeFile(probePath, `import { appendFileSync } from "node:fs";
			export default pi => {
				pi.on("session_start", (event) => appendFileSync(process.env.PI_CLI_REPORT, JSON.stringify({ reason: event.reason, active: pi.getActiveTools() }) + "\\n", { mode: 0o600 }));
				pi.registerCommand("probe-reload", { description: "Reload fixture", handler: async (_args, ctx) => { await ctx.reload(); } });
			};`);
		const hostRoot = await realpath(fileURLToPath(new URL("../node_modules/@earendil-works/pi-coding-agent", import.meta.url)));
		const hostPackage = JSON.parse(await readFile(join(hostRoot, "package.json"), "utf8")) as { version: string; bin: { pi: string } };
		assert.equal(hostPackage.version, VERSION);
		const child = spawnSync(process.execPath, [
			join(hostRoot, hostPackage.bin.pi), "--mode", "rpc", "--offline", "--no-approve", "--no-session",
			"--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
			"--model", "anthropic/claude-sonnet-4-5", "--api-key", "0005-offline-not-a-real-key",
			"-e", "builtin:codemode", ...[...localPaths, probePath].flatMap((path) => ["-e", path]), ...args,
		], {
			cwd: fixture.project, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: fixture.fakeHome,
				TMPDIR: fixture.approvedRoot, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1",
				PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", PI_SUBAGENT_PARENT_ESCALATION: "0",
				PI_SUBAGENT_DEPTH: "0", PI_CLI_REPORT: report },
			input: `${JSON.stringify({ type: "prompt", message: "/probe-reload" })}\n`,
			encoding: "utf8", timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 1_000_000,
		});
		assert.equal(child.error, undefined, child.error?.message);
		if (!expectSuccess) return { status: child.status, stderr: child.stderr, phases: [] };
		assert.equal(child.status, 0, `${child.stderr}\n${child.stdout}`);
		assert.ok(!child.stdout.includes('"type":"extension_error"'), child.stdout);
		const lines = (await readFile(report, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { reason: string; active: string[] });
		return { status: child.status, stderr: child.stderr,
			phases: lines.map((line) => ({ reason: line.reason, active: [...line.active].sort() })) };
	});
}

function assertStartupAndReload(phases: Array<{ reason: string; active: string[] }>, expected: string[]) {
	assert.deepEqual(phases.map((phase) => phase.reason), ["startup", "reload"]);
	for (const phase of phases) assert.deepEqual(phase.active, [...expected].sort(), phase.reason);
}

test("actual CLI: --tools modifiers adjust defaults but do not withdraw local extension tools", { timeout: 60_000 }, async () => {
	const { phases } = await runCli(["--tools", "-clarify,-subagent,-web_search,+codemode"]);
	assertStartupAndReload(phases, [...defaults, ...locals, "codemode"]);
});

test("actual CLI: --tools +codemode with --exclude-tools withdraws the named local tools", { timeout: 60_000 }, async () => {
	const { phases } = await runCli(["--tools", "+codemode", "--exclude-tools", locals.join(",")]);
	assertStartupAndReload(phases, [...defaults, "codemode"]);
});

test("actual CLI: a plain allowlist replaces the defaults and keeps only named local tools", { timeout: 60_000 }, async () => {
	const { phases } = await runCli(["--tools", "read,grep,subagent"]);
	assertStartupAndReload(phases, ["read", "grep", "subagent"]);
});

test("actual CLI: a modifier mixed with a plain name, as a frontmatter modifier would produce, is rejected", { timeout: 60_000 }, async () => {
	const { status, stderr } = await runCli(["--tools", "+codemode,escalate_to_parent"], { expectSuccess: false });
	assert.notEqual(status, 0);
	assert.match(stderr, /cannot be mixed/);
});
