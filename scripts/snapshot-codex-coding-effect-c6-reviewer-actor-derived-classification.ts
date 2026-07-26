import {
  materializeC6ReviewerActorDerivedClassification,
} from "./codex-coding-effect/c6-reviewer-actor-derived-classification";

const OPTION_NAMES = new Set([
  "actor-plan",
  "actor-root",
  "output",
]);

export interface C6ReviewerActorDerivedClassificationCliOptions {
  actorPlan: string;
  actorRoot: string;
  output: string;
}

export function parseC6ReviewerActorDerivedClassificationCliOptions(
  args: readonly string[],
): C6ReviewerActorDerivedClassificationCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 reviewer actor v2 argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 reviewer actor v2 option --${name}`,
      );
    }
    if (values.has(name!)) {
      throw new Error(
        `--${name} cannot be specified more than once`,
      );
    }
    if (value!.length === 0 || value!.trim() !== value) {
      throw new Error(
        `--${name} must not be empty or padded`,
      );
    }
    values.set(name!, value!);
  }
  return {
    actorPlan: required(values, "actor-plan"),
    actorRoot: required(values, "actor-root"),
    output: required(values, "output"),
  };
}

export async function runC6ReviewerActorDerivedClassificationCommand(
  args: readonly string[],
): Promise<{
  counts: {
    actorCount: 267;
    newlyExcludedActorCount: 5;
    resolvedActorCount: 260;
    unresolvedActorCount: 7;
    v1EligibleActorCount: 254;
    v1IneligibleActorCount: 13;
    v2EligibleActorCount: 249;
    v2IneligibleActorCount: 18;
  };
  independentReviewCompleted: false;
  output: string;
  outputSha256: string;
  schemaVersion: 1;
}> {
  const options =
    parseC6ReviewerActorDerivedClassificationCliOptions(args);
  const result =
    await materializeC6ReviewerActorDerivedClassification({
      actorPlanPath: options.actorPlan,
      actorRoot: options.actorRoot,
      outputPath: options.output,
    });
  return {
    counts: result.classification.counts,
    independentReviewCompleted:
      result.classification.boundary.independentReviewCompleted,
    output: options.output,
    outputSha256: result.outputSha256,
    schemaVersion: 1,
  };
}

function required(
  values: ReadonlyMap<string, string>,
  name: string,
): string {
  const value = values.get(name);
  if (value === undefined) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

if (import.meta.main) {
  const result =
    await runC6ReviewerActorDerivedClassificationCommand(
      process.argv.slice(2),
    );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
