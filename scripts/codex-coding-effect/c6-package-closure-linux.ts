import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readlink,
  realpath,
  rm,
  unlink,
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

import { z } from "zod";

import { readC6StableRegularFile } from "./c6-asset-lock";
import {
  serializeC6InstalledTreeManifest,
  validateC6PackageClosure,
} from "./c6-package-closure";
import type {
  C6InstalledTreeEntry,
  C6PackageClosureExpectedIdentity,
} from "./c6-package-closure";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const runtimeSchema = z.object({
  bun: z.object({
    executableSha256: sha256Schema,
    version: z.string().min(1),
  }).strict(),
  node: z.object({
    executableSha256: sha256Schema,
    version: z.string().min(1),
  }).strict(),
  npm: z.object({
    cliSha256: sha256Schema,
    launcherSha256: sha256Schema,
    version: z.string().min(1),
  }).strict(),
}).strict();
const receiptSchema = z.object({
  executor: z.object({
    allCapabilitiesDropped: z.boolean(),
    cacheStartedEmpty: z.boolean(),
    closureMountedReadOnly: z.boolean(),
    containerArchitecture: z.string(),
    containerOperatingSystem: z.string(),
    dockerServerVersion: z.string().min(1),
    environmentAllowlistEnforced: z.boolean(),
    exitCode: z.number().int(),
    hostCredentialMountsAbsent: z.boolean(),
    imageArchitecture: z.string(),
    imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    imageOperatingSystem: z.string(),
    imageReference: z.string().min(1),
    imageSha256: sha256Schema,
    kind: z.string(),
    libc: z.object({
      family: z.string().min(1),
      version: z.string().min(1),
    }).strict(),
    networkMode: z.string(),
    noNewPrivileges: z.boolean(),
    npmConfigFilesForcedEmpty: z.boolean(),
    osReleaseSha256: sha256Schema,
    rootFilesystemReadOnly: z.boolean(),
    sourceCheckoutMounted: z.boolean(),
    workMountedReadWrite: z.boolean(),
  }).strict(),
  input: z.object({
    assetLockSha256: sha256Schema,
    assetRootSha256: sha256Schema,
    closureManifestSha256: sha256Schema,
    offlineTarballCount: z.number().int().nonnegative(),
    offlineTarballSetSha256: sha256Schema,
    packageLockSha256: sha256Schema,
    packageSha256: sha256Schema,
    packageVersion: z.string().min(1),
  }).strict(),
  install: z.object({
    cacheSeedCommand: z.array(z.string()),
    cacheSeededTarballSetSha256: sha256Schema,
    command: z.array(z.string()),
    packageLockSha256After: sha256Schema,
    packageLockSha256Before: sha256Schema,
    seededOfflineTarballCount: z.number().int().nonnegative(),
  }).strict(),
  kind: z.literal("c6-linux-x64-package-closure-rebuild"),
  linuxRebuildProven: z.literal(true),
  outcome: z.literal("passed"),
  persistenceBoundary: z.object({
    independentReplayRequired: z.literal(true),
    rawExecutionWitnessIncluded: z.literal(false),
  }).strict(),
  result: z.object({
    frozenTreeManifestSha256: sha256Schema,
    goodmemoryRuntimeHelpExitCode: z.literal(0),
    goodmemoryRuntimeHelpStdoutSha256: sha256Schema,
    goodmemoryVersionExitCode: z.literal(0),
    goodmemoryVersionOutput: z.string().min(1),
    installedTreeManifestSha256: sha256Schema,
    installedTreeMatches: z.literal(true),
    sqliteVssLinuxX64Present: z.literal(true),
  }).strict(),
  runnerProtocolSha256: sha256Schema,
  runtime: runtimeSchema,
  schemaVersion: z.literal(1),
}).strict();
const closureExecutionSchema = z.object({
  consumer: z.object({
    packageLock: z.object({
      sha256: sha256Schema,
    }).passthrough(),
  }).passthrough(),
  offline: z.object({
    tarballSetSha256: sha256Schema,
  }).passthrough(),
}).passthrough();
const declaredBuildProfileSchema = z.object({
  libc: z.object({
    family: z.string().min(1),
    version: z.string().min(1),
  }).strict(),
  osReleaseSha256: sha256Schema,
}).passthrough();
const packageLockUrlSchema = z.object({
  packages: z.record(
    z.string(),
    z.object({
      resolved: z.string().optional(),
    }).passthrough(),
  ),
}).passthrough();
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

export const C6_LINUX_NPM_CI_COMMAND = [
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
  "/work/npm-cache",
] as const;

export const C6_LINUX_NPM_CACHE_SEED_COMMAND = [
  "npm",
  "cache",
  "add",
  "<each-frozen-offline-tarball>",
  "--cache",
  "/work/npm-cache",
] as const;

const DOCKER_COMMAND_TIMEOUT_MS = 30_000;
const DOCKER_REBUILD_TIMEOUT_MS = 600_000;
const DOCKER_SMOKE_TIMEOUT_MS = 120_000;
const ALLOWED_CONTAINER_ENVIRONMENT_KEYS = new Set([
  "HOME",
  "GOODMEMORY_BUN_BINARY",
  "NODE_VERSION",
  "NPM_CONFIG_GLOBALCONFIG",
  "NPM_CONFIG_USERCONFIG",
  "PATH",
  "YARN_VERSION",
  "npm_config_update_notifier",
]);

