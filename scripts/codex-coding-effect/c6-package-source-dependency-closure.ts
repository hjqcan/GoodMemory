import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
} from "node:fs";
import type { Stats } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  posix,
  resolve,
} from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  buildC6AssetLock,
  loadC6AssetLock,
  readC6StableRegularFile,
  serializeC6AssetLock,
  verifyC6AssetClosure,
} from "./c6-asset-lock";
import type { LoadedC6AssetLock } from "./c6-asset-lock";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CACHE_ARCHIVE_PATH = "bun-cache.tar";
const CACHE_MANIFEST_PATH = "cache-tree.jsonl";
const CLOSURE_PATH = "closure.json";
const ASSET_LOCK_PATH = "asset-lock.json";
const CLOSURE_PATHS = [
  ASSET_LOCK_PATH,
  CACHE_ARCHIVE_PATH,
  CACHE_MANIFEST_PATH,
  CLOSURE_PATH,
] as const;
const CONTENT_ROOT_DOMAIN =
  "c6-package-source-dependency-cache-content-v1\n";
const TAR_BLOCK_BYTES = 512;
const TAR_END_BYTES = TAR_BLOCK_BYTES * 2;
const DIRECTORY_MODE = 0o755;
const EXECUTABLE_FILE_MODE = 0o755;
const REGULAR_FILE_MODE = 0o644;
const FILE_READ_CHUNK_BYTES = 64 * 1024;
const SCAN_HEARTBEAT_ENTRY_INTERVAL = 2_048;
const SCAN_TIMEOUT_MS = 300_000;
const ALLOWED_SYMLINK_PREFIXES = [
  "/work/cache",
  "/work/dependency-cache",
] as const;

