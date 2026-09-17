import type { SubagentPolicyMode } from "./policyState.ts";

export interface SubagentStatusApprovalState {
	askModeApproved: boolean;
	writeCapableApproved: boolean;
}

/** Formats the compact policy label used by the footer and status surfaces. */
export function formatSubagentStatusLabel(
	mode: SubagentPolicyMode,
	approval: SubagentStatusApprovalState,
): string {
	if (mode === "auto") return "auto";
	if (mode !== "ask") return mode;
	if (approval.writeCapableApproved) return "ask (approved write)";
	return approval.askModeApproved ? "ask (approved)" : "ask";
}
