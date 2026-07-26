import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
} from "node:fs/promises";
import {
  dirname,
  join,
  resolve,
} from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
} from "./c6-asset-lock";
import {
  canonicalExistingDirectory,
} from "./c6-package-source-artifact-publication";

const imageInspectSchema = z.object({
  Architecture: z.string(),
  Id: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  Os: z.string(),
}).passthrough();
const containerInspectSchema = z.object({
  Config: z.object({
    Cmd: z.array(z.string()).nullable().optional(),
    Entrypoint: z.union([
      z.string(),
      z.array(z.string()),
    ]).nullable().optional(),
    Env: z.array(z.string()).nullable().optional(),
    Labels: z.record(z.string(), z.string()).nullable().optional(),
    User: z.string(),
    WorkingDir: z.string(),
  }).passthrough(),
  HostConfig: z.object({
    CapAdd: z.array(z.string()).nullable().optional(),
    CapDrop: z.array(z.string()).nullable().optional(),
    CgroupnsMode: z.string(),
    DeviceRequests: z.array(z.unknown()).nullable().optional(),
    Devices: z.array(z.unknown()).nullable().optional(),
    IpcMode: z.string(),
    NetworkMode: z.string(),
    PidMode: z.string(),
    Privileged: z.boolean(),
    ReadonlyRootfs: z.boolean(),
    SecurityOpt: z.array(z.string()).nullable().optional(),
    Tmpfs: z.record(z.string(), z.string()).nullable().optional(),
    UTSMode: z.string(),
    UsernsMode: z.string(),
  }).passthrough(),
  Id: z.string().regex(/^[a-f0-9]{64}$/u),
  Image: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  Mounts: z.array(z.object({
    Destination: z.string(),
    RW: z.boolean(),
    Source: z.string(),
    Type: z.string(),
  }).passthrough()),
  State: z.object({
    ExitCode: z.number().int(),
    Running: z.boolean(),
  }).passthrough().optional(),
  Name: z.string().min(2),
}).passthrough();

export type C6DockerImageInspect = z.infer<typeof imageInspectSchema>;
export type C6DockerContainerInspect = z.infer<typeof containerInspectSchema>;

export interface C6PackageSourceDockerCommandInput {
  allowFailure: boolean;
  command: string[];
  environment: Readonly<Record<string, string>>;
  label: string;
  timeoutMs: number;
}

export interface C6PackageSourceCommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export const C6_PACKAGE_SOURCE_FIXED_PATH =
  "/work/tool-bin:/usr/local/bin:/usr/bin:/bin";
export const C6_DOCKER_COMMAND_TIMEOUT_MS = 30_000;
export const C6_DOCKER_BUILD_TIMEOUT_MS = 900_000;
const UNCERTAIN_CREATE_DISCOVERY_INTERVAL_MS = 250;
const UNCERTAIN_CREATE_EMPTY_CONFIRMATIONS = 3;
const UNCERTAIN_CREATE_MAX_DISCOVERY_QUERIES = 8;
const DOCKER_CLIENT_PATH = "/usr/bin:/bin";
const ALLOWED_ENVIRONMENT_KEYS = new Set([
  "HOME",
  "NODE_VERSION",
  "NPM_CONFIG_GLOBALCONFIG",
  "NPM_CONFIG_USERCONFIG",
  "PATH",
  "YARN_VERSION",
  "npm_config_update_notifier",
]);
const CONTAINER_OWNER_LABEL =
  "com.goodmemory.c6.package-source.owner";
const CONTAINER_RUN_LABEL =
  "com.goodmemory.c6.package-source.run";
const CONTAINER_WORK_ROOT_LABEL =
  "com.goodmemory.c6.package-source.work-root-sha256";

