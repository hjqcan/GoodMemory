import {
  materializeC6MultilingualReviewTrajectoryExpansion,
} from "./codex-coding-effect/c6-multilingual-review-trajectory-expansion";

const OPTION_NAMES = new Set([
  "capture-plan",
  "expected-capture-plan-sha256",
  "expected-graphql-root-sha256",
  "expected-prior-frame-sha256",
  "graphql-root",
  "output",
  "prior-frame",
]);

export interface C6MultilingualReviewTrajectoryExpansionCliOptions {
  capturePlan: string;
  expectedCapturePlanSha256: string;
  expectedGraphqlRootSha256: string;
  expectedPriorFrameSha256: string;
  graphqlRoot: string;
  output: string;
  priorFrame: string;
}

export function parseC6MultilingualReviewTrajectoryExpansionCliOptions(
  args: readonly string[],
): C6MultilingualReviewTrajectoryExpansionCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 multilingual expansion argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name)) {
      throw new Error(
        `unknown C6 multilingual expansion option --${name}`,
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
  return {
    capturePlan: required(values, "capture-plan"),
    expectedCapturePlanSha256: parseSha256(
      required(values, "expected-capture-plan-sha256"),
      "expected-capture-plan-sha256",
    ),
    expectedGraphqlRootSha256: parseSha256(
      required(values, "expected-graphql-root-sha256"),
      "expected-graphql-root-sha256",
    ),
    expectedPriorFrameSha256: parseSha256(
      required(values, "expected-prior-frame-sha256"),
      "expected-prior-frame-sha256",
    ),
    graphqlRoot: required(values, "graphql-root"),
    output: required(values, "output"),
    priorFrame: required(values, "prior-frame"),
  };
}

export async function runC6MultilingualReviewTrajectoryExpansionCommand(
  args: readonly string[],
): Promise<{
  counts: {
    broadStructuralPretargetCount: number;
    freshBroadStructuralPretargetCount: number;
    priorFrameOverlapCount: number;
    sourceTargetCount: number;
    unsupportedPaginationCount: number;
  };
  output: string;
  outputSha256: string;
}> {
  const options =
    parseC6MultilingualReviewTrajectoryExpansionCliOptions(args);
  const result =
    await materializeC6MultilingualReviewTrajectoryExpansion({
      capturePlanPath: options.capturePlan,
      expectedCapturePlanSha256: options.expectedCapturePlanSha256,
      expectedGraphqlRootSha256: options.expectedGraphqlRootSha256,
      expectedPriorFrameSha256: options.expectedPriorFrameSha256,
      graphqlRoot: options.graphqlRoot,
      outputPath: options.output,
      priorFramePath: options.priorFrame,
    });
  return {
    counts: result.expansion.counts,
    output: options.output,
    outputSha256: result.outputSha256,
  };
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

function parseSha256(value: string, name: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`--${name} must be a lowercase SHA-256`);
  }
  return value;
}

if (import.meta.main) {
  try {
    const result =
      await runC6MultilingualReviewTrajectoryExpansionCommand(
        process.argv.slice(2),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
