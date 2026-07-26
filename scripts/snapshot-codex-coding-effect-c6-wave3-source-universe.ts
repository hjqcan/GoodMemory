import {
  materializeC6Wave3SourceUniverse,
} from "./codex-coding-effect/c6-wave3-source-universe";

const OPTION_NAMES = new Set([
  "activation-salt",
  "output",
  "pretarget-policy",
  "prior-frame",
  "structural-union",
]);

export interface C6Wave3SourceUniverseCliOptions {
  activationSalt: string;
  output: string;
  pretargetPolicy: string;
  priorFrame: string;
  structuralUnion: string;
}

export function parseC6Wave3SourceUniverseCliOptions(
  args: readonly string[],
): C6Wave3SourceUniverseCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 Wave3 source universe argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 Wave3 source universe option --${name}`,
      );
    }
    if (values.has(name!)) {
      throw new Error(
        `--${name} cannot be specified more than once`,
      );
    }
    if (value!.length === 0 || value!.trim() !== value) {
      throw new Error(`--${name} must not be empty or padded`);
    }
    values.set(name!, value!);
  }
  return {
    activationSalt: required(values, "activation-salt"),
    output: required(values, "output"),
    pretargetPolicy: required(values, "pretarget-policy"),
    priorFrame: required(values, "prior-frame"),
    structuralUnion: required(values, "structural-union"),
  };
}

export async function runC6Wave3SourceUniverseSnapshotCommand(
  args: readonly string[],
): Promise<{
  artifactKind: "c6-wave3-source-universe";
  officialWave3CapturePermitted: false;
  output: string;
  outputSha256: string;
  schemaVersion: 1;
}> {
  const options = parseC6Wave3SourceUniverseCliOptions(args);
  const result = await materializeC6Wave3SourceUniverse({
    activationSaltPath: options.activationSalt,
    outputPath: options.output,
    pretargetPolicyPath: options.pretargetPolicy,
    priorFramePath: options.priorFrame,
    structuralUnionPath: options.structuralUnion,
  });
  return {
    artifactKind: "c6-wave3-source-universe",
    officialWave3CapturePermitted:
      result.sourceUniverse.boundary
        .officialWave3CapturePermitted,
    output: options.output,
    outputSha256: result.outputSha256,
    schemaVersion: 1,
  };
}

function required(
  values: ReadonlyMap<string, string>,
  name: string,
): string {
  const value = values.get(name);
  if (value === undefined) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

if (import.meta.main) {
  const result = await runC6Wave3SourceUniverseSnapshotCommand(
    process.argv.slice(2),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
