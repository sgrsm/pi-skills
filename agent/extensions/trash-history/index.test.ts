import assert from "node:assert/strict";
import { link, lstat, mkdir, mkdtemp, realpath, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import trashHistoryExtension, {
  archiveFileName,
  formatScanReport,
  parseTrashHistoryArguments,
  scanTrashHistory,
  shortenCwd,
  revalidateCandidate,
  type TrashHistoryDependencies,
} from "./index.ts";

const NOW = Date.parse("2026-03-01T00:00:00.000Z");
type TrashResult = { code: number; stdout: string; stderr: string; killed: boolean };
type ExecImplementation = (command: string, args: string[]) => Promise<TrashResult>;

function testDependencies(overrides: Partial<TrashHistoryDependencies> = {}): TrashHistoryDependencies {
  return {
    now: () => NOW,
    platform: () => "darwin",
    accessTrash: async () => {},
    accessArchiveExecutable: async () => {},
    globalSessionRoot: () => "",
    archiveDirectory: () => "/archive",
    ...overrides,
  };
}

async function fixture(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "trash-history-test-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function session(path: string, options: { name?: string; mtime?: number; malformed?: boolean; cwd?: unknown; id?: string; padding?: number } = {}): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const lines = options.malformed
    ? ["{not json"]
    : [
        JSON.stringify({
          type: "session",
          version: 3,
          id: options.id ?? "session-id",
          timestamp: "2026-02-26T00:00:00.000Z",
          cwd: Object.hasOwn(options, "cwd") ? options.cwd : "/workspace",
        }),
        ...(options.name === undefined ? [] : [JSON.stringify({ type: "session_info", name: options.name })]),
        ...(options.padding === undefined ? [] : [JSON.stringify({ type: "message", padding: "x".repeat(options.padding) })]),
      ];
  await writeFile(path, `${lines.join("\n")}\n`);
  if (options.mtime !== undefined) await utimes(path, options.mtime / 1_000, options.mtime / 1_000);
}

test("argument parser accepts the strict grammar with flags in any order and rejects duplicates", () => {
  assert.deepEqual(parseTrashHistoryArguments("30 --dry-run --include-named --details --archive"), {
    ok: true,
    value: { days: 30, dryRun: true, includeNamed: true, allProjects: false, details: true, archive: true },
  });
  assert.deepEqual(parseTrashHistoryArguments("30 --all-projects --details --include-named --dry-run"), {
    ok: true,
    value: { days: 30, dryRun: true, includeNamed: true, allProjects: true, details: true, archive: false },
  });
  for (const args of ["", "-1", "+1", "01", "1.0", "1e2", "1 extra", "1 --wat", "1 --dry-run --dry-run", "1 --include-named --include-named", "1 --all-projects --all-projects", "1 --details --details", "1 --archive --archive"]) {
    assert.equal(parseTrashHistoryArguments(args).ok, false, args);
  }
});

test("command without arguments shows usage and a safe example without scanning", async () => {
  await fixture(async (root) => {
    const harness = createHarness(root);

    await harness.command("");

    assert.equal(harness.sessionRootCalls, 0);
    assert.equal(harness.selectCalls, 0);
    assert.deepEqual(harness.execCalls, []);
    assert.equal(harness.audits.length, 0);
    const help = harness.messages.join("\n");
    assert.match(help, /Usage:\n\/trash-history <days> \[--archive\] \[--include-named\] \[--all-projects\] \[--dry-run\] \[--details\]/);
    assert.match(help, /Arguments:\n<days> - sessions last modified more than this many days ago\n--archive - save eligible sessions in a verified ZIP before moving them to Trash; default moves them directly to Trash\n--include-named - include sessions that have a name\n--all-projects - include sessions from every Pi project; default is the current project only\n--dry-run - preview only; do not create an archive or move files\n--details - show up to 30 metadata-only session rows/);
    assert.match(help, /Example: \/trash-history 60 --dry-run/);
  });
});

test("archive filenames use the command datetime and archived-session mtime range", async () => {
  await fixture(async (root) => {
    await session(join(root, "older.jsonl"), { mtime: Date.parse("2026-02-20T12:00:00.000Z") });
    await session(join(root, "newer.jsonl"), { mtime: Date.parse("2026-02-26T18:00:00.000Z") });
    const scan = await scanTrashHistory({ scope: "current-project", currentProjectCwd: "/workspace", sessionRoot: root, cutoffMs: NOW - 86_400_000, includeNamed: false });

    assert.equal(archiveFileName(scan.candidates, NOW), "2026-03-01T00-00Z-sessions-2026-02-20_2026-02-26.zip");
  });
});

test("structured reports shorten cwd values, group by eligible bytes, and never expose storage identifiers", async () => {
  assert.equal(shortenCwd("/Users/tester/work/app", "/Users/tester"), "~/work/app");
  assert.equal(shortenCwd("/srv/build/app", "/Users/tester"), "/srv/build/app");

  await fixture(async (root) => {
    await session(join(root, "storage-uuid-alpha-1.jsonl"), {
      id: "00000000-0000-0000-0000-alpha",
      cwd: "/Users/tester/work/alpha",
      padding: 600,
      mtime: NOW - 5 * 86_400_000,
    });
    await session(join(root, "storage-uuid-alpha-2.jsonl"), {
      id: "00000000-0000-0000-0000-alpha-two",
      cwd: "/Users/tester/work/alpha",
      padding: 600,
      mtime: NOW - 3 * 86_400_000,
    });
    await session(join(root, "storage-uuid-beta.jsonl"), {
      id: "00000000-0000-0000-0000-beta",
      cwd: "/Users/tester/work/beta",
      padding: 1_000,
      mtime: NOW - 2 * 86_400_000,
    });

    const scan = await scanTrashHistory({ scope: "all-projects", sessionRoot: root, cutoffMs: NOW - 86_400_000, includeNamed: false });
    const report = formatScanReport(scan, NOW - 86_400_000, "Preview", { homeDir: "/Users/tester" });
    const alpha = report.indexOf("~/work/alpha");
    const beta = report.indexOf("~/work/beta");
    assert.ok(alpha >= 0 && beta > alpha, report);
    assert.match(report, /  Sessions \|    Size \| Project\n-        2 \| 1\.5 KiB \| ~\/work\/alpha\n-        1 \| 1\.1 KiB \| ~\/work\/beta/);
    assert.doesNotMatch(report, /Oldest candidate|2026-02-24|Largest individual sessions:/);
    assert.doesNotMatch(report, /storage-uuid|00000000-0000-0000-0000/);
  });
});

test("default policy accounts only stale named sessions as protected with their bytes", async () => {
  await fixture(async (root) => {
    const staleNamed = join(root, "stale-named.jsonl");
    await session(staleNamed, { name: "Keep", mtime: NOW - 3 * 86_400_000, padding: 100 });
    await session(join(root, "recent-named.jsonl"), { name: "Recent", mtime: NOW - 1_000, padding: 100 });
    await session(join(root, "eligible.jsonl"), { mtime: NOW - 3 * 86_400_000 });

    const scan = await scanTrashHistory({ scope: "all-projects", sessionRoot: root, cutoffMs: NOW - 86_400_000, includeNamed: false });
    assert.equal(scan.protectedNamed.count, 1);
    assert.equal(scan.protectedNamed.bytes, (await lstat(staleNamed)).size);
    assert.deepEqual(scan.includedNamed, { count: 0, bytes: 0 });
    assert.equal(scan.skipped.named, 1);
    assert.equal(scan.skipped.tooRecent, 1);
    assert.match(formatScanReport(scan, NOW - 86_400_000, "Preview"), /Named sessions protected: 1 \(.+\)/);
  });
});

test("--include-named reports stale named sessions as included rather than protected", async () => {
  await fixture(async (root) => {
    const named = join(root, "named.jsonl");
    await session(named, { name: "Keep", mtime: NOW - 3 * 86_400_000, padding: 100 });
    await session(join(root, "unnamed.jsonl"), { mtime: NOW - 3 * 86_400_000 });
    const harness = createHarness(root);

    await harness.command("1 --include-named --dry-run");

    const namedBytes = (await lstat(named)).size;
    const report = harness.messages.join("\n");
    assert.match(report, new RegExp(`Named sessions included: 1 \\(${namedBytes} B\\)`));
    assert.doesNotMatch(report, /Named sessions protected:/);
    const audit = harness.audits[0] as Record<string, unknown>;
    assert.equal(audit.includedNamed, 1);
    assert.equal(audit.includedNamedBytes, namedBytes);
  });
});

test("details output is bounded and contains only date, size, and shortened cwd", async () => {
  await fixture(async (root) => {
    for (let index = 0; index < 32; index += 1) {
      await session(join(root, `raw-storage-${index}-uuid.jsonl`), {
        id: `raw-session-uuid-${index}`,
        cwd: "/Users/tester/work/details",
        padding: index,
        mtime: NOW - 3 * 86_400_000,
      });
    }
    const harness = createHarness(root, undefined, undefined, true, {}, undefined, { cwd: () => "/Users/tester/work/details" });
    await harness.command("1 --dry-run --details");

    const details = harness.messages.join("\n").split("Session details (largest 30):")[1]!;
    assert.equal((details.match(/^- \d{4}-\d{2}-\d{2} · /gm) ?? []).length, 30, details);
    assert.match(details, /2 additional eligible sessions omitted; showing largest 30\./);
    assert.doesNotMatch(details, /raw-storage|raw-session-uuid/);
  });
});

test("default preview and confirmation omit raw eligible paths and UUIDs", async () => {
  await fixture(async (root) => {
    const storageName = "storage-8c1ce20b-7bdb-4ae4-bc55-1c8de0c6b9db.jsonl";
    const sessionId = "f3f20ec1-01d9-4c89-a8cd-43f2c607c2f1";
    await session(join(root, storageName), { id: sessionId, mtime: NOW - 3 * 86_400_000 });
    const harness = createHarness(root);
    await harness.command("1");

    const visible = [...harness.messages, ...harness.selectionTitles].join("\n");
    assert.match(visible, /Eligible by project:/);
    assert.doesNotMatch(visible, /Largest individual sessions:/);
    assert.match(harness.selectionTitles[0]!, /^Trash Pi sessions\?\nScope:/);
    assert.deepEqual(harness.selectionOptions, [["Cancel", "Move to Trash"]]);
    assert.doesNotMatch(visible, /Eligible Pi sessions may be moved to Trash\./);
    assert.doesNotMatch(visible, new RegExp(storageName));
    assert.doesNotMatch(visible, new RegExp(sessionId));
  });
});

test("large detailed reports and long paths stay in the preview, not the confirmation selector", async () => {
  await fixture(async (root) => {
    for (let index = 0; index < 32; index += 1) {
      await session(join(root, `session-${index}.jsonl`), {
        cwd: `/long-project-path/${"界".repeat(180)}/project-${index % 10}`,
        mtime: NOW - 3 * 86_400_000,
      });
    }
    await session(join(root, "named.jsonl"), { name: "Keep", mtime: NOW - 3 * 86_400_000 });
    const archiveDirectory = join(root, "long-archive-path-".repeat(8));

    for (const flags of ["", "--details", "--archive", "--archive --details --include-named"]) {
      const includeNamed = flags.includes("--include-named");
      const archive = flags.includes("--archive");
      const harness = createHarness(root, undefined, undefined, true, {
        globalSessionRoot: () => root,
        archiveDirectory: () => archiveDirectory,
      }, (options) => options[0]);

      await harness.command(`1 --all-projects ${flags}`);

      assert.equal(harness.selectCalls, 1, flags);
      const title = harness.selectionTitles[0]!;
      assert.match(title, /^Trash Pi sessions\?\nScope: all-projects\n/);
      assert.match(title, new RegExp(`Eligible: ${includeNamed ? 33 : 32} · .+`));
      assert.match(title, new RegExp(`Named: ${includeNamed ? "included" : "protected"}`));
      assert.match(title, new RegExp(`Archive first: ${archive ? "yes" : "no"}`));
      assert.match(title, /See preview for details\./);
      assert.equal(title.split("\n").length, 6);
      assert.doesNotMatch(title, /long-project-path|界|project-\d|long-archive-path|\.zip|Session details|Cutoff|Skipped/);
      assert.deepEqual(harness.selectionOptions, [["Cancel", archive ? "Archive, then Trash" : "Move to Trash"]]);
      const preview = harness.messages[0]!;
      for (let index = 0; index < 10; index += 1) assert.ok(preview.includes(`/project-${index}`));
      assert.doesNotMatch(preview, /Other eligible projects/);
      assert.equal(preview.includes("Session details (largest 30):"), flags.includes("--details"));
      assert.equal(preview.includes("Archive before Trash:"), archive);
      assert.deepEqual(harness.execCalls, []);
      await assert.rejects(lstat(archiveDirectory), { code: "ENOENT" });
    }
  });
});

test("Cancel, Escape, and unexpected selector responses never authorize archive or Trash work", async () => {
  await fixture(async (root) => {
    const file = join(root, "old.jsonl");
    const archiveDirectory = join(root, "archives");
    await session(file, { mtime: NOW - 3 * 86_400_000 });
    for (const archive of [false, true]) {
      for (const response of ["Cancel", undefined, "Yes", "unknown", archive ? "Move to Trash" : "Archive, then Trash"]) {
        const harness = createHarness(root, undefined, undefined, true, {
          archiveDirectory: () => archiveDirectory,
        }, () => response);

        await harness.command(`1 ${archive ? "--archive" : ""}`);

        assert.equal(harness.selectCalls, 1);
        assert.deepEqual(harness.execCalls, []);
        assert.match(harness.messages.join("\n"), /Trash-history cancelled; no files were moved\./);
        assert.equal((harness.audits[0] as { cancelled: boolean }).cancelled, true);
        if (archive) assert.deepEqual((harness.audits[0] as { archive: unknown }).archive, { requested: true, status: "cancelled" });
        await lstat(file);
        await assert.rejects(lstat(archiveDirectory), { code: "ENOENT" });
      }
    }
  });
});

test("default command scope scans only the current project's direct session files and identifies that scope", async () => {
  await fixture(async (root) => {
    const currentProject = join(root, "sessions", "--workspace--");
    const currentFile = join(currentProject, "current.jsonl");
    const otherProjectFile = join(currentProject, "other-project", "other.jsonl");
    await session(currentFile, { mtime: NOW - 3 * 86_400_000 });
    await session(otherProjectFile, { mtime: NOW - 3 * 86_400_000 });
    await session(join(currentProject, "misfiled.jsonl"), { cwd: "/another-project", mtime: NOW - 3 * 86_400_000 });

    const harness = createHarness(currentProject);
    await harness.command("1 --dry-run");

    const report = harness.messages.join("\n");
    assert.match(report, /Scope: current-project/);
    assert.match(report, /Eligible by project:/);
    assert.match(report, /Eligible: 1/);
    assert.match(report, /projectMismatch=1/);
    assert.doesNotMatch(report, /current\.jsonl|other\.jsonl|misfiled\.jsonl/);
    assert.equal((harness.audits[0] as { scope: string }).scope, "current-project");
  });
});

test("current-project shared storage filters header cwd before cutoff and named-session accounting", async () => {
  await fixture(async (root) => {
    const oldTime = NOW - 3 * 86_400_000;
    const own = join(root, "own.jsonl");
    const active = join(root, "active.jsonl");
    const named = join(root, "named.jsonl");
    await session(own, { mtime: oldTime });
    await session(active, { mtime: oldTime, name: "Active" });
    await symlink(active, join(root, "active-alias"));
    await session(named, { mtime: oldTime, name: "Keep" });
    await session(join(root, "recent.jsonl"), { mtime: NOW });
    await session(join(root, "foreign.jsonl"), { mtime: oldTime, cwd: "/another-project" });
    await session(join(root, "foreign-named.jsonl"), { mtime: oldTime, cwd: "/another-project", name: "Foreign" });
    await session(join(root, "foreign-recent.jsonl"), { mtime: NOW, cwd: "/another-project" });

    for (const includeNamed of [false, true]) {
      const scan = await scanTrashHistory({
        scope: "current-project", currentProjectCwd: "/workspace", sessionRoot: root,
        activeSessionFile: join(root, "active-alias"), cutoffMs: NOW - 86_400_000, includeNamed,
      });
      assert.deepEqual(scan.candidates.map(({ path }) => path).sort(), (await Promise.all(
        (includeNamed ? [own, named] : [own]).map((path) => realpath(path)),
      )).sort());
      assert.equal(scan.skipped.projectMismatch, 3);
      assert.equal(scan.skipped.active, 1);
      assert.equal(scan.skipped.tooRecent, 1);
      assert.equal(scan.protectedNamed.count, includeNamed ? 0 : 1);
      assert.equal(scan.includedNamed.count, includeNamed ? 1 : 0);
      assert.match(formatScanReport(scan, NOW - 86_400_000, "Preview"), /projectMismatch=3/);
    }
  });
});

test("current-project skips malformed and ambiguous header cwd instead of inferring identity from storage", async () => {
  await fixture(async (root) => {
    const malformed = [undefined, null, 42, {}, []];
    const ambiguous = [
      "", " ", "workspace", "./workspace", "~/workspace", "file:///workspace", "C:\\workspace",
      "//workspace", "///workspace", "/workspace/../workspace", "/workspace/child/..",
      "/workspace\u0000", "/workspace\n", "/workspace\u007f", "/workspace\u0085", "/workspace\\", " /workspace", "/workspace ",
    ];
    await session(join(root, "own.jsonl"), { mtime: NOW - 3 * 86_400_000 });
    for (const [index, cwd] of [...malformed, ...ambiguous].entries()) {
      await session(join(root, `invalid-${index}.jsonl`), { cwd, name: "Do not count", mtime: NOW - 3 * 86_400_000 });
    }
    const scan = await scanTrashHistory({
      scope: "current-project", currentProjectCwd: "/workspace", sessionRoot: root,
      cutoffMs: NOW - 86_400_000, includeNamed: false,
    });
    assert.equal(scan.candidates.length, 1);
    assert.equal(scan.skipped.malformed, malformed.length);
    assert.equal(scan.skipped.projectIdentity, ambiguous.length);
    assert.deepEqual(scan.protectedNamed, { count: 0, bytes: 0 });
    const report = formatScanReport(scan, NOW - 86_400_000, "Preview");
    assert.match(report, new RegExp(`projectIdentity=${ambiguous.length}`));
    assert.doesNotMatch(report, /invalid-\d|Do not count/);
  });
});

test("current-project normalizes harmless absolute spellings but not case, unicode, or filesystem aliases", async () => {
  await fixture(async (root) => {
    const project = join(root, "Café");
    const alias = join(root, "alias");
    await mkdir(project);
    await symlink(project, alias);
    const equivalent = [project, `${project}/`, `${root}//Café/./`];
    const foreign = [alias, join(root, "CAFÉ"), join(root, "Cafe\u0301"), `${project}-other`, `${project}/child`];
    for (const [index, cwd] of [...equivalent, ...foreign].entries()) {
      await session(join(root, `session-${index}.jsonl`), { cwd, mtime: NOW - 3 * 86_400_000 });
    }
    const scan = await scanTrashHistory({
      scope: "current-project", currentProjectCwd: `${project}/./`, sessionRoot: root,
      cutoffMs: NOW - 86_400_000, includeNamed: true,
    });
    assert.equal(scan.candidates.length, equivalent.length);
    assert.equal(scan.skipped.projectMismatch, foreign.length);
  });
});

test("current-project fails closed when the running cwd identity is unavailable or ambiguous", async () => {
  await fixture(async (root) => {
    await session(join(root, "own.jsonl"), { mtime: NOW - 3 * 86_400_000 });
    for (const cwd of [undefined, null, 42, "", "workspace", "//workspace", "/workspace/..", "/workspace\u0000"]) {
      const scan = await scanTrashHistory({
        scope: "current-project", currentProjectCwd: cwd, sessionRoot: root,
        cutoffMs: NOW - 86_400_000, includeNamed: true,
      });
      assert.equal(scan.fatal, "projectIdentityUnavailable");
      assert.deepEqual(scan.candidates, []);
      const harness = createHarness(root, undefined, undefined, true, {}, undefined, { cwd: () => cwd });
      await harness.command("1 --archive");
      assert.equal(harness.sessionRootCalls, 0);
      assert.equal(harness.selectCalls, 0);
      assert.deepEqual(harness.execCalls, []);
      assert.match(harness.messages.join("\n"), /project identity/i);
    }
    const stale = createHarness(root, undefined, undefined, true, {}, undefined, {
      cwd: () => { throw new Error("stale context"); },
    });
    await stale.command("1 --archive");
    assert.equal(stale.sessionRootCalls, 0);
    assert.equal(stale.selectCalls, 0);
    assert.deepEqual(stale.execCalls, []);
    assert.match(stale.messages.join("\n"), /project identity/i);
  });
});

test("an opened or resumed session's shared parent is not a project boundary", async () => {
  await fixture(async (root) => {
    const active = join(root, "active.jsonl");
    await session(active, { cwd: "/workspace/resumed", mtime: NOW });
    await session(join(root, "same-project.jsonl"), { cwd: "/workspace/resumed", mtime: NOW - 3 * 86_400_000 });
    await session(join(root, "foreign-project.jsonl"), { cwd: "/workspace/launcher", mtime: NOW - 3 * 86_400_000 });
    const manager = SessionManager.open(active);
    assert.equal(manager.getCwd(), "/workspace/resumed");
    assert.equal(manager.getSessionDir(), await realpath(root));
    const harness = createHarness(root, undefined, undefined, true, {}, undefined, {
      cwd: () => manager.getCwd(), sessionManager: manager,
    });
    await harness.command("1 --dry-run");
    assert.match(harness.messages.join("\n"), /Eligible: 1/);
    assert.match(harness.messages.join("\n"), /projectMismatch=1/);
    assert.equal((harness.audits[0] as { skipped: { active: number } }).skipped.active, 1);
    assert.deepEqual(harness.execCalls, []);
  });
});

test("revalidation independently enforces current-project header identity on unchanged snapshots", async () => {
  await fixture(async (root) => {
    for (const [name, cwd] of [["foreign", "/another-project"], ["ambiguous", "workspace"]]) {
      await session(join(root, `${name}.jsonl`), { cwd, mtime: NOW - 3 * 86_400_000 });
    }
    const scan = await scanTrashHistory({ scope: "all-projects", sessionRoot: root, cutoffMs: NOW - 86_400_000, includeNamed: true });
    assert.equal(scan.candidates.length, 2);
    for (const candidate of scan.candidates) {
      const result = await revalidateCandidate(candidate, {
        scope: "current-project", currentProjectCwd: "/workspace", sessionRoot: root,
        cutoffMs: NOW - 86_400_000, includeNamed: true,
      });
      assert.deepEqual(result, { ok: false, reason: candidate.cwd === "workspace" ? "projectIdentity" : "projectMismatch" });
    }
  });
});

test("action-time project identity changes or loss exclude candidates before Trash and archive selection", async () => {
  await fixture(async (root) => {
    const own = join(root, "own.jsonl");
    await session(own, { mtime: NOW - 3 * 86_400_000 });
    for (const flags of ["", "--archive"]) {
      for (const [readActionCwd, reason] of [
        [() => "/another-project", "projectMismatch"],
        [() => undefined, "projectIdentity"],
        [() => { throw new Error("stale context"); }, "projectIdentity"],
      ] as const) {
        let actionTime = false;
        const archiveDirectory = join(root, "archives");
        const harness = createHarness(root, undefined, undefined, true, { archiveDirectory: () => archiveDirectory },
          (options) => { actionTime = true; return options[1]; }, { cwd: () => actionTime ? readActionCwd() : "/workspace" });
        await harness.command(`1 ${flags}`);
        assert.equal(harness.selectCalls, 1);
        assert.deepEqual(harness.execCalls, []);
        assert.match(harness.messages.join("\n"), new RegExp(`Action-time skipped: ${reason}=1`));
        await lstat(own);
        await assert.rejects(lstat(archiveDirectory), { code: "ENOENT" });
      }
    }
  });
});

test("changed header cwd after confirmation cannot enter Trash or archive selection", async () => {
  await fixture(async (root) => {
    const own = join(root, "own.jsonl");
    for (const flags of ["", "--archive"]) {
      await session(own, { mtime: NOW - 3 * 86_400_000 });
      const harness = createHarness(root, undefined, undefined, true, { archiveDirectory: () => join(root, "archives") },
        async (options) => {
          await session(own, { cwd: "/another-project", mtime: NOW - 3 * 86_400_000 });
          return options[1];
        });
      await harness.command(`1 ${flags}`);
      assert.equal(harness.selectCalls, 1);
      assert.deepEqual(harness.execCalls, []);
      assert.match(harness.messages.join("\n"), /Action-time skipped: changed=1/);
      await lstat(own);
      await assert.rejects(lstat(join(root, "archives")), { code: "ENOENT" });
    }
  });
});

test("--all-projects scans direct project directories beneath the injected global sessions root", async () => {
  await fixture(async (root) => {
    const globalSessionsRoot = join(root, "sessions");
    const projectA = join(globalSessionsRoot, "project-a");
    const projectB = join(globalSessionsRoot, "project-b");
    await session(join(projectA, "a.jsonl"), { cwd: "/another-project", mtime: NOW - 3 * 86_400_000 });
    await session(join(projectB, "b.jsonl"), { cwd: "relative/project", mtime: NOW - 3 * 86_400_000 });

    const harness = createHarness(projectA, undefined, undefined, true, {
      globalSessionRoot: () => globalSessionsRoot,
    }, undefined, { cwd: () => assert.fail("All-projects must not require or read the current-project identity") });
    await harness.command("1 --all-projects --dry-run");

    const report = harness.messages.join("\n");
    assert.match(report, /Scope: all-projects/);
    assert.match(report, /Eligible: 2/);
    assert.match(report, /Eligible by project:/);
    assert.doesNotMatch(report, /project-a\/a\.jsonl|project-b\/b\.jsonl/);
    const audit = harness.audits[0] as { scope: string; skipped: Record<string, number> };
    assert.equal(audit.scope, "all-projects");
    assert.equal(audit.skipped.projectIdentity, 0);
    assert.equal(audit.skipped.projectMismatch, 0);
  });
});

test("scan is non-recursive, excludes active aliases and named sessions, and records safe eligible files", async () => {
  await fixture(async (root) => {
    const project = join(root, "--project--");
    await mkdir(project);
    const old = join(project, "old.jsonl");
    const named = join(project, "named.jsonl");
    const active = join(project, "active.jsonl");
    const nested = join(project, "nested", "ignored.jsonl");
    await session(old, { mtime: NOW - 3 * 86_400_000 });
    await session(named, { name: "Keep me", mtime: NOW - 3 * 86_400_000 });
    await session(active, { mtime: NOW - 3 * 86_400_000 });
    await session(nested, { mtime: NOW - 3 * 86_400_000 });

    const report = await scanTrashHistory({
      scope: "all-projects",
      sessionRoot: root,
      activeSessionFile: active,
      cutoffMs: NOW - 86_400_000,
      includeNamed: false,
    });

    assert.deepEqual(report.candidates.map((candidate) => candidate.path), [await realpath(old)]);
    assert.equal(report.skipped.named, 1);
    assert.equal(report.skipped.active, 1);
  });
});

test("scan requires a valid Pi session header as the first JSONL entry", async () => {
  await fixture(async (root) => {
    const project = join(root, "--project--");
    await mkdir(project);
    const oldTime = NOW - 3 * 86_400_000;
    await writeFile(join(project, "arbitrary.jsonl"), `${JSON.stringify({ type: "note", value: "valid JSON" })}\n`);
    await writeFile(join(project, "empty-object.jsonl"), "{}\n");
    await writeFile(join(project, "session-info-only.jsonl"), `${JSON.stringify({ type: "session_info", name: "misleading" })}\n`);
    await writeFile(join(project, "missing-identity.jsonl"), `${JSON.stringify({ type: "session", id: "not-enough" })}\n`);
    await writeFile(join(project, "late-header.jsonl"), `${JSON.stringify({ type: "message" })}\n${JSON.stringify({ type: "session", id: "late", timestamp: "2026-02-26T00:00:00.000Z", cwd: "/workspace" })}\n`);
    for (const name of ["arbitrary.jsonl", "empty-object.jsonl", "session-info-only.jsonl", "missing-identity.jsonl", "late-header.jsonl"]) {
      const path = join(project, name);
      await utimes(path, oldTime / 1_000, oldTime / 1_000);
    }

    const report = await scanTrashHistory({ scope: "all-projects", sessionRoot: root, cutoffMs: NOW - 86_400_000, includeNamed: true });

    assert.equal(report.candidates.length, 0);
    assert.equal(report.skipped.malformed, 5);
  });
});

test("scan accepts a documented legacy Pi session header without version", async () => {
  await fixture(async (root) => {
    const project = join(root, "--project--");
    const file = join(project, "legacy.jsonl");
    await mkdir(project);
    await writeFile(file, `${JSON.stringify({
      type: "session",
      id: "legacy-session-id",
      timestamp: "2026-02-26T00:00:00.000Z",
      cwd: "",
    })}\n`);
    await utimes(file, (NOW - 3 * 86_400_000) / 1_000, (NOW - 3 * 86_400_000) / 1_000);

    const report = await scanTrashHistory({ scope: "all-projects", sessionRoot: root, cutoffMs: NOW - 86_400_000, includeNamed: true });

    assert.deepEqual(report.candidates.map((candidate) => candidate.path), [await realpath(file)]);
  });
});

test("an explicit cleared session name leaves a session eligible by default", async () => {
  await fixture(async (root) => {
    const project = join(root, "--project--");
    const file = join(project, "cleared-name.jsonl");
    await mkdir(project);
    await writeFile(file, [
      JSON.stringify({ type: "session", id: "cleared-name", timestamp: "2026-02-26T00:00:00.000Z", cwd: "/workspace" }),
      JSON.stringify({ type: "session_info", name: "Former name" }),
      JSON.stringify({ type: "session_info" }),
      "",
    ].join("\n"));
    await utimes(file, (NOW - 3 * 86_400_000) / 1_000, (NOW - 3 * 86_400_000) / 1_000);

    const report = await scanTrashHistory({ scope: "all-projects", sessionRoot: root, cutoffMs: NOW - 86_400_000, includeNamed: false });

    assert.deepEqual(report.candidates.map((candidate) => candidate.path), [await realpath(file)]);
  });
});

test("scan rejects symlinks, hard links, and malformed JSONL without exposing session contents", async () => {
  await fixture(async (root) => {
    const project = join(root, "--project--");
    await mkdir(project);
    const oldTime = NOW - 3 * 86_400_000;
    const good = join(project, "good.jsonl");
    const hard = join(project, "hard.jsonl");
    const malformed = join(project, "malformed.jsonl");
    await session(good, { mtime: oldTime });
    await link(good, hard);
    await session(malformed, { malformed: true, mtime: oldTime });
    await symlink(project, join(root, "linked-project"));
    await symlink(good, join(project, "linked.jsonl"));

    const report = await scanTrashHistory({ scope: "all-projects", sessionRoot: root, cutoffMs: NOW - 86_400_000, includeNamed: true });

    assert.equal(report.candidates.length, 0);
    assert.equal(report.skipped.hardLink, 2);
    assert.equal(report.skipped.malformed, 1);
    assert.equal(report.skipped.symlink, 1);
    assert.equal(report.skipped.projectSymlink, 1);
    assert.ok(report.preview.every((item) => !item.includes("{not json")));
  });
});

test("revalidation fails closed when a scanned file changes", async () => {
  await fixture(async (root) => {
    const project = join(root, "--project--");
    await mkdir(project);
    const file = join(project, "old.jsonl");
    await session(file, { mtime: NOW - 3 * 86_400_000 });
    const scan = await scanTrashHistory({ scope: "all-projects", sessionRoot: root, cutoffMs: NOW - 86_400_000, includeNamed: true });
    const candidate = scan.candidates[0];
    assert.ok(candidate);

    await writeFile(file, `${JSON.stringify({ type: "session" })}\n${JSON.stringify({ type: "message" })}\n`);
    await utimes(file, NOW / 1_000, NOW / 1_000);
    const result = await revalidateCandidate(candidate, {
      scope: "all-projects",
      sessionRoot: root,
      cutoffMs: NOW - 86_400_000,
      includeNamed: true,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "changed");
  });
});

test("command skips a file that becomes the active session before revalidation", async () => {
  await fixture(async (root) => {
    const initiallyActive = join(root, "initially-active.jsonl");
    const candidate = join(root, "old.jsonl");
    await session(initiallyActive, { mtime: NOW - 3 * 86_400_000 });
    await session(candidate, { mtime: NOW - 3 * 86_400_000 });
    let activeReads = 0;
    const harness = createHarness(root, () => (activeReads++ === 0 ? initiallyActive : candidate));

    await harness.command("1");

    assert.equal(harness.selectCalls, 1);
    assert.deepEqual(harness.execCalls, []);
    assert.match(harness.messages.join("\n"), /active=1/);
    await lstat(candidate);
  });
});

test("command dry-run never confirms or invokes Trash, while non-dry-run uses fixed Trash args after confirmation", async () => {
  await fixture(async (root) => {
    const dryFile = join(root, "dry.jsonl");
    await session(dryFile, { mtime: NOW - 3 * 86_400_000 });
    const dryHarness = createHarness(root);
    await dryHarness.command("1 --dry-run");
    assert.equal(dryHarness.selectCalls, 0);
    assert.deepEqual(dryHarness.execCalls, []);
    assert.match(dryHarness.messages.join("\n"), /Dry run/i);
    assert.match(dryHarness.messages.join("\n"), /Eligible: 1/);
    assert.doesNotMatch(dryHarness.messages.join("\n"), /dry\.jsonl/);
    await rm(dryFile);

    const moveFile = join(root, "move.jsonl");
    await session(moveFile, { mtime: NOW - 3 * 86_400_000 });
    const canonicalMoveFile = await realpath(moveFile);
    const moveHarness = createHarness(root, dryFile, async (_command, args) => {
      await rm(args[0]!, { force: true });
      return { code: 0, stdout: "", stderr: "", killed: false };
    });
    await moveHarness.command("1 --include-named");
    assert.equal(moveHarness.selectCalls, 1);
    assert.match(moveHarness.selectionTitles[0]!, /Scope: current-project/);
    assert.deepEqual(moveHarness.execCalls, [["/usr/bin/trash", [canonicalMoveFile]]]);
    await assert.rejects(lstat(moveFile), { code: "ENOENT" });
    assert.equal(moveHarness.audits.length, 1);
  });
});

test("--archive dry-runs only report the dated ZIP plan", async () => {
  await fixture(async (root) => {
    const old = join(root, "old.jsonl");
    const archiveDirectory = join(root, "archives");
    await session(old, { mtime: NOW - 3 * 86_400_000 });
    const harness = createHarness(root, undefined, undefined, true, { archiveDirectory: () => archiveDirectory });

    await harness.command("1 --archive --dry-run");

    assert.equal(harness.selectCalls, 0);
    assert.deepEqual(harness.execCalls, []);
    await assert.rejects(lstat(archiveDirectory), { code: "ENOENT" });
    const report = harness.messages.join("\n");
    assert.match(report, /Archive before Trash: .+2026-03-01T00-00Z-sessions-2026-02-26_2026-02-26\.zip/);
    assert.doesNotMatch(report, /old\.jsonl/);
    assert.deepEqual((harness.audits[0] as { archive: unknown }).archive, {
      requested: true,
      status: "dry-run",
      path: join(archiveDirectory, "2026-03-01T00-00Z-sessions-2026-02-26_2026-02-26.zip"),
    });
  });
});

test("--archive creates and verifies one dated ZIP before any Trash call", async () => {
  await fixture(async (root) => {
    const old = join(root, "old.jsonl");
    const archiveDirectory = join(root, "archives");
    const canonicalRoot = await realpath(root);
    await session(old, { mtime: NOW - 3 * 86_400_000 });
    const expectedSessionBytes = (await lstat(old)).size;
    const expectedArchive = join(canonicalRoot, "archives", "2026-03-01T00-00Z-sessions-2026-02-26_2026-02-26.zip");
    let partialArchive: string | undefined;
    const harness = createHarness(root, undefined, async (command, args) => {
      if (command === "/usr/bin/env") {
        assert.deepEqual(args.slice(0, 4), ["-C", canonicalRoot, "/usr/bin/zip", "-q"]);
        assert.match(args[4]!, /\.zip\.partial-[0-9a-f-]+$/);
        assert.deepEqual(args.slice(5), ["--", "old.jsonl"]);
        partialArchive = args[4]!;
        await writeFile(partialArchive, "archive placeholder");
        return { code: 0, stdout: "", stderr: "", killed: false };
      }
      if (command === "/usr/bin/unzip") {
        assert.ok(partialArchive);
        if (args[0] === "-Z") {
          assert.deepEqual(args, ["-Z", "-h", partialArchive]);
          return { code: 0, stdout: "Zip file size: 19 bytes, number of entries: 1\n", stderr: "", killed: false };
        }
        assert.deepEqual(args, ["-tqq", partialArchive]);
        return { code: 0, stdout: "", stderr: "", killed: false };
      }
      assert.equal(command, "/usr/bin/trash");
      await rm(args[0]!, { force: true });
      return { code: 0, stdout: "", stderr: "", killed: false };
    }, true, { archiveDirectory: () => archiveDirectory });

    await harness.command("1 --archive");

    assert.equal(harness.selectCalls, 1);
    assert.deepEqual(harness.execCalls.map(([command]) => command), ["/usr/bin/env", "/usr/bin/unzip", "/usr/bin/unzip", "/usr/bin/trash"]);
    const archiveStats = await lstat(expectedArchive);
    assert.equal(archiveStats.mode & 0o077, 0);
    await assert.rejects(lstat(old), { code: "ENOENT" });
    const report = harness.messages.join("\n");
    assert.match(report, /Archive: .+sessions-2026-02-26_2026-02-26\.zip · 1 sessions/);
    assert.doesNotMatch(report, /old\.jsonl/);
    const audit = harness.audits[0] as Record<string, unknown>;
    assert.equal(audit.eligibleBytes, expectedSessionBytes);
    assert.equal(audit.moved, 1);
    assert.equal(audit.movedBytes, expectedSessionBytes);
    assert.deepEqual(audit.archive, { requested: true, status: "complete", sessions: 1, path: expectedArchive });
  });
});

test("current-project archive contains only matching shared-directory sessions and still protects active/named sessions", async () => {
  await fixture(async (root) => {
    const own = join(root, "own.jsonl");
    const named = join(root, "named.jsonl");
    const active = join(root, "active.jsonl");
    const foreign = join(root, "foreign.jsonl");
    const ambiguous = join(root, "ambiguous.jsonl");
    await session(own, { mtime: NOW - 3 * 86_400_000 });
    await session(named, { name: "Keep", mtime: NOW - 3 * 86_400_000 });
    await session(active, { name: "Active", mtime: NOW - 3 * 86_400_000 });
    await session(foreign, { name: "Foreign", cwd: "/another-project", mtime: NOW - 3 * 86_400_000 });
    await session(ambiguous, { cwd: "", mtime: NOW - 3 * 86_400_000 });
    const harness = createHarness(root, active, async (command, args) => {
      if (command === "/usr/bin/env") {
        assert.deepEqual(args.slice(5), ["--", "own.jsonl"]);
        await writeFile(args[4]!, "archive placeholder");
      } else if (command === "/usr/bin/unzip" && args[0] === "-Z") {
        return { code: 0, stdout: "number of entries: 1", stderr: "", killed: false };
      } else if (command === "/usr/bin/trash") {
        assert.equal(args[0], await realpath(own));
        await rm(args[0]!);
      } else {
        assert.equal(command, "/usr/bin/unzip");
      }
      return { code: 0, stdout: "", stderr: "", killed: false };
    }, true, { archiveDirectory: () => join(root, "archives") });
    await harness.command("1 --archive");
    assert.deepEqual(harness.execCalls.map(([command]) => command), ["/usr/bin/env", "/usr/bin/unzip", "/usr/bin/unzip", "/usr/bin/trash"]);
    for (const path of [active, named, foreign, ambiguous]) await lstat(path);
    const audit = harness.audits[0] as { eligible: number; moved: number; skipped: Record<string, number> };
    assert.equal(audit.eligible, 1);
    assert.equal(audit.moved, 1);
    assert.equal(audit.skipped.active, 1);
    assert.equal(audit.skipped.named, 1);
    assert.equal(audit.skipped.projectMismatch, 1);
    assert.equal(audit.skipped.projectIdentity, 1);
  });
});

test("current-project identity is revalidated again between a verified archive and Trash", async () => {
  await fixture(async (root) => {
    const own = join(root, "own.jsonl");
    await session(own, { mtime: NOW - 3 * 86_400_000 });
    let cwd = "/workspace";
    const harness = createHarness(root, undefined, async (command, args) => {
      assert.notEqual(command, "/usr/bin/trash", "Project switch must block the post-archive Trash call");
      if (command === "/usr/bin/env") await writeFile(args[4]!, "archive placeholder");
      if (command === "/usr/bin/unzip" && args[0] === "-Z") {
        cwd = "/another-project";
        return { code: 0, stdout: "number of entries: 1", stderr: "", killed: false };
      }
      return { code: 0, stdout: "", stderr: "", killed: false };
    }, true, { archiveDirectory: () => join(root, "archives") }, undefined, { cwd: () => cwd });
    await harness.command("1 --archive");
    assert.deepEqual(harness.execCalls.map(([command]) => command), ["/usr/bin/env", "/usr/bin/unzip", "/usr/bin/unzip"]);
    assert.match(harness.messages.join("\n"), /Action-time skipped: projectMismatch=1/);
    assert.equal((harness.audits[0] as { archive: { status: string } }).archive.status, "complete");
    await lstat(own);
  });
});

test("--archive aborts the entire Trash batch when ZIP creation fails or is incomplete", async () => {
  await fixture(async (root) => {
    const old = join(root, "old.jsonl");
    await session(old, { mtime: NOW - 3 * 86_400_000 });

    for (const [name, execImplementation, expectedFailure] of [
      ["zip-failure", async () => ({ code: 1, stdout: "", stderr: "failed", killed: false }), /Archive creation failed/],
      ["incomplete", async (_command: string, args: string[]) => {
        if (args[2] === "/usr/bin/zip") {
          await writeFile(args[4]!, "archive placeholder");
          return { code: 0, stdout: "", stderr: "", killed: false };
        }
        if (args[0] === "-Z") return { code: 0, stdout: "Zip file size: 19 bytes, number of entries: 0\n", stderr: "", killed: false };
        return { code: 0, stdout: "", stderr: "", killed: false };
      }, /Archive verification found an incomplete ZIP/],
    ] as const) {
      const archiveDirectory = join(root, name);
      const harness = createHarness(root, undefined, execImplementation, true, { archiveDirectory: () => archiveDirectory });

      await harness.command("1 --archive");

      assert.equal(harness.selectCalls, 1, name);
      assert.deepEqual(harness.execCalls.map(([command]) => command), name === "zip-failure" ? ["/usr/bin/env"] : ["/usr/bin/env", "/usr/bin/unzip", "/usr/bin/unzip"], name);
      await lstat(old);
      assert.match(harness.messages.join("\n"), expectedFailure, name);
      assert.deepEqual((harness.audits[0] as { archive: unknown }).archive, { requested: true, status: "failed" }, name);
    }
  });
});

test("command rejects an unrepresentable cutoff before reading the session root or invoking Trash", async () => {
  await fixture(async (root) => {
    const harness = createHarness(root);

    await harness.command("104000000");

    assert.equal(harness.sessionRootCalls, 0);
    assert.equal(harness.selectCalls, 0);
    assert.deepEqual(harness.execCalls, []);
    assert.match(harness.messages.join("\n"), /outside the supported date range/i);
  });
});

test("non-dry-run fails closed without UI and failed Trash preflight performs no batch moves", async () => {
  await fixture(async (root) => {
    const file = join(root, "old.jsonl");
    await session(file, { mtime: NOW - 3 * 86_400_000 });

    const noUi = createHarness(root, undefined, undefined, false);
    await noUi.command("1");
    assert.equal(noUi.selectCalls, 0);
    assert.deepEqual(noUi.execCalls, []);
    await lstat(file);

    const unavailable = createHarness(root, undefined, undefined, true, {
      accessTrash: async () => { throw new Error("unavailable"); },
    });
    await unavailable.command("1");
    assert.equal(unavailable.selectCalls, 0);
    assert.deepEqual(unavailable.execCalls, []);
    assert.match(unavailable.messages.join("\n"), /Trash is unavailable/i);
  });
});

test("normal runs append an audit entry even when no session is eligible", async () => {
  await fixture(async (root) => {
    const harness = createHarness(root);

    await harness.command("1");

    assert.equal(harness.selectCalls, 0);
    assert.deepEqual(harness.execCalls, []);
    assert.equal(harness.audits.length, 1);
    assert.deepEqual(harness.audits[0], {
      days: 1,
      dryRun: false,
      cutoffMs: NOW - 86_400_000,
      scope: "current-project",
      eligible: 0,
      eligibleBytes: 0,
      protectedNamed: 0,
      protectedNamedBytes: 0,
      includedNamed: 0,
      includedNamedBytes: 0,
      skipped: {
        active: 0,
        named: 0,
        tooRecent: 0,
        symlink: 0,
        nonRegular: 0,
        hardLink: 0,
        malformed: 0,
        projectIdentity: 0,
        projectMismatch: 0,
        unreadable: 0,
        unsafe: 0,
        changed: 0,
        projectSymlink: 0,
        projectUnreadable: 0,
        projectUnsafe: 0,
      },
      moved: 0,
      movedBytes: 0,
      actionSkipped: 0,
      actionSkippedBytes: 0,
      actionSkippedByReason: {},
      failed: 0,
      failedBytes: 0,
    });
  });
});

test("reports every failed Trash outcome without deleting the source file", async () => {
  await fixture(async (root) => {
    const outcomes: Array<[string, ExecImplementation]> = [
      ["nonzero", async () => ({ code: 1, stdout: "", stderr: "failed", killed: false })],
      ["killed", async () => ({ code: 0, stdout: "", stderr: "", killed: true })],
      ["throw", async () => { throw new Error("trash failed"); }],
      ["source-still-present", async () => ({ code: 0, stdout: "", stderr: "", killed: false })],
    ];

    for (const [name, execImplementation] of outcomes) {
      const file = join(root, `--${name}--.jsonl`);
      await session(file, { mtime: NOW - 3 * 86_400_000 });
      const harness = createHarness(root, undefined, execImplementation);

      await harness.command("1");

      assert.equal(harness.selectCalls, 1, name);
      assert.equal(harness.execCalls.length, 1, name);
      await lstat(file);
      assert.match(harness.messages.join("\n"), /Action-time failures: 1 sessions · .+/, name);
      assert.equal((harness.audits[0] as { failed: number }).failed, 1, name);
      await rm(file, { force: true });
    }
  });
});

test("confirmed all-success batches report summarized source-store sizes, exact audit bytes, and no disk-space claim", async () => {
  await fixture(async (root) => {
    const first = join(root, "first.jsonl");
    const second = join(root, "second.jsonl");
    await session(first, { mtime: NOW - 3 * 86_400_000, padding: 1_000 });
    await session(second, { mtime: NOW - 3 * 86_400_000, padding: 2_000 });
    const expectedBytes = (await lstat(first)).size + (await lstat(second)).size;
    const harness = createHarness(root, undefined, async (_command, args) => {
      await rm(args[0]!, { force: true });
      return { code: 0, stdout: "", stderr: "", killed: false };
    });

    await harness.command("1");

    const report = harness.messages.join("\n");
    assert.match(report, /Moved to Trash: 2 sessions · .+ removed from Pi session storage/);
    assert.match(report, /Eligible: 2 sessions · .+/);
    assert.doesNotMatch(report, new RegExp(`\\(${expectedBytes} B\\)`));
    assert.match(report, /Disk space is reclaimed only when macOS Trash is emptied\./);
    assert.doesNotMatch(report, /disk space (?:was |has been )?freed/i);
    const audit = harness.audits[0] as Record<string, unknown>;
    assert.equal(audit.eligibleBytes, expectedBytes);
    assert.equal(audit.moved, 2);
    assert.equal(audit.movedBytes, expectedBytes);
    assert.equal(audit.actionSkipped, 0);
    assert.equal(audit.actionSkippedBytes, 0);
    assert.equal(audit.failed, 0);
    assert.equal(audit.failedBytes, 0);
  });
});

test("confirmed mixed batches reconcile moved, action-time skipped, and failed audit bytes", async () => {
  await fixture(async (root) => {
    const success = join(root, "success.jsonl");
    const actionSkipped = join(root, "action-skipped.jsonl");
    const failure = join(root, "failure.jsonl");
    for (const path of [success, actionSkipped, failure]) {
      await session(path, { mtime: NOW - 3 * 86_400_000, padding: 100 });
    }
    const bytesPerSession = (await lstat(success)).size;
    let activeReads = 0;
    let trashCalls = 0;
    const harness = createHarness(
      root,
      () => (activeReads++ === 0 ? undefined : actionSkipped),
      async (_command, args) => {
        trashCalls += 1;
        if (trashCalls === 1) return { code: 1, stdout: "", stderr: "failed", killed: false };
        await rm(args[0]!, { force: true });
        return { code: 0, stdout: "", stderr: "", killed: false };
      },
    );

    await harness.command("1");

    const report = harness.messages.join("\n");
    assert.match(report, new RegExp(`Moved to Trash: 1 sessions · ${bytesPerSession} B removed from Pi session storage`));
    assert.match(report, new RegExp(`Action-time skipped: active=1 \\(${bytesPerSession} B\\)`));
    assert.match(report, new RegExp(`Action-time failures: 1 sessions · ${bytesPerSession} B`));
    assert.match(report, new RegExp(`Eligible: 3 sessions · ${bytesPerSession * 3} B`));
    const audit = harness.audits[0] as Record<string, unknown>;
    assert.equal(audit.moved, 1);
    assert.equal(audit.movedBytes, bytesPerSession);
    assert.equal(audit.actionSkipped, 1);
    assert.equal(audit.actionSkippedBytes, bytesPerSession);
    assert.deepEqual(audit.actionSkippedByReason, { active: { count: 1, bytes: bytesPerSession } });
    assert.equal(audit.failed, 1);
    assert.equal(audit.failedBytes, bytesPerSession);
  });
});

function createHarness(
  root: string,
  activeSessionFile?: string | (() => string | undefined),
  execImplementation?: ExecImplementation,
  hasUI = true,
  dependencies: Partial<TrashHistoryDependencies> = {},
  selectImplementation: (options: string[]) => string | undefined | Promise<string | undefined> = (options) => options[1],
  context: { cwd?: () => unknown; sessionManager?: Pick<SessionManager, "getSessionDir" | "getSessionFile"> } = {},
) {
  let commandHandler: ((args: string, ctx: any) => Promise<void>) | undefined;
  const messages: string[] = [];
  const execCalls: Array<[string, string[]]> = [];
  const audits: unknown[] = [];
  const selectionTitles: string[] = [];
  const selectionOptions: string[][] = [];
  let selectCalls = 0;
  let sessionRootCalls = 0;
  const pi = {
    registerCommand(name: string, command: { handler(args: string, ctx: unknown): Promise<void> }) {
      assert.equal(name, "trash-history");
      commandHandler = command.handler as (args: string, ctx: any) => Promise<void>;
    },
    exec: async (command: string, args: string[]) => {
      execCalls.push([command, args]);
      return execImplementation ? execImplementation(command, args) : { code: 0, stdout: "", stderr: "", killed: false };
    },
    appendEntry(_type: string, data: unknown) { audits.push(data); },
  } as Partial<ExtensionAPI> as ExtensionAPI;
  trashHistoryExtension(pi, testDependencies(dependencies));
  return {
    messages,
    execCalls,
    audits,
    selectionTitles,
    selectionOptions,
    get selectCalls() { return selectCalls; },
    get sessionRootCalls() { return sessionRootCalls; },
    async command(args: string) {
      assert.ok(commandHandler);
      await commandHandler(args, {
        hasUI,
        get cwd() { return context.cwd ? context.cwd() : "/workspace"; },
        sessionManager: {
          getSessionDir: () => {
            sessionRootCalls += 1;
            return context.sessionManager ? context.sessionManager.getSessionDir() : root;
          },
          getSessionFile: () => context.sessionManager
            ? context.sessionManager.getSessionFile()
            : typeof activeSessionFile === "function" ? activeSessionFile() : activeSessionFile,
        },
        ui: {
          notify(message: string) { messages.push(message); },
          async confirm() { assert.fail("Trash approval must not use default-Yes confirm"); },
          async select(title: string, options: string[]) {
            selectCalls += 1;
            selectionTitles.push(title);
            selectionOptions.push([...options]);
            assert.deepEqual(execCalls, [], "No archive or Trash work before explicit approval");
            return selectImplementation(options);
          },
        },
      });
    },
  };
}
