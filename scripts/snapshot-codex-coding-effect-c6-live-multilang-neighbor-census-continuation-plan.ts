import {
  materializeC6LiveMultiLangNeighborCensusContinuationPlan,
} from "./codex-coding-effect/c6-live-multilang-neighbor-census-continuation-plan";

const OPTION_NAMES = new Set([
  "actor-frame",
  "capture-plan",
  "expected-actor-frame-sha256",
  "expected-capture-plan-sha256",
  "expected-graphql-root-sha256",
  "expected-prior-plan-sha256",
  "expected-prior-selected-repository-projection-sha256",
  "graphql-root",
  "output",
  "prior-plan",
]);

export interface C6LiveMultiLangNeighborCensusContinuationPlanCliOptions {
  actorFrame: string;
  capturePlan: string;
  expectedActorFrameSha256: string;
  expectedCapturePlanSha256: string;
  expectedGraphqlRootSha256: string;
  expectedPriorPlanSha256: string;
  expectedPriorSelectedRepositoryProjectionSha256: string;
  graphqlRoot: string;
  output: string;
  priorPlan: string;
}

export function parseC6LiveMultiLangNeighborCensusContinuationPlanCliOptions(
  args: readonly string[],
): C6LiveMultiLangNeighborCensusContinuationPlanCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 neighbor census continuation argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 neighbor census continuation option --${name}`,
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
    capturePlan: required(values, "capture-plan"),
    expectedActorFrameSha256: sha256Option(
      values,
      "expected-actor-frame-sha256",
    ),
    expectedCapturePlanSha256: sha256Option(
      values,
      "expected-capture-plan-sha256",
    ),
    expectedGraphqlRootSha256: sha256Option(
      values,
      "expected-graphql-root-sha256",
    ),
    expectedPriorPlanSha256: sha256Option(
      values,
      "expected-prior-plan-sha256",
    ),
    expectedPriorSelectedRepositoryProjectionSha256:
      sha256Option(
        values,
        "expected-prior-selected-repository-projection-sha256",
      ),
    graphqlRoot: required(values, "graphql-root"),
    output: required(values, "output"),
    priorPlan: required(values, "prior-plan"),
  };
}

export async function runC6LiveMultiLangNeighborCensusContinuationPlanSnapshotCommand(
  args: readonly string[],
): Promise<{
  counts: {
    continuationEligibleRepositoryCount: number;
    cumulativeSelectedRepositoryCount: number;
    priorSelectedRepositoryCount: number;
    selectedRepositoryCount: number;
  };
  output: string;
  outputSha256: string;
}> {
  const options =
    parseC6LiveMultiLangNeighborCensusContinuationPlanCliOptions(
      args,
    );
  const result =
    await materializeC6LiveMultiLangNeighborCensusContinuationPlan({
      actorFramePath: options.actorFrame,
      capturePlanPath: options.capturePlan,
      expectedActorFrameSha256:
        options.expectedActorFrameSha256,
      expectedCapturePlanSha256:
        options.expectedCapturePlanSha256,
      expectedGraphqlRootSha256:
        options.expectedGraphqlRootSha256,
      expectedPriorPlanSha256:
        options.expectedPriorPlanSha256,
      expectedPriorSelectedRepositoryProjectionSha256:
        options.expectedPriorSelectedRepositoryProjectionSha256,
      graphqlRoot: options.graphqlRoot,
      outputPath: options.output,
      priorPlanPath: options.priorPlan,
    });
  return {
    counts: {
      continuationEligibleRepositoryCount:
        result.plan.counts.continuationEligibleRepositoryCount,
      cumulativeSelectedRepositoryCount:
        result.plan.counts.cumulativeSelectedRepositoryCount,
      priorSelectedRepositoryCount:
        result.plan.counts.priorSelectedRepositoryCount,
      selectedRepositoryCount:
        result.plan.counts.selectedRepositoryCount,
    },
    output: options.output,
    outputSha256: result.outputSha256,
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
      await runC6LiveMultiLangNeighborCensusContinuationPlanSnapshotCommand(
        process.argv.slice(2),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
