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
  for (const exposure of ["codemode", "deferred", "direct", "hidden"]) {
    assert.equal(parseMcpStatuses(config(true, exposure))[0]?.exposure, exposure);
  }
  for (const enabled of [true, false]) {
    assert.deepEqual(parseMcpStatuses(config(enabled, "codemode-deferred")), parseMcpStatuses(config(enabled, "codemode")));
  }
  assert.throws(() => parseMcpStatuses("{"));
  assert.throws(() => parseMcpStatuses('{"mcpServers":[]}'));
});

test("cheap rejection checks omit invalid entries without losing valid transport choices", () => {
  const invalid = [
    { type: "sse", url: "https://example.com/sse" },
    { type: "other", command: "server" },
    { type: "http", command: "server" },
    { type: "stdio", url: "https://example.com/mcp" },
    { url: "not a URL", command: "server" }, // HTTP takes precedence; no stdio fallback.
    { url: "file:///mcp" }, { url: "https://" },
    { command: "server", args: "--flag" }, { command: "server", args: [1] },
    { command: "server", env: { KEY: 1 } }, { command: "server", env: [] },
    { command: "server", cwd: 1 },
    { url: "https://example.com/mcp", headers: { Authorization: 1 } },
    { url: "https://example.com/mcp", headers: [] },
    { url: "https://example.com/mcp", auth: { provider: "" } },
    { url: "http://example.com/mcp", auth: { provider: "fixture" } },
    { command: "server", enabled: "true" }, { command: "server", exposure: null },
    { command: "server", description: 1 }, { command: "server", timeout: 0 },
    { command: "server", toolExposure: [] },
    { command: "server", toolExposure: { tool: "wrong" } },
  ];
  for (const value of invalid) {
    assert.deepEqual(parseMcpStatuses(JSON.stringify({ mcpServers: { bad: value, good: { command: "server" } } })),
      [{ name: "good", enabled: true, exposure: "codemode" }], JSON.stringify(value));
  }
  const valid = [
    { type: "stdio", command: "server", args: ["--flag"], env: { KEY: "${KEY}" }, cwd: "." },
    { type: "http", url: "http://example.com/mcp", headers: { Authorization: "${TOKEN}" } },
    { type: "streamable-http", url: "https://example.com/mcp" },
    { command: "server", url: "https://example.com/mcp", args: [1] }, // HTTP ignores stdio fields.
    { type: "stdio", command: "server", url: "not a URL" },
    { url: "http://localhost/mcp", auth: { provider: "fixture" } },
    { url: "http://[::1]/mcp", auth: { provider: "fixture" } },
    { command: "server", toolExposure: { "*": "codemode-deferred", exact: "deferred" } },
  ];
  for (const value of valid) {
    assert.deepEqual(parseMcpStatuses(JSON.stringify({ mcpServers: { good: value } })),
      [{ name: "good", enabled: true, exposure: "codemode" }], JSON.stringify(value));
  }
});

test("project provider-auth restriction is source-aware and projection retains no secret fields", () => {
  const text = JSON.stringify({ mcpServers: { docs: {
    url: "https://example.com/mcp", auth: { provider: "fixture" },
    headers: { Authorization: "!never-run-this" }, oauth: { clientSecret: "fixture-secret" },
  } } });
  assert.deepEqual(parseMcpStatuses(text, "global"), [{ name: "docs", enabled: true, exposure: "codemode" }]);
  assert.deepEqual(parseMcpStatuses(text, "project"), []);
  // The host restriction also covers a stdio entry carrying a URL and auth.
  assert.deepEqual(parseMcpStatuses(JSON.stringify({ mcpServers: { docs: {
    type: "stdio", command: "server", url: "ignored", auth: { provider: "fixture" },
  } } }), "project"), []);
});

test("project-only patches preserve omitted fields and reject invalid override settings", () => {
  const valid = [
    [{ enabled: true }, { name: "intellij", override: true, enabled: true }],
    [{ enabled: false }, { name: "intellij", override: true, enabled: false }],
    [{ exposure: "direct" }, { name: "intellij", override: true, exposure: "direct" }],
    [{ exposure: "codemode-deferred" }, { name: "intellij", override: true, exposure: "codemode" }],
    [{ toolExposure: { "*": "direct" } }, { name: "intellij", override: true }],
    [{}, { name: "intellij", override: true }],
  ];
  for (const [value, expected] of valid) {
    const text = JSON.stringify({ mcpServers: { intellij: value } });
    assert.deepEqual(parseMcpStatuses(text, "project"), [expected]);
    assert.deepEqual(parseMcpStatuses(text, "global"), [], "patches cannot define global servers");
  }
  const invalid = [
    { enabled: "true" }, { exposure: null }, { exposure: "wrong" },
    { toolExposure: [] }, { toolExposure: { "*": "wrong" } },
    { enabled: true, description: "not allowed in an override" },
    { enabled: true, timeout: 60 }, { enabled: true, env: {} },
    { enabled: true, auth: { provider: "fixture" } },
    { enabled: true, headers: { Authorization: "!never-run-this" } },
    { enabled: true, command: null }, { enabled: true, url: null },
    { enabled: true, type: "stdio" },
  ];
  for (const value of invalid) {
    assert.deepEqual(parseMcpStatuses(JSON.stringify({ mcpServers: { intellij: value } }), "project"), [], JSON.stringify(value));
  }
});

