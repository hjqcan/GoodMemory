import {
  materializeC6ReviewerActorDerivedClassificationV3,
} from "./codex-coding-effect/c6-reviewer-actor-derived-classification-v3";

const OPTION_NAMES = new Set([
  "actor-plan",
  "actor-root",
  "output",
]);

export interface C6ReviewerActorDerivedClassificationV3CliOptions {
  actorPlan: string;
  actorRoot: string;
  output: string;
}

export function parseC6ReviewerActorDerivedClassificationV3CliOptions(
  args: readonly string[],
): C6ReviewerActorDerivedClassificationV3CliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 reviewer actor v3 argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 reviewer actor v3 option --${name}`,
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

export async function runC6ReviewerActorDerivedClassificationV3Command(
  args: readonly string[],
) {
  const options =
    parseC6ReviewerActorDerivedClassificationV3CliOptions(args);
  const result =
    await materializeC6ReviewerActorDerivedClassificationV3({
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
    schemaVersion: result.classification.schemaVersion,
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
  try {
    const result =
      await runC6ReviewerActorDerivedClassificationV3Command(
        process.argv.slice(2),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  }
}
