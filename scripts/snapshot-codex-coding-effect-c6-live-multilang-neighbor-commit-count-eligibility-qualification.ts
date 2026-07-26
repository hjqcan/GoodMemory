import {
  materializeC6LiveMultiLangNeighborCommitCountEligibilityQualification,
} from "./codex-coding-effect/c6-live-multilang-neighbor-commit-count-eligibility-qualification";

const OPTION_NAMES = new Set([
  "capture-root",
  "census-qualification",
  "deep-capture-plan",
  "eligibility-plan",
  "expected-capture-asset-lock-sha256",
  "expected-capture-asset-root-sha256",
  "expected-capture-completion-sha256",
  "expected-census-qualification-sha256",
  "expected-deep-capture-plan-sha256",
  "expected-eligibility-plan-sha256",
  "output",
]);

export interface C6LiveMultiLangNeighborCommitCountEligibilityQualificationCliOptions {
  captureRoot: string;
  censusQualification: string;
  deepCapturePlan: string;
  eligibilityPlan: string;
  expectedCaptureAssetLockSha256: string;
  expectedCaptureAssetRootSha256: string;
  expectedCaptureCompletionSha256: string;
  expectedCensusQualificationSha256: string;
  expectedDeepCapturePlanSha256: string;
  expectedEligibilityPlanSha256: string;
  output: string;
}

export function parseC6LiveMultiLangNeighborCommitCountEligibilityQualificationCliOptions(
  args: readonly string[],
): C6LiveMultiLangNeighborCommitCountEligibilityQualificationCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 commit-count qualification argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 commit-count qualification option --${name}`,
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
    captureRoot: required(values, "capture-root"),
    censusQualification: required(
      values,
      "census-qualification",
    ),
    deepCapturePlan: required(values, "deep-capture-plan"),
    eligibilityPlan: required(values, "eligibility-plan"),
    expectedCaptureAssetLockSha256: sha256Option(
      values,
      "expected-capture-asset-lock-sha256",
    ),
    expectedCaptureAssetRootSha256: sha256Option(
      values,
      "expected-capture-asset-root-sha256",
    ),
    expectedCaptureCompletionSha256: sha256Option(
      values,
      "expected-capture-completion-sha256",
    ),
    expectedCensusQualificationSha256: sha256Option(
      values,
      "expected-census-qualification-sha256",
    ),
    expectedDeepCapturePlanSha256: sha256Option(
      values,
      "expected-deep-capture-plan-sha256",
    ),
    expectedEligibilityPlanSha256: sha256Option(
      values,
      "expected-eligibility-plan-sha256",
    ),
    output: required(values, "output"),
  };
}

export async function runC6LiveMultiLangNeighborCommitCountEligibilityQualificationCommand(
  args: readonly string[],
) {
  const options =
    parseC6LiveMultiLangNeighborCommitCountEligibilityQualificationCliOptions(
      args,
    );
  const result =
    await materializeC6LiveMultiLangNeighborCommitCountEligibilityQualification({
      captureRoot: options.captureRoot,
      censusQualificationPath: options.censusQualification,
      deepCapturePlanPath: options.deepCapturePlan,
      eligibilityPlanPath: options.eligibilityPlan,
      expectedCaptureAssetLockSha256:
        options.expectedCaptureAssetLockSha256,
      expectedCaptureAssetRootSha256:
        options.expectedCaptureAssetRootSha256,
      expectedCaptureCompletionSha256:
        options.expectedCaptureCompletionSha256,
      expectedCensusQualificationSha256:
        options.expectedCensusQualificationSha256,
      expectedDeepCapturePlanSha256:
        options.expectedDeepCapturePlanSha256,
      expectedEligibilityPlanSha256:
        options.expectedEligibilityPlanSha256,
      outputPath: options.output,
    });
  return {
    counts: result.qualification.counts,
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
      await runC6LiveMultiLangNeighborCommitCountEligibilityQualificationCommand(
        process.argv.slice(2),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
