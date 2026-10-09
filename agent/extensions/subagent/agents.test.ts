import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { createTestScratchFixture, type TestScratchFixture } from "../permissions/testScratch.ts";
import { discoverAgents } from "./agents.ts";

async function withAgentDirs(fn: (paths: {
	fixture: TestScratchFixture;
	userDir: string;
	projectDir: string;
	cwd: string;
}) => Promise<void>): Promise<void> {
	const fixture = await createTestScratchFixture();
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const agentDir = path.join(fixture.root, "agent");
	const userDir = path.join(agentDir, "agents");
	const projectConfigDir = path.join(fixture.project, CONFIG_DIR_NAME);
	const projectDir = path.join(projectConfigDir, "agents");
	try {
		await fixture.mkdir(agentDir);
		await fixture.mkdir(userDir);
		await fixture.mkdir(projectConfigDir);
		await fixture.mkdir(projectDir);
		process.env.PI_CODING_AGENT_DIR = agentDir;
		await fn({ fixture, userDir, projectDir, cwd: fixture.project });
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		await fixture.cleanup();
	}
}

function agentFile(name: string, fields = "tools: read"): string {
	return `---\nname: ${name}\ndescription: Test agent\n${fields}\n---\nTest prompt.\n`;
}

const acceptedLists: Array<[string, string, string[] | undefined]> = [
	["csv", "tools: read, grep", ["read", "grep"]],
	["csv-spaces", 'tools: " read, , grep, "', ["read", "grep"]],
	["inline-array", "tools: [read, grep]", ["read", "grep"]],
	["block-array", "tools:\n  - read\n  - grep", ["read", "grep"]],
	["array-spaces", 'tools: [" read ", "", " ", " grep "]', ["read", "grep"]],
	["duplicates", "tools: [read, read]", ["read", "read"]],
	["omitted", "", undefined],
	["null", "tools: null", undefined],
	["blank-null", "tools:", undefined],
	["empty-string", 'tools: ""', undefined],
	["empty-csv", 'tools: " , , "', undefined],
	["empty-array", "tools: []", undefined],
	["blank-array", 'tools: ["", " "]', undefined],
];

for (const [label, fields, expected] of acceptedLists) {
	test(`discovery accepts ${label} tools without changing the prompt or identity`, async () => {
		await withAgentDirs(async ({ fixture, userDir, cwd }) => {
			const filePath = path.join(userDir, "scout.md");
			await fixture.writeFile(filePath, agentFile("scout", fields));
			const discovery = discoverAgents(cwd, "user");
			assert.deepEqual(discovery.agents, [{
				name: "scout", description: "Test agent", tools: expected,
				systemPrompt: "Test prompt.", source: "user", filePath,
			}]);
			assert.deepEqual(discovery.diagnostics, []);
		});
	});
}

test("invalid tools reject only their definitions and produce path-qualified diagnostics", async () => {
	await withAgentDirs(async ({ fixture, userDir, cwd }) => {
		const invalidValues = ["42", "true", "false", "{read: true}", "[read, 42]", "[read, false]",
			"[read, null]", "[read, {grep: true}]", "[read, [grep]]", "[42]", "[[read]]"];
		for (const [index, value] of invalidValues.entries()) {
			await fixture.writeFile(path.join(userDir, `bad-${index}.md`), agentFile(`bad-${index}`, `tools: ${value}`));
		}
		await fixture.writeFile(path.join(userDir, "valid.md"), agentFile("valid", "tools: [read, grep]"));
		const discovery = discoverAgents(cwd, "user");
		assert.deepEqual(discovery.agents.map((agent) => agent.name), ["valid"]);
		assert.equal(discovery.diagnostics.length, invalidValues.length);
		for (const index of invalidValues.keys()) {
			const filePath = path.join(userDir, `bad-${index}.md`);
			assert.ok(discovery.diagnostics.some((message) => message.includes(filePath) && message.includes("tools")));
		}
	});
});

// Frontmatter `tools` is a plain-name allowlist. The launcher appends plain `escalate_to_parent`, so a
// `+name`/`-name` modifier would become an invalid mixed `--tools` argument in the child.
const modifierLists: Array<[string, string, string]> = [
	["plus-csv", "tools: +codemode", "+codemode"],
	["minus-csv", "tools: -bash", "-bash"],
	["mixed-csv", "tools: read, +codemode", "+codemode"],
	["spaced-csv", 'tools: "read,  -write , grep"', "-write"],
	["plus-inline-array", "tools: [read, +codemode]", "+codemode"],
	["minus-inline-array", "tools: [-bash]", "-bash"],
	["spaced-array", 'tools: [read, " +codemode "]', "+codemode"],
	["block-array", "tools:\n  - read\n  - '-write'", "-write"],
];

