import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import gitInspectExtension, {
	buildGitExecutionEnvironment,
	buildGitInspectionInvocation,
	buildGitSpawnOptions,
	formatGitFailure,
	GIT_INSPECT_TOOL_NAME,
} from "./index.ts";

const execFile = promisify(execFileCallback);

function registerGitInspectTool(): ToolDefinition<any, any, any> {
	const tools = new Map<string, ToolDefinition<any, any, any>>();
	gitInspectExtension({
		registerTool(tool: ToolDefinition<any, any, any>) {
			tools.set(tool.name, tool);
		},
	} as Partial<ExtensionAPI> as ExtensionAPI);

	const tool = tools.get(GIT_INSPECT_TOOL_NAME);
	assert.ok(tool, "git_inspect should be registered");
	return tool;
}

test("git_inspect maps only fixed, hardened Git argv for supported inspection operations", () => {
	const workingDiff = buildGitInspectionInvocation(
		{ operation: "working_diff", paths: ["src/example.ts"] },
		"/workspace/repository",
	);
	assert.equal(workingDiff.command, "git");
	assert.equal(workingDiff.cwd, "/workspace/repository");
	assert.ok(workingDiff.args.includes("--literal-pathspecs"));
	assert.deepEqual(workingDiff.args.slice(-8), [
		"diff",
		"--no-color",
		"--no-ext-diff",
		"--no-textconv",
		"--no-renames",
		"--unified=3",
		"--",
		"src/example.ts",
	]);

	const rangeDiff = buildGitInspectionInvocation(
		{ operation: "range_diff", base: "main", head: "HEAD", paths: ["README.md"] },
		"/workspace/repository",
	);
	assert.deepEqual(rangeDiff.args.slice(-10), [
		"diff",
		"--no-color",
		"--no-ext-diff",
		"--no-textconv",
		"--no-renames",
		"--unified=3",
		"main",
		"HEAD",
		"--",
		"README.md",
	]);

	const log = buildGitInspectionInvocation(
		{ operation: "log", revision: "feature/review~2", maxCount: 12 },
		"/workspace/repository",
	);
	assert.deepEqual(log.args.slice(-7), [
		"log",
		"--no-color",
		"--no-decorate",
		"--date=iso-strict",
		"--format=%H%nParents: %P%nAuthor: %an <%ae>%nDate: %aI%nSubject: %s%n",
		"--max-count=12",
		"feature/review~2",
	]);
});

test("git_inspect rejects command injection, unsafe revisions, unsafe paths, and irrelevant parameters", () => {
	const cwd = "/workspace/repository";
	const rejectedInputs = [
		{ operation: "working_diff", paths: ["../outside.txt"] },
		{ operation: "working_diff", paths: ["/etc/passwd"] },
		{ operation: "working_diff", paths: [":(glob)**"] },
		{ operation: "working_diff", paths: ["-c"] },
		{ operation: "log", revision: "HEAD;touch-owned", maxCount: 1 },
		{ operation: "log", revision: "HEAD@{1}", maxCount: 1 },
		{ operation: "log", revision: "main..HEAD", maxCount: 1 },
		{ operation: "show_commit", revision: "--upload-pack=unexpected" },
		{ operation: "log", maxCount: 101 },
		{ operation: "file_history", paths: ["one.ts", "two.ts"] },
		{ operation: "status", paths: ["not-allowed.ts"] },
		{ operation: "not_a_real_operation" },
	] as Array<Record<string, unknown>>;

	for (const input of rejectedInputs) {
		assert.throws(
			() => buildGitInspectionInvocation(input, cwd),
			`Expected ${JSON.stringify(input)} to be rejected`,
		);
	}
});

test("git_inspect uses a narrow inherited environment and disables Git prompts, optional locks, pagers, and external diff behavior", () => {
	const environment = buildGitExecutionEnvironment({
		PATH: "/usr/bin:/bin",
		HOME: "/home/tester",
		USER: "tester",
		GIT_DIR: "/dangerous/alternate-git-dir",
		GIT_INDEX_FILE: "/dangerous/index",
		GIT_EXTERNAL_DIFF: "/dangerous/diff",
		CUSTOM_SECRET: "not-forwarded",
	});
	const options = buildGitSpawnOptions("/workspace/repository", environment);

	assert.equal(options.shell, false);
	assert.equal(options.cwd, "/workspace/repository");
	assert.equal(options.env.GIT_DIR, undefined);
	assert.equal(options.env.GIT_INDEX_FILE, undefined);
	assert.equal(options.env.GIT_EXTERNAL_DIFF, undefined);
	assert.equal(options.env.CUSTOM_SECRET, undefined);
	assert.equal(options.env.GIT_OPTIONAL_LOCKS, "0");
	assert.equal(options.env.GIT_TERMINAL_PROMPT, "0");
	assert.equal(options.env.GIT_PAGER, "cat");
	assert.equal(options.env.PAGER, "cat");
	assert.equal(options.env.GIT_CONFIG_NOSYSTEM, "1");
});

test("git_inspect bounds multiline failure diagnostics before exposing them to the model", () => {
	const diagnostic = Array.from({ length: DEFAULT_MAX_LINES + 100 }, (_, index) => `failure-${index} ${"x".repeat(64)}`).join("\n");
	const error = formatGitFailure("status", {
		exitCode: 128,
		signal: null,
		stdout: Buffer.alloc(0),
		stderr: Buffer.from(diagnostic),
		outputCapped: false,
		timedOut: false,
		aborted: false,
	});
	const lineCount = error.message === "" ? 0 : error.message.split("\n").length;

	assert.match(error.message, /git_inspect status failed/);
	assert.match(error.message, /Error output truncated/);
	assert.ok(Buffer.byteLength(error.message, "utf8") <= DEFAULT_MAX_BYTES);
	assert.ok(lineCount <= DEFAULT_MAX_LINES);
});

test("git_inspect executes status and a fixed working-tree diff without creating an index lock", async () => {
	const repository = await mkdtemp(join(tmpdir(), "pi-git-inspect-"));
	try {
		await execFile("git", ["init", "--quiet", repository]);
		await execFile("git", ["-C", repository, "config", "user.name", "Pi Test"]);
		await execFile("git", ["-C", repository, "config", "user.email", "pi-test@example.test"]);
		const filePath = join(repository, "example.txt");
		await writeFile(filePath, "before\n", "utf8");
		await execFile("git", ["-C", repository, "add", "example.txt"]);
		await execFile("git", ["-C", repository, "commit", "--quiet", "-m", "Initial commit"]);
		await writeFile(filePath, "after\n", "utf8");

		const tool = registerGitInspectTool();
		const statusResult = await tool.execute(
			"git-inspect-status-test",
			{ operation: "status" },
			undefined,
			undefined,
			{ cwd: repository } as any,
		);
		const statusOutput = (statusResult.content[0] as { type: "text"; text: string }).text;
		assert.match(statusOutput, /# branch\.oid/);
		await assert.rejects(readFile(join(repository, ".git", "index.lock"), "utf8"));

		const result = await tool.execute(
			"git-inspect-diff-test",
			{ operation: "working_diff", paths: ["example.txt"] },
			undefined,
			undefined,
			{ cwd: repository } as any,
		);
		const output = (result.content[0] as { type: "text"; text: string }).text;

		assert.match(output, /diff --git a\/example\.txt b\/example\.txt/);
		assert.match(output, /-before/);
		assert.match(output, /\+after/);
		await assert.rejects(readFile(join(repository, ".git", "index.lock"), "utf8"));
	} finally {
		await rm(repository, { recursive: true, force: true });
	}
});
