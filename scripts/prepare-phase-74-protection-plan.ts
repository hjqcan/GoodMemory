#!/usr/bin/env bun
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  buildPhase74BeamSafetyLiveSpec,
  PHASE74_BEAM_FULL_100K_DATASET_PROVENANCE,
} from "../src/eval/phase74BeamSafetyLive";
import {
  buildPhase74BeamSafetyProtectionPlanIdentity,
  PHASE74_BEAM_FULL_100K_DATASET_ID,
  PHASE74_BEAM_SAFETY_BUDGET,
  PHASE74_BEAM_SAFETY_METRICS,
  PHASE74_BEAM_SAFETY_SUITE,
  PHASE74_BEAM_SAFETY_VERIFIER_ID,
} from "../src/eval/phase74BeamSafetyProtection";
import {
  buildPhase74HaluMemE4RunIdentity,
  buildPhase74HaluMemPrivacyPopulation,
  buildPhase74HaluMemPrivacyRunIdentity,
  buildPhase74HaluMemQuestionPopulation,
  buildPhase74HaluMemUpdatePopulation,
  buildPhase74HaluMemUpdateRunIdentity,
  PHASE74_HALUMEM_CONTEXT_TOKEN_BUDGET,
  PHASE74_HALUMEM_E4_METRIC,
  PHASE74_HALUMEM_E4_PROTECTION_VERIFIER_ID,
  PHASE74_HALUMEM_E4_SUITE,
  PHASE74_HALUMEM_PRIVACY_PROTECTION_VERIFIER_ID,
  PHASE74_HALUMEM_PRIVACY_SUITE,
  PHASE74_HALUMEM_UPDATE_PROTECTION_VERIFIER_ID,
  PHASE74_HALUMEM_UPDATE_SUITE,
  phase74HaluMemPrivacyPopulationId,
  phase74HaluMemQuestionPopulationId,
  phase74HaluMemUpdatePopulationId,
  parsePhase74HaluMemJsonl,
} from "../src/eval/phase74HaluMemProtectionVerifier";
import {
  capturePhase74EvaluatorSource,
  resolvePhase74LiveModels,
} from "../src/eval/phase74Live";
import type {
  Phase74EvaluatorSource,
  Phase74LiveModels,
} from "../src/eval/phase74Live";
import {
  PHASE74_MAB_PROTECTION_DATASET_ID,
  PHASE74_MAB_PROTECTION_DATASET_SHA256,
  PHASE74_MAB_PROTECTION_METRICS,
  PHASE74_MAB_PROTECTION_SUITE,
  PHASE74_MAB_PROTECTION_VERIFIER_ID,
  parsePhase74MemoryAgentBenchDataset,
} from "../src/eval/phase74MemoryAgentBenchProtectionVerifier";
import {
  hashPhase74ProtectionCaseIds,
  parsePhase74ProtectionRunIdentity,
} from "../src/eval/phase74ProtectionContracts";
import type {
  Phase74ProtectionIdentityDescriptor,
  Phase74ProtectionReplicate,
  Phase74ProtectionRunIdentity,
} from "../src/eval/phase74ProtectionContracts";
import {
  buildPhase74ProtectionPlan,
  describePhase74ProtectionCallBudget,
  loadPhase74ProtectionPlan,
} from "../src/eval/phase74ProtectionPlan";
import type {
  LoadedPhase74ProtectionPlan,
  Phase74ProtectionPlanControls,
  Phase74ProtectionPlanRunInput,
} from "../src/eval/phase74ProtectionPlan";
import type {
  Phase74ProtectionRunIdentityInput,
  Phase74ProtectionSuite,
} from "../src/eval/phase74ProtectionRun";
import {
  hashPhase74ProtectionValue,
} from "../src/eval/phase74ProtectionRun";
import {
  PHASE74_PROTECTION_BLUEPRINT_ID,
} from "../src/eval/phase74ProtectionVerifier";
import {
  hashPhase74ProtectionSuiteIdentity,
  loadPhase74ProtectionSuiteManifest,
} from "../src/eval/phase74ProtectionSuiteEvidence";
import type {
  Phase74ProtectionSuiteManifest,
} from "../src/eval/phase74ProtectionSuiteEvidence";
import {
  buildPhase74HaluMemLiveConfigurations,
} from "./phase-74-halumem-live-providers";
import {
  buildPhase74MemoryAgentBenchProtectionPlanIdentity,
  PHASE74_MAB_PROTECTION_CASE_CONCURRENCY,
} from "./phase-74-memory-agent-bench-protection";
import { assertCliPathSegmentValue } from "./cli-options";
import {
  PHASE74_HALUMEM_MEDIUM_DATASET_ID,
  PHASE74_HALUMEM_MEDIUM_SHA256,
  PHASE74_HALUMEM_PROMOTION_USER_COUNT,
  selectPhase74HaluMemLiveUsers,
} from "./run-phase-74-halumem-live-protection";
import { resolveRepoRootFromScriptUrl } from "./script-paths";

