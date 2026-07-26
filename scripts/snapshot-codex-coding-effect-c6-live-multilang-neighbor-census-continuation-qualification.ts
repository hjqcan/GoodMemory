import {
  materializeC6LiveMultiLangNeighborCensusContinuationQualification,
} from "./codex-coding-effect/c6-live-multilang-neighbor-census-qualification";

const OPTION_NAMES = new Set([
  "actor-frame",
  "expected-actor-frame-sha256",
  "expected-neighbor-completion-sha256",
  "expected-neighbor-plan-sha256",
  "expected-neighbor-root-sha256",
  "expected-prior-neighbor-plan-sha256",
  "expected-prior-selected-repository-projection-sha256",
  "expected-source-capture-plan-sha256",
  "expected-source-graphql-root-sha256",
  "expected-source-pool-sha256",
  "neighbor-plan",
  "neighbor-root",
  "output",
  "prior-neighbor-plan",
  "source-capture-plan",
  "source-graphql-root",
  "source-pool",
]);

export interface C6LiveMultiLangNeighborCensusContinuationQualificationCliOptions {
  actorFrame: string;
  expectedActorFrameSha256: string;
  expectedNeighborCompletionSha256: string;
  expectedNeighborPlanSha256: string;
  expectedNeighborRootSha256: string;
  expectedPriorNeighborPlanSha256: string;
  expectedPriorSelectedRepositoryProjectionSha256: string;
  expectedSourceCapturePlanSha256: string;
  expectedSourceGraphqlRootSha256: string;
  expectedSourcePoolSha256: string;
  neighborPlan: string;
  neighborRoot: string;
  output: string;
  priorNeighborPlan: string;
  sourceCapturePlan: string;
  sourceGraphqlRoot: string;
  sourcePool: string;
}

export function parseC6LiveMultiLangNeighborCensusContinuationQualificationCliOptions(
  args: readonly string[],
): C6LiveMultiLangNeighborCensusContinuationQualificationCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 continuation qualification argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 continuation qualification option --${name}`,
      );
    }
    if (values.has(name!)) {
      throw new Error(`--${name} cannot be specified more than once`);
    }
    if (value!.length === 0 || value!.trim() !== value) {
      throw new Error(`--${name} must not be empty or padded`);
    }
    values.set(name!, value!);
  }
  return {
    actorFrame: required(values, "actor-frame"),
    expectedActorFrameSha256: sha256Option(
      values,
      "expected-actor-frame-sha256",
    ),
    expectedNeighborCompletionSha256: sha256Option(
      values,
      "expected-neighbor-completion-sha256",
    ),
    expectedNeighborPlanSha256: sha256Option(
      values,
      "expected-neighbor-plan-sha256",
    ),
    expectedNeighborRootSha256: sha256Option(
      values,
      "expected-neighbor-root-sha256",
    ),
    expectedPriorNeighborPlanSha256: sha256Option(
      values,
      "expected-prior-neighbor-plan-sha256",
    ),
    expectedPriorSelectedRepositoryProjectionSha256: sha256Option(
      values,
      "expected-prior-selected-repository-projection-sha256",
    ),
    expectedSourceCapturePlanSha256: sha256Option(
      values,
      "expected-source-capture-plan-sha256",
    ),
    expectedSourceGraphqlRootSha256: sha256Option(
      values,
      "expected-source-graphql-root-sha256",
    ),
    expectedSourcePoolSha256: sha256Option(
      values,
      "expected-source-pool-sha256",
    ),
    neighborPlan: required(values, "neighbor-plan"),
    neighborRoot: required(values, "neighbor-root"),
    output: required(values, "output"),
    priorNeighborPlan: required(values, "prior-neighbor-plan"),
    sourceCapturePlan: required(values, "source-capture-plan"),
    sourceGraphqlRoot: required(values, "source-graphql-root"),
    sourcePool: required(values, "source-pool"),
  };
}

export async function runC6LiveMultiLangNeighborCensusContinuationQualificationSnapshotCommand(
  args: readonly string[],
): Promise<{
  counts: {
    deepCaptureTargetCount: number;
    existingAnchorOverlapCount: number;
    rawObservationCount: number;
    uniqueCanonicalPullCount: number;
  };
  output: string;
  outputSha256: string;
  schemaVersion: 3;
}> {
  const options =
    parseC6LiveMultiLangNeighborCensusContinuationQualificationCliOptions(
      args,
    );
  const result =
    await materializeC6LiveMultiLangNeighborCensusContinuationQualification({
      actorFramePath: options.actorFrame,
      expectedActorFrameSha256:
        options.expectedActorFrameSha256,
      expectedNeighborCompletionSha256:
        options.expectedNeighborCompletionSha256,
      expectedNeighborPlanSha256:
        options.expectedNeighborPlanSha256,
      expectedNeighborRootSha256:
        options.expectedNeighborRootSha256,
      expectedPriorNeighborPlanSha256:
        options.expectedPriorNeighborPlanSha256,
      expectedPriorSelectedRepositoryProjectionSha256:
        options.expectedPriorSelectedRepositoryProjectionSha256,
      expectedSourceCapturePlanSha256:
        options.expectedSourceCapturePlanSha256,
      expectedSourceGraphqlRootSha256:
        options.expectedSourceGraphqlRootSha256,
      expectedSourcePoolSha256:
        options.expectedSourcePoolSha256,
      neighborPlanPath: options.neighborPlan,
      neighborRoot: options.neighborRoot,
      outputPath: options.output,
      priorNeighborPlanPath: options.priorNeighborPlan,
      sourceCapturePlanPath: options.sourceCapturePlan,
      sourceGraphqlRoot: options.sourceGraphqlRoot,
      sourcePoolPath: options.sourcePool,
    });
  return {
    counts: {
      deepCaptureTargetCount:
        result.qualification.counts.deepCaptureTargetCount,
      existingAnchorOverlapCount:
        result.qualification.counts.existingAnchorOverlapCount,
      rawObservationCount:
        result.qualification.counts.rawObservationCount,
      uniqueCanonicalPullCount:
        result.qualification.counts.uniqueCanonicalPullCount,
    },
    output: options.output,
    outputSha256: result.outputSha256,
    schemaVersion: 3,
  };
}

function sha256Option(
  values: ReadonlyMap<string, string>,
  name: string,
): string {
  const value = required(values, name);
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`--${name} must be a lowercase SHA-256`);
  }
  return value;
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
    const result =
      await runC6LiveMultiLangNeighborCensusContinuationQualificationSnapshotCommand(
        process.argv.slice(2),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
