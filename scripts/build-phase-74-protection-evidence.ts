import { createHash } from "node:crypto";
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
  isPhase74FrozenProtectionSuiteEvidencePromotionAdmissible,
  loadPhase74FrozenProtectionSuiteEvidence,
  rebuildPhase74FrozenProtectionSuiteEvidence,
} from "../src/eval/phase74ProtectionSuiteEvidence";
import type {
  Phase74FrozenProtectionSuiteEvidence,
  LoadedPhase74FrozenProtectionSuiteEvidence,
  Phase74ProtectionExecutionProfile,
  Phase74ProtectionSuiteEvidenceDependencies,
} from "../src/eval/phase74ProtectionSuiteEvidence";
import {
  buildPhase74BeamSafetyProtectionPlanIdentity,
  createPhase74BeamSafetyProtectionVerifier,
  parsePhase74BeamSafetyContract,
  PHASE74_BEAM_FULL_100K_DATASET_ID,
  PHASE74_BEAM_SAFETY_SUITE,
} from "../src/eval/phase74BeamSafetyProtection";
import type {
  Phase74BeamSafetyContract,
} from "../src/eval/phase74BeamSafetyProtection";
import {
  buildPhase74BeamSafetyLiveSpec,
  PHASE74_BEAM_FULL_100K_DATASET_PROVENANCE,
} from "../src/eval/phase74BeamSafetyLive";
import {
  buildPhase74HaluMemE4RunIdentity,
  buildPhase74HaluMemPrivacyPopulation,
  buildPhase74HaluMemPrivacyRunIdentity,
  buildPhase74HaluMemQuestionPopulation,
  buildPhase74HaluMemUpdatePopulation,
  buildPhase74HaluMemUpdateRunIdentity,
  parsePhase74HaluMemJsonl,
  PHASE74_HALUMEM_E4_SUITE,
  PHASE74_HALUMEM_PRIVACY_SUITE,
  PHASE74_HALUMEM_UPDATE_SUITE,
  phase74HaluMemPrivacyPopulationId,
  phase74HaluMemQuestionPopulationId,
  phase74HaluMemUpdatePopulationId,
} from "../src/eval/phase74HaluMemProtectionVerifier";
import {
  PHASE74_BGE_M3_EMBEDDING_MODEL,
  buildPhase74EmbeddingIdentity,
  PHASE74_EMBEDDING_GATEWAY,
  PHASE74_EMBEDDING_MODEL,
  PHASE74_GATEWAY,
  PHASE74_JUDGE_MODEL,
  PHASE74_LANGUAGE_MODEL,
} from "../src/eval/phase74Live";
import type {
  Phase74LiveModels,
} from "../src/eval/phase74Live";
import {
  isPhase74ProtectionPlanPromotionAdmissible,
  loadPhase74ProtectionPlan,
} from "../src/eval/phase74ProtectionPlan";
import type {
  Phase74ProtectionPlan,
} from "../src/eval/phase74ProtectionPlan";
import {
  PHASE74_MAB_PROTECTION_DATASET_ID,
  PHASE74_MAB_PROTECTION_DATASET_SHA256,
  PHASE74_MAB_PROTECTION_SUITE,
  parsePhase74MemoryAgentBenchDataset,
} from "../src/eval/phase74MemoryAgentBenchProtectionVerifier";
import {
  hashPhase74ProtectionCaseIds,
} from "../src/eval/phase74ProtectionContracts";
import type {
  Phase74ProtectionRunIdentity,
} from "../src/eval/phase74ProtectionContracts";
import { hashPhase74ProtectionValue } from "../src/eval/phase74ProtectionRun";
import {
  buildPhase74HaluMemLiveConfigurations,
} from "./phase-74-halumem-live-providers";
import {
  buildPhase74MemoryAgentBenchProtectionPlanIdentity,
} from "./phase-74-memory-agent-bench-protection";
import {
  PHASE74_CANONICAL_LIVE_CLOSURE_VERIFIER,
} from "./phase-74-protection-live-closure";
import {
  PHASE74_HALUMEM_MEDIUM_DATASET_ID,
  PHASE74_HALUMEM_MEDIUM_SHA256,
  PHASE74_HALUMEM_PROMOTION_USER_COUNT,
  selectPhase74HaluMemLiveUsers,
} from "./run-phase-74-halumem-live-protection";

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

