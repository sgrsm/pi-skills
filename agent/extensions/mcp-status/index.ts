import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { FOOTER_STATUS_KEYS } from "../shared/footerStatus.ts";
import { parseMcpStatuses, type McpConfigScope, type McpStatus } from "./state.ts";

export const MCP_STATUS_KEY = FOOTER_STATUS_KEYS.mcp;
export const MCP_STATUS_UPDATE_INTERVAL_MS = 1_000;

type TimerHandle = unknown;
type StatusTheme = Pick<ExtensionContext["ui"]["theme"], "fg">;

export type McpStatusDependencies = {
  agentDir(): string;
  /** Missing files return undefined; other read failures throw. */
  readFile(path: string): string | undefined;
  setInterval(callback: () => void, delay: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
};

const DEFAULT_DEPENDENCIES: McpStatusDependencies = {
  agentDir: getAgentDir,
  readFile(path) {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  },
  setInterval: (callback, delay) => setInterval(callback, delay),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export function formatMcpStatus(statuses: readonly McpStatus[], theme: StatusTheme): string | undefined {
  if (statuses.length === 0) return undefined;
  const servers = statuses.map(({ name, enabled, exposure }) => {
    const label = name === "intellij" ? "idea" : name;
    return enabled
      ? theme.fg("success", `${label} · ${exposure}`)
      : theme.fg("dim", label);
  });
  const prefixColor = statuses.some(({ enabled }) => enabled) ? "success" : "dim";
  return theme.fg(prefixColor, "MCP: ") + servers.join(theme.fg("dim", ", "));
}

export function registerMcpStatusExtension(
  pi: ExtensionAPI,
  dependencies: McpStatusDependencies = DEFAULT_DEPENDENCIES,
): void {
  let context: ExtensionContext | undefined;
  let interval: TimerHandle | undefined;
  let lastStatus: string | undefined | null = null;
  const lastValidFiles = new Map<string, McpStatus[]>();

  function stop(): void {
    if (interval !== undefined) dependencies.clearInterval(interval);
    interval = undefined;
    if (context) context.ui.setStatus(MCP_STATUS_KEY, undefined);
    context = undefined;
    lastStatus = null;
    lastValidFiles.clear();
  }

  function readStatuses(path: string, scope: McpConfigScope): McpStatus[] {
    const cacheKey = `${scope}:${path}`;
    try {
      const text = dependencies.readFile(path);
      const statuses = text === undefined ? [] : parseMcpStatuses(text, scope);
      lastValidFiles.set(cacheKey, statuses);
      return statuses;
    } catch {
      // Config may briefly be incomplete while saved. Keep the last valid projection and retry.
      return lastValidFiles.get(cacheKey) ?? [];
    }
  }

  function refresh(): void {
    if (!context) return;
    const merged = new Map<string, McpStatus>();
    const namespaces = new Map<string, string>();
    function merge(statuses: McpStatus[]): void {
      for (const status of statuses) {
        const namespace = status.name.replace(/-/g, "_");
        const owner = namespaces.get(namespace);
        if (owner !== undefined && owner !== status.name) continue;
        namespaces.set(namespace, status.name);
        merged.set(status.name, status);
      }
    }
    // Reject later namespace collisions across both files, but allow exact-name project overrides.
    merge(readStatuses(join(dependencies.agentDir(), "mcp.json"), "global"));
    const projectPath = join(context.cwd, CONFIG_DIR_NAME, "mcp.json");
    if (context.isProjectTrusted()) {
      merge(readStatuses(projectPath, "project"));
    } else {
      lastValidFiles.delete(`project:${projectPath}`);
    }
    const statuses = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
    const formatted = formatMcpStatus(statuses, context.ui.theme);
    // Match the other local footer segments' separator before the timer.
    const status = formatted === undefined ? undefined : formatted + context.ui.theme.fg("dim", " •");
    if (status !== lastStatus) {
      context.ui.setStatus(MCP_STATUS_KEY, status);
      lastStatus = status;
    }
  }

  pi.on("session_start", (_event, ctx) => {
    stop();
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    context = ctx;
    refresh();
    interval = dependencies.setInterval(refresh, MCP_STATUS_UPDATE_INTERVAL_MS);
  });

  pi.on("session_shutdown", stop);
}

export default function mcpStatusExtension(pi: ExtensionAPI): void {
  registerMcpStatusExtension(pi);
}
