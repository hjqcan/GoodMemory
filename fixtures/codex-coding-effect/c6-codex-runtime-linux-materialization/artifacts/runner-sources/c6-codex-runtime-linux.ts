import {
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  resolve,
} from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";

import { z } from "zod";

import {
  buildC6AssetLock,
  loadC6AssetLock,
  readC6StableRegularFile,
  serializeC6AssetLock,
} from "./c6-asset-lock";
import type { C6AssetLock } from "./c6-asset-lock";
import {
  validateC6CodexRuntimeStaticClosure,
} from "./c6-codex-runtime";

const FIXED_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const CONTAINER_NONCE_LABEL =
  "org.goodmemory.c6.codex-runtime.nonce";
const CONTAINER_RUN_LABEL =
  "org.goodmemory.c6.codex-runtime.run";
const CONTAINER_WORK_ROOT_LABEL =
  "org.goodmemory.c6.codex-runtime.work-root-sha256";
const sha256Pattern = /^[a-f0-9]{64}$/u;
const sha256Schema = z.string().regex(sha256Pattern);
const dockerHostSchema = z.string().regex(
  /^unix:\/\/\/[^\u0000\r\n]+$/u,
);
const EXPECTED_CODEX_VERSION = "0.145.0";
const COMMAND_TIMEOUT_MS = 30_000;
const RUN_TIMEOUT_MS = 600_000;
const UNCERTAIN_CREATE_DISCOVERY_INTERVAL_MS = 250;
const UNCERTAIN_CREATE_EMPTY_CONFIRMATIONS = 3;
const UNCERTAIN_CREATE_MAX_DISCOVERY_QUERIES = 8;
const DOCKER_CLIENT_PATH = "/usr/bin:/bin";
const DOCKER_DAEMON_TRUST_BOUNDARY =
  "explicit-unix-socket-daemon-not-cryptographically-attested";
const ROOT_FILES = ["artifacts", "receipt.json"] as const;
const ARTIFACT_ENTRIES = [
  "asset-lock.json",
  "manifest.json",
  "run-1.json",
  "run-2.json",
  "runner-sources",
] as const;
const RUNNER_SOURCE_FILES = [
  "c6-asset-lock.ts",
  "c6-codex-runtime-linux.ts",
  "c6-codex-runtime.ts",
  "materialize-codex-coding-effect-c6-codex-runtime-linux.ts",
] as const;
const ALLOWED_ENVIRONMENT_KEYS = new Set([
  "HOME",
  "NODE_VERSION",
  "NPM_CONFIG_CACHE",
  "NPM_CONFIG_GLOBALCONFIG",
  "NPM_CONFIG_USERCONFIG",
  "PATH",
  "YARN_VERSION",
  "npm_config_update_notifier",
]);

export const C6_CODEX_RUNTIME_LINUX_NPM_CACHE_ADD_COMMANDS = [
  [
    "npm",
    "cache",
    "add",
    "/input/tarballs/openai-codex-0.145.0.tgz",
    "--cache",
    "/work/cache",
  ],
  [
    "npm",
    "cache",
    "add",
    "/input/tarballs/openai-codex-0.145.0-linux-x64.tgz",
    "--cache",
    "/work/cache",
  ],
] as const;
export const C6_CODEX_RUNTIME_LINUX_NPM_CI_COMMAND = [
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
  "/work/cache",
] as const;

