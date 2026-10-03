import assert from "node:assert/strict";
import { realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createAgentSession, createEventBus, discoverAndLoadExtensions, ModelRuntime,
  SessionManager, SettingsManager,
  type AgentSession, type CreateAgentSessionOptions, type LoadExtensionsResult,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { withTestScratchFixture, type TestScratchFixture } from "../permissions/testScratch.ts";

const wrapperPath = fileURLToPath(new URL("../hide-tool-output/index.ts", import.meta.url));
const wrappedNames = ["read", "edit", "write", "grep", "find", "ls"];
type Selection = Pick<CreateAgentSessionOptions, "tools" | "excludeTools" | "noTools">;
type Settings = ReturnType<SettingsManager["getSettings"]>;

// Native and wrapped sessions use the same public loader/SDK contracts, isolated
// settings and offline runtime. Never prompt, connect MCP or read personal config.
async function withSessions(run: (h: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  await withTestScratchFixture(async (fixture) => {
    assert.equal(await realpath(tmpdir()), await realpath(fixture.approvedRoot));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    const agentDir = join(fixture.root, "agent");
    await fixture.mkdir(agentDir);
    process.env.PI_CODING_AGENT_DIR = agentDir;
    let h: Awaited<ReturnType<typeof setup>> | undefined;
    try {
      h = await setup(fixture, agentDir);
      await run(h);
    } finally {
      try { await h?.close(); }
      finally {
        if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
    }
  });
}

async function setup(fixture: TestScratchFixture, agentDir: string) {
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"), modelsPath: null,
    modelsStorePath: join(agentDir, "models-store.json"),
    allowModelNetwork: false, refreshOnCreate: false,
  });
  const codemodePath = join(fixture.root, "codemode.ts");
  await fixture.writeFile(codemodePath, `export default (pi) => pi.registerTool({
    name: "codemode", label: "Codemode", description: "Selection-only placeholder",
    defaultActive: false, parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [], details: undefined }),
  });`);
  const sessions = new Set<AgentSession>();
  async function create(wrapped: boolean, settings: Settings = {}, selection: Selection = {}, projectSettings?: Settings) {
    const events = createEventBus();
    let loaded: LoadExtensionsResult;
    let currentSettings = JSON.stringify(settings);
    const project = projectSettings === undefined ? undefined : JSON.stringify(projectSettings);
    const settingsManager = SettingsManager.fromStorage({
      withLock(scope, fn) {
        const next = fn(scope === "global" ? currentSettings : project);
        if (scope === "global" && next !== undefined) currentSettings = next;
      },
    }, { projectTrusted: projectSettings !== undefined });
    const resourceLoader: ResourceLoader = {
      getExtensions: () => loaded,
      getSkills: () => ({ skills: [], diagnostics: [] }),
      getPrompts: () => ({ prompts: [], diagnostics: [] }),
      getThemes: () => ({ themes: [], diagnostics: [] }),
      getAgentsFiles: () => ({ agentsFiles: [] }),
      getSystemPrompt: () => undefined, getSystemPromptSource: () => undefined,
      getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
      extendResources() {},
      async reload() {
        loaded = await discoverAndLoadExtensions(wrapped ? [wrapperPath, codemodePath] : [codemodePath],
          fixture.project, agentDir, events);
        assert.deepEqual(loaded.errors, []);
      },
    };
    await resourceLoader.reload();
    const { session } = await createAgentSession({ ...selection, cwd: fixture.project, agentDir,
      settingsManager, sessionManager: SessionManager.inMemory(fixture.project), resourceLoader, modelRuntime });
    sessions.add(session);
    session.agent.streamFunction = () => { throw new Error("Model requests are forbidden in wrapper fixtures"); };
    const errors: unknown[] = [];
    await session.bindExtensions({ mode: "print", onError: (error) => errors.push(error) });
    assert.deepEqual(errors, []);
    return { session, settingsManager,
      replaceSettings(settings: Settings) { currentSettings = JSON.stringify(settings); },
      async reload() { await session.reload(); assert.deepEqual(errors, []); },
    };
  }
  return { fixture, agentDir, create,
    async close() {
      for (const session of sessions) {
        try { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); }
        finally { session.dispose(); }
      }
    },
  };
}

