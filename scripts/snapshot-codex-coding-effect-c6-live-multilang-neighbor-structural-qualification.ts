import {
  materializeC6LiveMultiLangNeighborStructuralQualification,
} from "./codex-coding-effect/c6-live-multilang-neighbor-structural-qualification";

const OPTION_NAMES = new Set([
  "deep-root",
  "output",
  "plan",
  "tranche",
]);

export interface C6LiveMultiLangNeighborStructuralQualificationCliOptions {
  deepRoot: string;
  output: string;
  plan: string;
  tranche: "wave1" | "wave2";
}

export function parseC6LiveMultiLangNeighborStructuralQualificationCliOptions(
  args: readonly string[],
): C6LiveMultiLangNeighborStructuralQualificationCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 neighbor structural qualification argument ${
          argument
        }`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 neighbor structural qualification option --${
          name
        }`,
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
    deepRoot: required(values, "deep-root"),
    output: required(values, "output"),
    plan: required(values, "plan"),
    tranche: trancheOption(values),
  };
}

export async function runC6LiveMultiLangNeighborStructuralQualificationSnapshotCommand(
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
    parseC6LiveMultiLangNeighborStructuralQualificationCliOptions(
      args,
    );
  const result =
    await materializeC6LiveMultiLangNeighborStructuralQualification({
      deepCaptureRoot: options.deepRoot,
      outputPath: options.output,
      planPath: options.plan,
      tranche: options.tranche,
    });
  return {
    counts: {
      exactStructuralCandidateCount:
        result.qualification.counts
          .exactStructuralCandidateCount,
      noExactStructuralSequenceCount:
        result.qualification.counts
          .noExactStructuralSequenceCount,
      reviewerActorOccurrenceCount:
        result.qualification.counts
          .reviewerActorOccurrenceCount,
      reviewerUniqueLoginCount:
        result.qualification.counts.reviewerUniqueLoginCount,
      targetCount: result.qualification.counts.targetCount,
    },
    output: options.output,
    outputSha256: result.outputSha256,
    schemaVersion: 1,
  };
}

function trancheOption(
  values: ReadonlyMap<string, string>,
): "wave1" | "wave2" {
  const value = required(values, "tranche");
  if (value !== "wave1" && value !== "wave2") {
    throw new Error("--tranche must be wave1 or wave2");
  }
  return value;
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
    await runC6LiveMultiLangNeighborStructuralQualificationSnapshotCommand(
      process.argv.slice(2),
    );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