const runtimeIdentitySchema = z.object({
  bun: z.object({
    executableSha256: sha256Schema,
    version: z.literal("1.3.11"),
  }).strict(),
  node: z.object({
    executableSha256: sha256Schema,
    version: z.literal("v22.14.0"),
  }).strict(),
  npm: z.object({
    cliSha256: sha256Schema,
    launcherSha256: sha256Schema,
    version: z.literal("10.9.2"),
  }).strict(),
}).strict();
const expectedIdentitySchema = z.object({
  captureSha256: sha256Schema,
  dockerCliSha256: sha256Schema,
  dockerHost: dockerHostSchema,
  imageSha256: sha256Schema,
  linuxTarballSha256: sha256Schema,
  mainTarballSha256: sha256Schema,
  packageJsonSha256: sha256Schema,
  packageLockSha256: sha256Schema,
  runtimeIdentitySha256: sha256Schema,
  version: z.literal(EXPECTED_CODEX_VERSION),
}).strict();
const materializerInputSchema = z.object({
  containerUser: z.string().regex(/^\d+:\d+$/u),
  dockerCliPath: z.string().min(1),
  expected: expectedIdentitySchema,
  fixtureRoot: z.string().min(1),
  imageReference: z.string().min(1),
  outputRoot: z.string().min(1),
  runtimeIdentityPath: z.string().min(1),
  tarballRoot: z.string().min(1),
}).strict();
const artifactReferenceSchema = z.object({
  bytes: z.number().int().nonnegative(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const installedTreeEntrySchema = z.discriminatedUnion("type", [
  z.object({
    mode: z.number().int().min(0).max(0o777),
    path: z.string().min(1),
    type: z.literal("directory"),
  }).strict(),
  z.object({
    bytes: z.number().int().nonnegative(),
    mode: z.number().int().min(0).max(0o777),
    path: z.string().min(1),
    sha256: sha256Schema,
    type: z.literal("file"),
  }).strict(),
  z.object({
    mode: z.number().int().min(0).max(0o777),
    path: z.string().min(1),
    target: z.string().min(1),
    type: z.literal("symlink"),
  }).strict(),
]);
const installedFileSchema = (
  path: string,
  mode: z.ZodType<number> = z.number().int().min(0).max(0o777),
) =>
  z.object({
    bytes: z.number().int().nonnegative(),
    mode,
    path: z.literal(path),
    sha256: sha256Schema,
  }).strict();
const executableSchema = (path: string) =>
  installedFileSchema(path, z.literal(0o755));
const executablePaths = {
  bwrap:
    "node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex-resources/bwrap",
  codeModeHost:
    "node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex-code-mode-host",
  nativeCodex:
    "node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex",
  rg:
    "node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex-path/rg",
  wrapperCodexJs: "node_modules/@openai/codex/bin/codex.js",
  zsh:
    "node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex-resources/zsh/bin/zsh",
} as const;
const packageManifestPaths = {
  linuxX64: "node_modules/@openai/codex-linux-x64/package.json",
  main: "node_modules/@openai/codex/package.json",
} as const;
const binCodexIdentitySchema = z.object({
  path: z.literal("node_modules/.bin/codex"),
  target: z.literal("../@openai/codex/bin/codex.js"),
  type: z.literal("symlink"),
}).strict();
const packagePayloadIdentitySchema = z.object({
  binCodex: binCodexIdentitySchema,
  executables: z.object({
    bwrap: executableSchema(executablePaths.bwrap),
    codeModeHost: executableSchema(executablePaths.codeModeHost),
    nativeCodex: executableSchema(executablePaths.nativeCodex),
    rg: executableSchema(executablePaths.rg),
    wrapperCodexJs: executableSchema(executablePaths.wrapperCodexJs),
    zsh: executableSchema(executablePaths.zsh),
  }).strict(),
  packageManifests: z.object({
    linuxX64: installedFileSchema(packageManifestPaths.linuxX64),
    main: installedFileSchema(packageManifestPaths.main),
  }).strict(),
}).strict();
const RUNNER_SOURCE_PATHS = {
  assetLock: {
    artifactPath: "runner-sources/c6-asset-lock.ts",
    livePath: fileURLToPath(new URL("./c6-asset-lock.ts", import.meta.url)),
  },
  cli: {
    artifactPath:
      "runner-sources/materialize-codex-coding-effect-c6-codex-runtime-linux.ts",
    livePath: fileURLToPath(new URL(
      "../materialize-codex-coding-effect-c6-codex-runtime-linux.ts",
      import.meta.url,
    )),
  },
  materializer: {
    artifactPath: "runner-sources/c6-codex-runtime-linux.ts",
    livePath: fileURLToPath(import.meta.url),
  },
  staticValidator: {
    artifactPath: "runner-sources/c6-codex-runtime.ts",
    livePath: fileURLToPath(
      new URL("./c6-codex-runtime.ts", import.meta.url),
    ),
  },
} as const;
const RUNNER_SOURCE_NAMES = [
  "assetLock",
  "cli",
  "materializer",
  "staticValidator",
] as const;
const runnerSourcesSchema = z.object({
  assetLock: artifactReferenceSchema.extend({
    path: z.literal(RUNNER_SOURCE_PATHS.assetLock.artifactPath),
  }).strict(),
  cli: artifactReferenceSchema.extend({
    path: z.literal(RUNNER_SOURCE_PATHS.cli.artifactPath),
  }).strict(),
  materializer: artifactReferenceSchema.extend({
    path: z.literal(RUNNER_SOURCE_PATHS.materializer.artifactPath),
  }).strict(),
  staticValidator: artifactReferenceSchema.extend({
    path: z.literal(RUNNER_SOURCE_PATHS.staticValidator.artifactPath),
  }).strict(),
}).strict();
const runArtifactSchema = z.object({
  architecture: z.literal("x86_64"),
  binCodex: binCodexIdentitySchema,
  codexVersionOutput: z.literal("codex-cli 0.145.0"),
  executables: z.object({
    bwrap: executableSchema(executablePaths.bwrap),
    codeModeHost: executableSchema(executablePaths.codeModeHost),
    nativeCodex: executableSchema(executablePaths.nativeCodex),
    rg: executableSchema(executablePaths.rg),
    wrapperCodexJs: executableSchema(executablePaths.wrapperCodexJs),
    zsh: executableSchema(executablePaths.zsh),
  }).strict(),
  installedPackages: z.tuple([
    z.object({
      location: z.literal("node_modules/@openai/codex"),
      name: z.literal("@openai/codex"),
      version: z.literal(EXPECTED_CODEX_VERSION),
    }).strict(),
    z.object({
      location: z.literal("node_modules/@openai/codex-linux-x64"),
      name: z.literal("@openai/codex"),
      version: z.literal("0.145.0-linux-x64"),
    }).strict(),
  ]),
  installedTree: z.object({
    entries: z.array(installedTreeEntrySchema).min(1),
    sha256: sha256Schema,
  }).strict(),
  kind: z.literal("c6-codex-runtime-linux-run"),
  operatingSystem: z.literal("Linux"),
  packageLock: z.object({
    afterSha256: sha256Schema,
    beforeSha256: sha256Schema,
    unchanged: z.literal(true),
  }).strict(),
  packageManifests: packagePayloadIdentitySchema.shape.packageManifests,
  runtime: runtimeIdentitySchema,
  schemaVersion: z.literal(1),
}).strict();
const materializationManifestSchema = z.object({
  dockerAuthority: z.object({
    cliMode: z.number().int().min(0).max(0o777),
    cliPath: z.string().min(1),
    cliSha256: sha256Schema,
    daemonIdentityCryptographicallyAttested: z.literal(false),
    daemonTrustBoundary: z.literal(DOCKER_DAEMON_TRUST_BOUNDARY),
    host: dockerHostSchema,
    serverVersion: z.string().min(1),
  }).strict(),
  image: z.object({
    architecture: z.literal("amd64"),
    id: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    operatingSystem: z.literal("linux"),
    runtime: runtimeIdentitySchema,
    runtimeIdentitySha256: sha256Schema,
  }).strict(),
  inputClosure: z.object({
    captureSha256: sha256Schema,
    linuxTarballSha256: sha256Schema,
    mainTarballSha256: sha256Schema,
    packageJsonSha256: sha256Schema,
    packageLockSha256: sha256Schema,
    version: z.literal(EXPECTED_CODEX_VERSION),
  }).strict(),
  packagePayload: packagePayloadIdentitySchema,
  kind: z.literal("c6-codex-runtime-linux-materialization"),
  reproducibility: z.object({
    byteIdentical: z.literal(true),
    runArtifactSha256: sha256Schema,
  }).strict(),
  runnerSourceSnapshotSha256: sha256Schema,
  runnerSources: runnerSourcesSchema,
  runs: z.tuple([
    artifactReferenceSchema.extend({
      path: z.literal("run-1.json"),
    }).strict(),
    artifactReferenceSchema.extend({
      path: z.literal("run-2.json"),
    }).strict(),
  ]),
  schemaVersion: z.literal(1),
}).strict();
const materializationReceiptSchema = z.object({
  artifacts: z.object({
    assetLock: artifactReferenceSchema.extend({
      assetRootSha256: sha256Schema,
      path: z.literal("artifacts/asset-lock.json"),
    }).strict(),
    manifest: artifactReferenceSchema.extend({
      path: z.literal("artifacts/manifest.json"),
    }).strict(),
    runs: z.tuple([
      artifactReferenceSchema.extend({
        path: z.literal("artifacts/run-1.json"),
      }).strict(),
      artifactReferenceSchema.extend({
        path: z.literal("artifacts/run-2.json"),
      }).strict(),
    ]),
  }).strict(),
  boundary: z.object({
    codexRunReady: z.literal(false),
    persistedLinuxOfflineInstallProven: z.literal(false),
    persistedReceiptValidation: z.literal(
      "frozen-runner-receipt-structure-only",
    ),
  }).strict(),
  dockerAuthority: z.object({
    cliMode: z.number().int().min(0).max(0o777),
    cliPath: z.string().min(1),
    cliSha256: sha256Schema,
    daemonIdentityCryptographicallyAttested: z.literal(false),
    daemonTrustBoundary: z.literal(DOCKER_DAEMON_TRUST_BOUNDARY),
    host: dockerHostSchema,
    serverVersion: z.string().min(1),
  }).strict(),
  inputIdentity: expectedIdentitySchema,
  kind: z.literal("c6-codex-runtime-linux-receipt"),
  materializedExecution: z.discriminatedUnion("commandRunner", [
    z.object({
      commandRunner: z.literal("system-docker"),
      dockerRunCount: z.literal(2),
      liveLinuxOfflineInstallObserved: z.literal(true),
    }).strict(),
    z.object({
      commandRunner: z.literal("injected-command-seam"),
      dockerRunCount: z.literal(2),
      liveLinuxOfflineInstallObserved: z.literal(false),
    }).strict(),
  ]),
  schemaVersion: z.literal(1),
}).strict();
const imageInspectSchema = z.object({
  Architecture: z.literal("amd64"),
  Id: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  Os: z.literal("linux"),
}).passthrough();
const containerInspectSchema = z.object({
  Config: z.object({
    Cmd: z.array(z.string()).nullable().optional(),
    Entrypoint: z.union([
      z.array(z.string()),
      z.string(),
    ]).nullable().optional(),
    Env: z.array(z.string()).nullable().optional(),
    Labels: z.record(z.string(), z.string()).nullable().optional(),
    User: z.string(),
    WorkingDir: z.string(),
  }).passthrough(),
  HostConfig: z.object({
    CapDrop: z.array(z.string()).nullable().optional(),
    NetworkMode: z.string(),
    ReadonlyRootfs: z.boolean(),
    SecurityOpt: z.array(z.string()).nullable().optional(),
    Tmpfs: z.record(z.string(), z.string()).nullable().optional(),
  }).passthrough(),
  Id: z.string().regex(/^[a-f0-9]{64}$/u),
  Image: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  Mounts: z.array(z.object({
    Destination: z.string(),
    RW: z.boolean(),
    Source: z.string(),
    Type: z.string(),
  }).passthrough()),
  Name: z.string(),
  State: z.object({
    ExitCode: z.number().int(),
    Running: z.boolean(),
  }).passthrough().optional(),
}).passthrough();

export interface C6CodexRuntimeLinuxDockerCreateInput {
  containerUser: string;
  dockerCliPath: string;
  expectedImageSha256: string;
  fixtureRoot: string;
  imageReference: string;
  name: string;
  ownershipNonce: string;
  run: 1 | 2;
  tarballRoot: string;
  workRoot: string;
}

export type C6CodexRuntimeLinuxExpectedIdentity = z.infer<
  typeof expectedIdentitySchema
>;
export type C6CodexRuntimeLinuxRuntimeIdentity = z.infer<
  typeof runtimeIdentitySchema
>;
export type C6CodexRuntimeLinuxRunArtifact = z.infer<
  typeof runArtifactSchema
>;

export interface C6CodexRuntimeLinuxMaterializerInput {
  containerUser: string;
  dockerCliPath: string;
  expected: C6CodexRuntimeLinuxExpectedIdentity;
  fixtureRoot: string;
  imageReference: string;
  outputRoot: string;
  runtimeIdentityPath: string;
  tarballRoot: string;
}

export interface C6CodexRuntimeLinuxVerificationInput {
  dockerCliPath: string;
  expected: C6CodexRuntimeLinuxExpectedIdentity;
  expectedReceiptSha256: string;
  fixtureRoot: string;
  outputRoot: string;
  runtimeIdentityPath: string;
  tarballRoot: string;
}

export interface C6CodexRuntimeLinuxCommandInput {
  allowFailure: boolean;
  command: string[];
  environment: Readonly<Record<string, string>>;
  label: string;
  timeoutMs: number;
}

export interface C6CodexRuntimeLinuxCommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export type C6CodexRuntimeLinuxCommandRunner = (
  input: C6CodexRuntimeLinuxCommandInput,
) => Promise<C6CodexRuntimeLinuxCommandResult>;

export interface C6CodexRuntimeLinuxMaterializerDependencies {
  command?: C6CodexRuntimeLinuxCommandRunner;
  nonce?: () => string;
  quiescenceWait?: (milliseconds: number) => Promise<void>;
  testHooks?: {
    artifactWritten?: (path: string) => Promise<void> | void;
    beforePublish?: (outputRoot: string) => Promise<void> | void;
    beforeReceipt?: (outputRoot: string) => Promise<void> | void;
  };
}

export interface C6CodexRuntimeLinuxMaterializerResult {
  codexRunReady: false;
  executionMode: "injected-command-seam" | "system-docker";
  liveLinuxOfflineInstallObserved: boolean;
  manifestPath: string;
  manifestSha256: string;
  outputRoot: string;
  persistedLinuxOfflineInstallProven: false;
  persistedReceiptValidation:
    "frozen-runner-receipt-structure-only";
  receiptPath: string;
  receiptSha256: string;
  runArtifactSha256: string;
}

export interface C6CodexRuntimeLinuxVerification {
  codexRunReady: false;
  linuxOfflineInstallProven: false;
  manifestSha256: string;
  persistedReceiptValidation:
    "frozen-runner-receipt-structure-only";
  receiptSha256: string;
  runArtifactSha256: string;
  runCount: 2;
}

export function buildC6CodexRuntimeLinuxDockerCreateCommand(
  input: C6CodexRuntimeLinuxDockerCreateInput,
): string[] {
  if (
    !sha256Pattern.test(input.expectedImageSha256) ||
    input.imageReference !== `sha256:${input.expectedImageSha256}`
  ) {
    throw new Error("C6 Codex runtime image digest is not pinned");
  }
  if (!/^\d+:\d+$/u.test(input.containerUser)) {
    throw new Error("C6 Codex runtime container user must be numeric uid:gid");
  }
  if (!/^[a-f0-9]{32}$/u.test(input.ownershipNonce)) {
    throw new Error("C6 Codex runtime ownership nonce is invalid");
  }
  if (!/^[a-z0-9][a-z0-9_.-]{0,127}$/u.test(input.name)) {
    throw new Error("C6 Codex runtime container name is invalid");
  }
  if (
    !input.dockerCliPath.startsWith("/") ||
    /[\u0000\n\r]/u.test(input.dockerCliPath)
  ) {
    throw new Error("C6 Codex runtime Docker CLI path is invalid");
  }
  for (const path of [
    input.fixtureRoot,
    input.tarballRoot,
    input.workRoot,
  ]) {
    if (!path.startsWith("/") || /[,\n\r]/u.test(path)) {
      throw new Error("C6 Codex runtime Docker mount path is invalid");
    }
  }
  return [
    input.dockerCliPath,
    "create",
    "--pull=never",
    `--name=${input.name}`,
    `--label=${CONTAINER_NONCE_LABEL}=${input.ownershipNonce}`,
    `--label=${CONTAINER_RUN_LABEL}=${input.run}`,
    `--label=${CONTAINER_WORK_ROOT_LABEL}=${sha256(input.workRoot)}`,
    "--platform=linux/amd64",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--tmpfs=/tmp:rw,nosuid,nodev,size=268435456",
    `--user=${input.containerUser}`,
    "--env=HOME=/work/home",
    "--env=NPM_CONFIG_CACHE=/work/cache",
    "--env=NPM_CONFIG_GLOBALCONFIG=/work/config/global.npmrc",
    "--env=NPM_CONFIG_USERCONFIG=/work/config/user.npmrc",
    "--env=npm_config_update_notifier=false",
    `--env=PATH=${FIXED_PATH}`,
    `--mount=type=bind,src=${input.fixtureRoot},dst=/input/fixture,readonly`,
    `--mount=type=bind,src=${input.tarballRoot},dst=/input/tarballs,readonly`,
    `--mount=type=bind,src=${input.workRoot},dst=/work`,
    "--workdir=/work",
    "--entrypoint=/bin/sh",
    input.imageReference,
    "/work/run.sh",
  ];
}

export function parseC6CodexRuntimeLinuxCreatedContainerId(
  stdout: string,
): string {
  const value = stdout.trim();
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(
      "C6 Codex runtime Docker create must return a full 64-character container id",
    );
  }
  return value;
}

const RUN_SCRIPT = `#!/bin/sh
set -eu
umask 022

test "$(uname -s)" = "Linux"
test "$(uname -m)" = "x86_64"
test ! -e /work/cache
test ! -e /work/home
test ! -e /work/config
test ! -e /work/consumer
test ! -e /work/observed.json

mkdir -p /work/cache /work/home /work/config /work/consumer
: > /work/config/global.npmrc
: > /work/config/user.npmrc
test /work/config/global.npmrc != /work/config/user.npmrc
cp /input/fixture/package.json /work/consumer/package.json
cp /input/fixture/package-lock.json /work/consumer/package-lock.json
cp /work/consumer/package-lock.json /work/package-lock-before.json

${C6_CODEX_RUNTIME_LINUX_NPM_CACHE_ADD_COMMANDS.map((command) =>
  command.join(" ")
).join("\n")}
cd /work/consumer
${C6_CODEX_RUNTIME_LINUX_NPM_CI_COMMAND.join(" ")}
cmp /work/package-lock-before.json /work/consumer/package-lock.json
node /work/observe.mjs
`;

const OBSERVATION_MODULE = `import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, readFile, readdir, readlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const consumerRoot = "/work/consumer";
const nodeModulesRoot = join(consumerRoot, "node_modules");
const executablePaths = ${JSON.stringify(executablePaths)};
const protocol = JSON.parse(await readFile("/work/protocol-input.json", "utf8"));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function fileIdentity(path) {
  const absolute = join(consumerRoot, path);
  const [bytes, stat] = await Promise.all([
    readFile(absolute),
    lstat(absolute),
  ]);
  if (!stat.isFile()) {
    throw new Error("installed identity is not a regular file: " + path);
  }
  return {
    bytes: bytes.byteLength,
    mode: stat.mode & 0o777,
    path,
    sha256: sha256(bytes),
  };
}

function command(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(command + " failed: " + String(result.stderr).trim());
  }
  return String(result.stdout).trim();
}

async function walk(root, directory, entries) {
  const names = (await readdir(directory)).sort();
  for (const name of names) {
    const absolute = join(directory, name);
    const path = relative(root, absolute).split("\\\\").join("/");
    const stat = await lstat(absolute);
    const mode = stat.mode & 0o777;
    if (stat.isDirectory()) {
      entries.push({ mode, path, type: "directory" });
      await walk(root, absolute, entries);
    } else if (stat.isFile()) {
      const bytes = await readFile(absolute);
      entries.push({
        bytes: bytes.byteLength,
        mode,
        path,
        sha256: sha256(bytes),
        type: "file",
      });
    } else if (stat.isSymbolicLink()) {
      entries.push({
        mode,
        path,
        target: await readlink(absolute),
        type: "symlink",
      });
    } else {
      throw new Error("installed tree contains a non-file entry: " + path);
    }
  }
}

const topLevel = (await readdir(nodeModulesRoot)).sort();
if (JSON.stringify(topLevel) !== JSON.stringify([".bin", ".package-lock.json", "@openai"])) {
  throw new Error("unexpected top-level installed package closure");
}
const openaiPackages = (await readdir(join(nodeModulesRoot, "@openai"))).sort();
if (JSON.stringify(openaiPackages) !== JSON.stringify(["codex", "codex-linux-x64"])) {
  throw new Error("installed package closure is not main plus linux-x64 only");
}

const mainPackage = JSON.parse(
  await readFile(join(nodeModulesRoot, "@openai/codex/package.json"), "utf8"),
);
const linuxPackage = JSON.parse(
  await readFile(join(nodeModulesRoot, "@openai/codex-linux-x64/package.json"), "utf8"),
);
if (
  mainPackage.name !== "@openai/codex" ||
  mainPackage.version !== "0.145.0" ||
  linuxPackage.name !== "@openai/codex" ||
  linuxPackage.version !== "0.145.0-linux-x64"
) {
  throw new Error("installed Codex package identity drifted");
}

const before = await readFile("/work/package-lock-before.json");
const after = await readFile(join(consumerRoot, "package-lock.json"));
if (!before.equals(after) || sha256(before) !== protocol.packageLockSha256) {
  throw new Error("package-lock changed during offline install");
}

const codexVersionOutput = command(
  join(nodeModulesRoot, ".bin/codex"),
  ["--version"],
);
const entries = [];
await walk(consumerRoot, nodeModulesRoot, entries);
entries.sort((left, right) =>
  left.path < right.path ? -1 : left.path > right.path ? 1 : 0
);
const executables = Object.fromEntries(
  await Promise.all(Object.entries(executablePaths).map(async ([name, path]) => [
    name,
    await fileIdentity(path),
  ])),
);
if (Object.values(executables).some((entry) => entry.mode !== 0o755)) {
  throw new Error("installed Codex executable mode drifted");
}
const binCodexPath = join(nodeModulesRoot, ".bin/codex");
const binCodexStat = await lstat(binCodexPath);
const binCodexTarget = await readlink(binCodexPath);
if (
  !binCodexStat.isSymbolicLink() ||
  binCodexTarget !== "../@openai/codex/bin/codex.js"
) {
  throw new Error("installed .bin/codex target drifted");
}
const packageManifests = {
  linuxX64: await fileIdentity(
    "node_modules/@openai/codex-linux-x64/package.json",
  ),
  main: await fileIdentity("node_modules/@openai/codex/package.json"),
};
const runtime = {
  bun: {
    executableSha256: sha256(await readFile("/usr/local/bin/bun")),
    version: command("/usr/local/bin/bun", ["--version"]),
  },
  node: {
    executableSha256: sha256(await readFile("/usr/local/bin/node")),
    version: command("/usr/local/bin/node", ["--version"]),
  },
  npm: {
    cliSha256: sha256(
      await readFile("/usr/local/lib/node_modules/npm/bin/npm-cli.js"),
    ),
    launcherSha256: sha256(await readFile("/usr/local/bin/npm")),
    version: command("/usr/local/bin/npm", ["--version"]),
  },
};
const output = {
  architecture: command("uname", ["-m"]),
  binCodex: {
    path: "node_modules/.bin/codex",
    target: binCodexTarget,
    type: "symlink",
  },
  codexVersionOutput,
  executables,
  installedPackages: [{
    location: "node_modules/@openai/codex",
    name: mainPackage.name,
    version: mainPackage.version,
  }, {
    location: "node_modules/@openai/codex-linux-x64",
    name: linuxPackage.name,
    version: linuxPackage.version,
  }],
  installedTree: {
    entries,
    sha256: sha256(JSON.stringify(entries)),
  },
  kind: "c6-codex-runtime-linux-run",
  operatingSystem: command("uname", ["-s"]),
  packageLock: {
    afterSha256: sha256(after),
    beforeSha256: sha256(before),
    unchanged: true,
  },
  packageManifests,
  runtime,
  schemaVersion: 1,
};
await writeFile("/work/observed.json", JSON.stringify(output, null, 2) + "\\n", {
  flag: "wx",
});
`;

interface PreparedInput {
  dockerCli: DockerCliIdentity;
  fixtureRoot: string;
  input: z.infer<typeof materializerInputSchema>;
  packagePayload: z.infer<typeof packagePayloadIdentitySchema>;
  runtime: C6CodexRuntimeLinuxRuntimeIdentity;
  runtimeIdentityPath: string;
  tarballRoot: string;
}

interface DirectoryIdentity {
  dev: number;
  ino: number;
  mode: number;
}

interface DockerCliIdentity {
  mode: number;
  path: string;
  sha256: string;
}

interface DockerCommandAuthority {
  cli: DockerCliIdentity;
  clientRoot: string;
  environment: Readonly<Record<string, string>>;
  host: string;
  live: boolean;
  quiescenceWait: (milliseconds: number) => Promise<void>;
  runner: C6CodexRuntimeLinuxCommandRunner;
}

interface SelectedTarEntry {
  bytes: number;
  content?: Buffer;
  mode: number;
  sha256: string;
}

interface RunnerSourceSnapshot {
  bytes: Buffer;
  name: keyof typeof RUNNER_SOURCE_PATHS;
  reference: z.infer<typeof artifactReferenceSchema>;
}

interface OutputReservation {
  handle: Awaited<ReturnType<typeof open>>;
  lockIdentity: DirectoryIdentity;
  lockPath: string;
  outputIdentity: DirectoryIdentity;
  outputRoot: string;
}

interface ContainerOwnershipExpectation {
  fixtureRoot: string;
  imageId: string;
  name: string;
  nonce: string;
  run: 1 | 2;
  tarballRoot: string;
  user: string;
  workRoot: string;
}

interface ContainerOwnership extends ContainerOwnershipExpectation {
  containerId: string;
}

export async function materializeC6CodexRuntimeLinux(
  rawInput: C6CodexRuntimeLinuxMaterializerInput,
  dependencies: C6CodexRuntimeLinuxMaterializerDependencies = {},
): Promise<C6CodexRuntimeLinuxMaterializerResult> {
  const input = materializerInputSchema.parse(rawInput);
  if (input.imageReference !== `sha256:${input.expected.imageSha256}`) {
    throw new Error("C6 Codex runtime image reference must equal its image id");
  }
  const command = dependencies.command ?? runSystemCommand;
  const nonce = dependencies.nonce ??
    (() => randomBytes(16).toString("hex"));
  const prepared = await prepareInput(input);
  const runnerSources = await snapshotRunnerSources();
  const docker = await createDockerCommandAuthority({
    live: dependencies.command === undefined,
    outputRoot: input.outputRoot,
    prepared,
    quiescenceWait: dependencies.quiescenceWait ?? waitFor,
    runner: command,
  });
  let dockerServerVersion: string;
  try {
    dockerServerVersion = await requireDockerServer(docker);
    await inspectDockerImage(
      input.imageReference,
      input.expected.imageSha256,
      docker,
    );
  } catch (error) {
    await cleanupDockerCommandAuthority(docker);
    throw error;
  }

  let reservation: OutputReservation;
  try {
    reservation = await reserveOutputRoot(input.outputRoot);
  } catch (error) {
    await cleanupDockerCommandAuthority(docker);
    throw error;
  }
  let completed = false;
  try {
    const ownershipNonces = [nonce(), nonce()] as const;
    if (
      ownershipNonces.some((value) =>
        !/^[a-f0-9]{32}$/u.test(value)
      ) ||
      new Set(ownershipNonces).size !== ownershipNonces.length
    ) {
      throw new Error(
        "C6 Codex runtime ownership nonces must be unique lowercase values",
      );
    }
    const runs: Buffer[] = [];
    for (const run of [1, 2] as const) {
      await assertOutputReservation(reservation, `before run ${run}`);
      runs.push(await executeDockerRun({
        docker,
        nonce: ownershipNonces[run - 1],
        prepared,
        run,
      }));
    }
    if (!runs[0].equals(runs[1])) {
      throw new Error(
        "C6 Codex runtime fresh runs are not byte-identical",
      );
    }
    await assertRunnerSourcesUnchanged(runnerSources);
    await inspectDockerImage(
      input.imageReference,
      input.expected.imageSha256,
      docker,
    );
    await validateTerminalInputs(prepared);
    await dependencies.testHooks?.beforePublish?.(
      reservation.outputRoot,
    );
    await assertOutputReservation(reservation, "before publish");

    const artifactsRoot = join(reservation.outputRoot, "artifacts");
    await mkdir(artifactsRoot, { mode: 0o700 });
    const artifactsIdentity = await directoryIdentity(artifactsRoot);
    const runnerSourcesRoot = join(artifactsRoot, "runner-sources");
    await mkdir(runnerSourcesRoot, { mode: 0o700 });
    const firstReference = artifactReference("run-1.json", runs[0]);
    const secondReference = artifactReference("run-2.json", runs[1]);
    await publishArtifact({
      bytes: runs[0],
      dependencies,
      path: join(artifactsRoot, "run-1.json"),
      relativePath: "artifacts/run-1.json",
      reservation,
    });
    await publishArtifact({
      bytes: runs[1],
      dependencies,
      path: join(artifactsRoot, "run-2.json"),
      relativePath: "artifacts/run-2.json",
      reservation,
    });
    for (const source of runnerSources) {
      await publishArtifact({
        bytes: source.bytes,
        dependencies,
        path: join(artifactsRoot, source.reference.path),
        relativePath: `artifacts/${source.reference.path}`,
        reservation,
      });
    }
    const frozenRunnerSources = runnerSourcesSchema.parse(
      Object.fromEntries(runnerSources.map((source) => [
        source.name,
        source.reference,
      ])),
    );

    const manifest = materializationManifestSchema.parse({
      dockerAuthority: dockerAuthorityReceipt(
        docker,
        dockerServerVersion,
      ),
      image: {
        architecture: "amd64",
        id: input.imageReference,
        operatingSystem: "linux",
        runtime: prepared.runtime,
        runtimeIdentitySha256:
          input.expected.runtimeIdentitySha256,
      },
      inputClosure: staticExpected(input.expected),
      kind: "c6-codex-runtime-linux-materialization",
      packagePayload: prepared.packagePayload,
      reproducibility: {
        byteIdentical: true,
        runArtifactSha256: firstReference.sha256,
      },
      runnerSourceSnapshotSha256:
        computeRunnerSourceSnapshotSha256(frozenRunnerSources),
      runnerSources: frozenRunnerSources,
      runs: [firstReference, secondReference],
      schemaVersion: 1,
    });
    const manifestBytes = canonicalJson(manifest);
    await publishArtifact({
      bytes: manifestBytes,
      dependencies,
      path: join(artifactsRoot, "manifest.json"),
      relativePath: "artifacts/manifest.json",
      reservation,
    });
    await assertDirectoryIdentity(
      artifactsRoot,
      artifactsIdentity,
      "Codex runtime artifacts root before asset lock",
    );
    const assetLock = await buildC6AssetLock(artifactsRoot);
    const assetLockBytes = serializeC6AssetLock(assetLock);
    await publishArtifact({
      bytes: assetLockBytes,
      dependencies,
      path: join(artifactsRoot, "asset-lock.json"),
      relativePath: "artifacts/asset-lock.json",
      reservation,
    });
    const loadedLock = await loadC6AssetLock(artifactsRoot);
    if (
      JSON.stringify(loadedLock.assetLock) !== JSON.stringify(assetLock) ||
      loadedLock.assetLockSha256 !== sha256(assetLockBytes)
    ) {
      throw new Error("C6 Codex runtime artifact asset lock drifted");
    }

    await dependencies.testHooks?.beforeReceipt?.(
      reservation.outputRoot,
    );
    await assertOutputReservation(reservation, "before receipt");
    await assertDirectoryIdentity(
      artifactsRoot,
      artifactsIdentity,
      "Codex runtime artifacts root before receipt",
    );
    const receipt = materializationReceiptSchema.parse({
      artifacts: {
        assetLock: {
          ...artifactReference(
            "artifacts/asset-lock.json",
            assetLockBytes,
          ),
          assetRootSha256: assetLock.assetRootSha256,
        },
        manifest: artifactReference(
          "artifacts/manifest.json",
          manifestBytes,
        ),
        runs: [
          artifactReference("artifacts/run-1.json", runs[0]),
          artifactReference("artifacts/run-2.json", runs[1]),
        ],
      },
      boundary: {
        codexRunReady: false,
        persistedLinuxOfflineInstallProven: false,
        persistedReceiptValidation:
          "frozen-runner-receipt-structure-only",
      },
      dockerAuthority: dockerAuthorityReceipt(
        docker,
        dockerServerVersion,
      ),
      inputIdentity: input.expected,
      kind: "c6-codex-runtime-linux-receipt",
      materializedExecution: {
        commandRunner: docker.live
          ? "system-docker"
          : "injected-command-seam",
        dockerRunCount: 2,
        liveLinuxOfflineInstallObserved: docker.live,
      },
      schemaVersion: 1,
    });
    const receiptBytes = canonicalJson(receipt);
    await publishArtifact({
      bytes: receiptBytes,
      dependencies,
      path: join(reservation.outputRoot, "receipt.json"),
      relativePath: "receipt.json",
      reservation,
    });
    await assertOutputReservation(reservation, "after receipt");
    const verified = await verifyC6CodexRuntimeLinuxMaterialization({
      dockerCliPath: prepared.dockerCli.path,
      expected: input.expected,
      expectedReceiptSha256: sha256(receiptBytes),
      fixtureRoot: prepared.fixtureRoot,
      outputRoot: reservation.outputRoot,
      runtimeIdentityPath: prepared.runtimeIdentityPath,
      tarballRoot: prepared.tarballRoot,
    });
    await releaseOutputReservation(reservation);
    await cleanupDockerCommandAuthority(docker);
    completed = true;
    return {
      codexRunReady: false,
      executionMode: docker.live
        ? "system-docker"
        : "injected-command-seam",
      liveLinuxOfflineInstallObserved: docker.live,
      manifestPath: join(artifactsRoot, "manifest.json"),
      manifestSha256: verified.manifestSha256,
      outputRoot: reservation.outputRoot,
      persistedLinuxOfflineInstallProven: false,
      persistedReceiptValidation:
        "frozen-runner-receipt-structure-only",
      receiptPath: join(reservation.outputRoot, "receipt.json"),
      receiptSha256: verified.receiptSha256,
      runArtifactSha256: verified.runArtifactSha256,
    };
  } catch (error) {
    if (!completed) {
      await cleanupFailedReservation(reservation);
      await cleanupDockerCommandAuthority(docker);
    }
    throw error;
  }
}

export async function verifyC6CodexRuntimeLinuxMaterialization(
  rawInput: C6CodexRuntimeLinuxVerificationInput,
): Promise<C6CodexRuntimeLinuxVerification> {
  const expected = expectedIdentitySchema.parse(rawInput.expected);
  if (!sha256Pattern.test(rawInput.expectedReceiptSha256)) {
    throw new Error(
      "C6 Codex runtime expected receipt hash is invalid",
    );
  }
  const prepared = await prepareVerificationInput({
    dockerCliPath: rawInput.dockerCliPath,
    expected,
    fixtureRoot: rawInput.fixtureRoot,
    runtimeIdentityPath: rawInput.runtimeIdentityPath,
    tarballRoot: rawInput.tarballRoot,
  });
  const outputRoot = await canonicalExistingDirectory(
    rawInput.outputRoot,
    "Codex runtime output root",
  );
  await assertRootStructure(outputRoot);
  const artifactsRoot = join(outputRoot, "artifacts");
  const loadedLock = await loadC6AssetLock(artifactsRoot);
  if (
    JSON.stringify(loadedLock.assetLock.files.map((file) => file.path)) !==
      JSON.stringify([
        "manifest.json",
        "run-1.json",
        "run-2.json",
        "runner-sources/c6-asset-lock.ts",
        "runner-sources/c6-codex-runtime-linux.ts",
        "runner-sources/c6-codex-runtime.ts",
        "runner-sources/materialize-codex-coding-effect-c6-codex-runtime-linux.ts",
      ])
  ) {
    throw new Error("C6 Codex runtime artifact closure is not exact");
  }

  const [
    receiptBytes,
    assetLockBytes,
    manifestBytes,
    firstBytes,
    secondBytes,
  ] = await Promise.all([
    readC6StableRegularFile(
      join(outputRoot, "receipt.json"),
      "Codex runtime receipt",
    ),
    readC6StableRegularFile(
      join(artifactsRoot, "asset-lock.json"),
      "Codex runtime artifact asset lock",
    ),
    readC6StableRegularFile(
      join(artifactsRoot, "manifest.json"),
      "Codex runtime materialization manifest",
    ),
    readC6StableRegularFile(
      join(artifactsRoot, "run-1.json"),
      "Codex runtime first run",
    ),
    readC6StableRegularFile(
      join(artifactsRoot, "run-2.json"),
      "Codex runtime second run",
    ),
  ]);
  if (sha256(receiptBytes) !== rawInput.expectedReceiptSha256) {
    throw new Error("C6 Codex runtime receipt hash does not match");
  }
  const receipt = parseCanonicalJson(
    materializationReceiptSchema,
    receiptBytes,
    "C6 Codex runtime receipt",
  );
  const manifest = parseCanonicalJson(
    materializationManifestSchema,
    manifestBytes,
    "C6 Codex runtime manifest",
  );
  const frozenRunnerSourceBytes = await Promise.all(
    Object.values(manifest.runnerSources).map((source) =>
      readC6StableRegularFile(
        join(artifactsRoot, source.path),
        `Codex runtime frozen runner ${source.path}`,
      )
    ),
  );
  Object.values(manifest.runnerSources).forEach((source, index) => {
    assertReference(
      source,
      source.path,
      frozenRunnerSourceBytes[index],
    );
  });
  const first = validateRunArtifact(
    firstBytes,
    expected,
    prepared.packagePayload,
    prepared.runtime,
  );
  const second = validateRunArtifact(
    secondBytes,
    expected,
    prepared.packagePayload,
    prepared.runtime,
  );
  if (!firstBytes.equals(secondBytes) || JSON.stringify(first) !==
    JSON.stringify(second)) {
    throw new Error(
      "C6 Codex runtime persisted runs are not byte-identical",
    );
  }
  assertReference(
    receipt.artifacts.assetLock,
    "artifacts/asset-lock.json",
    assetLockBytes,
  );
  assertReference(
    receipt.artifacts.manifest,
    "artifacts/manifest.json",
    manifestBytes,
  );
  assertReference(
    receipt.artifacts.runs[0],
    "artifacts/run-1.json",
    firstBytes,
  );
  assertReference(
    receipt.artifacts.runs[1],
    "artifacts/run-2.json",
    secondBytes,
  );
  assertReference(manifest.runs[0], "run-1.json", firstBytes);
  assertReference(manifest.runs[1], "run-2.json", secondBytes);
  if (
    receipt.artifacts.assetLock.assetRootSha256 !==
      loadedLock.assetLock.assetRootSha256 ||
    receipt.artifacts.assetLock.sha256 !==
      loadedLock.assetLockSha256 ||
    JSON.stringify(receipt.inputIdentity) !== JSON.stringify(expected) ||
    JSON.stringify(receipt.dockerAuthority) !==
      JSON.stringify(manifest.dockerAuthority) ||
    manifest.dockerAuthority.cliMode !== prepared.dockerCli.mode ||
    manifest.dockerAuthority.cliPath !== prepared.dockerCli.path ||
    manifest.dockerAuthority.cliSha256 !== prepared.dockerCli.sha256 ||
    manifest.dockerAuthority.host !== expected.dockerHost ||
    manifest.image.id !== `sha256:${expected.imageSha256}` ||
    manifest.image.runtimeIdentitySha256 !==
      expected.runtimeIdentitySha256 ||
    JSON.stringify(manifest.image.runtime) !==
      JSON.stringify(prepared.runtime) ||
    JSON.stringify(manifest.inputClosure) !==
      JSON.stringify(staticExpected(expected)) ||
    JSON.stringify(manifest.packagePayload) !==
      JSON.stringify(prepared.packagePayload) ||
    manifest.runnerSourceSnapshotSha256 !==
      computeRunnerSourceSnapshotSha256(manifest.runnerSources) ||
    manifest.reproducibility.runArtifactSha256 !== sha256(firstBytes)
  ) {
    throw new Error("C6 Codex runtime persisted identity drifted");
  }

  await validateTerminalInputs({
    dockerCli: prepared.dockerCli,
    fixtureRoot: prepared.fixtureRoot,
    input: {
      containerUser: "0:0",
      dockerCliPath: prepared.dockerCli.path,
      expected,
      fixtureRoot: prepared.fixtureRoot,
      imageReference: `sha256:${expected.imageSha256}`,
      outputRoot,
      runtimeIdentityPath: prepared.runtimeIdentityPath,
      tarballRoot: prepared.tarballRoot,
    },
    packagePayload: prepared.packagePayload,
    runtime: prepared.runtime,
    runtimeIdentityPath: prepared.runtimeIdentityPath,
    tarballRoot: prepared.tarballRoot,
  });
  const terminalLock = await loadC6AssetLock(artifactsRoot);
  const terminalReceipt = await readC6StableRegularFile(
    join(outputRoot, "receipt.json"),
    "Codex runtime terminal receipt",
  );
  if (
    JSON.stringify(terminalLock) !== JSON.stringify(loadedLock) ||
    !terminalReceipt.equals(receiptBytes)
  ) {
    throw new Error(
      "C6 Codex runtime persisted closure changed during verification",
    );
  }
  return {
    codexRunReady: false,
    linuxOfflineInstallProven: false,
    manifestSha256: sha256(manifestBytes),
    persistedReceiptValidation:
      "frozen-runner-receipt-structure-only",
    receiptSha256: sha256(receiptBytes),
    runArtifactSha256: sha256(firstBytes),
    runCount: 2,
  };
}

async function prepareInput(
  input: z.infer<typeof materializerInputSchema>,
): Promise<PreparedInput> {
  const prepared = await prepareVerificationInput({
    dockerCliPath: input.dockerCliPath,
    expected: input.expected,
    fixtureRoot: input.fixtureRoot,
    runtimeIdentityPath: input.runtimeIdentityPath,
    tarballRoot: input.tarballRoot,
  });
  return { input, ...prepared };
}

async function prepareVerificationInput(input: {
  dockerCliPath: string;
  expected: C6CodexRuntimeLinuxExpectedIdentity;
  fixtureRoot: string;
  runtimeIdentityPath: string;
  tarballRoot: string;
}): Promise<Omit<PreparedInput, "input">> {
  const [
    dockerCli,
    fixtureRoot,
    tarballRoot,
    runtimeIdentityPath,
  ] = await Promise.all([
    inspectDockerCliIdentity(
      input.dockerCliPath,
      input.expected.dockerCliSha256,
    ),
    canonicalExistingDirectory(
      input.fixtureRoot,
      "Codex runtime fixture root",
    ),
    canonicalExistingDirectory(
      input.tarballRoot,
      "Codex runtime tarball root",
    ),
    canonicalExistingFile(
      input.runtimeIdentityPath,
      "Codex runtime identity",
    ),
  ]);
  const runtimeBytes = await readC6StableRegularFile(
    runtimeIdentityPath,
    "Codex runtime identity",
  );
  if (sha256(runtimeBytes) !== input.expected.runtimeIdentitySha256) {
    throw new Error("C6 Codex runtime identity hash drifted");
  }
  const runtime = parseCanonicalJson(
    runtimeIdentitySchema,
    runtimeBytes,
    "C6 Codex runtime identity",
  );
  await validateC6CodexRuntimeStaticClosure({
    expected: staticExpected(input.expected),
    fixtureRoot,
    tarballRoot,
  });
  const packagePayload =
    await inspectC6CodexRuntimePackagePayload(tarballRoot);
  return {
    dockerCli,
    fixtureRoot,
    packagePayload,
    runtime,
    runtimeIdentityPath,
    tarballRoot,
  };
}

async function validateTerminalInputs(input: PreparedInput): Promise<void> {
  const [dockerCli, runtimeBytes] = await Promise.all([
    inspectDockerCliIdentity(
      input.dockerCli.path,
      input.input.expected.dockerCliSha256,
    ),
    readC6StableRegularFile(
      input.runtimeIdentityPath,
      "Codex runtime terminal identity",
    ),
    validateC6CodexRuntimeStaticClosure({
      expected: staticExpected(input.input.expected),
      fixtureRoot: input.fixtureRoot,
      tarballRoot: input.tarballRoot,
    }),
  ]);
  if (
    sha256(runtimeBytes) !==
      input.input.expected.runtimeIdentitySha256 ||
    JSON.stringify(dockerCli) !== JSON.stringify(input.dockerCli) ||
    JSON.stringify(parseCanonicalJson(
      runtimeIdentitySchema,
      runtimeBytes,
      "C6 Codex runtime terminal identity",
    )) !== JSON.stringify(input.runtime)
  ) {
    throw new Error("C6 Codex runtime inputs changed during execution");
  }
}

function staticExpected(
  expected: C6CodexRuntimeLinuxExpectedIdentity,
) {
  return {
    captureSha256: expected.captureSha256,
    linuxTarballSha256: expected.linuxTarballSha256,
    mainTarballSha256: expected.mainTarballSha256,
    packageJsonSha256: expected.packageJsonSha256,
    packageLockSha256: expected.packageLockSha256,
    version: expected.version,
  };
}

export async function inspectC6CodexRuntimePackagePayload(
  tarballRoot: string,
): Promise<z.infer<typeof packagePayloadIdentitySchema>> {
  const canonicalTarballRoot = await canonicalExistingDirectory(
    tarballRoot,
    "Codex runtime tarball root",
  );
  const mainTargets = [
    "package/bin/codex.js",
    "package/package.json",
  ] as const;
  const linuxTargets = [
    "package/package.json",
    "package/vendor/x86_64-unknown-linux-musl/bin/codex",
    "package/vendor/x86_64-unknown-linux-musl/bin/codex-code-mode-host",
    "package/vendor/x86_64-unknown-linux-musl/codex-path/rg",
    "package/vendor/x86_64-unknown-linux-musl/codex-resources/bwrap",
    "package/vendor/x86_64-unknown-linux-musl/codex-resources/zsh/bin/zsh",
  ] as const;
  const [main, linux] = await Promise.all([
    readSelectedTarEntries(
      join(canonicalTarballRoot, "openai-codex-0.145.0.tgz"),
      mainTargets,
      new Set(["package/package.json"]),
    ),
    readSelectedTarEntries(
      join(
        canonicalTarballRoot,
        "openai-codex-0.145.0-linux-x64.tgz",
      ),
      linuxTargets,
      new Set(["package/package.json"]),
    ),
  ]);
  const mainManifest = parsePackageManifest(
    requiredTarEntry(main, "package/package.json"),
    "0.145.0",
  );
  parsePackageManifest(
    requiredTarEntry(linux, "package/package.json"),
    "0.145.0-linux-x64",
  );
  if (
    mainManifest.bin?.codex !== "bin/codex.js" ||
    Object.keys(mainManifest.bin).length !== 1
  ) {
    throw new Error("C6 Codex runtime main package bin target drifted");
  }
  const identity = packagePayloadIdentitySchema.parse({
    binCodex: {
      path: "node_modules/.bin/codex",
      target: `../@openai/codex/${mainManifest.bin.codex}`,
      type: "symlink",
    },
    executables: {
      bwrap: installedTarIdentity(
        requiredTarEntry(
          linux,
          "package/vendor/x86_64-unknown-linux-musl/codex-resources/bwrap",
        ),
        executablePaths.bwrap,
      ),
      codeModeHost: installedTarIdentity(
        requiredTarEntry(
          linux,
          "package/vendor/x86_64-unknown-linux-musl/bin/codex-code-mode-host",
        ),
        executablePaths.codeModeHost,
      ),
      nativeCodex: installedTarIdentity(
        requiredTarEntry(
          linux,
          "package/vendor/x86_64-unknown-linux-musl/bin/codex",
        ),
        executablePaths.nativeCodex,
      ),
      rg: installedTarIdentity(
        requiredTarEntry(
          linux,
          "package/vendor/x86_64-unknown-linux-musl/codex-path/rg",
        ),
        executablePaths.rg,
      ),
      wrapperCodexJs: installedTarIdentity(
        requiredTarEntry(main, "package/bin/codex.js"),
        executablePaths.wrapperCodexJs,
      ),
      zsh: installedTarIdentity(
        requiredTarEntry(
          linux,
          "package/vendor/x86_64-unknown-linux-musl/codex-resources/zsh/bin/zsh",
        ),
        executablePaths.zsh,
      ),
    },
    packageManifests: {
      linuxX64: installedTarIdentity(
        requiredTarEntry(linux, "package/package.json"),
        packageManifestPaths.linuxX64,
      ),
      main: installedTarIdentity(
        requiredTarEntry(main, "package/package.json"),
        packageManifestPaths.main,
      ),
    },
  });
  if (
    Object.values(identity.executables).some((file) =>
      file.mode !== 0o755
    )
  ) {
    throw new Error(
      "C6 Codex runtime tarball executables must all be mode 0755",
    );
  }
  return identity;
}

function parsePackageManifest(
  entry: SelectedTarEntry,
  version: "0.145.0" | "0.145.0-linux-x64",
): {
  bin?: Record<string, string>;
  name: "@openai/codex";
  version: string;
} {
  if (entry.content === undefined) {
    throw new Error("C6 Codex runtime package manifest bytes are missing");
  }
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(entry.content),
    ) as unknown;
  } catch {
    throw new Error("C6 Codex runtime package manifest is invalid JSON");
  }
  return z.object({
    bin: z.record(z.string(), z.string()).optional(),
    name: z.literal("@openai/codex"),
    version: z.literal(version),
  }).passthrough().parse(value);
}

