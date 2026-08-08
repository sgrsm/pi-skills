import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { access, chmod, link, lstat, mkdir, readdir, readFile, realpath, stat, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

const DAY_MS = 86_400_000;
const MAX_DATE_MS = 8_640_000_000_000_000;
const TRASH_EXECUTABLE = "/usr/bin/trash";
const ARCHIVE_ENV_EXECUTABLE = "/usr/bin/env";
const ZIP_EXECUTABLE = "/usr/bin/zip";
const UNZIP_EXECUTABLE = "/usr/bin/unzip";
const TRASH_TIMEOUT_MS = 30_000;
const ARCHIVE_TIMEOUT_MS = 300_000;
const ARCHIVE_BATCH_SIZE = 100;
const PREVIEW_LIMIT = 8;
const DETAILS_LIMIT = 30;
const AUDIT_ENTRY_TYPE = "trash-history-audit";
const COMMAND_USAGE = "/trash-history <days> [--archive] [--include-named] [--all-projects] [--dry-run] [--details]";
const COMMAND_HELP = [
  "Usage:",
  COMMAND_USAGE,
  "",
  "Arguments:",
  "<days> - sessions last modified more than this many days ago",
  "--archive - save eligible sessions in a verified ZIP before moving them to Trash; default moves them directly to Trash",
  "--include-named - include sessions that have a name",
  "--all-projects - include sessions from every Pi project; default is the current project only",
  "--dry-run - preview only; do not create an archive or move files",
  "--details - show up to 30 metadata-only session rows",
  "",
  "Example: /trash-history 60 --dry-run",
].join("\n");

export type TrashHistoryScope = "current-project" | "all-projects";

export type TrashHistoryArguments = {
  days: number;
  dryRun: boolean;
  includeNamed: boolean;
  allProjects: boolean;
  details: boolean;
  archive: boolean;
};

export type ParseResult = { ok: true; value: TrashHistoryArguments } | { ok: false; error: string };

export type SkipReason =
  | "active"
  | "named"
  | "tooRecent"
  | "symlink"
  | "nonRegular"
  | "hardLink"
  | "malformed"
  | "unreadable"
  | "unsafe"
  | "changed"
  | "projectSymlink"
  | "projectUnreadable"
  | "projectUnsafe";

export type FileIdentity = {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  nlink: number;
};

export type TrashHistoryCandidate = {
  path: string;
  canonicalPath: string;
  identity: FileIdentity;
  named: boolean;
  cwd: string;
};

export type ScanResult = {
  scope: TrashHistoryScope;
  sessionRoot: string;
  candidates: TrashHistoryCandidate[];
  eligibleBytes: number;
  includeNamed: boolean;
  protectedNamed: { count: number; bytes: number };
  includedNamed: { count: number; bytes: number };
  skipped: Record<SkipReason, number>;
  preview: string[];
  fatal?: "rootUnavailable";
};

export type ActionOutcome = { count: number; bytes: number };
export type ActionSkipStats = Record<SkipReason, ActionOutcome>;

export type RevalidationResult =
  | { ok: true; candidate: TrashHistoryCandidate }
  | { ok: false; reason: Exclude<SkipReason, "projectSymlink" | "projectUnreadable" | "projectUnsafe"> };

export type TrashHistoryDependencies = {
  now(): number;
  platform(): NodeJS.Platform;
  accessTrash(path: string): Promise<void>;
  accessArchiveExecutable(path: string): Promise<void>;
  globalSessionRoot(): string;
  archiveDirectory(): string;
};

const DEFAULT_DEPENDENCIES: TrashHistoryDependencies = {
  now: () => Date.now(),
  platform: () => process.platform,
  accessTrash: (path) => access(path, constants.X_OK),
  accessArchiveExecutable: (path) => access(path, constants.X_OK),
  globalSessionRoot: () => join(getAgentDir(), "sessions"),
  archiveDirectory: () => join(homedir(), ".pi", "archives"),
};

function emptySkipCounts(): Record<SkipReason, number> {
  return {
    active: 0,
    named: 0,
    tooRecent: 0,
    symlink: 0,
    nonRegular: 0,
    hardLink: 0,
    malformed: 0,
    unreadable: 0,
    unsafe: 0,
    changed: 0,
    projectSymlink: 0,
    projectUnreadable: 0,
    projectUnsafe: 0,
  };
}

function emptyActionSkipStats(): ActionSkipStats {
  return Object.fromEntries(
    Object.keys(emptySkipCounts()).map((reason) => [reason, { count: 0, bytes: 0 }]),
  ) as ActionSkipStats;
}

function recordActionSkip(skipped: ActionSkipStats, reason: SkipReason, bytes: number): void {
  skipped[reason].count += 1;
  skipped[reason].bytes += bytes;
}

function actionSkipTotals(skipped: ActionSkipStats): ActionOutcome {
  return Object.values(skipped).reduce(
    (total, outcome) => ({ count: total.count + outcome.count, bytes: total.bytes + outcome.bytes }),
    { count: 0, bytes: 0 },
  );
}

function compactActionSkipStats(skipped: ActionSkipStats): Record<string, ActionOutcome> {
  return Object.fromEntries(Object.entries(skipped).filter(([, outcome]) => outcome.count > 0));
}

/** Parses `/trash-history <days> [--archive] [--include-named] [--all-projects] [--dry-run] [--details]` without accepting aliases. */
export function parseTrashHistoryArguments(args: string): ParseResult {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { ok: false, error: "missing <days>" };
  if (!/^(?:0|[1-9]\d*)$/.test(tokens[0]!)) return { ok: false, error: "<days> must be a non-negative base-10 integer" };

  const days = Number(tokens[0]);
  if (!Number.isSafeInteger(days) || days > Math.floor(Number.MAX_SAFE_INTEGER / DAY_MS)) {
    return { ok: false, error: "<days> is outside the supported date range" };
  }

  let dryRun = false;
  let includeNamed = false;
  let allProjects = false;
  let details = false;
  let archive = false;
  for (const token of tokens.slice(1)) {
    if (token === "--dry-run") {
      if (dryRun) return { ok: false, error: "duplicate --dry-run" };
      dryRun = true;
      continue;
    }
    if (token === "--include-named") {
      if (includeNamed) return { ok: false, error: "duplicate --include-named" };
      includeNamed = true;
      continue;
    }
    if (token === "--all-projects") {
      if (allProjects) return { ok: false, error: "duplicate --all-projects" };
      allProjects = true;
      continue;
    }
    if (token === "--details") {
      if (details) return { ok: false, error: "duplicate --details" };
      details = true;
      continue;
    }
    if (token === "--archive") {
      if (archive) return { ok: false, error: "duplicate --archive" };
      archive = true;
      continue;
    }
    return { ok: false, error: token.startsWith("--") ? `unknown flag ${token}` : `unexpected positional token ${token}` };
  }
  return { ok: true, value: { days, dryRun, includeNamed, allProjects, details, archive } };
}

function identityOf(file: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number; nlink: number }): FileIdentity {
  return {
    dev: file.dev,
    ino: file.ino,
    size: file.size,
    mtimeMs: file.mtimeMs,
    ctimeMs: file.ctimeMs,
    nlink: file.nlink,
  };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.nlink === right.nlink;
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

function isJsonlFile(name: string): boolean {
  return name.endsWith(".jsonl");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Accepts legacy headers without `version` and current headers with all documented identity fields. */
function isPiSessionHeader(entry: Record<string, unknown>): boolean {
  return entry.type === "session"
    && typeof entry.id === "string"
    && entry.id.length > 0
    && typeof entry.timestamp === "string"
    && Number.isFinite(Date.parse(entry.timestamp))
    && typeof entry.cwd === "string"
    && (entry.version === undefined || (typeof entry.version === "number" && Number.isInteger(entry.version) && entry.version >= 1));
}

/** Returns only validated session-header and name metadata; it deliberately never retains session content. */
async function readSessionMetadata(path: string): Promise<{ ok: true; named: boolean; cwd: string } | { ok: false; reason: "malformed" | "unreadable" }> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return { ok: false, reason: "unreadable" };
  }

  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0 || lines.some((line) => line.length === 0)) return { ok: false, reason: "malformed" };

  let latestSessionInfoName: string | undefined;
  let cwd: string;
  try {
    const header: unknown = JSON.parse(lines[0]!);
    if (!isRecord(header) || !isPiSessionHeader(header)) return { ok: false, reason: "malformed" };
    const headerCwd = header.cwd;
    if (typeof headerCwd !== "string") return { ok: false, reason: "malformed" };
    cwd = headerCwd;

    for (const line of lines.slice(1)) {
      const entry: unknown = JSON.parse(line);
      if (!isRecord(entry)) return { ok: false, reason: "malformed" };
      if (entry.type === "session_info") {
        if (entry.name !== undefined && typeof entry.name !== "string") return { ok: false, reason: "malformed" };
        latestSessionInfoName = entry.name;
      }
    }
  } catch {
    return { ok: false, reason: "malformed" };
  }
  return { ok: true, named: latestSessionInfoName !== undefined && latestSessionInfoName.trim().length !== 0, cwd: cwd! };
}