const CONTAINER_SCRIPT = `#!/bin/sh
set -eu
umask 022

test "$(uname -s)" = "Linux"
test "$(uname -m)" = "x86_64"
test ! -e /work/npm-cache

mkdir -p /work/home /work/observed
: > /work/empty-global-npmrc
: > /work/empty-user-npmrc

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
for archive in /closure/offline/tarballs/*.tgz; do
  test -f "$archive"
  npm cache add "$archive" --cache /work/npm-cache >/dev/null
  seeded=$((seeded + 1))
done
printf '%s\\n' "$seeded" > /work/observed/seeded-tarball-count

cd /work/consumer
npm ci --offline --ignore-scripts --omit=dev --include=optional --install-strategy=hoisted --no-audit --no-fund --cache /work/npm-cache
hash_file /work/consumer/package-lock.json > /work/observed/package-lock-after
cmp /work/observed/package-lock-before /work/observed/package-lock-after

test -f node_modules/sqlite-vss-linux-x64/package.json
printf 'true\\n' > /work/observed/sqlite-vss-linux-x64-present
`;

export const C6_LINUX_PACKAGE_CLOSURE_PROTOCOL_SHA256 = sha256(
  JSON.stringify({
    cacheSeedCommand: C6_LINUX_NPM_CACHE_SEED_COMMAND,
    containerScript: CONTAINER_SCRIPT,
    npmCiCommand: C6_LINUX_NPM_CI_COMMAND,
    ownershipLabel: "org.goodmemory.c6.owner",
    phaseLabel: "org.goodmemory.c6.phase",
    schemaVersion: 1,
  }),
);

export type C6LinuxPackageClosureReceipt = z.infer<
  typeof receiptSchema
>;

export interface C6LinuxPackageClosureRunResult {
  linuxRebuildProven: true;
  receipt: C6LinuxPackageClosureReceipt;
  receiptPath: string;
  receiptSha256: string;
}

export interface C6LinuxPackageClosureReceiptVerification {
  linuxRebuildProven: false;
  receiptSha256: string;
  receiptValidation: "frozen-runner-receipt-structure-only";
  recordedLinuxRebuildProven: true;
}

export function buildC6LinuxPackageClosureDockerCreateCommand(input: {
  closureRoot: string;
  containerUser: string;
  expectedImageSha256: string;
  imageReference: string;
  workRoot: string;
}): string[] {
  assertPinnedImageReference(
    input.imageReference,
    input.expectedImageSha256,
  );
  assertDockerMountPath(input.closureRoot, "closure root");
  assertDockerMountPath(input.workRoot, "work root");
  if (!/^\d+:\d+$/u.test(input.containerUser)) {
    throw new Error("C6 Linux container user must be numeric uid:gid");
  }
  const containerName = dockerContainerName(input.workRoot, "install");
  return [
    "docker",
    "create",
    "--pull=never",
    `--name=${containerName}`,
    `--label=org.goodmemory.c6.owner=${containerOwner(input.workRoot)}`,
    "--label=org.goodmemory.c6.phase=linux-install",
    "--platform=linux/amd64",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--tmpfs=/tmp:rw,nosuid,nodev,size=512m",
    `--user=${input.containerUser}`,
    "--env=HOME=/work/home",
    "--env=NPM_CONFIG_GLOBALCONFIG=/work/empty-global-npmrc",
    "--env=NPM_CONFIG_USERCONFIG=/work/empty-user-npmrc",
    "--env=npm_config_update_notifier=false",
    `--mount=type=bind,src=${input.closureRoot},dst=/closure,readonly`,
    `--mount=type=bind,src=${input.workRoot},dst=/work`,
    "--workdir=/work/consumer",
    "--entrypoint=/bin/sh",
    input.imageReference,
    "/work/run-c6-package-closure.sh",
  ];
}

export function buildC6LinuxGoodMemorySmokeDockerCreateCommand(input: {
  argument: "--help" | "--version";
  bunPath: string;
  containerUser: string;
  expectedImageSha256: string;
  imageReference: string;
  workRoot: string;
}): string[] {
  assertPinnedImageReference(
    input.imageReference,
    input.expectedImageSha256,
  );
  assertDockerMountPath(input.workRoot, "smoke work root");
  if (!/^\d+:\d+$/u.test(input.containerUser)) {
    throw new Error("C6 Linux container user must be numeric uid:gid");
  }
  if (!/^\/[A-Za-z0-9._/-]+$/u.test(input.bunPath)) {
    throw new Error("C6 Linux observed Bun path is invalid");
  }
  const name = dockerContainerName(
    input.workRoot,
    input.argument === "--help" ? "help" : "version",
  );
  return [
    "docker",
    "create",
    "--pull=never",
    `--name=${name}`,
    `--label=org.goodmemory.c6.owner=${containerOwner(input.workRoot)}`,
    `--label=org.goodmemory.c6.phase=linux-smoke-${
      input.argument.slice(2)
    }`,
    "--platform=linux/amd64",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--tmpfs=/tmp:rw,nosuid,nodev,size=128m",
    `--user=${input.containerUser}`,
    "--env=HOME=/tmp/home",
    `--env=GOODMEMORY_BUN_BINARY=${input.bunPath}`,
    `--mount=type=bind,src=${input.workRoot},dst=/runtime,readonly`,
    "--workdir=/runtime/consumer",
    "--entrypoint=/runtime/consumer/node_modules/.bin/goodmemory",
    input.imageReference,
    input.argument,
  ];
}