function installedTarIdentity(
  entry: SelectedTarEntry,
  path: string,
) {
  return {
    bytes: entry.bytes,
    mode: entry.mode,
    path,
    sha256: entry.sha256,
  };
}

function requiredTarEntry(
  entries: ReadonlyMap<string, SelectedTarEntry>,
  path: string,
): SelectedTarEntry {
  const entry = entries.get(path);
  if (entry === undefined) {
    throw new Error(`C6 Codex runtime tarball is missing ${path}`);
  }
  return entry;
}

async function readSelectedTarEntries(
  path: string,
  targets: readonly string[],
  capturedTargets: ReadonlySet<string>,
): Promise<Map<string, SelectedTarEntry>> {
  const compressed = await readC6StableRegularFile(
    path,
    "Codex runtime package tarball payload",
  );
  const selected = new Map<string, SelectedTarEntry>();
  let pending = Buffer.alloc(0);
  let ended = false;
  let active: {
    capture: boolean;
    chunks: Buffer[];
    hash?: ReturnType<typeof createHash>;
    mode: number;
    padding: number;
    path: string;
    remaining: number;
    selected: boolean;
    size: number;
  } | undefined;
  const targetSet = new Set(targets);
  const stream = Readable.from([compressed]).pipe(createGunzip());
  for await (const rawChunk of stream) {
    if (ended) {
      continue;
    }
    const chunk = Buffer.isBuffer(rawChunk)
      ? rawChunk
      : Buffer.from(rawChunk);
    pending = pending.byteLength === 0
      ? chunk
      : Buffer.concat([pending, chunk]);
    while (!ended) {
      if (active === undefined) {
        if (pending.byteLength < 512) {
          break;
        }
        const header = pending.subarray(0, 512);
        pending = pending.subarray(512);
        if (header.every((byte) => byte === 0)) {
          ended = true;
          break;
        }
        const tarPath = tarHeaderPath(header);
        const size = tarOctal(header, 124, 12, "size");
        const mode = tarOctal(header, 100, 8, "mode") & 0o777;
        assertTarChecksum(header);
        const type = header[156];
        const isSelected = targetSet.has(tarPath);
        if (isSelected && type !== 0 && type !== 48) {
          throw new Error(
            `C6 Codex runtime tarball target is not regular ${tarPath}`,
          );
        }
        active = {
          capture: isSelected && capturedTargets.has(tarPath),
          chunks: [],
          hash: isSelected ? createHash("sha256") : undefined,
          mode,
          padding: (512 - (size % 512)) % 512,
          path: tarPath,
          remaining: size,
          selected: isSelected,
          size,
        };
      }
      if (active.remaining > 0) {
        if (pending.byteLength === 0) {
          break;
        }
        const length = Math.min(active.remaining, pending.byteLength);
        const bytes = pending.subarray(0, length);
        pending = pending.subarray(length);
        active.hash?.update(bytes);
        if (active.capture) {
          active.chunks.push(Buffer.from(bytes));
        }
        active.remaining -= length;
        continue;
      }
      if (active.padding > 0) {
        if (pending.byteLength === 0) {
          break;
        }
        const length = Math.min(active.padding, pending.byteLength);
        pending = pending.subarray(length);
        active.padding -= length;
        continue;
      }
      if (active.selected) {
        if (selected.has(active.path)) {
          throw new Error(
            `C6 Codex runtime tarball repeats ${active.path}`,
          );
        }
        selected.set(active.path, {
          bytes: active.size,
          content: active.capture
            ? Buffer.concat(active.chunks)
            : undefined,
          mode: active.mode,
          sha256: active.hash!.digest("hex"),
        });
      }
      active = undefined;
    }
  }
  if (
    !ended ||
    active !== undefined ||
    selected.size !== targetSet.size
  ) {
    throw new Error("C6 Codex runtime tarball payload closure is incomplete");
  }
  return selected;
}

