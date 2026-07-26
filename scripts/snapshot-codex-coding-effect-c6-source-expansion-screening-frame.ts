import {
  materializeC6SourceExpansionScreeningFrame,
} from "./codex-coding-effect/c6-source-expansion-screening-frame";

const OPTION_NAMES = new Set([
  "expected-inventory-sha256",
  "expected-legacy-frame-sha256",
  "expected-qualification-sha256",
  "inventory",
  "legacy-frame",
  "output",
  "qualification",
]);

export function parseC6SourceExpansionScreeningFrameCliOptions(
  args: readonly string[],
): {
  expectedInventorySha256: string;
  expectedLegacyFrameSha256: string;
  expectedQualificationSha256: string;
  inventory: string;
  legacyFrame: string;
  output: string;
  qualification: string;
} {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 source-expansion frame argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name)) {
      throw new Error(
        `unknown C6 source-expansion frame option --${name}`,
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
  const expectedInventorySha256 = required(
    values,
    "expected-inventory-sha256",
  );
  const expectedLegacyFrameSha256 = required(
    values,
    "expected-legacy-frame-sha256",
  );
  const expectedQualificationSha256 = required(
    values,
    "expected-qualification-sha256",
  );
  for (const [name, value] of [
    ["expected-inventory-sha256", expectedInventorySha256],
    ["expected-legacy-frame-sha256", expectedLegacyFrameSha256],
    ["expected-qualification-sha256", expectedQualificationSha256],
  ] as const) {
    if (!/^[a-f0-9]{64}$/u.test(value)) {
      throw new Error(`--${name} must be a lowercase SHA-256`);
    }
  }
  return {
    expectedInventorySha256,
    expectedLegacyFrameSha256,
    expectedQualificationSha256,
    inventory: required(values, "inventory"),
    legacyFrame: required(values, "legacy-frame"),
    output: required(values, "output"),
    qualification: required(values, "qualification"),
  };
}

export async function runC6SourceExpansionScreeningFrameSnapshotCommand(
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
  const options = parseC6SourceExpansionScreeningFrameCliOptions(args);
  const result = await materializeC6SourceExpansionScreeningFrame({
    expectedInventorySha256: options.expectedInventorySha256,
    expectedLegacyFrameSha256: options.expectedLegacyFrameSha256,
    expectedQualificationSha256: options.expectedQualificationSha256,
    inventoryPath: options.inventory,
    legacyFramePath: options.legacyFrame,
    outputPath: options.output,
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
      await runC6SourceExpansionScreeningFrameSnapshotCommand(
        process.argv.slice(2),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
