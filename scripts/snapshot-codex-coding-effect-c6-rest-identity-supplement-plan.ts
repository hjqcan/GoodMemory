import {
  materializeC6RestIdentitySupplementPlan,
} from "./codex-coding-effect/c6-rest-identity-supplement-plan";

const OPTION_NAMES = new Set([
  "capture-plan",
  "expected-capture-plan-sha256",
  "expected-qualification-sha256",
  "output",
  "qualification",
]);

export function parseC6RestIdentitySupplementPlanCliOptions(
  args: readonly string[],
): {
  capturePlan: string;
  expectedCapturePlanSha256: string;
  expectedQualificationSha256: string;
  output: string;
  qualification: string;
} {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 REST identity supplement argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name)) {
      throw new Error(
        `unknown C6 REST identity supplement option --${name}`,
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
  const expectedCapturePlanSha256 = required(
    values,
    "expected-capture-plan-sha256",
  );
  const expectedQualificationSha256 = required(
    values,
    "expected-qualification-sha256",
  );
  for (const [name, value] of [
    ["expected-capture-plan-sha256", expectedCapturePlanSha256],
    ["expected-qualification-sha256", expectedQualificationSha256],
  ] as const) {
    if (!/^[a-f0-9]{64}$/u.test(value)) {
      throw new Error(`--${name} must be a lowercase SHA-256`);
    }
  }
  return {
    capturePlan: required(values, "capture-plan"),
    expectedCapturePlanSha256,
    expectedQualificationSha256,
    output: required(values, "output"),
    qualification: required(values, "qualification"),
  };
}

export async function runC6RestIdentitySupplementPlanSnapshotCommand(
  args: readonly string[],
): Promise<{
  counts: {
    supplementRepositoryCount: number;
    supplementTargetCount: number;
  };
  output: string;
  outputSha256: string;
}> {
  const options = parseC6RestIdentitySupplementPlanCliOptions(args);
  const result = await materializeC6RestIdentitySupplementPlan({
    capturePlanPath: options.capturePlan,
    expectedCapturePlanSha256: options.expectedCapturePlanSha256,
    expectedQualificationSha256: options.expectedQualificationSha256,
    outputPath: options.output,
    qualificationPath: options.qualification,
  });
  return {
    counts: result.plan.counts,
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

if (import.meta.main) {
  try {
    const result =
      await runC6RestIdentitySupplementPlanSnapshotCommand(
        process.argv.slice(2),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