interface CanonicalEvidenceContext {
  beamContract?: Phase74BeamSafetyContract;
  dependencies: Phase74ProtectionSuiteEvidenceDependencies;
}

async function canonicalEvidenceContext(
  beamContractPath?: string,
): Promise<CanonicalEvidenceContext> {
  const resolvedBeamContractPath = beamContractPath === undefined
    ? undefined
    : resolve(beamContractPath);
  const beamContract = resolvedBeamContractPath === undefined
    ? undefined
    : parsePhase74BeamSafetyContract(JSON.parse(
        await readFile(resolvedBeamContractPath, "utf8"),
      ));
  return {
    ...(beamContract === undefined ? {} : { beamContract }),
    dependencies: {
      additionalVerifiers: beamContract === undefined
        ? []
        : [createPhase74BeamSafetyProtectionVerifier(beamContract)],
      beamContractSourceFiles: resolvedBeamContractPath === undefined
        ? []
        : [resolvedBeamContractPath],
      liveClosureVerifier: PHASE74_CANONICAL_LIVE_CLOSURE_VERIFIER,
    },
  };
}

const CANONICAL_PROTECTION_SUITE_IDS = [
  PHASE74_MAB_PROTECTION_SUITE.id,
  PHASE74_HALUMEM_E4_SUITE.id,
  PHASE74_HALUMEM_UPDATE_SUITE.id,
  PHASE74_HALUMEM_PRIVACY_SUITE.id,
  PHASE74_BEAM_SAFETY_SUITE.id,
] as const;

function sameValue(left: unknown, right: unknown): boolean {
  return hashPhase74ProtectionValue(left) ===
    hashPhase74ProtectionValue(right);
}

export function assertPhase74CanonicalProtectionPlanIdentities(
  plan: Phase74ProtectionPlan,
  expectedIdentities: ReadonlyMap<string, Phase74ProtectionRunIdentity>,
): void {
  const expectedSuiteIds = [...CANONICAL_PROTECTION_SUITE_IDS].sort();
  if (
    [...expectedIdentities.keys()].sort().join("\0") !==
      expectedSuiteIds.join("\0")
  ) {
    throw new Error(
      "Phase 74 canonical protection identity reconstruction must contain exactly five suites.",
    );
  }
  for (const suiteId of expectedSuiteIds) {
    const expected = expectedIdentities.get(suiteId)!;
    const runs = plan.runs.filter(({ suite }) => suite.id === suiteId);
    if (runs.some(({ identity }) =>
      !sameValue(identity.dataset, expected.dataset)
    )) {
      const label = suiteId === PHASE74_BEAM_SAFETY_SUITE.id
        ? "BEAM dataset"
        : suiteId.startsWith("halumem-")
        ? "HaluMem dataset"
        : "MemoryAgentBench dataset";
      throw new Error(`Phase 74 canonical ${label} identity drifted.`);
    }
    if (runs.some(({ identity }) =>
      !sameValue(identity.population, expected.population)
    )) {
      const label = suiteId.startsWith("halumem-")
        ? "HaluMem 19-user population"
        : `${suiteId} population`;
      throw new Error(`Phase 74 canonical ${label} identity drifted.`);
    }
    if (runs.some(({ identity }) => !sameValue(identity, expected))) {
      throw new Error(
        `Phase 74 ${suiteId} full canonical identity drifted.`,
      );
    }
  }
}

function completeIdentity(
  identity: Omit<Phase74ProtectionRunIdentity, "population"> & {
    populationId: string;
  },
  caseIds: readonly string[],
): Phase74ProtectionRunIdentity {
  const { populationId, ...descriptors } = identity;
  return {
    ...descriptors,
    population: {
      caseCount: caseIds.length,
      caseIdsSha256: hashPhase74ProtectionCaseIds(caseIds),
      id: populationId,
    },
  };
}