export async function buildC6InstalledTreeManifestFromDirectory(
  nodeModulesRoot: string,
): Promise<string> {
  const resolvedRoot = resolve(nodeModulesRoot);
  if (
    basename(resolvedRoot) !== "node_modules" ||
    await realpath(resolvedRoot) !== resolvedRoot ||
    !(await lstat(resolvedRoot)).isDirectory()
  ) {
    throw new Error(
      "C6 rebuilt installed tree root must be a real node_modules directory",
    );
  }
  const entries = await walkInstalledTree(resolvedRoot, resolvedRoot);
  return serializeC6InstalledTreeManifest(entries);
}

export function parseC6DockerCreatedContainerId(
  value: string,
  label: string,
): string {
  const containerId = value.trim();
  if (!/^[a-f0-9]{64}$/u.test(containerId)) {
    throw new Error(`C6 Docker ${label} returned an invalid container id`);
  }
  return containerId;
}

export async function runC6LinuxPackageClosureRebuild(input: {
  closureRoot: string;
  expected: C6PackageClosureExpectedIdentity;
  imageReference: string;
  receiptPath: string;
}): Promise<C6LinuxPackageClosureRunResult> {
  assertPinnedImageReference(
    input.imageReference,
    input.expected.image.sha256,
  );
  const closureRoot = await canonicalDirectory(
    input.closureRoot,
    "package closure root",
  );
  const receiptPath = await canonicalNewOutputPath(input.receiptPath);
  if (
    receiptPath === closureRoot ||
    receiptPath.startsWith(`${closureRoot}/`)
  ) {
    throw new Error("C6 Linux rebuild receipt must be outside the closure");
  }

  const staticValidation = await validateC6PackageClosure({
    closureRoot,
    expected: input.expected,
  });
  const closureExecution = parseJson(
    closureExecutionSchema,
    await readC6StableRegularFile(
      join(closureRoot, "closure.json"),
      "Linux rebuild closure manifest",
    ),
    "Linux rebuild closure manifest",
  );
  const packageLockBytes = await readC6StableRegularFile(
    join(closureRoot, "consumer/package-lock.json"),
    "Linux rebuild package-lock",
  );
  if (
    sha256(packageLockBytes) !==
      closureExecution.consumer.packageLock.sha256
  ) {
    throw new Error("C6 Linux rebuild package-lock identity drifted");
  }
  assertC6LinuxPackageLockCredentialSurface(packageLockBytes);
  const declaredBuildProfile = parseJson(
    declaredBuildProfileSchema,
    await readC6StableRegularFile(
      join(closureRoot, "profiles/linux-x64-build.json"),
      "declared Linux build profile",
    ),
    "declared Linux build profile",
  );

  const dockerServerVersion = await requireDockerServer();
  const image = await inspectDockerImage(
    input.imageReference,
    input.expected.image.sha256,
  );
  const workRoot = await mkdtemp(join(
    await realpath(tmpdir()),
    "goodmemory-c6-linux-rebuild-",
  ));
  let containerTarget: string | undefined;
  let completedReceipt: C6LinuxPackageClosureReceipt | undefined;
  try {
    await prepareWorkDirectory(
      closureRoot,
      workRoot,
      input.expected.package.version,
    );
    const containerUser = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;
    const createCommand =
      buildC6LinuxPackageClosureDockerCreateCommand({
        closureRoot,
        containerUser,
        expectedImageSha256: input.expected.image.sha256,
        imageReference: input.imageReference,
        workRoot,
    });
    const created = await runCommand(createCommand, "Docker create");
    const containerId = parseC6DockerCreatedContainerId(
      created.stdout,
      "create",
    );
    const before = await inspectDockerContainer(containerId);
    assertDockerContainerIsolation({
      closureRoot,
      container: before,
      imageId: image.Id,
      workRoot,
    });
    containerTarget = containerId;

    const execution = await runCommand(
      ["docker", "start", "--attach", containerId],
      "Docker Linux rebuild",
      true,
      DOCKER_REBUILD_TIMEOUT_MS,
    );
    const after = await inspectDockerContainer(containerId);
    const exitCode = after.State?.ExitCode ?? execution.exitCode;
    if (execution.exitCode !== 0 || exitCode !== 0) {
      throw new Error([
        `C6 Docker Linux rebuild exited ${exitCode}`,
        outputTail(execution.stdout),
        outputTail(execution.stderr),
      ].filter((value) => value.length > 0).join("\n"));
    }
    await removeDockerContainer(containerId);
    containerTarget = undefined;

    const observed = await readObservedExecution(workRoot);
    assertObservedRuntime(observed, input.expected);
    if (
      observed.osReleaseSha256 !==
        declaredBuildProfile.osReleaseSha256 ||
      !sameJson(observed.libc, declaredBuildProfile.libc)
    ) {
      throw new Error(
        "C6 Linux observed OS release or libc identity does not match",
      );
    }
    if (
      observed.packageLockSha256Before !== sha256(packageLockBytes) ||
      observed.packageLockSha256After !== sha256(packageLockBytes) ||
      observed.seededOfflineTarballCount !==
        staticValidation.offlineTarballCount
    ) {
      throw new Error(
        "C6 Linux offline install input identity or cache seed count drifted",
      );
    }
    if (!observed.sqliteVssLinuxX64Present) {
      throw new Error("C6 Linux install is missing sqlite-vss-linux-x64");
    }

    const rebuiltManifest =
      await buildC6InstalledTreeManifestFromDirectory(
        join(workRoot, "consumer/node_modules"),
      );
    const frozenManifest = await readC6StableRegularFile(
      join(closureRoot, "installed/tree.jsonl"),
      "frozen installed tree manifest",
    );
    if (
      rebuiltManifest !== frozenManifest.toString("utf8") ||
      sha256(rebuiltManifest) !==
        input.expected.package.dependencyClosure
          .installedTreeManifestSha256
    ) {
      throw new Error(
        "C6 Linux rebuilt installed tree does not match the frozen tree",
      );
    }
    const versionSmoke = await runC6LinuxGoodMemorySmoke({
      argument: "--version",
      bunPath: observed.bunPath,
      containerUser,
      expectedImageSha256: input.expected.image.sha256,
      imageId: image.Id,
      imageReference: input.imageReference,
      workRoot,
    });
    const helpSmoke = await runC6LinuxGoodMemorySmoke({
      argument: "--help",
      bunPath: observed.bunPath,
      containerUser,
      expectedImageSha256: input.expected.image.sha256,
      imageId: image.Id,
      imageReference: input.imageReference,
      workRoot,
    });
    const expectedVersionOutput =
      `goodmemory ${input.expected.package.version}`;
    if (
      versionSmoke.stdout.trimEnd() !== expectedVersionOutput ||
      helpSmoke.stdout.length === 0
    ) {
      throw new Error("C6 Linux GoodMemory runtime smoke failed");
    }
    const afterSmokeManifest =
      await buildC6InstalledTreeManifestFromDirectory(
        join(workRoot, "consumer/node_modules"),
      );
    if (afterSmokeManifest !== rebuiltManifest) {
      throw new Error("C6 Linux read-only smoke changed the installed tree");
    }

    await validateC6PackageClosure({
      closureRoot,
      expected: input.expected,
    });
    const receipt = receiptSchema.parse({
      executor: {
        allCapabilitiesDropped: true,
        cacheStartedEmpty: true,
        closureMountedReadOnly: true,
        containerArchitecture: observed.architecture,
        containerOperatingSystem: observed.operatingSystem,
        dockerServerVersion,
        environmentAllowlistEnforced: true,
        exitCode: 0,
        hostCredentialMountsAbsent: true,
        imageArchitecture: image.Architecture,
        imageId: image.Id,
        imageOperatingSystem: image.Os,
        imageReference: input.imageReference,
        imageSha256: input.expected.image.sha256,
        kind: "docker",
        libc: observed.libc,
        networkMode: "none",
        noNewPrivileges: true,
        npmConfigFilesForcedEmpty: true,
        osReleaseSha256: observed.osReleaseSha256,
        rootFilesystemReadOnly: true,
        sourceCheckoutMounted: false,
        workMountedReadWrite: true,
      },
      input: {
        assetLockSha256:
          input.expected.package.dependencyClosure.assetLockSha256,
        assetRootSha256:
          input.expected.package.dependencyClosure.assetRootSha256,
        closureManifestSha256:
          input.expected.package.dependencyClosure.manifestSha256,
        offlineTarballCount: staticValidation.offlineTarballCount,
        offlineTarballSetSha256:
          closureExecution.offline.tarballSetSha256,
        packageLockSha256: sha256(packageLockBytes),
        packageSha256: input.expected.package.sha256,
        packageVersion: input.expected.package.version,
      },
      install: {
        cacheSeedCommand: [...C6_LINUX_NPM_CACHE_SEED_COMMAND],
        cacheSeededTarballSetSha256:
          closureExecution.offline.tarballSetSha256,
        command: [...C6_LINUX_NPM_CI_COMMAND],
        packageLockSha256After: observed.packageLockSha256After,
        packageLockSha256Before: observed.packageLockSha256Before,
        seededOfflineTarballCount:
          observed.seededOfflineTarballCount,
      },
      kind: "c6-linux-x64-package-closure-rebuild",
      linuxRebuildProven: true,
      outcome: "passed",
      persistenceBoundary: {
        independentReplayRequired: true,
        rawExecutionWitnessIncluded: false,
      },
      result: {
        frozenTreeManifestSha256: sha256(frozenManifest),
        goodmemoryRuntimeHelpExitCode: 0,
        goodmemoryRuntimeHelpStdoutSha256: sha256(helpSmoke.stdout),
        goodmemoryVersionExitCode: 0,
        goodmemoryVersionOutput: versionSmoke.stdout.trimEnd(),
        installedTreeManifestSha256: sha256(rebuiltManifest),
        installedTreeMatches: true,
        sqliteVssLinuxX64Present: true,
      },
      runnerProtocolSha256:
        C6_LINUX_PACKAGE_CLOSURE_PROTOCOL_SHA256,
      runtime: observed.runtime,
      schemaVersion: 1,
    });
    assertReceipt(receipt, input.expected);
    completedReceipt = receipt;
  } finally {
    if (containerTarget !== undefined) {
      await removeDockerContainer(containerTarget);
    }
    await rm(workRoot, { force: true, recursive: true });
  }
  if (completedReceipt === undefined) {
    throw new Error("C6 Linux rebuild completed without a receipt");
  }
  const receiptBytes =
    serializeC6LinuxPackageClosureReceipt(completedReceipt);
  await writeAtomicExclusive(receiptPath, receiptBytes);
  return {
    linuxRebuildProven: true,
    receipt: completedReceipt,
    receiptPath,
    receiptSha256: sha256(receiptBytes),
  };
}

