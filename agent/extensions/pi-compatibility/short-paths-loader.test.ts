import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createEventBus, discoverAndLoadExtensions, ExtensionRunner, SessionManager,
  ToolExecutionComponent, initTheme,
  createReadToolDefinition, createEditToolDefinition, createWriteToolDefinition,
  createGrepToolDefinition, createFindToolDefinition, createLsToolDefinition,
  type ExtensionCommandContext, type ExtensionUIContext, type ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import { withTestScratchFixture, type TestScratchFixture } from "../permissions/testScratch.ts";
import { renderSmartToolCall, renderSmartVisibleToolCall } from "../short-paths/toolCallSummary.ts";
import { getToolCallRenderStrategy } from "../hide-tool-output/renderStrategy.ts";

const channel = "short-paths:state-change:v1";
const entrypoints = ["short-paths", "hide-tool-output"].map((name) =>
  fileURLToPath(new URL(`../${name}/index.ts`, import.meta.url)));
const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};
const factories = [createReadToolDefinition, createEditToolDefinition, createWriteToolDefinition,
  createGrepToolDefinition, createFindToolDefinition, createLsToolDefinition];
const longPath = join(homedir(), "very-long-project-directory", "another-long-parent-directory", "source", "filename.ts");

// Separate jiti instances are essential: native imports alone conceal this defect.
async function withLoader(run: (h: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  await withTestScratchFixture(async (fixture) => {
    const agentDir = join(fixture.root, "agent");
    await fixture.mkdir(agentDir);
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const h = await setup(fixture, agentDir);
    try { await run(h); }
    finally {
      for (const loaded of h.instances) {
        await loaded.runner.emit({ type: "session_shutdown", reason: "reload" });
        loaded.runtime.invalidate();
      }
      h.events.clear();
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
    }
  });
}

async function setup(fixture: TestScratchFixture, agentDir: string) {
  const bus = createEventBus();
  let subscriptions = 0;
  const events = {
    ...bus,
    on(name: string, handler: (data: unknown) => void) {
      if (name === channel) subscriptions++;
      const off = bus.on(name, handler);
      let active = true;
      return () => { if (active && name === channel) subscriptions--; active = false; off(); };
    },
  };
  const instances: Array<{ runner: ExtensionRunner; runtime: Awaited<ReturnType<typeof discoverAndLoadExtensions>>["runtime"] }> = [];
  async function load(reverse = false, hasUI = true, paths = entrypoints) {
    const loaded = await discoverAndLoadExtensions(reverse ? [...paths].reverse() : paths,
      fixture.project, agentDir, events);
    assert.deepEqual(loaded.errors, []);
    const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, fixture.project,
      SessionManager.inMemory(fixture.project), {} as ModelRegistry);
    const errors: unknown[] = [];
    runner.onError((error) => errors.push(error));
    instances.push({ runner, runtime: loaded.runtime });
    const expansionWrites: boolean[] = [];
    const notifications: string[] = [];
    const ui = {
      ...runner.getUIContext(), theme,
      notify(message: string) { notifications.push(message); },
      getToolsExpanded() { return false; },
      setToolsExpanded(value: boolean) { expansionWrites.push(value); },
    } as ExtensionUIContext;
    runner.setUIContext(hasUI ? ui : undefined, hasUI ? "tui" : "print");
    const tools = new Map(loaded.extensions.flatMap((ext) => [...ext.tools].map(([name, registration]) => [name, registration.definition] as const)));
    const commands = new Map(loaded.extensions.flatMap((ext) => [...ext.commands]));
    const command = commands.get("short-paths");
    if (paths.includes(entrypoints[0]!)) assert.ok(command);
    return {
      runner, runtime: loaded.runtime, tools, commands, expansionWrites, notifications,
      async start() {
        await runner.emit({ type: "session_start", reason: "reload" });
        assert.deepEqual(errors, []);
      },
      async toggle(mode: string) {
        assert.ok(command);
        await command.handler(mode, runner.createContext() as ExtensionCommandContext);
      },
    };
  }
  return { fixture, agentDir, events, instances, load, subscriptions: () => subscriptions,
    async persist(contents: string) {
      await writeFile(await fixture.assertMutationTarget(join(agentDir, "short-paths.json")), contents, { mode: 0o600 });
    },
  };
}