function tarHeaderPath(header: Buffer): string {
  const name = tarString(header, 0, 100);
  const prefix = tarString(header, 345, 155);
  const path = prefix.length === 0 ? name : `${prefix}/${name}`;
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.split("/").includes("..")
  ) {
    throw new Error("C6 Codex runtime tarball path is unsafe");
  }
  return path;
}

function tarString(
  header: Buffer,
  offset: number,
  length: number,
): string {
  const field = header.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? field.length : end)
    .toString("utf8");
}

function tarOctal(
  header: Buffer,
  offset: number,
  length: number,
  label: string,
): number {
  const value = tarString(header, offset, length).trim();
  if (!/^[0-7]+$/u.test(value)) {
    throw new Error(`C6 Codex runtime tarball ${label} is invalid`);
  }
  return Number.parseInt(value, 8);
}

function assertTarChecksum(header: Buffer): void {
  const expected = tarOctal(header, 148, 8, "checksum");
  let actual = 0;
  for (const [index, byte] of header.entries()) {
    actual += index >= 148 && index < 156 ? 32 : byte;
  }
  if (actual !== expected) {
    throw new Error("C6 Codex runtime tarball checksum is invalid");
  }
}

async function snapshotRunnerSources(): Promise<RunnerSourceSnapshot[]> {
  return Promise.all(RUNNER_SOURCE_NAMES.map(async (name) => {
    const source = RUNNER_SOURCE_PATHS[name];
    const bytes = await readC6StableRegularFile(
      source.livePath,
      `Codex runtime ${name} runner source`,
    );
    return {
      bytes,
      name,
      reference: artifactReference(source.artifactPath, bytes),
    };
  }));
}

