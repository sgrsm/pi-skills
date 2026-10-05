/**
 * Agent discovery and configuration
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
	diagnostics: string[];
}

export const USER_AGENTS_DISPLAY_PATH = `~/${CONFIG_DIR_NAME}/agent/agents`;
export const PROJECT_AGENTS_DISPLAY_PATH = `${CONFIG_DIR_NAME}/agents`;

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

type ToolListParseResult =
	| { valid: true; tools: string[] | undefined }
	| { valid: false; reason: string };

function parseToolList(value: unknown): ToolListParseResult {
	if (value === undefined || value === null) return { valid: true, tools: undefined };
	if (typeof value !== "string" && !Array.isArray(value)) {
		return { valid: false, reason: "tools must be a comma-separated string, an array of strings, or null" };
	}
	const raw: unknown[] = typeof value === "string" ? value.split(",") : value;
	const tools: string[] = [];
	for (const tool of raw) {
		if (typeof tool !== "string") return { valid: false, reason: "tools array members must all be strings" };
		const name = tool.trim();
		if (name) tools.push(name);
	}
	return { valid: true, tools: tools.length > 0 ? tools : undefined };
}

function loadAgentsFromDir(dir: string, source: "user" | "project", diagnostics: string[]): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		let parsed: { frontmatter: Record<string, unknown>; body: string };
		try {
			parsed = parseFrontmatter<Record<string, unknown>>(content);
		} catch (error) {
			const reason = error instanceof Error ? error.message.split("\n")[0].slice(0, 300) : "parse failed";
			diagnostics.push(`Skipped agent ${filePath}: invalid YAML frontmatter (${reason})`);
			continue;
		}
		const { frontmatter, body } = parsed;
		if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
			diagnostics.push(`Skipped agent ${filePath}: frontmatter must be a YAML mapping`);
			continue;
		}
		const { name, description } = frontmatter;
		if (!isNonEmptyString(name) || !isNonEmptyString(description)) {
			diagnostics.push(`Skipped agent ${filePath}: name and description must be non-empty strings`);
			continue;
		}

		const toolList = parseToolList(frontmatter.tools);
		if (!toolList.valid) {
			diagnostics.push(`Skipped agent ${filePath}: ${toolList.reason}`);
			continue;
		}

		agents.push({
			name,
			description,
			tools: toolList.tools,
			systemPrompt: body,
			source,
			filePath,
		});
	}

	return agents;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, CONFIG_DIR_NAME, "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const userDir = path.join(getAgentDir(), "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const diagnostics: string[] = [];
	const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user", diagnostics);
	const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project", diagnostics);

	const agentMap = new Map<string, AgentConfig>();

	if (scope === "both") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	} else if (scope === "user") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
	} else {
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	}

	return { agents: Array.from(agentMap.values()), projectAgentsDir, diagnostics };
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}