export function serializeC6LinuxPackageClosureReceipt(
  receipt: C6LinuxPackageClosureReceipt,
): string {
  return `${JSON.stringify(receiptSchema.parse(receipt), null, 2)}\n`;
}

export async function verifyC6LinuxPackageClosureReceipt(input: {
  expected: C6PackageClosureExpectedIdentity;
  expectedReceiptSha256: string;
  path: string;
}): Promise<C6LinuxPackageClosureReceiptVerification> {
  if (!/^[a-f0-9]{64}$/u.test(input.expectedReceiptSha256)) {
    throw new Error("C6 Linux rebuild expected receipt hash is invalid");
  }
  const bytes = await readC6StableRegularFile(
    input.path,
    "Linux rebuild receipt",
  );
  const receiptSha256 = sha256(bytes);
  if (receiptSha256 !== input.expectedReceiptSha256) {
    throw new Error("C6 Linux rebuild receipt hash does not match");
  }
  const receipt = parseJson(
    receiptSchema,
    bytes,
    "Linux rebuild receipt",
  );
  if (
    serializeC6LinuxPackageClosureReceipt(receipt) !==
      bytes.toString("utf8")
  ) {
    throw new Error("C6 Linux rebuild receipt is not canonical");
  }
  assertReceipt(receipt, input.expected);
  return {
    linuxRebuildProven: false,
    receiptSha256,
    receiptValidation: "frozen-runner-receipt-structure-only",
    recordedLinuxRebuildProven: true,
  };
}

