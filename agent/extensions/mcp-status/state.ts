import type { McpExposure } from "@earendil-works/pi-coding-agent";

export type McpStatus = { name: string; enabled: boolean; exposure: McpExposure };
export type McpConfigScope = "global" | "project";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function normalizeExposure(value: unknown): McpExposure | undefined {
  switch (value) {
    case "codemode-deferred": return "codemode";
    case "codemode": case "deferred": case "direct": case "hidden": return value;
    default: return undefined;
  }
}

/** Cheap config checks only: Pi owns OAuth validation, credential resolution and connections. */
function hasValidTransport(value: Record<string, unknown>): boolean {
  const { type } = value;
  // Like Pi, a matching HTTP URL takes precedence over a command; invalid HTTP never falls back.
  if (typeof value.url === "string" && (type === undefined || type === "http" || type === "streamable-http")) {
    if (!URL.canParse(value.url)) return false;
    const url = new URL(value.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (value.headers !== undefined && !isStringRecord(value.headers)) return false;
    if (value.auth !== undefined) {
      if (!isRecord(value.auth) || typeof value.auth.provider !== "string" || !value.auth.provider) return false;
      if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return false;
    }
    return true;
  }
  if (typeof value.command === "string" && value.command.trim() && (type === undefined || type === "stdio")) {
    if (value.args !== undefined && !(Array.isArray(value.args) && value.args.every((arg) => typeof arg === "string"))) return false;
    if (value.env !== undefined && !isStringRecord(value.env)) return false;
    return value.cwd === undefined || typeof value.cwd === "string";
  }
  return false;
}

/** Project only display fields: never retain commands, environment values, or credentials. */
export function parseMcpStatuses(text: string, scope: McpConfigScope = "global"): McpStatus[] {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed) || (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers))) {
    throw new Error("Expected an MCP config object");
  }
  const statuses: McpStatus[] = [];
  for (const [name, value] of Object.entries(parsed.mcpServers ?? {})) {
    if (!/^[A-Za-z0-9_-]+$/.test(name) || !isRecord(value)) continue;
    if (value.enabled !== undefined && typeof value.enabled !== "boolean") continue;
    const exposure = value.exposure === undefined ? "codemode" : normalizeExposure(value.exposure);
    if (exposure === undefined) continue;
    if (value.toolExposure !== undefined && (!isRecord(value.toolExposure) ||
        Object.values(value.toolExposure).some((entry) => normalizeExposure(entry) === undefined))) continue;
    if (value.description !== undefined && typeof value.description !== "string") continue;
    if (value.timeout !== undefined && (typeof value.timeout !== "number" || !(value.timeout > 0))) continue;
    if (!hasValidTransport(value)) continue;
    // Match the host loader's source restriction, even for stdio entries carrying URL/auth fields.
    if (scope === "project" && "url" in value && value.auth) continue;
    statuses.push({ name, enabled: value.enabled !== false, exposure });
  }
  return statuses;
}