async function activeMatches(candidatePath: string, candidateCanonicalPath: string, candidateIdentity: FileIdentity, activeSessionFile?: string): Promise<boolean> {
  if (!activeSessionFile) return false;
  try {
    const [activeCanonicalPath, activeStat] = await Promise.all([realpath(activeSessionFile), stat(activeSessionFile)]);
    return activeCanonicalPath === candidateCanonicalPath
      || (activeStat.dev === candidateIdentity.dev && activeStat.ino === candidateIdentity.ino);
  } catch {
    // A disappearing active alias cannot make this candidate safe to act on. The caller's
    // normal current-path comparison still protects stable paths; no identity match is possible.
    return activeSessionFile === candidatePath;
  }
}

type InspectCandidateResult =
  | { ok: true; candidate: TrashHistoryCandidate }
  | {
    ok: false;
    reason: Exclude<SkipReason, "projectSymlink" | "projectUnreadable" | "projectUnsafe" | "changed">;
    protectedNamedBytes?: number;
  };

async function inspectCandidate(options: {
  path: string;
  root: string;
  cutoffMs: number;
  includeNamed: boolean;
  activeSessionFile?: string;
}): Promise<InspectCandidateResult> {
  let file;
  try {
    file = await lstat(options.path);
  } catch {
    return { ok: false, reason: "unsafe" };
  }
  if (file.isSymbolicLink()) return { ok: false, reason: "symlink" };
  if (!file.isFile()) return { ok: false, reason: "nonRegular" };

  let canonicalPath: string;
  try {
    canonicalPath = await realpath(options.path);
  } catch {
    return { ok: false, reason: "unsafe" };
  }
  if (!isInside(options.root, canonicalPath)) return { ok: false, reason: "unsafe" };

  const identity = identityOf(file);
  if (await activeMatches(options.path, canonicalPath, identity, options.activeSessionFile)) return { ok: false, reason: "active" };
  if (file.nlink !== 1) return { ok: false, reason: "hardLink" };

  const metadata = await readSessionMetadata(options.path);
  if (!metadata.ok) return metadata;
  if (!(file.mtimeMs < options.cutoffMs)) return { ok: false, reason: "tooRecent" };
  if (metadata.named && !options.includeNamed) return { ok: false, reason: "named", protectedNamedBytes: identity.size };

  return {
    ok: true,
    candidate: { path: options.path, canonicalPath, identity, named: metadata.named, cwd: metadata.cwd },
  };
}

