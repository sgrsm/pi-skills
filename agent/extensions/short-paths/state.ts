import { getAgentDir, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export type ShortPathsState = {
  enabled: boolean;
};

export const SHORT_PATHS_STATE_PATH = join(getAgentDir(), "short-paths.json");

function loadShortPathsState(defaultEnabled = true): ShortPathsState {
  try {
    const parsed = JSON.parse(readFileSync(SHORT_PATHS_STATE_PATH, "utf-8")) as Partial<ShortPathsState>;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : defaultEnabled,
    };
  } catch {
    return { enabled: defaultEnabled };
  }
}

const state = loadShortPathsState();

export function getShortPathsState(): ShortPathsState {
  return state;
}

export async function saveShortPathsState(nextState: ShortPathsState): Promise<void> {
  state.enabled = nextState.enabled;

  await withFileMutationQueue(SHORT_PATHS_STATE_PATH, async () => {
    await writeFile(SHORT_PATHS_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  });
}
