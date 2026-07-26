import {
  materializeC6LiveMultiLangNeighborCensusPlan,
} from "./codex-coding-effect/c6-live-multilang-neighbor-census-plan";

const OPTION_NAMES = new Set([
  "actor-frame",
  "capture-plan",
  "expected-actor-frame-sha256",
  "expected-capture-plan-sha256",
  "expected-graphql-root-sha256",
  "graphql-root",
  "output",
]);

export interface C6LiveMultiLangNeighborCensusPlanCliOptions {
  actorFrame: string;
  capturePlan: string;
  expectedActorFrameSha256: string;
  expectedCapturePlanSha256: string;
  expectedGraphqlRootSha256: string;
  graphqlRoot: string;
  output: string;
}

export function parseC6LiveMultiLangNeighborCensusPlanCliOptions(
  args: readonly string[],
): C6LiveMultiLangNeighborCensusPlanCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 neighbor census plan argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 neighbor census plan option --${name}`,
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
  const expectedActorFrameSha256 = required(
    values,
    "expected-actor-frame-sha256",
  );
  const expectedCapturePlanSha256 = required(
    values,
    "expected-capture-plan-sha256",
  );
  const expectedGraphqlRootSha256 = required(
    values,
    "expected-graphql-root-sha256",
  );
  for (const [name, value] of [
    ["expected-actor-frame-sha256", expectedActorFrameSha256],
    ["expected-capture-plan-sha256", expectedCapturePlanSha256],
    ["expected-graphql-root-sha256", expectedGraphqlRootSha256],
  ] as const) {
    if (!/^[a-f0-9]{64}$/u.test(value)) {
      throw new Error(`--${name} must be a lowercase SHA-256`);
    }
  }
  return {
    actorFrame: required(values, "actor-frame"),
    capturePlan: required(values, "capture-plan"),
    expectedActorFrameSha256,
    expectedCapturePlanSha256,
    expectedGraphqlRootSha256,
    graphqlRoot: required(values, "graphql-root"),
    output: required(values, "output"),
  };
}

export async function runC6LiveMultiLangNeighborCensusPlanSnapshotCommand(
  args: readonly string[],
): Promise<{
  counts: {
    canonicalRepositoryCount: number;
    eligibleRepositoryCount: number;
    selectedRepositoryCount: number;
    sourceAnchorCount: number;
  };
  outputSha256: string;
}> {
  const options =
    parseC6LiveMultiLangNeighborCensusPlanCliOptions(args);
  const result =
    await materializeC6LiveMultiLangNeighborCensusPlan({
      actorFramePath: options.actorFrame,
      capturePlanPath: options.capturePlan,
      expectedActorFrameSha256:
        options.expectedActorFrameSha256,
      expectedCapturePlanSha256:
        options.expectedCapturePlanSha256,
      expectedGraphqlRootSha256:
        options.expectedGraphqlRootSha256,
      graphqlRoot: options.graphqlRoot,
      outputPath: options.output,
    });
  return {
    counts: {
      canonicalRepositoryCount:
        result.plan.counts.canonicalRepositoryCount,
      eligibleRepositoryCount:
        result.plan.counts.eligibleRepositoryCount,
      selectedRepositoryCount:
        result.plan.counts.selectedRepositoryCount,
      sourceAnchorCount: result.plan.counts.sourceAnchorCount,
    },
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

if (import.meta.main) {
  try {
    const result =
      await runC6LiveMultiLangNeighborCensusPlanSnapshotCommand(
        process.argv.slice(2),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
