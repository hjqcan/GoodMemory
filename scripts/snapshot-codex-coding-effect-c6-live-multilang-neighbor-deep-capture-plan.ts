import {
  materializeC6LiveMultiLangNeighborDeepCapturePlan,
} from "./codex-coding-effect/c6-live-multilang-neighbor-deep-capture-plan";

const OPTION_NAMES = new Set([
  "expected-deep-target-projection-sha256",
  "expected-qualification-sha256",
  "expected-target-count",
  "output",
  "qualification",
]);

export interface C6LiveMultiLangNeighborDeepCapturePlanCliOptions {
  expectedDeepCaptureTargetProjectionSha256: string;
  expectedQualificationSha256: string;
  expectedTargetCount: number;
  output: string;
  qualification: string;
}

export function parseC6LiveMultiLangNeighborDeepCapturePlanCliOptions(
  args: readonly string[],
): C6LiveMultiLangNeighborDeepCapturePlanCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 neighbor deep-capture plan argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 neighbor deep-capture plan option --${name}`,
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
  const expectedQualificationSha256 = sha256Option(
    values,
    "expected-qualification-sha256",
  );
  const expectedDeepCaptureTargetProjectionSha256 = sha256Option(
    values,
    "expected-deep-target-projection-sha256",
  );
  const expectedTargetCount = positiveIntegerOption(
    values,
    "expected-target-count",
  );
  return {
    expectedDeepCaptureTargetProjectionSha256,
    expectedQualificationSha256,
    expectedTargetCount,
    output: required(values, "output"),
    qualification: required(values, "qualification"),
  };
}

export async function runC6LiveMultiLangNeighborDeepCapturePlanSnapshotCommand(
  args: readonly string[],
): Promise<{
  counts: {
    expectedRequestLowerBound: number;
    repositoryCount: number;
    targetCount: number;
  };
  output: string;
  outputSha256: string;
}> {
  const options =
    parseC6LiveMultiLangNeighborDeepCapturePlanCliOptions(args);
  const result =
    await materializeC6LiveMultiLangNeighborDeepCapturePlan({
      expectedDeepCaptureTargetProjectionSha256:
        options.expectedDeepCaptureTargetProjectionSha256,
      expectedQualificationSha256:
        options.expectedQualificationSha256,
      expectedTargetCount: options.expectedTargetCount,
      outputPath: options.output,
      qualificationPath: options.qualification,
    });
  return {
    counts: result.plan.counts,
    output: options.output,
    outputSha256: result.outputSha256,
  };
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
      await runC6LiveMultiLangNeighborDeepCapturePlanSnapshotCommand(
        process.argv.slice(2),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
