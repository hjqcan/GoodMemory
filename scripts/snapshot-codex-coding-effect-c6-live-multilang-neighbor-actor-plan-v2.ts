import {
  materializeC6LiveMultiLangNeighborActorPlanV2,
} from "./codex-coding-effect/c6-live-multilang-neighbor-actor-plan-v2";

const OPTION_NAMES = new Set([
  "output",
  "structural-union",
]);

export interface C6LiveMultiLangNeighborActorPlanV2CliOptions {
  output: string;
  structuralUnion: string;
}

export function parseC6LiveMultiLangNeighborActorPlanV2CliOptions(
  args: readonly string[],
): C6LiveMultiLangNeighborActorPlanV2CliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 neighbor actor plan v2 argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 neighbor actor plan v2 option --${name}`,
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
  };
}

export async function runC6LiveMultiLangNeighborActorPlanV2SnapshotCommand(
  args: readonly string[],
): Promise<{
  counts: {
    sourceReviewReferenceCount: 5_886;
    sourceTargetCount: 1_334;
    uniqueActorCount: 507;
  };
  output: string;
  outputSha256: string;
  schemaVersion: 2;
}> {
  const options =
    parseC6LiveMultiLangNeighborActorPlanV2CliOptions(args);
  const result =
    await materializeC6LiveMultiLangNeighborActorPlanV2({
      outputPath: options.output,
      structuralUnionPath: options.structuralUnion,
    });
  return {
    counts: result.plan.counts,
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
    await runC6LiveMultiLangNeighborActorPlanV2SnapshotCommand(
      process.argv.slice(2),
    );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