function canonicalModels(embeddingModel: string): Phase74LiveModels {
  const language = {
    apiKey: "canonical-identity-only",
    baseURL: PHASE74_GATEWAY,
    model: PHASE74_LANGUAGE_MODEL,
    provider: "openai" as const,
  };
  return {
    answer: language,
    assistedExtraction: language,
    embedding: {
      apiKey: "canonical-identity-only",
      baseURL: PHASE74_EMBEDDING_GATEWAY,
      model: embeddingModel,
      provider: "openai" as const,
    },
    judge: {
      ...language,
      model: PHASE74_JUDGE_MODEL,
    },
    planner: language,
    reranker: language,
  };
}

type PlannedProtectionEvidence = Extract<
  Phase74FrozenProtectionSuiteEvidence,
  { schemaVersion: 2 }
>;

function suiteSource(
  evidence: PlannedProtectionEvidence,
  suiteId: string,
  expectedDataset: { id: string; sha256: string },
) {
  const suite = evidence.source.suites.find(({ id }) => id === suiteId);
  if (
    suite === undefined ||
    !sameValue(
      { id: suite.dataset.id, sha256: suite.dataset.sha256 },
      expectedDataset,
    )
  ) {
    throw new Error(
      `Phase 74 canonical ${suiteId} dataset identity drifted.`,
    );
  }
  return suite;
}

