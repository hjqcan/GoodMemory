import {
  captureC6SourceV3SimplePriorRepositoryIdentity,
} from "./codex-coding-effect/c6-source-v3-simple-prior-repository-identity";

const OPTION_NAMES = new Set([
  "output-root",
  "plan",
  "protocol",
  "source-universe",
  "token-env",
]);

export interface C6SourceV3SimplePriorRepositoryIdentityCliOptions {
  outputRoot: string;
  plan: string;
  protocol: string;
  sourceUniverse: string;
  tokenEnv: string;
}

export function parseC6SourceV3SimplePriorRepositoryIdentityCliOptions(
  args: readonly string[],
): C6SourceV3SimplePriorRepositoryIdentityCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 source-v3-simple prior identity argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 source-v3-simple prior identity option --${name}`,
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
  const tokenEnv = required(values, "token-env");
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(tokenEnv)) {
    throw new Error("--token-env must be an environment name");
  }
  return {
    outputRoot: required(values, "output-root"),
    plan: required(values, "plan"),
    protocol: required(values, "protocol"),
    sourceUniverse: required(values, "source-universe"),
    tokenEnv,
  };
}

export async function runC6SourceV3SimplePriorRepositoryIdentityCommand(
  args: readonly string[],
  environment: Readonly<
    Record<string, string | undefined>
  > = process.env,
) {
  const options =
    parseC6SourceV3SimplePriorRepositoryIdentityCliOptions(
      args,
    );
  const token = environment[options.tokenEnv];
  if (token === undefined || token.length === 0) {
    throw new Error(`${options.tokenEnv} is required`);
  }
  return await captureC6SourceV3SimplePriorRepositoryIdentity({
    authorizationToken: token,
    outputRoot: options.outputRoot,
    planPath: options.plan,
    protocolPath: options.protocol,
    sourceUniversePath: options.sourceUniverse,
  });
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
    await runC6SourceV3SimplePriorRepositoryIdentityCommand(
      process.argv.slice(2),
    );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
