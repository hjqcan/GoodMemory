import {
  materializeC6ReviewTrajectorySourceExpansion,
} from "./codex-coding-effect/c6-review-trajectory-source-expansion";

const OPTION_NAMES = new Set([
  "expected-inventory-sha256",
  "expected-legacy-frame-sha256",
  "graphql-capture-root",
  "inventory",
  "legacy-frame",
  "output",
]);

export interface C6ReviewTrajectorySourceExpansionCliOptions {
  expectedInventorySha256: string;
  expectedLegacyFrameSha256: string;
  graphqlCaptureRoot: string;
  inventory: string;
  legacyFrame: string;
  output: string;
}

export function parseC6ReviewTrajectorySourceExpansionCliOptions(
  args: readonly string[],
): C6ReviewTrajectorySourceExpansionCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(`invalid C6 source expansion argument ${argument}`);
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name)) {
      throw new Error(`unknown C6 source expansion option --${name}`);
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
    expectedInventorySha256: parseSha256(
      required(values, "expected-inventory-sha256"),
      "expected-inventory-sha256",
    ),
    expectedLegacyFrameSha256: parseSha256(
      required(values, "expected-legacy-frame-sha256"),
      "expected-legacy-frame-sha256",
    ),
    graphqlCaptureRoot: required(values, "graphql-capture-root"),
    inventory: required(values, "inventory"),
    legacyFrame: required(values, "legacy-frame"),
    output: required(values, "output"),
  };
}

export async function runC6ReviewTrajectorySourceExpansionSnapshotCommand(
  args: readonly string[],
): Promise<{
  boundary: {
    acceptedEpisodeCount: 0;
    candidateManifestFrozen: false;
    codexRunReady: false;
  };
  counts: {
    structuralPretargetCount: number;
    repositoryCappedStructuralCeiling: number;
  };
  output: string;
  outputSha256: string;
}> {
  const options = parseC6ReviewTrajectorySourceExpansionCliOptions(args);
  const result = await materializeC6ReviewTrajectorySourceExpansion({
    expectedInventorySha256: options.expectedInventorySha256,
    expectedLegacyFrameSha256: options.expectedLegacyFrameSha256,
    graphqlCaptureRoot: options.graphqlCaptureRoot,
    inventoryPath: options.inventory,
    legacyFramePath: options.legacyFrame,
    outputPath: options.output,
  });
  return {
    boundary: result.expansion.boundary,
    counts: result.expansion.counts,
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

function parseSha256(value: string, name: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`--${name} must be a lowercase SHA-256`);
  }
  return value;
}

if (import.meta.main) {
  try {
    const result =
      await runC6ReviewTrajectorySourceExpansionSnapshotCommand(
        process.argv.slice(2),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