function assertSelection(native: AgentSession, wrapped: AgentSession, expected: string[]) {
  assert.deepEqual(native.getActiveToolNames().sort(), [...expected].sort(), "native control");
  assert.deepEqual(wrapped.getActiveToolNames().sort(), native.getActiveToolNames().sort(), "wrapped activation parity");
  assert.deepEqual(wrapped.getCallableToolNames().sort(), native.getCallableToolNames().sort(), "callable parity");
}

test("wrapped built-ins match native startup, reload and restrictive SDK/CLI selection", async (t) => {
  await withSessions(async (h) => {
    const cases: Array<{ name: string; settings?: Settings; selection?: Selection; expected: string[] }> = [
      { name: "ordinary defaults", expected: ["read", "bash", "edit", "write"] },
      { name: "+codemode", settings: { defaultTools: ["+codemode"] }, expected: ["read", "bash", "edit", "write", "codemode"] },
      { name: "additive/subtractive", settings: { defaultTools: ["+grep", "-bash", "-edit"] }, expected: ["read", "write", "grep"] },
      { name: "remove wrapped defaults", settings: { defaultTools: ["-read", "-edit", "-write"] }, expected: ["bash"] },
      { name: "empty defaults", settings: { defaultTools: [] }, expected: [] },
      { name: "explicit grep default", settings: { defaultTools: ["grep"] }, expected: ["grep"] },
      { name: "plain names with modifiers", settings: { defaultTools: ["ls", "+find", "-ls"] }, expected: ["find"] },
      { name: "CLI names override defaults", settings: { defaultTools: ["grep"] }, selection: { tools: ["read", "write"] }, expected: ["read", "write"] },
      { name: "restrictive child allowlist", settings: { defaultTools: ["+edit", "+write"] }, selection: { tools: ["read", "grep", "find", "ls"] }, expected: ["read", "grep", "find", "ls"] },
      { name: "empty allowlist", selection: { tools: [] }, expected: [] },
      { name: "exclusions win", selection: { tools: ["read", "grep", "edit"], excludeTools: ["read", "edit"] }, expected: ["grep"] },
      { name: "default exclusions", selection: { excludeTools: ["read", "write"] }, expected: ["bash", "edit"] },
      { name: "no tools", selection: { noTools: "all" }, expected: [] },
      { name: "no builtins", selection: { noTools: "builtin" }, expected: [] },
    ];
    for (const c of cases) await t.test(c.name, async () => {
      const native = await h.create(false, c.settings, c.selection);
      const wrapped = await h.create(true, c.settings, c.selection);
      assertSelection(native.session, wrapped.session, c.expected);
      await native.reload();
      await wrapped.reload();
      assertSelection(native.session, wrapped.session, c.expected);
      // Registration and explicit later activation must not escape host filters.
      if (c.selection?.tools || c.selection?.excludeTools || c.selection?.noTools === "all") {
        native.session.setActiveToolsByName(wrappedNames);
        wrapped.session.setActiveToolsByName(wrappedNames);
        assert.deepEqual(wrapped.session.getActiveToolNames().sort(), native.session.getActiveToolNames().sort());
        assert.deepEqual(wrapped.session.getCallableToolNames().sort(), native.session.getCallableToolNames().sort());
      }
    });
  });
});

test("wrapped reload preserves user choices and only adds newly configured defaults", async () => {
  await withSessions(async (h) => {
    const native = await h.create(false);
    const wrapped = await h.create(true);
    for (const s of [native, wrapped]) s.session.setActiveToolsByName(["bash", "edit", "ls"]);
    const steps = [
      { defaults: ["read", "grep"], expected: ["bash", "edit", "ls", "grep"] },
      { defaults: [], expected: ["bash", "edit", "ls", "grep"] },
      { defaults: ["+find"], expected: ["bash", "edit", "ls", "grep", "read", "write", "find"] },
    ];
    for (const { defaults, expected } of steps) {
      for (const s of [native, wrapped]) s.replaceSettings({ defaultTools: defaults });
      await native.reload();
      await wrapped.reload();
      assertSelection(native.session, wrapped.session, expected);
    }
  });
});

test("wrappers preserve every native declaration field except activation, execution and rendering", async () => {
  await withSessions(async (h) => {
    const native = await h.create(false);
    const wrapped = await h.create(true);
    for (const name of wrappedNames) {
      const n = native.session.getToolDefinition(name)!;
      const w = wrapped.session.getToolDefinition(name)!;
      const metadata = (tool: typeof n) => Object.fromEntries(Object.entries(tool)
        .filter(([key]) => !["defaultActive", "execute", "renderCall", "renderResult"].includes(key)));
      assert.deepEqual(metadata(w), metadata(n), name);
      assert.equal(w.defaultActive, false, `${name} must only activate by host selection`);
    }
  });
});

