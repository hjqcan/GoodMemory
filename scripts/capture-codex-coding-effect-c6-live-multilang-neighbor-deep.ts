import type {
  C6LiveMultiLangNeighborDeepFetch,
  C6LiveMultiLangNeighborDeepQueryHashes,
} from "./codex-coding-effect/c6-live-multilang-neighbor-deep-capture";
import {
  captureC6LiveMultiLangNeighborDeep,
} from "./codex-coding-effect/c6-live-multilang-neighbor-deep-capture";

const OPTION_NAMES = new Set([
  "expected-commit-parents-query-sha256",
  "expected-commits-query-sha256",
  "expected-deep-target-projection-sha256",
  "expected-initial-query-sha256",
  "expected-plan-sha256",
  "expected-review-thread-comments-query-sha256",
  "expected-review-threads-query-sha256",
  "expected-reviews-query-sha256",
  "expected-target-count",
  "output-root",
  "plan",
  "token-env",
]);

export interface C6LiveMultiLangNeighborDeepCaptureCliOptions {
  expectedDeepCaptureTargetProjectionSha256: string;
  expectedPlanSha256: string;
  expectedQueryHashes: C6LiveMultiLangNeighborDeepQueryHashes;
  expectedTargetCount: number;
  outputRoot: string;
  plan: string;
  tokenEnv: string;
}

export function parseC6LiveMultiLangNeighborDeepCaptureCliOptions(
  args: readonly string[],
): C6LiveMultiLangNeighborDeepCaptureCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 neighbor deep-capture argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 neighbor deep-capture option --${name}`,
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
    expectedDeepCaptureTargetProjectionSha256: sha256Option(
      values,
      "expected-deep-target-projection-sha256",
    ),
    expectedPlanSha256: sha256Option(
      values,
      "expected-plan-sha256",
    ),
    expectedQueryHashes: {
      commitParents: sha256Option(
        values,
        "expected-commit-parents-query-sha256",
      ),
      commits: sha256Option(
        values,
        "expected-commits-query-sha256",
      ),
      initial: sha256Option(
        values,
        "expected-initial-query-sha256",
      ),
      reviewThreadComments: sha256Option(
        values,
        "expected-review-thread-comments-query-sha256",
      ),
      reviewThreads: sha256Option(
        values,
        "expected-review-threads-query-sha256",
      ),
      reviews: sha256Option(
        values,
        "expected-reviews-query-sha256",
      ),
    },
    expectedTargetCount: positiveIntegerOption(
      values,
      "expected-target-count",
    ),
    outputRoot: required(values, "output-root"),
    plan: required(values, "plan"),
    tokenEnv,
  };
}

export async function runC6LiveMultiLangNeighborDeepCaptureCommand(
  args: readonly string[],
  dependencies: {
    env?: Readonly<Record<string, string | undefined>>;
    fetchImpl?: C6LiveMultiLangNeighborDeepFetch;
    progress?: (message: string) => void;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
) {
  const options =
    parseC6LiveMultiLangNeighborDeepCaptureCliOptions(args);
  const env = dependencies.env ?? process.env;
  const token = env[options.tokenEnv];
  if (token === undefined || token.length === 0) {
    throw new Error(
      `C6 neighbor deep-capture token env ${options.tokenEnv} is unset`,
    );
  }
  return captureC6LiveMultiLangNeighborDeep({
    authorizationToken: token,
    expectedDeepCaptureTargetProjectionSha256:
      options.expectedDeepCaptureTargetProjectionSha256,
    expectedPlanSha256: options.expectedPlanSha256,
    expectedQueryHashes: options.expectedQueryHashes,
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
      await runC6LiveMultiLangNeighborDeepCaptureCommand(
        process.argv.slice(2),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