type Loaded = Awaited<ReturnType<Awaited<ReturnType<typeof setup>>["load"]>>;
function row(h: Loaded, name: string, hidden: boolean, expanded = false, id = name) {
  const tool = h.tools.get(name)!;
  const native = factories.map((factory) => factory(process.cwd())).find((tool) => tool.name === name)!;
  const args = { path: longPath, pattern: "needle", content: "hello", edits: [{ oldText: "a", newText: "b" }] };
  let component: any;
  let invalidations = 0;
  const context: any = {
    toolCallId: id, state: {}, cwd: process.cwd(), expanded,
    // Native edit previews read files asynchronously; path-formatting tests must not
    // request a diff preview of synthetic HOME paths or race preview completion.
    isPartial: false, isError: false, argsComplete: name !== "edit", executionStarted: true,
    invalidate() { invalidations++; render(); },
  };
  function render() {
    context.lastComponent = component;
    component = tool.renderCall!(args, theme as any, context);
  }
  render();
  return {
    context, tool, args,
    invalidations: () => invalidations,
    actual: (width: number) => component.render(width),
    expected(enabled: boolean, width: number) {
      const strategy = getToolCallRenderStrategy(name, hidden, native.renderShell);
      const fresh = { ...context, lastComponent: undefined, state: {} };
      const expected = strategy === "smartHidden"
        ? renderSmartToolCall(name, native.renderShell, args, theme, fresh, enabled)
        : strategy === "smartVisible"
          ? renderSmartVisibleToolCall(name, args, theme, fresh, native.renderCall as any, native.label, enabled)
          : native.renderCall!(args as any, theme as any, fresh);
      return expected.render(width);
    },
  };
}

for (const reverse of [false, true]) for (const hidden of [true, false]) {
  test(`actual loader synchronizes all path renderers, order=${reverse}, hiding=${hidden}`, async () => {
    await withLoader(async (h) => {
      await h.fixture.writeFile(join(h.agentDir, "short-paths.json"), '{"enabled":true}');
      await h.fixture.writeFile(join(h.agentDir, "hide-tool-output.json"), JSON.stringify({ enabled: hidden }));
      const loaded = await h.load(reverse);
      await loaded.start();
      const rows = factories.map((factory, i) => row(loaded, factory(process.cwd()).name, hidden, i % 2 === 0));
      const read = rows[0]!;
      for (const r of rows) {
        if (getToolCallRenderStrategy(r.tool.name, hidden, r.tool.renderShell) !== "builtIn") {
          assert.notDeepEqual(r.expected(true, 40), r.expected(false, 40), `${r.tool.name}: narrow path must expose stale shortening`);
        }
      }
      let previousMode = "on";
      for (const mode of ["off", "on", "off", "off", "on"]) {
        const counts = rows.map((r) => r.invalidations());
        await loaded.toggle(mode);
        const enabled = mode === "on";
        for (const [i, r] of rows.entries()) {
          for (const width of [40, 220]) assert.deepEqual(r.actual(width), r.expected(enabled, width), `${r.tool.name}, ${mode}, ${width}`);
          assert.equal(r.context.expanded, i % 2 === 0, "row expansion must not change");
          assert.equal(r.invalidations(), counts[i]! + Number(mode !== previousMode), "exactly one callback per changed row");
        }
        assert.equal(loaded.notifications.at(-1), mode === previousMode ? `short-paths is already ${mode}` : `short-paths ${mode}`);
        previousMode = mode;
        assert.deepEqual(JSON.parse(await readFile(join(h.agentDir, "short-paths.json"), "utf8")), { enabled });
      }
      assert.deepEqual(loaded.expansionWrites, [], "path changes must use row invalidation, not global expansion");
      assert.match(read.actual(220).join("\n"), /~\/very-long-project-directory/);
      assert.equal(h.subscriptions(), 1);
      await loaded.toggle("invalid");
      await loaded.toggle("");
      assert.match(loaded.notifications.at(-2)!, /Usage: \/short-paths on\|off \(currently on\)/);
      assert.equal(loaded.notifications.at(-1), "short-paths is on");
      const result = read.tool.renderResult!({ content: [{ type: "text", text: "RESULT_MARKER" }], details: undefined },
        { expanded: true, isPartial: false }, theme as any, { ...read.context, lastComponent: undefined });
      assert.equal(result.render(80).join("\n").includes("RESULT_MARKER"), !hidden, "hiding must remain unchanged");
    });
  });
}

