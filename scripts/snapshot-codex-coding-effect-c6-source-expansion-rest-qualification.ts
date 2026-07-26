import {
  materializeC6SourceExpansionRestQualification,
} from "./codex-coding-effect/c6-source-expansion-rest-qualification";

const OPTION_NAMES = new Set([
  "capture-plan",
  "expected-capture-plan-sha256",
  "expected-graphql-root-sha256",
  "expected-rest-root-sha256",
  "graphql-root",
  "output",
  "rest-root",
]);

export function parseC6SourceExpansionRestQualificationCliOptions(
  args: readonly string[],
): {
  capturePlan: string;
  expectedCapturePlanSha256: string;
  expectedGraphqlRootSha256: string;
  expectedRestRootSha256: string;
  graphqlRoot: string;
  output: string;
  restRoot: string;
} {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(`invalid C6 REST qualification argument ${argument}`);
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name)) {
      throw new Error(`unknown C6 REST qualification option --${name}`);
    }
    if (values.has(name)) {
      throw new Error(`--${name} cannot be specified more than once`);
    }
    if (value.length === 0 || value.trim() !== value) {
      throw new Error(`--${name} must not be empty or padded`);
    }
    values.set(name, value);
  }
  return {
    capturePlan: required(values, "capture-plan"),
    expectedCapturePlanSha256: sha256Option(
      values,
      "expected-capture-plan-sha256",
    ),
    expectedGraphqlRootSha256: sha256Option(
      values,
      "expected-graphql-root-sha256",
    ),
    expectedRestRootSha256: sha256Option(
      values,
      "expected-rest-root-sha256",
    ),
    graphqlRoot: required(values, "graphql-root"),
    output: required(values, "output"),
    restRoot: required(values, "rest-root"),
  };
}

export async function runC6SourceExpansionRestQualificationSnapshotCommand(
  args: readonly string[],
) {
  const options = parseC6SourceExpansionRestQualificationCliOptions(args);
  const result = await materializeC6SourceExpansionRestQualification({
    capturePlanPath: options.capturePlan,
    expectedCapturePlanSha256: options.expectedCapturePlanSha256,
    expectedGraphqlRootSha256: options.expectedGraphqlRootSha256,
    expectedRestRootSha256: options.expectedRestRootSha256,
    graphqlRoot: options.graphqlRoot,
    outputPath: options.output,
    restRoot: options.restRoot,
  });
  return {
    boundary: result.qualification.boundary,
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
      await runC6SourceExpansionRestQualificationSnapshotCommand(
        process.argv.slice(2),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