const sha256Schema = z.string().regex(SHA256_PATTERN);
const artifactSchema = z.object({
  bytes: z.number().int().nonnegative(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const directoryEntrySchema = z.object({
  mode: z.literal(DIRECTORY_MODE),
  path: z.string().min(1),
  type: z.literal("directory"),
}).strict();
const fileEntrySchema = z.object({
  bytes: z.number().int().nonnegative(),
  mode: z.union([
    z.literal(REGULAR_FILE_MODE),
    z.literal(EXECUTABLE_FILE_MODE),
  ]),
  path: z.string().min(1),
  sha256: sha256Schema,
  type: z.literal("file"),
}).strict();
const cacheEntrySchema = z.discriminatedUnion("type", [
  directoryEntrySchema,
  fileEntrySchema,
]);
const closureSchema = z.object({
  cache: z.object({
    archive: artifactSchema.extend({
      path: z.literal(CACHE_ARCHIVE_PATH),
    }).strict(),
    contentRootSha256: sha256Schema,
    directoryCount: z.number().int().nonnegative(),
    entryCount: z.number().int().nonnegative(),
    fileCount: z.number().int().nonnegative(),
    manifest: artifactSchema.extend({
      path: z.literal(CACHE_MANIFEST_PATH),
    }).strict(),
  }).strict(),
  kind: z.literal("c6-package-source-dependency-closure"),
  normalization: z.object({
    directoryMode: z.literal(DIRECTORY_MODE),
    executableFileMode: z.literal(EXECUTABLE_FILE_MODE),
    hardlinkPolicy: z.literal("copy-bytes-nlink-1-v1"),
    mtimeSeconds: z.literal(0),
    regularFileMode: z.literal(REGULAR_FILE_MODE),
    storedEntryTypes: z.tuple([
      z.literal("directory"),
      z.literal("file"),
    ]),
    symlinkPolicy: z.literal("safe-internal-dereference-v1"),
    uid: z.literal(0),
    gid: z.literal(0),
  }).strict(),
  schemaVersion: z.literal(1),
}).strict();
const expectedIdentitySchema = z.object({
  assetLockSha256: sha256Schema,
  assetRootSha256: sha256Schema,
  cacheArchiveSha256: sha256Schema,
  cacheContentRootSha256: sha256Schema,
  cacheManifestSha256: sha256Schema,
}).strict();

type CacheEntry = z.infer<typeof cacheEntrySchema>;
type Closure = z.infer<typeof closureSchema>;

interface CapturedDirectoryEntry {
  mode: typeof DIRECTORY_MODE;
  path: string;
  sourcePath: string;
  type: "directory";
}

interface CapturedFileEntry {
  bytes: number;
  mode: typeof EXECUTABLE_FILE_MODE | typeof REGULAR_FILE_MODE;
  path: string;
  sha256: string;
  sourcePath: string;
  type: "file";
}

type CapturedEntry = CapturedDirectoryEntry | CapturedFileEntry;

interface ArchiveDirectoryEntry {
  mode: typeof DIRECTORY_MODE;
  path: string;
  type: "directory";
}

interface ArchiveFileEntry {
  bytes: Buffer;
  mode: typeof EXECUTABLE_FILE_MODE | typeof REGULAR_FILE_MODE;
  path: string;
  sha256: string;
  type: "file";
}

type ArchiveEntry = ArchiveDirectoryEntry | ArchiveFileEntry;

interface DirectoryIdentity {
  dev: number;
  ino: number;
}

interface StableStatIdentity {
  ctimeMs: number;
  dev: number;
  ino: number;
  mode: number;
  mtimeMs: number;
  nlink: number;
  size: number;
}

interface ValidatedClosure {
  archiveEntries: ArchiveEntry[];
  assetLock: LoadedC6AssetLock;
  closure: Closure;
  closureIdentity: DirectoryIdentity;
  closureRoot: string;
  entries: CacheEntry[];
  expected: C6PackageSourceDependencyClosureExpectedIdentity;
}

interface NormalizedTree {
  entries: CacheEntry[];
  inodeIdentities: Set<string>;
  statByPath: Map<string, StableStatIdentity>;
}

export type C6PackageSourceDependencyClosureExpectedIdentity = z.infer<
  typeof expectedIdentitySchema
>;

export interface C6PackageSourceDependencyClosureFreezeResult
  extends C6PackageSourceDependencyClosureExpectedIdentity {
  cacheDirectoryCount: number;
  cacheEntryCount: number;
  cacheFileCount: number;
  closureRoot: string;
}

export interface LoadedC6PackageSourceDependencyClosure
  extends C6PackageSourceDependencyClosureFreezeResult {
  artifactClosureVerified: true;
}

export interface C6PackageSourceDependencyClosureVerification
  extends C6PackageSourceDependencyClosureExpectedIdentity {
  artifactClosureVerified: true;
}

export interface C6MaterializedPackageSourceDependencyCache {
  cacheContentRootSha256: string;
  cacheDirectoryCount: number;
  cacheEntryCount: number;
  cacheFileCount: number;
  outputRoot: string;
}

export interface C6PackageSourceDependencyCacheVerification {
  cacheContentRootSha256: string;
  cacheDirectoryCount: number;
  cacheEntryCount: number;
  cacheFileCount: number;
  outputRoot: string;
  treeVerified: true;
}

export interface C6PackageSourceDependencyCachePairVerification {
  first: C6PackageSourceDependencyCacheVerification;
  pairVerified: true;
  second: C6PackageSourceDependencyCacheVerification;
}

export interface C6PackageSourceCacheScanProgress {
  entriesScanned: number;
  phase:
    | "initial"
    | "materialize"
    | "terminal"
    | "terminal-stats";
  rootIndex: 1 | 2;
  status: "complete" | "heartbeat" | "start";
}

export class C6PackageSourceCacheScanTimeoutError extends Error {
  readonly phase: C6PackageSourceCacheScanProgress["phase"];
  readonly retainedWorkRoots: readonly string[];
  readonly root: string;
  readonly timeoutMs: number;

  constructor(input: {
    phase: C6PackageSourceCacheScanProgress["phase"];
    retainedWorkRoots?: readonly string[];
    root: string;
    timeoutMs: number;
  }) {
    const retainedWorkRoots = [...(input.retainedWorkRoots ?? [])];
    super([
      "C6 source dependency cache scan timed out; " +
        `phase=${input.phase} root=${input.root} ` +
        `timeoutMs=${input.timeoutMs}`,
      ...retainedWorkRoots.map((root) => `retainedWorkRoot=${root}`),
      retainedWorkRoots.length === 0
        ? "Action: retain the containing work root until the aborted scan has stopped"
        : "Action: inspect and remove the retained work roots after the aborted scan has stopped",
    ].join("\n"));
    this.name = "C6PackageSourceCacheScanTimeoutError";
    this.phase = input.phase;
    this.retainedWorkRoots = retainedWorkRoots;
    this.root = input.root;
    this.timeoutMs = input.timeoutMs;
  }
}

export async function freezeC6PackageSourceDependencyClosure(input: {
  acquisitionCacheRoot: string;
  outputRoot: string;
}): Promise<C6PackageSourceDependencyClosureFreezeResult> {
  const acquisitionCacheRoot = await canonicalExistingDirectory(
    input.acquisitionCacheRoot,
    "C6 source dependency acquisition cache root",
  );
  const acquisitionIdentity = await directoryIdentity(acquisitionCacheRoot);
  const outputRoot = await canonicalNewDirectoryPath(
    input.outputRoot,
    "C6 source dependency closure output",
  );
  await mkdir(outputRoot, { mode: 0o700 });
  const outputIdentity = await directoryIdentity(outputRoot);

  try {
    const captured = await captureAcquisitionCache(acquisitionCacheRoot);
    const entries = captured.map(toCacheEntry);
    const manifest = serializeCacheManifest(entries);
    const manifestBytes = Buffer.from(manifest);
    const cacheManifestSha256 = sha256(manifestBytes);
    const cacheContentRootSha256 = computeCacheContentRoot(manifestBytes);
    const manifestPath = join(outputRoot, CACHE_MANIFEST_PATH);
    const archivePath = join(outputRoot, CACHE_ARCHIVE_PATH);
    await writeNormalizedFile(manifestPath, manifestBytes);
    await writeDeterministicCacheArchive(archivePath, captured);

    const terminalCaptured =
      await captureAcquisitionCache(acquisitionCacheRoot);
    if (
      serializeCacheManifest(terminalCaptured.map(toCacheEntry)) !== manifest
    ) {
      throw new Error(
        "C6 source dependency acquisition cache changed during freeze",
      );
    }
    await assertDirectoryIdentity(
      acquisitionCacheRoot,
      acquisitionIdentity,
      "C6 source dependency acquisition cache root",
    );

    const archiveBytes = await readC6StableRegularFile(
      archivePath,
      "source dependency cache archive",
    );
    const cacheArchiveSha256 = sha256(archiveBytes);
    const cacheFileCount = entries.filter((entry) =>
      entry.type === "file"
    ).length;
    const cacheDirectoryCount = entries.length - cacheFileCount;
    const closure = closureSchema.parse({
      cache: {
        archive: {
          bytes: archiveBytes.byteLength,
          path: CACHE_ARCHIVE_PATH,
          sha256: cacheArchiveSha256,
        },
        contentRootSha256: cacheContentRootSha256,
        directoryCount: cacheDirectoryCount,
        entryCount: entries.length,
        fileCount: cacheFileCount,
        manifest: {
          bytes: manifestBytes.byteLength,
          path: CACHE_MANIFEST_PATH,
          sha256: cacheManifestSha256,
        },
      },
      kind: "c6-package-source-dependency-closure",
      normalization: {
        directoryMode: DIRECTORY_MODE,
        executableFileMode: EXECUTABLE_FILE_MODE,
        gid: 0,
        hardlinkPolicy: "copy-bytes-nlink-1-v1",
        mtimeSeconds: 0,
        regularFileMode: REGULAR_FILE_MODE,
        storedEntryTypes: ["directory", "file"],
        symlinkPolicy: "safe-internal-dereference-v1",
        uid: 0,
      },
      schemaVersion: 1,
    });
    await writeNormalizedFile(
      join(outputRoot, CLOSURE_PATH),
      Buffer.from(serializeClosure(closure)),
    );
    const assetLock = await buildC6AssetLock(outputRoot);
    const assetLockBytes = Buffer.from(serializeC6AssetLock(assetLock));
    await writeNormalizedFile(
      join(outputRoot, ASSET_LOCK_PATH),
      assetLockBytes,
    );
    await chmod(outputRoot, DIRECTORY_MODE);
    await assertDirectoryIdentity(
      outputRoot,
      outputIdentity,
      "C6 source dependency closure output",
    );

    const expected = expectedIdentitySchema.parse({
      assetLockSha256: sha256(assetLockBytes),
      assetRootSha256: assetLock.assetRootSha256,
      cacheArchiveSha256,
      cacheContentRootSha256,
      cacheManifestSha256,
    });
    const validated = await validateClosure({
      closureRoot: outputRoot,
      expected,
    });
    return {
      ...expected,
      cacheDirectoryCount: validated.closure.cache.directoryCount,
      cacheEntryCount: validated.closure.cache.entryCount,
      cacheFileCount: validated.closure.cache.fileCount,
      closureRoot: outputRoot,
    };
  } catch (error) {
    await rm(outputRoot, { force: true, recursive: true });
    throw error;
  }
}

export async function loadC6PackageSourceDependencyClosure(input: {
  closureRoot: string;
  expected: C6PackageSourceDependencyClosureExpectedIdentity;
}): Promise<LoadedC6PackageSourceDependencyClosure> {
  const validated = await validateClosure(input);
  return {
    ...validated.expected,
    artifactClosureVerified: true,
    cacheDirectoryCount: validated.closure.cache.directoryCount,
    cacheEntryCount: validated.closure.cache.entryCount,
    cacheFileCount: validated.closure.cache.fileCount,
    closureRoot: validated.closureRoot,
  };
}

export async function verifyC6PackageSourceDependencyClosure(input: {
  closureRoot: string;
  expected: C6PackageSourceDependencyClosureExpectedIdentity;
}): Promise<C6PackageSourceDependencyClosureVerification> {
  const validated = await validateClosure(input);
  return {
    ...validated.expected,
    artifactClosureVerified: true,
  };
}

export async function materializeC6PackageSourceDependencyCache(input: {
  closureRoot: string;
  expected: C6PackageSourceDependencyClosureExpectedIdentity;
  outputRoot: string;
}, dependencies: {
  monotonicNowMs?: () => number;
  onProgress?: (progress: C6PackageSourceCacheScanProgress) => void;
  rootIndex?: 1 | 2;
  scanTimeoutMs?: number;
} = {}): Promise<C6MaterializedPackageSourceDependencyCache> {
  const validated = await validateClosure({
    closureRoot: input.closureRoot,
    expected: input.expected,
  });
  const outputRoot = await canonicalExistingDirectory(
    input.outputRoot,
    "C6 materialized source dependency cache root",
  );
  if ((await readdir(outputRoot)).length !== 0) {
    throw new Error(
      "C6 materialized source dependency cache root must be empty",
    );
  }
  await chmod(outputRoot, DIRECTORY_MODE);
  const outputIdentity = await directoryIdentity(outputRoot);

  for (const entry of validated.archiveEntries) {
    const path = join(outputRoot, ...entry.path.split("/"));
    if (entry.type === "directory") {
      await mkdir(path, { mode: DIRECTORY_MODE });
      await chmod(path, DIRECTORY_MODE);
      continue;
    }
    await writeFile(path, entry.bytes, {
      flag: "wx",
      mode: entry.mode,
    });
    await chmod(path, entry.mode);
  }

  const materialized = await boundedCacheScan({
    phase: "materialize",
    root: outputRoot,
    timeoutMs: resolveCacheScanTimeoutMs(dependencies.scanTimeoutMs),
    monotonicNowMs: dependencies.monotonicNowMs,
  }, (control) =>
    scanNormalizedTree(outputRoot, {
      control,
      onProgress: dependencies.onProgress,
      phase: "materialize",
      rootIndex: dependencies.rootIndex ?? 1,
    })
  );
  if (
    serializeCacheManifest(materialized.entries) !==
      serializeCacheManifest(validated.entries)
  ) {
    throw new Error(
      "C6 materialized source dependency cache does not match closure",
    );
  }
  await assertDirectoryIdentity(
    outputRoot,
    outputIdentity,
    "C6 materialized source dependency cache root",
  );
  await verifyC6AssetClosure(
    validated.closureRoot,
    validated.assetLock,
  );
  await assertExactClosureLayout(validated.closureRoot);
  await assertDirectoryIdentity(
    validated.closureRoot,
    validated.closureIdentity,
    "C6 source dependency closure root",
  );
  return {
    cacheContentRootSha256:
      validated.expected.cacheContentRootSha256,
    cacheDirectoryCount:
      materialized.entries.length - materialized.entries.filter(
        (entry) => entry.type === "file",
      ).length,
    cacheEntryCount: materialized.entries.length,
    cacheFileCount: materialized.entries.filter(
      (entry) => entry.type === "file",
    ).length,
    outputRoot,
  };
}

export async function verifyC6PackageSourceDependencyCache(input: {
  expectedContentRootSha256: string;
  outputRoot: string;
}, dependencies: {
  onFirstScanComplete?: () => Promise<void> | void;
} = {}): Promise<C6PackageSourceDependencyCacheVerification> {
  const expectedContentRootSha256 = sha256Schema.parse(
    input.expectedContentRootSha256,
  );
  const outputRoot = await canonicalExistingDirectory(
    input.outputRoot,
    "C6 materialized source dependency cache root",
  );
  const outputIdentity = await directoryIdentity(outputRoot);
  const initial = await scanNormalizedTree(outputRoot);
  await dependencies.onFirstScanComplete?.();

  const normalized = await scanNormalizedTree(outputRoot);
  if (!sameNormalizedTree(initial, normalized)) {
    throw new Error(
      "C6 materialized source dependency cache changed during verification",
    );
  }
  await assertTerminalNormalizedTreeStats(
    outputRoot,
    normalized.statByPath,
  );
  await assertDirectoryIdentity(
    outputRoot,
    outputIdentity,
    "C6 materialized source dependency cache root",
  );
  const manifest = Buffer.from(serializeCacheManifest(normalized.entries));
  const cacheContentRootSha256 = computeCacheContentRoot(manifest);
  if (cacheContentRootSha256 !== expectedContentRootSha256) {
    throw new Error(
      "C6 materialized source dependency cache content identity does not match",
    );
  }
  const cacheFileCount = normalized.entries.filter((entry) =>
    entry.type === "file"
  ).length;
  return {
    cacheContentRootSha256,
    cacheDirectoryCount: normalized.entries.length - cacheFileCount,
    cacheEntryCount: normalized.entries.length,
    cacheFileCount,
    outputRoot,
    treeVerified: true,
  };
}

export async function verifyC6PackageSourceDependencyCachePair(input: {
  expectedContentRootSha256: string;
  roots: readonly [string, string];
}, dependencies: {
  betweenScans?: () => Promise<void> | void;
  monotonicNowMs?: () => number;
  onProgress?: (progress: C6PackageSourceCacheScanProgress) => void;
  scanTimeoutMs?: number;
} = {}): Promise<C6PackageSourceDependencyCachePairVerification> {
  const expectedContentRootSha256 = sha256Schema.parse(
    input.expectedContentRootSha256,
  );
  const roots = await Promise.all(input.roots.map((root) =>
    canonicalExistingDirectory(
      root,
      "C6 paired materialized source dependency cache root",
    )
  )) as [string, string];
  if (roots[0] === roots[1]) {
    throw new Error(
      "C6 paired materialized source dependency cache roots must differ",
    );
  }
  const rootIdentities = await Promise.all(roots.map(directoryIdentity));
  if (
    rootIdentities[0]!.dev === rootIdentities[1]!.dev &&
    rootIdentities[0]!.ino === rootIdentities[1]!.ino
  ) {
    throw new Error(
      "C6 paired materialized source dependency cache roots share an inode",
    );
  }
  const initial = [] as NormalizedTree[];
  for (const [index, root] of roots.entries()) {
    initial.push(await boundedCacheScan({
      phase: "initial",
      root,
      timeoutMs: resolveCacheScanTimeoutMs(dependencies.scanTimeoutMs),
      monotonicNowMs: dependencies.monotonicNowMs,
    }, (control) =>
      scanNormalizedTree(root, {
        control,
        onProgress: dependencies.onProgress,
        phase: "initial",
        rootIndex: (index + 1) as 1 | 2,
      })
    ));
  }
  for (const [index, tree] of initial.entries()) {
    normalizedTreeVerification(
      tree,
      roots[index]!,
      expectedContentRootSha256,
    );
  }
  assertCacheTreesInodeDistinct(initial[0]!, initial[1]!);
  await dependencies.betweenScans?.();

  const terminal = [] as NormalizedTree[];
  for (const [index, root] of roots.entries()) {
    terminal.push(await boundedCacheScan({
      phase: "terminal",
      root,
      timeoutMs: resolveCacheScanTimeoutMs(dependencies.scanTimeoutMs),
      monotonicNowMs: dependencies.monotonicNowMs,
    }, (control) =>
      scanNormalizedTree(root, {
        control,
        onProgress: dependencies.onProgress,
        phase: "terminal",
        rootIndex: (index + 1) as 1 | 2,
      })
    ));
  }
  for (const index of [0, 1] as const) {
    if (!sameNormalizedTree(initial[index]!, terminal[index]!)) {
      throw new Error(
        "C6 paired materialized source dependency cache changed during verification",
      );
    }
    await boundedCacheScan({
      phase: "terminal-stats",
      root: roots[index]!,
      timeoutMs: resolveCacheScanTimeoutMs(dependencies.scanTimeoutMs),
      monotonicNowMs: dependencies.monotonicNowMs,
    }, (control) =>
      assertTerminalNormalizedTreeStats(
        roots[index]!,
        terminal[index]!.statByPath,
        {
          control,
          onProgress: dependencies.onProgress,
          phase: "terminal-stats",
          rootIndex: (index + 1) as 1 | 2,
        },
      )
    );
    await assertDirectoryIdentity(
      roots[index]!,
      rootIdentities[index]!,
      "C6 paired materialized source dependency cache root",
    );
  }
  assertCacheTreesInodeDistinct(terminal[0]!, terminal[1]!);
  const results = terminal.map((tree, index) =>
    normalizedTreeVerification(
      tree,
      roots[index]!,
      expectedContentRootSha256,
    )
  ) as [
    C6PackageSourceDependencyCacheVerification,
    C6PackageSourceDependencyCacheVerification,
  ];
  return {
    first: results[0],
    pairVerified: true,
    second: results[1],
  };
}

function assertCacheTreesInodeDistinct(
  first: NormalizedTree,
  second: NormalizedTree,
): void {
  for (const identity of first.inodeIdentities) {
    if (second.inodeIdentities.has(identity)) {
      throw new Error(
        "C6 paired materialized source dependency caches share a file inode",
      );
    }
  }
}

function normalizedTreeVerification(
  tree: NormalizedTree,
  outputRoot: string,
  expectedContentRootSha256: string,
): C6PackageSourceDependencyCacheVerification {
  const manifest = Buffer.from(serializeCacheManifest(tree.entries));
  const cacheContentRootSha256 = computeCacheContentRoot(manifest);
  if (cacheContentRootSha256 !== expectedContentRootSha256) {
    throw new Error(
      "C6 paired materialized source dependency cache content identity does not match",
    );
  }
  const cacheFileCount = tree.entries.filter((entry) =>
    entry.type === "file"
  ).length;
  return {
    cacheContentRootSha256,
    cacheDirectoryCount: tree.entries.length - cacheFileCount,
    cacheEntryCount: tree.entries.length,
    cacheFileCount,
    outputRoot,
    treeVerified: true,
  };
}

interface CacheScanControl {
  deadlineMs: number;
  input: {
    phase: C6PackageSourceCacheScanProgress["phase"];
    root: string;
    timeoutMs: number;
  };
  monotonicNowMs: () => number;
  timeoutError?: C6PackageSourceCacheScanTimeoutError;
}

async function boundedCacheScan<T>(
  input: {
    monotonicNowMs?: () => number;
    phase: C6PackageSourceCacheScanProgress["phase"];
    root: string;
    timeoutMs: number;
  },
  scan: (control: CacheScanControl) => Promise<T>,
): Promise<T> {
  const monotonicNowMs = input.monotonicNowMs ??
    (() => performance.now());
  const control: CacheScanControl = {
    deadlineMs: monotonicNowMs() + input.timeoutMs,
    input,
    monotonicNowMs,
  };
  if (input.timeoutMs === 0) {
    const error = new C6PackageSourceCacheScanTimeoutError(input);
    control.timeoutError = error;
    throw error;
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        const error = new C6PackageSourceCacheScanTimeoutError(input);
        control.timeoutError = error;
        reject(error);
      }, input.timeoutMs);
    });
    return await Promise.race([
      deadline,
      scan(control),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function resolveCacheScanTimeoutMs(value: number | undefined): number {
  const timeoutMs = value ?? SCAN_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) {
    throw new Error(
      "C6 source dependency cache scan timeout must be a non-negative safe integer",
    );
  }
  return timeoutMs;
}

function assertCacheScanActive(control?: CacheScanControl): void {
  if (
    control !== undefined &&
    control.timeoutError === undefined &&
    control.monotonicNowMs() >= control.deadlineMs
  ) {
    control.timeoutError = new C6PackageSourceCacheScanTimeoutError(
      control.input,
    );
  }
  if (control?.timeoutError !== undefined) {
    throw control.timeoutError;
  }
}

async function validateClosure(input: {
  closureRoot: string;
  expected: C6PackageSourceDependencyClosureExpectedIdentity;
}): Promise<ValidatedClosure> {
  const expected = expectedIdentitySchema.parse(input.expected);
  const closureRoot = await canonicalExistingDirectory(
    input.closureRoot,
    "C6 source dependency closure root",
  );
  const closureIdentity = await directoryIdentity(closureRoot);
  await assertExactClosureLayout(closureRoot);
  const assetLock = await loadC6AssetLock(closureRoot);
  if (
    assetLock.assetLockSha256 !== expected.assetLockSha256 ||
    assetLock.assetLock.assetRootSha256 !== expected.assetRootSha256
  ) {
    throw new Error(
      "C6 source dependency closure asset identity does not match",
    );
  }
  const lockedPaths = assetLock.assetLock.files.map((file) => file.path);
  if (
    !sameJson(lockedPaths, [
      CACHE_ARCHIVE_PATH,
      CACHE_MANIFEST_PATH,
      CLOSURE_PATH,
    ])
  ) {
    throw new Error(
      "C6 source dependency closure asset set is inconsistent",
    );
  }

  const closureBytes = await readC6StableRegularFile(
    join(closureRoot, CLOSURE_PATH),
    "source dependency closure manifest",
  );
  const closure = parseCanonicalClosure(closureBytes);
  const manifestBytes = await readC6StableRegularFile(
    join(closureRoot, CACHE_MANIFEST_PATH),
    "source dependency cache tree manifest",
  );
  const entries = parseCacheManifest(manifestBytes);
  const archiveBytes = await readC6StableRegularFile(
    join(closureRoot, CACHE_ARCHIVE_PATH),
    "source dependency cache archive",
  );
  const archiveEntries = parseCacheArchive(archiveBytes);
  const archiveManifestEntries = archiveEntries.map(toArchiveCacheEntry);
  const cacheArchiveSha256 = sha256(archiveBytes);
  const cacheManifestSha256 = sha256(manifestBytes);
  const cacheContentRootSha256 = computeCacheContentRoot(manifestBytes);
  const cacheFileCount = entries.filter((entry) =>
    entry.type === "file"
  ).length;
  const cacheDirectoryCount = entries.length - cacheFileCount;

  if (
    cacheArchiveSha256 !== expected.cacheArchiveSha256 ||
    cacheManifestSha256 !== expected.cacheManifestSha256 ||
    cacheContentRootSha256 !== expected.cacheContentRootSha256 ||
    closure.cache.archive.sha256 !== expected.cacheArchiveSha256 ||
    closure.cache.manifest.sha256 !== expected.cacheManifestSha256 ||
    closure.cache.contentRootSha256 !== expected.cacheContentRootSha256
  ) {
    throw new Error(
      "C6 source dependency closure cache identity does not match",
    );
  }
  if (
    closure.cache.archive.bytes !== archiveBytes.byteLength ||
    closure.cache.manifest.bytes !== manifestBytes.byteLength ||
    closure.cache.entryCount !== entries.length ||
    closure.cache.fileCount !== cacheFileCount ||
    closure.cache.directoryCount !== cacheDirectoryCount ||
    serializeCacheManifest(archiveManifestEntries) !==
      serializeCacheManifest(entries)
  ) {
    throw new Error(
      "C6 source dependency closure cache semantics do not match",
    );
  }

  await verifyC6AssetClosure(closureRoot, assetLock);
  await assertExactClosureLayout(closureRoot);
  await assertDirectoryIdentity(
    closureRoot,
    closureIdentity,
    "C6 source dependency closure root",
  );
  return {
    archiveEntries,
    assetLock,
    closure,
    closureIdentity,
    closureRoot,
    entries,
    expected,
  };
}

async function captureAcquisitionCache(
  root: string,
): Promise<CapturedEntry[]> {
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(
      "C6 source dependency acquisition cache root must be a directory",
    );
  }
  const entries: CapturedEntry[] = [];
  const seenPaths = new Set<string>();
  const directoryStack = new Set([inodeIdentity(rootStat)]);
  await captureDirectoryContents({
    directoryStack,
    entries,
    logicalRoot: "",
    root,
    seenPaths,
    sourceRoot: root,
  });
  const terminalRootStat = await lstat(root);
  if (!sameStableStat(rootStat, terminalRootStat)) {
    throw new Error(
      "C6 source dependency acquisition cache root changed during scan",
    );
  }
  entries.sort((left, right) => compareUtf8(left.path, right.path));
  assertManifestParents(entries.map(toCacheEntry));
  return entries;
}

async function captureDirectoryContents(input: {
  directoryStack: Set<string>;
  entries: CapturedEntry[];
  logicalRoot: string;
  root: string;
  seenPaths: Set<string>;
  sourceRoot: string;
}): Promise<void> {
  const before = await lstat(input.sourceRoot);
  if (!before.isDirectory()) {
    throw new Error(
      `C6 source dependency cache rejects non-directory ${input.logicalRoot}`,
    );
  }
  const children = await readdir(input.sourceRoot, { withFileTypes: true });
  children.sort((left, right) => compareUtf8(left.name, right.name));
  for (const child of children) {
    const logicalPath = input.logicalRoot.length === 0
      ? child.name
      : `${input.logicalRoot}/${child.name}`;
    await captureNode({
      ...input,
      logicalPath,
      sourcePath: join(input.sourceRoot, child.name),
    });
  }
  const after = await lstat(input.sourceRoot);
  if (!sameStableStat(before, after)) {
    throw new Error(
      `C6 source dependency cache directory changed ${input.logicalRoot}`,
    );
  }
}

async function captureNode(input: {
  directoryStack: Set<string>;
  entries: CapturedEntry[];
  logicalPath: string;
  root: string;
  seenPaths: Set<string>;
  sourcePath: string;
}): Promise<void> {
  assertSafeCachePath(input.logicalPath);
  const stat = await lstat(input.sourcePath);
  if (stat.isSymbolicLink()) {
    const targetPath = await resolveAcquisitionSymlink(
      input.root,
      input.sourcePath,
    );
    const targetStat = await lstat(targetPath);
    if (targetStat.isSymbolicLink()) {
      throw new Error(
        `C6 source dependency cache rejects symlink chain ${input.logicalPath}`,
      );
    }
    await captureResolvedNode({
      ...input,
      sourcePath: targetPath,
      stat: targetStat,
    });
    return;
  }
  await captureResolvedNode({
    ...input,
    stat,
  });
}

async function captureResolvedNode(input: {
  directoryStack: Set<string>;
  entries: CapturedEntry[];
  logicalPath: string;
  root: string;
  seenPaths: Set<string>;
  sourcePath: string;
  stat: Stats;
}): Promise<void> {
  if (input.seenPaths.has(input.logicalPath)) {
    throw new Error(
      `C6 source dependency cache path collision ${input.logicalPath}`,
    );
  }
  input.seenPaths.add(input.logicalPath);
  if (input.stat.isDirectory()) {
    const identity = inodeIdentity(input.stat);
    if (input.directoryStack.has(identity)) {
      throw new Error(
        `C6 source dependency cache rejects symlink cycle ${input.logicalPath}`,
      );
    }
    input.entries.push({
      mode: DIRECTORY_MODE,
      path: input.logicalPath,
      sourcePath: input.sourcePath,
      type: "directory",
    });
    const directoryStack = new Set(input.directoryStack);
    directoryStack.add(identity);
    await captureDirectoryContents({
      directoryStack,
      entries: input.entries,
      logicalRoot: input.logicalPath,
      root: input.root,
      seenPaths: input.seenPaths,
      sourceRoot: input.sourcePath,
    });
    return;
  }
  if (!input.stat.isFile()) {
    throw new Error(
      `C6 source dependency cache rejects special file ${input.logicalPath}`,
    );
  }
  const stable = await readStableFile(
    input.sourcePath,
    `C6 source dependency cache file ${input.logicalPath}`,
  );
  input.entries.push({
    bytes: stable.bytes.byteLength,
    mode: normalizedFileMode(stable.mode),
    path: input.logicalPath,
    sha256: sha256(stable.bytes),
    sourcePath: input.sourcePath,
    type: "file",
  });
}

async function resolveAcquisitionSymlink(
  root: string,
  sourcePath: string,
): Promise<string> {
  const before = await lstat(sourcePath);
  if (!before.isSymbolicLink()) {
    throw new Error("C6 source dependency cache symlink changed during read");
  }
  const target = await readlink(sourcePath);
  const after = await lstat(sourcePath);
  if (!sameStableStat(before, after)) {
    throw new Error(
      "C6 source dependency cache symlink changed during read",
    );
  }
  const prefix = ALLOWED_SYMLINK_PREFIXES.find((candidate) =>
    target === candidate || target.startsWith(`${candidate}/`)
  );
  if (prefix === undefined) {
    throw new Error(
      `C6 source dependency cache symlink escapes allowed roots ${target}`,
    );
  }
  const relativeTarget = target.slice(prefix.length).replace(/^\/+/u, "");
  if (relativeTarget.length === 0) {
    throw new Error(
      "C6 source dependency cache symlink must not target the cache root",
    );
  }
  assertSafeCachePath(relativeTarget);
  const components = relativeTarget.split("/");
  let targetPath = root;
  for (const [index, component] of components.entries()) {
    targetPath = join(targetPath, component);
    let stat: Stats;
    try {
      stat = await lstat(targetPath);
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        throw new Error(
          `C6 source dependency cache symlink target is missing ${target}`,
        );
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(
        `C6 source dependency cache rejects symlink chain ${target}`,
      );
    }
    if (index < components.length - 1 && !stat.isDirectory()) {
      throw new Error(
        `C6 source dependency cache symlink target component is not a directory ${target}`,
      );
    }
  }
  return targetPath;
}

async function writeDeterministicCacheArchive(
  path: string,
  entries: readonly CapturedEntry[],
): Promise<void> {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL |
    constants.O_WRONLY, REGULAR_FILE_MODE);
  try {
    for (const entry of entries) {
      const cacheEntry = toCacheEntry(entry);
      await writeAll(handle, createTarHeader(cacheEntry));
      if (entry.type === "directory") {
        continue;
      }
      const source = await readStableFile(
        entry.sourcePath,
        `C6 source dependency archive file ${entry.path}`,
      );
      if (
        source.bytes.byteLength !== entry.bytes ||
        sha256(source.bytes) !== entry.sha256 ||
        normalizedFileMode(source.mode) !== entry.mode
      ) {
        throw new Error(
          `C6 source dependency cache file changed during archive ${entry.path}`,
        );
      }
      await writeAll(handle, source.bytes);
      const padding = tarPadding(source.bytes.byteLength);
      if (padding > 0) {
        await writeAll(handle, Buffer.alloc(padding));
      }
    }
    await writeAll(handle, Buffer.alloc(TAR_END_BYTES));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(path, REGULAR_FILE_MODE);
}

function parseCacheArchive(bytes: Buffer): ArchiveEntry[] {
  if (
    bytes.byteLength < TAR_END_BYTES ||
    bytes.byteLength % TAR_BLOCK_BYTES !== 0
  ) {
    throw new Error("C6 source dependency cache archive is truncated");
  }
  const entries: ArchiveEntry[] = [];
  const paths = new Set<string>();
  let offset = 0;
  while (offset < bytes.byteLength) {
    const header = bytes.subarray(offset, offset + TAR_BLOCK_BYTES);
    if (header.every((value) => value === 0)) {
      const remaining = bytes.subarray(offset);
      if (
        remaining.byteLength !== TAR_END_BYTES ||
        !remaining.every((value) => value === 0)
      ) {
        throw new Error(
          "C6 source dependency cache archive has a non-canonical trailer",
        );
      }
      offset = bytes.byteLength;
      break;
    }
    const path = readTarPath(header);
    assertSafeCachePath(path);
    if (paths.has(path)) {
      throw new Error(
        `C6 source dependency cache archive duplicates ${path}`,
      );
    }
    paths.add(path);
    const type = String.fromCharCode(header[156] ?? 0);
    const mode = readTarOctal(header.subarray(100, 108), "mode");
    const size = readTarOctal(header.subarray(124, 136), "size");
    const dataStart = offset + TAR_BLOCK_BYTES;
    const dataEnd = dataStart + size;
    const paddedEnd = dataEnd + tarPadding(size);
    if (paddedEnd > bytes.byteLength - TAR_END_BYTES) {
      throw new Error("C6 source dependency cache archive entry is truncated");
    }
    const padding = bytes.subarray(dataEnd, paddedEnd);
    if (!padding.every((value) => value === 0)) {
      throw new Error(
        "C6 source dependency cache archive has non-zero padding",
      );
    }
    if (type === "5") {
      const entry: ArchiveDirectoryEntry = {
        mode: directoryEntrySchema.shape.mode.parse(mode),
        path,
        type: "directory",
      };
      if (
        size !== 0 ||
        !header.equals(createTarHeader(entry))
      ) {
        throw new Error(
          `C6 source dependency cache archive directory is non-canonical ${path}`,
        );
      }
      entries.push(entry);
    } else if (type === "0") {
      const entry: ArchiveFileEntry = {
        bytes: bytes.subarray(dataStart, dataEnd),
        mode: fileEntrySchema.shape.mode.parse(mode),
        path,
        sha256: sha256(bytes.subarray(dataStart, dataEnd)),
        type: "file",
      };
      if (!header.equals(createTarHeader(toArchiveCacheEntry(entry)))) {
        throw new Error(
          `C6 source dependency cache archive file is non-canonical ${path}`,
        );
      }
      entries.push(entry);
    } else {
      throw new Error(
        `C6 source dependency cache archive rejects entry type ${type}`,
      );
    }
    offset = paddedEnd;
  }
  if (offset !== bytes.byteLength) {
    throw new Error("C6 source dependency cache archive is incomplete");
  }
  const sortedPaths = entries.map((entry) => entry.path)
    .sort(compareUtf8);
  if (!sameJson(entries.map((entry) => entry.path), sortedPaths)) {
    throw new Error(
      "C6 source dependency cache archive entries are not sorted",
    );
  }
  assertManifestParents(entries.map(toArchiveCacheEntry));
  return entries;
}

function createTarHeader(entry: CacheEntry): Buffer {
  const header = Buffer.alloc(TAR_BLOCK_BYTES);
  const tarPath = splitTarPath(entry.path);
  writeTarText(header, 0, 100, tarPath.name);
  writeTarOctal(header, 100, 8, entry.mode);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(
    header,
    124,
    12,
    entry.type === "file" ? entry.bytes : 0,
  );
  writeTarOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = entry.type === "file" ? 0x30 : 0x35;
  writeTarText(header, 257, 6, "ustar");
  writeTarText(header, 263, 2, "00");
  writeTarText(header, 265, 32, "root");
  writeTarText(header, 297, 32, "root");
  writeTarOctal(header, 329, 8, 0);
  writeTarOctal(header, 337, 8, 0);
  writeTarText(header, 345, 155, tarPath.prefix);
  const checksum = header.reduce((total, value) => total + value, 0);
  const checksumText = checksum.toString(8).padStart(6, "0");
  writeTarText(header, 148, 6, checksumText);
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function splitTarPath(path: string): { name: string; prefix: string } {
  const bytes = Buffer.byteLength(path);
  if (bytes <= 100) {
    return { name: path, prefix: "" };
  }
  const separators = [...path.matchAll(/\//gu)].map((match) => match.index);
  for (const index of separators.reverse()) {
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (
      Buffer.byteLength(prefix) <= 155 &&
      Buffer.byteLength(name) <= 100
    ) {
      return { name, prefix };
    }
  }
  throw new Error(
    `C6 source dependency cache path exceeds USTAR limits ${path}`,
  );
}

function readTarPath(header: Buffer): string {
  const name = readTarText(header.subarray(0, 100), "name");
  const prefix = readTarText(header.subarray(345, 500), "prefix");
  if (name.length === 0) {
    throw new Error("C6 source dependency cache archive has an empty path");
  }
  return prefix.length === 0 ? name : `${prefix}/${name}`;
}

function readTarText(bytes: Buffer, label: string): string {
  const end = bytes.indexOf(0);
  const content = end < 0 ? bytes : bytes.subarray(0, end);
  if (
    end >= 0 &&
    !bytes.subarray(end).every((value) => value === 0)
  ) {
    throw new Error(
      `C6 source dependency cache archive ${label} is non-canonical`,
    );
  }
  const text = content.toString("utf8");
  if (!Buffer.from(text).equals(content)) {
    throw new Error(
      `C6 source dependency cache archive ${label} is not UTF-8`,
    );
  }
  return text;
}

function readTarOctal(bytes: Buffer, label: string): number {
  const text = readTarText(bytes, label).trim();
  if (!/^[0-7]+$/u.test(text)) {
    throw new Error(
      `C6 source dependency cache archive ${label} is not octal`,
    );
  }
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `C6 source dependency cache archive ${label} is out of range`,
    );
  }
  return value;
}

function writeTarText(
  target: Buffer,
  offset: number,
  length: number,
  value: string,
): void {
  const bytes = Buffer.from(value);
  if (bytes.byteLength > length) {
    throw new Error("C6 source dependency cache USTAR field is too long");
  }
  bytes.copy(target, offset);
}

function writeTarOctal(
  target: Buffer,
  offset: number,
  length: number,
  value: number,
): void {
  const text = value.toString(8);
  if (text.length > length - 1) {
    throw new Error("C6 source dependency cache USTAR number is too large");
  }
  writeTarText(
    target,
    offset,
    length - 1,
    text.padStart(length - 1, "0"),
  );
}

interface CacheScanProgressContext {
  control?: CacheScanControl;
  onProgress?: (progress: C6PackageSourceCacheScanProgress) => void;
  phase: C6PackageSourceCacheScanProgress["phase"];
  rootIndex: 1 | 2;
}

interface CacheScanProgressTracker extends CacheScanProgressContext {
  entriesScanned: number;
}

async function scanNormalizedTree(
  root: string,
  progress?: CacheScanProgressContext,
): Promise<NormalizedTree> {
  const entries: CacheEntry[] = [];
  const inodeIdentities = new Set<string>();
  const statByPath = new Map<string, StableStatIdentity>();
  const tracker = createCacheScanProgressTracker(progress);
  assertCacheScanActive(tracker?.control);
  await scanNormalizedDirectory(
    root,
    "",
    entries,
    inodeIdentities,
    statByPath,
    tracker,
  );
  assertCacheScanActive(tracker?.control);
  entries.sort((left, right) => compareUtf8(left.path, right.path));
  assertManifestParents(entries);
  completeCacheScanProgress(tracker);
  return { entries, inodeIdentities, statByPath };
}

async function assertTerminalNormalizedTreeStats(
  root: string,
  expected: ReadonlyMap<string, StableStatIdentity>,
  progress?: CacheScanProgressContext,
): Promise<void> {
  const actual = new Map<string, StableStatIdentity>();
  const tracker = createCacheScanProgressTracker(progress);
  assertCacheScanActive(tracker?.control);
  await scanNormalizedTreeStats(root, "", actual, tracker);
  completeCacheScanProgress(tracker);
  if (!sameStatMap(actual, expected)) {
    throw new Error(
      "C6 materialized source dependency cache changed during verification",
    );
  }
}

async function scanNormalizedTreeStats(
  root: string,
  logicalRoot: string,
  stats: Map<string, StableStatIdentity>,
  progress?: CacheScanProgressTracker,
): Promise<void> {
  assertCacheScanActive(progress?.control);
  const before = await lstat(root);
  assertCacheScanActive(progress?.control);
  if (!before.isDirectory() || (before.mode & 0o777) !== DIRECTORY_MODE) {
    throw new Error(
      `C6 materialized source dependency cache rejects directory ${logicalRoot}`,
    );
  }
  const children = await readdir(root, { withFileTypes: true });
  assertCacheScanActive(progress?.control);
  children.sort((left, right) => compareUtf8(left.name, right.name));
  for (const child of children) {
    assertCacheScanActive(progress?.control);
    const path = logicalRoot.length === 0
      ? child.name
      : `${logicalRoot}/${child.name}`;
    assertSafeCachePath(path);
    const absolutePath = join(root, child.name);
    const stat = await lstat(absolutePath);
    assertCacheScanActive(progress?.control);
    if (stat.isSymbolicLink()) {
      throw new Error(
        `C6 materialized source dependency cache rejects symlink ${path}`,
      );
    }
    if (stat.isDirectory()) {
      advanceCacheScanProgress(progress);
      await scanNormalizedTreeStats(
        absolutePath,
        path,
        stats,
        progress,
      );
      continue;
    }
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o777) !== normalizedFileMode(stat.mode)
    ) {
      throw new Error(
        `C6 materialized source dependency cache rejects drift ${path}`,
      );
    }
    stats.set(path, stableStatIdentity(stat));
    advanceCacheScanProgress(progress);
  }
  const after = await lstat(root);
  assertCacheScanActive(progress?.control);
  if (!sameStableStat(before, after)) {
    throw new Error(
      `C6 materialized source dependency cache directory changed ${logicalRoot}`,
    );
  }
  stats.set(
    logicalRoot.length === 0 ? "." : logicalRoot,
    stableStatIdentity(after),
  );
}