async function assertRunnerSourcesUnchanged(
  expected: readonly RunnerSourceSnapshot[],
): Promise<void> {
  for (const source of expected) {
    const current = await readC6StableRegularFile(
      RUNNER_SOURCE_PATHS[source.name].livePath,
      `Codex runtime terminal ${source.name} runner source`,
    );
    if (!current.equals(source.bytes)) {
      throw new Error(
        `C6 Codex runtime ${source.name} runner source changed during execution`,
      );
    }
  }
}

function computeRunnerSourceSnapshotSha256(
  sources: z.infer<typeof runnerSourcesSchema>,
): string {
  return sha256(JSON.stringify(sources));
}

async function createDockerCommandAuthority(input: {
  live: boolean;
  outputRoot: string;
  prepared: PreparedInput;
  quiescenceWait: (milliseconds: number) => Promise<void>;
  runner: C6CodexRuntimeLinuxCommandRunner;
}): Promise<DockerCommandAuthority> {
  const parent = await canonicalExistingDirectory(
    dirname(resolve(input.outputRoot)),
    "Codex runtime output parent",
  );
  const clientRoot = await realpath(await mkdtemp(join(
    parent,
    ".c6-codex-docker-client-",
  )));
  try {
    const configRoot = join(clientRoot, "config");
    const homeRoot = join(clientRoot, "home");
    await Promise.all([
      mkdir(configRoot, { mode: 0o500 }),
      mkdir(homeRoot, { mode: 0o500 }),
    ]);
    return {
      cli: input.prepared.dockerCli,
      clientRoot,
      environment: Object.freeze({
        DOCKER_CONFIG: configRoot,
        DOCKER_HOST: input.prepared.input.expected.dockerHost,
        HOME: homeRoot,
        LANG: "C",
        LC_ALL: "C",
        PATH: DOCKER_CLIENT_PATH,
      }),
      host: input.prepared.input.expected.dockerHost,
      live: input.live,
      quiescenceWait: input.quiescenceWait,
      runner: input.runner,
    };
  } catch (error) {
    await rm(clientRoot, { force: true, recursive: true });
    throw error;
  }
}

