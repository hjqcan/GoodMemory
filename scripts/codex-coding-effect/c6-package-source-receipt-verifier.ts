import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  join,
  posix,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { readC6StableRegularFile } from "./c6-asset-lock";
import {
  buildSourceEntryManifest,
  computeGitTreeOid,
  isSafeGitPath,
  readStableSourceFile,
} from "./c6-package-source-archive";
import {
  assertDirectoryIdentity,
  canonicalExistingDirectory,
  canonicalExistingFile,
  directoryIdentity,
} from "./c6-package-source-artifact-publication";
import {
  C6_PACKAGE_SOURCE_FIXED_PATH,
} from "./c6-package-source-docker-authority";
import { inspectC6PackageTarball } from "./c6-package";
import type {
  C6PackageSourceDependencyClosureExpectedIdentity,
} from "./c6-package-source-dependency-closure";

const RUNNER_SOURCE_PATHS = [
  "scripts/codex-coding-effect/c6-asset-lock.ts",
  "scripts/codex-coding-effect/c6-package-source-archive.ts",
  "scripts/codex-coding-effect/c6-package-source-artifact-publication.ts",
  "scripts/codex-coding-effect/c6-package-source-dependency-closure.ts",
  "scripts/codex-coding-effect/c6-package-source-docker-authority.ts",
  "scripts/codex-coding-effect/c6-package-source-receipt-verifier.ts",
  "scripts/codex-coding-effect/c6-package-source-reproducibility.ts",
  "scripts/codex-coding-effect/c6-package.ts",
  "scripts/rebuild-codex-coding-effect-c6-package-source.ts",
] as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const gitOidSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
export const runtimeSchema = z.object({
  bun: z.object({
    executableSha256: sha256Schema,
    version: z.string().min(1),
  }).strict(),
  node: z.object({
    executableSha256: sha256Schema,
    version: z.string().regex(/^v\d+\.\d+\.\d+(?:[-+].+)?$/u),
  }).strict(),
  npm: z.object({
    cliSha256: sha256Schema,
    launcherSha256: sha256Schema,
    version: z.string().min(1),
  }).strict(),
}).strict();
export const dependencyClosureIdentitySchema = z.object({
  assetLockSha256: sha256Schema,
  assetRootSha256: sha256Schema,
  cacheArchiveSha256: sha256Schema,
  cacheContentRootSha256: sha256Schema,
  cacheManifestSha256: sha256Schema,
}).strict();
export const dockerAuthoritySchema = z.object({
  cliMode: z.number().int().min(0).max(0o7777),
  cliPath: z.string().min(1),
  cliSha256: sha256Schema,
  socketPath: z.string().min(1),
}).strict();
export const inputSchema = z.object({
  containerUser: z.string().regex(/^\d+:\d+$/u),
  dependencyClosureExpected: dependencyClosureIdentitySchema,
  dependencyClosureRoot: z.string().min(1),
  dockerAuthority: dockerAuthoritySchema,
  expectedCommitSha: gitOidSchema,
  expectedImageSha256: sha256Schema,
  expectedPackageSha256: sha256Schema,
  expectedTreeSha: gitOidSchema,
  outputRoot: z.string().min(1),
  repositoryRoot: z.string().min(1),
  runtime: runtimeSchema,
  runtimeIdentitySha256: sha256Schema,
}).strict();
const artifactSchema = z.object({
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const runnerSourceFileSchema = z.object({
  bytes: z.number().int().positive(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const runnerSourceSchema = z.object({
  files: z.array(runnerSourceFileSchema).length(RUNNER_SOURCE_PATHS.length),
  rootSha256: sha256Schema,
}).strict();
const dependencyCacheSchema = z.object({
  contentRootSha256: sha256Schema,
  directoryCount: z.number().int().nonnegative(),
  entryCount: z.number().int().positive(),
  fileCount: z.number().int().positive(),
  freshMaterialization: z.literal(true),
  mountReadOnly: z.literal(true),
}).strict();
export const runSchema = z.object({
  exitCode: z.literal(0),
  installedDependencyCount: z.number().int().positive(),
  input: z.object({
    bunLockSha256: sha256Schema,
    dependencyCache: dependencyCacheSchema,
    packageJsonSha256: sha256Schema,
    sourceArchiveSha256: sha256Schema,
    sourceEntryManifestSha256: sha256Schema,
  }).strict(),
  logs: z.object({
    stderr: artifactSchema,
    stdout: artifactSchema,
  }).strict(),
  output: z.object({
    bytes: z.number().int().positive(),
    packageVersion: z.string().min(1),
    path: z.string().min(1),
    sha256: sha256Schema,
  }).strict(),
  run: z.union([z.literal(1), z.literal(2)]),
  runtime: runtimeSchema,
}).strict();
export const receiptSchema = z.object({
  commands: z.object({
    build: z.array(z.string()),
    install: z.array(z.string()),
    pack: z.array(z.string()),
  }).strict(),
  executor: z.object({
    allCapabilitiesDropped: z.literal(true),
    authority: z.enum([
      "native-docker-cli",
      "injected-test-seam",
    ]),
    cleanHostEnvironment: z.literal(true),
    cliMode: z.number().int().min(0).max(0o7777),
    cliPath: z.string().min(1),
    cliSha256: sha256Schema,
    containerUser: z.string().regex(/^\d+:\d+$/u),
    daemonIdentityCryptographicallyAttested: z.literal(false),
    daemonTrustBoundary: z.literal(
      "explicit-unix-socket-daemon-not-cryptographically-attested",
    ),
    dockerServerVersion: z.string().min(1),
    dockerSocketMountedIntoContainer: z.literal(false),
    fixedPath: z.string().min(1),
    hostCredentialMountsAbsent: z.literal(true),
    imageArchitecture: z.literal("amd64"),
    imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    imageOperatingSystem: z.literal("linux"),
    imageReference: z.string().min(1),
    imageSha256: sha256Schema,
    kind: z.literal("docker"),
    networkMode: z.literal("none"),
    noNewPrivileges: z.literal(true),
    npmConfigFilesForcedEmpty: z.literal(true),
    numericUser: z.literal(true),
    platform: z.literal("linux/amd64"),
    rootFilesystemReadOnly: z.literal(true),
    socketPath: z.string().min(1),
  }).strict(),
  c6PackageOfflineClosureProven: z.literal(false),
  dependencyClosure: dependencyClosureIdentitySchema.extend({
    cacheDirectoryCount: z.number().int().nonnegative(),
    cacheEntryCount: z.number().int().positive(),
    cacheFileCount: z.number().int().positive(),
    cacheMountReadOnly: z.literal(true),
    freshMaterializationCount: z.literal(2),
    materializedCachesInodeDistinct: z.literal(true),
  }).strict(),
  evidenceScope: z.literal("local-offline-source-build-observation"),
  executionAuthenticated: z.literal(false),
  executionMode: z.literal("offline-dependency-closure-source-build"),
  externalIndependentAttestation: z.literal(false),
  kind: z.literal("c6-package-source-reproducibility"),
  liveOfflineBuildCount: z.union([z.literal(0), z.literal(2)]),
  locallyExecutedLinuxBuild: z.boolean(),
  networkDisabled: z.literal(true),
  offlineDependencyClosureUsed: z.literal(true),
  outcome: z.literal("passed"),
  rawExecutionWitnessIncluded: z.literal(false),
  runnerProtocolSha256: sha256Schema,
  runnerSource: runnerSourceSchema,
  runnerObservedSameHostOfflineRebuild: z.boolean(),
  runs: z.tuple([runSchema, runSchema]),
  schemaVersion: z.literal(3),
  source: z.object({
    archivePath: z.literal("source/source.tar"),
    archiveSha256: sha256Schema,
    bunLockSha256: sha256Schema,
    commitSha: gitOidSchema,
    entryCount: z.number().int().positive(),
    entryManifestPath: z.literal("source/source-tree.jsonl"),
    entryManifestSha256: sha256Schema,
    packageJsonSha256: sha256Schema,
    runtimeIdentitySha256: sha256Schema,
    treeSha: gitOidSchema,
  }).strict(),
  sourceBuildReproducible: z.literal(false),
}).strict();
const packageSchema = z.object({
  name: z.literal("goodmemory"),
  version: z.string().min(1),
}).passthrough();


export type C6PackageSourceReproducibilityReceipt = z.infer<
  typeof receiptSchema
>;
export type C6PackageSourceRuntimeIdentity = z.infer<
  typeof runtimeSchema
>;
export type C6PackageSourceRunnerClosure = z.infer<
  typeof runnerSourceSchema
>;

export interface C6PackageSourceReceiptVerification {
  artifactClosureVerified: true;
  c6PackageOfflineClosureProven: false;
  executionAuthenticated: false;
  externalIndependentAttestation: false;
  locallyExecutedLinuxBuild: false;
  receiptSha256: string;
  receiptValidation: "persisted-artifact-closure";
  recordedEvidenceScope: "local-offline-source-build-observation";
  recordedExecutorAuthority:
    | "native-docker-cli"
    | "injected-test-seam";
  recordedLiveOfflineBuildCount: 0 | 2;
  recordedLocallyExecutedLinuxBuild: boolean;
  recordedNetworkDisabled: true;
  recordedOfflineDependencyClosureUsed: true;
  recordedRunnerObservedSameHostOfflineRebuild: boolean;
  recordedSourceBuildReproducible: false;
  rawExecutionWitnessIncluded: false;
  runnerObservedSameHostOfflineRebuild: false;
  sourceBuildReproducible: false;
}

export const C6_PACKAGE_SOURCE_INSTALL_COMMAND = [
  "bun",
  "install",
  "--frozen-lockfile",
  "--ignore-scripts",
  "--cache-dir=/work/cache",
] as const;
export const C6_PACKAGE_SOURCE_BUILD_COMMAND = [
  "bun",
  "run",
  "build",
] as const;
export const C6_PACKAGE_SOURCE_PACK_COMMAND = [
  "npm",
  "pack",
  "--ignore-scripts",
  "--pack-destination",
  "/work/output",
] as const;

export const C6_PACKAGE_SOURCE_BUNX_SHIM = `#!/bin/sh
set -eu
exec /usr/local/bin/bun x "$@"
`;
export const C6_PACKAGE_SOURCE_BUILD_SCRIPT = `#!/bin/sh
set -eu
umask 022

test "$(uname -s)" = "Linux"
test "$(uname -m)" = "x86_64"
test ! -e /work/source/node_modules
test -d /work/cache
mkdir -p /tmp/home
: > /tmp/empty-global-npmrc
: > /tmp/empty-user-npmrc

hash_file() {
  node -e 'const { createHash } = require("node:crypto"); const { readFileSync } = require("node:fs"); process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"))' "$1"
}

test "$(command -v bunx)" = "/work/tool-bin/bunx"
hash_file /work/tool-bin/bunx > /work/observed/bunx-shim-sha256
bunx --version > /work/observed/bunx-version

node_path="$(command -v node)"
npm_launcher_path="$(command -v npm)"
npm_cli_path="$(npm root -g)/npm/bin/npm-cli.js"
bun_path="$(command -v bun)"
node --version > /work/observed/node-version
npm --version > /work/observed/npm-version
bun --version > /work/observed/bun-version
hash_file "$node_path" > /work/observed/node-sha256
hash_file "$npm_launcher_path" > /work/observed/npm-launcher-sha256
hash_file "$npm_cli_path" > /work/observed/npm-cli-sha256
hash_file "$bun_path" > /work/observed/bun-sha256

hash_file /work/source/bun.lock > /work/observed/bun-lock-before
hash_file /work/source/package.json > /work/observed/package-json-before
cd /work/source
install_output="$(
  bun install --frozen-lockfile --ignore-scripts --cache-dir=/work/cache 2>&1
)"
printf '%s\n' "$install_output"
installed_dependency_count="$(
  printf '%s\n' "$install_output" |
    awk '/^[0-9]+ packages installed/ { print $1 }'
)"
case "$installed_dependency_count" in
  ""|*[!0-9]*)
    echo "unable to observe one installed dependency count" >&2
    exit 1
    ;;
esac
printf '%s\n' "$installed_dependency_count" \
  > /work/observed/installed-dependency-count
bun run build
npm pack --ignore-scripts --pack-destination /work/output
hash_file /work/source/bun.lock > /work/observed/bun-lock-after
hash_file /work/source/package.json > /work/observed/package-json-after
cmp /work/observed/bun-lock-before /work/observed/bun-lock-after
cmp /work/observed/package-json-before /work/observed/package-json-after

set -- /work/output/*.tgz
test "$#" -eq 1
test -f "$1"
basename "$1" > /work/observed/package-filename
`;
export const C6_PACKAGE_SOURCE_PROTOCOL_SHA256 = sha256(JSON.stringify({
  buildCommand: C6_PACKAGE_SOURCE_BUILD_COMMAND,
  buildScript: C6_PACKAGE_SOURCE_BUILD_SCRIPT,
  bunxShim: C6_PACKAGE_SOURCE_BUNX_SHIM,
  executorAuthorities: [
    "native-docker-cli",
    "injected-test-seam",
  ],
  executionMode: "offline-dependency-closure-source-build",
  fixedPath: C6_PACKAGE_SOURCE_FIXED_PATH,
  installCommand: C6_PACKAGE_SOURCE_INSTALL_COMMAND,
  networkDisabled: true,
  offlineDependencyClosureUsed: true,
  packCommand: C6_PACKAGE_SOURCE_PACK_COMMAND,
  schemaVersion: 3,
}));

export function parseC6PackageSourceRuntimeIdentity(
  value: unknown,
): C6PackageSourceRuntimeIdentity {
  return runtimeSchema.parse(value);
}

export async function readC6PackageSourceRunnerClosure():
  Promise<C6PackageSourceRunnerClosure> {
  const repositoryRoot = await canonicalExistingDirectory(
    resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
    "package source runner repository root",
  );
  const files = await Promise.all(RUNNER_SOURCE_PATHS.map(async (path) => {
    const bytes = await readC6StableRegularFile(
      join(repositoryRoot, path),
      `package source runner closure ${path}`,
    );
    return {
      bytes: bytes.byteLength,
      path,
      sha256: sha256(bytes),
    };
  }));
  files.sort((left, right) => compareUtf8(left.path, right.path));
  return runnerSourceSchema.parse({
    files,
    rootSha256: sha256(
      files.map((file) => `${JSON.stringify(file)}\n`).join(""),
    ),
  });
}


export function assertC6PackageSourceBuildOutputs(input: {
  expectedPackageSha256: string;
  first: Uint8Array;
  second: Uint8Array;
}): string {
  const firstSha256 = sha256(input.first);
  const secondSha256 = sha256(input.second);
  if (
    input.first.byteLength !== input.second.byteLength ||
    !Buffer.from(input.first).equals(Buffer.from(input.second))
  ) {
    throw new Error("C6 source build two package outputs differ");
  }
  if (
    firstSha256 !== input.expectedPackageSha256 ||
    secondSha256 !== input.expectedPackageSha256
  ) {
    throw new Error("C6 source build package SHA-256 does not match");
  }
  return firstSha256;
}


export function serializeC6PackageSourceReproducibilityReceipt(
  rawReceipt: C6PackageSourceReproducibilityReceipt,
): string {
  const receipt = receiptSchema.parse(rawReceipt);
  return `${JSON.stringify(receipt, null, 2)}\n`;
}

export async function verifyC6PackageSourceReproducibilityReceipt(input: {
  expected: {
    commitSha: string;
    containerUser: string;
    dependencyClosure:
      C6PackageSourceDependencyClosureExpectedIdentity;
    dockerAuthority: {
      cliMode: number;
      cliPath: string;
      cliSha256: string;
      socketPath: string;
    };
    imageSha256: string;
    packageSha256: string;
    runtime: C6PackageSourceRuntimeIdentity;
    runtimeIdentitySha256: string;
    treeSha: string;
  };
  expectedReceiptSha256: string;
  path: string;
}): Promise<C6PackageSourceReceiptVerification> {
  const expected = z.object({
    commitSha: gitOidSchema,
    containerUser: z.string().regex(/^\d+:\d+$/u),
    dependencyClosure: dependencyClosureIdentitySchema,
    dockerAuthority: dockerAuthoritySchema,
    imageSha256: sha256Schema,
    packageSha256: sha256Schema,
    runtime: runtimeSchema,
    runtimeIdentitySha256: sha256Schema,
    treeSha: gitOidSchema,
  }).strict().parse(input.expected);
  const expectedReceiptSha256 =
    sha256Schema.parse(input.expectedReceiptSha256);
  const path = await canonicalExistingFile(
    input.path,
    "package source reproducibility receipt",
  );
  if (basename(path) !== "receipt.json") {
    throw new Error(
      "C6 package source artifact closure requires receipt.json",
    );
  }
  const outputRoot = await canonicalExistingDirectory(
    dirname(path),
    "package source artifact closure root",
  );
  const outputIdentity = await directoryIdentity(outputRoot);
  const bytes = await readC6StableRegularFile(
    path,
    "package source reproducibility receipt",
  );
  const receiptSha256 = sha256(bytes);
  if (receiptSha256 !== expectedReceiptSha256) {
    throw new Error(
      "C6 package source reproducibility receipt hash does not match",
    );
  }
  const receipt = receiptSchema.parse(parseJsonText(
    bytes.toString("utf8"),
    "package source reproducibility receipt",
  ));
  if (
    serializeC6PackageSourceReproducibilityReceipt(receipt) !==
      bytes.toString("utf8")
  ) {
    throw new Error(
      "C6 package source reproducibility receipt is not canonical JSON",
    );
  }
  const runnerSource = await readC6PackageSourceRunnerClosure();
  assertC6PackageSourceReceiptSemantics(receipt, {
    ...expected,
    runnerSource,
  });
  const expectedPaths = receiptArtifactPaths(receipt);
  const initialClosure = await readPersistedArtifactClosure(
    outputRoot,
    expectedPaths,
  );
  const persistedReceipt = requiredArtifact(
    initialClosure,
    "receipt.json",
  ).bytes;
  if (!persistedReceipt.equals(bytes)) {
    throw new Error(
      "C6 package source reproducibility receipt drifted during verification",
    );
  }
  await verifyPersistedArtifacts({
    closure: initialClosure,
    expected,
    receipt,
  });
  const terminalClosure = await readPersistedArtifactClosure(
    outputRoot,
    expectedPaths,
  );
  const terminalRunnerSource =
    await readC6PackageSourceRunnerClosure();
  await assertDirectoryIdentity(
    outputRoot,
    outputIdentity,
    "package source artifact closure root",
  );
  if (!sameJson(terminalRunnerSource, runnerSource)) {
    throw new Error(
      "C6 package source runner closure drifted during verification",
    );
  }
  if (
    artifactClosureIdentity(terminalClosure) !==
      artifactClosureIdentity(initialClosure)
  ) {
    throw new Error(
      "C6 package source artifact closure drifted during verification",
    );
  }
  return {
    artifactClosureVerified: true,
    c6PackageOfflineClosureProven: false,
    executionAuthenticated: false,
    externalIndependentAttestation: false,
    locallyExecutedLinuxBuild: false,
    receiptSha256,
    receiptValidation: "persisted-artifact-closure",
    recordedEvidenceScope: receipt.evidenceScope,
    recordedExecutorAuthority: receipt.executor.authority,
    recordedLiveOfflineBuildCount: receipt.liveOfflineBuildCount,
    recordedLocallyExecutedLinuxBuild:
      receipt.locallyExecutedLinuxBuild,
    recordedNetworkDisabled: receipt.networkDisabled,
    recordedOfflineDependencyClosureUsed:
      receipt.offlineDependencyClosureUsed,
    recordedRunnerObservedSameHostOfflineRebuild:
      receipt.runnerObservedSameHostOfflineRebuild,
    recordedSourceBuildReproducible:
      receipt.sourceBuildReproducible,
    rawExecutionWitnessIncluded: false,
    runnerObservedSameHostOfflineRebuild: false,
    sourceBuildReproducible: false,
  };
}

interface PersistedArtifact {
  bytes: Buffer;
  dev: number;
  ino: number;
  mode: number;
  mtimeMs: number;
  path: string;
  sha256: string;
}

interface PersistedArtifactClosure {
  directories: Array<{
    dev: number;
    ino: number;
    mode: number;
    path: string;
  }>;
  files: PersistedArtifact[];
}

function receiptArtifactPaths(
  receipt: C6PackageSourceReproducibilityReceipt,
): string[] {
  const paths = [
    "receipt.json",
    receipt.source.archivePath,
    receipt.source.entryManifestPath,
    ...receipt.runs.flatMap((run) => [
      run.logs.stderr.path,
      run.logs.stdout.path,
      run.output.path,
    ]),
  ];
  if (
    paths.length !== 9 ||
    new Set(paths).size !== paths.length ||
    paths.some((path) => !isSafeReceiptPath(path))
  ) {
    throw new Error(
      "C6 package source artifact closure paths are inconsistent",
    );
  }
  return paths.sort(compareUtf8);
}

async function readPersistedArtifactClosure(
  root: string,
  expectedPaths: readonly string[],
): Promise<PersistedArtifactClosure> {
  const directories: PersistedArtifactClosure["directories"] = [];
  const files: PersistedArtifact[] = [];
  await walkPersistedArtifactClosure(root, root, directories, files);
  directories.sort((left, right) => compareUtf8(left.path, right.path));
  files.sort((left, right) => compareUtf8(left.path, right.path));
  const expectedDirectories = expectedArtifactDirectories(expectedPaths);
  if (
    !sameJson(
      files.map((file) => file.path),
      [...expectedPaths].sort(compareUtf8),
    ) ||
    !sameJson(
      directories.map((directory) => directory.path),
      expectedDirectories,
    )
  ) {
    throw new Error(
      "C6 package source artifact closure has missing or extra entries",
    );
  }
  return { directories, files };
}

async function walkPersistedArtifactClosure(
  root: string,
  directory: string,
  directories: PersistedArtifactClosure["directories"],
  files: PersistedArtifact[],
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareUtf8(left.name, right.name));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const pathFromRoot = relative(root, path).split("\\").join("/");
    if (!isSafeReceiptPath(pathFromRoot) || entry.isSymbolicLink()) {
      throw new Error(
        `C6 package source artifact closure rejects ${pathFromRoot}`,
      );
    }
    if (entry.isDirectory()) {
      const identity = await directoryIdentity(path);
      directories.push({ ...identity, path: pathFromRoot });
      await walkPersistedArtifactClosure(
        root,
        path,
        directories,
        files,
      );
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        `C6 package source artifact closure rejects ${pathFromRoot}`,
      );
    }
    files.push(await readPersistedArtifact(path, pathFromRoot));
  }
}

async function readPersistedArtifact(
  path: string,
  pathFromRoot: string,
): Promise<PersistedArtifact> {
  const before = await lstat(path);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1
  ) {
    throw new Error(
      `C6 package source artifact closure rejects ${pathFromRoot}`,
    );
  }
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const opened = await handle.stat();
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      after.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.mode !== before.mode ||
      opened.size !== before.size ||
      opened.mtimeMs !== before.mtimeMs ||
      opened.dev !== after.dev ||
      opened.ino !== after.ino ||
      opened.mode !== after.mode ||
      opened.size !== after.size ||
      opened.mtimeMs !== after.mtimeMs ||
      bytes.byteLength !== after.size
    ) {
      throw new Error(
        `C6 package source artifact closure changed ${pathFromRoot}`,
      );
    }
    return {
      bytes,
      dev: after.dev,
      ino: after.ino,
      mode: after.mode,
      mtimeMs: after.mtimeMs,
      path: pathFromRoot,
      sha256: sha256(bytes),
    };
  } finally {
    await handle.close();
  }
}

