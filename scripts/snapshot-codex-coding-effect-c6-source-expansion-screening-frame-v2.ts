import {
  materializeC6SourceExpansionScreeningFrameV2,
} from "./codex-coding-effect/c6-source-expansion-screening-frame-v2";

const OPTION_NAMES = new Set([
  "expected-prior-frame-sha256",
  "expected-qualification-sha256",
  "output",
  "prior-frame",
  "qualification",
]);

export function parseC6SourceExpansionScreeningFrameV2CliOptions(
  args: readonly string[],
): {
  expectedPriorFrameSha256: string;
  expectedQualificationSha256: string;
  output: string;
  priorFrame: string;
  qualification: string;
} {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 source-expansion frame v2 argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name)) {
      throw new Error(
        `unknown C6 source-expansion frame v2 option --${name}`,
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
  const expectedPriorFrameSha256 = required(
    values,
    "expected-prior-frame-sha256",
  );
  const expectedQualificationSha256 = required(
    values,
    "expected-qualification-sha256",
  );
  for (const [name, value] of [
    ["expected-prior-frame-sha256", expectedPriorFrameSha256],
    ["expected-qualification-sha256", expectedQualificationSha256],
  ] as const) {
    if (!/^[a-f0-9]{64}$/u.test(value)) {
      throw new Error(`--${name} must be a lowercase SHA-256`);
    }
  }
  return {
    expectedPriorFrameSha256,
    expectedQualificationSha256,
    output: required(values, "output"),
    priorFrame: required(values, "prior-frame"),
    qualification: required(values, "qualification"),
  };
}

export async function runC6SourceExpansionScreeningFrameV2SnapshotCommand(
  args: readonly string[],
): Promise<{
  boundary: {
    candidateManifestFrozen: false;
    codexRunReady: false;
  };
  counts: {
    combinedStructuralCandidateCount: number;
    repositoryCappedStructuralCeiling: number;
  };
  output: string;
  outputSha256: string;
}> {
  const options = parseC6SourceExpansionScreeningFrameV2CliOptions(args);
  const result = await materializeC6SourceExpansionScreeningFrameV2({
    expectedPriorFrameSha256: options.expectedPriorFrameSha256,
    expectedQualificationSha256: options.expectedQualificationSha256,
    outputPath: options.output,
    priorFramePath: options.priorFrame,
    qualificationPath: options.qualification,
  });
  return {
    boundary: result.frame.boundary,
    counts: result.frame.counts,
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
      await runC6SourceExpansionScreeningFrameV2SnapshotCommand(
        process.argv.slice(2),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
