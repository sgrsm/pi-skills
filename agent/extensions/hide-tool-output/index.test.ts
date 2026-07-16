import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { withTestScratchFixture } from "../permissions/testScratch.ts";
import hideToolOutputExtension from "./index.ts";

test("wrapped built-in ls resolves a relative path against ctx.cwd", async () => {
  await withTestScratchFixture(async (fixture) => {
    const sessionCwd = join(fixture.root, "session");
    await fixture.mkdir(sessionCwd);
    await fixture.writeFile(join(sessionCwd, "session-only.txt"), "right cwd\n");

    const registeredTools = new Map<string, ToolDefinition<any, any, any>>();
    const pi = {
      registerTool(tool: ToolDefinition<any, any, any>) {
        registeredTools.set(tool.name, tool);
      },
      registerCommand() {},
    } as Partial<ExtensionAPI> as ExtensionAPI;

    hideToolOutputExtension(pi);

    assert.equal(registeredTools.has("bash"), false, "hide-tool-output must not compete for Bash ownership");
    const lsTool = registeredTools.get("ls");
    assert.ok(lsTool, "ls tool should be registered");

    const result = await lsTool.execute(
      "tool-call-1",
      { path: ".", limit: 10 },
      undefined,
      undefined,
      { cwd: sessionCwd } as any,
    );
    const output = result.content
      .map((item: any) => (item.type === "text" ? item.text : ""))
      .join("\n");

    assert.match(output, /session-only\.txt/);
  });
});
