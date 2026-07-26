import {
  publishC6SourceV3SimplePriorIdentityPortableEvidence,
  verifyC6SourceV3SimplePriorIdentityPortableEvidence,
} from "./codex-coding-effect/c6-source-v3-simple-prior-identity-portable-evidence";

const OPTION_NAMES = new Set([
  "capture-a",
  "capture-b",
  "output-root",
  "plan",
  "protocol",
  "replay-receipt",
  "source-universe",
]);

export interface C6SourceV3SimplePriorIdentityPortableEvidenceCliOptions {
  captureA: string;
  captureB: string;
  outputRoot: string;
  planPath: string;
  protocolPath: string;
  replayReceiptPath: string;
  sourceUniversePath: string;
}

export function parseC6SourceV3SimplePriorIdentityPortableEvidenceCliOptions(
  args: readonly string[],
): C6SourceV3SimplePriorIdentityPortableEvidenceCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `unknown C6 source-v3-simple prior identity portable evidence argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 source-v3-simple prior identity portable evidence option --${name}`,
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
    captureA: required(values, "capture-a"),
    captureB: required(values, "capture-b"),
    outputRoot: required(values, "output-root"),
    planPath: required(values, "plan"),
    protocolPath: required(values, "protocol"),
    replayReceiptPath: required(
      values,
      "replay-receipt",
    ),
    sourceUniversePath: required(
      values,
      "source-universe",
    ),
  };
}

export async function materializeC6SourceV3SimplePriorIdentityPortableEvidence(
  input:
    C6SourceV3SimplePriorIdentityPortableEvidenceCliOptions,
) {
  await publishC6SourceV3SimplePriorIdentityPortableEvidence(
    input,
  );
  return verifyC6SourceV3SimplePriorIdentityPortableEvidence({
    outputRoot: input.outputRoot,
    planPath: input.planPath,
    protocolPath: input.protocolPath,
    sourceUniversePath: input.sourceUniversePath,
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
  const options =
    parseC6SourceV3SimplePriorIdentityPortableEvidenceCliOptions(
      process.argv.slice(2),
    );
  const result =
    await materializeC6SourceV3SimplePriorIdentityPortableEvidence(
      options,
    );
  console.log(JSON.stringify(result, null, 2));
}
