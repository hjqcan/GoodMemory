import {
  materializeC6LiveMultiLangNeighborActorPlan,
} from "./codex-coding-effect/c6-live-multilang-neighbor-actor-plan";

const OPTION_NAMES = new Set([
  "output",
  "structural-qualification",
]);

export interface C6LiveMultiLangNeighborActorPlanCliOptions {
  output: string;
  structuralQualification: string;
}

export function parseC6LiveMultiLangNeighborActorPlanCliOptions(
  args: readonly string[],
): C6LiveMultiLangNeighborActorPlanCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 neighbor actor plan argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 neighbor actor plan option --${name}`,
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
    structuralQualification: required(
      values,
      "structural-qualification",
    ),
  };
}

export async function runC6LiveMultiLangNeighborActorPlanSnapshotCommand(
  args: readonly string[],
): Promise<{
  counts: {
    sourceReviewReferenceCount: number;
    sourceTargetCount: number;
    uniqueActorCount: number;
  };
  output: string;
  outputSha256: string;
  schemaVersion: 1;
}> {
  const options =
    parseC6LiveMultiLangNeighborActorPlanCliOptions(args);
  const result = await materializeC6LiveMultiLangNeighborActorPlan({
    outputPath: options.output,
    structuralQualificationPath:
      options.structuralQualification,
  });
  return {
    counts: result.plan.counts,
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
  const result =
    await runC6LiveMultiLangNeighborActorPlanSnapshotCommand(
      process.argv.slice(2),
    );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
