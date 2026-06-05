import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { Container, Text } from "@mariozechner/pi-tui";
import {
  loadHideToolOutputState,
  saveHideToolOutputState,
  type HideToolOutputState,
} from "../shared/hideToolOutputState.ts";
import {
  getShortPathsState,
  renderSmartToolCall,
  renderSmartVisibleToolCall,
} from "../short-paths/index.ts";
import { getToolCallRenderStrategy } from "./renderStrategy.ts";

type HideToolMode = "on" | "off";

function parseModeArg(args?: string): HideToolMode | undefined | "invalid" {
  const value = args?.trim().toLowerCase();
  if (!value) return undefined;
  if (value === "on" || value === "off") return value;
  return "invalid";
}

function notify(
  ctx: ExtensionCommandContext,
  message: string,
  type: "info" | "warning" | "error" = "info",
): void {
  if (ctx.hasUI) ctx.ui.notify(message, type);
  else console.log(message);
}

function refreshToolRows(ctx: ExtensionCommandContext): void {
  if (!ctx.hasUI) return;
  const expanded = ctx.ui.getToolsExpanded();
  ctx.ui.setToolsExpanded(!expanded);
  ctx.ui.setToolsExpanded(expanded);
}

export default function (pi: ExtensionAPI) {
  const state: HideToolOutputState = loadHideToolOutputState();
  const shortPathsState = getShortPathsState();
  const cwd = process.cwd();
  const tools = [
    createReadToolDefinition(cwd),
    createBashToolDefinition(cwd),
    createEditToolDefinition(cwd),
    createWriteToolDefinition(cwd),
    createGrepToolDefinition(cwd),
    createFindToolDefinition(cwd),
    createLsToolDefinition(cwd),
  ];

  for (const tool of tools) {
    pi.registerTool({
      ...tool,
      renderCall(args, theme, context) {
        const fallback = new Text(theme.fg("toolTitle", theme.bold(tool.label ?? tool.name)), 0, 0);
        const strategy = getToolCallRenderStrategy(tool.name, state.enabled, tool.renderShell);

        if (strategy === "smartHidden") {
          return renderSmartToolCall(
            tool.name,
            tool.renderShell,
            args,
            theme,
            context,
            shortPathsState.enabled,
          );
        }

        if (strategy === "smartVisible") {
          return renderSmartVisibleToolCall(
            tool.name,
            args,
            theme,
            context,
            tool.renderCall,
            tool.label ?? tool.name,
            shortPathsState.enabled,
          );
        }

        return tool.renderCall ? tool.renderCall(args, theme, context) : fallback;
      },
      renderResult(result, options, theme, context) {
        if (state.enabled) return new Container();
        return tool.renderResult
          ? tool.renderResult(result, options, theme, context)
          : new Container();
      },
    });
  }

  pi.registerCommand("hide-tool", {
    description: "Hide or show tool output in the conversation UI",
    getArgumentCompletions(prefix: string): AutocompleteItem[] | null {
      const normalizedPrefix = prefix.trim().toLowerCase();
      const items: AutocompleteItem[] = [
        { value: "on", label: "on", description: "Hide tool output" },
        { value: "off", label: "off", description: "Show tool output" },
      ];
      const filtered = items.filter((item) => item.value.startsWith(normalizedPrefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const mode = parseModeArg(args);
      if (mode === "invalid") {
        notify(ctx, `Usage: /hide-tool on|off (currently ${state.enabled ? "on" : "off"})`, "warning");
        return;
      }

      if (mode === undefined) {
        notify(ctx, `hide-tool is ${state.enabled ? "on" : "off"}`);
        return;
      }

      const nextEnabled = mode === "on";
      if (state.enabled === nextEnabled) {
        notify(ctx, `hide-tool is already ${mode}`);
        return;
      }

      state.enabled = nextEnabled;
      await saveHideToolOutputState(state);
      refreshToolRows(ctx);
      notify(ctx, `hide-tool ${mode}`);
    },
  });
}
