import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { getShortPathsState, saveShortPathsState } from "../shared/shortPathsState.ts";

type ShortPathsMode = "on" | "off";

function parseModeArg(args?: string): ShortPathsMode | undefined | "invalid" {
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
  const state = getShortPathsState();

  pi.registerCommand("short-paths", {
    description: "Enable or disable smart path shortening in tool call display",
    getArgumentCompletions(prefix: string): AutocompleteItem[] | null {
      const normalizedPrefix = prefix.trim().toLowerCase();
      const items: AutocompleteItem[] = [
        { value: "on", label: "on", description: "Enable smart path shortening" },
        { value: "off", label: "off", description: "Disable smart path shortening" },
      ];
      const filtered = items.filter((item) => item.value.startsWith(normalizedPrefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const mode = parseModeArg(args);
      if (mode === "invalid") {
        notify(ctx, `Usage: /short-paths on|off (currently ${state.enabled ? "on" : "off"})`, "warning");
        return;
      }

      if (mode === undefined) {
        notify(ctx, `short-paths is ${state.enabled ? "on" : "off"}`);
        return;
      }

      const nextEnabled = mode === "on";
      if (state.enabled === nextEnabled) {
        notify(ctx, `short-paths is already ${mode}`);
        return;
      }

      state.enabled = nextEnabled;
      await saveShortPathsState(state);
      refreshToolRows(ctx);
      notify(ctx, `short-paths ${mode}`);
    },
  });
}

export { getShortPathsState, saveShortPathsState } from "../shared/shortPathsState.ts";
export {
  renderSmartToolCall,
  renderSmartVisibleToolCall,
  smartShortenPath,
} from "./toolCallSummary.ts";
