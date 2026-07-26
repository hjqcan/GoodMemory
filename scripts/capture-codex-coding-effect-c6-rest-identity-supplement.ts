import {
  captureC6RestIdentitySupplement,
} from "./codex-coding-effect/c6-rest-identity-supplement-capture";

const OPTION_NAMES = new Set([
  "expected-plan-sha256",
  "output-root",
  "plan",
  "token-env",
]);

export function parseC6RestIdentitySupplementCaptureCliOptions(
  args: readonly string[],
): {
  expectedPlanSha256: string;
  outputRoot: string;
  plan: string;
  tokenEnv: string;
} {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 REST identity supplement capture argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name)) {
      throw new Error(
        `unknown C6 REST identity supplement capture option --${name}`,
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
  return {
    expectedPlanSha256,
    outputRoot: required(values, "output-root"),
    plan: required(values, "plan"),
    tokenEnv,
  };
}

export async function runC6RestIdentitySupplementCaptureCommand(
  args: readonly string[],
): Promise<{
  assetRootSha256: string;
  capturedTargetCount: number;
  captureAttemptCompletenessProven: true;
  outputRoot: string;
}> {
  const options = parseC6RestIdentitySupplementCaptureCliOptions(args);
  const authorizationToken = process.env[options.tokenEnv];
  if (authorizationToken === undefined) {
    throw new Error(
      `C6 REST identity supplement token env ${options.tokenEnv} is unset`,
    );
  }
  return captureC6RestIdentitySupplement({
    authorizationToken,
    expectedPlanSha256: options.expectedPlanSha256,
    outputRoot: options.outputRoot,
    planPath: options.plan,
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
      await runC6RestIdentitySupplementCaptureCommand(
        process.argv.slice(2),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