async function cleanupDockerCommandAuthority(
  docker: DockerCommandAuthority,
): Promise<void> {
  await rm(docker.clientRoot, { force: true, recursive: true });
}

function dockerAuthorityReceipt(
  docker: DockerCommandAuthority,
  serverVersion: string,
) {
  return {
    cliMode: docker.cli.mode,
    cliPath: docker.cli.path,
    cliSha256: docker.cli.sha256,
    daemonIdentityCryptographicallyAttested: false as const,
    daemonTrustBoundary: DOCKER_DAEMON_TRUST_BOUNDARY,
    host: docker.host,
    serverVersion,
  };
}

async function executeDockerRun(input: {
  docker: DockerCommandAuthority;
  nonce: string;
  prepared: PreparedInput;
  run: 1 | 2;
}): Promise<Buffer> {
  if (!/^[a-f0-9]{32}$/u.test(input.nonce)) {
    throw new Error("C6 Codex runtime generated an invalid ownership nonce");
  }
  const parent = dirname(input.prepared.input.outputRoot);
  const workRoot = await realpath(await mkdtemp(join(
    parent,
    `.c6-codex-runtime-run-${input.run}-`,
  )));
  try {
    await Promise.all([
      writeFile(join(workRoot, "run.sh"), RUN_SCRIPT, {
        flag: "wx",
        mode: 0o755,
      }),
      writeFile(
        join(workRoot, "observe.mjs"),
        OBSERVATION_MODULE,
        { flag: "wx", mode: 0o644 },
      ),
      writeFile(
        join(workRoot, "protocol-input.json"),
        canonicalJson({
          packageLockSha256:
            input.prepared.input.expected.packageLockSha256,
        }),
        { flag: "wx", mode: 0o644 },
      ),
    ]);
    const name =
      `goodmemory-c6-codex-runtime-${input.nonce}-run-${input.run}`;
    const createCommand =
      buildC6CodexRuntimeLinuxDockerCreateCommand({
        containerUser: input.prepared.input.containerUser,
        dockerCliPath: input.docker.cli.path,
        expectedImageSha256:
          input.prepared.input.expected.imageSha256,
        fixtureRoot: input.prepared.fixtureRoot,
        imageReference: input.prepared.input.imageReference,
        name,
        ownershipNonce: input.nonce,
        run: input.run,
        tarballRoot: input.prepared.tarballRoot,
        workRoot,
      });
    const ownershipExpectation: ContainerOwnershipExpectation = {
      fixtureRoot: input.prepared.fixtureRoot,
      imageId:
        `sha256:${input.prepared.input.expected.imageSha256}`,
      name,
      nonce: input.nonce,
      run: input.run,
      tarballRoot: input.prepared.tarballRoot,
      user: input.prepared.input.containerUser,
      workRoot,
    };
    let created: C6CodexRuntimeLinuxCommandResult;
    try {
      created = await input.docker.runner({
        allowFailure: true,
        command: createCommand,
        environment: input.docker.environment,
        label: `Codex runtime Docker create run ${input.run}`,
        timeoutMs: COMMAND_TIMEOUT_MS,
      });
    } catch (error) {
      await cleanupUncertainDockerCreate(
        ownershipExpectation,
        input.docker,
      );
      throw error;
    }
    if (created.exitCode !== 0) {
      await cleanupUncertainDockerCreate(
        ownershipExpectation,
        input.docker,
      );
      throw commandError(
        `C6 Codex runtime Docker create run ${input.run}`,
        created,
      );
    }
    let containerId: string;
    try {
      containerId = parseC6CodexRuntimeLinuxCreatedContainerId(
        created.stdout,
      );
    } catch (error) {
      await cleanupUncertainDockerCreate(
        ownershipExpectation,
        input.docker,
      );
      throw error;
    }
    const ownership: ContainerOwnership = {
      containerId,
      ...ownershipExpectation,
    };
    try {
      const before = await inspectDockerContainer(
        containerId,
        input.docker,
        `Codex runtime Docker pre-start inspect run ${input.run}`,
      );
      assertContainerIsolation(before, ownership, false);
      const started = await input.docker.runner({
        allowFailure: true,
        command: [
          input.docker.cli.path,
          "start",
          "--attach",
          containerId,
        ],
        environment: input.docker.environment,
        label: `Codex runtime Docker start run ${input.run}`,
        timeoutMs: RUN_TIMEOUT_MS,
      });
      if (started.exitCode !== 0) {
        throw commandError(
          `C6 Codex runtime Docker start run ${input.run}`,
          started,
        );
      }
      const after = await inspectDockerContainer(
        containerId,
        input.docker,
        `Codex runtime Docker post-run inspect ${input.run}`,
      );
      assertContainerIsolation(after, ownership, true);
    } finally {
      await removeDockerContainer(ownership, input.docker);
    }
    const observedBytes = await readC6StableRegularFile(
      join(workRoot, "observed.json"),
      `Codex runtime observed run ${input.run}`,
    );
    validateRunArtifact(
      observedBytes,
      input.prepared.input.expected,
      input.prepared.packagePayload,
      input.prepared.runtime,
    );
    return observedBytes;
  } finally {
    await rm(workRoot, { force: true, recursive: true });
  }
}

