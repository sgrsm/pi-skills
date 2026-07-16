import { lstat, chmod, mkdir, mkdtemp, open, realpath, rename, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const APPROVAL_SENTINEL = ".step1-test-root-ready";
const TEST_ROOT_PREFIX = "permissions-test-";
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

type PinnedDirectoryIdentity = { dev: number | bigint; ino: number | bigint };

export interface TestScratchFixture {
	approvedRoot: string;
	root: string;
	fakeHome: string;
	project: string;
	protectedDir: string;
	sessionTemp: string;
	assertMutationTarget(pathValue: string): Promise<string>;
	mkdir(pathValue: string): Promise<void>;
	writeFile(pathValue: string, contents: string): Promise<void>;
	symlink(targetPath: string, linkPath: string): Promise<void>;
	rename(sourcePath: string, destinationPath: string): Promise<void>;
	pinDirectoryCleanup(pathValue: string): Promise<() => Promise<void>>;
	withGeneratedRootReplacementForTest(
		fn: (replacement: { sentinelPath: string }) => Promise<void>,
	): Promise<void>;
	cleanup(): Promise<void>;
}

export function getApprovedTestScratchRoot(env: NodeJS.ProcessEnv = process.env): string {
	const configured = env.PI_PERMISSIONS_TEST_SCRATCH_ROOT?.trim();
	if (!configured) {
		throw new Error("PI_PERMISSIONS_TEST_SCRATCH_ROOT must name an explicitly approved test scratch root");
	}
	if (!isAbsolute(configured)) {
		throw new Error("PI_PERMISSIONS_TEST_SCRATCH_ROOT must be absolute");
	}
	return normalizePath(configured);
}

export function protectedPathsOverlapApprovedRoot(
	approvedRoot: string,
	protectedPaths: readonly string[],
	filesystemRoot = "/",
): boolean {
	const candidate = normalizePath(resolve(approvedRoot));
	const canonicalFilesystemRoot = normalizePath(resolve(filesystemRoot));
	for (const pathValue of protectedPaths) {
		const protectedPath = normalizePath(resolve(pathValue));
		if (protectedPath === canonicalFilesystemRoot) {
			if (candidate === canonicalFilesystemRoot) return true;
			continue;
		}
		if (isInsideOrEqual(candidate, protectedPath) || isInsideOrEqual(protectedPath, candidate)) return true;
	}
	return false;
}

export async function createTestScratchFixture(env: NodeJS.ProcessEnv = process.env): Promise<TestScratchFixture> {
	const approvedRoot = getApprovedTestScratchRoot(env);
	const approved = await inspectRealDirectory(approvedRoot, "approved test scratch root");
	await assertApprovedRootSafety(approvedRoot, approved);

	const sentinel = join(approvedRoot, APPROVAL_SENTINEL);
	const sentinelStat = await lstat(sentinel);
	if (!sentinelStat.isFile() || sentinelStat.isSymbolicLink()) {
		throw new Error(`Approved test scratch sentinel is missing or unsafe: ${sentinel}`);
	}
	assertCurrentUserOwnership(sentinelStat, sentinel, "approved test scratch sentinel");

	const approvedIdentity = pinIdentity(approved.stat);
	await assertPinnedApprovedRoot(approvedRoot, approved.canonicalPath, approvedIdentity, "before fixture creation");
	const root = await mkdtemp(join(approvedRoot, TEST_ROOT_PREFIX));
	await assertPinnedApprovedRoot(approvedRoot, approved.canonicalPath, approvedIdentity, "after fixture creation");
	let cleaned = false;
	let pinnedGeneratedRoot: PinnedDirectoryIdentity | undefined;
	let canonicalGeneratedRoot: string | undefined;
	try {
		const provisionalRoot = await inspectRealDirectory(root, "generated test fixture root before private-mode pinning");
		pinnedGeneratedRoot = pinIdentity(provisionalRoot.stat);
		canonicalGeneratedRoot = join(approved.canonicalPath, basename(root));
		assertCurrentUserOwnership(provisionalRoot.stat, root, "generated test fixture root before private-mode pinning");
		assertNotGroupOrWorldWritable(provisionalRoot.stat, root, "generated test fixture root before private-mode pinning");
		assertStrictlyInside(provisionalRoot.canonicalPath, approved.canonicalPath, "canonical generated test fixture root before private-mode pinning");
		assertCanonicalPath(provisionalRoot.canonicalPath, canonicalGeneratedRoot, "generated test fixture root canonical location changed before private-mode pinning");
		await assertPinnedApprovedRoot(approvedRoot, approved.canonicalPath, approvedIdentity, "immediately before generated-root chmod");
		const immediatelyBeforeChmod = await inspectRealDirectory(root, "generated test fixture root immediately before chmod");
		assertIdentity(immediatelyBeforeChmod.stat, pinnedGeneratedRoot, root, "generated test fixture root identity changed before chmod");
		assertCurrentUserOwnership(immediatelyBeforeChmod.stat, root, "generated test fixture root immediately before chmod");
		assertNotGroupOrWorldWritable(immediatelyBeforeChmod.stat, root, "generated test fixture root immediately before chmod");
		assertCanonicalPath(
			immediatelyBeforeChmod.canonicalPath,
			canonicalGeneratedRoot,
			"generated test fixture root canonical location changed before chmod",
		);
		await chmod(root, 0o700);
		const rootInspection = await inspectRealDirectory(root, "generated test fixture root");
		assertCurrentUserOwnership(rootInspection.stat, root, "generated test fixture root");
		assertNotGroupOrWorldWritable(rootInspection.stat, root, "generated test fixture root");
		if (process.platform !== "win32" && (rootInspection.stat.mode & 0o777) !== 0o700) {
			throw new Error(`Generated test fixture root must be private (0700): ${root}`);
		}
		assertStrictlyInside(root, approvedRoot, "generated test fixture root");
		assertStrictlyInside(rootInspection.canonicalPath, approved.canonicalPath, "canonical generated test fixture root");
		assertIdentity(rootInspection.stat, pinnedGeneratedRoot, root, "generated test fixture root identity changed during setup");
		assertCanonicalPath(rootInspection.canonicalPath, canonicalGeneratedRoot, "generated test fixture root canonical location changed during setup");

		const fixture = buildFixture(
			approvedRoot,
			approved.canonicalPath,
			approvedIdentity,
			root,
			rootInspection.canonicalPath,
			pinnedGeneratedRoot,
			() => cleaned,
			() => { cleaned = true; },
		);
		await fixture.mkdir(fixture.fakeHome);
		await fixture.mkdir(fixture.project);
		await fixture.mkdir(fixture.protectedDir);
		await fixture.mkdir(fixture.sessionTemp);
		return fixture;
	} catch (error) {
		if (!cleaned && pinnedGeneratedRoot) {
			await guardedCleanupDirectory(
				root,
				approvedRoot,
				approved.canonicalPath,
				pinnedGeneratedRoot,
				"failed fixture setup",
				{
					beforeRename: () => assertPinnedFixtureRoots(
						approvedRoot,
						approved.canonicalPath,
						approvedIdentity,
						root,
						canonicalGeneratedRoot!,
						pinnedGeneratedRoot!,
						"failed fixture setup",
					),
					afterRename: () => assertPinnedApprovedRoot(
						approvedRoot,
						approved.canonicalPath,
						approvedIdentity,
						"failed fixture setup quarantine",
					),
				},
			);
			cleaned = true;
		}
		throw error;
	}
}

export async function withTestScratchFixture<T>(fn: (fixture: TestScratchFixture) => Promise<T>): Promise<T> {
	const fixture = await createTestScratchFixture();
	try {
		return await fn(fixture);
	} finally {
		await fixture.cleanup();
	}
}

function buildFixture(
	approvedRoot: string,
	canonicalApprovedRoot: string,
	approvedIdentity: PinnedDirectoryIdentity,
	root: string,
	canonicalRoot: string,
	rootIdentity: PinnedDirectoryIdentity,
	isCleaned: () => boolean,
	markCleaned: () => void,
): TestScratchFixture {
	const assertActive = () => {
		if (isCleaned()) throw new Error("Test scratch fixture has already been cleaned up");
	};

	const assertFixtureRootsPinned = async (label: string): Promise<void> => {
		assertActive();
		await assertPinnedFixtureRoots(
			approvedRoot,
			canonicalApprovedRoot,
			approvedIdentity,
			root,
			canonicalRoot,
			rootIdentity,
			label,
		);
	};

	const assertApprovedRootPinned = async (label: string): Promise<void> => {
		await assertPinnedApprovedRoot(approvedRoot, canonicalApprovedRoot, approvedIdentity, label);
	};

	const assertMutationTarget = async (pathValue: string): Promise<string> => {
		assertActive();
		await assertFixtureRootsPinned("fixture mutation boundary");
		const lexicalTarget = validateAbsolutePath(pathValue);
		assertStrictlyInside(lexicalTarget, root, "fixture mutation target");
		const parentInspection = await inspectRealDirectory(dirname(lexicalTarget), "fixture mutation parent");
		assertInsideOrEqual(parentInspection.canonicalPath, canonicalRoot, "canonical fixture mutation parent");
		try {
			const targetStat = await lstat(lexicalTarget);
			if (targetStat.isSymbolicLink()) {
				const canonicalTarget = normalizePath(await realpath(lexicalTarget));
				assertStrictlyInside(canonicalTarget, canonicalRoot, "canonical fixture mutation target");
			} else {
				const canonicalTarget = normalizePath(await realpath(lexicalTarget));
				assertStrictlyInside(canonicalTarget, canonicalRoot, "canonical fixture mutation target");
			}
		} catch (error) {
			if (!isNodeError(error) || error.code !== "ENOENT") throw error;
		}
		return lexicalTarget;
	};

	const fixture: TestScratchFixture = {
		approvedRoot,
		root,
		fakeHome: join(root, "fake-home"),
		project: join(root, "project"),
		protectedDir: join(root, "protected"),
		sessionTemp: join(root, "session-temp"),
		assertMutationTarget,
		async mkdir(pathValue: string) {
			await assertFixtureRootsPinned("fixture mkdir start");
			const target = await assertMutationTarget(pathValue);
			await assertPathAbsent(target, "fixture directory target");
			await assertFixtureRootsPinned("immediately before fixture mkdir");
			await mkdir(target, { recursive: false, mode: 0o700 });
			const created = await inspectRealDirectory(target, "created fixture directory");
			assertStrictlyInside(created.canonicalPath, canonicalRoot, "canonical created fixture directory");
			assertCurrentUserOwnership(created.stat, target, "created fixture directory");
			assertNotGroupOrWorldWritable(created.stat, target, "created fixture directory");
		},
		async writeFile(pathValue: string, contents: string) {
			await assertFixtureRootsPinned("fixture writeFile start");
			const target = await assertMutationTarget(pathValue);
			await assertPathAbsent(target, "fixture file target");
			await assertFixtureRootsPinned("immediately before fixture file creation");
			const handle = await open(target, "wx", 0o600);
			try {
				await assertFixtureRootsPinned("immediately before fixture file contents mutation");
				await handle.writeFile(contents, "utf-8");
			} finally {
				await handle.close();
			}
			const created = await lstat(target);
			if (!created.isFile() || created.isSymbolicLink()) throw new Error(`Created fixture file is unsafe: ${target}`);
			assertCurrentUserOwnership(created, target, "created fixture file");
			assertStrictlyInside(normalizePath(await realpath(target)), canonicalRoot, "canonical created fixture file");
		},
		async symlink(targetPath: string, linkPath: string) {
			assertActive();
			await assertFixtureRootsPinned("fixture symlink start");
			const target = validateAbsolutePath(targetPath);
			const link = await assertMutationTarget(linkPath);
			assertStrictlyInside(target, root, "test symlink target");
			const targetStat = await lstat(target);
			if (targetStat.isSymbolicLink()) throw new Error(`Test symlink target must not itself be a symlink: ${target}`);
			const canonicalTarget = normalizePath(await realpath(target));
			assertStrictlyInside(canonicalTarget, canonicalRoot, "canonical test symlink target");
			await assertPathAbsent(link, "test symlink path");
			await assertFixtureRootsPinned("immediately before fixture symlink creation");
			await symlink(canonicalTarget, link);
			const linkStat = await lstat(link);
			if (!linkStat.isSymbolicLink()) throw new Error(`Created test symlink is unsafe: ${link}`);
			assertStrictlyInside(normalizePath(await realpath(link)), canonicalRoot, "created test symlink target");
		},
		async rename(sourcePath: string, destinationPath: string) {
			assertActive();
			await assertFixtureRootsPinned("fixture rename start");
			const source = await assertMutationTarget(sourcePath);
			const destination = await assertMutationTarget(destinationPath);
			const sourceInspection = await inspectRealPath(source, "fixture rename source");
			if (sourceInspection.stat.isSymbolicLink()) throw new Error(`Fixture rename source must not be a symlink: ${source}`);
			assertStrictlyInside(sourceInspection.canonicalPath, canonicalRoot, "canonical fixture rename source");
			await assertPathAbsent(destination, "fixture rename destination");
			await assertFixtureRootsPinned("immediately before fixture rename");
			await rename(source, destination);
			const destinationInspection = await inspectRealPath(destination, "fixture rename destination");
			assertIdentity(destinationInspection.stat, pinIdentity(sourceInspection.stat), destination, "fixture rename identity changed");
			assertStrictlyInside(destinationInspection.canonicalPath, canonicalRoot, "canonical fixture rename destination");
		},
		async pinDirectoryCleanup(pathValue: string) {
			assertActive();
			await assertFixtureRootsPinned("pinDirectoryCleanup start");
			const target = await assertMutationTarget(pathValue);
			const inspected = await inspectRealDirectory(target, "pinned disposable fixture directory");
			assertStrictlyInside(inspected.canonicalPath, canonicalRoot, "canonical pinned disposable fixture directory");
			const identity = pinIdentity(inspected.stat);
			const container = dirname(target);
			const canonicalContainer = normalizePath(await realpath(container));
			let removed = false;
			return async () => {
				if (removed) return;
				await assertFixtureRootsPinned("pinned directory cleanup start");
				await guardedCleanupDirectory(
					target,
					container,
					canonicalContainer,
					identity,
					"pinned disposable fixture directory",
					{
						beforeRename: () => assertFixtureRootsPinned("before pinned directory quarantine rename"),
						afterRename: () => assertFixtureRootsPinned("before pinned directory quarantine removal"),
					},
				);
				removed = true;
			};
		},
		async withGeneratedRootReplacementForTest(fn) {
			await assertFixtureRootsPinned("generated-root replacement simulation start");
			const displacedRoot = join(approvedRoot, `.permissions-displaced-${basename(root)}-${randomUUID()}`);
			assertStrictlyInside(displacedRoot, approvedRoot, "displaced generated fixture root");
			await assertPathAbsent(displacedRoot, "displaced generated fixture root");

			let originalDisplaced = false;
			let replacementIdentity: PinnedDirectoryIdentity | undefined;
			let sentinelIdentity: PinnedDirectoryIdentity | undefined;
			const sentinelPath = join(root, "replacement-identity-sentinel");
			try {
				await assertFixtureRootsPinned("immediately before displacing generated fixture root");
				await rename(root, displacedRoot);
				originalDisplaced = true;
				await assertPinnedApprovedRoot(
					approvedRoot,
					canonicalApprovedRoot,
					approvedIdentity,
					"after displacing generated fixture root",
				);
				await assertPinnedGeneratedRoot(
					displacedRoot,
					join(canonicalApprovedRoot, basename(displacedRoot)),
					rootIdentity,
					canonicalApprovedRoot,
					"displaced generated fixture root",
				);

				await assertPathAbsent(root, "generated fixture replacement path");
				await assertApprovedRootPinned("immediately before creating generated fixture replacement");
				await mkdir(root, { recursive: false, mode: 0o700 });
				const replacement = await inspectRealDirectory(root, "generated fixture replacement");
				replacementIdentity = pinIdentity(replacement.stat);
				await assertPinnedGeneratedRoot(
					root,
					canonicalRoot,
					replacementIdentity,
					canonicalApprovedRoot,
					"generated fixture replacement",
				);

				await assertPinnedReplacementBoundary(
					approvedRoot,
					canonicalApprovedRoot,
					approvedIdentity,
					root,
					canonicalRoot,
					replacementIdentity,
					"immediately before replacement sentinel creation",
				);
				const handle = await open(sentinelPath, "wx", 0o600);
				try {
					await assertPinnedReplacementBoundary(
						approvedRoot,
						canonicalApprovedRoot,
						approvedIdentity,
						root,
						canonicalRoot,
						replacementIdentity,
						"immediately before replacement sentinel contents mutation",
					);
					await handle.writeFile("replacement identity sentinel\n", "utf8");
				} finally {
					await handle.close();
				}
				const sentinel = await inspectPinnedFile(
					sentinelPath,
					canonicalRoot,
					undefined,
					"generated fixture replacement sentinel",
				);
				sentinelIdentity = pinIdentity(sentinel.stat);

				await fn({ sentinelPath });
				await inspectPinnedFile(
					sentinelPath,
					canonicalRoot,
					sentinelIdentity,
					"generated fixture replacement sentinel after refused mutation",
				);
			} finally {
				if (replacementIdentity) {
					if (sentinelIdentity) {
						await inspectPinnedFile(
							sentinelPath,
							canonicalRoot,
							sentinelIdentity,
							"generated fixture replacement sentinel before recovery",
						);
					}
					await guardedCleanupDirectory(
						root,
						approvedRoot,
						canonicalApprovedRoot,
						replacementIdentity,
						"generated fixture replacement recovery",
						{
							beforeRename: () => assertPinnedReplacementBoundary(
								approvedRoot,
								canonicalApprovedRoot,
								approvedIdentity,
								root,
								canonicalRoot,
								replacementIdentity!,
								"before replacement recovery rename",
							),
							afterRename: () => assertApprovedRootPinned("before replacement recovery removal"),
						},
					);
					replacementIdentity = undefined;
				}

				if (originalDisplaced) {
					await assertApprovedRootPinned("generated-root recovery start");
					await assertPinnedGeneratedRoot(
						displacedRoot,
						join(canonicalApprovedRoot, basename(displacedRoot)),
						rootIdentity,
						canonicalApprovedRoot,
						"displaced generated fixture root before recovery",
					);
					await assertPathAbsent(root, "generated fixture root recovery destination");
					await assertApprovedRootPinned("immediately before generated-root recovery rename");
					await assertPinnedGeneratedRoot(
						displacedRoot,
						join(canonicalApprovedRoot, basename(displacedRoot)),
						rootIdentity,
						canonicalApprovedRoot,
						"displaced generated fixture root immediately before recovery",
					);
					await rename(displacedRoot, root);
					originalDisplaced = false;
					await assertFixtureRootsPinned("after generated-root replacement recovery");
				}
			}
		},
		async cleanup() {
			if (isCleaned()) return;
			await assertFixtureRootsPinned("fixture cleanup start");
			await guardedCleanupDirectory(
				root,
				approvedRoot,
				canonicalApprovedRoot,
				rootIdentity,
				"fixture cleanup root",
				{
					beforeRename: () => assertFixtureRootsPinned("immediately before fixture cleanup quarantine rename"),
					afterRename: () => assertApprovedRootPinned("before fixture cleanup quarantine removal"),
				},
			);
			markCleaned();
		},
	};
	return fixture;
}

async function guardedCleanupDirectory(
	target: string,
	container: string,
	canonicalContainer: string,
	pinnedIdentity: PinnedDirectoryIdentity,
	label: string,
	boundary: { beforeRename(): Promise<void>; afterRename(): Promise<void> },
): Promise<void> {
	await boundary.beforeRename();
	assertStrictlyInside(target, container, label);
	const inspected = await inspectRealDirectory(target, label);
	assertIdentity(inspected.stat, pinnedIdentity, target, `${label} identity changed`);
	assertCurrentUserOwnership(inspected.stat, target, label);
	assertNotGroupOrWorldWritable(inspected.stat, target, label);
	assertPrivateDirectoryMode(inspected.stat, target, label);
	assertStrictlyInside(inspected.canonicalPath, canonicalContainer, `canonical ${label}`);
	assertCanonicalPath(inspected.canonicalPath, join(canonicalContainer, basename(target)), `${label} canonical location changed`);

	const quarantine = join(container, `.permissions-quarantine-${basename(target)}-${randomUUID()}`);
	assertStrictlyInside(quarantine, container, `${label} quarantine`);
	await assertPathAbsent(quarantine, `${label} quarantine`);
	await boundary.beforeRename();
	await rename(target, quarantine);

	await boundary.afterRename();
	const quarantined = await inspectRealDirectory(quarantine, `${label} quarantine`);
	assertIdentity(quarantined.stat, pinnedIdentity, quarantine, `${label} quarantine identity changed`);
	assertCurrentUserOwnership(quarantined.stat, quarantine, `${label} quarantine`);
	assertNotGroupOrWorldWritable(quarantined.stat, quarantine, `${label} quarantine`);
	assertPrivateDirectoryMode(quarantined.stat, quarantine, `${label} quarantine`);
	assertStrictlyInside(quarantined.canonicalPath, canonicalContainer, `canonical ${label} quarantine`);
	assertCanonicalPath(
		quarantined.canonicalPath,
		join(canonicalContainer, basename(quarantine)),
		`${label} quarantine canonical location changed`,
	);
	await boundary.afterRename();
	const immediatelyBeforeRemoval = await inspectRealDirectory(quarantine, `${label} quarantine immediately before removal`);
	assertIdentity(immediatelyBeforeRemoval.stat, pinnedIdentity, quarantine, `${label} quarantine identity changed before removal`);
	assertCurrentUserOwnership(immediatelyBeforeRemoval.stat, quarantine, `${label} quarantine immediately before removal`);
	assertNotGroupOrWorldWritable(immediatelyBeforeRemoval.stat, quarantine, `${label} quarantine immediately before removal`);
	assertPrivateDirectoryMode(immediatelyBeforeRemoval.stat, quarantine, `${label} quarantine immediately before removal`);
	assertCanonicalPath(
		immediatelyBeforeRemoval.canonicalPath,
		join(canonicalContainer, basename(quarantine)),
		`${label} quarantine canonical location changed before removal`,
	);
	await rm(quarantine, { recursive: true, force: false });
}

async function assertPinnedFixtureRoots(
	approvedRoot: string,
	canonicalApprovedRoot: string,
	approvedIdentity: PinnedDirectoryIdentity,
	root: string,
	canonicalRoot: string,
	rootIdentity: PinnedDirectoryIdentity,
	label: string,
): Promise<void> {
	await assertPinnedApprovedRoot(approvedRoot, canonicalApprovedRoot, approvedIdentity, `${label}: approved root`);
	await assertPinnedGeneratedRoot(root, canonicalRoot, rootIdentity, canonicalApprovedRoot, `${label}: generated root`);
}

async function assertPinnedReplacementBoundary(
	approvedRoot: string,
	canonicalApprovedRoot: string,
	approvedIdentity: PinnedDirectoryIdentity,
	root: string,
	canonicalRoot: string,
	replacementIdentity: PinnedDirectoryIdentity,
	label: string,
): Promise<void> {
	await assertPinnedApprovedRoot(approvedRoot, canonicalApprovedRoot, approvedIdentity, `${label}: approved root`);
	await assertPinnedGeneratedRoot(root, canonicalRoot, replacementIdentity, canonicalApprovedRoot, `${label}: replacement root`);
}

async function assertPinnedApprovedRoot(
	approvedRoot: string,
	canonicalApprovedRoot: string,
	approvedIdentity: PinnedDirectoryIdentity,
	label: string,
): Promise<void> {
	const inspected = await inspectRealDirectory(approvedRoot, label);
	assertIdentity(inspected.stat, approvedIdentity, approvedRoot, "approved test scratch root identity changed");
	assertCurrentUserOwnership(inspected.stat, approvedRoot, label);
	assertNotGroupOrWorldWritable(inspected.stat, approvedRoot, label);
	assertCanonicalPath(inspected.canonicalPath, canonicalApprovedRoot, `${label} canonical location changed`);
}

async function assertPinnedGeneratedRoot(
	root: string,
	canonicalRoot: string,
	rootIdentity: PinnedDirectoryIdentity,
	canonicalApprovedRoot: string,
	label: string,
): Promise<void> {
	const inspected = await inspectRealDirectory(root, label);
	assertIdentity(inspected.stat, rootIdentity, root, "generated test fixture root identity changed");
	assertCurrentUserOwnership(inspected.stat, root, label);
	assertNotGroupOrWorldWritable(inspected.stat, root, label);
	assertPrivateDirectoryMode(inspected.stat, root, label);
	assertStrictlyInside(inspected.canonicalPath, canonicalApprovedRoot, `${label} canonical containment`);
	assertCanonicalPath(inspected.canonicalPath, canonicalRoot, `${label} canonical location changed`);
}

async function inspectPinnedFile(
	pathValue: string,
	canonicalRoot: string,
	identity: PinnedDirectoryIdentity | undefined,
	label: string,
) {
	const inspected = await inspectRealPath(pathValue, label);
	if (!inspected.stat.isFile()) throw new Error(`${label} must be a real file: ${pathValue}`);
	if (identity) assertIdentity(inspected.stat, identity, pathValue, `${label} identity changed`);
	assertCurrentUserOwnership(inspected.stat, pathValue, label);
	assertNotGroupOrWorldWritable(inspected.stat, pathValue, label);
	assertStrictlyInside(inspected.canonicalPath, canonicalRoot, `${label} canonical containment`);
	assertCanonicalPath(inspected.canonicalPath, join(canonicalRoot, basename(pathValue)), `${label} canonical location changed`);
	return inspected;
}

async function assertApprovedRootSafety(
	originalPath: string,
	approved: { canonicalPath: string; stat: Awaited<ReturnType<typeof lstat>> },
): Promise<void> {
	assertCurrentUserOwnership(approved.stat, originalPath, "approved test scratch root");
	assertNotGroupOrWorldWritable(approved.stat, originalPath, "approved test scratch root");
	const filesystemRoot = normalizePath(await realpath("/"));
	const protectedPaths: string[] = [filesystemRoot];
	for (const pathValue of [homedir(), process.cwd(), REPOSITORY_ROOT]) {
		try {
			protectedPaths.push(normalizePath(await realpath(pathValue)));
		} catch {
			throw new Error(`Unable to resolve protected real path while validating test scratch: ${pathValue}`);
		}
	}
	if (protectedPathsOverlapApprovedRoot(approved.canonicalPath, protectedPaths, filesystemRoot)) {
		throw new Error(`Approved test scratch root must not equal, contain, or be contained by protected real paths: ${originalPath}`);
	}
}

async function inspectRealDirectory(pathValue: string, label: string) {
	const inspected = await inspectRealPath(pathValue, label);
	if (!inspected.stat.isDirectory()) throw new Error(`${label} must be a real directory: ${pathValue}`);
	return inspected;
}

async function inspectRealPath(pathValue: string, label: string) {
	const stat = await lstat(pathValue);
	if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symlink: ${pathValue}`);
	return { canonicalPath: normalizePath(await realpath(pathValue)), stat };
}

async function assertPathAbsent(pathValue: string, label: string): Promise<void> {
	try {
		await lstat(pathValue);
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") return;
		throw error;
	}
	throw new Error(`${label} must not already exist: ${pathValue}`);
}

function assertCurrentUserOwnership(stat: Awaited<ReturnType<typeof lstat>>, pathValue: string, label: string): void {
	if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
		throw new Error(`${label} must be owned by the current user: ${pathValue}`);
	}
}

function assertNotGroupOrWorldWritable(stat: Awaited<ReturnType<typeof lstat>>, pathValue: string, label: string): void {
	if (process.platform !== "win32" && (Number(stat.mode) & 0o022) !== 0) {
		throw new Error(`${label} must not be group- or world-writable: ${pathValue}`);
	}
}

function assertPrivateDirectoryMode(stat: Awaited<ReturnType<typeof lstat>>, pathValue: string, label: string): void {
	if (process.platform !== "win32" && (Number(stat.mode) & 0o777) !== 0o700) {
		throw new Error(`${label} must remain private (0700): ${pathValue}`);
	}
}

function pinIdentity(stat: Awaited<ReturnType<typeof lstat>>): PinnedDirectoryIdentity {
	return { dev: stat.dev, ino: stat.ino };
}

function assertIdentity(
	stat: Awaited<ReturnType<typeof lstat>>,
	identity: PinnedDirectoryIdentity,
	pathValue: string,
	message: string,
): void {
	if (stat.dev !== identity.dev || stat.ino !== identity.ino) throw new Error(`${message}: ${pathValue}`);
}

function validateAbsolutePath(pathValue: string): string {
	if (!pathValue || pathValue.includes("\0") || !isAbsolute(pathValue)) {
		throw new Error(`Fixture mutation target must be a resolved absolute path: ${pathValue}`);
	}
	return normalizePath(pathValue);
}

function assertStrictlyInside(candidatePath: string, rootPath: string, label: string): void {
	const candidate = normalizePath(candidatePath);
	const root = normalizePath(rootPath);
	const rel = relative(root, candidate);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
		throw new Error(`${label} must be a strict descendant of ${root}: ${candidate}`);
	}
}

function assertInsideOrEqual(candidatePath: string, rootPath: string, label: string): void {
	if (!isInsideOrEqual(candidatePath, rootPath)) {
		throw new Error(`${label} must be inside ${normalizePath(rootPath)}: ${normalizePath(candidatePath)}`);
	}
}

function isInsideOrEqual(candidatePath: string, rootPath: string): boolean {
	const rel = relative(normalizePath(rootPath), normalizePath(candidatePath));
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function assertCanonicalPath(actualPath: string, expectedPath: string, message: string): void {
	if (normalizePath(actualPath) !== normalizePath(expectedPath)) {
		throw new Error(`${message}: expected ${normalizePath(expectedPath)}, received ${normalizePath(actualPath)}`);
	}
}

function normalizePath(pathValue: string): string {
	const normalized = normalize(pathValue);
	return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
