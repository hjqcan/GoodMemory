import {
  materializeC6SourceExpansionRestCapturePlan,
} from "./codex-coding-effect/c6-source-expansion-rest-capture-plan";

const OPTION_NAMES = new Set([
  "expected-expansion-sha256",
  "expansion",
  "output",
  "source-root",
]);

export function parseC6SourceExpansionRestCapturePlanCliOptions(
  args: readonly string[],
): {
  expectedExpansionSha256: string;
  expansion: string;
  output: string;
  sourceRoot: string;
} {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(`invalid C6 REST capture plan argument ${argument}`);
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name)) {
      throw new Error(`unknown C6 REST capture plan option --${name}`);
    }
    if (values.has(name)) {
      throw new Error(`--${name} cannot be specified more than once`);
    }
    if (value.length === 0 || value.trim() !== value) {
      throw new Error(`--${name} must not be empty or padded`);
    }
    values.set(name, value);
  }
  const expectedExpansionSha256 = required(
    values,
    "expected-expansion-sha256",
  );
  if (!/^[a-f0-9]{64}$/u.test(expectedExpansionSha256)) {
    throw new Error(
      "--expected-expansion-sha256 must be a lowercase SHA-256",
    );
  }
  return {
    expectedExpansionSha256,
    expansion: required(values, "expansion"),
    output: required(values, "output"),
    sourceRoot: required(values, "source-root"),
  };
}

export async function runC6SourceExpansionRestCapturePlanSnapshotCommand(
  args: readonly string[],
): Promise<{
  boundary: {
    captureExecuted: false;
    codexRunReady: false;
  };
  counts: {
    repositoryCount: number;
    targetCount: number;
  };
  output: string;
  outputSha256: string;
}> {
  const options = parseC6SourceExpansionRestCapturePlanCliOptions(args);
  const result = await materializeC6SourceExpansionRestCapturePlan({
    expectedExpansionSha256: options.expectedExpansionSha256,
    expansionPath: options.expansion,
    outputPath: options.output,
    sourceRoot: options.sourceRoot,
  });
  return {
    boundary: result.plan.boundary,
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
      await runC6SourceExpansionRestCapturePlanSnapshotCommand(
        process.argv.slice(2),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