async function rebuildCanonicalProtectionIdentities(input: {
  beamContract: Phase74BeamSafetyContract;
  evidence: PlannedProtectionEvidence;
  plan: Phase74ProtectionPlan;
}): Promise<{
  identities: ReadonlyMap<string, Phase74ProtectionRunIdentity>;
  profile: Phase74ProtectionExecutionProfile;
}> {
  const source = input.plan.evaluatorSource;
  const mabDataset = {
    id: PHASE74_MAB_PROTECTION_DATASET_ID,
    sha256: PHASE74_MAB_PROTECTION_DATASET_SHA256,
  };
  const haluMemDataset = {
    id: PHASE74_HALUMEM_MEDIUM_DATASET_ID,
    sha256: PHASE74_HALUMEM_MEDIUM_SHA256,
  };
  const beamDataset = {
    id: PHASE74_BEAM_FULL_100K_DATASET_ID,
    sha256:
      PHASE74_BEAM_FULL_100K_DATASET_PROVENANCE.deterministicExport.sha256,
  };
  const mabSource = suiteSource(
    input.evidence,
    PHASE74_MAB_PROTECTION_SUITE.id,
    mabDataset,
  );
  const haluMemSources = [
    PHASE74_HALUMEM_E4_SUITE.id,
    PHASE74_HALUMEM_UPDATE_SUITE.id,
    PHASE74_HALUMEM_PRIVACY_SUITE.id,
  ].map((suiteId) =>
    suiteSource(input.evidence, suiteId, haluMemDataset)
  );
  const beamSource = suiteSource(
    input.evidence,
    PHASE74_BEAM_SAFETY_SUITE.id,
    beamDataset,
  );
  const [mabBytes, haluMemBytes, beamBytes] = await Promise.all([
    readFile(mabSource.dataset.path),
    readFile(haluMemSources[0]!.dataset.path),
    readFile(beamSource.dataset.path),
  ]);
  const mabCases = parsePhase74MemoryAgentBenchDataset(
    mabBytes.toString("utf8"),
    mabSource.dataset.path,
  );
  const mab = buildPhase74MemoryAgentBenchProtectionPlanIdentity({
    cases: mabCases,
    dataset: mabDataset,
    source,
  });
  const haluMemUsers = selectPhase74HaluMemLiveUsers({
    count: PHASE74_HALUMEM_PROMOTION_USER_COUNT,
    users: parsePhase74HaluMemJsonl(
      haluMemBytes.toString("utf8"),
      haluMemSources[0]!.dataset.path,
    ),
  });
  const questionCaseIds =
    buildPhase74HaluMemQuestionPopulation(haluMemUsers).cases
      .map(({ caseId }) => caseId);
  const updateCaseIds =
    buildPhase74HaluMemUpdatePopulation(haluMemUsers).cases
      .map(({ caseId }) => caseId);
  const privacyCaseIds =
    buildPhase74HaluMemPrivacyPopulation(haluMemUsers).cases
      .map(({ caseId }) => caseId);

  let lastError: unknown;
  for (const embeddingModel of [
    PHASE74_EMBEDDING_MODEL,
    PHASE74_BGE_M3_EMBEDDING_MODEL,
  ]) {
    try {
      const models = canonicalModels(embeddingModel);
      const expectedBeamContract = buildPhase74BeamSafetyLiveSpec({
        dataset: beamDataset,
        models,
        source,
      }).contract;
      if (!sameValue(input.beamContract, expectedBeamContract)) {
        throw new Error(
          "Phase 74 BEAM contract is not a canonical model and prompt profile.",
        );
      }
      const configurations = buildPhase74HaluMemLiveConfigurations(models);
      const expected = new Map<string, Phase74ProtectionRunIdentity>([
        [PHASE74_MAB_PROTECTION_SUITE.id, mab.identity],
        [
          PHASE74_HALUMEM_E4_SUITE.id,
          completeIdentity(buildPhase74HaluMemE4RunIdentity({
            configuration: configurations.e4,
            dataset: haluMemDataset,
            populationId: phase74HaluMemQuestionPopulationId(
              haluMemDataset.id,
              haluMemUsers,
            ),
            source,
          }), questionCaseIds),
        ],
        [
          PHASE74_HALUMEM_UPDATE_SUITE.id,
          completeIdentity(buildPhase74HaluMemUpdateRunIdentity({
            configuration: configurations.update,
            dataset: haluMemDataset,
            populationId: phase74HaluMemUpdatePopulationId(
              haluMemDataset.id,
              haluMemUsers,
            ),
            source,
          }), updateCaseIds),
        ],
        [
          PHASE74_HALUMEM_PRIVACY_SUITE.id,
          completeIdentity(buildPhase74HaluMemPrivacyRunIdentity({
            configuration: configurations.privacy,
            dataset: haluMemDataset,
            populationId: phase74HaluMemPrivacyPopulationId(
              haluMemDataset.id,
              haluMemUsers,
            ),
            source,
          }), privacyCaseIds),
        ],
        [
          PHASE74_BEAM_SAFETY_SUITE.id,
          buildPhase74BeamSafetyProtectionPlanIdentity({
            contract: expectedBeamContract,
            datasetBytes: beamBytes,
          }).identity,
        ],
      ]);
      assertPhase74CanonicalProtectionPlanIdentities(input.plan, expected);
      return {
        identities: expected,
        profile: {
          embedding: buildPhase74EmbeddingIdentity(models.embedding),
          reranker: {
            gateway: models.reranker.baseURL ?? "",
            implementation: "provider-listwise-v1",
            mode: "provider",
            model: models.reranker.model,
            provider: models.reranker.provider,
          },
        },
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    "Phase 74 protection plan does not match any full canonical model, prompt, dataset, and population identity.",
    { cause: lastError },
  );
}

async function sealCanonicalProtectionEvidence(
  evidence: Phase74FrozenProtectionSuiteEvidence,
  beamContract?: Phase74BeamSafetyContract,
): Promise<Phase74FrozenProtectionSuiteEvidence> {
  if (evidence.schemaVersion === 1) {
    return evidence;
  }
  const loadedPlan = await loadPhase74ProtectionPlan(
    evidence.source.plan.path,
  );
  const promotionAdmissible =
    isPhase74ProtectionPlanPromotionAdmissible(loadedPlan.plan) &&
    loadedPlan.sha256 === evidence.source.plan.sha256 &&
    evidence.source.executionReceipts.length === 6 &&
    evidence.source.beamContractSources.length === 1 &&
    beamContract !== undefined;
  let profile: Phase74ProtectionExecutionProfile | undefined;
  if (promotionAdmissible) {
    profile = (await rebuildCanonicalProtectionIdentities({
      beamContract,
      evidence,
      plan: loadedPlan.plan,
    })).profile;
  }
  return {
    ...evidence,
    admission: promotionAdmissible
      ? "promotion-admissible"
      : "diagnostic",
    source: {
      ...evidence.source,
      ...(profile === undefined ? {} : { profile }),
    },
  };
}

export async function loadCanonicalPhase74FrozenProtectionSuiteEvidence(
  path: string,
  options: { beamContractPath?: string } = {},
): Promise<LoadedPhase74FrozenProtectionSuiteEvidence> {
  const artifactPath = resolve(path);
  const bytes = await readFile(artifactPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error(
      "Phase 74 canonical frozen protection suite evidence must be valid JSON.",
      { cause: error },
    );
  }
  const context = await canonicalEvidenceContext(
    options.beamContractPath,
  );
  const derived = await rebuildPhase74FrozenProtectionSuiteEvidence(
    parsed,
    context.dependencies,
  );
  const sealed = await sealCanonicalProtectionEvidence(
    derived,
    context.beamContract,
  );
  if (
    hashPhase74ProtectionValue(parsed) !==
      hashPhase74ProtectionValue(sealed)
  ) {
    throw new Error(
      "Phase 74 canonical frozen protection suite evidence does not match its plan, verifier, and source runs.",
    );
  }
  return {
    evidence: sealed,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function runPhase74ProtectionEvidenceGeneration(
  options: Phase74ProtectionEvidenceCliOptions,
  dependencies?: {
    loadEvidence?: typeof loadPhase74FrozenProtectionSuiteEvidence;
  } & Phase74ProtectionSuiteEvidenceDependencies,
): Promise<Phase74FrozenProtectionSuiteEvidence> {
  const canonicalAuthority = dependencies === undefined;
  const injectedDependencies = dependencies ?? {};
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
  const canonicalContext = canonicalAuthority
    ? await canonicalEvidenceContext(options.beamContractPath)
    : undefined;
  const verifierDependencies = canonicalAuthority
    ? canonicalContext!.dependencies
    : injectedDependencies.verifiers === undefined
    ? {
        additionalVerifiers: [
          ...(injectedDependencies.additionalVerifiers ?? []),
          ...beamVerifier,
        ],
        liveClosureVerifier: injectedDependencies.liveClosureVerifier,
        beamContractSourceFiles:
          injectedDependencies.beamContractSourceFiles ??
          (options.beamContractPath === undefined
            ? []
            : [resolve(options.beamContractPath)]),
      }
    : {
        liveClosureVerifier: injectedDependencies.liveClosureVerifier,
        beamContractSourceFiles:
          injectedDependencies.beamContractSourceFiles ??
          (options.beamContractPath === undefined
            ? []
            : [resolve(options.beamContractPath)]),
        verifiers: [...injectedDependencies.verifiers, ...beamVerifier],
      };
  const derived = await buildPhase74FrozenProtectionSuiteEvidence({
    manifestPath,
    ...(planPath === undefined ? {} : { planPath }),
    runArtifactPaths,
  }, verifierDependencies);
  const evidence = canonicalAuthority
    ? await sealCanonicalProtectionEvidence(
        derived,
        canonicalContext!.beamContract,
      )
    : derived;
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
  const loaded = canonicalAuthority
    ? await loadCanonicalPhase74FrozenProtectionSuiteEvidence(outputPath, {
        ...(options.beamContractPath === undefined
          ? {}
          : { beamContractPath: options.beamContractPath }),
      })
    : await (
        injectedDependencies.loadEvidence ??
          loadPhase74FrozenProtectionSuiteEvidence
      )(outputPath, verifierDependencies);
  if (
    !canonicalAuthority &&
    isPhase74FrozenProtectionSuiteEvidencePromotionAdmissible(loaded.evidence)
  ) {
    throw new Error(
      "Phase 74 dependency-injected protection evidence is diagnostic only.",
    );
  }
  return loaded.evidence;
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
