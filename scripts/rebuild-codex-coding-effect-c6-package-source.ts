import { createHash } from "node:crypto";
import {
  lstat,
  realpath,
} from "node:fs/promises";
import { resolve } from "node:path";

import { readC6StableRegularFile } from
  "./codex-coding-effect/c6-asset-lock";
import {
  parseC6PackageSourceRuntimeIdentity,
  rebuildC6PackageFromSource,
} from "./codex-coding-effect/c6-package-source-reproducibility";
import type {
  C6PackageSourceRebuildInput,
} from "./codex-coding-effect/c6-package-source-reproducibility";

export interface C6PackageSourceRebuildCliOptions {
  containerUser: string;
  dependencyClosureExpected: {
    assetLockSha256: string;
    assetRootSha256: string;
    cacheArchiveSha256: string;
    cacheContentRootSha256: string;
    cacheManifestSha256: string;
  };
  dependencyClosureRoot: string;
  dockerCliMode: number;
  dockerCliPath: string;
  dockerCliSha256: string;
  dockerSocketPath: string;
  expectedCommitSha: string;
  expectedImageSha256: string;
  expectedPackageSha256: string;
  expectedTreeSha: string;
  outputRoot: string;
  repositoryRoot: string;
  runtimeIdentityPath: string;
  runtimeIdentitySha256: string;
}

const OPTION_NAMES = {
  "container-user": "containerUser",
  "dependency-asset-lock-sha256": "dependencyAssetLockSha256",
  "dependency-asset-root-sha256": "dependencyAssetRootSha256",
  "dependency-cache-archive-sha256": "dependencyCacheArchiveSha256",
  "dependency-cache-content-root-sha256":
    "dependencyCacheContentRootSha256",
  "dependency-cache-manifest-sha256":
    "dependencyCacheManifestSha256",
  "dependency-closure-root": "dependencyClosureRoot",
  "docker-cli-mode": "dockerCliMode",
  "docker-cli-path": "dockerCliPath",
  "docker-cli-sha256": "dockerCliSha256",
  "docker-socket-path": "dockerSocketPath",
  "expected-commit": "expectedCommitSha",
  "expected-tree": "expectedTreeSha",
  "image-sha256": "expectedImageSha256",
  "output-root": "outputRoot",
  "package-sha256": "expectedPackageSha256",
  "repository-root": "repositoryRoot",
  "runtime-identity": "runtimeIdentityPath",
  "runtime-identity-sha256": "runtimeIdentitySha256",
} as const;

type OptionName = keyof typeof OPTION_NAMES;

export function parseC6PackageSourceRebuildCliOptions(
  arguments_: string[],
): C6PackageSourceRebuildCliOptions {
  const parsed = new Map<OptionName, string>();
  for (const argument of arguments_) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null || !(match[1] in OPTION_NAMES)) {
      throw new Error(
        `unknown C6 package source rebuild option ${argument}`,
      );
    }
    const name = match[1] as OptionName;
    const value = match[2];
    if (parsed.has(name)) {
      throw new Error(`--${name} cannot be specified more than once`);
    }
    if (value.length === 0 || value.trim() !== value) {
      throw new Error(`--${name} must not be empty or padded`);
    }
    parsed.set(name, value);
  }
  for (const name of Object.keys(OPTION_NAMES) as OptionName[]) {
    if (!parsed.has(name)) {
      throw new Error(`--${name} is required`);
    }
  }

  const expectedCommitSha = required(parsed, "expected-commit");
  const expectedTreeSha = required(parsed, "expected-tree");
  const expectedImageSha256 = required(parsed, "image-sha256");
  const expectedPackageSha256 = required(parsed, "package-sha256");
  const dockerCliModeText = required(parsed, "docker-cli-mode");
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(expectedCommitSha)) {
    throw new Error("--expected-commit must be one full lowercase Git OID");
  }
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(expectedTreeSha)) {
    throw new Error("--expected-tree must be one full lowercase Git OID");
  }
  if (!/^[a-f0-9]{64}$/u.test(expectedImageSha256)) {
    throw new Error("--image-sha256 must be one lowercase SHA-256");
  }
  if (!/^[a-f0-9]{64}$/u.test(expectedPackageSha256)) {
    throw new Error("--package-sha256 must be one lowercase SHA-256");
  }
  if (!/^[0-7]{4}$/u.test(dockerCliModeText)) {
    throw new Error("--docker-cli-mode must be four octal digits");
  }
  const shaOptions = [
    "dependency-asset-lock-sha256",
    "dependency-asset-root-sha256",
    "dependency-cache-archive-sha256",
    "dependency-cache-content-root-sha256",
    "dependency-cache-manifest-sha256",
    "docker-cli-sha256",
    "runtime-identity-sha256",
  ] as const;
  for (const name of shaOptions) {
    if (!/^[a-f0-9]{64}$/u.test(required(parsed, name))) {
      throw new Error(`--${name} must be one lowercase SHA-256`);
    }
  }
  const containerUser = required(parsed, "container-user");
  if (!/^\d+:\d+$/u.test(containerUser)) {
    throw new Error("--container-user must be numeric uid:gid");
  }

  return {
    containerUser,
    dependencyClosureExpected: {
      assetLockSha256:
        required(parsed, "dependency-asset-lock-sha256"),
      assetRootSha256:
        required(parsed, "dependency-asset-root-sha256"),
      cacheArchiveSha256:
        required(parsed, "dependency-cache-archive-sha256"),
      cacheContentRootSha256:
        required(parsed, "dependency-cache-content-root-sha256"),
      cacheManifestSha256:
        required(parsed, "dependency-cache-manifest-sha256"),
    },
    dependencyClosureRoot:
      required(parsed, "dependency-closure-root"),
    dockerCliMode: Number.parseInt(dockerCliModeText, 8),
    dockerCliPath: required(parsed, "docker-cli-path"),
    dockerCliSha256: required(parsed, "docker-cli-sha256"),
    dockerSocketPath: required(parsed, "docker-socket-path"),
    expectedCommitSha,
    expectedImageSha256,
    expectedPackageSha256,
    expectedTreeSha,
    outputRoot: required(parsed, "output-root"),
    repositoryRoot: required(parsed, "repository-root"),
    runtimeIdentityPath: required(parsed, "runtime-identity"),
    runtimeIdentitySha256:
      required(parsed, "runtime-identity-sha256"),
  };
}

