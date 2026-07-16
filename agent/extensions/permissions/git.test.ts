import assert from "node:assert/strict";
import test from "node:test";
import {
	AgentBranchRegistry,
	GitPermissionStore,
	analyzeGitCommands,
	buildGitPermissionRequest,
	resolveBranchCreations,
	type GitRepositoryStateProvider,
} from "./git.ts";

const cwd = "/repo/project";

function makeStateProvider(options: {
	repoRoot?: string;
	currentBranch?: string;
	existingBranches?: string[];
}): GitRepositoryStateProvider {
	const repoRoot = options.repoRoot ?? "/repo/project";
	const existingBranches = new Set(options.existingBranches ?? []);
	return {
		async getRepoRoot() {
			return repoRoot;
		},
		async getCurrentBranch() {
			return options.currentBranch;
		},
		async branchExists(_repoRoot, branch) {
			return existingBranches.has(branch);
		},
	};
}

test("git analyzer protects merge, rebase, reset, amend, and force push but not normal commits", () => {
	assert.deepEqual(analyzeGitCommands("git commit -m ok", cwd).protectedActions, []);

	assert.equal(analyzeGitCommands("git merge feature", cwd).protectedActions[0]?.operation, "merge");
	assert.equal(analyzeGitCommands("git rebase main", cwd).protectedActions[0]?.operation, "rebase");
	assert.equal(analyzeGitCommands("git reset --hard HEAD~1", cwd).protectedActions[0]?.operation, "reset");
	assert.equal(analyzeGitCommands("git commit --amend --no-edit", cwd).protectedActions[0]?.operation, "amend");
	assert.equal(analyzeGitCommands("git push --force-with-lease", cwd).protectedActions[0]?.operation, "force-push");
});

test("git analyzer guards working-tree mutations except clean dry runs", () => {
	assert.equal(analyzeGitCommands("git clean -fd", cwd).protectedActions[0]?.operation, "clean");
	assert.equal(analyzeGitCommands("git restore", cwd).protectedActions[0]?.operation, "restore");
	assert.equal(analyzeGitCommands("git restore --staged src/file.ts", cwd).protectedActions[0]?.operation, "restore");
	assert.equal(analyzeGitCommands("git checkout -- src/file.ts README.md", cwd).protectedActions[0]?.operation, "checkout-paths");

	assert.deepEqual(analyzeGitCommands("git clean -n", cwd).protectedActions, []);
	assert.deepEqual(analyzeGitCommands("git clean --dry-run", cwd).protectedActions, []);
	assert.deepEqual(analyzeGitCommands("git checkout main", cwd).protectedActions, []);
	assert.deepEqual(analyzeGitCommands("git checkout --", cwd).protectedActions, []);
});

test("git analyzer tracks branch creation commands and target-branch mutations", () => {
	const checkout = analyzeGitCommands("git checkout -b pi/demo", cwd);
	assert.deepEqual(checkout.branchCreations.map((creation) => creation.branch), ["pi/demo"]);

	const branchDelete = analyzeGitCommands("git branch -D old-topic", cwd);
	assert.equal(branchDelete.protectedActions[0]?.operation, "branch-delete");
	assert.equal(branchDelete.protectedActions[0]?.targetBranch, "old-topic");

	const forcedSwitch = analyzeGitCommands("git switch -C old-topic", cwd);
	assert.equal(forcedSwitch.protectedActions[0]?.operation, "branch-force");
	assert.equal(forcedSwitch.protectedActions[0]?.targetBranch, "old-topic");
	assert.deepEqual(forcedSwitch.branchCreations.map((creation) => creation.branch), ["old-topic"]);
});

test("git analyzer honors git -C and simple cd before protected commands", () => {
	const viaGitC = analyzeGitCommands("git -C ../other reset --hard", cwd);
	assert.equal(viaGitC.protectedActions[0]?.cwd, "/repo/other");

	const viaCd = analyzeGitCommands("cd ../other && git merge main", cwd);
	assert.equal(viaCd.protectedActions[0]?.cwd, "/repo/other");
});

