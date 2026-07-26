import {
  materializeC6RestIdentitySupplementedQualification,
} from "./codex-coding-effect/c6-rest-identity-supplemented-qualification";

const OPTION_NAMES = new Set([
  "expected-graphql-root-sha256",
  "expected-original-qualification-sha256",
  "expected-supplement-plan-sha256",
  "expected-supplement-root-sha256",
  "graphql-root",
  "original-qualification",
  "output",
  "supplement-plan",
  "supplement-root",
]);

export function parseC6RestIdentitySupplementedQualificationCliOptions(
  args: readonly string[],
): {
  expectedGraphqlRootSha256: string;
  expectedOriginalQualificationSha256: string;
  expectedSupplementPlanSha256: string;
  expectedSupplementRootSha256: string;
  graphqlRoot: string;
  originalQualification: string;
  output: string;
  supplementPlan: string;
  supplementRoot: string;
} {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 supplemented qualification argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name)) {
      throw new Error(
        `unknown C6 supplemented qualification option --${name}`,
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
  const expectedGraphqlRootSha256 = required(
    values,
    "expected-graphql-root-sha256",
  );
  const expectedOriginalQualificationSha256 = required(
    values,
    "expected-original-qualification-sha256",
  );
  const expectedSupplementPlanSha256 = required(
    values,
    "expected-supplement-plan-sha256",
  );
  const expectedSupplementRootSha256 = required(
    values,
    "expected-supplement-root-sha256",
  );
  for (const [name, value] of [
    ["expected-graphql-root-sha256", expectedGraphqlRootSha256],
    [
      "expected-original-qualification-sha256",
      expectedOriginalQualificationSha256,
    ],
    ["expected-supplement-plan-sha256", expectedSupplementPlanSha256],
    ["expected-supplement-root-sha256", expectedSupplementRootSha256],
  ] as const) {
    if (!/^[a-f0-9]{64}$/u.test(value)) {
      throw new Error(`--${name} must be a lowercase SHA-256`);
    }
  }
  return {
    expectedGraphqlRootSha256,
    expectedOriginalQualificationSha256,
    expectedSupplementPlanSha256,
    expectedSupplementRootSha256,
    graphqlRoot: required(values, "graphql-root"),
    originalQualification: required(values, "original-qualification"),
    output: required(values, "output"),
    supplementPlan: required(values, "supplement-plan"),
    supplementRoot: required(values, "supplement-root"),
  };
}

export async function runC6RestIdentitySupplementedQualificationCommand(
  args: readonly string[],
): Promise<{
  counts: {
    exactStructuralCandidateCount: number;
    identitySupplementClosureCount: number;
    missingClosureCount: 0;
    targetCount: number;
  };
  output: string;
  outputSha256: string;
}> {
  const options =
    parseC6RestIdentitySupplementedQualificationCliOptions(args);
  const result =
    await materializeC6RestIdentitySupplementedQualification({
      expectedGraphqlRootSha256: options.expectedGraphqlRootSha256,
      expectedOriginalQualificationSha256:
        options.expectedOriginalQualificationSha256,
      expectedSupplementPlanSha256:
        options.expectedSupplementPlanSha256,
      expectedSupplementRootSha256:
        options.expectedSupplementRootSha256,
      graphqlRoot: options.graphqlRoot,
      originalQualificationPath: options.originalQualification,
      outputPath: options.output,
      supplementPlanPath: options.supplementPlan,
      supplementRoot: options.supplementRoot,
    });
  return {
    counts: result.qualification.counts,
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
      await runC6RestIdentitySupplementedQualificationCommand(
        process.argv.slice(2),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