export function buildC6PackageSourceBuildDockerCreateCommand(input: {
  containerUser: string;
  dockerCliPath: string;
  expectedImageSha256: string;
  imageReference: string;
  ownershipNonce: string;
  run: 1 | 2;
  workRoot: string;
}): string[] {
  assertPinnedImageReference(
    input.imageReference,
    input.expectedImageSha256,
  );
  assertDockerMountPath(input.workRoot);
  if (
    !input.dockerCliPath.startsWith("/") ||
    /[\r\n\0]/u.test(input.dockerCliPath)
  ) {
    throw new Error("C6 source build Docker CLI path is unsafe");
  }
  if (!/^\d+:\d+$/u.test(input.containerUser)) {
    throw new Error("C6 source build container user must be numeric uid:gid");
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u.test(
    input.ownershipNonce,
  )) {
    throw new Error("C6 source build ownership nonce is invalid");
  }
  return [
    input.dockerCliPath,
    "create",
    "--pull=never",
    `--name=${
      containerName(input.workRoot, input.run, input.ownershipNonce)
    }`,
    `--label=${CONTAINER_OWNER_LABEL}=${input.ownershipNonce}`,
    `--label=${CONTAINER_RUN_LABEL}=${input.run}`,
    `--label=${CONTAINER_WORK_ROOT_LABEL}=${sha256(input.workRoot)}`,
    "--platform=linux/amd64",
    "--network=none",
    "--cgroupns=private",
    "--ipc=private",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--tmpfs=/tmp:rw,nosuid,nodev,size=512m",
    `--user=${input.containerUser}`,
    "--env=HOME=/tmp/home",
    "--env=NPM_CONFIG_GLOBALCONFIG=/tmp/empty-global-npmrc",
    "--env=NPM_CONFIG_USERCONFIG=/tmp/empty-user-npmrc",
    "--env=npm_config_update_notifier=false",
    `--env=PATH=${C6_PACKAGE_SOURCE_FIXED_PATH}`,
    `--mount=type=bind,src=${join(input.workRoot, "source")},dst=/work/source`,
    `--mount=type=bind,src=${join(input.workRoot, "output")},dst=/work/output`,
    `--mount=type=bind,src=${join(input.workRoot, "observed")},dst=/work/observed`,
    `--mount=type=bind,src=${join(input.workRoot, "cache")},dst=/work/cache,readonly`,
    `--mount=type=bind,src=${join(input.workRoot, "tool-bin")},dst=/work/tool-bin,readonly`,
    `--mount=type=bind,src=${join(input.workRoot, "run-build.sh")},dst=/work/run-build.sh,readonly`,
    "--workdir=/work/source",
    "--entrypoint=/bin/sh",
    input.imageReference,
    "/work/run-build.sh",
  ];
}


interface DockerCliIdentity {
  ctimeMs: number;
  dev: number;
  ino: number;
  mode: number;
  mtimeMs: number;
  path: string;
  sha256: string;
  size: number;
}

interface DockerSocketIdentity {
  ctimeMs: number;
  dev: number;
  ino: number;
  mode: number;
  path: string;
}

export interface DockerCommandAuthority {
  cli: DockerCliIdentity;
  clientRoot: string;
  environment: Readonly<Record<string, string>>;
  live: boolean;
  quiescenceWait: (milliseconds: number) => Promise<void>;
  runner: (
    input: C6PackageSourceDockerCommandInput,
  ) => Promise<C6PackageSourceCommandResult>;
  socket: DockerSocketIdentity;
}

export async function createDockerCommandAuthority(input: {
  input: {
    cliMode: number;
    cliPath: string;
    cliSha256: string;
    socketPath: string;
  };
  live: boolean;
  outputRoot: string;
  quiescenceWait: (milliseconds: number) => Promise<void>;
  runner: (
    input: C6PackageSourceDockerCommandInput,
  ) => Promise<C6PackageSourceCommandResult>;
}): Promise<DockerCommandAuthority> {
  const parent = await canonicalExistingDirectory(
    dirname(resolve(input.outputRoot)),
    "source build output parent",
  );
  const clientRoot = await realpath(await mkdtemp(join(
    parent,
    ".c6-package-source-docker-client-",
  )));
  try {
    const configRoot = join(clientRoot, "config");
    const homeRoot = join(clientRoot, "home");
    await Promise.all([
      mkdir(configRoot, { mode: 0o500 }),
      mkdir(homeRoot, { mode: 0o500 }),
    ]);
    const cli = input.live
      ? await inspectDockerCliIdentity(input.input)
      : injectedDockerCliIdentity(input.input);
    const socket = input.live
      ? await inspectDockerSocketIdentity(input.input.socketPath)
      : injectedDockerSocketIdentity(input.input.socketPath);
    return {
      cli,
      clientRoot,
      environment: Object.freeze({
        DOCKER_CONFIG: configRoot,
        DOCKER_HOST: `unix://${socket.path}`,
        HOME: homeRoot,
        LANG: "C",
        LC_ALL: "C",
        PATH: DOCKER_CLIENT_PATH,
      }),
      live: input.live,
      quiescenceWait: input.quiescenceWait,
      runner: input.runner,
      socket,
    };
  } catch (error) {
    await rm(clientRoot, { force: true, recursive: true });
    throw error;
  }
}

