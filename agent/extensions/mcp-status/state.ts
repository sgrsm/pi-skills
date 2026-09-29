import type { McpExposure } from "@earendil-works/pi-coding-agent";

export type McpStatus = { name: string; enabled: boolean; exposure: McpExposure };

const EXPOSURES = new Set<string>(["codemode", "codemode-deferred", "deferred", "direct", "hidden"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Project only display fields: never retain commands, environment values, or credentials. */
export function parseMcpStatuses(text: string): McpStatus[] {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed) || (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers))) {
    throw new Error("Expected an MCP config object");
  }
  const statuses: McpStatus[] = [];
  for (const [name, value] of Object.entries(parsed.mcpServers ?? {})) {
    if (!/^[A-Za-z0-9_-]+$/.test(name) || !isRecord(value)) continue;
    if (!(typeof value.command === "string" && value.command.trim()) &&
        !(typeof value.url === "string" && value.url.trim())) continue;
    if (value.enabled !== undefined && typeof value.enabled !== "boolean") continue;
    const exposure = value.exposure ?? "codemode";
    if (typeof exposure !== "string" || !EXPOSURES.has(exposure)) continue;
    statuses.push({ name, enabled: value.enabled !== false, exposure: exposure as McpExposure });
  }
  return statuses;
}
