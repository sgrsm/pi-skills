import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  formatElapsedTime,
  formatResponseTimerText,
  registerResponseTimerExtension,
  RESPONSE_TIMER_STATUS_KEY,
  RESPONSE_TIMER_UPDATE_INTERVAL_MS,
  type ResponseTimerDependencies,
} from "./index.ts";

test("formatElapsedTime uses h/m/s units and hides leading zero values", () => {
  assert.equal(formatElapsedTime(-1), "0s");
  assert.equal(formatElapsedTime(0), "0s");
  assert.equal(formatElapsedTime(5_000), "5s");
  assert.equal(formatElapsedTime(23_000), "23s");
  assert.equal(formatElapsedTime(65_000), "1m 05s");
  assert.equal(formatElapsedTime(730_000), "12m 10s");
  assert.equal(formatElapsedTime(3_600_000), "1h 00m 00s");
  assert.equal(formatElapsedTime(3_902_000), "1h 05m 02s");
  assert.equal(formatElapsedTime(41_130_000), "11h 25m 30s");
  assert.equal(formatElapsedTime(100 * 3_600_000), "100h 00m 00s");
});

test("formatResponseTimerText uses requested running and stopped symbols without status separators", () => {
  const theme = {
    fg: (color: "accent" | "syntaxComment" | "dim", text: string) => `<${color}>${text}</${color}>`,
    bold: (text: string) => `<bold>${text}</bold>`,
  };

  assert.equal(formatResponseTimerText(5_000, true, theme), "<accent>⏱</accent><dim> 5s</dim>");
  assert.equal(
    formatResponseTimerText(65_000, false, theme),
    "<bold><syntaxComment>✓</syntaxComment></bold><dim> 1m 05s</dim>",
  );
});

test("response timer publishes live and final durations through the status API", async () => {
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
    on(eventName: string, handler: (event: unknown, ctx: any) => unknown | Promise<unknown>) {
      const existing = handlers.get(eventName) ?? [];
      existing.push(handler);
      handlers.set(eventName, existing);
    },
  } as Partial<ExtensionAPI> as ExtensionAPI;

  const statuses = new Map<string, string | undefined>();
  let footerSet = false;
  const ctx = {
    hasUI: true,
    ui: {
      theme: {
        fg(_color: "accent" | "syntaxComment" | "dim", text: string) {
          return text;
        },
        bold(text: string) {
          return text;
        },
      },
      setFooter() {
        footerSet = true;
      },
      setStatus(key: string, value: string | undefined) {
        statuses.set(key, value);
      },
    },
  };

  const emit = async (eventName: string) => {
    for (const handler of handlers.get(eventName) ?? []) await handler({}, ctx);
  };

  registerResponseTimerExtension(pi, deps);
  await emit("session_start");

  assert.equal(footerSet, false);
  assert.ok(statuses.get(RESPONSE_TIMER_STATUS_KEY)?.endsWith("✓ 0s"));

  await emit("before_agent_start");
  assert.deepEqual(intervalDelays, [RESPONSE_TIMER_UPDATE_INTERVAL_MS]);
  assert.ok(statuses.get(RESPONSE_TIMER_STATUS_KEY)?.endsWith("⏱ 0s"));

  now = 66_000;
  intervalCallback?.();
  assert.ok(statuses.get(RESPONSE_TIMER_STATUS_KEY)?.endsWith("⏱ 1m 05s"));

  await emit("agent_start");
  assert.deepEqual(intervalDelays, [RESPONSE_TIMER_UPDATE_INTERVAL_MS], "agent_start must not reset after before_agent_start");
  assert.ok(statuses.get(RESPONSE_TIMER_STATUS_KEY)?.endsWith("⏱ 1m 05s"));

  await emit("agent_settled");
  assert.deepEqual(clearCalls, [intervalHandle]);
  assert.ok(statuses.get(RESPONSE_TIMER_STATUS_KEY)?.endsWith("✓ 1m 05s"));

  now = 100_000;
  await emit("before_agent_start");
  assert.ok(statuses.get(RESPONSE_TIMER_STATUS_KEY)?.endsWith("⏱ 0s"));
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
    hasUI: true,
    ui: {
      theme: {
        fg(_color: "accent" | "syntaxComment" | "dim", text: string) {
          return text;
        },
        bold(text: string) {
          return text;
        },
      },
      setStatus() {},
    },
  };

  registerResponseTimerExtension(pi, deps);

  for (const handler of handlers.get("session_start") ?? []) await handler({}, ctx);
  for (const handler of handlers.get("before_agent_start") ?? []) await handler({}, ctx);
  for (const handler of handlers.get("session_shutdown") ?? []) await handler({}, ctx);

  assert.deepEqual(clearCalls, [intervalHandle]);
});
