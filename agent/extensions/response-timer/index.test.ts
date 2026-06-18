import assert from "node:assert/strict";
import test from "node:test";
import { initTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  formatElapsedTime,
  formatResponseTimerText,
  registerResponseTimerExtension,
  RESPONSE_TIMER_LEGACY_STATUS_KEY,
  RESPONSE_TIMER_UPDATE_INTERVAL_MS,
  rightAlignOnLine,
  type ResponseTimerDependencies,
} from "./index.ts";

test("formatElapsedTime hides leading zero hour values while preserving timer readability", () => {
  assert.equal(formatElapsedTime(-1), "0:00");
  assert.equal(formatElapsedTime(0), "0:00");
  assert.equal(formatElapsedTime(5_000), "0:05");
  assert.equal(formatElapsedTime(65_000), "1:05");
  assert.equal(formatElapsedTime(3_600_000), "1:00:00");
  assert.equal(formatElapsedTime(3_661_000), "1:01:01");
  assert.equal(formatElapsedTime(100 * 3_600_000), "100:00:00");
});

test("formatResponseTimerText uses requested running and stopped symbols without status separators", () => {
  const theme = {
    fg: (color: "accent" | "syntaxComment" | "dim", text: string) => `<${color}>${text}</${color}>`,
    bold: (text: string) => `<bold>${text}</bold>`,
  };

  assert.equal(formatResponseTimerText(5_000, true, theme), "<accent>⏱</accent><dim> 0:05</dim>");
  assert.equal(
    formatResponseTimerText(65_000, false, theme),
    "<bold><syntaxComment>✓</syntaxComment></bold><dim> 1:05</dim>",
  );
});

test("rightAlignOnLine places the timer at the right edge and truncates the cwd side", () => {
  const rendered = rightAlignOnLine("/very/long/project/path", "⏱ 1:05", 24, "...");

  assert.equal(visibleWidth(rendered), 24);
  assert.ok(rendered.endsWith("⏱ 1:05"));
  assert.match(rendered, /^\/very\/long.*\s+⏱ 1:05$/);
});

test("response timer renders on the first footer line, updates live, and keeps final duration visible", async () => {
  let now = 1_000;
  let intervalCallback: (() => void) | undefined;
  const clearCalls: unknown[] = [];
  const intervalDelays: number[] = [];
  const intervalHandle = { id: 1 };

  const deps: ResponseTimerDependencies = {
    now: () => now,
    setInterval(callback, delayMs) {
      intervalCallback = callback;
      intervalDelays.push(delayMs);
      return intervalHandle;
    },
    clearInterval(handle) {
      clearCalls.push(handle);
    },
  };

  const handlers = new Map<string, Array<(event: unknown, ctx: any) => unknown | Promise<unknown>>>();
  const pi = {
    getThinkingLevel: () => "off",
    on(eventName: string, handler: (event: unknown, ctx: any) => unknown | Promise<unknown>) {
      const existing = handlers.get(eventName) ?? [];
      existing.push(handler);
      handlers.set(eventName, existing);
    },
  } as Partial<ExtensionAPI> as ExtensionAPI;

  const statuses = new Map<string, string | undefined>();
  let footerFactory: any;
  const ctx = {
    mode: "tui",
    hasUI: true,
    cwd: "/Users/example/project",
    model: { id: "test-model", provider: "test-provider", contextWindow: 100_000, reasoning: false },
    modelRegistry: { isUsingOAuth: () => false },
    getContextUsage: () => ({ tokens: 1_000, contextWindow: 100_000, percent: 1 }),
    sessionManager: {
      getEntries: () => [],
      getCwd: () => "/Users/example/project",
      getSessionName: () => undefined,
    },
    ui: {
      theme: {
        fg(_color: "accent" | "syntaxComment" | "dim", text: string) {
          return text;
        },
        bold(text: string) {
          return text;
        },
      },
      setFooter(factory: unknown) {
        footerFactory = factory;
      },
      setStatus(key: string, value: string | undefined) {
        statuses.set(key, value);
      },
    },
  };

  const emit = async (eventName: string) => {
    for (const handler of handlers.get(eventName) ?? []) await handler({}, ctx);
  };

  initTheme(undefined, false);
  registerResponseTimerExtension(pi, deps);
  await emit("session_start");

  assert.equal(statuses.get(RESPONSE_TIMER_LEGACY_STATUS_KEY), undefined);
  assert.equal(typeof footerFactory, "function");

  let renderRequests = 0;
  const footer = footerFactory(
    { requestRender: () => renderRequests++ },
    ctx.ui.theme,
    {
      getGitBranch: () => null,
      getAvailableProviderCount: () => 1,
      getExtensionStatuses: () => new Map(),
      onBranchChange: () => () => undefined,
    },
  );

  assert.ok(footer.render(60)[0].endsWith("✓ 0:00"));

  await emit("before_agent_start");
  assert.deepEqual(intervalDelays, [RESPONSE_TIMER_UPDATE_INTERVAL_MS]);
  assert.equal(renderRequests, 1);
  assert.ok(footer.render(60)[0].endsWith("⏱ 0:00"));

  now = 66_000;
  intervalCallback?.();
  assert.equal(renderRequests, 2);
  assert.ok(footer.render(60)[0].endsWith("⏱ 1:05"));

  await emit("agent_start");
  assert.deepEqual(intervalDelays, [RESPONSE_TIMER_UPDATE_INTERVAL_MS], "agent_start must not reset after before_agent_start");
  assert.ok(footer.render(60)[0].endsWith("⏱ 1:05"));

  await emit("agent_end");
  assert.deepEqual(clearCalls, [intervalHandle]);
  assert.ok(footer.render(60)[0].endsWith("✓ 1:05"));

  now = 100_000;
  await emit("before_agent_start");
  assert.ok(footer.render(60)[0].endsWith("⏱ 0:00"));
});