const REPLICATES = [1, 2, 3] as const;
const FLAGS = [
  "--beam-case-concurrency",
  "--beam-dataset-path",
  "--beam-embedding-spend-limit-usd",
  "--beam-max-language-calls",
  "--halumem-case-concurrency",
  "--halumem-dataset-path",
  "--halumem-embedding-spend-limit-usd",
  "--halumem-max-language-calls",
  "--mab-benchmark-root",
  "--output",
  "--protection-manifest",
  "--run-id-prefix",
] as const;

type Flag = (typeof FLAGS)[number];

export interface Phase74ProtectionPlanBuilderCliOptions {
  beamCaseConcurrency: number;
  beamDatasetPath: string;
  beamEmbeddingSpendLimitUsd: number;
  beamMaxLanguageCalls: number;
  haluMemCaseConcurrency: number;
  haluMemDatasetPath: string;
  haluMemEmbeddingSpendLimitUsd: number;
  haluMemMaxLanguageCalls: number;
  mabBenchmarkRoot: string;
  outputPath: string;
  protectionManifestPath: string;
  runIdPrefix: string;
}

interface Phase74BeamPlanMaterial {
  caseIds: string[];
  identity: Phase74ProtectionRunIdentity;
}

export interface Phase74ProtectionPlanBuilderDependencies {
  captureEvaluatorSource?(input: {
    repoRoot: string;
  }): Promise<Phase74EvaluatorSource>;
  prepareBeam?(input: {
    datasetBytes: Uint8Array;
    models: Phase74LiveModels;
    source: Phase74ProtectionIdentityDescriptor;
  }): Phase74BeamPlanMaterial;
  expectedHaluMemDatasetSha256?: string;
  expectedMabDatasetSha256?: string;
  readFile?(path: string): Promise<Uint8Array>;
  resolveModels?(
    env: Record<string, string | undefined>,
  ): Phase74LiveModels;
}

const DEFAULT_DEPENDENCIES: Phase74ProtectionPlanBuilderDependencies =
  Object.freeze({});

function parseFlags(args: readonly string[]): Map<Flag, string> {
  const allowed = new Set<string>(FLAGS);
  const values = new Map<Flag, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (flag === undefined || !flag.startsWith("--") || !allowed.has(flag)) {
      throw new Error(
        `Phase 74 protection plan builder received unknown option ${flag ?? ""}.`,
      );
    }
    if (values.has(flag as Flag)) {
      throw new Error(`${flag} cannot be specified more than once.`);
    }
    const value = args[index + 1];
    if (
      value === undefined ||
      value.startsWith("--") ||
      value === "" ||
      value.trim() !== value
    ) {
      throw new Error(`${flag} requires a non-empty trimmed value.`);
    }
    values.set(flag as Flag, value);
  }
  return values;
}

function required(values: ReadonlyMap<Flag, string>, flag: Flag): string {
  const value = values.get(flag);
  if (value === undefined) {
    throw new Error(`Phase 74 protection plan builder requires ${flag}.`);
  }
  return value;
}

function positiveInteger(value: string, flag: Flag): number {
  if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return Number(value);
}

