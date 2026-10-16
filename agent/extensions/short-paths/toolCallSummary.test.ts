import assert from "node:assert/strict";
import { homedir } from "node:os";
import test from "node:test";
import { createReadToolDefinition } from "@earendil-works/pi-coding-agent";
import { renderSmartToolCall, renderSmartVisibleToolCall } from "./toolCallSummary.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};
const path = "src/file.ts";
const native = createReadToolDefinition(process.cwd());

// Literal expectations follow Pi's public read-range formatter, which native read rows use.
const cases: Array<[string, Record<string, unknown>, string]> = [
  ["numeric", { offset: 10, limit: 5 }, ":10-14"],
  ["numeric strings", { offset: "10", limit: "5" }, ":10-14"],
  ["string offset, numeric limit", { offset: "10", limit: 5 }, ":10-14"],
  ["numeric offset, string limit", { offset: 10, limit: "5" }, ":10-14"],
  ["null offset", { offset: null, limit: 5 }, ":1-5"],
  ["null limit", { offset: 10, limit: null }, ":10"],
  ["omitted offset", { limit: 5 }, ":1-5"],
  ["omitted limit", { offset: 10 }, ":10"],
  ["both null", { offset: null, limit: null }, ""],
  ["both omitted", {}, ""],
  ["malformed offset", { offset: "abc", limit: 5 }, ""],
  ["malformed limit", { offset: 10, limit: "five" }, ""],
  ["non-scalar offset", { offset: {}, limit: 5 }, ""],
  ["empty offset", { offset: "", limit: 5 }, ""],
  ["empty limit", { offset: 10, limit: "  " }, ""],
  ["NaN offset", { offset: Number.NaN, limit: 5 }, ""],
  ["infinite limit", { offset: 10, limit: Number.POSITIVE_INFINITY }, ""],
  ["infinite string offset", { offset: "Infinity", limit: 5 }, ""],
];

// Native headers wrap paths in OSC 8 hyperlinks; compare visible text only.
const plain = (text: string) => text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "");

type Mode = "hidden" | "visible";

function render(mode: Mode, args: unknown, useSmartPaths: boolean, width = 100, lastComponent?: unknown, filePath = path) {
  const input = { path: filePath, ...(args as object) };
  const context = { lastComponent, isPartial: false, isError: false, state: {}, outputPad: 1 };
  const component = mode === "hidden"
    ? renderSmartToolCall("read", "default", input, theme, context, useSmartPaths)
    : renderSmartVisibleToolCall("read", input, theme, context, native.renderCall as any, native.label, useSmartPaths);
  return { component, lines: component.render(width).map(plain) };
}

for (const mode of ["hidden", "visible"] as const) for (const useSmartPaths of [true, false]) {
  // Visible rows with shortening off retain Pi's native header.
  test(`read range labels, ${mode}, short paths ${useSmartPaths ? "on" : "off"}`, () => {
    for (const [name, args, range] of cases) {
      const lines = render(mode, args, useSmartPaths).lines;
      const header = lines.find((line: string) => line.includes("read"))?.trim();
      assert.equal(header, `read ${path}${range}`, name);
    }
  });
}

for (const mode of ["hidden", "visible"] as const) {
  test(`read range survives path shortening at narrow and wide widths, ${mode}`, () => {
    const longPath = "/very-long-project-directory/another-long-parent-directory/source/filename.ts";
    const narrow = render(mode, { offset: "10", limit: "5" }, true, 36, undefined, longPath).lines[0]!;
    assert.ok(narrow.length <= 36, narrow);
    assert.match(narrow, /^ ?read .*filename\.ts:10-14 *$/);
    assert.notEqual(narrow.trim(), `read ${longPath}:10-14`, "path is shortened to fit");
    const wide = render(mode, { offset: "10", limit: "5" }, true, 200, undefined, longPath).lines[0]!;
    assert.equal(wide.trim(), `read ${longPath}:10-14`);
    for (const malformed of [{ offset: "x", limit: 5 }, { offset: "", limit: 5 }, { offset: Number.NaN }]) {
      assert.doesNotMatch(render(mode, malformed, true, 36, undefined, longPath).lines[0]!, /filename\.ts:/);
    }
  });

  test(`reused rows recompute the range from current arguments, ${mode}`, () => {
    for (const useSmartPaths of [true, false]) {
      let previous = render(mode, { offset: "10", limit: "5" }, useSmartPaths);
      for (const [args, range] of [
        [{ offset: "20", limit: "3" }, ":20-22"],
        [{ offset: "bad", limit: 3 }, ""],
        [{ limit: "7" }, ":1-7"],
        [{}, ""],
        [{ offset: null, limit: null }, ""],
        [{ offset: 5, limit: null }, ":5"],
      ] as const) {
        const next = render(mode, args, useSmartPaths, 100, previous.component);
        assert.equal(next.component, previous.component, "component is reused");
        assert.equal(next.lines.find((line: string) => line.includes("read"))?.trim(), `read ${path}${range}`);
        previous = next;
      }
    }
  });
}

