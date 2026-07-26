import {
  materializeC6Wave3PriorRepositoryIdentityPlan,
} from "./codex-coding-effect/c6-wave3-prior-repository-identity-plan";

const OPTION_NAMES = new Set([
  "output",
  "source-universe",
]);

export interface C6Wave3PriorRepositoryIdentityPlanCliOptions {
  output: string;
  sourceUniverse: string;
}

export function parseC6Wave3PriorRepositoryIdentityPlanCliOptions(
  args: readonly string[],
): C6Wave3PriorRepositoryIdentityPlanCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 Wave3 prior repository identity argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 Wave3 prior repository identity option --${name}`,
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
    sourceUniverse: required(values, "source-universe"),
  };
}

export async function runC6Wave3PriorRepositoryIdentityPlanSnapshotCommand(
  args: readonly string[],
): Promise<{
  artifactKind:
    "c6-wave3-prior-repository-identity-plan";
  officialWave3SearchPermitted: false;
  output: string;
  outputSha256: string;
  priorIdentityCapturePermitted: false;
  schemaVersion: 1;
}> {
  const options =
    parseC6Wave3PriorRepositoryIdentityPlanCliOptions(args);
  const result =
    await materializeC6Wave3PriorRepositoryIdentityPlan({
      outputPath: options.output,
      sourceUniversePath: options.sourceUniverse,
    });
  return {
    artifactKind:
      "c6-wave3-prior-repository-identity-plan",
    officialWave3SearchPermitted:
      result.plan.boundary.officialWave3SearchPermitted,
    output: options.output,
    outputSha256: result.outputSha256,
    priorIdentityCapturePermitted:
      result.plan.boundary.priorIdentityCapturePermitted,
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
  const result =
    await runC6Wave3PriorRepositoryIdentityPlanSnapshotCommand(
      process.argv.slice(2),
    );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