async function prepareWorkDirectory(
  closureRoot: string,
  workRoot: string,
  packageVersion: string,
): Promise<void> {
  await Promise.all([
    mkdir(join(workRoot, "consumer"), { recursive: true }),
    mkdir(join(workRoot, "observed"), { recursive: true }),
    mkdir(join(workRoot, "package"), { recursive: true }),
  ]);
  await Promise.all([
    copyFile(
      join(closureRoot, "consumer/package.json"),
      join(workRoot, "consumer/package.json"),
    ),
    copyFile(
      join(closureRoot, "consumer/package-lock.json"),
      join(workRoot, "consumer/package-lock.json"),
    ),
    copyFile(
      join(closureRoot, `package/goodmemory-${packageVersion}.tgz`),
      join(workRoot, "package", `goodmemory-${packageVersion}.tgz`),
    ),
    writeFile(
      join(workRoot, "run-c6-package-closure.sh"),
      CONTAINER_SCRIPT,
      "utf8",
    ),
  ]);
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
      "C6 Linux executor unavailable: Docker daemon is not reachable",
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
    "Docker image inspect",
    true,
  );
  if (result.exitCode !== 0) {
    throw new Error([
      "C6 pinned Linux x64 image is not available locally",
      outputTail(result.stderr),
    ].filter((value) => value.length > 0).join("\n"));
  }
  const inspected = parseJsonValue(
    z.array(imageInspectSchema).length(1),
    result.stdout,
    "Docker image inspect",
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
      "C6 Docker image inspect does not match pinned Linux amd64 identity",
    );
  }
  return inspected;
}

async function inspectDockerContainer(
  containerId: string,
): Promise<z.infer<typeof containerInspectSchema>> {
  const result = await runCommand(
    ["docker", "inspect", containerId],
    "Docker container inspect",
  );
  return parseJsonValue(
    z.array(containerInspectSchema).length(1),
    result.stdout,
    "Docker container inspect",
  )[0];
}

