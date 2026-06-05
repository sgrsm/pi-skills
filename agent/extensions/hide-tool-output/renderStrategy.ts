export type RenderShell = "default" | "self" | undefined;
export type ToolCallRenderStrategy = "builtIn" | "smartHidden" | "smartVisible";

/**
 * Keep bash on the built-in renderer even when tool output is hidden.
 * The built-in bash call renderer shows the full command and wraps it,
 * while renderResult can still be suppressed separately.
 */
export function getToolCallRenderStrategy(
  toolName: string,
  hideToolOutputEnabled: boolean,
  renderShell: RenderShell,
): ToolCallRenderStrategy {
  if (toolName === "bash") return "builtIn";
  if (hideToolOutputEnabled) return "smartHidden";
  if (renderShell !== "self") return "smartVisible";
  return "builtIn";
}
