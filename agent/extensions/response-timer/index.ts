import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { clearLegacyFooterStatus, FOOTER_STATUS_KEYS } from "../shared/footerStatus.ts";

export const RESPONSE_TIMER_UPDATE_INTERVAL_MS = 1_000;
export const RESPONSE_TIMER_STATUS_KEY = FOOTER_STATUS_KEYS.responseTimer;

type TimerHandle = unknown;

type ResponseTimerTheme = {
  fg(color: "accent" | "syntaxComment" | "dim", text: string): string;
  bold(text: string): string;
};

type ResponseTimerContext = {
  hasUI: boolean;
  ui: {
    theme: ResponseTimerTheme;
    setStatus(key: string, value: string | undefined): void;
  };
};

export type ResponseTimerDependencies = {
  now(): number;
  setInterval(callback: () => void, delayMs: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
};

const DEFAULT_TIMER_DEPENDENCIES: ResponseTimerDependencies = {
  now: () => Date.now(),
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatElapsedTime(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (hours > 0) return `${hours}h ${twoDigits(minutes)}m ${twoDigits(seconds)}s`;
  if (totalMinutes > 0) return `${totalMinutes}m ${twoDigits(seconds)}s`;
  return `${seconds}s`;
}

export function formatResponseTimerText(elapsedMs: number, running: boolean, theme: ResponseTimerTheme): string {
  const symbol = running ? theme.fg("accent", "⏱") : theme.bold(theme.fg("syntaxComment", "✓"));
  return `${symbol}${theme.fg("dim", ` ${formatElapsedTime(elapsedMs)}`)}`;
}

export function registerResponseTimerExtension(
  pi: ExtensionAPI,
  dependencies: ResponseTimerDependencies = DEFAULT_TIMER_DEPENDENCIES,
): void {
  let startedAt: number | undefined;
  let lastElapsedMs = 0;
  let intervalHandle: TimerHandle | undefined;
  let activeContext: ResponseTimerContext | undefined;

  function stopLiveUpdates(): void {
    if (intervalHandle === undefined) return;
    dependencies.clearInterval(intervalHandle);
    intervalHandle = undefined;
  }

  function elapsedMs(): number {
    if (startedAt === undefined) return lastElapsedMs;
    return Math.max(0, dependencies.now() - startedAt);
  }

  function isRunning(): boolean {
    return startedAt !== undefined;
  }

  function updateStatus(): void {
    if (!activeContext?.hasUI) return;
    activeContext.ui.setStatus(
      RESPONSE_TIMER_STATUS_KEY,
      formatResponseTimerText(elapsedMs(), isRunning(), activeContext.ui.theme),
    );
  }

  function startResponseTimer(ctx: ResponseTimerContext): void {
    activeContext = ctx;
    stopLiveUpdates();
    startedAt = dependencies.now();
    lastElapsedMs = 0;
    updateStatus();
    if (ctx.hasUI) intervalHandle = dependencies.setInterval(updateStatus, RESPONSE_TIMER_UPDATE_INTERVAL_MS);
  }

  function ensureResponseTimerStarted(ctx: ResponseTimerContext): void {
    activeContext = ctx;
    if (startedAt === undefined) startResponseTimer(ctx);
    else updateStatus();
  }

  function stopResponseTimer(ctx: ResponseTimerContext): void {
    activeContext = ctx;
    if (startedAt !== undefined) lastElapsedMs = elapsedMs();
    startedAt = undefined;
    stopLiveUpdates();
    updateStatus();
  }

  pi.on("session_start", async (_event, ctx) => {
    startedAt = undefined;
    lastElapsedMs = 0;
    stopLiveUpdates();
    activeContext = ctx;
    clearLegacyFooterStatus(ctx, "responseTimer");
    updateStatus();
  });

  // `before_agent_start` is the earliest per-response hook after input is accepted.
  // `agent_start` below is a fallback for programmatic turns that may skip it.
  pi.on("before_agent_start", async (_event, ctx) => {
    startResponseTimer(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    ensureResponseTimerStarted(ctx);
  });

  // Include automatic retries, compaction retries, and queued continuations.
  pi.on("agent_settled", async (_event, ctx) => {
    stopResponseTimer(ctx);
  });

  pi.on("session_shutdown", async () => {
    startedAt = undefined;
    stopLiveUpdates();
    if (activeContext?.hasUI) activeContext.ui.setStatus(RESPONSE_TIMER_STATUS_KEY, undefined);
    activeContext = undefined;
  });
}

export default function responseTimerExtension(pi: ExtensionAPI): void {
  registerResponseTimerExtension(pi);
}
