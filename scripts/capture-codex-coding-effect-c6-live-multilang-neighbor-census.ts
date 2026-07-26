import type {
  C6LiveMultiLangNeighborCensusFetch,
} from "./codex-coding-effect/c6-live-multilang-neighbor-census-capture";
import {
  captureC6LiveMultiLangNeighborCensus,
} from "./codex-coding-effect/c6-live-multilang-neighbor-census-capture";

const OPTION_NAMES = new Set([
  "expected-plan-schema-version",
  "expected-plan-sha256",
  "expected-prior-plan-sha256",
  "expected-prior-selected-repository-projection-sha256",
  "output-root",
  "plan",
  "prior-plan",
]);

export interface C6LiveMultiLangNeighborCensusCaptureCliOptions {
  expectedPlanSchemaVersion?: 1 | 2;
  expectedPlanSha256: string;
  expectedPriorPlanSha256?: string;
  expectedPriorSelectedRepositoryProjectionSha256?: string;
  outputRoot: string;
  plan: string;
  priorPlan?: string;
}

export function parseC6LiveMultiLangNeighborCensusCaptureCliOptions(
  args: readonly string[],
): C6LiveMultiLangNeighborCensusCaptureCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 neighbor census capture argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 neighbor census capture option --${name}`,
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
  const expectedPlanSha256 = required(
    values,
    "expected-plan-sha256",
  );
  if (!/^[a-f0-9]{64}$/u.test(expectedPlanSha256)) {
    throw new Error(
      "--expected-plan-sha256 must be a lowercase SHA-256",
    );
  }
  const baseOptions = {
    expectedPlanSha256,
    outputRoot: required(values, "output-root"),
    plan: required(values, "plan"),
  };
  const schemaVersionValue = values.get(
    "expected-plan-schema-version",
  );
  if (schemaVersionValue === undefined) {
    if (
      values.has("expected-prior-plan-sha256") ||
      values.has(
        "expected-prior-selected-repository-projection-sha256",
      ) ||
      values.has("prior-plan")
    ) {
      throw new Error(
        "--expected-plan-schema-version=2 is required for prior-plan bindings",
      );
    }
    return baseOptions;
  }
  if (schemaVersionValue !== "1" && schemaVersionValue !== "2") {
    throw new Error(
      "--expected-plan-schema-version must be 1 or 2",
    );
  }
  const expectedPlanSchemaVersion =
    schemaVersionValue === "1" ? 1 : 2;
  if (expectedPlanSchemaVersion === 1) {
    if (
      values.has("expected-prior-plan-sha256") ||
      values.has(
        "expected-prior-selected-repository-projection-sha256",
      ) ||
      values.has("prior-plan")
    ) {
      throw new Error(
        "prior-plan bindings require --expected-plan-schema-version=2",
      );
    }
    return {
      ...baseOptions,
      expectedPlanSchemaVersion,
    };
  }
  return {
    ...baseOptions,
    expectedPlanSchemaVersion,
    expectedPriorPlanSha256: sha256Option(
      values,
      "expected-prior-plan-sha256",
    ),
    expectedPriorSelectedRepositoryProjectionSha256:
      sha256Option(
        values,
        "expected-prior-selected-repository-projection-sha256",
      ),
    priorPlan: required(values, "prior-plan"),
  };
}

export async function runC6LiveMultiLangNeighborCensusCaptureCommand(
  args: readonly string[],
  dependencies: {
    env?: Readonly<Record<string, string | undefined>>;
    fetchImpl?: C6LiveMultiLangNeighborCensusFetch;
  } = {},
): Promise<{
  assetRootSha256: string;
  capturedRawAnchorCount: number;
  completedRepositoryCount: number;
  completionSha256: string;
  maximumRawAnchorCount: number;
  outputRoot: string;
}> {
  const options =
    parseC6LiveMultiLangNeighborCensusCaptureCliOptions(args);
  const env = dependencies.env ?? process.env;
  const token = env.GITHUB_TOKEN;
  if (token === undefined || token.length === 0) {
    throw new Error(
      "GITHUB_TOKEN is required for C6 neighbor census capture",
    );
  }
  const fetchImpl = dependencies.fetchImpl ??
    ((url: string, init: RequestInit) => fetch(url, init));
  const result = await captureC6LiveMultiLangNeighborCensus({
    expectedPlanSchemaVersion:
      options.expectedPlanSchemaVersion,
    expectedPlanSha256: options.expectedPlanSha256,
    expectedPriorPlanSha256:
      options.expectedPriorPlanSha256,
    expectedPriorSelectedRepositoryProjectionSha256:
      options.expectedPriorSelectedRepositoryProjectionSha256,
    fetchImpl,
    outputRoot: options.outputRoot,
    planPath: options.plan,
    priorPlanPath: options.priorPlan,
    token,
  });
  return {
    assetRootSha256: result.assetRootSha256,
    capturedRawAnchorCount:
      result.completion.counts.capturedRawAnchorCount,
    completedRepositoryCount:
      result.completion.counts.completedRepositoryCount,
    completionSha256: result.completionSha256,
    maximumRawAnchorCount:
      result.completion.counts.maximumRawAnchorCount,
    outputRoot: result.outputRoot,
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
      await runC6LiveMultiLangNeighborCensusCaptureCommand(
        process.argv.slice(2),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