// Fixed 2100x8 RGB PNG: valid, tiny, and wider than Pi's default resize limit.
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAACDQAAAAICAIAAACDYaovAAAASElEQVR4nO3BMQEAAADCoPVPbQo/oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIC3AcToAAGzr888AAAAAElFTkSuQmCC",
  "base64",
);

// Direct definitions avoid post-result normalization masking read-time drift.
function read(session: AgentSession, path: string, params: { offset?: number; limit?: number } = {}, signal?: AbortSignal, model?: unknown) {
  return session.getToolDefinition("read")!.execute("read-probe", { path, ...params }, signal, undefined,
    { cwd: session.sessionManager.getCwd(), model } as any);
}

test("wrapped read preserves results across image settings, hiding and project overrides", async (t) => {
  await withSessions(async (h) => {
    await writeFile(await h.fixture.assertMutationTarget(join(h.fixture.project, "wide.png")), image, { mode: 0o600 });
    await h.fixture.writeFile(join(h.fixture.project, "session-only.txt"), "right cwd\n");
    const cases: Array<{ hidden: boolean; resize?: boolean; project?: boolean }> = [
      ...[false, true].flatMap((hidden) => [false, true, undefined].map((resize) => ({ hidden, resize }))),
      ...[false, true].map((resize) => ({ hidden: false, resize, project: true })),
    ];
    for (const c of cases) await t.test(`resize=${c.resize ?? "default"}, hidden=${c.hidden}, project=${!!c.project}`, async () => {
      await writeFile(await h.fixture.assertMutationTarget(join(h.agentDir, "hide-tool-output.json")),
        JSON.stringify({ enabled: c.hidden }), { mode: 0o600 });
      const settings = c.resize === undefined ? {} : { images: { autoResize: c.project ? !c.resize : c.resize } };
      const project = c.project ? { images: { autoResize: c.resize } } : undefined;
      const native = await h.create(false, settings, {}, project);
      const wrapped = await h.create(true, settings, {}, project);
      assert.equal(wrapped.settingsManager.getImageAutoResize(), c.resize ?? true);
      const result = await read(wrapped.session, "wide.png");
      assert.deepEqual(result, await read(native.session, "wide.png"));
      const picture = result.content.find((item) => item.type === "image");
      assert.ok(picture, "must return an image, not an omission");
      assert.equal(picture.data === image.toString("base64"), c.resize === false);
      if (c.resize !== false) assert.match(JSON.stringify(result.content), /original 2100x8/);
      assert.deepEqual(await read(wrapped.session, "session-only.txt"), await read(native.session, "session-only.txt"));
      if (!c.project && c.resize === true) {
        // Immediate changes are a wrapper contract; native read updates on reload.
        wrapped.settingsManager.setImageAutoResize(false);
        const changed = await read(wrapped.session, "wide.png");
        assert.equal(changed.content.find((item) => item.type === "image")?.data, image.toString("base64"));
        await wrapped.reload();
        assert.deepEqual(await read(wrapped.session, "wide.png"), changed);
      }
    });
  });
});

test("wrapped read forwards offsets, limits, cancellation and non-vision model context", async () => {
  await withSessions(async (h) => {
    await h.fixture.writeFile(join(h.fixture.project, "lines.txt"), "first\nsecond\nthird\n");
    await writeFile(await h.fixture.assertMutationTarget(join(h.fixture.project, "wide.png")), image, { mode: 0o600 });
    const native = await h.create(false, { images: { autoResize: false } });
    const wrapped = await h.create(true, { images: { autoResize: false } });
    const selected = { offset: 2, limit: 1 };
    const result = await read(wrapped.session, "lines.txt", selected);
    assert.deepEqual(result, await read(native.session, "lines.txt", selected));
    assert.match(JSON.stringify(result.content), /second/);
    assert.doesNotMatch(JSON.stringify(result.content), /first|third/);
    for (const s of [native, wrapped]) await assert.rejects(read(s.session, "lines.txt", selected, AbortSignal.abort()), /Operation aborted/);
    const nonVision = { input: ["text"] };
    const picture = await read(wrapped.session, "wide.png", {}, undefined, nonVision);
    assert.deepEqual(picture, await read(native.session, "wide.png", {}, undefined, nonVision));
    assert.match(JSON.stringify(picture.content), /Current model does not support images/);
  });
});
