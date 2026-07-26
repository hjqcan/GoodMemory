import type {
  C6LiveMultiLangNeighborCommitCountEligibilityFetch,
} from "./codex-coding-effect/c6-live-multilang-neighbor-commit-count-eligibility-capture";
import {
  captureC6LiveMultiLangNeighborCommitCountEligibility,
} from "./codex-coding-effect/c6-live-multilang-neighbor-commit-count-eligibility-capture";

const OPTION_NAMES = new Set([
  "expected-plan-sha256",
  "expected-query-sha256",
  "expected-source-target-projection-sha256",
  "expected-target-count",
  "output-root",
  "plan",
  "token-env",
]);

export interface C6LiveMultiLangNeighborCommitCountEligibilityCaptureCliOptions {
  expectedPlanSha256: string;
  expectedQuerySha256: string;
  expectedSourceTargetProjectionSha256: string;
  expectedTargetCount: number;
  outputRoot: string;
  plan: string;
  tokenEnv: string;
}

export function parseC6LiveMultiLangNeighborCommitCountEligibilityCaptureCliOptions(
  args: readonly string[],
): C6LiveMultiLangNeighborCommitCountEligibilityCaptureCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 commit-count eligibility capture argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 commit-count eligibility capture option --${name}`,
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
  const tokenEnv = required(values, "token-env");
  if (!/^[A-Z][A-Z0-9_]*$/u.test(tokenEnv)) {
    throw new Error(
      "--token-env must name an uppercase environment variable",
    );
  }
  return {
    expectedPlanSha256: sha256Option(
      values,
      "expected-plan-sha256",
    ),
    expectedQuerySha256: sha256Option(
      values,
      "expected-query-sha256",
    ),
    expectedSourceTargetProjectionSha256: sha256Option(
      values,
      "expected-source-target-projection-sha256",
    ),
    expectedTargetCount: positiveIntegerOption(
      values,
      "expected-target-count",
    ),
    outputRoot: required(values, "output-root"),
    plan: required(values, "plan"),
    tokenEnv,
  };
}

export async function runC6LiveMultiLangNeighborCommitCountEligibilityCaptureCommand(
  args: readonly string[],
  dependencies: {
    env?: Readonly<Record<string, string | undefined>>;
    fetchImpl?: C6LiveMultiLangNeighborCommitCountEligibilityFetch;
    progress?: (message: string) => void;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
) {
  const options =
    parseC6LiveMultiLangNeighborCommitCountEligibilityCaptureCliOptions(
      args,
    );
  const env = dependencies.env ?? process.env;
  const token = env[options.tokenEnv];
  if (token === undefined || token.length === 0) {
    throw new Error(
      `C6 commit-count eligibility token env ${options.tokenEnv} is unset`,
    );
  }
  return captureC6LiveMultiLangNeighborCommitCountEligibility({
    authorizationToken: token,
    expectedPlanSha256: options.expectedPlanSha256,
    expectedQuerySha256: options.expectedQuerySha256,
    expectedSourceTargetProjectionSha256:
      options.expectedSourceTargetProjectionSha256,
    expectedTargetCount: options.expectedTargetCount,
    ...(dependencies.fetchImpl === undefined
      ? {}
      : { fetchImpl: dependencies.fetchImpl }),
    outputRoot: options.outputRoot,
    planPath: options.plan,
    ...(dependencies.progress === undefined
      ? {}
      : { progress: dependencies.progress }),
    ...(dependencies.sleep === undefined
      ? {}
      : { sleep: dependencies.sleep }),
  });
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

function positiveIntegerOption(
  values: ReadonlyMap<string, string>,
  name: string,
): number {
  const value = required(values, name);
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error(`--${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`--${name} must be a safe positive integer`);
  }
  return parsed;
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
      await runC6LiveMultiLangNeighborCommitCountEligibilityCaptureCommand(
        process.argv.slice(2),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
