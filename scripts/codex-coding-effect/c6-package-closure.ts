import { createHash } from "node:crypto";
import { join, posix } from "node:path";
import { gunzipSync } from "node:zlib";

import { z } from "zod";

import {
  loadC6AssetLock,
  readC6StableRegularFile,
  verifyC6AssetClosure,
} from "./c6-asset-lock";
import type {
  C6AssetLock,
} from "./c6-asset-lock";
import { inspectC6PackageTarball } from "./c6-package";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SHA512_SRI_PATTERN = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const sha256Schema = z.string().regex(SHA256_PATTERN);
const sriSchema = z.string().regex(SHA512_SRI_PATTERN);
const dependencyMapSchema = z.record(
  z.string().min(1),
  z.string().min(1),
);
const peerDependencyMetaSchema = z.record(
  z.string().min(1),
  z.object({
    optional: z.boolean().optional(),
  }).strict(),
);
const artifactReferenceSchema = z.object({
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const sizedArtifactReferenceSchema = artifactReferenceSchema.extend({
  bytes: z.number().int().nonnegative(),
}).strict();
const runtimeIdentitySchema = z.object({
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
const expectedIdentitySchema = z.object({
  image: z.object({
    architecture: z.literal("x64"),
    operatingSystem: z.literal("linux"),
    runtime: runtimeIdentitySchema,
    sha256: sha256Schema,
  }).strict(),
  package: z.object({
    dependencyClosure: z.object({
      assetLockSha256: sha256Schema,
      assetRootSha256: sha256Schema,
      installedTreeManifestSha256: sha256Schema,
      manifestSha256: sha256Schema,
    }).strict(),
    name: z.literal("goodmemory"),
    sha256: sha256Schema,
    version: z.string().min(1),
  }).strict(),
}).strict();
const packageClosureSchema = z.object({
  buildProfile: artifactReferenceSchema,
  consumer: z.object({
    goodmemorySpecifier: z.string().min(1),
    packageJson: artifactReferenceSchema,
    packageLock: artifactReferenceSchema.extend({
      lockfileVersion: z.literal(3),
    }).strict(),
    productionOnly: z.literal(true),
  }).strict(),
  installedTree: z.object({
    archive: sizedArtifactReferenceSchema,
    manifest: artifactReferenceSchema.extend({
      entryCount: z.number().int().nonnegative(),
    }).strict(),
  }).strict(),
  kind: z.literal("c6-goodmemory-package-closure"),
  offline: z.object({
    index: artifactReferenceSchema,
    tarballCount: z.number().int().nonnegative(),
    tarballSetSha256: sha256Schema,
  }).strict(),
  package: z.object({
    packageJson: z.object({
      bundledDependencyCount: z.literal(0),
      dependencySpecSha256: sha256Schema,
      name: z.literal("goodmemory"),
      sha256: sha256Schema,
      version: z.string().min(1),
    }).strict(),
    tarball: sizedArtifactReferenceSchema.extend({
      integrity: sriSchema,
    }).strict(),
  }).strict(),
  schemaVersion: z.literal(1),
  target: z.object({
    architecture: z.literal("x64"),
    operatingSystem: z.literal("linux"),
  }).strict(),
}).strict();
const packageMetadataSchema = z.object({
  bundleDependencies: z.unknown().optional(),
  bundledDependencies: z.unknown().optional(),
  dependencies: dependencyMapSchema.optional(),
  name: z.string().min(1),
  optionalDependencies: dependencyMapSchema.optional(),
  peerDependencies: dependencyMapSchema.optional(),
  peerDependenciesMeta: peerDependencyMetaSchema.optional(),
  version: z.string().min(1),
}).passthrough();
const consumerPackageSchema = z.object({
  dependencies: z.record(z.literal("goodmemory"), z.string().min(1)),
  name: z.literal("goodmemory-c6-runtime"),
  private: z.literal(true),
  version: z.literal("0.0.0"),
}).strict();
const packageLockSchema = z.object({
  lockfileVersion: z.literal(3),
  name: z.literal("goodmemory-c6-runtime"),
  packages: z.record(
    z.string(),
    z.record(z.string(), z.unknown()),
  ),
  requires: z.literal(true),
  version: z.literal("0.0.0"),
}).strict();
const offlineIndexEntrySchema = z.object({
  integrity: sriSchema,
  lockLocations: z.array(z.string().min(1)).min(1),
  name: z.string().min(1),
  resolved: z.string().min(1),
  tarball: sizedArtifactReferenceSchema,
  version: z.string().min(1),
}).strict();
const offlineIndexSchema = z.object({
  entries: z.array(offlineIndexEntrySchema),
  packageLockSha256: sha256Schema,
  schemaVersion: z.literal(1),
}).strict();
const installedFileSchema = z.object({
  mode: z.number().int().min(0).max(0o777),
  path: z.string().min(1),
  sha256: sha256Schema,
  size: z.number().int().nonnegative(),
  type: z.literal("file"),
}).strict();
const installedSymlinkSchema = z.object({
  mode: z.number().int().min(0).max(0o777),
  path: z.string().min(1),
  target: z.string().min(1),
  type: z.literal("symlink"),
}).strict();
const installedTreeEntrySchema = z.discriminatedUnion("type", [
  installedFileSchema,
  installedSymlinkSchema,
]);
const buildProfileSchema = z.object({
  architecture: z.string().min(1),
  bun: runtimeIdentitySchema.shape.bun,
  imageSha256: sha256Schema,
  install: z.object({
    cacheStartedEmpty: z.boolean(),
    command: z.array(z.string()),
    credentialsPresent: z.boolean(),
    exitCode: z.number().int(),
    networkIsolation: z.string(),
    packageLockSha256After: sha256Schema,
    packageLockSha256Before: sha256Schema,
    sourceCheckoutMounted: z.boolean(),
  }).strict(),
  installedTreeManifestSha256: sha256Schema,
  libc: z.object({
    family: z.string().min(1),
    version: z.string().min(1),
  }).strict(),
  node: runtimeIdentitySchema.shape.node,
  npm: runtimeIdentitySchema.shape.npm,
  operatingSystem: z.string().min(1),
  osReleaseSha256: sha256Schema,
  schemaVersion: z.literal(1),
  smoke: z.object({
    goodmemoryHostCommandExitCode: z.number().int(),
    goodmemoryVersion: z.string().min(1),
    goodmemoryVersionExitCode: z.number().int(),
    sqliteVssLinuxX64Present: z.boolean(),
  }).strict(),
}).strict();

const EXPECTED_INSTALL_COMMAND = [
  "npm",
  "ci",
  "--offline",
  "--ignore-scripts",
  "--omit=dev",
  "--include=optional",
  "--install-strategy=hoisted",
  "--no-audit",
  "--no-fund",
  "--cache",
  "<empty-ephemeral-cache>",
] as const;

export type C6InstalledTreeEntry = z.infer<
  typeof installedTreeEntrySchema
>;
export type C6OfflineIndexEntry = z.infer<
  typeof offlineIndexEntrySchema
>;
export type C6PackageClosureExpectedIdentity = z.infer<
  typeof expectedIdentitySchema
>;

export interface ValidatedC6PackageClosure {
  assetLockSha256: string;
  buildReceiptValidation: "declared-profile-structure-only";
  closureManifestSha256: string;
  installedTreeEntryCount: number;
  installedTreeManifestSha256: string;
  linuxRebuildProven: false;
  offlineTarballCount: number;
  package: {
    name: "goodmemory";
    sha256: string;
    version: string;
  };
}

interface DependencySpec {
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
}

interface RegistryLockEntry {
  integrity: string;
  location: string;
  name: string;
  resolved: string;
  version: string;
}

interface ParsedTarEntry {
  bytes: Buffer;
  linkName: string;
  mode: number;
  path: string;
  type: string;
}

export async function validateC6PackageClosure(input: {
  closureRoot: string;
  expected: C6PackageClosureExpectedIdentity;
}): Promise<ValidatedC6PackageClosure> {
  const expected = parseSchema(
    expectedIdentitySchema,
    input.expected,
    "expected package closure identity",
  );
  const loadedAssetLock = await loadC6AssetLock(input.closureRoot);
  if (
    loadedAssetLock.assetLockSha256 !==
      expected.package.dependencyClosure.assetLockSha256 ||
    loadedAssetLock.assetLock.assetRootSha256 !==
      expected.package.dependencyClosure.assetRootSha256
  ) {
    throw new Error("C6 frozen package closure asset identity does not match");
  }
  const closureBytes = await readLockedArtifact(
    input.closureRoot,
    loadedAssetLock.assetLock,
    {
      path: "closure.json",
      sha256: assetSha256(loadedAssetLock.assetLock, "closure.json"),
    },
    "closure manifest",
  );
  const closure = parseJsonSchema(
    packageClosureSchema,
    closureBytes,
    "package closure manifest",
  );
  if (
    sha256(closureBytes) !==
      expected.package.dependencyClosure.manifestSha256
  ) {
    throw new Error("C6 frozen package closure manifest identity does not match");
  }

  assertPackageClosureIdentity(closure, expected);
  const packageBytes = await readLockedArtifact(
    input.closureRoot,
    loadedAssetLock.assetLock,
    closure.package.tarball,
    "GoodMemory package tarball",
  );
  await inspectC6PackageTarball({
    expectedSha256: expected.package.sha256,
    expectedVersion: expected.package.version,
    path: join(input.closureRoot, closure.package.tarball.path),
  });
  assertSri(packageBytes, closure.package.tarball.integrity, "package tarball");
  const packageTar = parseGzipTar(packageBytes, "GoodMemory package tarball");
  assertSafePackageTar(packageTar, "GoodMemory package tarball");
  if (
    packageTar.some((entry) =>
      entry.path === "package/node_modules" ||
      entry.path.startsWith("package/node_modules/")
    )
  ) {
    throw new Error("C6 package tarball rejects bundled node_modules");
  }
  const packageJsonEntry = requiredRegularTarEntry(
    packageTar,
    "package/package.json",
    "GoodMemory package tarball",
  );
  const packageMetadata = parseJsonSchema(
    packageMetadataSchema,
    packageJsonEntry.bytes,
    "GoodMemory package.json",
  );
  assertPackageMetadata(
    packageMetadata,
    packageJsonEntry.bytes,
    closure,
    expected,
  );
  const dependencySpec = extractDependencySpec(packageMetadata);

  const consumerPackageBytes = await readLockedArtifact(
    input.closureRoot,
    loadedAssetLock.assetLock,
    closure.consumer.packageJson,
    "consumer package.json",
  );
  const consumerPackage = parseJsonSchema(
    consumerPackageSchema,
    consumerPackageBytes,
    "consumer package.json",
  );
  const expectedSpecifier =
    `file:../package/goodmemory-${expected.package.version}.tgz`;
  if (
    closure.consumer.goodmemorySpecifier !== expectedSpecifier ||
    consumerPackage.dependencies.goodmemory !== expectedSpecifier
  ) {
    throw new Error(
      "C6 consumer package.json must contain only the exact GoodMemory file specifier",
    );
  }

  const packageLockBytes = await readLockedArtifact(
    input.closureRoot,
    loadedAssetLock.assetLock,
    closure.consumer.packageLock,
    "consumer package-lock.json",
  );
  const packageLock = parseJsonSchema(
    packageLockSchema,
    packageLockBytes,
    "consumer package-lock.json",
  );
  const registryEntries = validatePackageLock({
    dependencySpec,
    goodmemoryIntegrity: closure.package.tarball.integrity,
    goodmemorySpecifier: expectedSpecifier,
    packageLock,
    packageVersion: expected.package.version,
  });

  const offlineIndexBytes = await readLockedArtifact(
    input.closureRoot,
    loadedAssetLock.assetLock,
    closure.offline.index,
    "offline index",
  );
  const offlineIndex = parseJsonSchema(
    offlineIndexSchema,
    offlineIndexBytes,
    "offline index",
  );
  if (offlineIndex.packageLockSha256 !== sha256(packageLockBytes)) {
    throw new Error("C6 offline index does not bind the consumer package-lock");
  }
  validateOfflineIndex(
    offlineIndex.entries,
    registryEntries,
    closure.offline.tarballCount,
    closure.offline.tarballSetSha256,
  );
  const offlinePackages = await validateOfflineTarballs(
    input.closureRoot,
    loadedAssetLock.assetLock,
    offlineIndex.entries,
  );

  const treeManifestBytes = await readLockedArtifact(
    input.closureRoot,
    loadedAssetLock.assetLock,
    closure.installedTree.manifest,
    "installed tree manifest",
  );
  const treeManifest = parseInstalledTreeManifest(treeManifestBytes);
  if (
    sha256(treeManifestBytes) !==
      expected.package.dependencyClosure.installedTreeManifestSha256
  ) {
    throw new Error(
      "C6 frozen installed tree manifest identity does not match",
    );
  }
  if (treeManifest.length !== closure.installedTree.manifest.entryCount) {
    throw new Error("C6 installed tree manifest entry count does not match");
  }
  const installedArchiveBytes = await readLockedArtifact(
    input.closureRoot,
    loadedAssetLock.assetLock,
    closure.installedTree.archive,
    "installed tree archive",
  );
  const installedTar = parseTar(
    installedArchiveBytes,
    "installed tree archive",
  );
  const archiveTree = canonicalInstalledTree(installedTar);
  if (
    serializeC6InstalledTreeManifest(archiveTree) !==
      treeManifestBytes.toString("utf8")
  ) {
    throw new Error(
      "C6 installed tree archive does not match its canonical manifest",
    );
  }
  assertInstalledRuntimeTree(
    installedTar,
    archiveTree,
    packageJsonEntry.bytes,
    closure.package.packageJson.sha256,
    registryEntries,
    offlinePackages,
  );

  const buildProfileBytes = await readLockedArtifact(
    input.closureRoot,
    loadedAssetLock.assetLock,
    closure.buildProfile,
    "Linux build profile",
  );
  const buildProfile = parseJsonSchema(
    buildProfileSchema,
    buildProfileBytes,
    "Linux build profile",
  );
  validateBuildProfile({
    expected,
    installedTreeManifestSha256: sha256(treeManifestBytes),
    packageLockSha256: sha256(packageLockBytes),
    profile: buildProfile,
  });

  assertExactAssetSet(
    loadedAssetLock.assetLock,
    closure,
    offlineIndex.entries,
  );
  await verifyC6AssetClosure(input.closureRoot, loadedAssetLock);

  return {
    assetLockSha256: loadedAssetLock.assetLockSha256,
    buildReceiptValidation: "declared-profile-structure-only",
    closureManifestSha256: sha256(closureBytes),
    installedTreeEntryCount: treeManifest.length,
    installedTreeManifestSha256: sha256(treeManifestBytes),
    linuxRebuildProven: false,
    offlineTarballCount: offlineIndex.entries.length,
    package: {
      name: "goodmemory",
      sha256: expected.package.sha256,
      version: expected.package.version,
    },
  };
}

export function computeC6DependencySpecSha256(
  packageJson: unknown,
): string {
  const metadata = parseSchema(
    packageMetadataSchema,
    packageJson,
    "package dependency metadata",
  );
  return sha256(JSON.stringify(canonicalJson(extractDependencySpec(metadata))));
}

export function computeC6OfflineTarballSetSha256(
  entries: readonly C6OfflineIndexEntry[],
): string {
  const canonicalSet = [...entries]
    .map((entry) => parseSchema(
      offlineIndexEntrySchema,
      entry,
      "offline index entry",
    ))
    .sort(compareOfflineEntries)
    .map((entry) => ({
      integrity: entry.integrity,
      path: entry.tarball.path,
      sha256: entry.tarball.sha256,
    }));
  return sha256(JSON.stringify(canonicalSet));
}

export function serializeC6InstalledTreeManifest(
  entries: readonly C6InstalledTreeEntry[],
): string {
  const canonicalEntries = entries
    .map((entry) => parseSchema(
      installedTreeEntrySchema,
      entry,
      "installed tree entry",
    ))
    .sort((left, right) => compareUtf8(left.path, right.path))
    .map((entry) => entry.type === "file"
      ? {
          mode: entry.mode,
          path: entry.path,
          sha256: entry.sha256,
          size: entry.size,
          type: "file" as const,
        }
      : {
          mode: entry.mode,
          path: entry.path,
          target: entry.target,
          type: "symlink" as const,
        });
  return canonicalEntries.length === 0
    ? ""
    : `${canonicalEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

function assertPackageClosureIdentity(
  closure: z.infer<typeof packageClosureSchema>,
  expected: C6PackageClosureExpectedIdentity,
): void {
  if (
    closure.package.tarball.sha256 !== expected.package.sha256 ||
    closure.package.packageJson.name !== expected.package.name ||
    closure.package.packageJson.version !== expected.package.version ||
    closure.package.tarball.path !==
      `package/goodmemory-${expected.package.version}.tgz`
  ) {
    throw new Error("C6 package closure identity does not match");
  }
  if (
    closure.target.operatingSystem !== expected.image.operatingSystem ||
    closure.target.architecture !== expected.image.architecture
  ) {
    throw new Error("C6 package closure target does not match");
  }
  if (
    closure.consumer.packageJson.path !== "consumer/package.json" ||
    closure.consumer.packageLock.path !== "consumer/package-lock.json" ||
    closure.offline.index.path !== "offline/index.json" ||
    closure.installedTree.archive.path !==
      "installed/node_modules.tar" ||
    closure.installedTree.manifest.path !== "installed/tree.jsonl" ||
    closure.buildProfile.path !== "profiles/linux-x64-build.json"
  ) {
    throw new Error("C6 package closure uses a non-canonical artifact path");
  }
}

function assertPackageMetadata(
  metadata: z.infer<typeof packageMetadataSchema>,
  packageJsonBytes: Buffer,
  closure: z.infer<typeof packageClosureSchema>,
  expected: C6PackageClosureExpectedIdentity,
): void {
  if (
    metadata.name !== expected.package.name ||
    metadata.version !== expected.package.version
  ) {
    throw new Error("C6 GoodMemory package.json identity does not match");
  }
  if (
    Object.hasOwn(metadata, "bundleDependencies") ||
    Object.hasOwn(metadata, "bundledDependencies")
  ) {
    throw new Error("C6 GoodMemory package rejects bundled dependencies");
  }
  if (
    closure.package.packageJson.sha256 !==
      sha256(packageJsonBytes) ||
    closure.package.packageJson.dependencySpecSha256 !==
      computeC6DependencySpecSha256(metadata)
  ) {
    throw new Error("C6 GoodMemory package.json binding does not match");
  }
}

function validatePackageLock(input: {
  dependencySpec: DependencySpec;
  goodmemoryIntegrity: string;
  goodmemorySpecifier: string;
  packageLock: z.infer<typeof packageLockSchema>;
  packageVersion: string;
}): RegistryLockEntry[] {
  const root = input.packageLock.packages[""];
  if (
    root === undefined ||
    !sameJson(root, {
      dependencies: {
        goodmemory: input.goodmemorySpecifier,
      },
      name: "goodmemory-c6-runtime",
      version: "0.0.0",
    })
  ) {
    throw new Error(
      "C6 consumer package.json and package-lock root do not match",
    );
  }
  const goodmemory = input.packageLock.packages["node_modules/goodmemory"];
  if (goodmemory === undefined) {
    throw new Error("C6 package-lock is missing GoodMemory");
  }
  if (
    goodmemory.version !== input.packageVersion ||
    goodmemory.resolved !== input.goodmemorySpecifier ||
    goodmemory.integrity !== input.goodmemoryIntegrity ||
    goodmemory.link === true
  ) {
    throw new Error("C6 package-lock GoodMemory file binding does not match");
  }
  const lockedDependencySpec = extractDependencySpec(goodmemory);
  if (!sameJson(lockedDependencySpec, input.dependencySpec)) {
    throw new Error(
      "C6 package-lock GoodMemory dependency maps do not match the package",
    );
  }

  const registryEntries: RegistryLockEntry[] = [];
  for (const [location, value] of Object.entries(input.packageLock.packages)) {
    if (location === "" || location === "node_modules/goodmemory") {
      continue;
    }
    if (!isNodeModulesLocation(location)) {
      throw new Error(`C6 package-lock rejects non-package location ${location}`);
    }
    if (typeof value.integrity !== "string") {
      throw new Error(
        `C6 package-lock registry entry ${location} is missing integrity`,
      );
    }
    if (!isValidSri(value.integrity)) {
      throw new Error(
        `C6 package-lock registry entry ${location} has invalid integrity`,
      );
    }
    if (typeof value.resolved !== "string") {
      throw new Error(
        `C6 package-lock registry entry ${location} is missing resolved`,
      );
    }
    let resolved: URL;
    try {
      resolved = new URL(value.resolved);
    } catch {
      throw new Error(
        `C6 package-lock registry entry ${location} must use HTTPS`,
      );
    }
    if (resolved.protocol !== "https:") {
      throw new Error(
        `C6 package-lock registry entry ${location} must use HTTPS`,
      );
    }
    if (typeof value.version !== "string" || value.version.length === 0) {
      throw new Error(
        `C6 package-lock registry entry ${location} is missing version`,
      );
    }
    if (value.dev === true || value.link === true) {
      throw new Error(
        `C6 production package-lock rejects dev or link entry ${location}`,
      );
    }
    registryEntries.push({
      integrity: value.integrity,
      location,
      name: packageNameFromLockLocation(location),
      resolved: value.resolved,
      version: value.version,
    });
  }
  registryEntries.sort((left, right) =>
    compareUtf8(left.location, right.location)
  );
  return registryEntries;
}

function validateOfflineIndex(
  entries: readonly C6OfflineIndexEntry[],
  registryEntries: readonly RegistryLockEntry[],
  expectedTarballCount: number,
  expectedTarballSetSha256: string,
): void {
  if (
    entries.length !== expectedTarballCount ||
    new Set(entries.map((entry) => entry.tarball.path)).size !== entries.length
  ) {
    throw new Error("C6 offline index tarball count does not match");
  }
  if (
    computeC6OfflineTarballSetSha256(entries) !==
      expectedTarballSetSha256
  ) {
    throw new Error("C6 offline tarball set identity does not match");
  }
  const actual = [...entries].sort(compareOfflineEntries).map((entry) => ({
    integrity: entry.integrity,
    lockLocations: [...entry.lockLocations].sort(compareUtf8),
    name: entry.name,
    resolved: entry.resolved,
    version: entry.version,
  }));
  const expected = groupRegistryEntries(registryEntries);
  if (!sameJson(actual, expected)) {
    throw new Error(
      "C6 offline index does not exactly cover the package-lock registry entries",
    );
  }
}

async function validateOfflineTarballs(
  closureRoot: string,
  assetLock: C6AssetLock,
  entries: readonly C6OfflineIndexEntry[],
): Promise<Map<string, string>> {
  const packageJsonSha256ByIntegrity = new Map<string, string>();
  for (const entry of entries) {
    const expectedPath =
      `offline/tarballs/${sriDigest(entry.integrity).toString("hex")}.tgz`;
    if (entry.tarball.path !== expectedPath) {
      throw new Error("C6 offline tarball path is not named by its SRI digest");
    }
    const bytes = await readLockedArtifact(
      closureRoot,
      assetLock,
      entry.tarball,
      `offline tarball ${entry.name}@${entry.version}`,
    );
    assertSri(bytes, entry.integrity, `offline tarball ${entry.name}`);
    const tar = parseGzipTar(bytes, `offline tarball ${entry.name}`);
    assertSafePackageTar(tar, `offline tarball ${entry.name}`);
    const packageJsonEntry = requiredRegularTarEntry(
      tar,
      "package/package.json",
      `offline tarball ${entry.name}`,
    );
    const packageJson = parseJsonSchema(
      packageMetadataSchema,
      packageJsonEntry.bytes,
      `offline tarball ${entry.name} package.json`,
    );
    if (
      packageJson.name !== entry.name ||
      packageJson.version !== entry.version
    ) {
      throw new Error(
        `C6 offline tarball ${entry.name} package identity does not match`,
      );
    }
    packageJsonSha256ByIntegrity.set(
      entry.integrity,
      sha256(packageJsonEntry.bytes),
    );
  }
  return packageJsonSha256ByIntegrity;
}

function parseInstalledTreeManifest(
  bytes: Buffer,
): C6InstalledTreeEntry[] {
  const text = bytes.toString("utf8");
  if (text.length === 0) {
    throw new Error("C6 installed tree manifest must not be empty");
  }
  const lines = text.endsWith("\n")
    ? text.slice(0, -1).split("\n")
    : [];
  if (lines.length === 0 || lines.some((line) => line.length === 0)) {
    throw new Error("C6 installed tree manifest is not canonical JSONL");
  }
  const entries = lines.map((line) => {
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      throw new Error("C6 installed tree manifest contains invalid JSON");
    }
    return parseSchema(
      installedTreeEntrySchema,
      value,
      "installed tree manifest entry",
    );
  });
  if (serializeC6InstalledTreeManifest(entries) !== text) {
    throw new Error("C6 installed tree manifest is not canonical JSONL");
  }
  assertUniquePaths(entries.map((entry) => entry.path), "installed manifest");
  for (const entry of entries) {
    assertInstalledPath(entry.path);
    if (entry.type === "symlink") {
      assertSafeInstalledSymlink(entry.path, entry.target);
    }
  }
  return entries;
}

function canonicalInstalledTree(
  tarEntries: readonly ParsedTarEntry[],
): C6InstalledTreeEntry[] {
  const entries: C6InstalledTreeEntry[] = [];
  const seen = new Set<string>();
  for (const entry of tarEntries) {
    assertInstalledPath(entry.path);
    if (seen.has(entry.path)) {
      throw new Error(`C6 installed tree archive duplicates ${entry.path}`);
    }
    seen.add(entry.path);
    if (entry.type === "5") {
      continue;
    }
    if (entry.type === "0") {
      entries.push({
        mode: entry.mode,
        path: entry.path,
        sha256: sha256(entry.bytes),
        size: entry.bytes.byteLength,
        type: "file",
      });
      continue;
    }
    if (entry.type === "2") {
      assertSafeInstalledSymlink(entry.path, entry.linkName);
      entries.push({
        mode: entry.mode,
        path: entry.path,
        target: entry.linkName,
        type: "symlink",
      });
      continue;
    }
    throw new Error(
      `C6 installed tree archive rejects tar entry type ${entry.type}`,
    );
  }
  return entries.sort((left, right) => compareUtf8(left.path, right.path));
}

function assertInstalledRuntimeTree(
  tarEntries: readonly ParsedTarEntry[],
  entries: readonly C6InstalledTreeEntry[],
  sourcePackageJsonBytes: Buffer,
  expectedPackageJsonSha256: string,
  registryEntries: readonly RegistryLockEntry[],
  offlinePackageJsonSha256: ReadonlyMap<string, string>,
): void {
  const goodmemoryPackageJson = entries.find((entry) =>
    entry.path === "node_modules/goodmemory/package.json" &&
    entry.type === "file"
  );
  if (
    goodmemoryPackageJson?.type !== "file" ||
    goodmemoryPackageJson.sha256 !== expectedPackageJsonSha256 ||
    goodmemoryPackageJson.sha256 !== sha256(sourcePackageJsonBytes)
  ) {
    throw new Error(
      "C6 installed GoodMemory package.json does not match the package tarball",
    );
  }
  if (!entries.some((entry) =>
    entry.type === "file" &&
    entry.path === "node_modules/sqlite-vss-linux-x64/package.json"
  )) {
    throw new Error(
      "C6 installed tree is missing sqlite-vss-linux-x64",
    );
  }
  const lockedLocations = [
    "node_modules/goodmemory",
    ...registryEntries.map((entry) => entry.location),
  ].sort((left, right) => right.length - left.length);
  for (const entry of entries) {
    if (entry.path === "node_modules/.package-lock.json") {
      continue;
    }
    if (entry.path.startsWith("node_modules/.bin/")) {
      if (entry.type !== "symlink") {
        throw new Error("C6 installed .bin entry must be a symlink");
      }
      continue;
    }
    if (!lockedLocations.some((location) =>
      entry.path.startsWith(`${location}/`)
    )) {
      throw new Error(
        `C6 installed tree contains package absent from lock: ${entry.path}`,
      );
    }
  }
  for (const registry of registryEntries) {
    const path = `${registry.location}/package.json`;
    const packageJsonEntry = requiredRegularTarEntry(
      tarEntries,
      path,
      "installed tree archive",
    );
    const packageJson = parseJsonSchema(
      packageMetadataSchema,
      packageJsonEntry.bytes,
      `installed ${registry.name} package.json`,
    );
    if (
      packageJson.name !== registry.name ||
      packageJson.version !== registry.version ||
      sha256(packageJsonEntry.bytes) !==
        offlinePackageJsonSha256.get(registry.integrity)
    ) {
      throw new Error(
        `C6 installed package ${registry.location} does not match lock and offline tarball`,
      );
    }
  }
}

function validateBuildProfile(input: {
  expected: C6PackageClosureExpectedIdentity;
  installedTreeManifestSha256: string;
  packageLockSha256: string;
  profile: z.infer<typeof buildProfileSchema>;
}): void {
  const { expected, profile } = input;
  if (
    profile.operatingSystem !== "linux" ||
    profile.architecture !== "x64" ||
    profile.imageSha256 !== expected.image.sha256
  ) {
    throw new Error("C6 build profile OS, architecture, or image drifted");
  }
  if (
    !sameJson(
      {
        bun: profile.bun,
        node: profile.node,
        npm: profile.npm,
      },
      expected.image.runtime,
    )
  ) {
    throw new Error("C6 build profile runtime identity drifted");
  }
  if (
    profile.libc.family !== "glibc" ||
    !sameJson(profile.install.command, EXPECTED_INSTALL_COMMAND) ||
    !profile.install.cacheStartedEmpty ||
    profile.install.networkIsolation !== "container-network-none" ||
    profile.install.sourceCheckoutMounted ||
    profile.install.credentialsPresent ||
    profile.install.exitCode !== 0
  ) {
    throw new Error("C6 build profile offline install receipt is invalid");
  }
  if (
    profile.install.packageLockSha256Before !== input.packageLockSha256 ||
    profile.install.packageLockSha256After !== input.packageLockSha256
  ) {
    throw new Error("C6 build profile package-lock drifted during install");
  }
  if (
    profile.installedTreeManifestSha256 !==
      input.installedTreeManifestSha256
  ) {
    throw new Error("C6 build profile installed tree identity does not match");
  }
  if (
    profile.smoke.goodmemoryVersion !== expected.package.version ||
    profile.smoke.goodmemoryVersionExitCode !== 0 ||
    profile.smoke.goodmemoryHostCommandExitCode !== 0 ||
    !profile.smoke.sqliteVssLinuxX64Present
  ) {
    throw new Error("C6 build profile smoke receipt is invalid");
  }
}

function assertExactAssetSet(
  assetLock: C6AssetLock,
  closure: z.infer<typeof packageClosureSchema>,
  offlineEntries: readonly C6OfflineIndexEntry[],
): void {
  const expectedPaths = new Set([
    "closure.json",
    closure.buildProfile.path,
    closure.consumer.packageJson.path,
    closure.consumer.packageLock.path,
    closure.installedTree.archive.path,
    closure.installedTree.manifest.path,
    closure.offline.index.path,
    closure.package.tarball.path,
    ...offlineEntries.map((entry) => entry.tarball.path),
  ]);
  const actualPaths = new Set(assetLock.files.map((file) => file.path));
  if (
    actualPaths.size !== expectedPaths.size ||
    [...actualPaths].some((path) => !expectedPaths.has(path))
  ) {
    throw new Error(
      "C6 package closure asset set contains a missing or extra artifact",
    );
  }
}

async function readLockedArtifact(
  root: string,
  assetLock: C6AssetLock,
  reference: {
    bytes?: number;
    path: string;
    sha256: string;
  },
  label: string,
): Promise<Buffer> {
  assertCanonicalRelativePath(reference.path, label);
  const asset = assetLock.files.find((file) => file.path === reference.path);
  if (
    asset === undefined ||
    asset.sha256 !== reference.sha256 ||
    (reference.bytes !== undefined && asset.bytes !== reference.bytes)
  ) {
    throw new Error(`C6 ${label} does not match the asset lock`);
  }
  const bytes = await readC6StableRegularFile(
    join(root, reference.path),
    label,
  );
  if (
    sha256(bytes) !== reference.sha256 ||
    (reference.bytes !== undefined && bytes.byteLength !== reference.bytes)
  ) {
    throw new Error(`C6 ${label} byte identity does not match`);
  }
  return bytes;
}

function parseGzipTar(bytes: Buffer, label: string): ParsedTarEntry[] {
  let tar: Buffer;
  try {
    tar = gunzipSync(bytes);
  } catch {
    throw new Error(`C6 ${label} must be a gzip tarball`);
  }
  return parseTar(tar, label);
}

function parseTar(bytes: Buffer, label: string): ParsedTarEntry[] {
  const entries: ParsedTarEntry[] = [];
  let offset = 0;
  let pendingPax: Record<string, string> | undefined;
  let pendingLongName: string | undefined;
  let pendingLongLink: string | undefined;
  let ended = false;
  while (offset + 512 <= bytes.byteLength) {
    const header = bytes.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) {
      ended = true;
      break;
    }
    validateTarChecksum(header, label);
    const headerSize = parseTarOctal(header.subarray(124, 136), label);
    if (offset + headerSize > bytes.byteLength) {
      throw new Error(`C6 ${label} has a truncated tar entry`);
    }
    const body = bytes.subarray(offset, offset + headerSize);
    offset += Math.ceil(headerSize / 512) * 512;
    const type = tarText(header.subarray(156, 157)) || "0";
    const headerPath = joinedTarPath(
      tarText(header.subarray(345, 500)),
      tarText(header.subarray(0, 100)),
    );
    if (type === "x") {
      pendingPax = parsePax(body, label);
      continue;
    }
    if (type === "L") {
      pendingLongName = tarBodyText(body);
      continue;
    }
    if (type === "K") {
      pendingLongLink = tarBodyText(body);
      continue;
    }
    if (type === "g") {
      throw new Error(`C6 ${label} rejects global PAX headers`);
    }
    const path = pendingPax?.path ?? pendingLongName ?? headerPath;
    const linkName = pendingPax?.linkpath ??
      pendingLongLink ??
      tarText(header.subarray(157, 257));
    if (
      pendingPax?.size !== undefined &&
      Number(pendingPax.size) !== headerSize
    ) {
      throw new Error(`C6 ${label} rejects inconsistent PAX size`);
    }
    entries.push({
      bytes: Buffer.from(body),
      linkName,
      mode: parseTarOctal(header.subarray(100, 108), label) & 0o777,
      path,
      type,
    });
    pendingPax = undefined;
    pendingLongName = undefined;
    pendingLongLink = undefined;
  }
  if (
    !ended ||
    pendingPax !== undefined ||
    pendingLongName !== undefined ||
    pendingLongLink !== undefined ||
    bytes.subarray(offset).some((byte) => byte !== 0)
  ) {
    throw new Error(`C6 ${label} has an invalid tar terminator`);
  }
  assertUniquePaths(entries.map((entry) => entry.path), `${label} tar`);
  return entries;
}

function validateTarChecksum(header: Buffer, label: string): void {
  const expected = parseTarOctal(header.subarray(148, 156), label);
  let actual = 0;
  for (let index = 0; index < header.byteLength; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  if (actual !== expected) {
    throw new Error(`C6 ${label} has an invalid tar checksum`);
  }
}

function parsePax(bytes: Buffer, label: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let offset = 0;
  while (offset < bytes.byteLength) {
    const space = bytes.indexOf(0x20, offset);
    if (space < 0) {
      throw new Error(`C6 ${label} has an invalid PAX header`);
    }
    const length = Number(bytes.subarray(offset, space).toString("ascii"));
    if (
      !Number.isInteger(length) ||
      length <= 0 ||
      offset + length > bytes.byteLength
    ) {
      throw new Error(`C6 ${label} has an invalid PAX record length`);
    }
    const record = bytes
      .subarray(space + 1, offset + length - 1)
      .toString("utf8");
    const equals = record.indexOf("=");
    if (equals <= 0) {
      throw new Error(`C6 ${label} has an invalid PAX record`);
    }
    fields[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return fields;
}

function parseTarOctal(bytes: Buffer, label: string): number {
  if ((bytes[0] & 0x80) !== 0) {
    throw new Error(`C6 ${label} rejects base-256 tar numbers`);
  }
  const value = bytes.toString("ascii").replace(/\0.*$/u, "").trim();
  if (!/^[0-7]+$/u.test(value)) {
    throw new Error(`C6 ${label} has an invalid tar number`);
  }
  return Number.parseInt(value, 8);
}

function parseJsonSchema<T>(
  schema: z.ZodType<T>,
  bytes: Buffer,
  label: string,
): T {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error(`C6 ${label} contains invalid JSON`);
  }
  const parsed = parseSchema(schema, value, label);
  return parsed;
}

function parseSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`invalid C6 ${label}`);
  }
  return parsed.data;
}

function extractDependencySpec(value: Record<string, unknown>): DependencySpec {
  return {
    dependencies: parseOptionalDependencyMap(
      value.dependencies,
      "dependencies",
    ),
    optionalDependencies: parseOptionalDependencyMap(
      value.optionalDependencies,
      "optionalDependencies",
    ),
    peerDependencies: parseOptionalDependencyMap(
      value.peerDependencies,
      "peerDependencies",
    ),
    peerDependenciesMeta: parseOptionalPeerMeta(value.peerDependenciesMeta),
  };
}

function parseOptionalDependencyMap(
  value: unknown,
  label: string,
): Record<string, string> {
  if (value === undefined) {
    return {};
  }
  return parseSchema(dependencyMapSchema, value, label);
}

function parseOptionalPeerMeta(
  value: unknown,
): Record<string, { optional?: boolean }> {
  if (value === undefined) {
    return {};
  }
  return parseSchema(peerDependencyMetaSchema, value, "peerDependenciesMeta");
}

function groupRegistryEntries(
  entries: readonly RegistryLockEntry[],
): Array<{
  integrity: string;
  lockLocations: string[];
  name: string;
  resolved: string;
  version: string;
}> {
  const groups = new Map<string, RegistryLockEntry[]>();
  for (const entry of entries) {
    const key = [
      entry.name,
      entry.version,
      entry.resolved,
      entry.integrity,
    ].join("\0");
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      integrity: group[0].integrity,
      lockLocations: group
        .map((entry) => entry.location)
        .sort(compareUtf8),
      name: group[0].name,
      resolved: group[0].resolved,
      version: group[0].version,
    }))
    .sort(compareOfflineEntries);
}

function compareOfflineEntries(
  left: Pick<C6OfflineIndexEntry, "integrity" | "name" | "resolved" | "version">,
  right: Pick<C6OfflineIndexEntry, "integrity" | "name" | "resolved" | "version">,
): number {
  return compareUtf8(
    [left.name, left.version, left.resolved, left.integrity].join("\0"),
    [right.name, right.version, right.resolved, right.integrity].join("\0"),
  );
}

function packageNameFromLockLocation(location: string): string {
  const marker = "node_modules/";
  const lastMarker = location.lastIndexOf(marker);
  const remainder = location.slice(lastMarker + marker.length);
  const parts = remainder.split("/");
  if (parts[0]?.startsWith("@")) {
    if (parts.length !== 2) {
      throw new Error(`C6 package-lock has invalid scoped location ${location}`);
    }
    return `${parts[0]}/${parts[1]}`;
  }
  if (parts.length !== 1 || parts[0].length === 0) {
    throw new Error(`C6 package-lock has invalid location ${location}`);
  }
  return parts[0];
}

function isNodeModulesLocation(location: string): boolean {
  return location.startsWith("node_modules/") &&
    !location.includes("\\") &&
    !location.split("/").includes("..");
}

function requiredRegularTarEntry(
  entries: readonly ParsedTarEntry[],
  path: string,
  label: string,
): ParsedTarEntry {
  const entry = entries.find((candidate) => candidate.path === path);
  if (entry?.type !== "0") {
    throw new Error(`C6 ${label} is missing regular file ${path}`);
  }
  return entry;
}

function assertSafePackageTar(
  entries: readonly ParsedTarEntry[],
  label: string,
): void {
  for (const entry of entries) {
    assertCanonicalRelativePath(entry.path, `${label} entry`);
    if (
      entry.path !== "package" &&
      !entry.path.startsWith("package/")
    ) {
      throw new Error(`C6 ${label} entry escapes package root`);
    }
    if (entry.type !== "0" && entry.type !== "5") {
      throw new Error(
        `C6 ${label} rejects link or special tar entry ${entry.path}`,
      );
    }
  }
}

function assertInstalledPath(path: string): void {
  assertCanonicalRelativePath(path, "installed tree path");
  if (!path.startsWith("node_modules/")) {
    throw new Error(`C6 installed tree path escapes node_modules: ${path}`);
  }
}

function assertSafeInstalledSymlink(path: string, target: string): void {
  if (
    target.includes("\\") ||
    target.includes("\0") ||
    posix.isAbsolute(target)
  ) {
    throw new Error(`C6 installed tree symlink escapes root: ${path}`);
  }
  const resolved = posix.normalize(posix.join(posix.dirname(path), target));
  if (!resolved.startsWith("node_modules/")) {
    throw new Error(`C6 installed tree symlink escapes root: ${path}`);
  }
}

function assertCanonicalRelativePath(path: string, label: string): void {
  if (
    path.includes("\\") ||
    path.includes("\0") ||
    posix.isAbsolute(path) ||
    posix.normalize(path) !== path ||
    path === "." ||
    path.split("/").includes("..")
  ) {
    throw new Error(`C6 ${label} must be a canonical relative path`);
  }
}

function assertUniquePaths(paths: readonly string[], label: string): void {
  if (new Set(paths).size !== paths.length) {
    throw new Error(`C6 ${label} contains duplicate paths`);
  }
}

function assetSha256(assetLock: C6AssetLock, path: string): string {
  const asset = assetLock.files.find((file) => file.path === path);
  if (asset === undefined) {
    throw new Error(`C6 asset lock is missing ${path}`);
  }
  return asset.sha256;
}

function assertSri(
  bytes: Buffer,
  integrity: string,
  label: string,
): void {
  const expected = sriDigest(integrity);
  const actual = createHash("sha512").update(bytes).digest();
  if (!actual.equals(expected)) {
    throw new Error(`C6 ${label} SRI does not match its bytes`);
  }
}

function sriDigest(integrity: string): Buffer {
  if (!isValidSri(integrity)) {
    throw new Error("C6 artifact has invalid sha512 SRI");
  }
  const encoded = integrity.slice("sha512-".length);
  const digest = Buffer.from(encoded, "base64");
  if (
    digest.byteLength !== 64 ||
    digest.toString("base64") !== encoded
  ) {
    throw new Error("C6 artifact has non-canonical sha512 SRI");
  }
  return digest;
}

function isValidSri(value: string): boolean {
  return SHA512_SRI_PATTERN.test(value);
}

function joinedTarPath(prefix: string, name: string): string {
  return prefix.length === 0 ? name : `${prefix}/${name}`;
}

function tarText(bytes: Buffer): string {
  const zero = bytes.indexOf(0);
  return bytes.subarray(0, zero < 0 ? bytes.byteLength : zero).toString("utf8");
}

function tarBodyText(bytes: Buffer): string {
  const zero = bytes.indexOf(0);
  const end = zero < 0 ? bytes.byteLength : zero;
  return bytes.subarray(0, end).toString("utf8").replace(/\n$/u, "");
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalJson);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareUtf8(left, right))
        .map(([key, entry]) => [key, canonicalJson(entry)]),
    );
  }
  return value;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJson(left)) ===
    JSON.stringify(canonicalJson(right));
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