function assertDockerContainerIsolation(input: {
  closureRoot: string;
  container: z.infer<typeof containerInspectSchema>;
  imageId: string;
  workRoot: string;
}): void {
  const { container } = input;
  const closureMount = container.Mounts.find((mount) =>
    mount.Destination === "/closure"
  );
  const workMount = container.Mounts.find((mount) =>
    mount.Destination === "/work"
  );
  const securityOptions = container.HostConfig.SecurityOpt ?? [];
  const labels = container.Config.Labels ?? {};
  if (
    container.Image !== input.imageId ||
    container.HostConfig.NetworkMode !== "none" ||
    !container.HostConfig.ReadonlyRootfs ||
    !container.HostConfig.CapDrop?.includes("ALL") ||
    !securityOptions.some((value) =>
      value === "no-new-privileges" ||
      value === "no-new-privileges:true"
    ) ||
    closureMount?.Type !== "bind" ||
    closureMount.Source !== input.closureRoot ||
    closureMount.RW ||
    workMount?.Type !== "bind" ||
    workMount.Source !== input.workRoot ||
    !workMount.RW ||
    container.Mounts.length !== 2 ||
    labels["org.goodmemory.c6.owner"] !== containerOwner(input.workRoot) ||
    labels["org.goodmemory.c6.phase"] !== "linux-install"
  ) {
    throw new Error("C6 Docker container isolation inspect failed");
  }
  const environment = new Map(
    (container.Config.Env ?? []).map((entry) => {
      const separator = entry.indexOf("=");
      return [
        separator < 0 ? entry : entry.slice(0, separator),
        separator < 0 ? "" : entry.slice(separator + 1),
      ];
    }),
  );
  if (
    [...environment.keys()].some((key) =>
      !ALLOWED_CONTAINER_ENVIRONMENT_KEYS.has(key)
    ) ||
    environment.get("HOME") !== "/work/home" ||
    environment.get("NPM_CONFIG_GLOBALCONFIG") !==
      "/work/empty-global-npmrc" ||
    environment.get("NPM_CONFIG_USERCONFIG") !==
      "/work/empty-user-npmrc" ||
    environment.get("npm_config_update_notifier") !== "false"
  ) {
    throw new Error("C6 Docker container environment is not allowlisted");
  }
}

export async function runC6LinuxGoodMemorySmoke(input: {
  argument: "--help" | "--version";
  bunPath: string;
  containerUser: string;
  expectedImageSha256: string;
  imageId: string;
  imageReference: string;
  workRoot: string;
}): Promise<CommandResult> {
  let cleanupTarget: string | undefined;
  try {
    const created = await runCommand(
      buildC6LinuxGoodMemorySmokeDockerCreateCommand({
        argument: input.argument,
        bunPath: input.bunPath,
        containerUser: input.containerUser,
        expectedImageSha256: input.expectedImageSha256,
        imageReference: input.imageReference,
        workRoot: input.workRoot,
      }),
      `Docker GoodMemory ${input.argument} create`,
    );
    const containerId = parseC6DockerCreatedContainerId(
      created.stdout,
      `GoodMemory ${input.argument} smoke create`,
    );
    assertDockerSmokeIsolation({
      argument: input.argument,
      bunPath: input.bunPath,
      container: await inspectDockerContainer(containerId),
      imageId: input.imageId,
      workRoot: input.workRoot,
    });
    cleanupTarget = containerId;
    const execution = await runCommand(
      ["docker", "start", "--attach", containerId],
      `Docker GoodMemory ${input.argument} smoke`,
      true,
      DOCKER_SMOKE_TIMEOUT_MS,
    );
    const after = await inspectDockerContainer(containerId);
    if (
      execution.exitCode !== 0 ||
      after.State?.ExitCode !== 0
    ) {
      throw new Error([
        `C6 Docker GoodMemory ${input.argument} smoke failed`,
        outputTail(execution.stdout),
        outputTail(execution.stderr),
      ].filter((value) => value.length > 0).join("\n"));
    }
    await removeDockerContainer(containerId);
    cleanupTarget = undefined;
    return execution;
  } finally {
    if (cleanupTarget !== undefined) {
      await removeDockerContainer(cleanupTarget);
    }
  }
}

function assertDockerSmokeIsolation(input: {
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
      containerOwner(input.workRoot) ||
    labels["org.goodmemory.c6.phase"] !==
      `linux-smoke-${input.argument.slice(2)}`
  ) {
    throw new Error("C6 Docker read-only smoke isolation inspect failed");
  }
  const environment = new Map(
    (input.container.Config.Env ?? []).map((entry) => {
      const separator = entry.indexOf("=");
      return [
        separator < 0 ? entry : entry.slice(0, separator),
        separator < 0 ? "" : entry.slice(separator + 1),
      ];
    }),
  );
  if (
    [...environment.keys()].some((key) =>
      !ALLOWED_CONTAINER_ENVIRONMENT_KEYS.has(key)
    ) ||
    environment.get("HOME") !== "/tmp/home" ||
    environment.get("GOODMEMORY_BUN_BINARY") !== input.bunPath
  ) {
    throw new Error("C6 Docker smoke environment is not allowlisted");
  }
}

async function removeDockerContainer(target: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/u.test(target)) {
    throw new Error("C6 Docker cleanup requires a created container id");
  }
  const before = await runCommand(
    ["docker", "inspect", target],
    "Docker cleanup inspect",
    true,
  );
  if (before.exitCode !== 0) {
    if (
      /No such (?:object|container)/iu.test(before.stderr)
    ) {
      return;
    }
    throw new Error([
      "C6 Docker cleanup could not inspect the container",
      outputTail(before.stderr),
    ].filter((value) => value.length > 0).join("\n"));
  }
  const removed = await runCommand(
    ["docker", "rm", "--force", target],
    "Docker cleanup",
    true,
  );
  if (removed.exitCode !== 0) {
    throw new Error([
      "C6 Docker cleanup failed",
      outputTail(removed.stderr),
    ].filter((value) => value.length > 0).join("\n"));
  }
  const after = await runCommand(
    ["docker", "inspect", target],
    "Docker cleanup verification",
    true,
  );
  if (
    after.exitCode === 0 ||
    !/No such (?:object|container)/iu.test(after.stderr)
  ) {
    throw new Error("C6 Docker cleanup could not verify removal");
  }
}

