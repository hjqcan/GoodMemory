import {
  captureC6ReviewerActorIdentities,
} from "./codex-coding-effect/c6-reviewer-actor-identity-capture";
import type {
  C6ReviewerActorIdentityFetch,
} from "./codex-coding-effect/c6-reviewer-actor-identity-capture";

const OPTION_NAMES = new Set([
  "expected-plan-sha256",
  "output-root",
  "plan",
  "request-timeout-ms",
  "token-env",
]);

export interface C6ReviewerActorIdentityCaptureCliOptions {
  expectedPlanSha256: string;
  outputRoot: string;
  plan: string;
  requestTimeoutMilliseconds: number;
  tokenEnv: string;
}

export function parseC6ReviewerActorIdentityCaptureCliOptions(
  args: readonly string[],
): C6ReviewerActorIdentityCaptureCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 reviewer actor capture argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 reviewer actor capture option --${name}`,
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
  const tokenEnv = required(values, "token-env");
  if (!/^[A-Z][A-Z0-9_]*$/u.test(tokenEnv)) {
    throw new Error(
      "--token-env must name an uppercase environment variable",
    );
  }
  const timeoutValue = values.get("request-timeout-ms") ?? "60000";
  if (!/^[1-9]\d*$/u.test(timeoutValue)) {
    throw new Error(
      "--request-timeout-ms must be a positive integer",
    );
  }
  const requestTimeoutMilliseconds = Number(timeoutValue);
  if (
    !Number.isSafeInteger(requestTimeoutMilliseconds) ||
    requestTimeoutMilliseconds > 300_000
  ) {
    throw new Error(
      "--request-timeout-ms must be at most 300000",
    );
  }
  return {
    expectedPlanSha256,
    outputRoot: required(values, "output-root"),
    plan: required(values, "plan"),
    requestTimeoutMilliseconds,
    tokenEnv,
  };
}

export async function runC6ReviewerActorIdentityCaptureCommand(
  args: readonly string[],
  dependencies: {
    env?: Readonly<Record<string, string | undefined>>;
    fetchImpl?: C6ReviewerActorIdentityFetch;
    progress?: (message: string) => void;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
) {
  const options =
    parseC6ReviewerActorIdentityCaptureCliOptions(args);
  const token = (dependencies.env ?? process.env)[options.tokenEnv];
  if (token === undefined || token.length === 0) {
    throw new Error(
      `C6 reviewer actor token env ${options.tokenEnv} is unset`,
    );
  }
  return captureC6ReviewerActorIdentities({
    authorizationToken: token,
    expectedPlanSha256: options.expectedPlanSha256,
    ...(dependencies.fetchImpl === undefined
      ? {}
      : { fetchImpl: dependencies.fetchImpl }),
    outputRoot: options.outputRoot,
    planPath: options.plan,
    ...(dependencies.progress === undefined
      ? {}
      : { progress: dependencies.progress }),
    requestTimeoutMilliseconds:
      options.requestTimeoutMilliseconds,
    ...(dependencies.sleep === undefined
      ? {}
      : { sleep: dependencies.sleep }),
  });
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
      await runC6ReviewerActorIdentityCaptureCommand(
        process.argv.slice(2),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
