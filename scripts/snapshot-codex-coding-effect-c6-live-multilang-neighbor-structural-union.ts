import {
  materializeC6LiveMultiLangNeighborStructuralUnion,
} from "./codex-coding-effect/c6-live-multilang-neighbor-structural-union";

const OPTION_NAMES = new Set([
  "output",
  "wave1-qualification",
  "wave2-qualification",
]);

export interface C6LiveMultiLangNeighborStructuralUnionCliOptions {
  output: string;
  wave1Qualification: string;
  wave2Qualification: string;
}

export function parseC6LiveMultiLangNeighborStructuralUnionCliOptions(
  args: readonly string[],
): C6LiveMultiLangNeighborStructuralUnionCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 structural union argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 structural union option --${name}`,
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
    wave1Qualification: required(values, "wave1-qualification"),
    wave2Qualification: required(values, "wave2-qualification"),
  };
}

export async function runC6LiveMultiLangNeighborStructuralUnionSnapshotCommand(
  args: readonly string[],
): Promise<{
  counts: {
    exactStructuralCandidateCount: number;
    noExactStructuralSequenceCount: number;
    reviewerActorOccurrenceCount: number;
    reviewerUniqueLoginCount: number;
    targetCount: number;
  };
  output: string;
  outputSha256: string;
  schemaVersion: 1;
}> {
  const options =
    parseC6LiveMultiLangNeighborStructuralUnionCliOptions(args);
  const result =
    await materializeC6LiveMultiLangNeighborStructuralUnion({
      outputPath: options.output,
      wave1QualificationPath: options.wave1Qualification,
      wave2QualificationPath: options.wave2Qualification,
    });
  return {
    counts: {
      exactStructuralCandidateCount:
        result.union.counts.exactStructuralCandidateCount,
      noExactStructuralSequenceCount:
        result.union.counts.noExactStructuralSequenceCount,
      reviewerActorOccurrenceCount:
        result.union.counts.reviewerActorOccurrenceCount,
      reviewerUniqueLoginCount:
        result.union.counts.reviewerUniqueLoginCount,
      targetCount: result.union.counts.targetCount,
    },
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
    await runC6LiveMultiLangNeighborStructuralUnionSnapshotCommand(
      process.argv.slice(2),
    );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