function appendPreview(report: ScanResult, reason: string, _path: string): void {
  if (report.preview.length >= PREVIEW_LIMIT) return;
  report.preview.push(reason);
}

function recordSkip(report: ScanResult, reason: SkipReason, path: string): void {
  report.skipped[reason] += 1;
  appendPreview(report, reason, path);
}

/**
 * Takes an immutable scan snapshot. Current-project scans examine only JSONL files
 * directly in the session root. All-projects scans additionally examine JSONL files
 * directly in each root child directory; neither mode recurses further.
 */
export async function scanTrashHistory(options: {
  scope: TrashHistoryScope;
  sessionRoot: string;
  activeSessionFile?: string;
  cutoffMs: number;
  includeNamed: boolean;
}): Promise<ScanResult> {
  const report: ScanResult = {
    scope: options.scope,
    sessionRoot: options.sessionRoot,
    candidates: [],
    eligibleBytes: 0,
    includeNamed: options.includeNamed,
    protectedNamed: { count: 0, bytes: 0 },
    includedNamed: { count: 0, bytes: 0 },
    skipped: emptySkipCounts(),
    preview: [],
  };

  let root: string;
  try {
    root = await realpath(options.sessionRoot);
    const rootStat = await lstat(root);
    if (!rootStat.isDirectory()) throw new Error("not a directory");
    report.sessionRoot = root;
  } catch {
    report.fatal = "rootUnavailable";
    return report;
  }

  let rootEntries;
  try {
    rootEntries = await readdir(root, { withFileTypes: true });
  } catch {
    report.fatal = "rootUnavailable";
    return report;
  }

  async function consider(path: string): Promise<void> {
    const result = await inspectCandidate({ ...options, root, path });
    if (!result.ok) {
      recordSkip(report, result.reason, path);
      if (result.reason === "named") {
        report.protectedNamed.count += 1;
        report.protectedNamed.bytes += result.protectedNamedBytes ?? 0;
      }
      return;
    }
    report.candidates.push(result.candidate);
    report.eligibleBytes += result.candidate.identity.size;
    if (result.candidate.named) {
      report.includedNamed.count += 1;
      report.includedNamed.bytes += result.candidate.identity.size;
    }
  }

  for (const rootEntry of rootEntries) {
    const entryPath = join(root, rootEntry.name);
    if (isJsonlFile(rootEntry.name)) {
      await consider(entryPath);
      continue;
    }
    if (options.scope === "current-project") continue;

    let directory;
    try {
      directory = await lstat(entryPath);
    } catch {
      recordSkip(report, "projectUnsafe", entryPath);
      continue;
    }
    if (directory.isSymbolicLink()) {
      recordSkip(report, "projectSymlink", entryPath);
      continue;
    }
    if (!directory.isDirectory()) continue;

    let projectPath: string;
    try {
      projectPath = await realpath(entryPath);
      if (!isInside(root, projectPath)) throw new Error("outside root");
    } catch {
      recordSkip(report, "projectUnsafe", entryPath);
      continue;
    }

    let projectEntries;
    try {
      projectEntries = await readdir(projectPath, { withFileTypes: true });
    } catch {
      recordSkip(report, "projectUnreadable", entryPath);
      continue;
    }
    for (const projectEntry of projectEntries) {
      if (isJsonlFile(projectEntry.name)) await consider(join(projectPath, projectEntry.name));
    }
  }
  return report;
}

