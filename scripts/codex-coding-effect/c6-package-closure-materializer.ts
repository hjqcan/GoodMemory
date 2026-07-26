import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  buildC6AssetLock,
  loadC6AssetLock,
  readC6StableRegularFile,
  serializeC6AssetLock,
  verifyC6AssetClosure,
} from "./c6-asset-lock";
import { inspectC6PackageTarball } from "./c6-package";
import {
  computeC6DependencySpecSha256,
  computeC6OfflineTarballSetSha256,
  validateC6PackageClosure,
} from "./c6-package-closure";
import type {
  C6OfflineIndexEntry,
  C6PackageClosureExpectedIdentity,
} from "./c6-package-closure";
import {
  buildC6InstalledTreeManifestFromDirectory,
  buildC6LinuxGoodMemorySmokeDockerCreateCommand,
  parseC6DockerCreatedContainerId,
  runC6LinuxPackageClosureRebuild,
  verifyC6LinuxPackageClosureReceipt,
} from "./c6-package-closure-linux";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const sha512SriSchema = z.string().regex(
  /^sha512-[A-Za-z0-9+/]+={0,2}$/u,
);
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
const materializerInputSchema = z.object({
  expectedImageSha256: sha256Schema,
  expectedPackageSha256: sha256Schema,
  imageReference: z.string().min(1),
  outputRoot: z.string().min(1),
  packageTarballPath: z.string().min(1),
  runtime: runtimeIdentitySchema,
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
const artifactReferenceSchema = z.object({
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const materializationManifestSchema = z.object({
  closure: z.object({
    assetLock: artifactReferenceSchema.extend({
      assetRootSha256: sha256Schema,
    }).strict(),
    manifest: artifactReferenceSchema,
  }).strict(),
  expectedIdentity: artifactReferenceSchema,
  kind: z.literal("c6-package-closure-materialization"),
  linuxRebuildReceipt: artifactReferenceSchema,
  package: z.object({
    imageSha256: sha256Schema,
    packageSha256: sha256Schema,
    version: z.string().min(1),
  }).strict(),
  runnerSources: z.object({
    assetLock: artifactReferenceSchema,
    cli: artifactReferenceSchema,
    closureValidator: artifactReferenceSchema,
    linuxRebuild: artifactReferenceSchema,
    materializer: artifactReferenceSchema,
    packageInspector: artifactReferenceSchema,
  }).strict(),
  schemaVersion: z.literal(1),
}).strict();
const acquisitionPackageLockSchema = z.object({
  lockfileVersion: z.literal(3),
  packages: z.record(z.string(), z.record(z.string(), z.unknown())),
  requires: z.literal(true),
}).passthrough();
const packageMetadataSchema = z.object({
  bundleDependencies: z.unknown().optional(),
  bundledDependencies: z.unknown().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  name: z.literal("goodmemory"),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
  peerDependenciesMeta: z.record(
    z.string(),
    z.object({
      optional: z.boolean().optional(),
    }).strict(),
  ).optional(),
  version: z.string().min(1),
}).passthrough();
const packageLockSchema = z.object({
  lockfileVersion: z.literal(3),
  name: z.literal("goodmemory-c6-runtime"),
  packages: z.record(
    z.string(),
    z.object({
      dev: z.boolean().optional(),
      integrity: z.string().optional(),
      link: z.boolean().optional(),
      resolved: z.string().optional(),
      version: z.string().optional(),
    }).passthrough(),
  ),
  requires: z.literal(true),
  version: z.literal("0.0.0"),
}).strict();
const imageInspectSchema = z.object({
  Architecture: z.string(),
  Id: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  Os: z.string(),
  RepoDigests: z.array(z.string()).nullable().optional(),
}).passthrough();
const containerInspectSchema = z.object({
  Config: z.object({
    Env: z.array(z.string()).nullable().optional(),
    Labels: z.record(z.string(), z.string()).nullable().optional(),
  }).passthrough(),
  HostConfig: z.object({
    CapDrop: z.array(z.string()).nullable().optional(),
    NetworkMode: z.string(),
    ReadonlyRootfs: z.boolean(),
    SecurityOpt: z.array(z.string()).nullable().optional(),
  }).passthrough(),
  Image: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  Mounts: z.array(z.object({
    Destination: z.string(),
    RW: z.boolean(),
    Source: z.string(),
    Type: z.string(),
  }).passthrough()),
  State: z.object({
    ExitCode: z.number().int(),
  }).passthrough().optional(),
}).passthrough();

const DOCKER_COMMAND_TIMEOUT_MS = 30_000;
const ACQUISITION_TIMEOUT_MS = 600_000;
const OFFLINE_BUILD_TIMEOUT_MS = 600_000;
const SMOKE_TIMEOUT_MS = 120_000;
const ALLOWED_CONTAINER_ENVIRONMENT_KEYS = new Set([
  "GOODMEMORY_BUN_BINARY",
  "HOME",
  "NODE_VERSION",
  "NPM_CONFIG_GLOBALCONFIG",
  "NPM_CONFIG_USERCONFIG",
  "PATH",
  "YARN_VERSION",
  "npm_config_update_notifier",
]);
const OFFLINE_INSTALL_PROFILE_COMMAND = [
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

const ACQUISITION_SCRIPT = `#!/bin/sh
set -eu
umask 022

test "$(uname -s)" = "Linux"
test "$(uname -m)" = "x86_64"
test ! -e /work/acquisition/npm-cache

mkdir -p /work/acquisition/home /work/offline/tarballs
: > /work/acquisition/empty-global-npmrc
: > /work/acquisition/empty-user-npmrc
cp /work/consumer/package.json /work/acquisition/package-before.json

cd /work/consumer
npm install --ignore-scripts --omit=dev --include=optional --install-strategy=hoisted --no-audit --no-fund --package-lock=true --cache /work/acquisition/npm-cache
cmp /work/acquisition/package-before.json /work/consumer/package.json
node /work/acquisition.mjs

rm -rf /work/consumer/node_modules /work/acquisition/npm-cache
`;

const ACQUISITION_MODULE = `import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const input = JSON.parse(await readFile("/work/materializer-input.json", "utf8"));
const source = JSON.parse(await readFile("/work/consumer/package-lock.json", "utf8"));
const hidden = JSON.parse(await readFile("/work/consumer/node_modules/.package-lock.json", "utf8"));
const reconstructLock = ${reconstructAcquisitionPackageLockObject.toString()};
const lock = reconstructLock({
  goodmemorySpecifier: input.goodmemorySpecifier,
  hidden,
  packageIntegrity: input.packageIntegrity,
  packageVersion: input.packageVersion,
  source,
});
const packages = lock.packages;
await writeFile(
  "/work/consumer/package-lock.json",
  JSON.stringify(lock, null, 2) + "\\n",
);

const downloaded = new Set();
for (const [location, entry] of Object.entries(packages)) {
  if (location === "" || location === "node_modules/goodmemory") {
    continue;
  }
  if (
    entry.dev === true ||
    entry.link === true ||
    typeof entry.integrity !== "string" ||
    typeof entry.resolved !== "string" ||
    typeof entry.version !== "string"
  ) {
    throw new Error("acquisition registry lock entry is invalid: " + location);
  }
  const url = new URL(entry.resolved);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("acquisition registry URL is not credential-free HTTPS");
  }
  if (!entry.integrity.startsWith("sha512-")) {
    throw new Error("acquisition registry integrity must be sha512");
  }
  const digest = Buffer.from(entry.integrity.slice(7), "base64");
  if (digest.length !== 64 || digest.toString("base64") !== entry.integrity.slice(7)) {
    throw new Error("acquisition registry integrity is not canonical");
  }
  const digestHex = digest.toString("hex");
  if (downloaded.has(digestHex)) {
    continue;
  }
  const response = await fetch(url, {
    credentials: "omit",
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error("registry tarball fetch failed: " + response.status);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha512").update(bytes).digest();
  if (!actual.equals(digest)) {
    throw new Error("registry tarball SRI mismatch");
  }
  await mkdir("/work/offline/tarballs", { recursive: true });
  await writeFile("/work/offline/tarballs/" + digestHex + ".tgz", bytes);
  downloaded.add(digestHex);
}

`;

const OFFLINE_BUILD_SCRIPT = `#!/bin/sh
set -eu
umask 022

test "$(uname -s)" = "Linux"
test "$(uname -m)" = "x86_64"
test ! -e /work/offline-build/npm-cache
test ! -e /work/consumer/node_modules

mkdir -p /work/offline-build/home /work/observed /work/installed
: > /work/offline-build/empty-global-npmrc
: > /work/offline-build/empty-user-npmrc

hash_file() {
  node -e 'const { createHash } = require("node:crypto"); const { readFileSync } = require("node:fs"); process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"))' "$1"
}

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
printf '%s\\n' "$bun_path" > /work/observed/bun-path
hash_file /etc/os-release > /work/observed/os-release-sha256
getconf GNU_LIBC_VERSION > /work/observed/libc
uname -s > /work/observed/operating-system
uname -m > /work/observed/architecture

hash_file /work/consumer/package-lock.json > /work/observed/package-lock-before
seeded=0
for archive in /work/offline/tarballs/*.tgz; do
  test -f "$archive"
  npm cache add "$archive" --cache /work/offline-build/npm-cache >/dev/null
  seeded=$((seeded + 1))
done
printf '%s\\n' "$seeded" > /work/observed/seeded-tarball-count

cd /work/consumer
npm ci --offline --ignore-scripts --omit=dev --include=optional --install-strategy=hoisted --no-audit --no-fund --cache /work/offline-build/npm-cache
hash_file /work/consumer/package-lock.json > /work/observed/package-lock-after
cmp /work/observed/package-lock-before /work/observed/package-lock-after
test -f /work/consumer/node_modules/sqlite-vss-linux-x64/package.json
printf 'true\\n' > /work/observed/sqlite-vss-linux-x64-present

tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --format=posix --pax-option=delete=atime,delete=ctime -cf /work/installed/node_modules.tar -C /work/consumer node_modules
`;

export type C6PackageClosureRuntimeIdentity = z.infer<
  typeof runtimeIdentitySchema
>;

export interface C6PackageClosureMaterializerInput {
  expectedImageSha256: string;
  expectedPackageSha256: string;
  imageReference: string;
  outputRoot: string;
  packageTarballPath: string;
  runtime: C6PackageClosureRuntimeIdentity;
}

export interface C6PackageClosureMaterializerResult {
  closureRoot: string;
  expectedIdentitySha256: string;
  expectedIdentityPath: string;
  linuxRebuildReceiptSha256: string;
  linuxRebuildReceiptPath: string;
  liveLinuxRebuildProven: boolean;
  materializationManifestPath: string;
  materializationManifestSha256: string;
  outputRoot: string;
  package: {
    name: "goodmemory";
    sha256: string;
    version: string;
  };
  persistedReceiptLinuxRebuildProven: false;
  persistedReceiptValidation: "frozen-runner-receipt-structure-only";
  rootAssetLockPath: string;
  rootAssetLockSha256: string;
  rootAssetRootSha256: string;
}

export interface C6PackageClosurePreparedMaterialization {
  expected: C6PackageClosureExpectedIdentity;
  linuxRebuildReceiptSha256: string;
  persistedReceiptValidation:
    "frozen-runner-receipt-structure-only";
}

export interface C6PackageClosureMaterializerExecutionContext {
  input: C6PackageClosureMaterializerInput;
  outputRoot: string;
  packageInput: C6MaterializerPackageInput;
  stagingRoot: string;
  workRoot: string;
}

export type C6PackageClosureMaterializerExecutor = (
  context: C6PackageClosureMaterializerExecutionContext,
) => Promise<C6PackageClosurePreparedMaterialization>;

export interface C6PackageClosureMaterializationVerification {
  expectedIdentitySha256: string;
  linuxRebuildProven: false;
  linuxRebuildReceiptSha256: string;
  materializationManifestSha256: string;
  receiptValidation: "frozen-runner-receipt-structure-only";
  rootAssetLockSha256: string;
  rootAssetRootSha256: string;
}

export interface C6MaterializerPackageInput {
  dependencySpecSha256: string;
  packageBytes: Buffer;
  packageIntegrity: string;
  packageJson: z.infer<typeof packageMetadataSchema>;
  packageJsonBytes: Buffer;
  packageJsonSha256: string;
  packageSha256: string;
  packageVersion: string;
}

export interface C6OfflineIndexMaterialization {
  bytes: string;
  index: {
    entries: C6OfflineIndexEntry[];
    packageLockSha256: string;
    schemaVersion: 1;
  };
  tarballSetSha256: string;
}

export function parseC6PackageClosureRuntimeIdentity(
  value: unknown,
): C6PackageClosureRuntimeIdentity {
  return runtimeIdentitySchema.parse(value);
}

export function reconstructC6MaterializerPackageLock(input: {
  goodmemorySpecifier: string;
  hiddenPackageLockBytes: Buffer;
  packageIntegrity: string;
  packageVersion: string;
  sourcePackageLockBytes: Buffer;
}): string {
  if (
    input.goodmemorySpecifier.length === 0 ||
    input.packageVersion.length === 0 ||
    !sha512SriSchema.safeParse(input.packageIntegrity).success
  ) {
    throw new Error("C6 materializer lock reconstruction input is invalid");
  }
  const source = parseJson(
    acquisitionPackageLockSchema,
    input.sourcePackageLockBytes,
    "acquisition source package-lock",
  );
  const hidden = parseJson(
    acquisitionPackageLockSchema,
    input.hiddenPackageLockBytes,
    "acquisition hidden package-lock",
  );
  const lock = reconstructAcquisitionPackageLockObject({
    goodmemorySpecifier: input.goodmemorySpecifier,
    hidden,
    packageIntegrity: input.packageIntegrity,
    packageVersion: input.packageVersion,
    source,
  });
  return serializeJson(packageLockSchema.parse(lock));
}

function reconstructAcquisitionPackageLockObject(input: {
  goodmemorySpecifier: string;
  hidden: unknown;
  packageIntegrity: string;
  packageVersion: string;
  source: unknown;
}): unknown {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  if (!isRecord(input.source) || !isRecord(input.hidden)) {
    throw new Error("acquisition package-lock root is invalid");
  }
  const sourcePackages = input.source.packages;
  const hiddenPackages = input.hidden.packages;
  if (
    input.source.lockfileVersion !== 3 ||
    input.source.requires !== true ||
    input.hidden.lockfileVersion !== 3 ||
    input.hidden.requires !== true ||
    !isRecord(sourcePackages) ||
    !isRecord(hiddenPackages) ||
    !isRecord(sourcePackages[""])
  ) {
    throw new Error("acquisition package-lock root is invalid");
  }
  const packagePairs: Array<[string, Record<string, unknown>]> = [
    ["", sourcePackages[""]],
  ];
  for (
    const location of Object.keys(hiddenPackages).sort((left, right) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right))
    )
  ) {
    if (location === "") {
      continue;
    }
    const entry = hiddenPackages[location];
    if (!isRecord(entry)) {
      throw new Error(
        `acquisition hidden package-lock entry is invalid: ${location}`,
      );
    }
    packagePairs.push([location, entry]);
  }
  const goodmemoryIndex = packagePairs.findIndex(
    ([location]) => location === "node_modules/goodmemory",
  );
  const goodmemory = packagePairs[goodmemoryIndex]?.[1];
  if (
    goodmemoryIndex < 0 ||
    goodmemory === undefined ||
    goodmemory.version !== input.packageVersion
  ) {
    throw new Error(
      "acquisition installed GoodMemory identity is invalid",
    );
  }
  packagePairs[goodmemoryIndex] = [
    "node_modules/goodmemory",
    {
      ...goodmemory,
      integrity: input.packageIntegrity,
      resolved: input.goodmemorySpecifier,
    },
  ];
  return {
    lockfileVersion: 3,
    name: "goodmemory-c6-runtime",
    packages: Object.fromEntries(packagePairs),
    requires: true,
    version: "0.0.0",
  };
}

export function buildC6PackageClosureAcquisitionDockerCreateCommand(input: {
  containerUser: string;
  expectedImageSha256: string;
  imageReference: string;
  workRoot: string;
}): string[] {
  return buildMaterializerDockerCreateCommand({
    ...input,
    environmentRoot: "/work/acquisition",
    networkMode: "bridge",
    phase: "acquisition",
    scriptPath: "/work/acquisition.sh",
  });
}

export function buildC6PackageClosureOfflineDockerCreateCommand(input: {
  containerUser: string;
  expectedImageSha256: string;
  imageReference: string;
  workRoot: string;
}): string[] {
  return buildMaterializerDockerCreateCommand({
    ...input,
    environmentRoot: "/work/offline-build",
    networkMode: "none",
    phase: "offline",
    scriptPath: "/work/offline-build.sh",
  });
}

export function buildC6PackageClosureOfflineIndex(input: {
  packageLockBytes: Buffer;
  tarballsBySha512Hex: ReadonlyMap<string, Uint8Array>;
}): C6OfflineIndexMaterialization {
  const packageLock = parseJson(
    packageLockSchema,
    input.packageLockBytes,
    "materialized package-lock",
  );
  const groups = new Map<string, {
    integrity: string;
    lockLocations: string[];
    name: string;
    resolved: string;
    version: string;
  }>();
  const expectedTarballs = new Set<string>();
  for (const [location, entry] of Object.entries(packageLock.packages)) {
    if (location === "" || location === "node_modules/goodmemory") {
      continue;
    }
    if (
      entry.dev === true ||
      entry.link === true ||
      entry.integrity === undefined ||
      entry.resolved === undefined ||
      entry.version === undefined
    ) {
      throw new Error(
        `C6 materializer package-lock registry entry is invalid: ${location}`,
      );
    }
    const integrity = canonicalSha512Sri(entry.integrity);
    assertCredentialFreeHttps(entry.resolved);
    const name = packageNameFromLockLocation(location);
    const key = [
      name,
      entry.version,
      entry.resolved,
      integrity,
    ].join("\0");
    const group = groups.get(key) ?? {
      integrity,
      lockLocations: [],
      name,
      resolved: entry.resolved,
      version: entry.version,
    };
    group.lockLocations.push(location);
    groups.set(key, group);
    expectedTarballs.add(sriHex(integrity));
  }
  if (
    input.tarballsBySha512Hex.size !== expectedTarballs.size ||
    [...input.tarballsBySha512Hex.keys()].some((key) =>
      !expectedTarballs.has(key)
    )
  ) {
    throw new Error(
      "C6 materializer downloaded tarball set does not match package-lock",
    );
  }
  const entries = [...groups.values()]
    .sort(compareOfflineGroups)
    .map((group): C6OfflineIndexEntry => {
      const digestHex = sriHex(group.integrity);
      const bytes = input.tarballsBySha512Hex.get(digestHex);
      if (bytes === undefined) {
        throw new Error(
          "C6 materializer downloaded tarball set is incomplete",
        );
      }
      if (
        !createHash("sha512").update(bytes).digest()
          .equals(Buffer.from(digestHex, "hex"))
      ) {
        throw new Error("C6 materializer downloaded tarball SRI mismatch");
      }
      return {
        integrity: group.integrity,
        lockLocations: group.lockLocations.sort(compareUtf8),
        name: group.name,
        resolved: group.resolved,
        tarball: {
          bytes: bytes.byteLength,
          path: `offline/tarballs/${digestHex}.tgz`,
          sha256: sha256(bytes),
        },
        version: group.version,
      };
    });
  if (entries.length !== expectedTarballs.size) {
    throw new Error(
      "C6 materializer registry groups reuse one tarball identity",
    );
  }
  const index = {
    entries,
    packageLockSha256: sha256(input.packageLockBytes),
    schemaVersion: 1 as const,
  };
  return {
    bytes: `${JSON.stringify(index, null, 2)}\n`,
    index,
    tarballSetSha256: computeC6OfflineTarballSetSha256(entries),
  };
}

export async function inspectC6PackageClosureMaterializerTarball(input: {
  expectedPackageSha256: string;
  packageTarballPath: string;
}): Promise<C6MaterializerPackageInput> {
  if (!sha256Schema.safeParse(input.expectedPackageSha256).success) {
    throw new Error("C6 materializer expected package hash is invalid");
  }
  const packageTarballPath = await canonicalFile(
    input.packageTarballPath,
    "package tarball",
  );
  const packageBytes = await readC6StableRegularFile(
    packageTarballPath,
    "materializer package tarball",
  );
  const packageSha256 = sha256(packageBytes);
  if (packageSha256 !== input.expectedPackageSha256) {
    throw new Error("C6 materializer package tarball hash does not match");
  }
  const packageJsonText = await runTarExtractPackageJson(packageTarballPath);
  const packageJsonBytes = Buffer.from(packageJsonText);
  const packageJson = parseJson(
    packageMetadataSchema,
    packageJsonBytes,
    "materializer package.json",
  );
  if (
    Object.hasOwn(packageJson, "bundleDependencies") ||
    Object.hasOwn(packageJson, "bundledDependencies")
  ) {
    throw new Error("C6 materializer package rejects bundled dependencies");
  }
  await inspectC6PackageTarball({
    expectedSha256: input.expectedPackageSha256,
    expectedVersion: packageJson.version,
    path: packageTarballPath,
  });
  const after = await readC6StableRegularFile(
    packageTarballPath,
    "materializer package tarball",
  );
  if (sha256(after) !== packageSha256) {
    throw new Error("C6 materializer package tarball drifted");
  }
  return {
    dependencySpecSha256: computeC6DependencySpecSha256(packageJson),
    packageBytes,
    packageIntegrity:
      `sha512-${createHash("sha512").update(packageBytes).digest("base64")}`,
    packageJson,
    packageJsonBytes,
    packageJsonSha256: sha256(packageJsonBytes),
    packageSha256,
    packageVersion: packageJson.version,
  };
}

export async function materializeC6PackageClosure(
  rawInput: C6PackageClosureMaterializerInput,
  executor: C6PackageClosureMaterializerExecutor =
    executeC6PackageClosureMaterialization,
): Promise<C6PackageClosureMaterializerResult> {
  const input = materializerInputSchema.parse(rawInput);
  assertPinnedImageReference(
    input.imageReference,
    input.expectedImageSha256,
  );
  const reservation = await reserveOutputRoot(input.outputRoot);
  const liveExecutor =
    executor === executeC6PackageClosureMaterialization;
  let published = false;
  let stagingRoot: string | undefined;
  let workRoot: string | undefined;
  try {
    const packageInput = await inspectC6PackageClosureMaterializerTarball({
      expectedPackageSha256: input.expectedPackageSha256,
      packageTarballPath: input.packageTarballPath,
    });
    stagingRoot = await mkdtemp(
      join(reservation.outputRoot, ".staging-"),
    );
    workRoot = await mkdtemp(
      join(
        reservation.parent,
        `.${basename(reservation.outputRoot)}.work-`,
      ),
    );
    const runnerSources = await freezeMaterializerRunnerSources(
      stagingRoot,
    );
    const prepared = await executor({
      input,
      outputRoot: reservation.outputRoot,
      packageInput,
      stagingRoot,
      workRoot,
    });
    const evidence = await prepareRootMaterializationEvidence({
      expected: prepared.expected,
      linuxRebuildReceiptSha256:
        prepared.linuxRebuildReceiptSha256,
      runnerSources,
      stagingRoot,
    });
    await rm(workRoot, { recursive: true });
    workRoot = undefined;
    await assertOutputReservationIdentity(reservation);
    await publishStagingRoot(stagingRoot, reservation);
    stagingRoot = undefined;
    await assertOutputReservationIdentity(reservation);
    const rootAssetLock = await buildC6AssetLock(
      reservation.outputRoot,
    );
    const rootAssetLockBytes = serializeC6AssetLock(rootAssetLock);
    const rootAssetLockPath = join(
      reservation.outputRoot,
      "asset-lock.json",
    );
    await assertOutputReservationIdentity(reservation);
    await writeAtomicExclusive(rootAssetLockPath, rootAssetLockBytes);
    await assertOutputReservationIdentity(reservation);
    const rootAssetLockSha256 = sha256(rootAssetLockBytes);
    const persisted = await verifyC6PackageClosureMaterialization({
      expectedLinuxRebuildReceiptSha256:
        prepared.linuxRebuildReceiptSha256,
      expectedMaterializationManifestSha256:
        evidence.materializationManifestSha256,
      expectedRootAssetLockSha256: rootAssetLockSha256,
      expectedRootAssetRootSha256: rootAssetLock.assetRootSha256,
      outputRoot: reservation.outputRoot,
    });
    if (
      persisted.receiptValidation !==
        prepared.persistedReceiptValidation
    ) {
      throw new Error(
        "C6 materializer persisted receipt validation drifted",
      );
    }
    await assertOutputReservationIdentity(reservation);
    published = true;
    return {
      closureRoot: join(reservation.outputRoot, "closure"),
      expectedIdentitySha256: evidence.expectedIdentitySha256,
      expectedIdentityPath: join(
        reservation.outputRoot,
        "expected-identity.json",
      ),
      linuxRebuildReceiptSha256:
        prepared.linuxRebuildReceiptSha256,
      linuxRebuildReceiptPath: join(
        reservation.outputRoot,
        "linux-rebuild-receipt.json",
      ),
      liveLinuxRebuildProven: liveExecutor,
      materializationManifestPath: join(
        reservation.outputRoot,
        "materialization-manifest.json",
      ),
      materializationManifestSha256:
        evidence.materializationManifestSha256,
      outputRoot: reservation.outputRoot,
      package: {
        name: "goodmemory",
        sha256: packageInput.packageSha256,
        version: packageInput.packageVersion,
      },
      persistedReceiptLinuxRebuildProven: false,
      persistedReceiptValidation: persisted.receiptValidation,
      rootAssetLockPath,
      rootAssetLockSha256,
      rootAssetRootSha256: rootAssetLock.assetRootSha256,
    };
  } finally {
    try {
      if (workRoot !== undefined) {
        await rm(workRoot, { force: true, recursive: true });
      }
      if (!published) {
        await rm(reservation.outputRoot, {
          force: true,
          recursive: true,
        });
      }
    } finally {
      await releaseOutputReservation(reservation);
    }
  }
}

async function executeC6PackageClosureMaterialization(
  context: C6PackageClosureMaterializerExecutionContext,
): Promise<C6PackageClosurePreparedMaterialization> {
  const {
    input,
    packageInput,
    stagingRoot,
    workRoot,
  } = context;
  const workspace = await prepareMaterializerWorkspace({
    packageInput,
    workRoot,
  });
  await requireDockerServer();
  const image = await inspectDockerImage(
    input.imageReference,
    input.expectedImageSha256,
  );
  const containerUser =
    `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;
  await runC6PackageClosureMaterializerContainer({
    command: buildC6PackageClosureAcquisitionDockerCreateCommand({
      containerUser,
      expectedImageSha256: input.expectedImageSha256,
      imageReference: input.imageReference,
      workRoot,
    }),
    imageId: image.Id,
    label: "package acquisition",
    networkMode: "bridge",
    phase: "acquisition",
    timeoutMs: ACQUISITION_TIMEOUT_MS,
    workRoot,
  });

  const packageLockBytes = await readC6StableRegularFile(
    workspace.packageLockPath,
    "materialized consumer package-lock",
  );
  const tarballsBySha512Hex = await loadDownloadedTarballs(
    workspace.offlineTarballRoot,
  );
  const offlineIndex = buildC6PackageClosureOfflineIndex({
    packageLockBytes,
    tarballsBySha512Hex,
  });
  await writeFile(workspace.offlineIndexPath, offlineIndex.bytes, {
    flag: "wx",
  });
  await runC6PackageClosureMaterializerContainer({
    command: buildC6PackageClosureOfflineDockerCreateCommand({
      containerUser,
      expectedImageSha256: input.expectedImageSha256,
      imageReference: input.imageReference,
      workRoot,
    }),
    imageId: image.Id,
    label: "network-none offline build",
    networkMode: "none",
    phase: "offline",
    timeoutMs: OFFLINE_BUILD_TIMEOUT_MS,
    workRoot,
  });
  const observed = await readObservedExecution(workRoot);
  assertObservedExecution({
    expectedRuntime: input.runtime,
    offlineTarballCount: offlineIndex.index.entries.length,
    observed,
    packageLockSha256: sha256(packageLockBytes),
  });

  const installedTreeManifest =
    await buildC6InstalledTreeManifestFromDirectory(
      join(workRoot, "consumer/node_modules"),
    );
  await writeFile(
    workspace.installedTreeManifestPath,
    installedTreeManifest,
    { flag: "wx" },
  );
  const versionSmoke = await runMaterializerSmoke({
    argument: "--version",
    bunPath: observed.bunPath,
    containerUser,
    expectedImageSha256: input.expectedImageSha256,
    imageId: image.Id,
    imageReference: input.imageReference,
    workRoot,
  });
  const helpSmoke = await runMaterializerSmoke({
    argument: "--help",
    bunPath: observed.bunPath,
    containerUser,
    expectedImageSha256: input.expectedImageSha256,
    imageId: image.Id,
    imageReference: input.imageReference,
    workRoot,
  });
  if (
    versionSmoke.stdout.trimEnd() !==
      `goodmemory ${packageInput.packageVersion}` ||
    helpSmoke.stdout.length === 0
  ) {
    throw new Error("C6 materializer GoodMemory read-only smoke failed");
  }
  const manifestAfterSmoke =
    await buildC6InstalledTreeManifestFromDirectory(
      join(workRoot, "consumer/node_modules"),
    );
  if (manifestAfterSmoke !== installedTreeManifest) {
    throw new Error(
      "C6 materializer read-only smoke changed the installed tree",
    );
  }

  const profileBytes = serializeJson({
    architecture: "x64",
    bun: observed.runtime.bun,
    imageSha256: input.expectedImageSha256,
    install: {
      cacheStartedEmpty: true,
      command: [...OFFLINE_INSTALL_PROFILE_COMMAND],
      credentialsPresent: false,
      exitCode: 0,
      networkIsolation: "container-network-none",
      packageLockSha256After: observed.packageLockSha256After,
      packageLockSha256Before: observed.packageLockSha256Before,
      sourceCheckoutMounted: false,
    },
    installedTreeManifestSha256: sha256(installedTreeManifest),
    libc: observed.libc,
    node: observed.runtime.node,
    npm: observed.runtime.npm,
    operatingSystem: "linux",
    osReleaseSha256: observed.osReleaseSha256,
    schemaVersion: 1,
    smoke: {
      goodmemoryHostCommandExitCode: helpSmoke.exitCode,
      goodmemoryVersion: packageInput.packageVersion,
      goodmemoryVersionExitCode: versionSmoke.exitCode,
      sqliteVssLinuxX64Present: true,
    },
  });
  await writeFile(workspace.buildProfilePath, profileBytes, {
    flag: "wx",
  });
  const frozen = await freezeClosureBundle({
    offlineIndex,
    packageInput,
    packageLockBytes,
    profileBytes,
    stagingRoot,
    workspace,
  });
  const expected = buildExpectedIdentity({
    assetLockBytes: frozen.assetLockBytes,
    assetRootSha256: frozen.assetRootSha256,
    closureManifestBytes: frozen.closureManifestBytes,
    expectedImageSha256: input.expectedImageSha256,
    installedTreeManifest,
    packageInput,
    runtime: input.runtime,
  });
  await writeFile(
    join(stagingRoot, "expected-identity.json"),
    serializeJson(expected),
    { flag: "wx" },
  );
  const closureRoot = join(stagingRoot, "closure");
  await validateC6PackageClosure({ closureRoot, expected });
  const linuxRebuildReceiptPath = join(
    stagingRoot,
    "linux-rebuild-receipt.json",
  );
  const liveRun = await runC6LinuxPackageClosureRebuild({
    closureRoot,
    expected,
    imageReference: input.imageReference,
    receiptPath: linuxRebuildReceiptPath,
  });
  const persisted = await verifyC6LinuxPackageClosureReceipt({
    expected,
    expectedReceiptSha256: liveRun.receiptSha256,
    path: linuxRebuildReceiptPath,
  });
  if (
    !liveRun.linuxRebuildProven ||
    persisted.linuxRebuildProven ||
    persisted.recordedLinuxRebuildProven !== true
  ) {
    throw new Error(
      "C6 materializer Linux rebuild proof boundary is invalid",
    );
  }
  return {
    expected,
    linuxRebuildReceiptSha256: liveRun.receiptSha256,
    persistedReceiptValidation: persisted.receiptValidation,
  };
}

interface RootMaterializationEvidence {
  expectedIdentitySha256: string;
  materializationManifestSha256: string;
}

async function prepareRootMaterializationEvidence(input: {
  expected: C6PackageClosureExpectedIdentity;
  linuxRebuildReceiptSha256: string;
  runnerSources: z.infer<
    typeof materializationManifestSchema
  >["runnerSources"];
  stagingRoot: string;
}): Promise<RootMaterializationEvidence> {
  const expectedIdentityPath = join(
    input.stagingRoot,
    "expected-identity.json",
  );
  const linuxRebuildReceiptPath = join(
    input.stagingRoot,
    "linux-rebuild-receipt.json",
  );
  const closureRoot = join(input.stagingRoot, "closure");
  const [expectedIdentityBytes, linuxRebuildReceiptBytes] =
    await Promise.all([
      readC6StableRegularFile(
        expectedIdentityPath,
        "materialized expected identity",
      ),
      readC6StableRegularFile(
        linuxRebuildReceiptPath,
        "materialized Linux rebuild receipt",
      ),
    ]);
  const parsedExpected = parseJson(
    expectedIdentitySchema,
    expectedIdentityBytes,
    "materialized expected identity",
  );
  if (
    serializeJson(parsedExpected) !== expectedIdentityBytes.toString("utf8") ||
    JSON.stringify(parsedExpected) !== JSON.stringify(input.expected)
  ) {
    throw new Error("C6 materialized expected identity drifted");
  }
  if (
    sha256(linuxRebuildReceiptBytes) !==
      input.linuxRebuildReceiptSha256
  ) {
    throw new Error("C6 materialized Linux rebuild receipt drifted");
  }
  const closureAssetLock = await loadC6AssetLock(closureRoot);
  const closureManifestBytes = await readC6StableRegularFile(
    join(closureRoot, "closure.json"),
    "materialized closure manifest",
  );
  if (
    closureAssetLock.assetLockSha256 !==
      input.expected.package.dependencyClosure.assetLockSha256 ||
    closureAssetLock.assetLock.assetRootSha256 !==
      input.expected.package.dependencyClosure.assetRootSha256 ||
    sha256(closureManifestBytes) !==
      input.expected.package.dependencyClosure.manifestSha256
  ) {
    throw new Error("C6 materialized closure identity drifted");
  }

  for (const source of Object.values(input.runnerSources)) {
    const bytes = await readC6StableRegularFile(
      join(input.stagingRoot, source.path),
      "frozen materializer runner source",
    );
    if (sha256(bytes) !== source.sha256) {
      throw new Error("C6 frozen materializer runner source drifted");
    }
  }
  const manifest = materializationManifestSchema.parse({
    closure: {
      assetLock: {
        assetRootSha256:
          closureAssetLock.assetLock.assetRootSha256,
        path: "closure/asset-lock.json",
        sha256: closureAssetLock.assetLockSha256,
      },
      manifest: {
        path: "closure/closure.json",
        sha256: sha256(closureManifestBytes),
      },
    },
    expectedIdentity: {
      path: "expected-identity.json",
      sha256: sha256(expectedIdentityBytes),
    },
    kind: "c6-package-closure-materialization",
    linuxRebuildReceipt: {
      path: "linux-rebuild-receipt.json",
      sha256: input.linuxRebuildReceiptSha256,
    },
    package: {
      imageSha256: input.expected.image.sha256,
      packageSha256: input.expected.package.sha256,
      version: input.expected.package.version,
    },
    runnerSources: input.runnerSources,
    schemaVersion: 1,
  });
  const manifestBytes = serializeJson(manifest);
  await writeFile(
    join(input.stagingRoot, "materialization-manifest.json"),
    manifestBytes,
    { flag: "wx" },
  );
  return {
    expectedIdentitySha256: sha256(expectedIdentityBytes),
    materializationManifestSha256: sha256(manifestBytes),
  };
}

const RUNNER_SOURCE_PATHS = {
  assetLock: {
    frozenPath: "runner-sources/c6-asset-lock.ts",
    livePath: fileURLToPath(new URL("./c6-asset-lock.ts", import.meta.url)),
  },
  cli: {
    frozenPath:
      "runner-sources/materialize-codex-coding-effect-c6-package-closure.ts",
    livePath: fileURLToPath(new URL(
      "../materialize-codex-coding-effect-c6-package-closure.ts",
      import.meta.url,
    )),
  },
  closureValidator: {
    frozenPath: "runner-sources/c6-package-closure.ts",
    livePath: fileURLToPath(new URL(
      "./c6-package-closure.ts",
      import.meta.url,
    )),
  },
  linuxRebuild: {
    frozenPath: "runner-sources/c6-package-closure-linux.ts",
    livePath: fileURLToPath(new URL(
      "./c6-package-closure-linux.ts",
      import.meta.url,
    )),
  },
  materializer: {
    frozenPath: "runner-sources/c6-package-closure-materializer.ts",
    livePath: fileURLToPath(import.meta.url),
  },
  packageInspector: {
    frozenPath: "runner-sources/c6-package.ts",
    livePath: fileURLToPath(new URL("./c6-package.ts", import.meta.url)),
  },
} as const;

async function freezeMaterializerRunnerSources(
  stagingRoot: string,
): Promise<z.infer<typeof materializationManifestSchema>["runnerSources"]> {
  await mkdir(join(stagingRoot, "runner-sources"));
  const entries = await Promise.all(
    Object.entries(RUNNER_SOURCE_PATHS).map(
      async ([name, source]) => {
        const bytes = await readC6StableRegularFile(
          source.livePath,
          `materializer ${name} runner source`,
        );
        await writeFile(join(stagingRoot, source.frozenPath), bytes, {
          flag: "wx",
        });
        return [
          name,
          {
            path: source.frozenPath,
            sha256: sha256(bytes),
          },
        ] as const;
      },
    ),
  );
  return materializationManifestSchema.shape.runnerSources.parse(
    Object.fromEntries(entries),
  );
}

async function publishStagingRoot(
  stagingRoot: string,
  reservation: OutputReservation,
): Promise<void> {
  const expectedEntries = [
    "closure",
    "expected-identity.json",
    "linux-rebuild-receipt.json",
    "materialization-manifest.json",
    "runner-sources",
  ].sort(compareUtf8);
  const actualEntries = (await readdir(stagingRoot))
    .sort(compareUtf8);
  if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
    throw new Error(
      "C6 materializer staging root contains an unexpected artifact",
    );
  }
  for (const entry of expectedEntries) {
    await publishStagingEntryExclusive({
      destination: join(reservation.outputRoot, entry),
      reservation,
      source: join(stagingRoot, entry),
    });
  }
  await rmdir(stagingRoot);
}

async function publishStagingEntryExclusive(input: {
  destination: string;
  reservation: OutputReservation;
  source: string;
}): Promise<void> {
  await assertOutputReservationIdentity(input.reservation);
  const sourceStat = await lstat(input.source);
  if (sourceStat.isDirectory() && !sourceStat.isSymbolicLink()) {
    try {
      await mkdir(input.destination, {
        mode: sourceStat.mode & 0o777,
      });
    } catch (error) {
      throwOutputArtifactCollision(error);
    }
    for (
      const entry of (await readdir(input.source))
        .sort(compareUtf8)
    ) {
      await publishStagingEntryExclusive({
        destination: join(input.destination, entry),
        reservation: input.reservation,
        source: join(input.source, entry),
      });
    }
    await rmdir(input.source);
    await assertOutputReservationIdentity(input.reservation);
    return;
  }
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error(
      "C6 materializer staging root contains a non-regular artifact",
    );
  }
  try {
    await link(input.source, input.destination);
  } catch (error) {
    throwOutputArtifactCollision(error);
  }
  const publishedStat = await lstat(input.destination);
  if (
    !publishedStat.isFile() ||
    publishedStat.isSymbolicLink() ||
    publishedStat.dev !== sourceStat.dev ||
    publishedStat.ino !== sourceStat.ino
  ) {
    throw new Error("C6 materializer published artifact identity drifted");
  }
  await unlink(input.source);
  await assertOutputReservationIdentity(input.reservation);
}

function throwOutputArtifactCollision(error: unknown): never {
  if (
    error instanceof Error &&
    "code" in error &&
    error.code === "EEXIST"
  ) {
    throw new Error(
      "C6 materializer refuses to replace an output artifact",
    );
  }
  throw error;
}

export async function verifyC6PackageClosureMaterialization(input: {
  expectedLinuxRebuildReceiptSha256: string;
  expectedMaterializationManifestSha256: string;
  expectedRootAssetLockSha256: string;
  expectedRootAssetRootSha256: string;
  outputRoot: string;
}): Promise<C6PackageClosureMaterializationVerification> {
  const expectedHashes = z.object({
    expectedLinuxRebuildReceiptSha256: sha256Schema,
    expectedMaterializationManifestSha256: sha256Schema,
    expectedRootAssetLockSha256: sha256Schema,
    expectedRootAssetRootSha256: sha256Schema,
  }).strict().parse({
    expectedLinuxRebuildReceiptSha256:
      input.expectedLinuxRebuildReceiptSha256,
    expectedMaterializationManifestSha256:
      input.expectedMaterializationManifestSha256,
    expectedRootAssetLockSha256: input.expectedRootAssetLockSha256,
    expectedRootAssetRootSha256: input.expectedRootAssetRootSha256,
  });
  const outputRoot = await canonicalDirectory(
    input.outputRoot,
    "materialized package closure root",
  );
  const rootAssetLock = await loadC6AssetLock(outputRoot);
  if (
    rootAssetLock.assetLockSha256 !==
      expectedHashes.expectedRootAssetLockSha256 ||
    rootAssetLock.assetLock.assetRootSha256 !==
      expectedHashes.expectedRootAssetRootSha256
  ) {
    throw new Error("C6 materialization root asset lock does not match");
  }
  const manifestBytes = await readC6StableRegularFile(
    join(outputRoot, "materialization-manifest.json"),
    "package closure materialization manifest",
  );
  const materializationManifestSha256 = sha256(manifestBytes);
  if (
    materializationManifestSha256 !==
      expectedHashes.expectedMaterializationManifestSha256
  ) {
    throw new Error("C6 materialization manifest hash does not match");
  }
  const manifest = parseJson(
    materializationManifestSchema,
    manifestBytes,
    "package closure materialization manifest",
  );
  if (serializeJson(manifest) !== manifestBytes.toString("utf8")) {
    throw new Error("C6 materialization manifest is not canonical");
  }
  assertMaterializationManifestPaths(manifest);

  const expectedIdentityBytes = await readC6StableRegularFile(
    join(outputRoot, manifest.expectedIdentity.path),
    "root-bound expected identity",
  );
  const expected = parseJson(
    expectedIdentitySchema,
    expectedIdentityBytes,
    "root-bound expected identity",
  );
  const expectedIdentitySha256 = sha256(expectedIdentityBytes);
  const closureRoot = join(outputRoot, "closure");
  const closureAssetLock = await loadC6AssetLock(closureRoot);
  const closureManifestSha256 = sha256(await readC6StableRegularFile(
    join(outputRoot, manifest.closure.manifest.path),
    "root-bound closure manifest",
  ));
  if (
    expectedIdentitySha256 !== manifest.expectedIdentity.sha256 ||
    serializeJson(expected) !== expectedIdentityBytes.toString("utf8") ||
    closureAssetLock.assetLockSha256 !==
      manifest.closure.assetLock.sha256 ||
    closureAssetLock.assetLock.assetRootSha256 !==
      manifest.closure.assetLock.assetRootSha256 ||
    closureManifestSha256 !== manifest.closure.manifest.sha256 ||
    expected.package.dependencyClosure.assetLockSha256 !==
      closureAssetLock.assetLockSha256 ||
    expected.package.dependencyClosure.assetRootSha256 !==
      closureAssetLock.assetLock.assetRootSha256 ||
    expected.package.dependencyClosure.manifestSha256 !==
      closureManifestSha256 ||
    manifest.package.imageSha256 !== expected.image.sha256 ||
    manifest.package.packageSha256 !== expected.package.sha256 ||
    manifest.package.version !== expected.package.version
  ) {
    throw new Error("C6 root-bound materialization identity drifted");
  }
  for (
    const [name, source] of Object.entries(manifest.runnerSources)
  ) {
    const bytes = await readC6StableRegularFile(
      join(outputRoot, source.path),
      `root-bound ${name} runner source`,
    );
    if (sha256(bytes) !== source.sha256) {
      throw new Error("C6 root-bound runner source drifted");
    }
  }
  if (
    manifest.linuxRebuildReceipt.sha256 !==
      expectedHashes.expectedLinuxRebuildReceiptSha256
  ) {
    throw new Error("C6 root-bound Linux receipt hash does not match");
  }
  const linuxReceipt = await verifyC6LinuxPackageClosureReceipt({
    expected,
    expectedReceiptSha256:
      expectedHashes.expectedLinuxRebuildReceiptSha256,
    path: join(outputRoot, manifest.linuxRebuildReceipt.path),
  });
  await verifyC6AssetClosure(outputRoot, rootAssetLock);
  return {
    expectedIdentitySha256,
    linuxRebuildProven: false,
    linuxRebuildReceiptSha256: linuxReceipt.receiptSha256,
    materializationManifestSha256,
    receiptValidation: linuxReceipt.receiptValidation,
    rootAssetLockSha256: rootAssetLock.assetLockSha256,
    rootAssetRootSha256:
      rootAssetLock.assetLock.assetRootSha256,
  };
}

function assertMaterializationManifestPaths(
  manifest: z.infer<typeof materializationManifestSchema>,
): void {
  if (
    manifest.closure.assetLock.path !== "closure/asset-lock.json" ||
    manifest.closure.manifest.path !== "closure/closure.json" ||
    manifest.expectedIdentity.path !== "expected-identity.json" ||
    manifest.linuxRebuildReceipt.path !==
      "linux-rebuild-receipt.json"
  ) {
    throw new Error("C6 materialization manifest path drifted");
  }
  for (
    const [name, expected] of Object.entries(RUNNER_SOURCE_PATHS)
  ) {
    const source =
      manifest.runnerSources[
        name as keyof typeof manifest.runnerSources
      ];
    if (source.path !== expected.frozenPath) {
      throw new Error("C6 materialization runner source path drifted");
    }
  }
}

interface MaterializerWorkspace {
  buildProfilePath: string;
  consumerPackagePath: string;
  installedArchivePath: string;
  installedTreeManifestPath: string;
  offlineIndexPath: string;
  offlineTarballRoot: string;
  packageLockPath: string;
  packageTarballPath: string;
}

interface ObservedExecution {
  architecture: string;
  bunPath: string;
  libc: {
    family: string;
    version: string;
  };
  operatingSystem: string;
  osReleaseSha256: string;
  packageLockSha256After: string;
  packageLockSha256Before: string;
  runtime: C6PackageClosureRuntimeIdentity;
  seededOfflineTarballCount: number;
  sqliteVssLinuxX64Present: boolean;
}

interface OutputReservation {
  dev: number;
  handle: Awaited<ReturnType<typeof open>>;
  ino: number;
  lockPath: string;
  outputRoot: string;
  parent: string;
}

async function prepareMaterializerWorkspace(input: {
  packageInput: C6MaterializerPackageInput;
  workRoot: string;
}): Promise<MaterializerWorkspace> {
  const goodmemorySpecifier =
    `file:../package/goodmemory-${input.packageInput.packageVersion}.tgz`;
  const paths = {
    buildProfilePath: join(
      input.workRoot,
      "profiles/linux-x64-build.json",
    ),
    consumerPackagePath: join(input.workRoot, "consumer/package.json"),
    installedArchivePath: join(
      input.workRoot,
      "installed/node_modules.tar",
    ),
    installedTreeManifestPath: join(
      input.workRoot,
      "installed/tree.jsonl",
    ),
    offlineIndexPath: join(input.workRoot, "offline/index.json"),
    offlineTarballRoot: join(input.workRoot, "offline/tarballs"),
    packageLockPath: join(input.workRoot, "consumer/package-lock.json"),
    packageTarballPath: join(
      input.workRoot,
      `package/goodmemory-${input.packageInput.packageVersion}.tgz`,
    ),
  } satisfies MaterializerWorkspace;
  await Promise.all([
    mkdir(join(input.workRoot, "acquisition"), { recursive: true }),
    mkdir(join(input.workRoot, "consumer"), { recursive: true }),
    mkdir(join(input.workRoot, "installed"), { recursive: true }),
    mkdir(join(input.workRoot, "offline/tarballs"), { recursive: true }),
    mkdir(join(input.workRoot, "package"), { recursive: true }),
    mkdir(join(input.workRoot, "profiles"), { recursive: true }),
  ]);
  const consumerPackageBytes = serializeJson({
    dependencies: {
      goodmemory: goodmemorySpecifier,
    },
    name: "goodmemory-c6-runtime",
    private: true,
    version: "0.0.0",
  });
  await Promise.all([
    writeFile(paths.consumerPackagePath, consumerPackageBytes, {
      flag: "wx",
    }),
    writeFile(
      paths.packageTarballPath,
      input.packageInput.packageBytes,
      { flag: "wx" },
    ),
    writeFile(
      join(input.workRoot, "materializer-input.json"),
      serializeJson({
        goodmemorySpecifier,
        packageIntegrity: input.packageInput.packageIntegrity,
        packageVersion: input.packageInput.packageVersion,
      }),
      { flag: "wx" },
    ),
    writeFile(
      join(input.workRoot, "acquisition.sh"),
      ACQUISITION_SCRIPT,
      { flag: "wx" },
    ),
    writeFile(
      join(input.workRoot, "acquisition.mjs"),
      ACQUISITION_MODULE,
      { flag: "wx" },
    ),
    writeFile(
      join(input.workRoot, "offline-build.sh"),
      OFFLINE_BUILD_SCRIPT,
      { flag: "wx" },
    ),
  ]);
  await Promise.all([
    chmod(join(input.workRoot, "acquisition.sh"), 0o755),
    chmod(join(input.workRoot, "offline-build.sh"), 0o755),
  ]);
  return paths;
}

async function freezeClosureBundle(input: {
  offlineIndex: C6OfflineIndexMaterialization;
  packageInput: C6MaterializerPackageInput;
  packageLockBytes: Buffer;
  profileBytes: string;
  stagingRoot: string;
  workspace: MaterializerWorkspace;
}): Promise<{
  assetLockBytes: string;
  assetRootSha256: string;
  closureManifestBytes: string;
}> {
  const closureRoot = join(input.stagingRoot, "closure");
  await Promise.all([
    mkdir(join(closureRoot, "consumer"), { recursive: true }),
    mkdir(join(closureRoot, "installed"), { recursive: true }),
    mkdir(join(closureRoot, "offline/tarballs"), { recursive: true }),
    mkdir(join(closureRoot, "package"), { recursive: true }),
    mkdir(join(closureRoot, "profiles"), { recursive: true }),
  ]);
  await Promise.all([
    copyFile(
      input.workspace.consumerPackagePath,
      join(closureRoot, "consumer/package.json"),
    ),
    copyFile(
      input.workspace.packageLockPath,
      join(closureRoot, "consumer/package-lock.json"),
    ),
    copyFile(
      input.workspace.installedArchivePath,
      join(closureRoot, "installed/node_modules.tar"),
    ),
    copyFile(
      input.workspace.installedTreeManifestPath,
      join(closureRoot, "installed/tree.jsonl"),
    ),
    copyFile(
      input.workspace.offlineIndexPath,
      join(closureRoot, "offline/index.json"),
    ),
    copyFile(
      input.workspace.packageTarballPath,
      join(
        closureRoot,
        `package/goodmemory-${input.packageInput.packageVersion}.tgz`,
      ),
    ),
    copyFile(
      input.workspace.buildProfilePath,
      join(closureRoot, "profiles/linux-x64-build.json"),
    ),
  ]);
  for (const entry of await readdir(input.workspace.offlineTarballRoot)) {
    await copyFile(
      join(input.workspace.offlineTarballRoot, entry),
      join(closureRoot, "offline/tarballs", entry),
    );
  }

  const [
    consumerPackageBytes,
    installedArchiveBytes,
    installedTreeManifestBytes,
  ] = await Promise.all([
    readC6StableRegularFile(
      input.workspace.consumerPackagePath,
      "materialized consumer package.json",
    ),
    readC6StableRegularFile(
      input.workspace.installedArchivePath,
      "materialized installed tree archive",
    ),
    readC6StableRegularFile(
      input.workspace.installedTreeManifestPath,
      "materialized installed tree manifest",
    ),
  ]);
  const installedTreeManifest = installedTreeManifestBytes.toString("utf8");
  const installedEntryCount = installedTreeManifest.length === 0
    ? 0
    : installedTreeManifest.trimEnd().split("\n").length;
  const closureManifestBytes = serializeJson({
    buildProfile: {
      path: "profiles/linux-x64-build.json",
      sha256: sha256(input.profileBytes),
    },
    consumer: {
      goodmemorySpecifier:
        `file:../package/goodmemory-${input.packageInput.packageVersion}.tgz`,
      packageJson: {
        path: "consumer/package.json",
        sha256: sha256(consumerPackageBytes),
      },
      packageLock: {
        lockfileVersion: 3,
        path: "consumer/package-lock.json",
        sha256: sha256(input.packageLockBytes),
      },
      productionOnly: true,
    },
    installedTree: {
      archive: {
        bytes: installedArchiveBytes.byteLength,
        path: "installed/node_modules.tar",
        sha256: sha256(installedArchiveBytes),
      },
      manifest: {
        entryCount: installedEntryCount,
        path: "installed/tree.jsonl",
        sha256: sha256(installedTreeManifestBytes),
      },
    },
    kind: "c6-goodmemory-package-closure",
    offline: {
      index: {
        path: "offline/index.json",
        sha256: sha256(input.offlineIndex.bytes),
      },
      tarballCount: input.offlineIndex.index.entries.length,
      tarballSetSha256: input.offlineIndex.tarballSetSha256,
    },
    package: {
      packageJson: {
        bundledDependencyCount: 0,
        dependencySpecSha256: input.packageInput.dependencySpecSha256,
        name: "goodmemory",
        sha256: input.packageInput.packageJsonSha256,
        version: input.packageInput.packageVersion,
      },
      tarball: {
        bytes: input.packageInput.packageBytes.byteLength,
        integrity: input.packageInput.packageIntegrity,
        path:
          `package/goodmemory-${input.packageInput.packageVersion}.tgz`,
        sha256: input.packageInput.packageSha256,
      },
    },
    schemaVersion: 1,
    target: {
      architecture: "x64",
      operatingSystem: "linux",
    },
  });
  await writeFile(
    join(closureRoot, "closure.json"),
    closureManifestBytes,
    { flag: "wx" },
  );
  const assetLock = await buildC6AssetLock(closureRoot);
  const assetLockBytes = serializeC6AssetLock(assetLock);
  await writeFile(
    join(closureRoot, "asset-lock.json"),
    assetLockBytes,
    { flag: "wx" },
  );
  return {
    assetLockBytes,
    assetRootSha256: assetLock.assetRootSha256,
    closureManifestBytes,
  };
}

function buildExpectedIdentity(input: {
  assetLockBytes: string;
  assetRootSha256: string;
  closureManifestBytes: string;
  expectedImageSha256: string;
  installedTreeManifest: string;
  packageInput: C6MaterializerPackageInput;
  runtime: C6PackageClosureRuntimeIdentity;
}): C6PackageClosureExpectedIdentity {
  return {
    image: {
      architecture: "x64",
      operatingSystem: "linux",
      runtime: input.runtime,
      sha256: input.expectedImageSha256,
    },
    package: {
      dependencyClosure: {
        assetLockSha256: sha256(input.assetLockBytes),
        assetRootSha256: input.assetRootSha256,
        installedTreeManifestSha256:
          sha256(input.installedTreeManifest),
        manifestSha256: sha256(input.closureManifestBytes),
      },
      name: "goodmemory",
      sha256: input.packageInput.packageSha256,
      version: input.packageInput.packageVersion,
    },
  };
}

function buildMaterializerDockerCreateCommand(input: {
  containerUser: string;
  environmentRoot: "/work/acquisition" | "/work/offline-build";
  expectedImageSha256: string;
  imageReference: string;
  networkMode: "bridge" | "none";
  phase: "acquisition" | "offline";
  scriptPath: string;
  workRoot: string;
}): string[] {
  assertPinnedImageReference(
    input.imageReference,
    input.expectedImageSha256,
  );
  assertDockerMountPath(input.workRoot, "materializer work root");
  if (!/^\d+:\d+$/u.test(input.containerUser)) {
    throw new Error("C6 materializer container user must be numeric uid:gid");
  }
  return [
    "docker",
    "create",
    "--pull=never",
    `--name=${materializerContainerName(input.workRoot, input.phase)}`,
    `--label=org.goodmemory.c6.owner=${
      materializerContainerOwner(input.workRoot)
    }`,
    `--label=org.goodmemory.c6.phase=${input.phase}`,
    "--platform=linux/amd64",
    `--network=${input.networkMode}`,
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--tmpfs=/tmp:rw,nosuid,nodev,size=512m",
    `--user=${input.containerUser}`,
    `--env=HOME=${input.environmentRoot}/home`,
    `--env=NPM_CONFIG_GLOBALCONFIG=${input.environmentRoot}/empty-global-npmrc`,
    `--env=NPM_CONFIG_USERCONFIG=${input.environmentRoot}/empty-user-npmrc`,
    "--env=npm_config_update_notifier=false",
    `--mount=type=bind,src=${input.workRoot},dst=/work`,
    "--workdir=/work",
    "--entrypoint=/bin/sh",
    input.imageReference,
    input.scriptPath,
  ];
}

export async function runC6PackageClosureMaterializerContainer(input: {
  command: string[];
  imageId: string;
  label: string;
  networkMode: "bridge" | "none";
  phase: "acquisition" | "offline";
  timeoutMs: number;
  workRoot: string;
}): Promise<void> {
  let cleanupTarget: string | undefined;
  try {
    const created = await runCommand(
      input.command,
      `Docker ${input.label} create`,
    );
    const containerId = parseC6DockerCreatedContainerId(
      created.stdout,
      `materializer ${input.label} create`,
    );
    assertMaterializerContainerIsolation({
      container: await inspectDockerContainer(containerId),
      imageId: input.imageId,
      networkMode: input.networkMode,
      phase: input.phase,
      workRoot: input.workRoot,
    });
    cleanupTarget = containerId;
    const execution = await runCommand(
      ["docker", "start", "--attach", containerId],
      `Docker ${input.label}`,
      true,
      input.timeoutMs,
    );
    const after = await inspectDockerContainer(containerId);
    if (
      execution.exitCode !== 0 ||
      after.State?.ExitCode !== 0
    ) {
      throw new Error([
        `C6 materializer Docker ${input.label} failed`,
        outputTail(execution.stdout),
        outputTail(execution.stderr),
      ].filter((value) => value.length > 0).join("\n"));
    }
  } finally {
    if (cleanupTarget !== undefined) {
      await removeDockerContainer(cleanupTarget);
    }
  }
}

async function runMaterializerSmoke(input: {
  argument: "--help" | "--version";
  bunPath: string;
  containerUser: string;
  expectedImageSha256: string;
  imageId: string;
  imageReference: string;
  workRoot: string;
}): Promise<CommandResult> {
  const command = buildC6LinuxGoodMemorySmokeDockerCreateCommand({
    argument: input.argument,
    bunPath: input.bunPath,
    containerUser: input.containerUser,
    expectedImageSha256: input.expectedImageSha256,
    imageReference: input.imageReference,
    workRoot: input.workRoot,
  });
  let cleanupTarget: string | undefined;
  try {
    const created = await runCommand(
      command,
      `Docker materializer GoodMemory ${input.argument} create`,
    );
    const containerId = parseC6DockerCreatedContainerId(
      created.stdout,
      `materializer GoodMemory ${input.argument} smoke create`,
    );
    assertSmokeContainerIsolation({
      argument: input.argument,
      bunPath: input.bunPath,
      container: await inspectDockerContainer(containerId),
      imageId: input.imageId,
      workRoot: input.workRoot,
    });
    cleanupTarget = containerId;
    const execution = await runCommand(
      ["docker", "start", "--attach", containerId],
      `Docker materializer GoodMemory ${input.argument}`,
      true,
      SMOKE_TIMEOUT_MS,
    );
    const after = await inspectDockerContainer(containerId);
    if (
      execution.exitCode !== 0 ||
      after.State?.ExitCode !== 0
    ) {
      throw new Error([
        `C6 materializer GoodMemory ${input.argument} failed`,
        outputTail(execution.stdout),
        outputTail(execution.stderr),
      ].filter((value) => value.length > 0).join("\n"));
    }
    return execution;
  } finally {
    if (cleanupTarget !== undefined) {
      await removeDockerContainer(cleanupTarget);
    }
  }
}

function assertMaterializerContainerIsolation(input: {
  container: z.infer<typeof containerInspectSchema>;
  imageId: string;
  networkMode: "bridge" | "none";
  phase: "acquisition" | "offline";
  workRoot: string;
}): void {
  const workMount = input.container.Mounts.find((mount) =>
    mount.Destination === "/work"
  );
  const securityOptions = input.container.HostConfig.SecurityOpt ?? [];
  const labels = input.container.Config.Labels ?? {};
  if (
    input.container.Image !== input.imageId ||
    input.container.HostConfig.NetworkMode !== input.networkMode ||
    !input.container.HostConfig.ReadonlyRootfs ||
    !input.container.HostConfig.CapDrop?.includes("ALL") ||
    !securityOptions.some((value) =>
      value === "no-new-privileges" ||
      value === "no-new-privileges:true"
    ) ||
    workMount?.Type !== "bind" ||
    workMount.Source !== input.workRoot ||
    !workMount.RW ||
    input.container.Mounts.length !== 1 ||
    labels["org.goodmemory.c6.owner"] !==
      materializerContainerOwner(input.workRoot) ||
    labels["org.goodmemory.c6.phase"] !== input.phase
  ) {
    throw new Error("C6 materializer Docker isolation inspect failed");
  }
  const environment = containerEnvironment(input.container);
  const environmentRoot = input.networkMode === "bridge"
    ? "/work/acquisition"
    : "/work/offline-build";
  if (
    hasUnexpectedEnvironment(environment) ||
    environment.get("HOME") !== `${environmentRoot}/home` ||
    environment.get("NPM_CONFIG_GLOBALCONFIG") !==
      `${environmentRoot}/empty-global-npmrc` ||
    environment.get("NPM_CONFIG_USERCONFIG") !==
      `${environmentRoot}/empty-user-npmrc` ||
    environment.get("npm_config_update_notifier") !== "false"
  ) {
    throw new Error(
      "C6 materializer Docker environment is not credential-free",
    );
  }
}

function assertSmokeContainerIsolation(input: {
  argument: "--help" | "--version";
  bunPath: string;
  container: z.infer<typeof containerInspectSchema>;
  imageId: string;
  workRoot: string;
}): void {
  const runtimeMount = input.container.Mounts.find((mount) =>
    mount.Destination === "/runtime"
  );
  const securityOptions = input.container.HostConfig.SecurityOpt ?? [];
  const labels = input.container.Config.Labels ?? {};
  if (
    input.container.Image !== input.imageId ||
    input.container.HostConfig.NetworkMode !== "none" ||
    !input.container.HostConfig.ReadonlyRootfs ||
    !input.container.HostConfig.CapDrop?.includes("ALL") ||
    !securityOptions.some((value) =>
      value === "no-new-privileges" ||
      value === "no-new-privileges:true"
    ) ||
    runtimeMount?.Type !== "bind" ||
    runtimeMount.Source !== input.workRoot ||
    runtimeMount.RW ||
    input.container.Mounts.length !== 1 ||
    labels["org.goodmemory.c6.owner"] !==
      materializerContainerOwner(input.workRoot) ||
    labels["org.goodmemory.c6.phase"] !==
      `linux-smoke-${input.argument.slice(2)}`
  ) {
    throw new Error("C6 materializer smoke isolation inspect failed");
  }
  const environment = containerEnvironment(input.container);
  if (
    hasUnexpectedEnvironment(environment) ||
    environment.get("HOME") !== "/tmp/home" ||
    environment.get("GOODMEMORY_BUN_BINARY") !== input.bunPath
  ) {
    throw new Error(
      "C6 materializer smoke environment is not allowlisted",
    );
  }
}

function containerEnvironment(
  container: z.infer<typeof containerInspectSchema>,
): Map<string, string> {
  return new Map(
    (container.Config.Env ?? []).map((entry) => {
      const separator = entry.indexOf("=");
      return [
        separator < 0 ? entry : entry.slice(0, separator),
        separator < 0 ? "" : entry.slice(separator + 1),
      ];
    }),
  );
}

function hasUnexpectedEnvironment(
  environment: ReadonlyMap<string, string>,
): boolean {
  return [...environment.keys()].some((key) =>
    !ALLOWED_CONTAINER_ENVIRONMENT_KEYS.has(key)
  );
}

async function requireDockerServer(): Promise<string> {
  const result = await runCommand(
    ["docker", "version", "--format", "{{.Server.Version}}"],
    "Docker daemon probe",
    true,
  );
  const version = result.stdout.trim();
  if (result.exitCode !== 0 || version.length === 0) {
    throw new Error([
      "C6 materializer executor unavailable: Docker daemon is not reachable",
      outputTail(result.stderr),
    ].filter((value) => value.length > 0).join("\n"));
  }
  return version;
}

async function inspectDockerImage(
  imageReference: string,
  expectedImageSha256: string,
): Promise<z.infer<typeof imageInspectSchema>> {
  const result = await runCommand(
    ["docker", "image", "inspect", imageReference],
    "Docker materializer image inspect",
    true,
  );
  if (result.exitCode !== 0) {
    throw new Error([
      "C6 materializer pinned Linux x64 image is unavailable",
      outputTail(result.stderr),
    ].filter((value) => value.length > 0).join("\n"));
  }
  const inspected = parseJsonValue(
    z.array(imageInspectSchema).length(1),
    result.stdout,
    "materializer Docker image inspect",
  )[0];
  const digestBound =
    imageReference === `sha256:${expectedImageSha256}`
      ? inspected.Id === imageReference
      : inspected.RepoDigests?.includes(imageReference) === true;
  if (
    inspected.Os !== "linux" ||
    inspected.Architecture !== "amd64" ||
    !digestBound
  ) {
    throw new Error(
      "C6 materializer image does not match pinned Linux amd64 identity",
    );
  }
  return inspected;
}

async function inspectDockerContainer(
  target: string,
): Promise<z.infer<typeof containerInspectSchema>> {
  const result = await runCommand(
    ["docker", "inspect", target],
    "Docker materializer container inspect",
  );
  return parseJsonValue(
    z.array(containerInspectSchema).length(1),
    result.stdout,
    "materializer Docker container inspect",
  )[0];
}

async function removeDockerContainer(target: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/u.test(target)) {
    throw new Error(
      "C6 materializer cleanup requires a created container id",
    );
  }
  const before = await runCommand(
    ["docker", "inspect", target],
    "Docker materializer cleanup inspect",
    true,
  );
  if (before.exitCode !== 0) {
    if (/No such (?:object|container)/iu.test(before.stderr)) {
      return;
    }
    throw new Error([
      "C6 materializer cleanup could not inspect container",
      outputTail(before.stderr),
    ].filter((value) => value.length > 0).join("\n"));
  }
  const removed = await runCommand(
    ["docker", "rm", "--force", target],
    "Docker materializer cleanup",
    true,
  );
  if (removed.exitCode !== 0) {
    throw new Error([
      "C6 materializer cleanup failed",
      outputTail(removed.stderr),
    ].filter((value) => value.length > 0).join("\n"));
  }
  const after = await runCommand(
    ["docker", "inspect", target],
    "Docker materializer cleanup verification",
    true,
  );
  if (
    after.exitCode === 0 ||
    !/No such (?:object|container)/iu.test(after.stderr)
  ) {
    throw new Error("C6 materializer could not verify container removal");
  }
}

async function readObservedExecution(
  workRoot: string,
): Promise<ObservedExecution> {
  const observedRoot = join(workRoot, "observed");
  const [
    architecture,
    bunPath,
    bunSha256,
    bunVersion,
    nodeSha256,
    nodeVersion,
    npmCliSha256,
    npmLauncherSha256,
    npmVersion,
    operatingSystem,
    osReleaseSha256,
    packageLockAfter,
    packageLockBefore,
    seededCount,
    sqlitePresent,
  ] = await Promise.all([
    readObserved(observedRoot, "architecture"),
    readObserved(observedRoot, "bun-path"),
    readObserved(observedRoot, "bun-sha256"),
    readObserved(observedRoot, "bun-version"),
    readObserved(observedRoot, "node-sha256"),
    readObserved(observedRoot, "node-version"),
    readObserved(observedRoot, "npm-cli-sha256"),
    readObserved(observedRoot, "npm-launcher-sha256"),
    readObserved(observedRoot, "npm-version"),
    readObserved(observedRoot, "operating-system"),
    readObserved(observedRoot, "os-release-sha256"),
    readObserved(observedRoot, "package-lock-after"),
    readObserved(observedRoot, "package-lock-before"),
    readObserved(observedRoot, "seeded-tarball-count"),
    readObserved(observedRoot, "sqlite-vss-linux-x64-present"),
  ]);
  const libcParts = (
    await readObserved(observedRoot, "libc")
  ).split(/\s+/u);
  const seededOfflineTarballCount = Number(seededCount);
  if (
    libcParts.length !== 2 ||
    !Number.isInteger(seededOfflineTarballCount)
  ) {
    throw new Error("C6 materializer observed Linux identity is invalid");
  }
  return {
    architecture,
    bunPath,
    libc: {
      family: libcParts[0],
      version: libcParts[1],
    },
    operatingSystem,
    osReleaseSha256,
    packageLockSha256After: packageLockAfter,
    packageLockSha256Before: packageLockBefore,
    runtime: runtimeIdentitySchema.parse({
      bun: {
        executableSha256: bunSha256,
        version: bunVersion,
      },
      node: {
        executableSha256: nodeSha256,
        version: nodeVersion,
      },
      npm: {
        cliSha256: npmCliSha256,
        launcherSha256: npmLauncherSha256,
        version: npmVersion,
      },
    }),
    seededOfflineTarballCount,
    sqliteVssLinuxX64Present: sqlitePresent === "true",
  };
}

function assertObservedExecution(input: {
  expectedRuntime: C6PackageClosureRuntimeIdentity;
  observed: ObservedExecution;
  offlineTarballCount: number;
  packageLockSha256: string;
}): void {
  if (
    input.observed.operatingSystem !== "Linux" ||
    input.observed.architecture !== "x86_64" ||
    JSON.stringify(input.observed.runtime) !==
      JSON.stringify(runtimeIdentitySchema.parse(input.expectedRuntime)) ||
    input.observed.packageLockSha256Before !==
      input.packageLockSha256 ||
    input.observed.packageLockSha256After !==
      input.packageLockSha256 ||
    input.observed.seededOfflineTarballCount !==
      input.offlineTarballCount ||
    !input.observed.sqliteVssLinuxX64Present
  ) {
    throw new Error(
      "C6 materializer observed network-none build identity drifted",
    );
  }
}

async function loadDownloadedTarballs(
  root: string,
): Promise<Map<string, Buffer>> {
  const entries = await readdir(root, { withFileTypes: true });
  const tarballs = new Map<string, Buffer>();
  for (const entry of entries) {
    const match = /^([a-f0-9]{128})\.tgz$/u.exec(entry.name);
    if (!entry.isFile() || match === null) {
      throw new Error(
        "C6 materializer acquisition produced an unexpected artifact",
      );
    }
    tarballs.set(
      match[1],
      await readC6StableRegularFile(
        join(root, entry.name),
        "materializer downloaded registry tarball",
      ),
    );
  }
  if (tarballs.size === 0) {
    throw new Error("C6 materializer acquired no registry tarballs");
  }
  return tarballs;
}

async function readObserved(root: string, name: string): Promise<string> {
  return (
    await readC6StableRegularFile(
      join(root, name),
      `materializer observed ${name}`,
    )
  ).toString("utf8").trimEnd();
}

async function reserveOutputRoot(path: string): Promise<OutputReservation> {
  const outputRoot = resolve(path);
  const parent = await realpath(dirname(outputRoot));
  if (
    parent !== dirname(outputRoot) ||
    basename(outputRoot).length === 0 ||
    /[,\r\n]/u.test(outputRoot)
  ) {
    throw new Error(
      "C6 materializer output root must have a canonical existing parent",
    );
  }
  const lockPath = `${outputRoot}.materialize.lock`;
  const handle = await open(lockPath, "wx", 0o600);
  let outputCreated = false;
  try {
    await mkdir(outputRoot, { mode: 0o700 });
    outputCreated = true;
    const stat = await lstat(outputRoot);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      await realpath(outputRoot) !== outputRoot
    ) {
      throw new Error("C6 materializer output root is not canonical");
    }
    return {
      dev: stat.dev,
      handle,
      ino: stat.ino,
      lockPath,
      outputRoot,
      parent,
    };
  } catch (error) {
    await handle.close();
    await rm(lockPath, { force: true });
    if (outputCreated) {
      await rm(outputRoot, { force: true, recursive: true });
    } else if (await pathExists(outputRoot)) {
      throw new Error("C6 materializer output root already exists");
    }
    throw error;
  }
}

async function assertOutputReservationIdentity(
  reservation: OutputReservation,
): Promise<void> {
  const stat = await lstat(reservation.outputRoot);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.dev !== reservation.dev ||
    stat.ino !== reservation.ino ||
    await realpath(reservation.outputRoot) !== reservation.outputRoot
  ) {
    throw new Error("C6 materializer output reservation was replaced");
  }
}

async function releaseOutputReservation(
  reservation: OutputReservation,
): Promise<void> {
  await reservation.handle.close();
  await unlink(reservation.lockPath);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

async function canonicalFile(path: string, label: string): Promise<string> {
  const absolute = resolve(path);
  const canonical = await realpath(absolute);
  if (canonical !== absolute || !(await lstat(canonical)).isFile()) {
    throw new Error(
      `C6 materializer ${label} must not contain symlink components`,
    );
  }
  return canonical;
}

async function canonicalDirectory(
  path: string,
  label: string,
): Promise<string> {
  const absolute = resolve(path);
  const canonical = await realpath(absolute);
  if (
    canonical !== absolute ||
    !(await lstat(canonical)).isDirectory()
  ) {
    throw new Error(
      `C6 materializer ${label} must not contain symlink components`,
    );
  }
  return canonical;
}

async function writeAtomicExclusive(
  path: string,
  bytes: string | Uint8Array,
): Promise<void> {
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  let temporaryCreated = false;
  let linked = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    temporaryCreated = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporaryPath, path);
    linked = true;
  } finally {
    if (temporaryCreated) {
      try {
        await unlink(temporaryPath);
      } catch (error) {
        if (!linked) {
          throw error;
        }
      }
    }
  }
}

async function runTarExtractPackageJson(path: string): Promise<string> {
  const result = await runCommand(
    ["tar", "-xOzf", path, "package/package.json"],
    "materializer package.json extraction",
  );
  if (result.stdout.length === 0) {
    throw new Error("C6 materializer package.json is empty");
  }
  return result.stdout;
}

function materializerContainerName(
  workRoot: string,
  phase: string,
): string {
  return `goodmemory-c6-materializer-${phase}-${
    sha256(workRoot).slice(0, 16)
  }`;
}

function materializerContainerOwner(workRoot: string): string {
  return sha256(workRoot);
}

function assertPinnedImageReference(
  imageReference: string,
  expectedImageSha256: string,
): void {
  if (!sha256Schema.safeParse(expectedImageSha256).success) {
    throw new Error("C6 materializer expected image digest is invalid");
  }
  const imageId = /^sha256:([a-f0-9]{64})$/u.exec(imageReference);
  const repositoryDigest =
    /^[a-z0-9][a-z0-9._:/-]*@sha256:([a-f0-9]{64})$/u.exec(
      imageReference,
    );
  const digest = imageId?.[1] ?? repositoryDigest?.[1];
  if (digest === undefined) {
    throw new Error("C6 materializer image reference must be digest-pinned");
  }
  if (digest !== expectedImageSha256) {
    throw new Error(
      "C6 materializer image digest does not match expected identity",
    );
  }
}

function assertDockerMountPath(path: string, label: string): void {
  if (
    !path.startsWith("/") ||
    resolve(path) !== path ||
    /[,\r\n]/u.test(path)
  ) {
    throw new Error(`C6 Docker ${label} is not a safe absolute path`);
  }
}

function canonicalSha512Sri(value: string): string {
  const parsed = sha512SriSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("C6 materializer registry tarball SRI is invalid");
  }
  const encoded = value.slice("sha512-".length);
  const digest = Buffer.from(encoded, "base64");
  if (
    digest.byteLength !== 64 ||
    digest.toString("base64") !== encoded
  ) {
    throw new Error("C6 materializer registry tarball SRI is not canonical");
  }
  return value;
}

function sriHex(integrity: string): string {
  return Buffer.from(
    canonicalSha512Sri(integrity).slice("sha512-".length),
    "base64",
  ).toString("hex");
}

function assertCredentialFreeHttps(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("C6 materializer registry URL must be HTTPS");
  }
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error(
      "C6 materializer rejects credential-bearing registry URL",
    );
  }
}

function packageNameFromLockLocation(location: string): string {
  if (
    !location.startsWith("node_modules/") ||
    location.includes("\\") ||
    location.split("/").includes("..")
  ) {
    throw new Error(`C6 materializer invalid lock location ${location}`);
  }
  const remainder = location.slice(
    location.lastIndexOf("node_modules/") + "node_modules/".length,
  );
  const parts = remainder.split("/");
  if (parts[0]?.startsWith("@")) {
    if (parts.length !== 2) {
      throw new Error(`C6 materializer invalid scoped location ${location}`);
    }
    return `${parts[0]}/${parts[1]}`;
  }
  if (parts.length !== 1 || parts[0].length === 0) {
    throw new Error(`C6 materializer invalid lock location ${location}`);
  }
  return parts[0];
}

function compareOfflineGroups(
  left: {
    integrity: string;
    name: string;
    resolved: string;
    version: string;
  },
  right: {
    integrity: string;
    name: string;
    resolved: string;
    version: string;
  },
): number {
  return compareUtf8(
    [left.name, left.version, left.resolved, left.integrity].join("\0"),
    [right.name, right.version, right.resolved, right.integrity].join("\0"),
  );
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

interface CommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

async function runCommand(
  command: string[],
  label: string,
  allowFailure = false,
  timeoutMs = DOCKER_COMMAND_TIMEOUT_MS,
): Promise<CommandResult> {
  const child = Bun.spawn({
    cmd: command,
    stderr: "pipe",
    stdout: "pipe",
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGKILL");
    } catch (error) {
      console.error(
        `C6 ${label} timeout kill failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
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
  if (!allowFailure && exitCode !== 0) {
    throw new Error([
      `C6 ${label} failed with exit code ${exitCode}`,
      outputTail(stdout),
      outputTail(stderr),
    ].filter((value) => value.length > 0).join("\n"));
  }
  return { exitCode, stderr, stdout };
}

function parseJson<T>(
  schema: z.ZodType<T>,
  bytes: Buffer,
  label: string,
): T {
  return parseJsonValue(schema, bytes.toString("utf8"), label);
}

function parseJsonValue<T>(
  schema: z.ZodType<T>,
  value: string,
  label: string,
): T {
  let json: unknown;
  try {
    json = JSON.parse(value) as unknown;
  } catch {
    throw new Error(`C6 ${label} contains invalid JSON`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`invalid C6 ${label}`);
  }
  return parsed.data;
}

function outputTail(value: string): string {
  return value.trim().slice(-4_000);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