async function requireDockerServer(
  docker: DockerCommandAuthority,
): Promise<string> {
  const result = await docker.runner({
    allowFailure: true,
    command: [
      docker.cli.path,
      "version",
      "--format",
      "{{.Server.Version}}",
    ],
    environment: docker.environment,
    label: "Codex runtime Docker daemon probe",
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
    throw commandError(
      "C6 Codex runtime Docker daemon is unavailable",
      result,
    );
  }
  return result.stdout.trim();
}

async function inspectDockerImage(
  imageReference: string,
  expectedImageSha256: string,
  docker: DockerCommandAuthority,
): Promise<void> {
  const result = await docker.runner({
    allowFailure: true,
    command: [
      docker.cli.path,
      "image",
      "inspect",
      imageReference,
    ],
    environment: docker.environment,
    label: "Codex runtime Docker image inspect",
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) {
    throw commandError(
      "C6 Codex runtime pinned image is unavailable",
      result,
    );
  }
  const image = z.array(imageInspectSchema).length(1).parse(
    parseJsonText(result.stdout, "C6 Codex runtime image inspect"),
  )[0];
  if (image.Id !== `sha256:${expectedImageSha256}`) {
    throw new Error(
      "C6 Codex runtime image inspect does not match the pinned id",
    );
  }
}

async function inspectDockerContainer(
  containerId: string,
  docker: DockerCommandAuthority,
  label: string,
): Promise<z.infer<typeof containerInspectSchema>> {
  const result = await docker.runner({
    allowFailure: true,
    command: [docker.cli.path, "inspect", containerId],
    environment: docker.environment,
    label,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) {
    throw commandError(`C6 ${label} failed`, result);
  }
  return z.array(containerInspectSchema).length(1).parse(
    parseJsonText(result.stdout, label),
  )[0];
}

function assertContainerIsolation(
  container: z.infer<typeof containerInspectSchema>,
  ownership: ContainerOwnership,
  requireCompleted: boolean,
): void {
  assertContainerOwnership(container, ownership);
  const securityOptions = container.HostConfig.SecurityOpt ?? [];
  const tmpfs = container.HostConfig.Tmpfs?.["/tmp"] ?? "";
  if (
    container.HostConfig.NetworkMode !== "none" ||
    !container.HostConfig.ReadonlyRootfs ||
    !container.HostConfig.CapDrop?.includes("ALL") ||
    !securityOptions.some((value) =>
      value === "no-new-privileges" ||
      value === "no-new-privileges:true"
    ) ||
    !tmpfs.includes("nosuid") ||
    !tmpfs.includes("nodev") ||
    !tmpfs.includes("268435456") ||
    (
      requireCompleted &&
      (
        container.State?.Running !== false ||
        container.State.ExitCode !== 0
      )
    )
  ) {
    throw new Error("C6 Codex runtime Docker security inspect failed");
  }
  const expectedMounts = [{
    Destination: "/input/fixture",
    RW: false,
    Source: ownership.fixtureRoot,
    Type: "bind",
  }, {
    Destination: "/input/tarballs",
    RW: false,
    Source: ownership.tarballRoot,
    Type: "bind",
  }, {
    Destination: "/work",
    RW: true,
    Source: ownership.workRoot,
    Type: "bind",
  }];
  const mounts = container.Mounts.map((mount) => ({
    Destination: mount.Destination,
    RW: mount.RW,
    Source: mount.Source,
    Type: mount.Type,
  })).sort((left, right) =>
    left.Destination.localeCompare(right.Destination)
  );
  expectedMounts.sort((left, right) =>
    left.Destination.localeCompare(right.Destination)
  );
  if (JSON.stringify(mounts) !== JSON.stringify(expectedMounts)) {
    throw new Error("C6 Codex runtime Docker mount inspect failed");
  }
  const environment = new Map<string, string>();
  for (const entry of container.Config.Env ?? []) {
    const separator = entry.indexOf("=");
    const key = separator < 0 ? entry : entry.slice(0, separator);
    if (environment.has(key)) {
      throw new Error(
        "C6 Codex runtime Docker environment contains duplicates",
      );
    }
    environment.set(
      key,
      separator < 0 ? "" : entry.slice(separator + 1),
    );
  }
  if (
    [...environment.keys()].some((key) =>
      !ALLOWED_ENVIRONMENT_KEYS.has(key)
    ) ||
    environment.get("HOME") !== "/work/home" ||
    environment.get("NPM_CONFIG_CACHE") !== "/work/cache" ||
    environment.get("NPM_CONFIG_GLOBALCONFIG") !==
      "/work/config/global.npmrc" ||
    environment.get("NPM_CONFIG_USERCONFIG") !==
      "/work/config/user.npmrc" ||
    environment.get("npm_config_update_notifier") !== "false" ||
    environment.get("PATH") !== FIXED_PATH
  ) {
    throw new Error(
      "C6 Codex runtime Docker environment inspect failed",
    );
  }
}

function assertContainerOwnership(
  container: z.infer<typeof containerInspectSchema>,
  ownership: ContainerOwnership,
): void {
  const labels = container.Config.Labels ?? {};
  const entrypoint = typeof container.Config.Entrypoint === "string"
    ? [container.Config.Entrypoint]
    : container.Config.Entrypoint ?? [];
  if (
    container.Id !== ownership.containerId ||
    container.Name !== `/${ownership.name}` ||
    labels[CONTAINER_NONCE_LABEL] !== ownership.nonce ||
    labels[CONTAINER_RUN_LABEL] !== String(ownership.run) ||
    labels[CONTAINER_WORK_ROOT_LABEL] !==
      sha256(ownership.workRoot) ||
    container.Image !== ownership.imageId ||
    container.Config.User !== ownership.user ||
    container.Config.WorkingDir !== "/work" ||
    JSON.stringify(entrypoint) !== JSON.stringify(["/bin/sh"]) ||
    JSON.stringify(container.Config.Cmd) !==
      JSON.stringify(["/work/run.sh"])
  ) {
    throw new Error("C6 Codex runtime Docker ownership inspect failed");
  }
}

async function cleanupUncertainDockerCreate(
  ownership: ContainerOwnershipExpectation,
  docker: DockerCommandAuthority,
): Promise<void> {
  let consecutiveEmptyQueries = 0;
  for (
    let query = 1;
    query <= UNCERTAIN_CREATE_MAX_DISCOVERY_QUERIES;
    query += 1
  ) {
    const discovered = await docker.runner({
      allowFailure: true,
      command: [
        docker.cli.path,
        "ps",
        "--all",
        "--quiet",
        "--no-trunc",
        `--filter=label=${CONTAINER_NONCE_LABEL}=${ownership.nonce}`,
        `--filter=label=${CONTAINER_RUN_LABEL}=${ownership.run}`,
        `--filter=label=${CONTAINER_WORK_ROOT_LABEL}=${
          sha256(ownership.workRoot)
        }`,
      ],
      environment: docker.environment,
      label: "Codex runtime uncertain Docker create discovery",
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    if (discovered.exitCode !== 0) {
      throw commandError(
        "C6 Codex runtime uncertain Docker create discovery failed",
        discovered,
      );
    }
    const output = discovered.stdout.trim();
    if (output.length === 0) {
      consecutiveEmptyQueries += 1;
      if (
        consecutiveEmptyQueries ===
          UNCERTAIN_CREATE_EMPTY_CONFIRMATIONS
      ) {
        return;
      }
    } else {
      consecutiveEmptyQueries = 0;
      const containerIds = output.split(/\r?\n/u);
      if (
        new Set(containerIds).size !== containerIds.length ||
        containerIds.some((id) => !/^[a-f0-9]{64}$/u.test(id))
      ) {
        throw new Error(
          "C6 Codex runtime uncertain Docker create discovery returned an invalid id",
        );
      }
      for (const containerId of containerIds) {
        await removeDockerContainer({
          containerId,
          ...ownership,
        }, docker);
      }
    }
    if (query < UNCERTAIN_CREATE_MAX_DISCOVERY_QUERIES) {
      await docker.quiescenceWait(
        UNCERTAIN_CREATE_DISCOVERY_INTERVAL_MS,
      );
    }
  }
  throw new Error(
    "C6 Codex runtime uncertain Docker create did not reach quiescence",
  );
}

async function removeDockerContainer(
  ownership: ContainerOwnership,
  docker: DockerCommandAuthority,
): Promise<void> {
  if (!/^[a-f0-9]{64}$/u.test(ownership.containerId)) {
    throw new Error(
      "C6 Codex runtime cleanup requires a full container id",
    );
  }
  const inspected = await inspectDockerContainer(
    ownership.containerId,
    docker,
    "Codex runtime Docker cleanup inspect",
  );
  assertContainerOwnership(inspected, ownership);
  const removed = await docker.runner({
    allowFailure: true,
    command: [
      docker.cli.path,
      "rm",
      "--force",
      ownership.containerId,
    ],
    environment: docker.environment,
    label: "Codex runtime Docker cleanup",
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  if (removed.exitCode !== 0) {
    throw commandError("C6 Codex runtime Docker cleanup failed", removed);
  }
  const terminal = await docker.runner({
    allowFailure: true,
    command: [
      docker.cli.path,
      "inspect",
      ownership.containerId,
    ],
    environment: docker.environment,
    label: "Codex runtime Docker cleanup verification",
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  if (
    terminal.exitCode === 0 ||
    !/No such (?:object|container)/iu.test(terminal.stderr)
  ) {
    throw new Error(
      "C6 Codex runtime Docker cleanup did not prove removal",
    );
  }
}

function validateRunArtifact(
  bytes: Buffer,
  expected: C6CodexRuntimeLinuxExpectedIdentity,
  packagePayload: z.infer<typeof packagePayloadIdentitySchema>,
  runtime: C6CodexRuntimeLinuxRuntimeIdentity,
): C6CodexRuntimeLinuxRunArtifact {
  const artifact = parseCanonicalJson(
    runArtifactSchema,
    bytes,
    "C6 Codex runtime run artifact",
  );
  if (
    artifact.packageLock.beforeSha256 !== expected.packageLockSha256 ||
    artifact.packageLock.afterSha256 !== expected.packageLockSha256 ||
    JSON.stringify(artifact.runtime) !== JSON.stringify(runtime) ||
    artifact.installedTree.sha256 !==
      sha256(JSON.stringify(artifact.installedTree.entries))
  ) {
    throw new Error(
      "C6 Codex runtime run artifact identity drifted",
    );
  }
  if (
    JSON.stringify({
      binCodex: artifact.binCodex,
      executables: artifact.executables,
      packageManifests: artifact.packageManifests,
    }) !== JSON.stringify(packagePayload)
  ) {
    throw new Error(
      "C6 Codex runtime tarball-derived package payload identity drifted",
    );
  }
  const paths = artifact.installedTree.entries.map((entry) => entry.path);
  if (
    new Set(paths).size !== paths.length ||
    JSON.stringify(paths) !== JSON.stringify([...paths].sort())
  ) {
    throw new Error(
      "C6 Codex runtime installed-tree manifest is not canonical",
    );
  }
  for (const executable of Object.values(artifact.executables)) {
    const entry = artifact.installedTree.entries.find(
      (candidate) => candidate.path === executable.path,
    );
    if (
      entry?.type !== "file" ||
      entry.bytes !== executable.bytes ||
      entry.mode !== executable.mode ||
      entry.sha256 !== executable.sha256
    ) {
      throw new Error(
        "C6 Codex runtime executable is not bound to installed tree",
      );
    }
  }
  for (const manifest of Object.values(artifact.packageManifests)) {
    const entry = artifact.installedTree.entries.find(
      (candidate) => candidate.path === manifest.path,
    );
    if (
      entry?.type !== "file" ||
      entry.bytes !== manifest.bytes ||
      entry.mode !== manifest.mode ||
      entry.sha256 !== manifest.sha256
    ) {
      throw new Error(
        "C6 Codex runtime package manifest is not bound to installed tree",
      );
    }
  }
  const binCodex = artifact.installedTree.entries.find(
    (candidate) => candidate.path === artifact.binCodex.path,
  );
  if (
    binCodex?.type !== "symlink" ||
    binCodex.target !== artifact.binCodex.target
  ) {
    throw new Error(
      "C6 Codex runtime .bin/codex is not bound to installed tree",
    );
  }
  return artifact;
}

function artifactReference(
  path: string,
  bytes: string | Uint8Array,
) {
  return artifactReferenceSchema.parse({
    bytes: typeof bytes === "string"
      ? Buffer.byteLength(bytes)
      : bytes.byteLength,
    path,
    sha256: sha256(bytes),
  });
}

function assertReference(
  reference: z.infer<typeof artifactReferenceSchema>,
  path: string,
  bytes: Uint8Array,
): void {
  if (
    reference.path !== path ||
    reference.bytes !== bytes.byteLength ||
    reference.sha256 !== sha256(bytes)
  ) {
    throw new Error(
      `C6 Codex runtime artifact reference mismatch ${path}`,
    );
  }
}

async function assertRootStructure(outputRoot: string): Promise<void> {
  const entries = await readdir(outputRoot, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  if (
    JSON.stringify(entries.map((entry) => entry.name)) !==
      JSON.stringify([...ROOT_FILES].sort()) ||
    entries.find((entry) => entry.name === "artifacts")?.isDirectory() !==
      true ||
    entries.find((entry) => entry.name === "receipt.json")?.isFile() !==
      true ||
    entries.some((entry) => entry.isSymbolicLink())
  ) {
    throw new Error("C6 Codex runtime output closure is not exact");
  }
  const artifactEntries = await readdir(
    join(outputRoot, "artifacts"),
    { withFileTypes: true },
  );
  artifactEntries.sort((left, right) =>
    left.name.localeCompare(right.name)
  );
  if (
    JSON.stringify(artifactEntries.map((entry) => entry.name)) !==
      JSON.stringify([...ARTIFACT_ENTRIES].sort()) ||
    artifactEntries.find((entry) =>
      entry.name === "runner-sources"
    )?.isDirectory() !== true ||
    artifactEntries.filter((entry) =>
      entry.name !== "runner-sources"
    ).some((entry) => !entry.isFile()) ||
    artifactEntries.some((entry) => entry.isSymbolicLink())
  ) {
    throw new Error(
      "C6 Codex runtime artifact directory closure is not exact",
    );
  }
  const runnerEntries = await readdir(
    join(outputRoot, "artifacts", "runner-sources"),
    { withFileTypes: true },
  );
  runnerEntries.sort((left, right) =>
    left.name.localeCompare(right.name)
  );
  if (
    JSON.stringify(runnerEntries.map((entry) => entry.name)) !==
      JSON.stringify([...RUNNER_SOURCE_FILES].sort()) ||
    runnerEntries.some((entry) =>
      !entry.isFile() || entry.isSymbolicLink()
    )
  ) {
    throw new Error(
      "C6 Codex runtime frozen runner closure is not exact",
    );
  }
}

async function publishArtifact(input: {
  bytes: string | Uint8Array;
  dependencies: C6CodexRuntimeLinuxMaterializerDependencies;
  path: string;
  relativePath: string;
  reservation: OutputReservation;
}): Promise<void> {
  await assertOutputReservation(
    input.reservation,
    `before ${input.relativePath}`,
  );
  try {
    await writeAtomicExclusive(input.path, input.bytes, 0o600);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      throw new Error(
        `C6 Codex runtime refuses to replace artifact ${input.relativePath}`,
      );
    }
    throw error;
  }
  await input.dependencies.testHooks?.artifactWritten?.(
    input.relativePath,
  );
}

async function writeAtomicExclusive(
  path: string,
  bytes: string | Uint8Array,
  mode: number,
): Promise<void> {
  const finalPath = resolve(path);
  const parent = dirname(finalPath);
  if (
    await realpath(parent) !== parent ||
    basename(finalPath).length === 0
  ) {
    throw new Error(
      "C6 Codex runtime artifact parent is not canonical",
    );
  }
  const temporaryPath = `${finalPath}.tmp-${randomUUID()}`;
  let temporaryCreated = false;
  let linked = false;
  try {
    const handle = await open(temporaryPath, "wx", mode);
    temporaryCreated = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporaryPath, finalPath);
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

function parseCanonicalJson<T>(
  schema: z.ZodType<T>,
  bytes: Buffer,
  label: string,
): T {
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON`);
  }
  const parsed = schema.parse(value);
  if (!bytes.equals(Buffer.from(canonicalJson(parsed)))) {
    throw new Error(`${label} is not canonical JSON`);
  }
  return parsed;
}

function parseJsonText(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function commandError(
  label: string,
  result: C6CodexRuntimeLinuxCommandResult,
): Error {
  const detail = [result.stderr.trim(), result.stdout.trim()]
    .find((value) => value.length > 0);
  return new Error(
    detail === undefined
      ? `${label} failed with exit code ${result.exitCode}`
      : `${label} failed with exit code ${result.exitCode}: ${detail}`,
  );
}

async function waitFor(milliseconds: number): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

async function canonicalExistingDirectory(
  path: string,
  label: string,
): Promise<string> {
  const absolute = resolve(path);
  let canonical: string;
  try {
    canonical = await realpath(absolute);
  } catch {
    throw new Error(`C6 ${label} does not exist`);
  }
  const stat = await lstat(absolute);
  if (
    canonical !== absolute ||
    stat.isSymbolicLink() ||
    !stat.isDirectory()
  ) {
    throw new Error(`C6 ${label} rejects symlink path components`);
  }
  return canonical;
}

async function canonicalExistingFile(
  path: string,
  label: string,
): Promise<string> {
  const absolute = resolve(path);
  let canonical: string;
  try {
    canonical = await realpath(absolute);
  } catch {
    throw new Error(`C6 ${label} does not exist`);
  }
  const stat = await lstat(absolute);
  if (
    canonical !== absolute ||
    stat.isSymbolicLink() ||
    !stat.isFile()
  ) {
    throw new Error(`C6 ${label} rejects symlink path components`);
  }
  return canonical;
}

async function inspectDockerCliIdentity(
  path: string,
  expectedSha256: string,
): Promise<DockerCliIdentity> {
  const canonical = await canonicalExistingFile(
    path,
    "Codex runtime Docker CLI",
  );
  const [bytes, stat] = await Promise.all([
    readC6StableRegularFile(canonical, "Codex runtime Docker CLI"),
    lstat(canonical),
  ]);
  const mode = stat.mode & 0o777;
  const digest = sha256(bytes);
  if (digest !== expectedSha256 || (mode & 0o111) === 0) {
    throw new Error(
      "C6 Codex runtime Docker CLI identity does not match",
    );
  }
  return { mode, path: canonical, sha256: digest };
}

async function directoryIdentity(path: string): Promise<DirectoryIdentity> {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("C6 Codex runtime expected a real directory");
  }
  return { dev: stat.dev, ino: stat.ino, mode: stat.mode };
}

async function assertDirectoryIdentity(
  path: string,
  expected: DirectoryIdentity,
  label: string,
): Promise<void> {
  let actual: DirectoryIdentity;
  try {
    actual = await directoryIdentity(path);
  } catch {
    throw new Error(`C6 ${label} drifted`);
  }
  if (
    actual.dev !== expected.dev ||
    actual.ino !== expected.ino ||
    actual.mode !== expected.mode ||
    await realpath(path) !== path
  ) {
    throw new Error(`C6 ${label} drifted`);
  }
}

async function reserveOutputRoot(path: string): Promise<OutputReservation> {
  const outputRoot = resolve(path);
  const parent = dirname(outputRoot);
  if (
    await realpath(parent) !== parent ||
    basename(outputRoot).length === 0
  ) {
    throw new Error(
      "C6 Codex runtime output requires a canonical existing parent",
    );
  }
  const lockPath = `${outputRoot}.materialize.lock`;
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch {
    throw new Error("C6 Codex runtime output is already locked");
  }
  let outputCreated = false;
  try {
    await mkdir(outputRoot, { mode: 0o700 });
    outputCreated = true;
    if (await realpath(outputRoot) !== outputRoot) {
      throw new Error("C6 Codex runtime output root is not canonical");
    }
    const [lockStat, outputIdentity] = await Promise.all([
      handle.stat(),
      directoryIdentity(outputRoot),
    ]);
    return {
      handle,
      lockIdentity: {
        dev: lockStat.dev,
        ino: lockStat.ino,
        mode: lockStat.mode,
      },
      lockPath,
      outputIdentity,
      outputRoot,
    };
  } catch (error) {
    await handle.close();
    await unlink(lockPath);
    if (outputCreated) {
      await rm(outputRoot, { force: true, recursive: true });
    }
    if (!outputCreated) {
      throw new Error("C6 Codex runtime output root already exists");
    }
    throw error;
  }
}

async function assertOutputReservation(
  reservation: OutputReservation,
  label: string,
): Promise<void> {
  await assertDirectoryIdentity(
    reservation.outputRoot,
    reservation.outputIdentity,
    `Codex runtime output root ${label}`,
  );
  await assertReservationLock(reservation, label);
}

async function assertReservationLock(
  reservation: OutputReservation,
  label: string,
): Promise<void> {
  let pathStat: Awaited<ReturnType<typeof lstat>>;
  let canonical: string;
  try {
    [pathStat, canonical] = await Promise.all([
      lstat(reservation.lockPath),
      realpath(reservation.lockPath),
    ]);
  } catch {
    throw new Error(
      `C6 Codex runtime reservation lock drifted ${label}`,
    );
  }
  const opened = await reservation.handle.stat();
  const expected = reservation.lockIdentity;
  if (
    !opened.isFile() ||
    !pathStat.isFile() ||
    pathStat.isSymbolicLink() ||
    canonical !== reservation.lockPath ||
    opened.dev !== expected.dev ||
    opened.ino !== expected.ino ||
    opened.mode !== expected.mode ||
    pathStat.dev !== expected.dev ||
    pathStat.ino !== expected.ino ||
    pathStat.mode !== expected.mode
  ) {
    throw new Error(
      `C6 Codex runtime reservation lock drifted ${label}`,
    );
  }
}

async function releaseOutputReservation(
  reservation: OutputReservation,
): Promise<void> {
  await assertReservationLock(reservation, "before release");
  await reservation.handle.close();
  await unlink(reservation.lockPath);
}

async function cleanupFailedReservation(
  reservation: OutputReservation,
): Promise<void> {
  let ownsOutput = false;
  try {
    await assertDirectoryIdentity(
      reservation.outputRoot,
      reservation.outputIdentity,
      "Codex runtime failed output root",
    );
    ownsOutput = true;
  } catch {
    ownsOutput = false;
  }
  if (ownsOutput) {
    await rm(reservation.outputRoot, { force: true, recursive: true });
  }
  try {
    await assertReservationLock(reservation, "failed cleanup");
    await reservation.handle.close();
    await unlink(reservation.lockPath);
  } catch {
    try {
      await reservation.handle.close();
    } catch {
      // The handle can already be closed after a failed release.
    }
  }
}

async function runSystemCommand(
  input: C6CodexRuntimeLinuxCommandInput,
): Promise<C6CodexRuntimeLinuxCommandResult> {
  const child = Bun.spawn({
    cmd: input.command,
    env: input.environment,
    stderr: "pipe",
    stdout: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, input.timeoutMs);
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  clearTimeout(timer);
  if (timedOut) {
    throw new Error(`${input.label} timed out`);
  }
  const result = { exitCode, stderr, stdout };
  if (!input.allowFailure && exitCode !== 0) {
    throw commandError(input.label, result);
  }
  return result;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