/**
 * Re-checks a snapshot candidate immediately before action and rejects observable drift.
 * Without a Pi-wide cross-process lock, it cannot detect changes after this check and before Trash acts.
 */
export async function revalidateCandidate(
  snapshot: TrashHistoryCandidate,
  options: { sessionRoot: string; activeSessionFile?: string; cutoffMs: number; includeNamed: boolean },
): Promise<RevalidationResult> {
  let root: string;
  try {
    root = await realpath(options.sessionRoot);
  } catch {
    return { ok: false, reason: "unsafe" };
  }
  // Compare snapshot identity before cutoff/name decisions so a modification is
  // always reported as drift rather than being mistaken for a merely recent file.
  try {
    const current = await lstat(snapshot.path);
    if (current.isFile() && !sameIdentity(identityOf(current), snapshot.identity)) return { ok: false, reason: "changed" };
  } catch {
    return { ok: false, reason: "unsafe" };
  }
  const result = await inspectCandidate({ ...options, root, path: snapshot.path });
  if (!result.ok) return result;
  if (result.candidate.canonicalPath !== snapshot.canonicalPath || !sameIdentity(result.candidate.identity, snapshot.identity)) {
    return { ok: false, reason: "changed" };
  }
  return result;
}

export type ArchiveResult =
  | { ok: true; path: string; sessions: number; archiveBytes: number }
  | { ok: false; message: string };

function archiveDateTimePrefix(now: number): string {
  return `${new Date(now).toISOString().slice(0, 16).replace(":", "-")}Z`;
}

export function archiveFileName(candidates: TrashHistoryCandidate[], now: number): string {
  if (candidates.length === 0) throw new Error("cannot name an empty archive");
  const mtimeMs = candidates.map((candidate) => candidate.identity.mtimeMs);
  return `${archiveDateTimePrefix(now)}-sessions-${dateOnly(Math.min(...mtimeMs))}_${dateOnly(Math.max(...mtimeMs))}.zip`;
}

function archivePlanPath(archiveDirectory: string, candidates: TrashHistoryCandidate[], now: number): string {
  if (!isAbsolute(archiveDirectory)) throw new Error("archive directory must be absolute");
  return join(archiveDirectory, archiveFileName(candidates, now));
}

async function prepareArchiveDirectory(path: string): Promise<string | undefined> {
  if (!isAbsolute(path)) return undefined;
  try {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const directory = await lstat(path);
    if (directory.isSymbolicLink() || !directory.isDirectory()) return undefined;
    await chmod(path, 0o700);
    return await realpath(path);
  } catch {
    return undefined;
  }
}

function archiveEntryPaths(sessionRoot: string, candidates: TrashHistoryCandidate[]): string[] | undefined {
  const entries: string[] = [];
  for (const candidate of candidates) {
    if (!isInside(sessionRoot, candidate.canonicalPath)) return undefined;
    const entry = relative(sessionRoot, candidate.canonicalPath);
    if (entry.length === 0 || isAbsolute(entry) || entry.startsWith("..")) return undefined;
    entries.push(entry);
  }
  return entries;
}

function batches<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function zipEntryCount(output: string): number | undefined {
  const match = /number of entries:\s*(\d+)/i.exec(output);
  if (!match) return undefined;
  const count = Number(match[1]);
  return Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}

async function sourceStillMatchesArchivedSnapshot(snapshot: TrashHistoryCandidate, sessionRoot: string): Promise<boolean> {
  try {
    const [file, canonicalPath] = await Promise.all([lstat(snapshot.path), realpath(snapshot.path)]);
    return !file.isSymbolicLink()
      && file.isFile()
      && file.nlink === 1
      && canonicalPath === snapshot.canonicalPath
      && isInside(sessionRoot, canonicalPath)
      && sameIdentity(identityOf(file), snapshot.identity);
  } catch {
    return false;
  }
}