export async function cleanupDockerCommandAuthority(
  docker: DockerCommandAuthority,
): Promise<void> {
  await rm(docker.clientRoot, { force: true, recursive: true });
}

export async function validateTerminalDockerAuthority(
  docker: DockerCommandAuthority,
): Promise<void> {
  if (!docker.live) {
    return;
  }
  const [cli, socket] = await Promise.all([
    inspectDockerCliIdentity({
      cliMode: docker.cli.mode,
      cliPath: docker.cli.path,
      cliSha256: docker.cli.sha256,
    }),
    inspectDockerSocketIdentity(docker.socket.path),
  ]);
  if (!sameJson(cli, docker.cli) || !sameJson(socket, docker.socket)) {
    throw new Error("C6 source build Docker authority drifted");
  }
}

async function inspectDockerCliIdentity(input: {
  cliMode: number;
  cliPath: string;
  cliSha256: string;
}): Promise<DockerCliIdentity> {
  const path = await assertC6NoSymlinkPathComponents(
    input.cliPath,
    "C6 source build Docker CLI",
  );
  if (!path.startsWith("/")) {
    throw new Error("C6 source build Docker CLI path must be absolute");
  }
  const before = await lstat(path);
  const bytes = await readC6StableRegularFile(
    path,
    "source build Docker CLI",
  );
  const after = await lstat(path);
  const mode = after.mode & 0o7777;
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    !after.isFile() ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mode !== after.mode ||
    before.ctimeMs !== after.ctimeMs ||
    before.mtimeMs !== after.mtimeMs ||
    before.size !== after.size ||
    mode !== input.cliMode ||
    (mode & 0o111) === 0 ||
    sha256(bytes) !== input.cliSha256
  ) {
    throw new Error("C6 source build Docker CLI identity does not match");
  }
  return {
    ctimeMs: after.ctimeMs,
    dev: after.dev,
    ino: after.ino,
    mode,
    mtimeMs: after.mtimeMs,
    path,
    sha256: input.cliSha256,
    size: after.size,
  };
}

async function inspectDockerSocketIdentity(
  rawPath: string,
): Promise<DockerSocketIdentity> {
  const path = await assertC6NoSymlinkPathComponents(
    rawPath,
    "C6 source build Docker socket",
  );
  if (!path.startsWith("/")) {
    throw new Error("C6 source build Docker socket path must be absolute");
  }
  const stat = await lstat(path);
  if (!stat.isSocket() || stat.isSymbolicLink()) {
    throw new Error("C6 source build Docker socket is not a Unix socket");
  }
  return {
    ctimeMs: stat.ctimeMs,
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    path,
  };
}

function injectedDockerCliIdentity(input: {
  cliMode: number;
  cliPath: string;
  cliSha256: string;
}): DockerCliIdentity {
  assertAbsoluteAuthorityPath(input.cliPath, "Docker CLI");
  if ((input.cliMode & 0o111) === 0) {
    throw new Error("C6 source build Docker CLI must be executable");
  }
  return {
    ctimeMs: 0,
    dev: 0,
    ino: 0,
    mode: input.cliMode,
    mtimeMs: 0,
    path: input.cliPath,
    sha256: input.cliSha256,
    size: 0,
  };
}

function injectedDockerSocketIdentity(
  path: string,
): DockerSocketIdentity {
  assertAbsoluteAuthorityPath(path, "Docker socket");
  return { ctimeMs: 0, dev: 0, ino: 0, mode: 0, path };
}

function assertAbsoluteAuthorityPath(path: string, label: string): void {
  if (resolve(path) !== path || /[\0\r\n]/u.test(path)) {
    throw new Error(`C6 source build ${label} path is invalid`);
  }
}

export async function requireDockerServer(
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
    label: "Docker daemon probe",
    timeoutMs: C6_DOCKER_COMMAND_TIMEOUT_MS,
  });
  const version = result.stdout.trim();
  if (result.exitCode !== 0 || version.length === 0) {
    throw new Error([
      "C6 source build executor unavailable: Docker daemon is not reachable",
      outputTail(result.stderr),
    ].filter((value) => value.length > 0).join("\n"));
  }
  return version;
}

