import { getAgentDir, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export type HideToolOutputState = {
  enabled: boolean;
};

export const HIDE_TOOL_OUTPUT_STATE_PATH = join(getAgentDir(), "hide-tool-output.json");

export function loadHideToolOutputState(defaultEnabled = true): HideToolOutputState {
  try {
    const parsed = JSON.parse(readFileSync(HIDE_TOOL_OUTPUT_STATE_PATH, "utf-8")) as Partial<HideToolOutputState>;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : defaultEnabled,
    };
  } catch {
    return { enabled: defaultEnabled };
  }
}

export function isHideToolOutputEnabled(defaultEnabled = true): boolean {
  return loadHideToolOutputState(defaultEnabled).enabled;
}

export async function saveHideToolOutputState(state: HideToolOutputState): Promise<void> {
  await withFileMutationQueue(HIDE_TOOL_OUTPUT_STATE_PATH, async () => {
    await writeFile(HIDE_TOOL_OUTPUT_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  });
}
