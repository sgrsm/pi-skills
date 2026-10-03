import assert from "node:assert/strict";
import test from "node:test";
import { ExtensionSelectorComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { ScrollView, Text, TuiAltScreen, VStack, type Terminal } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
import { createTrashHistoryConfirmation, formatScanReport, type ScanResult } from "../trash-history/index.ts";

const CUTOFF = Date.parse("2026-03-01T00:00:00Z");

function largeScan(includeNamed: boolean): ScanResult {
  return {
    scope: "all-projects",
    sessionRoot: "/synthetic/sessions",
    includeNamed,
    protectedNamed: { count: 0, bytes: 0 },
    includedNamed: { count: 0, bytes: 0 },
    skipped: {} as ScanResult["skipped"],
    preview: [],
    eligibleBytes: 32 * 1024,
    candidates: Array.from({ length: 32 }, (_, index) => ({
      path: `/synthetic/sessions/${index}.jsonl`,
      canonicalPath: `/synthetic/sessions/${index}.jsonl`,
      identity: { dev: 1, ino: index, size: 1024, mtimeMs: CUTOFF - 86_400_000, ctimeMs: CUTOFF, nlink: 1 },
      named: false,
      cwd: `/long-project-path/${"界".repeat(180)}/project-${index % 10}`,
    })),
  };
}

function fullscreenLines(selector: ExtensionSelectorComponent, preview: string, columns: number): string[] {
  // Only a fake terminal receives writes; no real terminal or session state is used.
  const terminal: Terminal = {
    columns, rows: 24, kittyProtocolActive: false,
    start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {},
    hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {},
    clearScreen() {}, setTitle() {}, setProgress() {},
  };
  const tui = new TuiAltScreen(terminal, false, undefined, { mouse: false });
  const empty = new Text("", 0, 0);
  // Manual copy of Pi 1.0 chat-viewport's fixed-dock contract, built from public APIs.
  // The transcript scrolls, but the fixed input dock can shrink and clip selectors.
  const dock = new VStack([
    { component: empty, shrink: 1, minSize: 0 }, // pending messages
    { component: empty, shrink: 1, minSize: 0 }, // status
    { component: selector, shrink: 1, minSize: 3 },
    { component: new Text("footer\nstats\nextension status", 0, 0), shrink: 1, minSize: 0 },
  ]);
  const transcript = new ScrollView(new Text(preview, 0, 0), { follow: "end", primary: true });
  tui.setLayoutRoot(new VStack([
    { component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
    { component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
  ]));
  try {
    tui.start();
    tui.renderNow();
    return tui.getScreenLines().map(stripVTControlCharacters);
  } finally {
    tui.stop({ preserveScreen: true });
    selector.dispose();
  }
}

test("fullscreen fixture reproduces clipped legacy report-based confirmation choices", () => {
  initTheme("dark", false);
  const preview = formatScanReport(largeScan(false), CUTOFF, "Preview", { details: true });
  const selector = new ExtensionSelectorComponent(`Trash eligible Pi sessions?\n${preview}\nContinue?`,
    ["Yes", "No"], () => {}, () => {});
  const screen = fullscreenLines(selector, preview, 80).join("\n");
  assert.doesNotMatch(screen, /→ Yes/);
  assert.doesNotMatch(screen, /^\s+No\s*$/m);
});

test("Trash confirmation choices and help remain visible in 80x24 and narrow fullscreen docks", () => {
  initTheme("dark", false);
  for (const includeNamed of [false, true]) {
    const scan = largeScan(includeNamed);
    for (const archive of [false, true]) {
      const preview = formatScanReport(scan, CUTOFF, "Preview", {
        details: true,
        ...(archive ? { archivePath: `/long-archive-path/${"directory/".repeat(40)}sessions.zip` } : {}),
      });
      const confirmation = createTrashHistoryConfirmation(scan, archive);
      for (const width of [80, 40, 30]) {
        const selector = new ExtensionSelectorComponent(confirmation.title, confirmation.options, () => {}, () => {});
        // Budget actual wrapped lines, including host borders, spacers, choices, and help.
        assert.ok(selector.render(width).length <= 21, `selector must fit the dock at width ${width}`);
        const lines = fullscreenLines(selector, preview, width);
        const screen = lines.join("\n");
        assert.equal(lines.length, 24);
        assert.match(screen, /→ Cancel/);
        assert.ok(screen.includes(confirmation.options[1]!), screen);
        for (const hint of ["navigate", "select", "cancel"]) assert.ok(screen.includes(hint), screen);
        assert.match(screen, /See preview for details\./);
      }
    }
  }
});

test("host selector requires navigation for Trash approval and cancels on initial Enter or Escape", () => {
  initTheme("dark", false);
  for (const archive of [false, true]) {
    const confirmation = createTrashHistoryConfirmation(largeScan(false), archive);
    for (const keys of [["\r"], ["\x1b"], ["\x1b[B", "\r"]]) {
      const selected: string[] = [];
      let cancelCalls = 0;
      const selector = new ExtensionSelectorComponent(confirmation.title, confirmation.options,
        (value) => { selected.push(value); }, () => { cancelCalls += 1; });
      try {
        for (const key of keys) selector.handleInput(key);
        const escape = keys[0] === "\x1b";
        assert.equal(cancelCalls, escape ? 1 : 0, "Only Escape must invoke cancellation, exactly once");
        assert.deepEqual(selected, escape ? [] : [keys.length === 2 ? confirmation.options[1] : "Cancel"]);
      } finally {
        selector.dispose();
      }
    }
  }
});