export async function inspectDockerImage(
  imageReference: string,
  expectedImageSha256: string,
  docker: DockerCommandAuthority,
): Promise<z.infer<typeof imageInspectSchema>> {
  const result = await docker.runner({
    allowFailure: true,
    command: [
      docker.cli.path,
      "image",
      "inspect",
      imageReference,
    ],
    environment: docker.environment,
    label: "Docker image inspect",
    timeoutMs: C6_DOCKER_COMMAND_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) {
    throw new Error([
      "C6 pinned source-build image is not available locally",
      outputTail(result.stderr),
    ].filter((value) => value.length > 0).join("\n"));
  }
  const inspected = z.array(imageInspectSchema).length(1).parse(
    parseJsonText(result.stdout, "Docker image inspect"),
  )[0];
  if (
    inspected.Os !== "linux" ||
    inspected.Architecture !== "amd64" ||
    inspected.Id !== `sha256:${expectedImageSha256}`
  ) {
    throw new Error(
      "C6 Docker image inspect does not match pinned Linux amd64 identity",
    );
  }
  return inspected;
}

export async function inspectDockerContainer(
  containerId: string,
  docker: DockerCommandAuthority,
): Promise<z.infer<typeof containerInspectSchema>> {
  const result = await docker.runner({
    allowFailure: true,
    command: [docker.cli.path, "inspect", containerId],
    environment: docker.environment,
    label: "Docker container inspect",
    timeoutMs: C6_DOCKER_COMMAND_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) {
    throw new Error("C6 Docker container inspect failed");
  }
  return z.array(containerInspectSchema).length(1).parse(
    parseJsonText(result.stdout, "Docker container inspect"),
  )[0];
}

export interface DockerContainerOwnershipExpectation {
  imageId: string;
  name: string;
  ownershipNonce: string;
  run: 1 | 2;
  user: string;
  workRoot: string;
}

export interface DockerContainerOwnership
  extends DockerContainerOwnershipExpectation {
  containerId: string;
}

export function uncertainDockerCreateError(
  error: unknown,
  ownership: DockerContainerOwnershipExpectation,
): Error {
  return new Error([
    error instanceof Error ? error.message : String(error),
    "C6 source build Docker create outcome is uncertain; work root retained",
    `containerName=${ownership.name}`,
    `ownershipNonce=${ownership.ownershipNonce}`,
    `workRoot=${ownership.workRoot}`,
  ].join("\n"));
}

export function assertDockerContainerIsolation(input: {
  container: z.infer<typeof containerInspectSchema>;
  containerUser: string;
  imageId: string;
  ownership: DockerContainerOwnership;
  requireCompleted: boolean;
}): void {
  const { container } = input;
  assertDockerContainerOwnership(container, input.ownership);
  const securityOptions = container.HostConfig.SecurityOpt ?? [];
  const tmpfsConfig = container.HostConfig.Tmpfs ?? {};
  const tmpfs = tmpfsConfig["/tmp"] ?? "";
  const tmpfsParts = tmpfs.split(",").sort();
  if (
    container.Image !== input.imageId ||
    container.Config.User !== input.containerUser ||
    !/^\d+:\d+$/u.test(container.Config.User) ||
    container.HostConfig.NetworkMode !== "none" ||
    container.HostConfig.CgroupnsMode !== "private" ||
    container.HostConfig.IpcMode !== "private" ||
    container.HostConfig.PidMode !== "" ||
    container.HostConfig.UTSMode !== "" ||
    container.HostConfig.UsernsMode !== "" ||
    !container.HostConfig.ReadonlyRootfs ||
    !sameJson(container.HostConfig.CapDrop, ["ALL"]) ||
    (container.HostConfig.CapAdd?.length ?? 0) !== 0 ||
    container.HostConfig.Privileged ||
    (container.HostConfig.Devices?.length ?? 0) !== 0 ||
    (container.HostConfig.DeviceRequests?.length ?? 0) !== 0 ||
    !sameJson(securityOptions, ["no-new-privileges"]) ||
    !sameJson(Object.keys(tmpfsConfig).sort(), ["/tmp"]) ||
    !(
      sameJson(tmpfsParts, [
        "nodev",
        "nosuid",
        "rw",
        "size=512m",
      ]) ||
      sameJson(tmpfsParts, [
        "nodev",
        "nosuid",
        "rw",
        "size=536870912",
      ])
    ) ||
    (
      input.requireCompleted &&
      container.State?.Running !== false
    )
  ) {
    throw new Error("C6 source build Docker isolation inspect failed");
  }
  const expectedMounts = expectedDockerMounts(
    input.ownership.workRoot,
  );
  const mounts = normalizedDockerMounts(container);
  if (!sameJson(mounts, expectedMounts)) {
    throw new Error("C6 source build Docker mount inspect failed");
  }
  const environment = new Map<string, string>();
  for (const entry of container.Config.Env ?? []) {
    const separator = entry.indexOf("=");
    const key = separator < 0 ? entry : entry.slice(0, separator);
    if (environment.has(key)) {
      throw new Error(
        "C6 source build Docker environment contains duplicates",
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
    environment.get("HOME") !== "/tmp/home" ||
    environment.get("NPM_CONFIG_GLOBALCONFIG") !==
      "/tmp/empty-global-npmrc" ||
    environment.get("NPM_CONFIG_USERCONFIG") !==
      "/tmp/empty-user-npmrc" ||
    environment.get("npm_config_update_notifier") !== "false" ||
    environment.get("PATH") !== C6_PACKAGE_SOURCE_FIXED_PATH
  ) {
    throw new Error(
      "C6 source build Docker environment is not allowlisted",
    );
  }
}

function expectedDockerMounts(workRoot: string) {
  return ([
    ["cache", "/work/cache", false],
    ["observed", "/work/observed", true],
    ["output", "/work/output", true],
    ["run-build.sh", "/work/run-build.sh", false],
    ["source", "/work/source", true],
    ["tool-bin", "/work/tool-bin", false],
  ] as const).map(([source, destination, writable]) => ({
    Destination: destination,
    RW: writable,
    Source: join(workRoot, source),
    Type: "bind",
  })).sort((left, right) => compareUtf8(
    left.Destination,
    right.Destination,
  ));
}

function normalizedDockerMounts(
  container: z.infer<typeof containerInspectSchema>,
) {
  return container.Mounts.map((mount) => ({
    Destination: mount.Destination,
    RW: mount.RW,
    Source: mount.Source,
    Type: mount.Type,
  })).sort((left, right) => compareUtf8(
    left.Destination,
    right.Destination,
  ));
}

function assertDockerContainerOwnership(
  container: z.infer<typeof containerInspectSchema>,
  ownership: DockerContainerOwnershipExpectation & {
    containerId: string;
  },
): void {
  const labels = container.Config.Labels ?? {};
  const entrypoint = typeof container.Config.Entrypoint === "string"
    ? [container.Config.Entrypoint]
    : container.Config.Entrypoint ?? [];
  if (
    container.Id !== ownership.containerId ||
    container.Name !== `/${ownership.name}` ||
    labels[CONTAINER_OWNER_LABEL] !== ownership.ownershipNonce ||
    labels[CONTAINER_RUN_LABEL] !== String(ownership.run) ||
    labels[CONTAINER_WORK_ROOT_LABEL] !== sha256(ownership.workRoot) ||
    container.Image !== ownership.imageId ||
    container.Config.User !== ownership.user ||
    container.Config.WorkingDir !== "/work/source" ||
    !sameJson(entrypoint, ["/bin/sh"]) ||
    !sameJson(container.Config.Cmd, ["/work/run-build.sh"]) ||
    !sameJson(
      normalizedDockerMounts(container),
      expectedDockerMounts(ownership.workRoot),
    )
  ) {
    throw new Error("C6 source build Docker ownership inspect failed");
  }
}

export async function removeDockerContainer(
  ownership: DockerContainerOwnership,
  docker: DockerCommandAuthority,
): Promise<void> {
  if (!/^[a-f0-9]{64}$/u.test(ownership.containerId)) {
    throw new Error("C6 Docker cleanup requires a full container id");
  }
  const before = await docker.runner({
    allowFailure: true,
    command: [docker.cli.path, "inspect", ownership.containerId],
    environment: docker.environment,
    label: "Docker cleanup inspect",
    timeoutMs: C6_DOCKER_COMMAND_TIMEOUT_MS,
  });
  if (before.exitCode !== 0) {
    throw new Error([
      "C6 Docker cleanup could not inspect the created container",
      outputTail(before.stderr),
    ].filter((value) => value.length > 0).join("\n"));
  }
  const inspected = z.array(containerInspectSchema).length(1).parse(
    parseJsonText(before.stdout, "Docker cleanup inspect"),
  )[0];
  assertDockerContainerOwnership(inspected, ownership);
  const removed = await docker.runner({
    allowFailure: true,
    command: [
      docker.cli.path,
      "rm",
      "--force",
      ownership.containerId,
    ],
    environment: docker.environment,
    label: "Docker cleanup",
    timeoutMs: C6_DOCKER_COMMAND_TIMEOUT_MS,
  });
  if (removed.exitCode !== 0) {
    throw new Error([
      "C6 Docker cleanup failed",
      outputTail(removed.stderr),
    ].filter((value) => value.length > 0).join("\n"));
  }
  const after = await docker.runner({
    allowFailure: true,
    command: [docker.cli.path, "inspect", ownership.containerId],
    environment: docker.environment,
    label: "Docker cleanup verification",
    timeoutMs: C6_DOCKER_COMMAND_TIMEOUT_MS,
  });
  if (
    after.exitCode === 0 ||
    !/No such (?:object|container)/iu.test(after.stderr)
  ) {
    throw new Error("C6 Docker cleanup could not verify removal");
  }
}

export async function cleanupUncertainDockerCreate(
  ownership: DockerContainerOwnershipExpectation,
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
        `--filter=label=${CONTAINER_OWNER_LABEL}=${
          ownership.ownershipNonce
        }`,
        `--filter=label=${CONTAINER_RUN_LABEL}=${ownership.run}`,
        `--filter=label=${CONTAINER_WORK_ROOT_LABEL}=${
          sha256(ownership.workRoot)
        }`,
      ],
      environment: docker.environment,
      label: "source build uncertain Docker create discovery",
      timeoutMs: C6_DOCKER_COMMAND_TIMEOUT_MS,
    });
    if (discovered.exitCode !== 0) {
      throw new Error([
        "C6 source build uncertain Docker create discovery failed",
        outputTail(discovered.stderr),
      ].filter((value) => value.length > 0).join("\n"));
    }
    const output = discovered.stdout.trim();
    if (output.length === 0) {
      consecutiveEmptyQueries += 1;
    } else {
      consecutiveEmptyQueries = 0;
      const ids = output.split(/\r?\n/u);
      if (
        new Set(ids).size !== ids.length ||
        ids.some((id) => !/^[a-f0-9]{64}$/u.test(id))
      ) {
        throw new Error(
          "C6 source build uncertain Docker create discovery returned an invalid id",
        );
      }
      for (const containerId of ids) {
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
  if (
    consecutiveEmptyQueries >=
      UNCERTAIN_CREATE_EMPTY_CONFIRMATIONS
  ) {
    return;
  }
  throw new Error(
    "C6 source build uncertain Docker create did not reach quiescence",
  );
}


function assertPinnedImageReference(
  imageReference: string,
  expectedImageSha256: string,
): void {
  if (imageReference !== `sha256:${expectedImageSha256}`) {
    throw new Error(
      "C6 source build image digest does not match expected image SHA-256",
    );
  }
}

function assertDockerMountPath(path: string): void {
  if (
    resolve(path) !== path ||
    path.includes(",") ||
    /[\r\n\0]/u.test(path)
  ) {
    throw new Error("C6 source build Docker mount path is unsafe");
  }
}

export function containerName(
  workRoot: string,
  run: 1 | 2,
  ownershipNonce: string,
): string {
  return `goodmemory-c6-source-build-${run}-${sha256(
    `${ownershipNonce}\0${workRoot}`,
  ).slice(0, 16)}`;
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
  allowFailure = false,
  timeoutMs = C6_DOCKER_COMMAND_TIMEOUT_MS,
  environment?: Readonly<Record<string, string>>,
): Promise<C6PackageSourceCommandResult> {
  const child = Bun.spawn({
    cmd: command,
    ...(environment === undefined ? {} : { env: environment }),
    stderr: "pipe",
    stdout: "pipe",
  });
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
  if (!allowFailure && exitCode !== 0) {
    throw new Error([
      `C6 ${label} failed with exit code ${exitCode}`,
      outputTail(stdout),
      outputTail(stderr),
    ].filter((value) => value.length > 0).join("\n"));
  }
  return { exitCode, stderr, stdout };
}

export async function runDockerCommand(
  input: C6PackageSourceDockerCommandInput,
): Promise<C6PackageSourceCommandResult> {
  return runCommand(
    input.command,
    input.label,
    input.allowFailure,
    input.timeoutMs,
    input.environment,
  );
}

export async function waitFor(milliseconds: number): Promise<void> {
  await new Promise<void>((resolveWait) => {
    setTimeout(resolveWait, milliseconds);
  });
}

function outputTail(value: string): string {
  const limit = 4_000;
  return value.length <= limit ? value.trim() : value.slice(-limit).trim();
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