function expectedArtifactDirectories(
  paths: readonly string[],
): string[] {
  const directories = new Set<string>();
  for (const path of paths) {
    const components = path.split("/");
    for (let index = 1; index < components.length; index += 1) {
      directories.add(components.slice(0, index).join("/"));
    }
  }
  return [...directories].sort(compareUtf8);
}

function requiredArtifact(
  closure: PersistedArtifactClosure,
  path: string,
): PersistedArtifact {
  const artifact = closure.files.find((file) => file.path === path);
  if (artifact === undefined) {
    throw new Error(
      `C6 package source artifact closure is missing ${path}`,
    );
  }
  return artifact;
}

function artifactClosureIdentity(
  closure: PersistedArtifactClosure,
): string {
  return JSON.stringify({
    directories: closure.directories,
    files: closure.files.map(({ bytes: _bytes, ...file }) => file),
  });
}

async function verifyPersistedArtifacts(input: {
  closure: PersistedArtifactClosure;
  expected: {
    commitSha: string;
    containerUser: string;
    imageSha256: string;
    packageSha256: string;
    runtime: C6PackageSourceRuntimeIdentity;
    treeSha: string;
  };
  receipt: C6PackageSourceReproducibilityReceipt;
}): Promise<void> {
  const { closure, receipt } = input;
  const sourceArchive = requiredArtifact(
    closure,
    receipt.source.archivePath,
  );
  const sourceManifest = requiredArtifact(
    closure,
    receipt.source.entryManifestPath,
  );
  if (
    sourceArchive.sha256 !== receipt.source.archiveSha256 ||
    sourceManifest.sha256 !== receipt.source.entryManifestSha256
  ) {
    throw new Error(
      "C6 package source persisted source artifact hash mismatch",
    );
  }
  for (const run of receipt.runs) {
    const stdout = requiredArtifact(closure, run.logs.stdout.path);
    const stderr = requiredArtifact(closure, run.logs.stderr.path);
    const output = requiredArtifact(closure, run.output.path);
    if (
      stdout.sha256 !== run.logs.stdout.sha256 ||
      stderr.sha256 !== run.logs.stderr.sha256 ||
      output.sha256 !== run.output.sha256 ||
      output.bytes.byteLength !== run.output.bytes
    ) {
      throw new Error(
        `C6 package source persisted run ${run.run} artifact mismatch`,
      );
    }
  }
  const firstPackage = requiredArtifact(
    closure,
    receipt.runs[0].output.path,
  ).bytes;
  const secondPackage = requiredArtifact(
    closure,
    receipt.runs[1].output.path,
  ).bytes;
  assertC6PackageSourceBuildOutputs({
    expectedPackageSha256: input.expected.packageSha256,
    first: firstPackage,
    second: secondPackage,
  });

  const temporaryRoot = await mkdtemp(join(
    await realpath(tmpdir()),
    "goodmemory-c6-source-verification-",
  ));
  try {
    const archivePath = join(temporaryRoot, "source.tar");
    await writeFile(archivePath, sourceArchive.bytes, {
      flag: "wx",
      mode: 0o600,
    });
    const archiveStructure =
      await readSafePersistedSourceArchiveStructure(archivePath);
    const archivedCommit = await readGitArchiveCommit(archivePath);
    if (archivedCommit !== input.expected.commitSha) {
      throw new Error(
        "C6 package source persisted archive commit mismatch",
      );
    }
    const extractedRoot = join(temporaryRoot, "source");
    await mkdir(extractedRoot, { mode: 0o700 });
    await runCommand(
      ["tar", "-xf", archivePath, "-C", extractedRoot],
      "persisted source archive extraction",
    );
    const rebuiltManifest = await buildSourceEntryManifest(extractedRoot);
    if (
      rebuiltManifest.entryCount !== receipt.source.entryCount ||
      rebuiltManifest.manifest !== sourceManifest.bytes.toString("utf8") ||
      sha256(rebuiltManifest.manifest) !==
        receipt.source.entryManifestSha256 ||
      !sameJson(
        archiveStructure.files,
        rebuiltManifest.entries.map((entry) => entry.path),
      ) ||
      !sameJson(
        archiveStructure.directories,
        expectedArtifactDirectories(
          rebuiltManifest.entries.map((entry) => entry.path),
        ),
      )
    ) {
      throw new Error(
        "C6 package source persisted manifest semantics mismatch",
      );
    }
    if (
      await computeGitTreeOid(
        extractedRoot,
        rebuiltManifest.entries,
        input.expected.treeSha.length === 40 ? "sha1" : "sha256",
      ) !== input.expected.treeSha
    ) {
      throw new Error(
        "C6 package source persisted archive tree mismatch",
      );
    }
    const [bunLock, packageJson] = await Promise.all([
      readStableSourceFile(
        join(extractedRoot, "bun.lock"),
        "persisted source bun.lock",
      ),
      readStableSourceFile(
        join(extractedRoot, "package.json"),
        "persisted source package.json",
      ),
    ]);
    const packageMetadata = packageSchema.parse(parseJsonText(
      packageJson.bytes.toString("utf8"),
      "persisted source package.json",
    ));
    if (
      sha256(bunLock.bytes) !== receipt.source.bunLockSha256 ||
      sha256(packageJson.bytes) !== receipt.source.packageJsonSha256 ||
      receipt.runs.some(
        (run) => run.output.packageVersion !== packageMetadata.version,
      )
    ) {
      throw new Error(
        "C6 package source persisted frozen input semantics mismatch",
      );
    }
    for (const run of receipt.runs) {
      const packagePath = join(temporaryRoot, `run-${run.run}.tgz`);
      await writeFile(
        packagePath,
        requiredArtifact(closure, run.output.path).bytes,
        { flag: "wx", mode: 0o600 },
      );
      await inspectC6PackageTarball({
        expectedSha256: input.expected.packageSha256,
        expectedVersion: packageMetadata.version,
        path: packagePath,
      });
    }
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

async function readSafePersistedSourceArchiveStructure(
  archivePath: string,
): Promise<{ directories: string[]; files: string[] }> {
  const listing = (
    await runCommand(
      ["tar", "-tf", archivePath],
      "persisted source archive listing",
    )
  ).stdout.split(/\r?\n/u).filter((entry) => entry.length > 0);
  const normalized = listing.map((entry) =>
    entry.endsWith("/") ? entry.slice(0, -1) : entry
  );
  if (
    normalized.length === 0 ||
    new Set(normalized).size !== normalized.length ||
    normalized.some((entry) => !isSafeGitPath(entry))
  ) {
    throw new Error(
      "C6 package source persisted archive entry closure is unsafe",
    );
  }
  return {
    directories: listing
      .filter((entry) => entry.endsWith("/"))
      .map((entry) => entry.slice(0, -1))
      .sort(compareUtf8),
    files: listing
      .filter((entry) => !entry.endsWith("/"))
      .sort(compareUtf8),
  };
}

async function readGitArchiveCommit(archivePath: string): Promise<string> {
  const child = Bun.spawn({
    cmd: ["git", "get-tar-commit-id"],
    stdin: Bun.file(archivePath),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  const commit = stdout.trim();
  if (
    exitCode !== 0 ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(commit)
  ) {
    throw new Error([
      "C6 package source persisted archive is not a Git archive",
      outputTail(stderr),
    ].filter((value) => value.length > 0).join("\n"));
  }
  return commit;
}


export function assertC6PackageSourceReceiptSemantics(
  receipt: C6PackageSourceReproducibilityReceipt,
  expected: {
    commitSha: string;
    containerUser: string;
    dependencyClosure:
      C6PackageSourceDependencyClosureExpectedIdentity;
    dockerAuthority: {
      cliMode: number;
      cliPath: string;
      cliSha256: string;
      socketPath: string;
    };
    imageSha256: string;
    packageSha256: string;
    runnerSource: C6PackageSourceRunnerClosure;
    runtime: C6PackageSourceRuntimeIdentity;
    runtimeIdentitySha256: string;
    treeSha: string;
  },
): void {
  const nativeDockerExecution =
    receipt.executor.authority === "native-docker-cli";
  const expectedDependencyCache = {
    contentRootSha256:
      receipt.dependencyClosure.cacheContentRootSha256,
    directoryCount: receipt.dependencyClosure.cacheDirectoryCount,
    entryCount: receipt.dependencyClosure.cacheEntryCount,
    fileCount: receipt.dependencyClosure.cacheFileCount,
    freshMaterialization: true,
    mountReadOnly: true,
  };
  const expectedInput = {
    bunLockSha256: receipt.source.bunLockSha256,
    dependencyCache: expectedDependencyCache,
    packageJsonSha256: receipt.source.packageJsonSha256,
    sourceArchiveSha256: receipt.source.archiveSha256,
    sourceEntryManifestSha256:
      receipt.source.entryManifestSha256,
  };
  if (
    !sameJson(receipt.commands.install, [
      ...C6_PACKAGE_SOURCE_INSTALL_COMMAND,
    ]) ||
    !sameJson(receipt.commands.build, [
      ...C6_PACKAGE_SOURCE_BUILD_COMMAND,
    ]) ||
    !sameJson(receipt.commands.pack, [
      ...C6_PACKAGE_SOURCE_PACK_COMMAND,
    ]) ||
    receipt.runnerProtocolSha256 !==
      C6_PACKAGE_SOURCE_PROTOCOL_SHA256 ||
    !sameJson(receipt.runnerSource, expected.runnerSource) ||
    !sameJson(
      {
        assetLockSha256:
          receipt.dependencyClosure.assetLockSha256,
        assetRootSha256:
          receipt.dependencyClosure.assetRootSha256,
        cacheArchiveSha256:
          receipt.dependencyClosure.cacheArchiveSha256,
        cacheContentRootSha256:
          receipt.dependencyClosure.cacheContentRootSha256,
        cacheManifestSha256:
          receipt.dependencyClosure.cacheManifestSha256,
      },
      expected.dependencyClosure,
    ) ||
    receipt.source.commitSha !== expected.commitSha ||
    receipt.source.treeSha !== expected.treeSha ||
    receipt.source.runtimeIdentitySha256 !==
      expected.runtimeIdentitySha256 ||
    receipt.executor.containerUser !== expected.containerUser ||
    receipt.executor.cliMode !== expected.dockerAuthority.cliMode ||
    receipt.executor.cliPath !== expected.dockerAuthority.cliPath ||
    receipt.executor.cliSha256 !==
      expected.dockerAuthority.cliSha256 ||
    receipt.executor.socketPath !==
      expected.dockerAuthority.socketPath ||
    receipt.executor.imageSha256 !== expected.imageSha256 ||
    receipt.executor.imageId !==
      `sha256:${expected.imageSha256}` ||
    receipt.executor.imageReference !==
      `sha256:${expected.imageSha256}` ||
    receipt.locallyExecutedLinuxBuild !== nativeDockerExecution ||
    receipt.liveOfflineBuildCount !==
      (nativeDockerExecution ? 2 : 0) ||
    receipt.runnerObservedSameHostOfflineRebuild !==
      nativeDockerExecution ||
    receipt.runs[0].run !== 1 ||
    receipt.runs[1].run !== 2 ||
    !sameJson(receipt.runs[0].input, expectedInput) ||
    !sameJson(receipt.runs[1].input, expectedInput) ||
    !sameJson(receipt.runs[0].runtime, expected.runtime) ||
    !sameJson(receipt.runs[1].runtime, expected.runtime) ||
    receipt.runs[0].installedDependencyCount !==
      receipt.runs[1].installedDependencyCount ||
    receipt.runs[0].output.sha256 !== expected.packageSha256 ||
    receipt.runs[1].output.sha256 !== expected.packageSha256
  ) {
    throw new Error(
      "C6 package source reproducibility receipt identity is inconsistent",
    );
  }
  for (const run of receipt.runs) {
    const runRoot = `runs/${run.run}`;
    if (
      run.logs.stderr.path !== `${runRoot}/build.stderr.log` ||
      run.logs.stdout.path !== `${runRoot}/build.stdout.log` ||
      !isSafeReceiptPath(run.output.path) ||
      !run.output.path.startsWith(`${runRoot}/`) ||
      !/^goodmemory-\d[^/]*\.tgz$/u.test(
        posix.basename(run.output.path),
      )
    ) {
      throw new Error(
        "C6 package source reproducibility receipt path is unsafe",
      );
    }
  }
}



function isSafeReceiptPath(path: string): boolean {
  return isSafeGitPath(path) && posix.normalize(path) === path;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function parseJsonText(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`C6 ${label} is not valid JSON`);
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function runCommand(
  command: string[],
  label: string,
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const child = Bun.spawn({
    cmd: command,
    stderr: "pipe",
    stdout: "pipe",
  });
  const timeoutMs = 30_000;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGKILL");
    } catch {
      // The process may already have exited.
    }
  }, timeoutMs);
  let exitCode: number;
  let stderr: string;
  let stdout: string;
  try {
    [exitCode, stderr, stdout] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  if (timedOut) {
    throw new Error(`C6 ${label} exceeded ${timeoutMs}ms deadline`);
  }
  if (exitCode !== 0) {
    throw new Error([
      `C6 ${label} failed with exit code ${exitCode}`,
      outputTail(stdout),
      outputTail(stderr),
    ].filter((value) => value.length > 0).join("\n"));
  }
  return { exitCode, stderr, stdout };
}

function outputTail(value: string): string {
  const limit = 4_000;
  return value.length <= limit ? value.trim() : value.slice(-limit).trim();
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