test("response timer does not install a custom footer outside TUI mode", async () => {
  let footerSet = false;
  const handlers = new Map<string, Array<(event: unknown, ctx: any) => unknown | Promise<unknown>>>();
  const pi = {
    on(eventName: string, handler: (event: unknown, ctx: any) => unknown | Promise<unknown>) {
      const existing = handlers.get(eventName) ?? [];
      existing.push(handler);
      handlers.set(eventName, existing);
    },
  } as Partial<ExtensionAPI> as ExtensionAPI;
  const ctx = {
    mode: "rpc",
    hasUI: true,
    ui: {
      setFooter() {
        footerSet = true;
      },
      setStatus() {},
    },
  };

  registerResponseTimerExtension(pi, {
    now: () => 0,
    setInterval: () => ({}),
    clearInterval: () => undefined,
  });

  for (const handler of handlers.get("session_start") ?? []) await handler({}, ctx);

  assert.equal(footerSet, false);
});

test("response timer clears a running interval on session shutdown", async () => {
  const intervalHandle = { id: "shutdown" };
  const clearCalls: unknown[] = [];
  const deps: ResponseTimerDependencies = {
    now: () => 0,
    setInterval() {
      return intervalHandle;
    },
    clearInterval(handle) {
      clearCalls.push(handle);
    },
  };

  const handlers = new Map<string, Array<(event: unknown, ctx: any) => unknown | Promise<unknown>>>();
  const pi = {
    on(eventName: string, handler: (event: unknown, ctx: any) => unknown | Promise<unknown>) {
      const existing = handlers.get(eventName) ?? [];
      existing.push(handler);
      handlers.set(eventName, existing);
    },
  } as Partial<ExtensionAPI> as ExtensionAPI;
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      setFooter() {},
      setStatus() {},
    },
  };

  registerResponseTimerExtension(pi, deps);

  for (const handler of handlers.get("session_start") ?? []) await handler({}, ctx);
  for (const handler of handlers.get("before_agent_start") ?? []) await handler({}, ctx);
  for (const handler of handlers.get("session_shutdown") ?? []) await handler({}, ctx);

  assert.deepEqual(clearCalls, [intervalHandle]);
});
