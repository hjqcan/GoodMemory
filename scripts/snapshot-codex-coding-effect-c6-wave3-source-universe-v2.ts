import {
  materializeC6Wave3SourceUniverseV2,
} from "./codex-coding-effect/c6-wave3-source-universe-v2";

const OPTION_NAMES = new Set([
  "output",
  "pretarget-policy",
  "prior-frame",
  "structural-union",
]);

export interface C6Wave3SourceUniverseV2CliOptions {
  output: string;
  pretargetPolicy: string;
  priorFrame: string;
  structuralUnion: string;
}

export function parseC6Wave3SourceUniverseV2CliOptions(
  args: readonly string[],
): C6Wave3SourceUniverseV2CliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 Wave3 source universe v2 argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 Wave3 source universe v2 option --${name}`,
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
    output: required(values, "output"),
    pretargetPolicy: required(values, "pretarget-policy"),
    priorFrame: required(values, "prior-frame"),
    structuralUnion: required(values, "structural-union"),
  };
}

export async function runC6Wave3SourceUniverseV2SnapshotCommand(
  args: readonly string[],
): Promise<{
  artifactKind: "c6-wave3-source-universe";
  officialWave3CapturePermitted: false;
  output: string;
  outputSha256: string;
  schemaVersion: 2;
}> {
  const options = parseC6Wave3SourceUniverseV2CliOptions(args);
  const result = await materializeC6Wave3SourceUniverseV2({
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
    schemaVersion: 2,
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
  const result =
    await runC6Wave3SourceUniverseV2SnapshotCommand(
      process.argv.slice(2),
    );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
