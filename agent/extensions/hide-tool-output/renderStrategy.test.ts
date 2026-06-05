import assert from "node:assert/strict";
import test from "node:test";
import { getToolCallRenderStrategy } from "./renderStrategy.ts";

test("bash keeps the built-in call renderer so long commands stay fully visible", () => {
  assert.equal(getToolCallRenderStrategy("bash", true, "default"), "builtIn");
  assert.equal(getToolCallRenderStrategy("bash", false, "default"), "builtIn");
  assert.equal(getToolCallRenderStrategy("bash", true, "self"), "builtIn");
});

test("non-bash tools still use compact hidden rendering when hide-tool-output is enabled", () => {
  assert.equal(getToolCallRenderStrategy("read", true, "default"), "smartHidden");
  assert.equal(getToolCallRenderStrategy("edit", true, "self"), "smartHidden");
});

test("non-bash default-shell tools use smart visible summaries when output is shown", () => {
  assert.equal(getToolCallRenderStrategy("read", false, "default"), "smartVisible");
  assert.equal(getToolCallRenderStrategy("grep", false, undefined), "smartVisible");
});

test("non-bash self-shell tools fall back to the built-in renderer when output is shown", () => {
  assert.equal(getToolCallRenderStrategy("edit", false, "self"), "builtIn");
});
