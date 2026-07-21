import {
  mkdir,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  resolve,
} from "node:path";

import {
  buildPhase74FrozenProtectionEvidence,
} from "../src/eval/phase74ProtectionEvidence";
import type {
  Phase74FrozenProtectionEvidence,
} from "../src/eval/phase74ProtectionEvidence";

export interface Phase74ProtectionEvidenceCliOptions {
  outputPath: string;
  runArtifactPaths: [string, string, string];
}

function optionValue(
  argv: readonly string[],
  index: number,
  flag: string,
): string {
  const value = argv[index + 1];
  if (
    value === undefined ||
    value.startsWith("--") ||
    value === "" ||
    value.trim() !== value
  ) {
    throw new Error(`${flag} requires a non-empty, non-whitespace-padded path.`);
  }
  return value;
}

export function parsePhase74ProtectionEvidenceCliOptions(
  argv: readonly string[],
): Phase74ProtectionEvidenceCliOptions {
  const runArtifactPaths: string[] = [];
  let outputPath: string | undefined;
  let sawOption = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (!flag.startsWith("--")) {
      if (sawOption) {
        throw new Error(
          `Phase 74 protection evidence received unexpected positional argument ${flag}.`,
        );
      }
      continue;
    }
    sawOption = true;
    if (flag !== "--output" && flag !== "--run-artifact") {
      throw new Error(
        `Phase 74 protection evidence received unknown option ${flag}.`,
      );
    }
    const value = resolve(optionValue(argv, index, flag));
    index += 1;
    if (flag === "--run-artifact") {
      runArtifactPaths.push(value);
    } else if (outputPath !== undefined) {
      throw new Error("--output cannot be specified more than once.");
    } else {
      outputPath = value;
    }
  }
  if (runArtifactPaths.length !== 3) {
    throw new Error(
      "Phase 74 protection evidence requires exactly three --run-artifact paths.",
    );
  }
  if (new Set(runArtifactPaths).size !== runArtifactPaths.length) {
    throw new Error("--run-artifact paths must be unique.");
  }
  if (outputPath === undefined) {
    throw new Error("Phase 74 protection evidence requires --output.");
  }
  if (runArtifactPaths.includes(outputPath)) {
    throw new Error("--output must not overwrite a frozen run artifact.");
  }
  return {
    outputPath,
    runArtifactPaths: runArtifactPaths as [string, string, string],
  };
}

export async function runPhase74ProtectionEvidenceGeneration(
  options: Phase74ProtectionEvidenceCliOptions,
): Promise<Phase74FrozenProtectionEvidence> {
  const outputPath = resolve(options.outputPath);
  const evidence = await buildPhase74FrozenProtectionEvidence({
    runArtifactPaths: options.runArtifactPaths,
  });
  if (evidence.source.files.some(({ rawArtifactPath }) =>
    rawArtifactPath === outputPath
  )) {
    throw new Error("--output must not overwrite a frozen raw artifact.");
  }
  if (evidence.source.files.some(({ artifactPath }) =>
    artifactPath === outputPath
  )) {
    throw new Error("--output must not overwrite a frozen run artifact.");
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
  return evidence;
}

if (import.meta.main) {
  const options = parsePhase74ProtectionEvidenceCliOptions(process.argv);
  const evidence = await runPhase74ProtectionEvidenceGeneration(options);
  console.log(JSON.stringify({
    outputPath: options.outputPath,
    pairedRowCount: evidence.derivation.pairedRowCount,
    protectionMetricCount: evidence.promotion.protections.length,
    runIds: evidence.source.runIds,
  }, null, 2));
}
