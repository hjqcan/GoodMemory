import {
  materializeC6LiveMultiLangNeighborCommitCountEligibilityPlan,
} from "./codex-coding-effect/c6-live-multilang-neighbor-commit-count-eligibility-plan";

const OPTION_NAMES = new Set(["output", "source-plan"]);

export interface C6LiveMultiLangNeighborCommitCountEligibilityPlanCliOptions {
  output: string;
  sourcePlan: string;
}

export function parseC6LiveMultiLangNeighborCommitCountEligibilityPlanCliOptions(
  args: readonly string[],
): C6LiveMultiLangNeighborCommitCountEligibilityPlanCliOptions {
  const values = parseOptions(args);
  return {
    output: required(values, "output"),
    sourcePlan: required(values, "source-plan"),
  };
}

export async function runC6LiveMultiLangNeighborCommitCountEligibilityPlanCommand(
  args: readonly string[],
): Promise<{
  counts: {
    expectedRequestCount: number;
    sourceTargetCount: number;
  };
  output: string;
  outputSha256: string;
}> {
  const options =
    parseC6LiveMultiLangNeighborCommitCountEligibilityPlanCliOptions(
      args,
    );
  const result =
    await materializeC6LiveMultiLangNeighborCommitCountEligibilityPlan({
      outputPath: options.output,
      sourcePlanPath: options.sourcePlan,
    });
  return {
    counts: result.plan.counts,
    output: options.output,
    outputSha256: result.outputSha256,
  };
}

function parseOptions(args: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 commit-count eligibility plan argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 commit-count eligibility plan option --${name}`,
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
  return values;
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
      await runC6LiveMultiLangNeighborCommitCountEligibilityPlanCommand(
        process.argv.slice(2),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