test("branch registry uses both configured prefixes and tracked agent-created branches", () => {
	const registry = new AgentBranchRegistry(["pi/", "agent/"]);
	assert.equal(registry.isAgentBranch("/repo/project", "pi/demo"), true);
	assert.equal(registry.isAgentBranch("/repo/project", "feature/user"), false);

	registry.add("/repo/project", "feature/generated", 123);
	assert.equal(registry.isAgentBranch("/repo/project", "feature/generated"), true);
	assert.deepEqual(registry.listTracked(), [{ repoRoot: "/repo/project", branch: "feature/generated", createdAt: 123 }]);
});

test("git permission requests skip agent branches and protect existing branches", async () => {
	const registry = new AgentBranchRegistry(["pi/"]);
	registry.add("/repo/project", "generated", 123);

	const agentBranchAnalysis = analyzeGitCommands("git reset --hard", cwd);
	const agentBranchRequest = await buildGitPermissionRequest(
		agentBranchAnalysis.protectedActions,
		"git reset --hard",
		makeStateProvider({ currentBranch: "generated", existingBranches: ["generated"] }),
		registry,
	);
	assert.equal(agentBranchRequest, undefined);

	const userBranchRequest = await buildGitPermissionRequest(
		agentBranchAnalysis.protectedActions,
		"git reset --hard",
		makeStateProvider({ currentBranch: "main", existingBranches: ["main"] }),
		registry,
	);
	assert.ok(userBranchRequest);
	assert.deepEqual(userBranchRequest.operations.map((operation) => ({ operation: operation.operation, branch: operation.branch })), [
		{ operation: "reset", branch: "main" },
	]);
});

test("working-tree guards preserve prefixed and tracked agent-branch exemptions", async () => {
	const registry = new AgentBranchRegistry(["pi/"]);
	registry.add("/repo/project", "generated", 123);
	const analysis = analyzeGitCommands("git clean -fd && git restore file.txt && git checkout -- other.txt", cwd);

	for (const currentBranch of ["pi/demo", "generated"]) {
		const request = await buildGitPermissionRequest(
			analysis.protectedActions,
			"git clean -fd && git restore file.txt && git checkout -- other.txt",
			makeStateProvider({ currentBranch, existingBranches: [currentBranch] }),
			registry,
		);
		assert.equal(request, undefined);
	}

	const request = await buildGitPermissionRequest(
		analysis.protectedActions,
		"git clean -fd && git restore file.txt && git checkout -- other.txt",
		makeStateProvider({ currentBranch: "main", existingBranches: ["main"] }),
		registry,
	);
	assert.deepEqual(request?.operations.map((operation) => operation.operation), ["clean", "restore", "checkout-paths"]);
});

test("tracked branch creations only record branches that did not already exist before execution", async () => {
	const analysis = analyzeGitCommands("git checkout -b generated && git switch -C existing", cwd);
	const records = await resolveBranchCreations(
		analysis.branchCreations,
		makeStateProvider({ currentBranch: "main", existingBranches: ["existing"] }),
	);

	assert.deepEqual(records.map((record) => ({ repoRoot: record.repoRoot, branch: record.branch })), [
		{ repoRoot: "/repo/project", branch: "generated" },
	]);
});

test("git permission grants are scoped to repo, branch, and operation", async () => {
	const registry = new AgentBranchRegistry([]);
	const store = new GitPermissionStore();
	const request = await buildGitPermissionRequest(
		analyzeGitCommands("git merge feature", cwd).protectedActions,
		"git merge feature",
		makeStateProvider({ currentBranch: "main", existingBranches: ["main"] }),
		registry,
	);
	assert.ok(request);

	assert.equal(store.hasGrant(request), false);
	store.addSessionGrant(request, 123);
	assert.equal(store.hasGrant(request), true);

	const rebaseRequest = await buildGitPermissionRequest(
		analyzeGitCommands("git rebase feature", cwd).protectedActions,
		"git rebase feature",
		makeStateProvider({ currentBranch: "main", existingBranches: ["main"] }),
		registry,
	);
	assert.ok(rebaseRequest);
	assert.equal(store.hasGrant(rebaseRequest), false);

	const otherBranchRequest = await buildGitPermissionRequest(
		analyzeGitCommands("git merge feature", cwd).protectedActions,
		"git merge feature",
		makeStateProvider({ currentBranch: "release", existingBranches: ["release"] }),
		registry,
	);
	assert.ok(otherBranchRequest);
	assert.equal(store.hasGrant(otherBranchRequest), false);
});
