import {
  materializeC6PackageClosure,
  parseC6PackageClosureRuntimeIdentity,
} from "./codex-coding-effect/c6-package-closure-materializer";
import type {
  C6PackageClosureMaterializerInput,
} from "./codex-coding-effect/c6-package-closure-materializer";
import { readC6StableRegularFile } from "./codex-coding-effect/c6-asset-lock";

const OPTION_NAMES = new Set([
  "image-reference",
  "image-sha256",
  "output-root",
  "package-sha256",
  "package-tarball",
  "runtime-identity",
]);

export interface C6PackageClosureMaterializerCliOptions {
  expectedImageSha256: string;
  expectedPackageSha256: string;
  imageReference: string;
  outputRoot: string;
  packageTarballPath: string;
  runtimeIdentityPath: string;
}

export function parseC6PackageClosureMaterializerCliOptions(
  args: readonly string[],
): C6PackageClosureMaterializerCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 package closure materializer argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name)) {
      throw new Error(
        `unknown C6 package closure materializer option --${name}`,
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
  const expectedImageSha256 = required(values, "image-sha256");
  const expectedPackageSha256 = required(values, "package-sha256");
  if (
    !/^[a-f0-9]{64}$/u.test(expectedImageSha256) ||
    !/^[a-f0-9]{64}$/u.test(expectedPackageSha256)
  ) {
    throw new Error("C6 package closure materializer hash is invalid");
  }
  return {
    expectedImageSha256,
    expectedPackageSha256,
    imageReference: required(values, "image-reference"),
    outputRoot: required(values, "output-root"),
    packageTarballPath: required(values, "package-tarball"),
    runtimeIdentityPath: required(values, "runtime-identity"),
  };
}

export async function runC6PackageClosureMaterializerCommand(
  args: readonly string[],
  dispatch: (
    input: C6PackageClosureMaterializerInput,
  ) => Promise<unknown> = materializeC6PackageClosure,
): Promise<unknown> {
  const options = parseC6PackageClosureMaterializerCliOptions(args);
  const runtimeBytes = await readC6StableRegularFile(
    options.runtimeIdentityPath,
    "package closure materializer runtime identity",
  );
  let runtimeJson: unknown;
  try {
    runtimeJson = JSON.parse(runtimeBytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("C6 package closure runtime identity contains invalid JSON");
  }
  return dispatch({
    expectedImageSha256: options.expectedImageSha256,
    expectedPackageSha256: options.expectedPackageSha256,
    imageReference: options.imageReference,
    outputRoot: options.outputRoot,
    packageTarballPath: options.packageTarballPath,
    runtime: parseC6PackageClosureRuntimeIdentity(runtimeJson),
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
    const result = await runC6PackageClosureMaterializerCommand(
      process.argv.slice(2),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