function positiveNumber(value: string, flag: Flag): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive number.`);
  }
  return parsed;
}

export function parsePhase74ProtectionPlanBuilderCliOptions(
  args: readonly string[],
): Phase74ProtectionPlanBuilderCliOptions {
  const values = parseFlags(args);
  const runIdPrefix = required(values, "--run-id-prefix");
  assertCliPathSegmentValue({
    flag: "--run-id-prefix",
    value: runIdPrefix,
  });
  const outputPath = resolve(required(values, "--output"));
  const protectionManifestPath = resolve(
    required(values, "--protection-manifest"),
  );
  if (outputPath === protectionManifestPath) {
    throw new Error(
      "--output and --protection-manifest must refer to different paths.",
    );
  }
  return {
    beamCaseConcurrency: positiveInteger(
      required(values, "--beam-case-concurrency"),
      "--beam-case-concurrency",
    ),
    beamDatasetPath: resolve(required(values, "--beam-dataset-path")),
    beamEmbeddingSpendLimitUsd: positiveNumber(
      required(values, "--beam-embedding-spend-limit-usd"),
      "--beam-embedding-spend-limit-usd",
    ),
    beamMaxLanguageCalls: positiveInteger(
      required(values, "--beam-max-language-calls"),
      "--beam-max-language-calls",
    ),
    haluMemCaseConcurrency: positiveInteger(
      required(values, "--halumem-case-concurrency"),
      "--halumem-case-concurrency",
    ),
    haluMemDatasetPath: resolve(required(values, "--halumem-dataset-path")),
    haluMemEmbeddingSpendLimitUsd: positiveNumber(
      required(values, "--halumem-embedding-spend-limit-usd"),
      "--halumem-embedding-spend-limit-usd",
    ),
    haluMemMaxLanguageCalls: positiveInteger(
      required(values, "--halumem-max-language-calls"),
      "--halumem-max-language-calls",
    ),
    mabBenchmarkRoot: resolve(required(values, "--mab-benchmark-root")),
    outputPath,
    protectionManifestPath,
    runIdPrefix,
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalVerifier(id: string): Phase74ProtectionIdentityDescriptor {
  return {
    id,
    sha256: hashPhase74ProtectionValue({ id }),
  };
}

function completeIdentity(
  identity: Phase74ProtectionRunIdentityInput,
  caseIds: readonly string[],
): Phase74ProtectionRunIdentity {
  const { populationId, ...descriptors } = identity;
  return parsePhase74ProtectionRunIdentity({
    ...descriptors,
    population: {
      caseCount: caseIds.length,
      caseIdsSha256: hashPhase74ProtectionCaseIds(caseIds),
      id: populationId,
    },
  }, "protection plan builder identity");
}

function replicateRuns(input: {
  caseIds: readonly string[];
  controls: Phase74ProtectionPlanControls;
  identity: Phase74ProtectionRunIdentity;
  protectionBlueprint: Phase74ProtectionIdentityDescriptor;
  runId(replicate: Phase74ProtectionReplicate): string;
  suite: Phase74ProtectionSuite;
  verifierId: string;
}): Phase74ProtectionPlanRunInput[] {
  const verifier = canonicalVerifier(input.verifierId);
  return REPLICATES.map((replicate) => ({
    caseIds: input.caseIds,
    controls: input.controls,
    identity: input.identity,
    protectionBlueprint: input.protectionBlueprint,
    replicate,
    runId: input.runId(replicate),
    suite: input.suite,
    verifier,
  }));
}

async function assertCreateOnlyOutput(path: string): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error(`Phase 74 protection plan output already exists: ${path}`);
}

function defaultPrepareBeam(input: {
  datasetBytes: Uint8Array;
  models: Phase74LiveModels;
  source: Phase74ProtectionIdentityDescriptor;
}): Phase74BeamPlanMaterial {
  const spec = buildPhase74BeamSafetyLiveSpec({
    dataset: {
      id: PHASE74_BEAM_FULL_100K_DATASET_ID,
      sha256: sha256(input.datasetBytes),
    },
    models: input.models,
    source: input.source,
  });
  return buildPhase74BeamSafetyProtectionPlanIdentity({
    contract: spec.contract,
    datasetBytes: input.datasetBytes,
  });
}

export async function preparePhase74ProtectionPlan(
  options: Phase74ProtectionPlanBuilderCliOptions,
  dependencies: Phase74ProtectionPlanBuilderDependencies =
    DEFAULT_DEPENDENCIES,
  env: Record<string, string | undefined> = process.env,
): Promise<LoadedPhase74ProtectionPlan> {
  await assertCreateOnlyOutput(options.outputPath);
  await assertCreateOnlyOutput(options.protectionManifestPath);

  const read = dependencies.readFile ?? readFile;
  const models = (dependencies.resolveModels ?? resolvePhase74LiveModels)(env);
  const [
    evaluatorSource,
    mabDatasetBytes,
    haluMemDatasetBytes,
    beamDatasetBytes,
  ] = await Promise.all([
    (dependencies.captureEvaluatorSource ?? capturePhase74EvaluatorSource)({
      repoRoot: resolveRepoRootFromScriptUrl(import.meta.url),
    }),
    read(join(options.mabBenchmarkRoot, "cases.json")),
    read(options.haluMemDatasetPath),
    read(options.beamDatasetPath),
  ]);
  const source = {
    id: `git:${evaluatorSource.commit}`,
    sha256: evaluatorSource.sha256,
  };

  const expectedMabDatasetSha256 =
    dependencies.expectedMabDatasetSha256 ??
      PHASE74_MAB_PROTECTION_DATASET_SHA256;
  const mabDatasetSha256 = sha256(mabDatasetBytes);
  if (mabDatasetSha256 !== expectedMabDatasetSha256) {
    throw new Error(
      `Phase 74 protection plan requires the official ${PHASE74_MAB_PROTECTION_DATASET_ID} dataset SHA-256.`,
    );
  }
  const mabCases = parsePhase74MemoryAgentBenchDataset(
    Buffer.from(mabDatasetBytes).toString("utf8"),
    join(options.mabBenchmarkRoot, "cases.json"),
  );
  const mab = buildPhase74MemoryAgentBenchProtectionPlanIdentity({
    cases: mabCases,
    dataset: {
      id: PHASE74_MAB_PROTECTION_DATASET_ID,
      sha256: mabDatasetSha256,
    },
    source,
  });

  const expectedHaluMemDatasetSha256 =
    dependencies.expectedHaluMemDatasetSha256 ??
      PHASE74_HALUMEM_MEDIUM_SHA256;
  const haluMemDatasetSha256 = sha256(haluMemDatasetBytes);
  if (haluMemDatasetSha256 !== expectedHaluMemDatasetSha256) {
    throw new Error(
      "Phase 74 protection plan requires the official HaluMem-Medium dataset SHA-256.",
    );
  }
  const haluMemUsers = selectPhase74HaluMemLiveUsers({
    count: PHASE74_HALUMEM_PROMOTION_USER_COUNT,
    users: parsePhase74HaluMemJsonl(
      Buffer.from(haluMemDatasetBytes).toString("utf8"),
      options.haluMemDatasetPath,
    ),
  });
  const haluMemDataset = {
    id: PHASE74_HALUMEM_MEDIUM_DATASET_ID,
    sha256: haluMemDatasetSha256,
  };
  const haluMemConfigurations = buildPhase74HaluMemLiveConfigurations(models);
  const haluMemE4Population =
    buildPhase74HaluMemQuestionPopulation(haluMemUsers);
  const haluMemUpdatePopulation =
    buildPhase74HaluMemUpdatePopulation(haluMemUsers);
  const haluMemPrivacyPopulation =
    buildPhase74HaluMemPrivacyPopulation(haluMemUsers);
  const haluMemE4CaseIds = haluMemE4Population.cases.map(({ caseId }) => caseId);
  const haluMemUpdateCaseIds = haluMemUpdatePopulation.cases.map(
    ({ caseId }) => caseId,
  );
  const haluMemPrivacyCaseIds = haluMemPrivacyPopulation.cases.map(
    ({ caseId }) => caseId,
  );

  const beam = (dependencies.prepareBeam ?? defaultPrepareBeam)({
    datasetBytes: beamDatasetBytes,
    models,
    source,
  });
  const mabControls = {
    callBudget: describePhase74ProtectionCallBudget(
      "no-live-model-calls-v1",
    ),
    caseConcurrency: PHASE74_MAB_PROTECTION_CASE_CONCURRENCY,
    renderedContextTokens: 6_000,
  };
  const haluMemControls = {
    callBudget: describePhase74ProtectionCallBudget({
      embeddingSpendLimitUsd: options.haluMemEmbeddingSpendLimitUsd,
      maxLanguageCalls: options.haluMemMaxLanguageCalls,
    }),
    caseConcurrency: options.haluMemCaseConcurrency,
    renderedContextTokens: PHASE74_HALUMEM_CONTEXT_TOKEN_BUDGET,
  };
  const beamControls = {
    callBudget: describePhase74ProtectionCallBudget({
      embeddingSpendLimitUsd: options.beamEmbeddingSpendLimitUsd,
      maxLanguageCalls: options.beamMaxLanguageCalls,
    }),
    caseConcurrency: options.beamCaseConcurrency,
    renderedContextTokens: PHASE74_BEAM_SAFETY_BUDGET.renderedContextTokens,
  };
  const haluMemE4Identity = completeIdentity(
    buildPhase74HaluMemE4RunIdentity({
      configuration: haluMemConfigurations.e4,
      dataset: haluMemDataset,
      populationId: phase74HaluMemQuestionPopulationId(
        haluMemDataset.id,
        haluMemUsers,
      ),
      source,
    }),
    haluMemE4CaseIds,
  );
  const haluMemUpdateIdentity = completeIdentity(
    buildPhase74HaluMemUpdateRunIdentity({
      configuration: haluMemConfigurations.update,
      dataset: haluMemDataset,
      populationId: phase74HaluMemUpdatePopulationId(
        haluMemDataset.id,
        haluMemUsers,
      ),
      source,
    }),
    haluMemUpdateCaseIds,
  );
  const haluMemPrivacyIdentity = completeIdentity(
    buildPhase74HaluMemPrivacyRunIdentity({
      configuration: haluMemConfigurations.privacy,
      dataset: haluMemDataset,
      populationId: phase74HaluMemPrivacyPopulationId(
        haluMemDataset.id,
        haluMemUsers,
      ),
      source,
    }),
    haluMemPrivacyCaseIds,
  );
  const manifest: Phase74ProtectionSuiteManifest = {
    admission: "canonical-verifier-bound-v1",
    artifactKind: "phase74-protection-suite-manifest",
    schemaVersion: 2,
    suites: [
      {
        dataset: {
          ...mab.identity.dataset,
          path: join(options.mabBenchmarkRoot, "cases.json"),
        },
        id: PHASE74_MAB_PROTECTION_SUITE.id,
        identityHash: hashPhase74ProtectionSuiteIdentity(mab.identity),
        kind: PHASE74_MAB_PROTECTION_SUITE.kind,
        requiredMetrics: [...PHASE74_MAB_PROTECTION_METRICS],
        verifierId: PHASE74_MAB_PROTECTION_VERIFIER_ID,
      },
      {
        dataset: {
          ...haluMemE4Identity.dataset,
          path: options.haluMemDatasetPath,
        },
        id: PHASE74_HALUMEM_E4_SUITE.id,
        identityHash: hashPhase74ProtectionSuiteIdentity(
          haluMemE4Identity,
        ),
        kind: PHASE74_HALUMEM_E4_SUITE.kind,
        requiredMetrics: [PHASE74_HALUMEM_E4_METRIC],
        verifierId: PHASE74_HALUMEM_E4_PROTECTION_VERIFIER_ID,
      },
      {
        dataset: {
          ...haluMemUpdateIdentity.dataset,
          path: options.haluMemDatasetPath,
        },
        id: PHASE74_HALUMEM_UPDATE_SUITE.id,
        identityHash: hashPhase74ProtectionSuiteIdentity(
          haluMemUpdateIdentity,
        ),
        kind: PHASE74_HALUMEM_UPDATE_SUITE.kind,
        requiredMetrics: ["updateCorrectness"],
        verifierId: PHASE74_HALUMEM_UPDATE_PROTECTION_VERIFIER_ID,
      },
      {
        dataset: {
          ...haluMemPrivacyIdentity.dataset,
          path: options.haluMemDatasetPath,
        },
        id: PHASE74_HALUMEM_PRIVACY_SUITE.id,
        identityHash: hashPhase74ProtectionSuiteIdentity(
          haluMemPrivacyIdentity,
        ),
        kind: PHASE74_HALUMEM_PRIVACY_SUITE.kind,
        requiredMetrics: ["privacyPassRate"],
        verifierId: PHASE74_HALUMEM_PRIVACY_PROTECTION_VERIFIER_ID,
      },
      {
        dataset: {
          ...beam.identity.dataset,
          path: options.beamDatasetPath,
        },
        id: PHASE74_BEAM_SAFETY_SUITE.id,
        identityHash: hashPhase74ProtectionSuiteIdentity(beam.identity),
        kind: PHASE74_BEAM_SAFETY_SUITE.kind,
        requiredMetrics: [...PHASE74_BEAM_SAFETY_METRICS],
        verifierId: PHASE74_BEAM_SAFETY_VERIFIER_ID,
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  };
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  const protectionBlueprint = {
    id: PHASE74_PROTECTION_BLUEPRINT_ID,
    sha256: sha256(manifestJson),
  };
  const canonicalDatasets =
    mab.identity.dataset.id === PHASE74_MAB_PROTECTION_DATASET_ID &&
    mab.identity.dataset.sha256 === PHASE74_MAB_PROTECTION_DATASET_SHA256 &&
    haluMemDataset.id === PHASE74_HALUMEM_MEDIUM_DATASET_ID &&
    haluMemDataset.sha256 === PHASE74_HALUMEM_MEDIUM_SHA256 &&
    beam.identity.dataset.id === PHASE74_BEAM_FULL_100K_DATASET_ID &&
    beam.identity.dataset.sha256 ===
      PHASE74_BEAM_FULL_100K_DATASET_PROVENANCE.deterministicExport.sha256;

  const plan = buildPhase74ProtectionPlan({
    admissionClass:
      dependencies === DEFAULT_DEPENDENCIES && canonicalDatasets
        ? "promotion-admissible"
        : "diagnostic",
    evaluatorSource: source,
    protectionBlueprint,
    runs: [
      ...replicateRuns({
        caseIds: mab.caseIds,
        controls: mabControls,
        identity: mab.identity,
        protectionBlueprint,
        runId: (replicate) =>
          `${options.runIdPrefix}-mab-r${replicate}`,
        suite: PHASE74_MAB_PROTECTION_SUITE,
        verifierId: PHASE74_MAB_PROTECTION_VERIFIER_ID,
      }),
      ...replicateRuns({
        caseIds: haluMemE4CaseIds,
        controls: haluMemControls,
        identity: haluMemE4Identity,
        protectionBlueprint,
        runId: (replicate) =>
          `${options.runIdPrefix}-halumem-r${replicate}-e4`,
        suite: PHASE74_HALUMEM_E4_SUITE,
        verifierId: PHASE74_HALUMEM_E4_PROTECTION_VERIFIER_ID,
      }),
      ...replicateRuns({
        caseIds: haluMemUpdateCaseIds,
        controls: haluMemControls,
        identity: haluMemUpdateIdentity,
        protectionBlueprint,
        runId: (replicate) =>
          `${options.runIdPrefix}-halumem-r${replicate}-update`,
        suite: PHASE74_HALUMEM_UPDATE_SUITE,
        verifierId: PHASE74_HALUMEM_UPDATE_PROTECTION_VERIFIER_ID,
      }),
      ...replicateRuns({
        caseIds: haluMemPrivacyCaseIds,
        controls: haluMemControls,
        identity: haluMemPrivacyIdentity,
        protectionBlueprint,
        runId: (replicate) =>
          `${options.runIdPrefix}-halumem-r${replicate}-privacy`,
        suite: PHASE74_HALUMEM_PRIVACY_SUITE,
        verifierId: PHASE74_HALUMEM_PRIVACY_PROTECTION_VERIFIER_ID,
      }),
      ...replicateRuns({
        caseIds: beam.caseIds,
        controls: beamControls,
        identity: beam.identity,
        protectionBlueprint,
        runId: (replicate) =>
          `${options.runIdPrefix}-beam-r${replicate}`,
        suite: PHASE74_BEAM_SAFETY_SUITE,
        verifierId: PHASE74_BEAM_SAFETY_VERIFIER_ID,
      }),
    ],
  });

  await Promise.all([
    mkdir(dirname(options.outputPath), { recursive: true }),
    mkdir(dirname(options.protectionManifestPath), { recursive: true }),
  ]);
  await writeFile(
    options.protectionManifestPath,
    manifestJson,
    { encoding: "utf8", flag: "wx" },
  );
  await writeFile(
    options.outputPath,
    `${JSON.stringify(plan, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  const [loaded, loadedManifest] = await Promise.all([
    loadPhase74ProtectionPlan(options.outputPath),
    loadPhase74ProtectionSuiteManifest(options.protectionManifestPath),
  ]);
  if (
    hashPhase74ProtectionValue(loaded.plan) !==
      hashPhase74ProtectionValue(plan) ||
    loadedManifest.sha256 !== protectionBlueprint.sha256 ||
    hashPhase74ProtectionValue(loadedManifest.manifest) !==
      hashPhase74ProtectionValue(manifest)
  ) {
    throw new Error(
      "Phase 74 protection manifest or plan changed while being reloaded.",
    );
  }
  return loaded;
}

if (import.meta.main) {
  try {
    const loaded = await preparePhase74ProtectionPlan(
      parsePhase74ProtectionPlanBuilderCliOptions(process.argv.slice(2)),
    );
    process.stdout.write(`${JSON.stringify({
      path: loaded.path,
      runCount: loaded.plan.runs.length,
      schemaVersion: loaded.plan.schemaVersion,
      sha256: loaded.sha256,
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `Phase 74 protection plan preparation failed: ${String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