async function scanNormalizedDirectory(
  root: string,
  logicalRoot: string,
  entries: CacheEntry[],
  inodeIdentities: Set<string>,
  statByPath: Map<string, StableStatIdentity>,
  progress?: CacheScanProgressTracker,
): Promise<void> {
  assertCacheScanActive(progress?.control);
  const before = await lstat(root);
  assertCacheScanActive(progress?.control);
  if (!before.isDirectory() || (before.mode & 0o777) !== DIRECTORY_MODE) {
    throw new Error(
      `C6 materialized source dependency cache rejects directory ${logicalRoot}`,
    );
  }
  const children = await readdir(root, { withFileTypes: true });
  assertCacheScanActive(progress?.control);
  children.sort((left, right) => compareUtf8(left.name, right.name));
  for (const child of children) {
    assertCacheScanActive(progress?.control);
    const path = logicalRoot.length === 0
      ? child.name
      : `${logicalRoot}/${child.name}`;
    assertSafeCachePath(path);
    const absolutePath = join(root, child.name);
    const stat = await lstat(absolutePath);
    assertCacheScanActive(progress?.control);
    if (stat.isSymbolicLink()) {
      throw new Error(
        `C6 materialized source dependency cache rejects symlink ${path}`,
      );
    }
    if (stat.isDirectory()) {
      if ((stat.mode & 0o777) !== DIRECTORY_MODE) {
        throw new Error(
          `C6 materialized source dependency cache directory mode drifted ${path}`,
        );
      }
      entries.push({
        mode: DIRECTORY_MODE,
        path,
        type: "directory",
      });
      advanceCacheScanProgress(progress);
      await scanNormalizedDirectory(
        absolutePath,
        path,
        entries,
        inodeIdentities,
        statByPath,
        progress,
      );
      continue;
    }
    if (!stat.isFile() || stat.nlink !== 1) {
      throw new Error(
        `C6 materialized source dependency cache rejects special file or hardlink ${path}`,
      );
    }
    const identity = inodeIdentity(stat);
    if (inodeIdentities.has(identity)) {
      throw new Error(
        `C6 materialized source dependency cache shares a file inode ${path}`,
      );
    }
    inodeIdentities.add(identity);
    const file = await readStableFile(
      absolutePath,
      `C6 materialized source dependency cache file ${path}`,
      progress?.control,
    );
    assertCacheScanActive(progress?.control);
    statByPath.set(path, file.stat);
    const mode = normalizedFileMode(file.mode);
    if ((file.mode & 0o777) !== mode) {
      throw new Error(
        `C6 materialized source dependency cache file mode drifted ${path}`,
      );
    }
    entries.push({
      bytes: file.bytes.byteLength,
      mode,
      path,
      sha256: sha256(file.bytes),
      type: "file",
    });
    advanceCacheScanProgress(progress);
  }
  const after = await lstat(root);
  assertCacheScanActive(progress?.control);
  if (!sameStableStat(before, after)) {
    throw new Error(
      `C6 materialized source dependency cache directory changed ${logicalRoot}`,
    );
  }
  statByPath.set(
    logicalRoot.length === 0 ? "." : logicalRoot,
    stableStatIdentity(after),
  );
}

