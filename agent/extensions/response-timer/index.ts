import { FooterComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { FOOTER_STATUS_KEYS } from "../shared/footerStatus.ts";

export const RESPONSE_TIMER_UPDATE_INTERVAL_MS = 1_000;
export const RESPONSE_TIMER_LEGACY_STATUS_KEY = FOOTER_STATUS_KEYS.responseTimer;

type TimerHandle = unknown;

type ResponseTimerTheme = {
  fg(color: "accent" | "syntaxComment" | "dim", text: string): string;
  bold(text: string): string;
};

type ResponseTimerContext = {
  mode?: string;
  hasUI: boolean;
  model?: unknown;
  modelRegistry?: unknown;
  sessionManager?: unknown;
  getContextUsage?: () => unknown;
  ui: {
    setStatus?(key: string, value: string | undefined): void;
    setFooter?(
      factory:
        | ((
            tui: { requestRender(): void },
            theme: ResponseTimerTheme,
            footerData: unknown,
          ) => Component & { dispose?(): void })
        | undefined,
    ): void;
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

export function rightAlignOnLine(leftLine: string, rightText: string, width: number, ellipsis = "..."): string {
  if (width <= 0) return "";

  const rightWidth = visibleWidth(rightText);
  if (rightWidth >= width) return truncateToWidth(rightText, width, "");

  const maxLeftWidth = Math.max(0, width - rightWidth - 1);
  const left = maxLeftWidth > 0 ? truncateToWidth(leftLine, maxLeftWidth, ellipsis) : "";
  const padding = " ".repeat(Math.max(0, width - visibleWidth(left) - rightWidth));

  return truncateToWidth(`${left}${padding}${rightText}`, width, "");
}

export function registerResponseTimerExtension(
  pi: ExtensionAPI,
  dependencies: ResponseTimerDependencies = DEFAULT_TIMER_DEPENDENCIES,
): void {
  let startedAt: number | undefined;
  let lastElapsedMs = 0;
  let intervalHandle: TimerHandle | undefined;
  let activeTui: { requestRender(): void } | undefined;
  let footerEnabled = false;

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

  function requestRender(): void {
    activeTui?.requestRender();
  }

  function clearLegacyStatus(ctx: ResponseTimerContext): void {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus?.(RESPONSE_TIMER_LEGACY_STATUS_KEY, undefined);
  }

  function installFooter(ctx: ResponseTimerContext): void {
    clearLegacyStatus(ctx);
    footerEnabled = false;
    if (ctx.mode !== "tui" || !ctx.ui.setFooter) return;

    footerEnabled = true;
    ctx.ui.setFooter((tui, theme, footerData) => {
      activeTui = tui;

      const footerSessionAdapter = {
        get state() {
          return {
            model: ctx.model,
            thinkingLevel: typeof pi.getThinkingLevel === "function" ? pi.getThinkingLevel() : "off",
          };
        },
        sessionManager: ctx.sessionManager,
        modelRegistry: ctx.modelRegistry,
        getContextUsage: () => ctx.getContextUsage?.(),
      };
      const defaultFooter = new FooterComponent(footerSessionAdapter as any, footerData as any);
      // Extension custom footers cannot observe Pi's live auto-compaction setting;
      // suppress the built-in marker rather than risk showing stale "(auto)" state.
      defaultFooter.setAutoCompactEnabled(false);
      const unsubscribeFromBranchChanges =
        typeof (footerData as { onBranchChange?: (callback: () => void) => () => void }).onBranchChange === "function"
          ? (footerData as { onBranchChange(callback: () => void): () => void }).onBranchChange(() => tui.requestRender())
          : undefined;

      return {
        render(width: number): string[] {
          const lines = defaultFooter.render(width);
          const timerText = formatResponseTimerText(elapsedMs(), isRunning(), theme);

          if (lines.length === 0) return [rightAlignOnLine("", timerText, width, theme.fg("dim", "..."))];

          return [rightAlignOnLine(lines[0] ?? "", timerText, width, theme.fg("dim", "...")), ...lines.slice(1)];
        },
        invalidate(): void {
          defaultFooter.invalidate();
        },
        dispose(): void {
          unsubscribeFromBranchChanges?.();
          defaultFooter.dispose();
          if (activeTui === tui) activeTui = undefined;
        },
      };
    });
  }

  function startResponseTimer(): void {
    stopLiveUpdates();
    startedAt = dependencies.now();
    lastElapsedMs = 0;
    requestRender();
    if (footerEnabled) intervalHandle = dependencies.setInterval(requestRender, RESPONSE_TIMER_UPDATE_INTERVAL_MS);
  }

  function ensureResponseTimerStarted(): void {
    if (startedAt === undefined) startResponseTimer();
    else requestRender();
  }

  function stopResponseTimer(): void {
    if (startedAt !== undefined) lastElapsedMs = elapsedMs();
    startedAt = undefined;
    stopLiveUpdates();
    requestRender();
  }

  pi.on("session_start", async (_event, ctx) => {
    startedAt = undefined;
    lastElapsedMs = 0;
    stopLiveUpdates();
    activeTui = undefined;
    footerEnabled = false;
    installFooter(ctx);
  });

  // `before_agent_start` is the earliest per-response hook after input is accepted.
  // `agent_start` below is a fallback for programmatic turns that may skip it.
  pi.on("before_agent_start", async () => {
    startResponseTimer();
  });

  pi.on("agent_start", async () => {
    ensureResponseTimerStarted();
  });

  pi.on("agent_end", async () => {
    stopResponseTimer();
  });

  pi.on("session_shutdown", async () => {
    startedAt = undefined;
    stopLiveUpdates();
    activeTui = undefined;
    footerEnabled = false;
  });
}

export default function responseTimerExtension(pi: ExtensionAPI): void {
  registerResponseTimerExtension(pi);
}
