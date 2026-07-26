import {
  materializeC6Wave3PretargetPolicy,
} from "./codex-coding-effect/c6-wave3-pretarget-policy";

const OPTION_NAMES = new Set([
  "output",
  "structural-union",
  "wave1-metadata-qualification",
  "wave1-structural-qualification",
  "wave2-metadata-qualification",
  "wave2-structural-qualification",
]);

export interface C6Wave3PretargetPolicyCliOptions {
  output: string;
  structuralUnion: string;
  wave1MetadataQualification: string;
  wave1StructuralQualification: string;
  wave2MetadataQualification: string;
  wave2StructuralQualification: string;
}

export function parseC6Wave3PretargetPolicyCliOptions(
  args: readonly string[],
): C6Wave3PretargetPolicyCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 Wave3 pretarget policy argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 Wave3 pretarget policy option --${name}`,
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
    structuralUnion: required(values, "structural-union"),
    wave1MetadataQualification: required(
      values,
      "wave1-metadata-qualification",
    ),
    wave1StructuralQualification: required(
      values,
      "wave1-structural-qualification",
    ),
    wave2MetadataQualification: required(
      values,
      "wave2-metadata-qualification",
    ),
    wave2StructuralQualification: required(
      values,
      "wave2-structural-qualification",
    ),
  };
}

export async function runC6Wave3PretargetPolicySnapshotCommand(
  args: readonly string[],
): Promise<{
  artifactKind: "c6-wave3-pretarget-policy";
  output: string;
  outputSha256: string;
  schemaVersion: 1;
  status: "review-and-freeze-commit-required";
}> {
  const options = parseC6Wave3PretargetPolicyCliOptions(args);
  const result = await materializeC6Wave3PretargetPolicy({
    outputPath: options.output,
    structuralUnionPath: options.structuralUnion,
    wave1MetadataQualificationPath:
      options.wave1MetadataQualification,
    wave1StructuralQualificationPath:
      options.wave1StructuralQualification,
    wave2MetadataQualificationPath:
      options.wave2MetadataQualification,
    wave2StructuralQualificationPath:
      options.wave2StructuralQualification,
  });
  return {
    artifactKind: "c6-wave3-pretarget-policy",
    output: options.output,
    outputSha256: result.outputSha256,
    schemaVersion: 1,
    status: result.policy.boundary.status,
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
  const result = await runC6Wave3PretargetPolicySnapshotCommand(
    process.argv.slice(2),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