function createCacheScanProgressTracker(
  context?: CacheScanProgressContext,
): CacheScanProgressTracker | undefined {
  if (context === undefined) {
    return undefined;
  }
  assertCacheScanActive(context.control);
  const tracker = {
    ...context,
    entriesScanned: 0,
  };
  tracker.onProgress?.({
    entriesScanned: 0,
    phase: tracker.phase,
    rootIndex: tracker.rootIndex,
    status: "start",
  });
  return tracker;
}

function advanceCacheScanProgress(
  tracker?: CacheScanProgressTracker,
): void {
  if (tracker === undefined) {
    return;
  }
  assertCacheScanActive(tracker.control);
  tracker.entriesScanned += 1;
  if (
    tracker.entriesScanned % SCAN_HEARTBEAT_ENTRY_INTERVAL === 0
  ) {
    tracker.onProgress?.({
      entriesScanned: tracker.entriesScanned,
      phase: tracker.phase,
      rootIndex: tracker.rootIndex,
      status: "heartbeat",
    });
  }
}

function completeCacheScanProgress(
  tracker?: CacheScanProgressTracker,
): void {
  if (tracker === undefined) {
    return;
  }
  assertCacheScanActive(tracker.control);
  tracker.onProgress?.({
    entriesScanned: tracker.entriesScanned,
    phase: tracker.phase,
    rootIndex: tracker.rootIndex,
    status: "complete",
  });
}