function harness(mode = "tui", agentDir = "/agent") {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  const statuses = new Map<string, string | undefined>();
  const files = new Map<string, string>([[`${agentDir}/mcp.json`, config(false)]]);
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
    agentDir: () => agentDir,
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

test("footer follows effective global/project settings, inheriting omitted override fields", async () => {
  const h = harness();
  h.setTrusted(true);
  const gray = "<dim>MCP: </dim><dim>idea</dim><dim> •</dim>";
  const green = (exposure: string) => `<success>MCP: </success><success>idea · ${exposure}</success><dim> •</dim>`;
  const project = (value: object) => h.files.set("/project/.pi/mcp.json", JSON.stringify({ mcpServers: { intellij: value } }));
  await h.emit("session_start");
  assert.equal(h.statuses.get(MCP_STATUS_KEY), gray, "no override uses the disabled global setting");
  project({ enabled: true });
  h.tick();
  assert.equal(h.statuses.get(MCP_STATUS_KEY), green("deferred"), "project enable takes precedence and inherits exposure");
  h.files.set("/agent/mcp.json", config(true, "direct"));
  project({ enabled: false });
  h.tick();
  assert.equal(h.statuses.get(MCP_STATUS_KEY), gray, "project disable takes precedence over global enable");
  project({ exposure: "hidden" });
  h.tick();
  assert.equal(h.statuses.get(MCP_STATUS_KEY), green("hidden"), "exposure-only override inherits global enabled");
  h.files.set("/agent/mcp.json", config(false, "direct"));
  h.tick();
  assert.equal(h.statuses.get(MCP_STATUS_KEY), gray, "exposure-only override must not enable a disabled global server");
  project({ enabled: true, exposure: "codemode-deferred" });
  h.tick();
  assert.equal(h.statuses.get(MCP_STATUS_KEY), green("codemode"));
  project({});
  h.tick();
  assert.equal(h.statuses.get(MCP_STATUS_KEY), gray, "empty override inherits both global settings");
  project({ command: "project-server" });
  h.tick();
  assert.equal(h.statuses.get(MCP_STATUS_KEY), green("codemode"), "full project definitions use defaults, not global inheritance");
  h.files.delete("/project/.pi/mcp.json");
  h.files.set("/agent/mcp.json", config(true, "direct"));
  h.tick();
  assert.equal(h.statuses.get(MCP_STATUS_KEY), green("direct"), "removing the override restores global settings");
  project({ enabled: true });
  h.files.delete("/agent/mcp.json");
  h.tick();
  assert.equal(h.statuses.get(MCP_STATUS_KEY), undefined, "an orphan override does not define a server");
});

test("cached project patches reapply to current global settings and are cleared on trust revocation", async () => {
  const h = harness();
  h.setTrusted(true);
  h.files.set("/project/.pi/mcp.json", JSON.stringify({ mcpServers: { intellij: { enabled: true } } }));
  await h.emit("session_start");
  assert.ok(h.statuses.get(MCP_STATUS_KEY)?.includes("idea · deferred"));
  h.files.set("/project/.pi/mcp.json", "{");
  h.files.set("/agent/mcp.json", config(false, "direct"));
  h.tick();
  assert.ok(h.statuses.get(MCP_STATUS_KEY)?.includes("idea · direct"), "cache patches, not the previously resolved status");
  h.readErrors.add("/project/.pi/mcp.json");
  h.tick();
  assert.ok(h.statuses.get(MCP_STATUS_KEY)?.includes("idea · direct"), "read failures retain the last valid patch");
  h.setTrusted(false);
  const reads = h.reads.length;
  h.tick();
  assert.equal(h.reads.length, reads + 1, "only global config is read after trust revocation");
  assert.equal(h.statuses.get(MCP_STATUS_KEY), "<dim>MCP: </dim><dim>idea</dim><dim> •</dim>");
  h.setTrusted(true);
  h.tick();
  assert.equal(h.statuses.get(MCP_STATUS_KEY), "<dim>MCP: </dim><dim>idea</dim><dim> •</dim>", "revoked patches must not be reused");
});

test("project patches require valid exact-name global entries and may inherit global provider auth", async () => {
  const h = harness();
  h.setTrusted(true);
  h.files.set("/agent/mcp.json", JSON.stringify({ mcpServers: {
    "foo-bar": { command: "server", enabled: false },
    intellij: { command: "idea", enabled: false },
    docs: { url: "https://example.com/mcp", auth: { provider: "fixture" }, enabled: false, exposure: "direct" },
  } }));
  h.files.set("/project/.pi/mcp.json", JSON.stringify({ mcpServers: {
    foo_bar: { enabled: true },
    orphan: { enabled: true },
    intellij: { enabled: true, env: { KEY: "fixture-secret" } },
    docs: { enabled: true },
  } }));
  await h.emit("session_start");
  assert.equal(h.statuses.get(MCP_STATUS_KEY),
    "<success>MCP: </success><success>docs · direct</success><dim>, </dim><dim>foo-bar</dim><dim>, </dim><dim>idea</dim><dim> •</dim>");
});

test("merge rejects later normalized-name collisions, but accepts exact project overrides", async () => {
  const h = harness();
  h.files.set("/agent/mcp.json", JSON.stringify({ mcpServers: {
    "foo-bar": { command: "global", exposure: "direct" },
    foo_bar: { command: "collision" },
  } }));
  h.files.set("/project/.pi/mcp.json", JSON.stringify({ mcpServers: {
    foo_bar: { command: "project-collision", enabled: false },
    "foo-bar": { command: "project", exposure: "deferred" },
    other: { command: "other" },
  } }));
  h.setTrusted(true);
  await h.emit("session_start");
  assert.equal(h.statuses.get(MCP_STATUS_KEY),
    "<success>MCP: </success><success>foo-bar · deferred</success><dim>, </dim><success>other · codemode</success><dim> •</dim>");
  // Re-evaluate cross-file collisions, including cached project entries, on each tick.
  h.files.set("/agent/mcp.json", "{}");
  h.files.set("/project/.pi/mcp.json", "{");
  h.tick();
  assert.equal(h.statuses.get(MCP_STATUS_KEY),
    "<success>MCP: </success><dim>foo_bar</dim><dim>, </dim><success>other · codemode</success><dim> •</dim>");
});

test("blank commands remain omitted, including conservative collision ownership", async () => {
  for (const command of ["", " "]) {
    assert.deepEqual(parseMcpStatuses(JSON.stringify({ mcpServers: { blank: { command } } })), []);
  }
  const h = harness();
  h.files.set("/agent/mcp.json", JSON.stringify({ mcpServers: {
    "a-b": { command: " " }, a_b: { command: "server" },
  } }));
  await h.emit("session_start");
  // Intentional conservative difference: Pi accepts the blank entry and reserves a-b instead.
  assert.equal(h.statuses.get(MCP_STATUS_KEY), "<success>MCP: </success><success>a_b · codemode</success><dim> •</dim>");
});

test("last-valid caches stay source-specific when global and project config paths coincide", async () => {
  const h = harness("tui", "/project/.pi");
  h.files.set("/project/.pi/mcp.json", JSON.stringify({ mcpServers: {
    docs: { url: "https://example.com/mcp", auth: { provider: "fixture" } },
  } }));
  h.setTrusted(true);
  await h.emit("session_start");
  const expected = "<success>MCP: </success><success>docs · codemode</success><dim> •</dim>";
  assert.equal(h.statuses.get(MCP_STATUS_KEY), expected);
  h.readErrors.add("/project/.pi/mcp.json");
  h.tick();
  assert.equal(h.statuses.get(MCP_STATUS_KEY), expected, "project parsing must not erase the global fallback");
  h.setTrusted(false);
  h.tick();
  assert.equal(h.statuses.get(MCP_STATUS_KEY), expected, "revoking project trust must not erase the global fallback");
});

test("invalid project overrides preserve global entries and trust revocation clears cached projection", async () => {
  const h = harness();
  h.setTrusted(true);
  h.files.set("/project/.pi/mcp.json", JSON.stringify({ mcpServers: {
    intellij: { url: "https://example.com/mcp", auth: { provider: "fixture" }, exposure: "direct" },
  } }));
  await h.emit("session_start");
  assert.equal(h.statuses.get(MCP_STATUS_KEY), "<dim>MCP: </dim><dim>idea</dim><dim> •</dim>");
  h.files.set("/project/.pi/mcp.json", config(true, "direct"));
  h.tick();
  assert.ok(h.statuses.get(MCP_STATUS_KEY)?.includes("idea · direct"));
  h.readErrors.add("/project/.pi/mcp.json");
  h.setTrusted(false);
  h.tick();
  const reads = h.reads.length;
  assert.equal(h.statuses.get(MCP_STATUS_KEY), "<dim>MCP: </dim><dim>idea</dim><dim> •</dim>");
  h.tick();
  assert.equal(h.reads.length, reads + 1, "only the global config is read");
  h.setTrusted(true);
  h.tick();
  assert.equal(h.statuses.get(MCP_STATUS_KEY), "<dim>MCP: </dim><dim>idea</dim><dim> •</dim>");
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
