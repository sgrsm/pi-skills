import { CONFIG_DIR_NAME, getAgentDir, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export type SubagentPolicyMode = "off" | "manual" | "ask" | "auto";

export type SubagentPolicyState = {
	mode: SubagentPolicyMode;
};

export const SUBAGENT_POLICY_STATE_PATH = join(getAgentDir(), "subagent-policy.json");
export const SUBAGENT_POLICY_STATE_DISPLAY_PATH = `~/${CONFIG_DIR_NAME}/agent/subagent-policy.json`;

export const DEFAULT_SUBAGENT_POLICY_STATE: SubagentPolicyState = {
	mode: "ask",
};

export function normalizeSubagentPolicyMode(value: string | undefined): SubagentPolicyMode | undefined {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) return undefined;
	if (normalized === "off" || normalized === "manual" || normalized === "ask" || normalized === "auto") {
		return normalized;
	}
	return undefined;
}

export function loadSubagentPolicyState(
	defaults: SubagentPolicyState = DEFAULT_SUBAGENT_POLICY_STATE,
): SubagentPolicyState {
	try {
		const parsed = JSON.parse(readFileSync(SUBAGENT_POLICY_STATE_PATH, "utf-8")) as Partial<SubagentPolicyState>;
		return {
			mode: normalizeSubagentPolicyMode(parsed.mode) ?? defaults.mode,
		};
	} catch {
		return { ...defaults };
	}
}

export async function saveSubagentPolicyState(state: SubagentPolicyState): Promise<void> {
	await withFileMutationQueue(SUBAGENT_POLICY_STATE_PATH, async () => {
		await writeFile(SUBAGENT_POLICY_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
	});
}
