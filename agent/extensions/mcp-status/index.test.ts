import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatMcpStatus, registerMcpStatusExtension, MCP_STATUS_KEY, type McpStatusDependencies } from "./index.ts";
import { parseMcpStatuses } from "./state.ts";

const theme = {
  fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
} as unknown as ExtensionContext["ui"]["theme"];

const config = (enabled: boolean, exposure = "deferred") => JSON.stringify({
  mcpServers: { intellij: { command: "idea", enabled, exposure } },
});

test("disabled IDEA is gray and hides exposure; the entire enabled segment is normal green", () => {
  assert.equal(formatMcpStatus(parseMcpStatuses(config(false)), theme), "<dim>MCP: </dim><dim>idea</dim>");
  assert.equal(formatMcpStatus(parseMcpStatuses(config(true)), theme),
    '<success>MCP: </success><success>idea · deferred</success>');
  assert.equal(formatMcpStatus([], theme), undefined);
});

test("projection defaults enabled/exposure, supports all exposures, and skips malformed entries", () => {
  assert.deepEqual(parseMcpStatuses(JSON.stringify({ mcpServers: {
    docs: { url: "https://example.com/mcp" },
    hidden: { command: "server", enabled: false, exposure: "hidden" },
    bad: null, invalidName: { command: "server", exposure: "wrong" },
    "bad.name": { command: "server" }, missingTransport: {},
  } })), [
    { name: "docs", enabled: true, exposure: "codemode" },
    { name: "hidden", enabled: false, exposure: "hidden" },
  ]);
  for (const exposure of ["codemode", "codemode-deferred", "deferred", "direct", "hidden"]) {
    assert.equal(parseMcpStatuses(config(true, exposure))[0]?.exposure, exposure);
  }
  assert.throws(() => parseMcpStatuses("{"));
  assert.throws(() => parseMcpStatuses('{"mcpServers":[]}'));
});

function harness(mode = "tui") {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  const statuses = new Map<string, string | undefined>();
  const files = new Map<string, string>([["/agent/mcp.json", config(false)]]);
  const reads: string[] = [];
  const readErrors = new Set<string>();
  const writes: Array<[string, string | undefined]> = [];
  const intervals: Array<{ callback: () => void; delay: number }> = [];
  const cleared: unknown[] = [];
  let trusted = false;
  let activeTheme = theme;
  const ctx = {
    mode, hasUI: mode === "tui" || mode === "rpc", cwd: "/project",
    isProjectTrusted: () => trusted,
    ui: { get theme() { return activeTheme; }, setStatus: (key: string, value: string | undefined) => {
      writes.push([key, value]);
      statuses.set(key, value);
    } },
  } as unknown as ExtensionContext;
  const pi = {
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => handlers.set(event, handler),
  } as unknown as ExtensionAPI;
  const dependencies: McpStatusDependencies = {
    agentDir: () => "/agent",
    readFile(path) {
      reads.push(path);
      if (readErrors.has(path)) throw new Error("Read failed");
      return files.get(path);
    },
    setInterval(callback, delay) { const handle = { callback, delay }; intervals.push(handle); return handle; },
    clearInterval(handle) { cleared.push(handle); },
  };
  registerMcpStatusExtension(pi, dependencies);
  return {
    files, reads, readErrors, writes, intervals, cleared, statuses,
    setTrusted(value: boolean) { trusted = value; },
    setTheme(value: ExtensionContext["ui"]["theme"]) { activeTheme = value; },
    async emit(event: string) { await handlers.get(event)?.({}, ctx); },
    tick() { intervals.at(-1)?.callback(); },
  };
}

test("polling tracks /mcp changes, trusted project overrides, and malformed writes without flicker", async () => {
  const h = harness();
  await h.emit("session_start");
  assert.equal(h.intervals[0]?.delay, 1000);
  assert.equal(h.statuses.get(MCP_STATUS_KEY), "<dim>MCP: </dim><dim>idea</dim><dim> •</dim>");
  h.files.set("/project/.pi/mcp.json", config(true, "direct"));
  h.tick();
  assert.ok(!h.reads.includes("/project/.pi/mcp.json"), "untrusted project config must not be read");
  h.files.set("/agent/mcp.json", config(true));
  h.tick();
  assert.equal(h.statuses.get(MCP_STATUS_KEY), '<success>MCP: </success><success>idea · deferred</success><dim> •</dim>');
  h.setTrusted(true);
  h.tick();
  assert.ok(h.statuses.get(MCP_STATUS_KEY)?.includes(" · direct"));
  h.files.set("/project/.pi/mcp.json", "{");
  h.tick();
  assert.ok(h.statuses.get(MCP_STATUS_KEY)?.includes(" · direct"), "retain last valid file projection");
  h.setTrusted(false);
  h.tick();
  assert.ok(h.statuses.get(MCP_STATUS_KEY)?.includes(" · deferred"));
  h.files.delete("/agent/mcp.json");
  h.tick();
  assert.equal(h.statuses.get(MCP_STATUS_KEY), undefined);
});

test("unchanged polling does not redraw; read errors preserve display; theme changes recolor it", async () => {
  const h = harness();
  await h.emit("session_start");
  const initialWrites = h.writes.length;
  h.tick();
  assert.equal(h.writes.length, initialWrites);
  h.readErrors.add("/agent/mcp.json");
  h.tick();
  assert.equal(h.writes.length, initialWrites);
  h.setTheme({ ...theme, fg: (_color: string, text: string) => `[new-theme]${text}` } as typeof theme);
  h.tick();
  assert.ok(h.statuses.get(MCP_STATUS_KEY)?.includes("[new-theme]idea"));
  h.readErrors.clear();
  h.files.set("/agent/mcp.json", config(true));
  h.tick();
  assert.ok(h.statuses.get(MCP_STATUS_KEY)?.includes(" · deferred"));
});

test("multiple servers use their names and display only enabled servers' exposures", () => {
  assert.equal(formatMcpStatus([
    { name: "docs", enabled: false, exposure: "direct" },
    { name: "idea", enabled: true, exposure: "codemode" },
  ], theme), '<success>MCP: </success><dim>docs</dim><dim>, </dim><success>idea · codemode</success>');
});

test("shutdown clears the interval/status, stale ticks are inert, and restart replaces polling", async () => {
  const h = harness();
  await h.emit("session_start");
  await h.emit("session_start");
  assert.deepEqual(h.cleared, [h.intervals[0]]);
  await h.emit("session_shutdown");
  assert.deepEqual(h.cleared, h.intervals);
  assert.equal(h.statuses.get(MCP_STATUS_KEY), undefined);
  h.tick();
  assert.equal(h.statuses.get(MCP_STATUS_KEY), undefined);
});

test("no footer polling or status writes in RPC, JSON, or print modes", async () => {
  for (const mode of ["rpc", "json", "print"]) {
    const h = harness(mode);
    await h.emit("session_start");
    assert.equal(h.intervals.length, 0);
    assert.equal(h.statuses.size, 0);
    assert.equal(h.reads.length, 0);
  }
});