for (const [label, fields, entry] of modifierLists) {
	test(`discovery rejects ${label} modifier tools with a path-qualified diagnostic naming the entry`, async () => {
		await withAgentDirs(async ({ fixture, userDir, cwd }) => {
			const filePath = path.join(userDir, "modifier.md");
			await fixture.writeFile(filePath, agentFile("modifier", fields));
			await fixture.writeFile(path.join(userDir, "valid.md"), agentFile("valid", "tools: [read, grep]"));
			const discovery = discoverAgents(cwd, "user");
			assert.deepEqual(discovery.agents.map((agent) => agent.name), ["valid"]);
			assert.equal(discovery.diagnostics.length, 1);
			const [message] = discovery.diagnostics;
			assert.ok(message.includes(filePath), message);
			assert.ok(message.includes(entry), message);
			assert.ok(message.includes("tools"), message);
		});
	});
}

test("a rejected project modifier agent leaves a valid user agent as the fallback", async () => {
	await withAgentDirs(async ({ fixture, userDir, projectDir, cwd }) => {
		const badPath = path.join(projectDir, "scout.md");
		await fixture.writeFile(path.join(userDir, "scout.md"), agentFile("scout", "tools: read"));
		await fixture.writeFile(badPath, agentFile("scout", "tools: +codemode"));
		const discovery = discoverAgents(cwd, "both");
		assert.deepEqual(discovery.agents.map((agent) => [agent.name, agent.source, agent.tools]), [["scout", "user", ["read"]]]);
		assert.ok(discovery.diagnostics.some((message) => message.includes(badPath) && message.includes("+codemode")));
	});
});

test("tool names containing but not starting with + or - remain valid allowlist entries", async () => {
	await withAgentDirs(async ({ fixture, userDir, cwd }) => {
		await fixture.writeFile(path.join(userDir, "scout.md"), agentFile("scout", "tools: [read, mcp__srv__a-b, c+d, git_inspect]"));
		const discovery = discoverAgents(cwd, "user");
		assert.deepEqual(discovery.diagnostics, []);
		assert.deepEqual(discovery.agents[0]?.tools, ["read", "mcp__srv__a-b", "c+d", "git_inspect"]);
	});
});

test("malformed YAML and invalid required fields do not stop neighboring discovery", async () => {
	await withAgentDirs(async ({ fixture, userDir, cwd }) => {
		const invalidFiles = [
			"name: broken\ndescription: Bad YAML\ntools: [read, grep",
			"name: 42\ndescription: Numeric name",
			"name: bad\ndescription: [not, text]",
			'name: " "\ndescription: Blank name',
			'name: bad\ndescription: " "',
			"description: Missing name",
			"name: missing-description",
			"[read, grep]",
			"42",
		];
		for (const [index, yaml] of invalidFiles.entries()) {
			await fixture.writeFile(path.join(userDir, `bad-${index}.md`), `---\n${yaml}\n---\nPrompt.`);
		}
		await fixture.writeFile(path.join(userDir, "valid.md"), agentFile("valid"));
		const discovery = discoverAgents(cwd, "user");
		assert.deepEqual(discovery.agents.map((agent) => agent.name), ["valid"]);
		assert.equal(discovery.diagnostics.length, invalidFiles.length);
		for (const index of invalidFiles.keys()) {
			assert.ok(discovery.diagnostics.some((message) => message.includes(path.join(userDir, `bad-${index}.md`))));
		}
		assert.ok(discovery.diagnostics.some((message) => /YAML/.test(message)));
	});
});

test("scope and valid project precedence are unchanged; rejected project files do not override user agents", async () => {
	await withAgentDirs(async ({ fixture, userDir, projectDir, cwd }) => {
		await fixture.writeFile(path.join(userDir, "scout.md"), agentFile("scout", "tools: read"));
		await fixture.writeFile(path.join(projectDir, "scout.md"), agentFile("scout", "tools: [read, grep]"));
		await fixture.writeFile(path.join(userDir, "worker.md"), agentFile("worker", "tools: write"));
		const badProjectPath = path.join(projectDir, "worker.md");
		await fixture.writeFile(badProjectPath, agentFile("worker", "tools: true"));

		const user = discoverAgents(cwd, "user");
		assert.ok(user.agents.every((agent) => agent.source === "user"));
		assert.deepEqual(user.diagnostics, []);
		const project = discoverAgents(cwd, "project");
		assert.deepEqual(project.agents.map((agent) => agent.name), ["scout"]);
		assert.ok(project.agents.every((agent) => agent.source === "project"));
		const both = discoverAgents(cwd, "both");
		assert.equal(both.agents.find((agent) => agent.name === "scout")?.source, "project");
		assert.deepEqual(both.agents.find((agent) => agent.name === "scout")?.tools, ["read", "grep"]);
		assert.equal(both.agents.find((agent) => agent.name === "worker")?.source, "user");
		assert.ok(both.diagnostics.some((message) => message.includes(badProjectPath)));
		assert.equal(both.projectAgentsDir, projectDir);
	});
});

test("model and thinking frontmatter stay ignored", async () => {
	await withAgentDirs(async ({ fixture, userDir, cwd }) => {
		await fixture.writeFile(path.join(userDir, "scout.md"), agentFile("scout",
			"tools: [read]\nmodel: provider/unwanted\nthinking: max"));
		const [agent] = discoverAgents(cwd, "user").agents;
		assert.ok(agent);
		assert.equal("model" in agent, false);
		assert.equal("thinking" in agent, false);
	});
});