/** Creates one root-relative ZIP and proves its CRC-valid entry count before any Trash action. */
async function createVerifiedArchive(
  pi: ExtensionAPI,
  candidates: TrashHistoryCandidate[],
  sessionRoot: string,
  archiveDirectory: string,
  now: number,
): Promise<ArchiveResult> {
  const preparedDirectory = await prepareArchiveDirectory(archiveDirectory);
  if (!preparedDirectory) return { ok: false, message: "Archive directory is unavailable; no sessions were moved to Trash." };

  const entries = archiveEntryPaths(sessionRoot, candidates);
  if (!entries) return { ok: false, message: "Archive source paths could not be safely prepared; no sessions were moved to Trash." };

  const archivePath = join(preparedDirectory, archiveFileName(candidates, now));
  const partialPath = `${archivePath}.partial-${randomUUID()}`;

  for (const batch of batches(entries, ARCHIVE_BATCH_SIZE)) {
    let result;
    try {
      result = await pi.exec(
        ARCHIVE_ENV_EXECUTABLE,
        ["-C", sessionRoot, ZIP_EXECUTABLE, "-q", partialPath, "--", ...batch],
        { timeout: ARCHIVE_TIMEOUT_MS },
      );
    } catch {
      return { ok: false, message: "Archive creation failed; no sessions were moved to Trash." };
    }
    if (result.code !== 0 || result.killed) {
      return { ok: false, message: "Archive creation failed; no sessions were moved to Trash." };
    }
  }

  let archiveStats;
  try {
    archiveStats = await lstat(partialPath);
    if (archiveStats.isSymbolicLink() || !archiveStats.isFile() || archiveStats.nlink !== 1) {
      return { ok: false, message: "Archive verification found an invalid ZIP; no sessions were moved to Trash." };
    }
    await chmod(partialPath, 0o600);
  } catch {
    return { ok: false, message: "Archive verification found an invalid ZIP; no sessions were moved to Trash." };
  }

  let integrity;
  let summary;
  try {
    [integrity, summary] = await Promise.all([
      pi.exec(UNZIP_EXECUTABLE, ["-tqq", partialPath], { timeout: ARCHIVE_TIMEOUT_MS }),
      pi.exec(UNZIP_EXECUTABLE, ["-Z", "-h", partialPath], { timeout: ARCHIVE_TIMEOUT_MS }),
    ]);
  } catch {
    return { ok: false, message: "Archive verification failed; no sessions were moved to Trash." };
  }
  if (integrity.code !== 0 || integrity.killed || summary.code !== 0 || summary.killed) {
    return { ok: false, message: "Archive verification failed; no sessions were moved to Trash." };
  }
  if (zipEntryCount(summary.stdout) !== candidates.length) {
    return { ok: false, message: "Archive verification found an incomplete ZIP; no sessions were moved to Trash." };
  }
  for (const candidate of candidates) {
    if (!(await sourceStillMatchesArchivedSnapshot(candidate, sessionRoot))) {
      return { ok: false, message: "Archive verification could not confirm unchanged source sessions; no sessions were moved to Trash." };
    }
  }

  try {
    await link(partialPath, archivePath);
  } catch {
    return { ok: false, message: "Archive finalization failed; no sessions were moved to Trash." };
  }
  try {
    await unlink(partialPath);
  } catch {
    // The final hard link is already durable and verified; a leftover temp alias is harmless.
  }
  return { ok: true, path: archivePath, sessions: candidates.length, archiveBytes: archiveStats.size };
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 ** 2) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / (1_024 ** 2)).toFixed(1)} MiB`;
}

function formatDisplayBytes(bytes: number): string {
  return formatBytes(bytes);
}

function nonzeroSkipped(skipped: Record<SkipReason, number>): string {
  const parts = Object.entries(skipped).filter(([, count]) => count > 0).map(([reason, count]) => `${reason}=${count}`);
  return parts.length === 0 ? "none" : parts.join(", ");
}

function formatActionSkipped(skipped: ActionSkipStats): string {
  const parts = Object.entries(skipped)
    .filter(([, outcome]) => outcome.count > 0)
    .map(([reason, outcome]) => `${reason}=${outcome.count} (${formatDisplayBytes(outcome.bytes)})`);
  const total = actionSkipTotals(skipped);
  return parts.length === 0
    ? `none (${total.count} sessions · ${formatDisplayBytes(total.bytes)})`
    : parts.join(", ");
}

function formatNamedSessionPolicy(scan: ScanResult): string {
  return scan.includeNamed
    ? `Named sessions included: ${scan.includedNamed.count} (${formatDisplayBytes(scan.includedNamed.bytes)})`
    : `Named sessions protected: ${scan.protectedNamed.count} (${formatDisplayBytes(scan.protectedNamed.bytes)})`;
}

export function shortenCwd(cwd: string, homeDir: string = homedir()): string {
  if (cwd.length === 0) return "(no cwd)";
  const home = homeDir.length > 1 ? homeDir.replace(/\/+$/, "") : homeDir;
  const relativeToHome = cwd === home ? "~" : cwd.startsWith(`${home}/`) ? `~/${cwd.slice(home.length + 1)}` : cwd;
  return relativeToHome.length <= 72
    ? relativeToHome
    : `${relativeToHome.slice(0, 34)}…${relativeToHome.slice(-34)}`;
}

function displayArchivePath(path: string, homeDir: string = homedir()): string {
  const home = homeDir.length > 1 ? homeDir.replace(/\/+$/, "") : homeDir;
  return path === home ? "~" : path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}

type ProjectGroup = { cwd: string; count: number; bytes: number };

function projectGroups(candidates: TrashHistoryCandidate[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const candidate of candidates) {
    const current = groups.get(candidate.cwd);
    if (current) {
      current.count += 1;
      current.bytes += candidate.identity.size;
    } else {
      groups.set(candidate.cwd, {
        cwd: candidate.cwd,
        count: 1,
        bytes: candidate.identity.size,
      });
    }
  }
  return [...groups.values()].sort((left, right) => right.bytes - left.bytes || left.cwd.localeCompare(right.cwd));
}

function dateOnly(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

function formatProjectGroups(candidates: TrashHistoryCandidate[], homeDir: string): string[] {
  const groups = projectGroups(candidates);
  const sessionWidth = Math.max("Sessions".length, ...groups.map((group) => String(group.count).length));
  const sizeWidth = Math.max("Size".length, ...groups.map((group) => formatBytes(group.bytes).length));
  return [
    "Eligible by project:",
    `  ${"Sessions".padStart(sessionWidth)} | ${"Size".padStart(sizeWidth)} | Project`,
    ...groups.map((group) => `- ${String(group.count).padStart(sessionWidth)} | ${formatBytes(group.bytes).padStart(sizeWidth)} | ${shortenCwd(group.cwd, homeDir)}`),
  ];
}

function formatDetails(candidates: TrashHistoryCandidate[], homeDir: string): string[] {
  const details = [...candidates]
    .sort((left, right) => right.identity.size - left.identity.size || left.cwd.localeCompare(right.cwd))
    .slice(0, DETAILS_LIMIT);
  const omitted = candidates.length - details.length;
  return [
    "Session details (largest 30):",
    ...details.map((candidate) => `- ${dateOnly(candidate.identity.mtimeMs)} · ${formatBytes(candidate.identity.size)} · ${shortenCwd(candidate.cwd, homeDir)}`),
    ...(omitted > 0 ? [`${omitted} additional eligible sessions omitted; showing largest 30.`] : []),
  ];
}

export function formatScanReport(
  scan: ScanResult,
  cutoffMs: number,
  title: string,
  options: { details?: boolean; homeDir?: string; archivePath?: string } = {},
): string {
  const homeDir = options.homeDir ?? homedir();
  return [
    ...(title ? [title] : []),
    `Scope: ${scan.scope}`,
    `Cutoff: ${new Date(cutoffMs).toISOString()}`,
    `Eligible: ${scan.candidates.length} sessions · ${formatDisplayBytes(scan.eligibleBytes)}`,
    formatNamedSessionPolicy(scan),
    `Skipped: ${nonzeroSkipped(scan.skipped)}`,
    ...(options.archivePath ? [`Archive before Trash: ${displayArchivePath(options.archivePath, homeDir)}`] : []),
    ...formatProjectGroups(scan.candidates, homeDir),
    ...(options.details ? formatDetails(scan.candidates, homeDir) : []),
  ].join("\n");
}

function output(ctx: ExtensionCommandContext, message: string, type: "info" | "warning" | "error" = "info"): void {
  if (ctx.hasUI) ctx.ui.notify(message, type);
  else console.log(message);
}

async function sourcePathIsGone(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch (error: unknown) {
    return isErrno(error, "ENOENT");
  }
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

function appendAudit(pi: ExtensionAPI, data: Record<string, unknown>): void {
  try {
    pi.appendEntry(AUDIT_ENTRY_TYPE, data);
  } catch {
    // Auditing is supplementary; it must not affect recovery-first filesystem handling.
  }
}

export function registerTrashHistoryExtension(pi: ExtensionAPI, dependencies: TrashHistoryDependencies = DEFAULT_DEPENDENCIES): void {
  pi.registerCommand("trash-history", {
    description: "Preview and move old Pi session files to macOS Trash (current project by default)",
    handler: async (args, ctx) => {
      if (args.trim().length === 0) {
        output(ctx, COMMAND_HELP, "info");
        return;
      }
      const parsed = parseTrashHistoryArguments(args);
      if (!parsed.ok) {
        output(ctx, `Usage: ${COMMAND_USAGE} (${parsed.error})`, "warning");
        return;
      }
      const request = parsed.value;
      if (dependencies.platform() !== "darwin") {
        output(ctx, "trash-history is macOS-only; no files were scanned or changed.", "error");
        return;
      }
      const now = dependencies.now();
      const cutoffMs = now - request.days * DAY_MS;
      if (!Number.isFinite(cutoffMs) || cutoffMs < -MAX_DATE_MS || cutoffMs > MAX_DATE_MS) {
        output(ctx, "The requested cutoff is outside the supported date range; no files were scanned or changed.", "error");
        return;
      }

      const scope: TrashHistoryScope = request.allProjects ? "all-projects" : "current-project";
      const sessionManager = ctx.sessionManager as { getSessionDir?: () => string; getSessionFile?: () => string | undefined } | undefined;
      let sessionRoot: string | undefined;
      try {
        sessionRoot = scope === "all-projects"
          ? dependencies.globalSessionRoot()
          : sessionManager?.getSessionDir?.();
      } catch {
        sessionRoot = undefined;
      }
      if (!sessionRoot) {
        output(ctx, `Could not determine Pi's ${scope} session root; no files were changed.`, "error");
        return;
      }
      const readActiveSessionFile = (): { ok: true; value: string | undefined } | { ok: false } => {
        try {
          return { ok: true, value: sessionManager?.getSessionFile?.() };
        } catch {
          return { ok: false };
        }
      };
      const initialActiveSessionFile = readActiveSessionFile();
      if (!initialActiveSessionFile.ok) {
        output(ctx, "Could not safely identify the active session; no files were changed.", "error");
        return;
      }
      const scan = await scanTrashHistory({ scope, sessionRoot, activeSessionFile: initialActiveSessionFile.value, cutoffMs, includeNamed: request.includeNamed });
      if (scan.fatal) {
        output(ctx, `Could not safely read Pi's ${scope} session root; no files were changed.`, "error");
        return;
      }
      const audit = (data: Record<string, unknown>): void => appendAudit(pi, {
        days: request.days,
        cutoffMs,
        scope,
        ...data,
      });
      const auditSnapshot = (data: Record<string, unknown>): void => audit({
        eligible: scan.candidates.length,
        eligibleBytes: scan.eligibleBytes,
        protectedNamed: scan.protectedNamed.count,
        protectedNamedBytes: scan.protectedNamed.bytes,
        includedNamed: scan.includedNamed.count,
        includedNamedBytes: scan.includedNamed.bytes,
        skipped: scan.skipped,
        moved: 0,
        movedBytes: 0,
        actionSkipped: 0,
        actionSkippedBytes: 0,
        actionSkippedByReason: {},
        failed: 0,
        failedBytes: 0,
        ...data,
      });

      let archiveDirectory: string | undefined;
      let plannedArchivePath: string | undefined;
      if (request.archive && scan.candidates.length > 0) {
        try {
          archiveDirectory = dependencies.archiveDirectory();
          plannedArchivePath = archivePlanPath(archiveDirectory, scan.candidates, now);
        } catch {
          output(ctx, "Could not determine a safe archive destination; no files were moved.", "error");
          auditSnapshot({ dryRun: request.dryRun, archive: { requested: true, status: "failed" } });
          return;
        }
      }

      const reportOptions = { details: request.details, archivePath: plannedArchivePath };
      const previewTitle = request.dryRun ? "Trash-history dry run (no files will move)" : "Trash-history preview (no files moved yet)";
      output(ctx, formatScanReport(scan, cutoffMs, previewTitle, reportOptions));
      if (request.dryRun) {
        auditSnapshot({
          dryRun: true,
          ...(request.archive ? { archive: { requested: true, status: "dry-run", ...(plannedArchivePath ? { path: plannedArchivePath } : {}) } } : {}),
        });
        return;
      }
      if (!ctx.hasUI) {
        output(ctx, "Refusing to move files because this Pi mode has no interactive UI. Re-run with --dry-run for a report.", "error");
        auditSnapshot({
          dryRun: false,
          noUi: true,
          ...(request.archive ? { archive: { requested: true, status: "not-run" } } : {}),
        });
        return;
      }
      try {
        await dependencies.accessTrash(TRASH_EXECUTABLE);
      } catch {
        output(ctx, "Trash is unavailable at /usr/bin/trash; no files were moved.", "error");
        auditSnapshot({
          dryRun: false,
          trashUnavailable: true,
          ...(request.archive ? { archive: { requested: true, status: "not-run" } } : {}),
        });
        return;
      }
      if (scan.candidates.length === 0) {
        auditSnapshot({
          dryRun: false,
          ...(request.archive ? { archive: { requested: true, status: "not-needed" } } : {}),
        });
        return;
      }
      if (request.archive) {
        try {
          await Promise.all([
            dependencies.accessArchiveExecutable(ARCHIVE_ENV_EXECUTABLE),
            dependencies.accessArchiveExecutable(ZIP_EXECUTABLE),
            dependencies.accessArchiveExecutable(UNZIP_EXECUTABLE),
          ]);
        } catch {
          output(ctx, "Archive tools are unavailable; no sessions were moved to Trash.", "error");
          auditSnapshot({ dryRun: false, archive: { requested: true, status: "failed" } });
          return;
        }
      }

      const confirmed = await ctx.ui.confirm(
        "Trash eligible Pi sessions?",
        `${formatScanReport(scan, cutoffMs, "", reportOptions)}\n\n${request.archive ? "This first creates and verifies one ZIP archive, then moves only archived eligible sessions to macOS Trash." : "This moves only the summarized eligible session files to macOS Trash."} Continue?`,
      );
      if (!confirmed) {
        output(ctx, "Trash-history cancelled; no files were moved.", "warning");
        auditSnapshot({
          dryRun: false,
          cancelled: true,
          ...(request.archive ? { archive: { requested: true, status: "cancelled" } } : {}),
        });
        return;
      }

      let moved = 0;
      let movedBytes = 0;
      let failed = 0;
      let failedBytes = 0;
      const actionSkipped = emptyActionSkipStats();
      let candidatesForTrash = scan.candidates;
      let completedArchive: Extract<ArchiveResult, { ok: true }> | undefined;

      if (request.archive) {
        const archiveCandidates: TrashHistoryCandidate[] = [];
        for (const snapshot of scan.candidates) {
          const snapshotBytes = snapshot.identity.size;
          const activeSessionFile = readActiveSessionFile();
          if (!activeSessionFile.ok) {
            recordActionSkip(actionSkipped, "unsafe", snapshotBytes);
            continue;
          }
          const revalidated = await revalidateCandidate(snapshot, {
            sessionRoot: scan.sessionRoot,
            activeSessionFile: activeSessionFile.value,
            cutoffMs,
            includeNamed: request.includeNamed,
          });
          if (!revalidated.ok) {
            recordActionSkip(actionSkipped, revalidated.reason, snapshotBytes);
            continue;
          }
          archiveCandidates.push(revalidated.candidate);
        }
        candidatesForTrash = archiveCandidates;

        if (archiveCandidates.length > 0) {
          const archive = await createVerifiedArchive(pi, archiveCandidates, scan.sessionRoot, archiveDirectory!, now);
          if (!archive.ok) {
            const actionSkippedTotals = actionSkipTotals(actionSkipped);
            output(ctx, archive.message, "error");
            auditSnapshot({
              dryRun: false,
              actionSkipped: actionSkippedTotals.count,
              actionSkippedBytes: actionSkippedTotals.bytes,
              actionSkippedByReason: compactActionSkipStats(actionSkipped),
              archive: { requested: true, status: "failed" },
            });
            return;
          }
          completedArchive = archive;
        }
      }

      for (const snapshot of candidatesForTrash) {
        const snapshotBytes = snapshot.identity.size;
        const activeSessionFile = readActiveSessionFile();
        if (!activeSessionFile.ok) {
          recordActionSkip(actionSkipped, "unsafe", snapshotBytes);
          continue;
        }
        const revalidated = await revalidateCandidate(snapshot, {
          sessionRoot: scan.sessionRoot,
          activeSessionFile: activeSessionFile.value,
          cutoffMs,
          includeNamed: request.includeNamed,
        });
        if (!revalidated.ok) {
          recordActionSkip(actionSkipped, revalidated.reason, snapshotBytes);
          continue;
        }
        try {
          const result = await pi.exec(TRASH_EXECUTABLE, [revalidated.candidate.canonicalPath], { timeout: TRASH_TIMEOUT_MS });
          if (result.code !== 0 || result.killed || !(await sourcePathIsGone(snapshot.path))) {
            failed += 1;
            failedBytes += snapshotBytes;
            continue;
          }
          moved += 1;
          movedBytes += snapshotBytes;
        } catch {
          failed += 1;
          failedBytes += snapshotBytes;
        }
      }

      const actionSkippedTotals = actionSkipTotals(actionSkipped);
      const archiveLine = completedArchive
        ? `Archive: ${displayArchivePath(completedArchive.path)} · ${completedArchive.sessions} sessions · ${formatDisplayBytes(completedArchive.archiveBytes)} ZIP verified before Trash`
        : request.archive
          ? "Archive: not created because no candidate remained eligible at action time."
          : undefined;
      const finalReport = [
        "Trash-history complete",
        `Scope: ${scope}`,
        `Cutoff: ${new Date(cutoffMs).toISOString()}`,
        ...(archiveLine ? [archiveLine] : []),
        `Moved to Trash: ${moved} sessions · ${formatDisplayBytes(movedBytes)} removed from Pi session storage`,
        `Action-time skipped: ${formatActionSkipped(actionSkipped)}`,
        `Action-time failures: ${failed} sessions · ${formatDisplayBytes(failedBytes)}`,
        `Eligible: ${scan.candidates.length} sessions · ${formatDisplayBytes(scan.eligibleBytes)}`,
        formatNamedSessionPolicy(scan),
        "Disk space is reclaimed only when macOS Trash is emptied.",
      ].join("\n");
      output(ctx, finalReport, failed > 0 ? "warning" : "info");
      auditSnapshot({
        dryRun: false,
        moved,
        movedBytes,
        actionSkipped: actionSkippedTotals.count,
        actionSkippedBytes: actionSkippedTotals.bytes,
        actionSkippedByReason: compactActionSkipStats(actionSkipped),
        failed,
        failedBytes,
        ...(request.archive
          ? { archive: completedArchive
            ? { requested: true, status: "complete", sessions: completedArchive.sessions, path: completedArchive.path }
            : { requested: true, status: "not-created" } }
          : {}),
      });
    },
  });
}

export default function trashHistoryExtension(pi: ExtensionAPI, dependencies?: TrashHistoryDependencies): void {
  registerTrashHistoryExtension(pi, dependencies);
}
