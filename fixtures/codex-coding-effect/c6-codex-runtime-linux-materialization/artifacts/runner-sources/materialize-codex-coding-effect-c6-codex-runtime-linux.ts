import {
  materializeC6CodexRuntimeLinux,
} from "./codex-coding-effect/c6-codex-runtime-linux";
import type {
  C6CodexRuntimeLinuxMaterializerInput,
} from "./codex-coding-effect/c6-codex-runtime-linux";

const OPTION_NAMES = new Set([
  "capture-sha256",
  "container-user",
  "docker-cli",
  "docker-cli-sha256",
  "docker-host",
  "fixture-root",
  "image",
  "image-sha256",
  "linux-tarball-sha256",
  "main-tarball-sha256",
  "output",
  "package-json-sha256",
  "package-lock-sha256",
  "runtime-identity",
  "runtime-identity-sha256",
  "tarball-root",
  "version",
]);
const HASH_OPTIONS = [
  "capture-sha256",
  "docker-cli-sha256",
  "image-sha256",
  "linux-tarball-sha256",
  "main-tarball-sha256",
  "package-json-sha256",
  "package-lock-sha256",
  "runtime-identity-sha256",
] as const;

export interface C6CodexRuntimeLinuxMaterializerCliOptions {
  captureSha256: string;
  containerUser: string;
  dockerCliPath: string;
  dockerCliSha256: string;
  dockerHost: string;
  fixtureRoot: string;
  imageReference: string;
  imageSha256: string;
  linuxTarballSha256: string;
  mainTarballSha256: string;
  outputRoot: string;
  packageJsonSha256: string;
  packageLockSha256: string;
  runtimeIdentityPath: string;
  runtimeIdentitySha256: string;
  tarballRoot: string;
  version: "0.145.0";
}

export function parseC6CodexRuntimeLinuxMaterializerCliOptions(
  args: readonly string[],
): C6CodexRuntimeLinuxMaterializerCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 Codex runtime materializer argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name)) {
      throw new Error(
        `unknown C6 Codex runtime materializer option --${name}`,
      );
    }
    if (values.has(name)) {
      throw new Error(`--${name} cannot be specified more than once`);
    }
    if (value.length === 0 || value.trim() !== value) {
      throw new Error(`--${name} must not be empty or padded`);
    }
    values.set(name, value);
  }
  for (const name of HASH_OPTIONS) {
    if (!/^[a-f0-9]{64}$/u.test(required(values, name))) {
      throw new Error(`--${name} must be a lowercase SHA-256`);
    }
  }
  const imageSha256 = required(values, "image-sha256");
  const imageReference = required(values, "image");
  if (imageReference !== `sha256:${imageSha256}`) {
    throw new Error("--image must equal sha256:<--image-sha256>");
  }
  const version = required(values, "version");
  if (version !== "0.145.0") {
    throw new Error("--version must equal 0.145.0");
  }
  const containerUser = required(values, "container-user");
  if (!/^\d+:\d+$/u.test(containerUser)) {
    throw new Error("--container-user must be numeric uid:gid");
  }
  const dockerHost = required(values, "docker-host");
  if (!/^unix:\/\/\/[^\u0000\r\n]+$/u.test(dockerHost)) {
    throw new Error("--docker-host must be an explicit Unix socket");
  }
  return {
    captureSha256: required(values, "capture-sha256"),
    containerUser,
    dockerCliPath: required(values, "docker-cli"),
    dockerCliSha256: required(values, "docker-cli-sha256"),
    dockerHost,
    fixtureRoot: required(values, "fixture-root"),
    imageReference,
    imageSha256,
    linuxTarballSha256: required(
      values,
      "linux-tarball-sha256",
    ),
    mainTarballSha256: required(values, "main-tarball-sha256"),
    outputRoot: required(values, "output"),
    packageJsonSha256: required(values, "package-json-sha256"),
    packageLockSha256: required(values, "package-lock-sha256"),
    runtimeIdentityPath: required(values, "runtime-identity"),
    runtimeIdentitySha256: required(
      values,
      "runtime-identity-sha256",
    ),
    tarballRoot: required(values, "tarball-root"),
    version,
  };
}

export async function runC6CodexRuntimeLinuxMaterializerCommand(
  args: readonly string[],
  dispatch: (
    input: C6CodexRuntimeLinuxMaterializerInput,
  ) => Promise<unknown> = materializeC6CodexRuntimeLinux,
): Promise<unknown> {
  const options =
    parseC6CodexRuntimeLinuxMaterializerCliOptions(args);
  return dispatch({
    containerUser: options.containerUser,
    dockerCliPath: options.dockerCliPath,
    expected: {
      captureSha256: options.captureSha256,
      dockerCliSha256: options.dockerCliSha256,
      dockerHost: options.dockerHost,
      imageSha256: options.imageSha256,
      linuxTarballSha256: options.linuxTarballSha256,
      mainTarballSha256: options.mainTarballSha256,
      packageJsonSha256: options.packageJsonSha256,
      packageLockSha256: options.packageLockSha256,
      runtimeIdentitySha256: options.runtimeIdentitySha256,
      version: options.version,
    },
    fixtureRoot: options.fixtureRoot,
    imageReference: options.imageReference,
    outputRoot: options.outputRoot,
    runtimeIdentityPath: options.runtimeIdentityPath,
    tarballRoot: options.tarballRoot,
  });
}

function required(
  values: ReadonlyMap<string, string>,
  name: string,
): string {
  const value = values.get(name);
  if (value === undefined) {
    throw new Error(`--${name} is required exactly once`);
  }
  return value;
}

if (import.meta.main) {
  try {
    const result = await runC6CodexRuntimeLinuxMaterializerCommand(
      process.argv.slice(2),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
