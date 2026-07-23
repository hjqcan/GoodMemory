import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  resolve,
} from "node:path";

import {
  buildPhase74FrozenProtectionSuiteEvidence,
  loadPhase74FrozenProtectionSuiteEvidence,
} from "../src/eval/phase74ProtectionSuiteEvidence";
import type {
  Phase74FrozenProtectionSuiteEvidence,
  Phase74ProtectionSuiteEvidenceDependencies,
} from "../src/eval/phase74ProtectionSuiteEvidence";
import {
  createPhase74BeamSafetyProtectionVerifier,
  parsePhase74BeamSafetyContract,
} from "../src/eval/phase74BeamSafetyProtection";
import {
  PHASE74_CANONICAL_LIVE_CLOSURE_VERIFIER,
} from "./phase-74-protection-live-closure";

export interface Phase74ProtectionEvidenceCliOptions {
  beamContractPath?: string;
  manifestPath: string;
  outputPath: string;
  planPath?: string;
  runArtifactPaths: string[];
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
  let manifestPath: string | undefined;
  let outputPath: string | undefined;
  let beamContractPath: string | undefined;
  let planPath: string | undefined;
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
    if (
      flag !== "--manifest" &&
      flag !== "--output" &&
      flag !== "--run-artifact" &&
      flag !== "--beam-contract" &&
      flag !== "--protection-plan"
    ) {
      throw new Error(
        `Phase 74 protection evidence received unknown option ${flag}.`,
      );
    }
    const value = resolve(optionValue(argv, index, flag));
    index += 1;
    if (flag === "--run-artifact") {
      runArtifactPaths.push(value);
    } else if (flag === "--beam-contract") {
      if (beamContractPath !== undefined) {
        throw new Error("--beam-contract cannot be specified more than once.");
      }
      beamContractPath = value;
    } else if (flag === "--protection-plan") {
      if (planPath !== undefined) {
        throw new Error(
          "--protection-plan cannot be specified more than once.",
        );
      }
      planPath = value;
    } else if (flag === "--manifest") {
      if (manifestPath !== undefined) {
        throw new Error("--manifest cannot be specified more than once.");
      }
      manifestPath = value;
    } else if (outputPath !== undefined) {
      throw new Error("--output cannot be specified more than once.");
    } else {
      outputPath = value;
    }
  }
  if (manifestPath === undefined) {
    throw new Error(
      "Phase 74 protection evidence requires exactly one --manifest path.",
    );
  }
  if (runArtifactPaths.length === 0) {
    throw new Error(
      "Phase 74 protection evidence requires at least one --run-artifact path.",
    );
  }
  if (new Set(runArtifactPaths).size !== runArtifactPaths.length) {
    throw new Error("--run-artifact paths must be unique.");
  }
  if (outputPath === undefined) {
    throw new Error("Phase 74 protection evidence requires --output.");
  }
  if (outputPath === manifestPath) {
    throw new Error("--output must not overwrite the suite manifest.");
  }
  if (runArtifactPaths.includes(outputPath)) {
    throw new Error("--output must not overwrite a frozen run artifact.");
  }
  if (beamContractPath === outputPath) {
    throw new Error("--output must not overwrite the trusted BEAM contract.");
  }
  if (planPath === outputPath) {
    throw new Error("--output must not overwrite the protection plan.");
  }
  return {
    ...(beamContractPath === undefined ? {} : { beamContractPath }),
    manifestPath,
    outputPath,
    ...(planPath === undefined ? {} : { planPath }),
    runArtifactPaths,
  };
}

export async function runPhase74ProtectionEvidenceGeneration(
  options: Phase74ProtectionEvidenceCliOptions,
  dependencies: {
    loadEvidence?: typeof loadPhase74FrozenProtectionSuiteEvidence;
  } & Phase74ProtectionSuiteEvidenceDependencies = {},
): Promise<Phase74FrozenProtectionSuiteEvidence> {
  const manifestPath = resolve(options.manifestPath);
  const outputPath = resolve(options.outputPath);
  const runArtifactPaths = options.runArtifactPaths.map((path) => resolve(path));
  if (outputPath === manifestPath) {
    throw new Error("--output must not overwrite the suite manifest.");
  }
  if (runArtifactPaths.includes(outputPath)) {
    throw new Error("--output must not overwrite a frozen run artifact.");
  }
  if (
    options.beamContractPath !== undefined &&
    resolve(options.beamContractPath) === outputPath
  ) {
    throw new Error("--output must not overwrite the trusted BEAM contract.");
  }
  const planPath = options.planPath === undefined
    ? undefined
    : resolve(options.planPath);
  if (planPath === outputPath) {
    throw new Error("--output must not overwrite the protection plan.");
  }
  const beamVerifier = options.beamContractPath === undefined
    ? []
    : [createPhase74BeamSafetyProtectionVerifier(
        parsePhase74BeamSafetyContract(JSON.parse(
          await readFile(resolve(options.beamContractPath), "utf8"),
        )),
      )];
  const verifierDependencies = dependencies.verifiers === undefined
    ? {
        additionalVerifiers: [
          ...(dependencies.additionalVerifiers ?? []),
          ...beamVerifier,
        ],
        liveClosureVerifier: dependencies.liveClosureVerifier ??
          PHASE74_CANONICAL_LIVE_CLOSURE_VERIFIER,
        verifierSourceFiles: dependencies.verifierSourceFiles ??
          (options.beamContractPath === undefined
            ? []
            : [resolve(options.beamContractPath)]),
      }
    : {
        liveClosureVerifier: dependencies.liveClosureVerifier ??
          PHASE74_CANONICAL_LIVE_CLOSURE_VERIFIER,
        verifierSourceFiles: dependencies.verifierSourceFiles ??
          (options.beamContractPath === undefined
            ? []
            : [resolve(options.beamContractPath)]),
        verifiers: [...dependencies.verifiers, ...beamVerifier],
      };
  const evidence = await buildPhase74FrozenProtectionSuiteEvidence({
    manifestPath,
    ...(planPath === undefined ? {} : { planPath }),
    runArtifactPaths,
  }, verifierDependencies);
  const sourceFiles = evidence.source.suites.flatMap(({ files }) => files);
  if (sourceFiles.some(({ rawArtifactPath }) => rawArtifactPath === outputPath)) {
    throw new Error("--output must not overwrite a frozen raw artifact.");
  }
  if (sourceFiles.some(({ artifactPath }) => artifactPath === outputPath)) {
    throw new Error("--output must not overwrite a frozen run artifact.");
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(evidence, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return (await (
    dependencies.loadEvidence ?? loadPhase74FrozenProtectionSuiteEvidence
  )(outputPath, verifierDependencies)).evidence;
}

if (import.meta.main) {
  const options = parsePhase74ProtectionEvidenceCliOptions(process.argv);
  const evidence = await runPhase74ProtectionEvidenceGeneration(options);
  console.log(JSON.stringify({
    outputPath: options.outputPath,
    pairedRowCount: evidence.derivation.pairedRowCount,
    protectionMetricCount: evidence.promotion.protections.length,
    replicateCountPerSuite: evidence.derivation.replicateCountPerSuite,
    suiteCount: evidence.derivation.suiteCount,
    suiteIds: evidence.source.suites.map(({ id }) => id),
  }, null, 2));
}
