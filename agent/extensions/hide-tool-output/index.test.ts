import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import hideToolOutputExtension from "./index.ts";

test("wrapped built-in tools execute relative to ctx.cwd instead of extension load cwd", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hide-tool-output-cwd-"));
  const extensionLoadCwd = join(tempRoot, "extension-load");
  const sessionCwd = join(tempRoot, "session");

  await mkdir(extensionLoadCwd);
  await mkdir(sessionCwd);
  await writeFile(join(extensionLoadCwd, "process-only.txt"), "wrong cwd\n", "utf-8");
  await writeFile(join(sessionCwd, "session-only.txt"), "right cwd\n", "utf-8");

  const registeredTools = new Map<string, ToolDefinition<any, any, any>>();
  const pi = {
    registerTool(tool: ToolDefinition<any, any, any>) {
      registeredTools.set(tool.name, tool);
    },
    registerCommand() {},
  } as Partial<ExtensionAPI> as ExtensionAPI;

  const originalCwd = process.cwd();
  try {
    process.chdir(extensionLoadCwd);
    hideToolOutputExtension(pi);
  } finally {
    process.chdir(originalCwd);
  }

  try {
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
    assert.doesNotMatch(output, /process-only\.txt/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