test("reused command factories keep independent caches and publish to their own bus", async () => {
  await withLoader(async (h) => {
    const wrapper = join(h.fixture.root, "reused-factory.ts");
    await h.fixture.writeFile(wrapper, `import shortPaths from ${JSON.stringify(entrypoints[0])};
      export default (pi) => {
        for (const scope of ["first", "second"]) shortPaths({ ...pi,
          registerCommand(_name, options) { pi.registerCommand(scope, options); },
          events: { ...pi.events, emit(channel, value) { pi.events.emit(scope + ":" + channel, value); } },
        });
      };`);
    const published: string[] = [];
    h.events.on("first:" + channel, () => { published.push("first"); });
    h.events.on("second:" + channel, () => { published.push("second"); });
    const loaded = await h.load(false, true, [wrapper]);
    await loaded.start();
    for (const scope of ["first", "second"]) {
      await loaded.commands.get(scope)!.handler("off", loaded.runner.createContext() as ExtensionCommandContext);
      assert.equal(loaded.notifications.at(-1), "short-paths off", "one session's cache cannot suppress another session's broadcast");
    }
    assert.deepEqual(published, ["first", "second"]);
  });
});

test("public host rows redraw independently even with matching ids and retain real mixed expansion", async () => {
  await withLoader(async (h) => {
    initTheme("dark", false);
    await h.fixture.writeFile(join(h.agentDir, "hide-tool-output.json"), '{"enabled":false}');
    const loaded = await h.load();
    await loaded.start();
    let requests = 0;
    const rows = [true, false].map((expanded) => {
      const original = loaded.tools.get("read")!;
      const optionsSeen: boolean[] = [];
      const component = new ToolExecutionComponent("read", "same-id", { path: longPath }, {}, {
        ...original,
        renderResult(...args: Parameters<NonNullable<typeof original.renderResult>>) {
          optionsSeen.push(args[1].expanded);
          return original.renderResult!(...args);
        },
      }, { requestRender() { requests++; } } as any, h.fixture.project);
      component.setExpanded(expanded);
      component.updateResult({ content: [{ type: "text", text: Array.from({ length: 24 }, (_, i) => `RESULT_LINE_${i}`).join("\n") }], isError: false });
      return { component, optionsSeen, expanded };
    });
    const initial = rows.map(({ component }) => component.render(40));
    assert.notDeepEqual(initial[0], initial[1], "fixture must have real mixed expansion");
    const resultCounts = initial.map((lines) => lines.filter((line) => line.includes("RESULT_LINE_")).length);
    assert.deepEqual(resultCounts, [24, 0]);
    for (const mode of ["off", "on"]) {
      const before = requests;
      await loaded.toggle(mode);
      assert.equal(requests, before + 2, "each live component must request redraw once, regardless of call id");
      for (const [i, r] of rows.entries()) {
        const lines = r.component.render(40);
        assert.equal(r.optionsSeen.at(-1), r.expanded, "actual host result renderer retains expansion");
        assert.equal(lines.filter((line) => line.includes("RESULT_LINE_")).length, resultCounts[i]);
        if (mode === "off") assert.notDeepEqual(lines, initial[i], "existing host call header updates immediately");
        else assert.deepEqual(lines, initial[i], "lastComponent reuse restores original output");
      }
    }
    // Error and partial states use the same live invalidation contract.
    rows[0]!.component.updateResult({ content: [{ type: "text", text: "PARTIAL_ERROR_MARKER" }], isError: true }, true);
    await loaded.toggle("off");
    assert.match(rows[0]!.component.render(40).join("\n"), /PARTIAL_ERROR_MARKER/);
    assert.equal(rows[0]!.optionsSeen.at(-1), true);
    assert.deepEqual(loaded.expansionWrites, []);
  });
});

test("rows built before session_start reconcile a changed saved preference", async () => {
  await withLoader(async (h) => {
    const loaded = await h.load();
    const r = row(loaded, "read", true);
    await h.persist('{"enabled":false}');
    await loaded.start();
    assert.deepEqual(r.actual(40), r.expected(false, 40));
    assert.equal(r.invalidations(), 1);
    await loaded.toggle("on");
    assert.deepEqual(r.actual(40), r.expected(true, 40));
  });
});