test("hidden self-shell summaries use the same range label", () => {
  const input = { path, offset: "10", limit: "5" };
  const box = renderSmartToolCall("read", "self", input, theme, { isPartial: false, isError: false, outputPad: 1 }, true);
  assert.match(box.render(100).join("\n"), /read src\/file\.ts:10-14/);
});

const rawPaths = ["@src/file.ts", `${homedir()}/project/file.ts`];
const rangeArgs = { offset: "10", limit: 5 };
const renderContext = (expanded: boolean, lastComponent?: unknown) => ({
  lastComponent, isPartial: false, isError: false, state: {}, outputPad: 1, expanded,
  argsComplete: true, showImages: false, cwd: process.cwd(), toolCallId: "call", invalidate() {}, executionStarted: true,
});
const lines = (component: { render(width: number): string[] }) => component.render(100).map(plain);

test("visible rows with short paths off match fresh native output for raw and home paths", () => {
  for (const filePath of rawPaths) for (const expanded of [false, true]) {
    const input = { path: filePath, ...rangeArgs };
    const expected = lines((native.renderCall as any)(input, theme, renderContext(expanded)));
    const actual = lines(renderSmartVisibleToolCall("read", input, theme, renderContext(expanded), native.renderCall as any, native.label, false));
    assert.deepEqual(actual, expected, `${filePath} expanded=${expanded}`);
  }
  // Sanity: native keeps the '@' prefix, which smart replacement strips.
  const input = { path: "@src/file.ts", ...rangeArgs };
  assert.match(lines((native.renderCall as any)(input, theme, renderContext(false)))[0]!, /read @src\/file\.ts:10-14/);
  const smart = lines(renderSmartVisibleToolCall("read", input, theme, renderContext(false), native.renderCall as any, native.label, true));
  assert.equal(smart[0]!.trim(), "read src/file.ts:10-14");
});

test("expanded visible rows keep range header and native result marker lines", () => {
  const marker = ["RESULT-MARKER-1", "RESULT-MARKER-2"];
  const result = { content: [{ type: "text", text: marker.join("\n") }], details: undefined };
  const renderResult = (expanded: boolean) =>
    lines((native as any).renderResult(result, { expanded, isPartial: false }, theme, renderContext(expanded)));
  // A call renderer that embeds expanded content after the header, separated by a blank line.
  const callWithBody = (input: any, t: any, context: any) => {
    const header = (native.renderCall as any)(input, t, context).render(100);
    return { render: () => context.expanded ? [...header, "", ...marker] : header, invalidate() {} };
  };
  for (const useSmartPaths of [true, false]) {
    const input = { path: "@src/file.ts", ...rangeArgs };
    const expandedHeader = lines(renderSmartVisibleToolCall("read", input, theme, renderContext(true), native.renderCall as any, native.label, useSmartPaths));
    const collapsedHeader = lines(renderSmartVisibleToolCall("read", input, theme, renderContext(false), native.renderCall as any, native.label, useSmartPaths));
    assert.deepEqual(expandedHeader, collapsedHeader, "expansion does not change the header");
    assert.match(expandedHeader[0]!, useSmartPaths ? /^read src\/file\.ts:10-14$/ : /^read @src\/file\.ts:10-14 *$/);

    const withBody = lines(renderSmartVisibleToolCall("read", input, theme, renderContext(true), callWithBody, native.label, useSmartPaths));
    assert.match(withBody[0]!, /read .*file\.ts:10-14/);
    assert.deepEqual(withBody.slice(-3).map((line) => line.trim()), ["", ...marker]);
    assert.equal(lines(renderSmartVisibleToolCall("read", input, theme, renderContext(false), callWithBody, native.label, useSmartPaths)).join("").includes("RESULT-MARKER"), false);
  }
  // Native result rendering is independent of the call header and carries the marker when expanded.
  assert.ok(marker.every((text) => renderResult(true).some((line) => line.trim() === text)));
});