function serializeCacheManifest(entries: readonly CacheEntry[]): string {
  const canonical = entries.map((entry) =>
    cacheEntrySchema.parse(entry)
  ).sort((left, right) => compareUtf8(left.path, right.path));
  assertUniqueManifestPaths(canonical);
  return canonical.length === 0
    ? ""
    : `${canonical.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

function parseCacheManifest(bytes: Buffer): CacheEntry[] {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes)) {
    throw new Error(
      "C6 source dependency cache manifest is not valid UTF-8",
    );
  }
  if (text.length === 0) {
    return [];
  }
  if (!text.endsWith("\n")) {
    throw new Error(
      "C6 source dependency cache manifest is not canonical JSONL",
    );
  }
  const lines = text.slice(0, -1).split("\n");
  if (lines.some((line) => line.length === 0)) {
    throw new Error(
      "C6 source dependency cache manifest is not canonical JSONL",
    );
  }
  const entries = lines.map((line) => {
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      throw new Error(
        "C6 source dependency cache manifest contains invalid JSON",
      );
    }
    return cacheEntrySchema.parse(value);
  });
  if (serializeCacheManifest(entries) !== text) {
    throw new Error(
      "C6 source dependency cache manifest is not canonical JSONL",
    );
  }
  for (const entry of entries) {
    assertSafeCachePath(entry.path);
  }
  assertManifestParents(entries);
  return entries;
}

function parseCanonicalClosure(bytes: Buffer): Closure {
  const text = bytes.toString("utf8");
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("C6 source dependency closure manifest is invalid JSON");
  }
  const closure = closureSchema.parse(value);
  if (serializeClosure(closure) !== text) {
    throw new Error(
      "C6 source dependency closure manifest is not canonical JSON",
    );
  }
  return closure;
}

function serializeClosure(closure: Closure): string {
  return `${JSON.stringify(closureSchema.parse(closure), null, 2)}\n`;
}

function computeCacheContentRoot(manifestBytes: Buffer): string {
  return sha256(Buffer.concat([
    Buffer.from(CONTENT_ROOT_DOMAIN),
    manifestBytes,
  ]));
}

function toCacheEntry(entry: CapturedEntry): CacheEntry {
  return entry.type === "directory"
    ? {
        mode: entry.mode,
        path: entry.path,
        type: entry.type,
      }
    : {
        bytes: entry.bytes,
        mode: entry.mode,
        path: entry.path,
        sha256: entry.sha256,
        type: entry.type,
      };
}

function toArchiveCacheEntry(entry: ArchiveEntry): CacheEntry {
  return entry.type === "directory"
    ? entry
    : {
        bytes: entry.bytes.byteLength,
        mode: entry.mode,
        path: entry.path,
        sha256: entry.sha256,
        type: entry.type,
      };
}

function assertManifestParents(entries: readonly CacheEntry[]): void {
  assertUniqueManifestPaths(entries);
  const types = new Map(entries.map((entry) => [entry.path, entry.type]));
  for (const entry of entries) {
    const parent = posix.dirname(entry.path);
    if (parent !== "." && types.get(parent) !== "directory") {
      throw new Error(
        `C6 source dependency cache manifest parent is missing ${entry.path}`,
      );
    }
  }
}

function assertUniqueManifestPaths(entries: readonly CacheEntry[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    assertSafeCachePath(entry.path);
    if (seen.has(entry.path)) {
      throw new Error(
        `C6 source dependency cache manifest duplicates ${entry.path}`,
      );
    }
    seen.add(entry.path);
  }
}

function assertSafeCachePath(path: string): void {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    /[\0\r\n]/u.test(path) ||
    posix.normalize(path) !== path ||
    path.split("/").some((part) =>
      part.length === 0 || part === "." || part === ".."
    )
  ) {
    throw new Error(`C6 source dependency cache path is unsafe ${path}`);
  }
  splitTarPath(path);
}

async function assertExactClosureLayout(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  entries.sort((left, right) => compareUtf8(left.name, right.name));
  if (!sameJson(entries.map((entry) => entry.name), CLOSURE_PATHS)) {
    throw new Error(
      "C6 source dependency closure layout has missing or extra entries",
    );
  }
  for (const entry of entries) {
    const stat = await lstat(join(root, entry.name));
    if (
      entry.isSymbolicLink() ||
      !entry.isFile() ||
      !stat.isFile() ||
      stat.nlink !== 1
    ) {
      throw new Error(
        `C6 source dependency closure rejects symlink or hardlink ${entry.name}`,
      );
    }
  }
}

async function readStableFile(
  path: string,
  label: string,
  control?: CacheScanControl,
): Promise<{
  bytes: Buffer;
  mode: number;
  stat: StableStatIdentity;
}> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`${label} rejects non-regular file`);
  }
  const descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      !sameStableStat(before, opened)
    ) {
      throw new Error(`${label} changed before read`);
    }
    const bytes = readFileDescriptorExact(
      descriptor,
      opened.size,
      control,
    );
    const after = fstatSync(descriptor);
    const terminalPath = await lstat(path);
    if (
      !sameStableStat(opened, after) ||
      !sameStableStat(after, terminalPath) ||
      bytes.byteLength !== after.size
    ) {
      throw new Error(`${label} changed while being read`);
    }
    return {
      bytes,
      mode: after.mode,
      stat: stableStatIdentity(after),
    };
  } finally {
    closeSync(descriptor);
  }
}

function readFileDescriptorExact(
  descriptor: number,
  size: number,
  control?: CacheScanControl,
): Buffer {
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    assertCacheScanActive(control);
    const bytesRead = readSync(
      descriptor,
      bytes,
      offset,
      Math.min(FILE_READ_CHUNK_BYTES, size - offset),
      offset,
    );
    assertCacheScanActive(control);
    if (bytesRead === 0) {
      throw new Error("C6 source dependency cache file read stalled");
    }
    offset += bytesRead;
  }
  assertCacheScanActive(control);
  return bytes;
}

async function writeNormalizedFile(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  await writeFile(path, bytes, {
    flag: "wx",
    mode: REGULAR_FILE_MODE,
  });
  await chmod(path, REGULAR_FILE_MODE);
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(
      bytes,
      offset,
      bytes.byteLength - offset,
      null,
    );
    if (result.bytesWritten === 0) {
      throw new Error("C6 source dependency cache archive write stalled");
    }
    offset += result.bytesWritten;
  }
}

function normalizedFileMode(mode: number):
  typeof EXECUTABLE_FILE_MODE | typeof REGULAR_FILE_MODE {
  return (mode & 0o111) === 0
    ? REGULAR_FILE_MODE
    : EXECUTABLE_FILE_MODE;
}

function tarPadding(bytes: number): number {
  return (TAR_BLOCK_BYTES - (bytes % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function inodeIdentity(stat: {
  dev: number;
  ino: number;
}): string {
  return `${stat.dev}:${stat.ino}`;
}

function sameStableStat(
  left: {
    ctimeMs: number;
    dev: number;
    ino: number;
    mode: number;
    mtimeMs: number;
    nlink: number;
    size: number;
  },
  right: {
    ctimeMs: number;
    dev: number;
    ino: number;
    mode: number;
    mtimeMs: number;
    nlink: number;
    size: number;
  },
): boolean {
  return left.ctimeMs === right.ctimeMs &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.mtimeMs === right.mtimeMs &&
    left.nlink === right.nlink &&
    left.size === right.size;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameNormalizedTree(
  left: NormalizedTree,
  right: NormalizedTree,
): boolean {
  return serializeCacheManifest(left.entries) ===
      serializeCacheManifest(right.entries) &&
    sameStatMap(left.statByPath, right.statByPath);
}

function stableStatIdentity(stat: StableStatIdentity): StableStatIdentity {
  return {
    ctimeMs: stat.ctimeMs,
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    mtimeMs: stat.mtimeMs,
    nlink: stat.nlink,
    size: stat.size,
  };
}

function sameStatMap(
  left: ReadonlyMap<string, StableStatIdentity>,
  right: ReadonlyMap<string, StableStatIdentity>,
): boolean {
  const canonical = (
    value: ReadonlyMap<string, StableStatIdentity>,
  ) => [...value.entries()].sort(([leftPath], [rightPath]) =>
    compareUtf8(leftPath, rightPath)
  );
  return sameJson(canonical(left), canonical(right));
}

async function canonicalExistingDirectory(
  path: string,
  label: string,
): Promise<string> {
  const resolved = await assertC6NoSymlinkPathComponents(path, label);
  if (!(await lstat(resolved)).isDirectory()) {
    throw new Error(`${label} must be a directory`);
  }
  return resolved;
}

async function canonicalNewDirectoryPath(
  path: string,
  label: string,
): Promise<string> {
  const resolved = resolve(path);
  const parent = await assertC6NoSymlinkPathComponents(dirname(resolved), label);
  if (!(await lstat(parent)).isDirectory()) {
    throw new Error(`${label} parent must be a directory`);
  }
  try {
    await lstat(resolved);
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return join(parent, basename(resolved));
    }
    throw error;
  }
  throw new Error(`${label} already exists`);
}

async function directoryIdentity(path: string): Promise<DirectoryIdentity> {
  const stat = await lstat(path);
  if (!stat.isDirectory()) {
    throw new Error(`C6 expected directory ${path}`);
  }
  return {
    dev: stat.dev,
    ino: stat.ino,
  };
}

async function assertDirectoryIdentity(
  path: string,
  expected: DirectoryIdentity,
  label: string,
): Promise<void> {
  const actual = await directoryIdentity(path);
  if (actual.dev !== expected.dev || actual.ino !== expected.ino) {
    throw new Error(`${label} changed during operation`);
  }
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error &&
    "code" in error &&
    error.code === code;
}