test("renderer-only loading uses saved state without requiring the command owner", async () => {
  await withLoader(async (h) => {
    await h.persist('{"enabled":false}');
    const loaded = await h.load(false, true, [entrypoints[1]!]);
    const r = row(loaded, "read", true);
    assert.deepEqual(r.actual(40), r.expected(false, 40));
    await loaded.start();
    await h.persist('{"enabled":true}');
    await loaded.start();
    assert.deepEqual(r.actual(40), r.expected(true, 40));
    assert.equal(h.subscriptions(), 1);
  });
});

test("startup and same-bus reload use fresh persisted state and dispose old listeners/rows", async () => {
  await withLoader(async (h) => {
    const first = await h.load();
    assert.equal(h.subscriptions(), 0, "no subscription before session startup");
    await first.start();
    const old = row(first, "read", true);
    await first.start();
    assert.equal(h.subscriptions(), 1, "repeated startup is idempotent");
    h.events.emit(channel, { enabled: "false" });
    h.events.emit(channel, null);
    assert.equal(old.invalidations(), 0, "invalid event payloads are ignored");
    await first.toggle("off");
    assert.equal(old.invalidations(), 1);
    await first.runner.emit({ type: "session_shutdown", reason: "reload" });
    first.runtime.invalidate();
    assert.equal(h.subscriptions(), 0);
    const count = old.invalidations();
    await h.persist('{"enabled":true}');
    const fresh = await h.load(true);
    await fresh.start();
    const current = row(fresh, "read", true);
    await fresh.toggle("off");
    assert.deepEqual(current.actual(40), current.expected(false, 40));
    assert.equal(current.invalidations(), 1);
    assert.equal(old.invalidations(), count, "reload cannot redraw stale rows");
    assert.equal(h.subscriptions(), 1);
    // Host may keep the same factory/runtime for session replacement.
    await fresh.runner.emit({ type: "session_shutdown", reason: "new" });
    assert.equal(h.subscriptions(), 0);
    await h.persist('{"enabled":true}');
    await fresh.start();
    assert.equal(h.subscriptions(), 1);
    const next = row(fresh, "read", true, false, "new-session-read");
    await fresh.toggle("off");
    assert.equal(next.invalidations(), 1);
    assert.equal(current.invalidations(), 1, "session replacement clears old callbacks");
  });
});

test("missing, invalid, and saved-off configuration initialize independently loaded renderers", async () => {
  for (const [config, enabled] of [[undefined, true], ["not json", true], ["null", true],
    ['{"enabled":"false"}', true], ['{"enabled":false}', false]] as const) {
    await withLoader(async (h) => {
      if (config !== undefined) await h.persist(config);
      const loaded = await h.load();
      await loaded.start();
      const r = row(loaded, "read", true);
      for (const width of [40, 220]) assert.deepEqual(r.actual(width), r.expected(enabled, width));
      await loaded.runner.emit({ type: "session_shutdown", reason: "reload" });
      loaded.runtime.invalidate();
    });
  }
});

test("no-UI commands synchronize caches without invoking terminal APIs", async (t) => {
  t.mock.method(console, "log", () => {});
  await withLoader(async (h) => {
    const loaded = await h.load(false, false);
    await loaded.start();
    const r = row(loaded, "read", true);
    await loaded.toggle("off");
    assert.deepEqual(r.actual(40), r.expected(false, 40));
    await loaded.toggle("on");
    assert.deepEqual(r.actual(40), r.expected(true, 40));
    assert.equal(r.invalidations(), 2);
    assert.deepEqual(loaded.expansionWrites, []);
  });
});

test("failed persistence does not publish an uncommitted preference", async () => {
  await withLoader(async (h) => {
    const loaded = await h.load();
    await loaded.start();
    const r = row(loaded, "read", true);
    await h.fixture.mkdir(join(h.agentDir, "short-paths.json")); // force a safe write failure
    await assert.rejects(loaded.toggle("off"));
    assert.equal(r.invalidations(), 0);
    assert.deepEqual(r.actual(40), r.expected(true, 40));
    await loaded.toggle("");
    assert.equal(loaded.notifications.at(-1), "short-paths is on");
  });
});