interface ObservedExecution {
  architecture: string;
  bunPath: string;
  operatingSystem: string;
  libc: {
    family: string;
    version: string;
  };
  osReleaseSha256: string;
  packageLockSha256After: string;
  packageLockSha256Before: string;
  runtime: C6PackageClosureExpectedIdentity["image"]["runtime"];
  seededOfflineTarballCount: number;
  sqliteVssLinuxX64Present: boolean;
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
  const seededOfflineTarballCount = Number(seededCount);
  if (!Number.isInteger(seededOfflineTarballCount)) {
    throw new Error("C6 Linux observed cache seed count is invalid");
  }
  const libcParts = (
    await readObserved(observedRoot, "libc")
  ).split(/\s+/u);
  if (libcParts.length !== 2) {
    throw new Error("C6 Linux observed libc identity is invalid");
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
    runtime: runtimeSchema.parse({
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

function assertObservedRuntime(
  observed: ObservedExecution,
  expected: C6PackageClosureExpectedIdentity,
): void {
  if (
    observed.operatingSystem !== "Linux" ||
    observed.architecture !== "x86_64" ||
    !sameJson(
      observed.runtime,
      runtimeSchema.parse(expected.image.runtime),
    )
  ) {
    throw new Error("C6 Linux observed runtime identity does not match");
  }
}

function assertReceipt(
  receipt: C6LinuxPackageClosureReceipt,
  expected: C6PackageClosureExpectedIdentity,
): void {
  let digest: string;
  try {
    digest = imageReferenceDigest(receipt.executor.imageReference);
  } catch {
    throw new Error("C6 Linux rebuild receipt image is not digest-pinned");
  }
  const closure = expected.package.dependencyClosure;
  if (
    receipt.runnerProtocolSha256 !==
      C6_LINUX_PACKAGE_CLOSURE_PROTOCOL_SHA256 ||
    receipt.input.assetLockSha256 !== closure.assetLockSha256 ||
    receipt.input.assetRootSha256 !== closure.assetRootSha256 ||
    receipt.input.closureManifestSha256 !== closure.manifestSha256 ||
    receipt.input.packageSha256 !== expected.package.sha256 ||
    receipt.input.packageVersion !== expected.package.version ||
    receipt.executor.kind !== "docker" ||
    receipt.executor.imageSha256 !== expected.image.sha256 ||
    digest !== expected.image.sha256 ||
    receipt.executor.imageOperatingSystem !== "linux" ||
    receipt.executor.imageArchitecture !== "amd64" ||
    receipt.executor.containerOperatingSystem !== "Linux" ||
    receipt.executor.containerArchitecture !== "x86_64" ||
    receipt.executor.networkMode !== "none" ||
    !receipt.executor.rootFilesystemReadOnly ||
    !receipt.executor.allCapabilitiesDropped ||
    !receipt.executor.noNewPrivileges ||
    !receipt.executor.closureMountedReadOnly ||
    !receipt.executor.workMountedReadWrite ||
    receipt.executor.sourceCheckoutMounted ||
    !receipt.executor.hostCredentialMountsAbsent ||
    !receipt.executor.environmentAllowlistEnforced ||
    !receipt.executor.npmConfigFilesForcedEmpty ||
    !receipt.executor.cacheStartedEmpty ||
    receipt.executor.exitCode !== 0
  ) {
    throw new Error("C6 Linux rebuild receipt executor evidence is invalid");
  }
  if (
    !sameJson(
      receipt.runtime,
      runtimeSchema.parse(expected.image.runtime),
    )
  ) {
    throw new Error("C6 Linux rebuild receipt runtime identity drifted");
  }
  if (
    !sameJson(receipt.install.command, C6_LINUX_NPM_CI_COMMAND) ||
    !sameJson(
      receipt.install.cacheSeedCommand,
      C6_LINUX_NPM_CACHE_SEED_COMMAND,
    ) ||
    receipt.install.cacheSeededTarballSetSha256 !==
      receipt.input.offlineTarballSetSha256 ||
    receipt.install.seededOfflineTarballCount !==
      receipt.input.offlineTarballCount ||
    receipt.install.packageLockSha256Before !==
      receipt.input.packageLockSha256 ||
    receipt.install.packageLockSha256After !==
      receipt.input.packageLockSha256
  ) {
    throw new Error("C6 Linux rebuild receipt offline install evidence is invalid");
  }
  if (
    receipt.result.frozenTreeManifestSha256 !==
      closure.installedTreeManifestSha256 ||
    receipt.result.installedTreeManifestSha256 !==
      closure.installedTreeManifestSha256 ||
    receipt.result.goodmemoryVersionOutput !==
      `goodmemory ${expected.package.version}`
  ) {
    throw new Error("C6 Linux rebuild receipt result identity drifted");
  }
}

async function walkInstalledTree(
  root: string,
  directory: string,
): Promise<C6InstalledTreeEntry[]> {
  const directoryEntries = await readdir(directory, {
    withFileTypes: true,
  });
  directoryEntries.sort((left, right) =>
    compareUtf8(left.name, right.name)
  );
  const entries: C6InstalledTreeEntry[] = [];
  for (const directoryEntry of directoryEntries) {
    const path = join(directory, directoryEntry.name);
    const manifestPath = [
      "node_modules",
      relative(root, path).split("\\").join("/"),
    ].filter((value) => value.length > 0).join("/");
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      const target = await readlink(path);
      assertSafeTreeSymlink(manifestPath, target);
      entries.push({
        mode: stat.mode & 0o777,
        path: manifestPath,
        target,
        type: "symlink",
      });
      continue;
    }
    if (stat.isDirectory()) {
      entries.push(...await walkInstalledTree(root, path));
      continue;
    }
    if (!stat.isFile() || stat.nlink !== 1) {
      throw new Error(
        `C6 rebuilt installed tree rejects non-file or hardlink ${manifestPath}`,
      );
    }
    const bytes = await readC6StableRegularFile(
      path,
      "rebuilt installed tree file",
    );
    const after = await lstat(path);
    if (
      after.dev !== stat.dev ||
      after.ino !== stat.ino ||
      after.mode !== stat.mode ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs
    ) {
      throw new Error(
        `C6 rebuilt installed tree file drifted ${manifestPath}`,
      );
    }
    entries.push({
      mode: stat.mode & 0o777,
      path: manifestPath,
      sha256: sha256(bytes),
      size: bytes.byteLength,
      type: "file",
    });
  }
  return entries;
}

function assertSafeTreeSymlink(path: string, target: string): void {
  if (
    target.includes("\\") ||
    target.includes("\0") ||
    posix.isAbsolute(target)
  ) {
    throw new Error(`C6 rebuilt installed tree symlink escapes: ${path}`);
  }
  const resolvedTarget = posix.normalize(
    posix.join(posix.dirname(path), target),
  );
  if (!resolvedTarget.startsWith("node_modules/")) {
    throw new Error(`C6 rebuilt installed tree symlink escapes: ${path}`);
  }
}

export function assertC6LinuxPackageLockCredentialSurface(
  bytes: Buffer,
): void {
  const packageLock = parseJson(
    packageLockUrlSchema,
    bytes,
    "Linux rebuild package-lock URL surface",
  );
  for (const entry of Object.values(packageLock.packages)) {
    if (entry.resolved === undefined) {
      continue;
    }
    let url: URL;
    try {
      url = new URL(entry.resolved);
    } catch {
      continue;
    }
    if (url.protocol !== "https:") {
      continue;
    }
    if (
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      throw new Error(
        "C6 Linux package-lock rejects credential-bearing registry URL",
      );
    }
  }
}

function assertPinnedImageReference(
  imageReference: string,
  expectedImageSha256: string,
): void {
  if (!/^[a-f0-9]{64}$/u.test(expectedImageSha256)) {
    throw new Error("C6 expected image digest is invalid");
  }
  let digest: string;
  try {
    digest = imageReferenceDigest(imageReference);
  } catch {
    throw new Error("C6 Linux image reference must be digest-pinned");
  }
  if (digest !== expectedImageSha256) {
    throw new Error("C6 Linux image digest does not match expected identity");
  }
}

function dockerContainerName(workRoot: string, phase: string): string {
  return `goodmemory-c6-${phase}-${sha256(workRoot).slice(0, 16)}`;
}

function containerOwner(workRoot: string): string {
  return sha256(workRoot);
}

function imageReferenceDigest(imageReference: string): string {
  const imageId = /^sha256:([a-f0-9]{64})$/u.exec(imageReference);
  if (imageId !== null) {
    return imageId[1];
  }
  const repositoryDigest =
    /^[a-z0-9][a-z0-9._:/-]*@sha256:([a-f0-9]{64})$/u.exec(
      imageReference,
    );
  if (repositoryDigest === null) {
    throw new Error("invalid image reference");
  }
  return repositoryDigest[1];
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

async function canonicalDirectory(
  path: string,
  label: string,
): Promise<string> {
  const absolute = resolve(path);
  const canonical = await realpath(absolute);
  if (canonical !== absolute || !(await lstat(canonical)).isDirectory()) {
    throw new Error(`C6 ${label} must not contain symlink components`);
  }
  return canonical;
}

async function canonicalNewOutputPath(path: string): Promise<string> {
  const absolute = resolve(path);
  const canonicalParent = await realpath(dirname(absolute));
  if (canonicalParent !== dirname(absolute)) {
    throw new Error(
      "C6 Linux rebuild receipt parent must not contain symlinks",
    );
  }
  return join(canonicalParent, basename(absolute));
}

async function writeAtomicExclusive(
  path: string,
  bytes: string,
): Promise<void> {
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  let created = false;
  let linked = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    created = true;
    try {
      await handle.writeFile(bytes, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporaryPath, path);
    linked = true;
  } finally {
    if (created) {
      try {
        await unlink(temporaryPath);
      } catch (error) {
        if (!linked) {
          throw error;
        }
        console.error(
          `C6 receipt temporary-file cleanup failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
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

async function readObserved(root: string, name: string): Promise<string> {
  return (
    await readC6StableRegularFile(
      join(root, name),
      `Linux observed ${name}`,
    )
  ).toString("utf8").trimEnd();
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

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
