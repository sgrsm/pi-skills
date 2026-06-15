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
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { Container, Text } from "@earendil-works/pi-tui";
import {
  loadHideToolOutputState,
  saveHideToolOutputState,
  type HideToolOutputState,
} from "./state.ts";
import {
  getShortPathsState,
  renderSmartToolCall,
  renderSmartVisibleToolCall,
} from "../short-paths/index.ts";
import { getToolCallRenderStrategy } from "./renderStrategy.ts";

type HideToolMode = "on" | "off";
type BuiltInToolFactory = (cwd: string) => any;

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
  const initialCwd = process.cwd();
  const toolFactories: BuiltInToolFactory[] = [
    createReadToolDefinition,
    createBashToolDefinition,
    createEditToolDefinition,
    createWriteToolDefinition,
    createGrepToolDefinition,
    createFindToolDefinition,
    createLsToolDefinition,
  ];
  const tools = toolFactories.map((createToolDefinition) => ({
    createToolDefinition,
    definition: createToolDefinition(initialCwd),
  }));

  for (const { createToolDefinition, definition: tool } of tools) {
    // Built-in tool definitions are heterogeneous generics; this wrapper preserves
    // each tool at runtime while using a dynamic type for shared render overrides.
    const wrappedTool = tool as any;
    pi.registerTool({
      ...wrappedTool,
      execute(toolCallId: any, params: any, signal: any, onUpdate: any, ctx: any) {
        const sessionCwd = typeof ctx?.cwd === "string" && ctx.cwd.length > 0 ? ctx.cwd : process.cwd();
        return createToolDefinition(sessionCwd).execute(toolCallId, params, signal, onUpdate, ctx);
      },
      renderCall(args: any, theme: any, context: any) {
        const fallback = new Text(theme.fg("toolTitle", theme.bold(wrappedTool.label ?? wrappedTool.name)), 0, 0);
        const strategy = getToolCallRenderStrategy(wrappedTool.name, state.enabled, wrappedTool.renderShell);

        if (strategy === "smartHidden") {
          return renderSmartToolCall(
            wrappedTool.name,
            wrappedTool.renderShell,
            args,
            theme,
            context,
            shortPathsState.enabled,
          );
        }

        if (strategy === "smartVisible") {
          return renderSmartVisibleToolCall(
            wrappedTool.name,
            args,
            theme,
            context,
            wrappedTool.renderCall,
            wrappedTool.label ?? wrappedTool.name,
            shortPathsState.enabled,
          );
        }

        return wrappedTool.renderCall ? wrappedTool.renderCall(args, theme, context) : fallback;
      },
      renderResult(result: any, options: any, theme: any, context: any) {
        if (state.enabled) return new Container();
        return wrappedTool.renderResult
          ? wrappedTool.renderResult(result, options, theme, context)
          : new Container();
      },
    } as any);
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