export async function runC6PackageSourceRebuildCommand<T = Awaited<
  ReturnType<typeof rebuildC6PackageFromSource>
>>(
  arguments_: string[],
  dispatch: (input: C6PackageSourceRebuildInput) => Promise<T> =
    rebuildC6PackageFromSource as (
      input: C6PackageSourceRebuildInput,
    ) => Promise<T>,
): Promise<T> {
  const options = parseC6PackageSourceRebuildCliOptions(arguments_);
  const runtimeIdentityPath = await canonicalRuntimeIdentityPath(
    options.runtimeIdentityPath,
  );
  const runtimeBytes = await readC6StableRegularFile(
    runtimeIdentityPath,
    "package source runtime identity",
  );
  if (sha256(runtimeBytes) !== options.runtimeIdentitySha256) {
    throw new Error("C6 package source runtime identity hash does not match");
  }
  let runtimeValue: unknown;
  try {
    runtimeValue = JSON.parse(runtimeBytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("C6 package source runtime identity is not valid JSON");
  }
  const runtime = parseC6PackageSourceRuntimeIdentity(runtimeValue);
  return dispatch({
    containerUser: options.containerUser,
    dependencyClosureExpected: options.dependencyClosureExpected,
    dependencyClosureRoot: options.dependencyClosureRoot,
    dockerAuthority: {
      cliMode: options.dockerCliMode,
      cliPath: options.dockerCliPath,
      cliSha256: options.dockerCliSha256,
      socketPath: options.dockerSocketPath,
    },
    expectedCommitSha: options.expectedCommitSha,
    expectedImageSha256: options.expectedImageSha256,
    expectedPackageSha256: options.expectedPackageSha256,
    expectedTreeSha: options.expectedTreeSha,
    outputRoot: options.outputRoot,
    repositoryRoot: options.repositoryRoot,
    runtime,
    runtimeIdentitySha256: options.runtimeIdentitySha256,
  });
}

async function canonicalRuntimeIdentityPath(path: string): Promise<string> {
  const absolute = resolve(path);
  let canonical: string;
  try {
    canonical = await realpath(absolute);
  } catch {
    throw new Error("C6 package source runtime identity does not exist");
  }
  const stat = await lstat(absolute);
  if (
    canonical !== absolute ||
    stat.isSymbolicLink() ||
    !stat.isFile()
  ) {
    throw new Error(
      "C6 package source runtime identity rejects symlink path components",
    );
  }
  return canonical;
}

function required(
  values: Map<OptionName, string>,
  name: OptionName,
): string {
  const value = values.get(name);
  if (value === undefined) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

if (import.meta.main) {
  try {
    const result = await runC6PackageSourceRebuildCommand(
      process.argv.slice(2),
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
