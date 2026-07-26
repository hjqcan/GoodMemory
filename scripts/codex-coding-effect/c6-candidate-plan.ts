import { createHash } from "node:crypto";

import {
  CODEX_CODING_EFFECT_MEMORY_STRATA,
  parseCodexCodingEffectDataset,
} from "./dataset";
import type {
  CodexCodingEffectDatasetV3,
} from "./dataset";
import type {
  C6GatePolicy,
} from "./c6-gate-policy";
import {
  parseC6GatePolicy,
} from "./c6-gate-policy";
import {
  C6_FLAT_SUMMARY_GENERATION_POLICY,
  C6_FLAT_SUMMARY_INJECTION_COMPOSITION,
  C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
  C6_GOODMEMORY_INJECTION_COMPOSITION,
  C6_GOODMEMORY_INJECTION_COMPOSITION_SHA256,
  C6_INJECTION_TOKEN_COUNTER_ID,
  C6_INJECTION_TOKEN_COUNTER_SHA256,
  C6_NO_HISTORY_CONTROL,
  C6_NO_HISTORY_ZERO_INJECTION_COMPOSITION_SHA256,
  computeC6FlatSummaryGenerationKey,
} from "./c6-flat-summary";
import type {
  C6TaskOriginReviewEvidence,
} from "./c6-task-origin-review";
import type {
  C6DatasetLineageEvidence,
  C6DatasetLineageRelationshipEvidence,
} from "./c6-dataset-lineage";
import type {
  C6RepositoryDesignEvidence,
} from "./c6-repository-design-evidence";
import {
  EMPTY_FROZEN_PREHISTORY_SHA256,
} from "./frozen-prehistory";

export const C6_CANDIDATE_ARMS = [
  "no-memory",
  "flat-summary",
  "goodmemory-installed",
] as const;

export const C6_MINIMUM_REAL_HISTORY_EPISODES = 48;

const C6_HEADLINE_EPISODE_COUNT = 391;
const C6_STAGES_PER_EPISODE = 3;
const C6_HEADLINE_SCORED_STAGE_COUNT =
  C6_HEADLINE_EPISODE_COUNT * C6_STAGES_PER_EPISODE;
const REPOSITORY_NORMAL_TWO_SIDED_95_Z = 1.959963984540054;
const REPOSITORY_NORMAL_POWER_80_Z = 0.8416212335729143;

export type C6CandidateArm = typeof C6_CANDIDATE_ARMS[number];

export interface C6TaskOriginStageEvidence {
  originalRequestSha256: string;
  originReceiptBytes: number;
  originReceiptPath: string;
  originReceiptSha256: string;
  sourceLocator: string;
  stageId: string;
  upstreamItemRevision: string;
}

export type C6TaskOriginRelationshipEvidence =
  C6DatasetLineageRelationshipEvidence;

export interface C6CandidatePlanInput {
  assetLockSha256: string;
  assetRootSha256: string;
  c5Evidence: {
    c5ReportedRequiredEpisodes: number;
    gateSha256: string;
    headlineDesignEffect: number;
    headlineMinimumPosition: 2;
    headlineObservationsPerEpisode: number;
    independentReviewSha256: string;
    provenanceSha256: string;
    reportSha256: string;
    requiredEpisodes: number;
    requiredRepositories: number;
    requiredScoredStages: number;
    planningMaterialEffectRate: number;
    runId: string;
    verificationSha256: string;
    externalAuthenticityVerified: false;
    incomparablePairs: number;
    infrastructureFailureCount: number;
  };
  codex: {
    cliPackageJsonSha256: string;
    launcherSha256: string;
    model: string;
    nativeBinarySha256: string;
    platformPackageJsonSha256: string;
    reasoningEffort: string;
    version: string;
  };
  dataset: CodexCodingEffectDatasetV3;
  datasetLineage: C6DatasetLineageEvidence;
  flatSummary: {
    maxInjectedTokens: number;
    model: string;
    promptSha256: string;
    protocolSha256: string;
    provider: string;
    tokenCounterSha256: string;
  };
  gatePolicy: C6GatePolicy;
  gatePolicySha256: string;
  manifestSha256: string;
  maxConcurrency: number;
  package: {
    fileCount: number;
    filesManifestSha256: string;
    sha256: string;
    version: string;
  };
  platform: {
    architecture: string;
    environmentManifestSha256: string;
    imageSha256: string;
    operatingSystem: string;
  };
  pricingReceiptSha256: string;
  pricingSnapshotSha256: string;
  repositoryDesignEvidence?: C6RepositoryDesignEvidence;
  repositoryContentSha256ByAssetPath: Record<string, string>;
  runnerSource: {
    commit: string;
    tree: string;
  };
  seeds: readonly number[];
  stageTimeoutMs: number;
  staticLeakageAuditSha256: string;
  taskContentSha256ByEpisodeId: Record<string, string>;
  taskOriginEvidenceByEpisodeId: Record<string, {
    candidateTaskContentSha256: string;
    relationshipEdges: C6TaskOriginRelationshipEvidence[];
    receiptSha256: string;
    sourceRecordSha256: string;
    stageOrigins: C6TaskOriginStageEvidence[];
  }>;
  taskOriginReviewEvidence: C6TaskOriginReviewEvidence;
  testTimeoutMs: number;
}

export interface C6CandidateCluster {
  armOrder: [C6CandidateArm, C6CandidateArm, C6CandidateArm];
  episodeId: string;
  executionPosition: number;
  id: string;
  randomizationRankSha256: string;
  seed: number;
}

export interface C6CandidateEpisodeBinding {
  ecosystem: string;
  episodeId: string;
  episodeInputSha256: string;
  language: string;
  primaryStratum: (typeof CODEX_CODING_EFFECT_MEMORY_STRATA)[number];
  repository: {
    assetPath: string;
    baseCommit: string;
    contentSha256: string;
    license: string;
    redistributionAllowed: true;
    redistributionReviewed: true;
    url: string;
  };
  repositoryFamilyId: string | null;
  sourceType: "controlled-mutation" | "external-benchmark" | "real-history";
  sourceLineage: {
    agentVisibleTaskSha256: string;
    episodeStageClosureSha256: string;
    relationshipClosureSha256: string;
    sourceId: string;
    stageHistoryClosureSha256: string;
  };
  stageBindings: Array<{
    historySourceSha256: string;
    sourceLineage: {
      history: {
        artifactSha256: string;
        materializationSha256: string;
        sourceUnitCount: number;
        sourceUnitIdsSha256: string;
      };
      stageLineageSha256: string;
      target: {
        locator: string;
        normalizedSourceRequestSha256: string;
        recordSha256: string;
        sourceRequestSha256: string;
        sourceRequestNormalization: "ecmascript-string-trim-v1";
        sourceUnitId: string;
        upstreamItemRevision: string;
      };
    };
    stageId: string;
    stageInputSha256: string;
    treatment: {
      flatSummary: {
        compositionSha256:
          | typeof C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256
          | typeof C6_NO_HISTORY_ZERO_INJECTION_COMPOSITION_SHA256;
        injectionMode:
          | "content-injection"
          | "no-history-zero-injection";
        providerCall: "required" | "prohibited";
      };
      goodMemory: {
        compositionSha256:
          | typeof C6_GOODMEMORY_INJECTION_COMPOSITION_SHA256
          | typeof C6_NO_HISTORY_ZERO_INJECTION_COMPOSITION_SHA256;
        injectionMode:
          | "content-injection"
          | "no-history-zero-injection";
      };
    };
  }>;
  stateMode: "canonical-snapshot";
  strata: string[];
  taskContentSha256: string;
  taskOriginEvidence: {
    candidateTaskContentSha256: string;
    receiptPath: string;
    receiptSha256: string;
    reviewedAt: string;
    reviewerAgentName: string;
    relationshipEdges: C6TaskOriginRelationshipEvidence[];
    sourceRecordSha256: string;
    stageOrigins: C6TaskOriginStageEvidence[];
    status:
      "candidate-closure-accepted-readiness-artifact-verification-required";
  };
}

export interface C6CandidatePlan {
  analysis: {
    episodeOnlyBootstrap: {
      claimRole: "diagnostic-only";
      confidenceLevel: 0.95;
      resamplingUnit: "episode";
      samples: 10_000;
      seed: number;
    };
    headlineStagePositions: "two-and-later";
    minimumEpisodeFloor: number;
    planningMaterialEffectRate: number;
    power: 0.8;
    primaryEstimand:
      "equal-episode-mean-of-within-episode-paired-resolve-deltas-v1";
    sourceCohorts: {
      controlledMutationDiagnostics: {
        candidateDatasetInclusion: "prohibited";
        claimRole: "diagnostic-only";
        excludedFromPrimaryEstimand: true;
        externalRegistryConsumed: false;
        separateReportingRequired: true;
      };
      primaryCoding: {
        episodeCount: number;
        includedSourceTypes: ["real-history", "external-benchmark"];
      };
    };
    repositoryInference: {
      algorithm:
        "paired-repository-episode-hierarchical-percentile-v1";
      clusterKey: "canonical-upstream-repository-family-v1";
      confidenceLevel: 0.95;
      equalRepositoryEstimand:
        "equal-repository-mean-of-equal-episode-deltas-v1";
      leaveOneRepositoryOutRequired: true;
      resamplingUnits: ["repository", "episode"];
      samples: 10_000;
      seed: number;
    };
  };
  arms: ["no-memory", "flat-summary", "goodmemory-installed"];
  bindings: {
    assetLockSha256: string;
    assetRootSha256: string;
    c5GateSha256: string;
    c5IndependentReviewSha256: string;
    c5ProvenanceSha256: string;
    c5ReportSha256: string;
    c5VerificationSha256: string;
    codexCliPackageJsonSha256: string;
    codexLauncherSha256: string;
    codexNativeBinarySha256: string;
    codexPlatformPackageJsonSha256: string;
    datasetLineageSha256: string;
    environmentManifestSha256: string;
    flatSummaryInjectionCompositionSha256: string;
    gatePolicySha256: string;
    goodMemoryInjectionCompositionSha256: string;
    injectionTokenCounterSha256: string;
    manifestSha256: string;
    packageSha256: string;
    packageFilesManifestSha256: string;
    pricingReceiptSha256: string;
    pricingSnapshotSha256: string;
    repositoryDesignPowerArtifactSha256: string | null;
    repositoryLineageArtifactSha256: string | null;
    repositoryPowerInputArtifactSha256: string | null;
    repositoryReviewReceiptSha256: string | null;
    runnerCommit: string;
    runnerTree: string;
    staticLeakageAuditSha256: string;
    summaryPromptSha256: string;
    summaryProtocolSha256: string;
    taskOriginReviewProvenanceSha256: string;
  };
  candidateClaims: {
    primary:
      "Under the stage-scoped sealed-prefix protocol on the frozen real-history and external-benchmark coding cohort, excluding controlled mutations, the packaged GoodMemory installed-host treatment improves positions-two-and-later fresh-session Codex hidden-test resolve@1 versus no memory.";
    strongControl:
      "Under the stage-scoped sealed-prefix protocol and an equal injection budget on the frozen real-history and external-benchmark coding cohort, excluding controlled mutations, GoodMemory improves positions-two-and-later fresh-session Codex hidden-test resolve@1 versus a flat summary.";
  };
  c5Prerequisite: {
    c5ReportedRequiredEpisodes: number;
    externalAuthenticityVerified: false;
    headlineDesignEffect: number;
    headlineMinimumPosition: 2;
    headlineObservationsPerEpisode: number;
    incomparablePairs: number;
    infrastructureFailureCount: number;
    runId: string;
  };
  claimBoundary: "candidate-only-pending-c7-gate";
  claimScope:
    "stage-scoped-sealed-prefix-selection-and-injection-not-native-writeback";
  clusters: C6CandidateCluster[];
  candidateManifestFrozen: false;
  codexRunReady: false;
  codex: {
    cliPackageJsonSha256: string;
    launcherSha256: string;
    model: string;
    nativeBinarySha256: string;
    platformPackageJsonSha256: string;
    reasoningEffort: string;
    version: string;
  };
  counts: {
    armRuns: number;
    clusters: number;
    codexProcesses: number;
    ecosystems: number;
    episodes: number;
    flatSummaryCodexProcesses: number;
    headlineEpisodes: number;
    pairedTreatmentCodexProcesses: number;
    repositories: number;
    scoredStages: number;
    summaryGenerationCalls: number;
    summaryStageArtifactBindings: number;
  };
  datasetId: string;
  episodeBindings: C6CandidateEpisodeBinding[];
  evidenceClass: "codex-coding-effect-candidate";
  excludedHosts: ["claude-code"];
  goodMemoryStateIsolation: {
    carryoverAcrossStagesSeedsOrArms: "prohibited";
    initializeBeforeEveryStage: "rebuild-from-stage-sealed-prefix";
    lifecycleReceiptRequired: true;
    postWritebackDisposition:
      "record-stop-and-ledger-then-discard-store";
    writebackRole: "host-integrity-observation-only";
  };
  execution: {
    repetitionCount: 1;
    stageTimeoutMs: number;
    testTimeoutMs: number;
  };
  gatePolicy: C6GatePolicy;
  flatSummary: {
    equalBudgetStatus: "pending-packaged-linux-host-profile-capture";
    injectionComposition:
      typeof C6_FLAT_SUMMARY_INJECTION_COMPOSITION;
    injectionCompositionSha256:
      typeof C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256;
    generationProvenance: {
      requiredBefore: "run-identity-and-codex-execution";
      requiredReceiptFields: [
        "providerRequestId",
        "requestSha256",
        "rawResponseSha256",
        "rawToNormalizedIndexSha256",
        "startedAt",
        "completedAt",
        "usage",
      ];
      status: "authenticated-provider-receipts-required";
    };
    generationPolicy: typeof C6_FLAT_SUMMARY_GENERATION_POLICY;
    historySource: "same-stage-sealed-prefix-as-goodmemory";
    leakageAuditRequired: true;
    maxInjectedTokens: number;
    model: string;
    provider: string;
    rawGoldAccess: false;
    requiredInjectionReceiptFields: [
      "contentSha256",
      "injectedTokenCount",
      "maxInjectedTokens",
      "tokenCounterId",
      "tokenCounterSha256",
      "compositionSha256",
      "historySourceSha256",
      "injectionMode",
    ];
    seedReusePolicy: "one-output-hash-reused-across-all-three-seeds";
    tokenCounterId: typeof C6_INJECTION_TOKEN_COUNTER_ID;
    tokenCounterSha256: string;
  };
  goodMemoryProfileEvidence: {
    requiredConfigFields: [
      "sourceSha256",
      "normalizedSha256",
      "maxTokens",
      "sessionStartMaxTokens",
      "contextMode",
      "promptInjection",
      "actualStageInjectedTokens",
      "actualStageInjectedTextSha256",
      "tokenCounterId",
      "tokenCounterSha256",
      "injectionCompositionSha256",
      "injectionMode",
    ];
    injectionComposition:
      typeof C6_GOODMEMORY_INJECTION_COMPOSITION;
    injectionCompositionSha256:
      typeof C6_GOODMEMORY_INJECTION_COMPOSITION_SHA256;
    source: "exact-package-in-pinned-linux-image";
    status: "required-before-summary-generation";
  };
  noHistoryControl: typeof C6_NO_HISTORY_CONTROL;
  host: "codex";
  maxConcurrency: number;
  networkAccess: false;
  package: {
    fileCount: number;
    version: string;
  };
  packageSourceEvidence: {
    archiveInspection: "structure-only-accepted";
    requiredProof: [
      "exact-source-commit-and-tree",
      "source-to-package-file-closure-match",
    ];
    status: "required-before-candidate-freeze";
  };
  phase: "C6";
  platform: {
    architecture: "x64";
    environmentManifestSha256: string;
    imageSha256: string;
    operatingSystem: "linux";
  };
  pricingSourceEvidence: {
    receiptBinding: "local-receipt-accepted";
    status: "independent-source-review-required-before-cost-claim";
  };
  publicClaimEligible: false;
  publicCodingEffectProof: false;
  randomization: {
    algorithm: "sha256-ranked-balanced-three-arm-permutation-v1";
    clusterOrderSha256: string;
  };
  readinessStage: "preflight-accepted-freeze-prerequisites-required";
  readmeRowAllowed: false;
  repositorySourceEvidence: {
    lockedDistinctContentRoots: number;
    requiredProof: [
      "url-and-base-commit-reachability",
      "asset-and-stage-snapshot-tree-match",
      "license-review-receipt",
    ];
    status: "required-before-candidate-freeze";
  };
  samplingEvidence: {
    headlineStratumCounts: Record<
      (typeof CODEX_CODING_EFFECT_MEMORY_STRATA)[number],
      number
    >;
    minimumEpisodeFloor: number;
    minimumEpisodesPerStratum: number;
    minimumRealHistoryEpisodes: typeof C6_MINIMUM_REAL_HISTORY_EPISODES;
    primaryStratumCounts: Record<
      (typeof CODEX_CODING_EFFECT_MEMORY_STRATA)[number],
      number
    >;
    primaryDatasetSourceTypeCounts: {
      externalBenchmark: number;
      realHistory: number;
    };
    semanticDuplicateReviewStatus:
      "required-before-candidate-freeze";
    sourceLineageEvidence: {
      externalSourceAuthenticityStatus:
        "required-before-candidate-freeze";
      sourceSnapshots: number;
      status:
        "asset-bound-normalized-source-record-consistency-accepted";
      targetSourceUnits: number;
      uniqueTargetRecordFingerprints: number;
    };
    repositoryDesignEvidence: {
      actualRepositoryFamilies: number | null;
      algorithm:
        | "repository-mean-normal-power-and-precision-v1"
        | null;
      alpha: 0.05 | null;
      allocationConcentrationEquivalentCount: number | null;
      confidenceLevel: 0.95 | null;
      declaredOutcomeAccess: "prohibited" | null;
      designPowerArtifactSha256: string | null;
      effectiveRepositoryFamilies: number | null;
      episodeCountsByRepositoryFamily: Array<{
        episodes: number;
        repositoryFamilyId: string;
      }>;
      episodeRepositoryFamilyBindingsSha256: string | null;
      groupingPolicy: "canonical-upstream-repository-family-v1";
      cryptographicAuthenticity: false;
      largestRepositoryEpisodeShare: number | null;
      maximumHalfWidth: number | null;
      minimumDetectableEffect: number | null;
      minimumRepositoryFamilies: number | null;
      planningRepositoryStandardDeviation: number | null;
      power: 0.8 | null;
      powerInputArtifactSha256: string | null;
      powerRequiredRepositoryFamilies: number | null;
      precisionRequiredRepositoryFamilies: number | null;
      repositoryLineageArtifactSha256: string | null;
      requiredBefore: [
        "candidate-manifest-freeze",
        "full-codex-run",
      ];
      requiredRepositoryFamilies: number | null;
      reviewReceiptSha256: string | null;
      status:
        | "required-before-candidate-freeze-and-full-run"
        | "review-receipt-structure-verified";
      topThreeRepositoryEpisodeShare: number | null;
    };
    taskOriginEvidence: {
      cryptographicReceipt: false;
      dispatchSha256: string;
      independentAuthenticityStatus: "required-before-candidate-freeze";
      inputSha256: string;
      provenanceSha256: string;
      relationshipDecisionCount: number;
      relationshipDecisionIdentitySetSha256: string;
      relationshipReviewStatus:
        "exact-edge-identity-closure-accepted-readiness-artifact-verification-required";
      reviewedPrimaryEpisodes: number;
      reviewedEpisodeIdsSha256: string;
      requestSha256: string;
      responseSha256: string;
      reviewerAgentName: string;
      reviewProvenanceStatus:
        "review-reference-closure-accepted-readiness-artifact-verification-required";
      status:
        "candidate-closure-accepted-readiness-artifact-verification-required";
      upstreamReceiptDerivationStatus:
        "upstream-receipt-reference-closure-accepted-readiness-artifact-verification-required";
      verificationBoundary:
        "candidate-builder-recomputes-identity-closures-and-requires-readiness-for-artifact-bytes";
    };
    taskContentDeduplication:
      "agent-visible-repository-ordered-prompts-and-stage-histories-v2";
    uniqueTaskContentFingerprints: number;
    stratumQuotaPolicy:
      "exclusive-primary-stratum-within-primary-coding-cohort-v2";
  };
  schemaVersion: 7;
  seeds: [number, number, number];
  sessionPolicy: "fresh-codex-process-no-resume-per-stage";
}

const ARM_PERMUTATIONS: readonly [
  C6CandidateArm,
  C6CandidateArm,
  C6CandidateArm,
][] = [
  ["no-memory", "flat-summary", "goodmemory-installed"],
  ["flat-summary", "goodmemory-installed", "no-memory"],
  ["goodmemory-installed", "no-memory", "flat-summary"],
];

export function buildC6CandidatePlan(
  input: C6CandidatePlanInput,
): C6CandidatePlan {
  validateInput(input);
  const dataset = validateDataset(input);
  const primaryCodingEpisodes = dataset.episodes.filter(
    isPrimaryCodingEpisode,
  );
  const primaryCodingDataset = {
    ...dataset,
    episodes: primaryCodingEpisodes,
  };
  const repositoryDesignEvidence = buildRepositoryDesignEvidence(
    primaryCodingDataset,
    input.repositoryDesignEvidence,
    input.manifestSha256,
    input.gatePolicy,
  );
  const seeds = input.seeds as [number, number, number];
  const episodeBindings = dataset.episodes.map((episode) =>
    buildEpisodeBinding(
      episode,
      input,
      episode.sourceType === "controlled-mutation"
        ? null
        : input.repositoryDesignEvidence
        ?.repositoryFamilyByEpisodeId[episode.id] ?? null,
    )
  );
  const clusterCandidates = dataset.episodes.flatMap((episode) => {
    const episodeCandidates = seeds.map((seed) => {
      const id = `${episode.id}/seed-${seed}`;
      return {
        armRank: sha256(JSON.stringify({
          episodeId: episode.id,
          purpose: "arm-order",
          seed,
        })),
        episodeId: episode.id,
        id,
        rank: sha256(JSON.stringify({
          datasetId: dataset.datasetId,
          episodeId: episode.id,
          purpose: "cluster-order",
          seed,
        })),
        seed,
      };
    }).sort((first, second) =>
      first.armRank.localeCompare(second.armRank) ||
      first.id.localeCompare(second.id)
    );
    return episodeCandidates.map((candidate, index) => ({
      ...candidate,
      armOrder: [...ARM_PERMUTATIONS[index]!] as [
        C6CandidateArm,
        C6CandidateArm,
        C6CandidateArm,
      ],
    }));
  }).sort((first, second) =>
    first.rank.localeCompare(second.rank) || first.id.localeCompare(second.id)
  );
  const clusters = clusterCandidates.map(
    (candidate, index): C6CandidateCluster => ({
      armOrder: candidate.armOrder,
      episodeId: candidate.episodeId,
      executionPosition: index + 1,
      id: candidate.id,
      randomizationRankSha256: candidate.rank,
      seed: candidate.seed,
    }),
  );
  const scoredStages = dataset.episodes.reduce(
    (count, episode) => count + episode.stages.length,
    0,
  );
  const summaryStageBindings = episodeBindings.flatMap((episode) =>
    episode.stageBindings.filter((stage) =>
      stage.treatment.flatSummary.providerCall === "required"
    )
  );
  const distinctStageHistoryBindings = new Set(
    summaryStageBindings.map((stage) =>
      computeC6FlatSummaryGenerationKey(stage.sourceLineage.history)
    ),
  );
  const seedCount = seeds.length;
  const pairedTreatmentCodexProcesses = scoredStages * seedCount * 2;
  const flatSummaryCodexProcesses = scoredStages * seedCount;
  const repositoryContentRoots = new Set(
    episodeBindings.map((episode) => episode.repository.contentSha256),
  );
  const headlineStratumCounts = buildHeadlineStratumCounts(dataset);
  const primaryStratumCounts = buildPrimaryStratumCounts(dataset);

  return {
    analysis: {
      episodeOnlyBootstrap: {
        claimRole: input.gatePolicy.bootstrap.claimRole,
        confidenceLevel: input.gatePolicy.bootstrap.confidenceLevel,
        resamplingUnit: input.gatePolicy.bootstrap.resamplingUnit,
        samples: input.gatePolicy.bootstrap.samples,
        seed: input.gatePolicy.bootstrap.seed,
      },
      headlineStagePositions: "two-and-later",
      minimumEpisodeFloor: input.c5Evidence.requiredEpisodes,
      planningMaterialEffectRate:
        input.c5Evidence.planningMaterialEffectRate,
      power: 0.8,
      primaryEstimand: input.gatePolicy.estimand.primaryAggregation,
      sourceCohorts: {
        controlledMutationDiagnostics: {
          candidateDatasetInclusion: "prohibited",
          claimRole:
            input.gatePolicy.sourceCohorts.controlledMutation.claimRole,
          excludedFromPrimaryEstimand: true,
          externalRegistryConsumed: false,
          separateReportingRequired:
            input.gatePolicy.sourceCohorts.controlledMutation
              .separateReportingRequired,
        },
        primaryCoding: {
          episodeCount: primaryCodingEpisodes.length,
          includedSourceTypes: [
            ...input.gatePolicy.sourceCohorts.primaryCoding
              .includedSourceTypes,
          ],
        },
      },
      repositoryInference: {
        algorithm:
          input.gatePolicy.repositoryInference.bootstrap.algorithm,
        clusterKey: input.gatePolicy.repositoryInference.clusterKey,
        confidenceLevel:
          input.gatePolicy.repositoryInference.bootstrap.confidenceLevel,
        equalRepositoryEstimand:
          input.gatePolicy.repositoryInference.equalRepositorySensitivity
            .estimand,
        leaveOneRepositoryOutRequired:
          input.gatePolicy.repositoryInference.leaveOneRepositoryOut
            .requiredForClaim,
        resamplingUnits: [
          ...input.gatePolicy.repositoryInference.bootstrap.resamplingUnits,
        ],
        samples:
          input.gatePolicy.repositoryInference.bootstrap.samples,
        seed: input.gatePolicy.repositoryInference.bootstrap.seed,
      },
    },
    arms: ["no-memory", "flat-summary", "goodmemory-installed"],
    bindings: {
      assetLockSha256: input.assetLockSha256,
      assetRootSha256: input.assetRootSha256,
      c5GateSha256: input.c5Evidence.gateSha256,
      c5IndependentReviewSha256:
        input.c5Evidence.independentReviewSha256,
      c5ProvenanceSha256: input.c5Evidence.provenanceSha256,
      c5ReportSha256: input.c5Evidence.reportSha256,
      c5VerificationSha256: input.c5Evidence.verificationSha256,
      codexCliPackageJsonSha256:
        input.codex.cliPackageJsonSha256,
      codexLauncherSha256: input.codex.launcherSha256,
      codexNativeBinarySha256: input.codex.nativeBinarySha256,
      codexPlatformPackageJsonSha256:
        input.codex.platformPackageJsonSha256,
      datasetLineageSha256: input.datasetLineage.lineageSha256,
      environmentManifestSha256:
        input.platform.environmentManifestSha256,
      flatSummaryInjectionCompositionSha256:
        C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
      gatePolicySha256: input.gatePolicySha256,
      goodMemoryInjectionCompositionSha256:
        C6_GOODMEMORY_INJECTION_COMPOSITION_SHA256,
      injectionTokenCounterSha256:
        input.flatSummary.tokenCounterSha256,
      manifestSha256: input.manifestSha256,
      packageSha256: input.package.sha256,
      packageFilesManifestSha256: input.package.filesManifestSha256,
      pricingReceiptSha256: input.pricingReceiptSha256,
      pricingSnapshotSha256: input.pricingSnapshotSha256,
      repositoryDesignPowerArtifactSha256:
        repositoryDesignEvidence.designPowerArtifactSha256,
      repositoryLineageArtifactSha256:
        repositoryDesignEvidence.repositoryLineageArtifactSha256,
      repositoryPowerInputArtifactSha256:
        repositoryDesignEvidence.powerInputArtifactSha256,
      repositoryReviewReceiptSha256:
        repositoryDesignEvidence.reviewReceiptSha256,
      runnerCommit: input.runnerSource.commit,
      runnerTree: input.runnerSource.tree,
      staticLeakageAuditSha256: input.staticLeakageAuditSha256,
      summaryPromptSha256: input.flatSummary.promptSha256,
      summaryProtocolSha256: input.flatSummary.protocolSha256,
      taskOriginReviewProvenanceSha256:
        input.taskOriginReviewEvidence.provenanceSha256,
    },
    candidateClaims: {
      primary:
        "Under the stage-scoped sealed-prefix protocol on the frozen real-history and external-benchmark coding cohort, excluding controlled mutations, the packaged GoodMemory installed-host treatment improves positions-two-and-later fresh-session Codex hidden-test resolve@1 versus no memory.",
      strongControl:
        "Under the stage-scoped sealed-prefix protocol and an equal injection budget on the frozen real-history and external-benchmark coding cohort, excluding controlled mutations, GoodMemory improves positions-two-and-later fresh-session Codex hidden-test resolve@1 versus a flat summary.",
    },
    c5Prerequisite: {
      c5ReportedRequiredEpisodes:
        input.c5Evidence.c5ReportedRequiredEpisodes,
      externalAuthenticityVerified:
        input.c5Evidence.externalAuthenticityVerified,
      headlineDesignEffect: input.c5Evidence.headlineDesignEffect,
      headlineMinimumPosition: input.c5Evidence.headlineMinimumPosition,
      headlineObservationsPerEpisode:
        input.c5Evidence.headlineObservationsPerEpisode,
      incomparablePairs: input.c5Evidence.incomparablePairs,
      infrastructureFailureCount:
        input.c5Evidence.infrastructureFailureCount,
      runId: input.c5Evidence.runId,
    },
    claimBoundary: "candidate-only-pending-c7-gate",
    claimScope:
      "stage-scoped-sealed-prefix-selection-and-injection-not-native-writeback",
    clusters,
    candidateManifestFrozen: false,
    codexRunReady: false,
    codex: { ...input.codex },
    counts: {
      armRuns: clusters.length * C6_CANDIDATE_ARMS.length,
      clusters: clusters.length,
      codexProcesses:
        pairedTreatmentCodexProcesses + flatSummaryCodexProcesses,
      ecosystems: new Set(dataset.episodes.map((episode) =>
        episode.ecosystem
      )).size,
      episodes: dataset.episodes.length,
      flatSummaryCodexProcesses,
      headlineEpisodes: primaryCodingEpisodes.length,
      pairedTreatmentCodexProcesses,
      repositories: new Set(dataset.episodes.map((episode) =>
        episode.repository.url
      )).size,
      scoredStages,
      summaryGenerationCalls: distinctStageHistoryBindings.size,
      summaryStageArtifactBindings: summaryStageBindings.length,
    },
    datasetId: dataset.datasetId,
    episodeBindings,
    evidenceClass: "codex-coding-effect-candidate",
    excludedHosts: ["claude-code"],
    goodMemoryStateIsolation: {
      ...input.gatePolicy.hostGate.goodMemoryStoreLifecycle,
      writebackRole: "host-integrity-observation-only",
    },
    execution: {
      repetitionCount: 1,
      stageTimeoutMs: input.stageTimeoutMs,
      testTimeoutMs: input.testTimeoutMs,
    },
    gatePolicy: structuredClone(input.gatePolicy),
    flatSummary: {
      equalBudgetStatus: "pending-packaged-linux-host-profile-capture",
      injectionComposition: C6_FLAT_SUMMARY_INJECTION_COMPOSITION,
      injectionCompositionSha256:
        C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
      generationProvenance: {
        requiredBefore: "run-identity-and-codex-execution",
        requiredReceiptFields: [
          "providerRequestId",
          "requestSha256",
          "rawResponseSha256",
          "rawToNormalizedIndexSha256",
          "startedAt",
          "completedAt",
          "usage",
        ],
        status: "authenticated-provider-receipts-required",
      },
      generationPolicy: C6_FLAT_SUMMARY_GENERATION_POLICY,
      historySource: "same-stage-sealed-prefix-as-goodmemory",
      leakageAuditRequired: true,
      maxInjectedTokens: input.flatSummary.maxInjectedTokens,
      model: input.flatSummary.model,
      provider: input.flatSummary.provider,
      rawGoldAccess: false,
      requiredInjectionReceiptFields: [
        "contentSha256",
        "injectedTokenCount",
        "maxInjectedTokens",
        "tokenCounterId",
        "tokenCounterSha256",
        "compositionSha256",
        "historySourceSha256",
        "injectionMode",
      ],
      seedReusePolicy: "one-output-hash-reused-across-all-three-seeds",
      tokenCounterId: C6_INJECTION_TOKEN_COUNTER_ID,
      tokenCounterSha256: input.flatSummary.tokenCounterSha256,
    },
    goodMemoryProfileEvidence: {
      requiredConfigFields: [
        "sourceSha256",
        "normalizedSha256",
        "maxTokens",
        "sessionStartMaxTokens",
        "contextMode",
        "promptInjection",
        "actualStageInjectedTokens",
        "actualStageInjectedTextSha256",
        "tokenCounterId",
        "tokenCounterSha256",
        "injectionCompositionSha256",
        "injectionMode",
      ],
      injectionComposition: C6_GOODMEMORY_INJECTION_COMPOSITION,
      injectionCompositionSha256:
        C6_GOODMEMORY_INJECTION_COMPOSITION_SHA256,
      source: "exact-package-in-pinned-linux-image",
      status: "required-before-summary-generation",
    },
    noHistoryControl: structuredClone(C6_NO_HISTORY_CONTROL),
    host: "codex",
    maxConcurrency: input.maxConcurrency,
    networkAccess: false,
    package: {
      fileCount: input.package.fileCount,
      version: input.package.version,
    },
    packageSourceEvidence: {
      archiveInspection: "structure-only-accepted",
      requiredProof: [
        "exact-source-commit-and-tree",
        "source-to-package-file-closure-match",
      ],
      status: "required-before-candidate-freeze",
    },
    phase: "C6",
    platform: {
      architecture: "x64",
      environmentManifestSha256:
        input.platform.environmentManifestSha256,
      imageSha256: input.platform.imageSha256,
      operatingSystem: "linux",
    },
    pricingSourceEvidence: {
      receiptBinding: "local-receipt-accepted",
      status: "independent-source-review-required-before-cost-claim",
    },
    publicClaimEligible: false,
    publicCodingEffectProof: false,
    randomization: {
      algorithm: "sha256-ranked-balanced-three-arm-permutation-v1",
      clusterOrderSha256: sha256(JSON.stringify(clusters.map((cluster) => ({
        armOrder: cluster.armOrder,
        id: cluster.id,
      })))),
    },
    readinessStage: "preflight-accepted-freeze-prerequisites-required",
    readmeRowAllowed: false,
    repositorySourceEvidence: {
      lockedDistinctContentRoots: repositoryContentRoots.size,
      requiredProof: [
        "url-and-base-commit-reachability",
        "asset-and-stage-snapshot-tree-match",
        "license-review-receipt",
      ],
      status: "required-before-candidate-freeze",
    },
    samplingEvidence: {
      headlineStratumCounts,
      minimumEpisodeFloor: input.c5Evidence.requiredEpisodes,
      minimumEpisodesPerStratum: Math.floor(
        input.c5Evidence.requiredEpisodes /
          CODEX_CODING_EFFECT_MEMORY_STRATA.length,
      ),
      minimumRealHistoryEpisodes:
        C6_MINIMUM_REAL_HISTORY_EPISODES,
      primaryStratumCounts,
      primaryDatasetSourceTypeCounts: {
        externalBenchmark: primaryCodingEpisodes.filter((episode) =>
          episode.sourceType === "external-benchmark"
        ).length,
        realHistory: primaryCodingEpisodes.filter((episode) =>
          episode.sourceType === "real-history"
        ).length,
      },
      repositoryDesignEvidence,
      semanticDuplicateReviewStatus:
        "required-before-candidate-freeze",
      sourceLineageEvidence: {
        externalSourceAuthenticityStatus:
          "required-before-candidate-freeze",
        sourceSnapshots: input.datasetLineage.sourceSnapshotCount,
        status:
          "asset-bound-normalized-source-record-consistency-accepted",
        targetSourceUnits: input.datasetLineage.targetSourceUnitCount,
        uniqueTargetRecordFingerprints:
          input.datasetLineage.uniqueTargetRecordFingerprints,
      },
      taskOriginEvidence: {
        cryptographicReceipt:
          input.taskOriginReviewEvidence.cryptographicReceipt,
        dispatchSha256:
          input.taskOriginReviewEvidence.dispatchSha256,
        independentAuthenticityStatus:
          "required-before-candidate-freeze",
        inputSha256: input.taskOriginReviewEvidence.inputSha256,
        provenanceSha256:
          input.taskOriginReviewEvidence.provenanceSha256,
        relationshipDecisionCount:
          input.taskOriginReviewEvidence.relationshipDecisionCount,
        relationshipDecisionIdentitySetSha256:
          input.taskOriginReviewEvidence
            .relationshipDecisionIdentitySetSha256,
        relationshipReviewStatus:
          "exact-edge-identity-closure-accepted-readiness-artifact-verification-required",
        reviewedPrimaryEpisodes: dataset.episodes.length,
        reviewedEpisodeIdsSha256:
          input.taskOriginReviewEvidence.reviewedEpisodeIdsSha256,
        requestSha256:
          input.taskOriginReviewEvidence.requestSha256,
        responseSha256:
          input.taskOriginReviewEvidence.responseSha256,
        reviewerAgentName:
          input.taskOriginReviewEvidence.reviewerAgentName,
        reviewProvenanceStatus:
          "review-reference-closure-accepted-readiness-artifact-verification-required",
        status:
          "candidate-closure-accepted-readiness-artifact-verification-required",
        upstreamReceiptDerivationStatus:
          "upstream-receipt-reference-closure-accepted-readiness-artifact-verification-required",
        verificationBoundary:
          "candidate-builder-recomputes-identity-closures-and-requires-readiness-for-artifact-bytes",
      },
      taskContentDeduplication:
        "agent-visible-repository-ordered-prompts-and-stage-histories-v2",
      uniqueTaskContentFingerprints: new Set(
        episodeBindings.map(candidateTaskFingerprintSha256),
      ).size,
      stratumQuotaPolicy:
        "exclusive-primary-stratum-within-primary-coding-cohort-v2",
    },
    schemaVersion: 7,
    seeds: [...seeds],
    sessionPolicy: "fresh-codex-process-no-resume-per-stage",
  };
}

export function serializeC6CandidatePlan(plan: C6CandidatePlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

export function verifyC6CandidatePlan(
  plan: C6CandidatePlan,
  input: C6CandidatePlanInput,
): void {
  if (
    serializeC6CandidatePlan(plan) !==
      serializeC6CandidatePlan(buildC6CandidatePlan(input))
  ) {
    throw new Error("C6 candidate plan does not match its frozen inputs");
  }
}

function buildRepositoryDesignEvidence(
  dataset: CodexCodingEffectDatasetV3,
  evidence: C6CandidatePlanInput["repositoryDesignEvidence"],
  manifestSha256: string,
  gatePolicy: C6GatePolicy,
): C6CandidatePlan["samplingEvidence"]["repositoryDesignEvidence"] {
  const requiredBefore = [
    "candidate-manifest-freeze",
    "full-codex-run",
  ] as const;
  if (evidence === undefined) {
    return {
      actualRepositoryFamilies: null,
      algorithm: null,
      alpha: null,
      allocationConcentrationEquivalentCount: null,
      confidenceLevel: null,
      declaredOutcomeAccess: null,
      designPowerArtifactSha256: null,
      effectiveRepositoryFamilies: null,
      episodeCountsByRepositoryFamily: [],
      episodeRepositoryFamilyBindingsSha256: null,
      groupingPolicy: "canonical-upstream-repository-family-v1",
      cryptographicAuthenticity: false,
      largestRepositoryEpisodeShare: null,
      maximumHalfWidth: null,
      minimumDetectableEffect: null,
      minimumRepositoryFamilies: null,
      planningRepositoryStandardDeviation: null,
      power: null,
      powerInputArtifactSha256: null,
      powerRequiredRepositoryFamilies: null,
      precisionRequiredRepositoryFamilies: null,
      repositoryLineageArtifactSha256: null,
      requiredBefore: [...requiredBefore],
      requiredRepositoryFamilies: null,
      reviewReceiptSha256: null,
      status: "required-before-candidate-freeze-and-full-run",
      topThreeRepositoryEpisodeShare: null,
    };
  }

  if (
    evidence.groupingPolicy !==
      "canonical-upstream-repository-family-v1" ||
    evidence.reviewReceiptStatus !==
      "review-receipt-structure-verified" ||
    evidence.declaredOutcomeAccess !== "prohibited" ||
    evidence.cryptographicAuthenticity !== false
  ) {
    throw new Error(
      "C6 repository design evidence requires a verified review receipt structure",
    );
  }
  assertSha256(
    evidence.designPowerArtifactSha256,
    "C6 repository design power artifact",
  );
  assertSha256(
    evidence.repositoryLineageArtifactSha256,
    "C6 repository lineage artifact",
  );
  assertSha256(
    evidence.reviewReceiptSha256,
    "C6 repository design review receipt",
  );
  assertSha256(
    evidence.powerInputArtifactSha256,
    "C6 repository design power input",
  );
  assertSha256(
    evidence.episodeFamilyBindingSha256,
    "C6 repository episode-family binding",
  );
  assertSha256(
    evidence.allocation.allocationSha256,
    "C6 repository allocation",
  );
  if (evidence.datasetSha256 !== manifestSha256) {
    throw new Error(
      "C6 repository design evidence does not bind the dataset manifest",
    );
  }
  if (
    evidence.algorithm !==
      "repository-mean-normal-power-and-precision-v1" ||
    evidence.alpha !== 0.05 ||
    evidence.power !== 0.8 ||
    evidence.confidenceLevel !== 0.95
  ) {
    throw new Error(
      "C6 repository design evidence must use the frozen normal power-and-precision algorithm",
    );
  }
  const strictestGateDelta = Math.min(
    gatePolicy.performanceGate.resolveDeltaVersusNoMemoryMinimum,
    gatePolicy.strongControlGate.accuracyDeltaVersusFlatSummaryMinimum,
  );
  if (evidence.minimumDetectableEffect !== strictestGateDelta) {
    throw new Error(
      "C6 repository design minimum detectable effect must match the strictest gate delta",
    );
  }
  if (evidence.maximumHalfWidth >= strictestGateDelta) {
    throw new Error(
      "C6 repository design maximum half-width must be smaller than the strictest gate delta",
    );
  }
  if (
    evidence.planningRepositoryStandardDeviation <= 0 ||
    evidence.planningRepositoryStandardDeviation > 1 ||
    evidence.maximumHalfWidth <= 0 ||
    !Number.isSafeInteger(evidence.minimumRepositoryFamilies) ||
    evidence.minimumRepositoryFamilies < 2
  ) {
    throw new Error(
      "C6 repository design power input is outside the frozen domain",
    );
  }
  const powerRequiredRepositoryFamilies = Math.ceil((
    (
      (
        REPOSITORY_NORMAL_TWO_SIDED_95_Z +
        REPOSITORY_NORMAL_POWER_80_Z
      ) *
      evidence.planningRepositoryStandardDeviation
    ) /
    evidence.minimumDetectableEffect
  ) ** 2);
  const precisionRequiredRepositoryFamilies = Math.ceil((
    (
      REPOSITORY_NORMAL_TWO_SIDED_95_Z *
      evidence.planningRepositoryStandardDeviation
    ) /
    evidence.maximumHalfWidth
  ) ** 2);
  const requiredRepositoryFamilies = Math.max(
    evidence.minimumRepositoryFamilies,
    powerRequiredRepositoryFamilies,
    precisionRequiredRepositoryFamilies,
  );
  if (
    evidence.powerRequiredRepositoryFamilies !==
      powerRequiredRepositoryFamilies ||
    evidence.precisionRequiredRepositoryFamilies !==
      precisionRequiredRepositoryFamilies ||
    evidence.requiredRepositoryFamilies !== requiredRepositoryFamilies
  ) {
    throw new Error(
      "C6 repository design evidence restates a different required repository family count",
    );
  }
  if (
    !Number.isSafeInteger(evidence.requiredRepositoryFamilies) ||
    evidence.requiredRepositoryFamilies < 2
  ) {
    throw new Error(
      "C6 repository design evidence requires at least two repository families",
    );
  }

  const episodeIds = dataset.episodes.map((episode) => episode.id).sort();
  const bindingEpisodeIds = Object.keys(
    evidence.repositoryFamilyByEpisodeId,
  ).sort();
  if (
    bindingEpisodeIds.length !== episodeIds.length ||
    bindingEpisodeIds.some((episodeId, index) =>
      episodeId !== episodeIds[index]
    )
  ) {
    throw new Error(
      "C6 repository family evidence must cover every episode",
    );
  }

  const bindings = episodeIds.map((episodeId) => {
    const repositoryFamilyId =
      evidence.repositoryFamilyByEpisodeId[episodeId]!;
    if (
      repositoryFamilyId.length === 0 ||
      repositoryFamilyId.trim() !== repositoryFamilyId
    ) {
      throw new Error(
        "C6 repository family identifiers must be non-empty and trimmed",
      );
    }
    return {
      episodeId,
      repositoryFamilyId,
    };
  });
  const repositoryUrlByEpisodeId = new Map(
    dataset.episodes.map((episode) => [
      episode.id,
      episode.repository.url,
    ]),
  );
  const familyByRepositoryUrl = new Map<string, string>();
  for (const binding of bindings) {
    const repositoryUrl = repositoryUrlByEpisodeId.get(
      binding.episodeId,
    )!;
    const existingFamily = familyByRepositoryUrl.get(repositoryUrl);
    if (
      existingFamily !== undefined &&
      existingFamily !== binding.repositoryFamilyId
    ) {
      throw new Error(
        "C6 repository family evidence splits one repository URL",
      );
    }
    familyByRepositoryUrl.set(
      repositoryUrl,
      binding.repositoryFamilyId,
    );
  }
  const counts = new Map<string, number>();
  for (const binding of bindings) {
    counts.set(
      binding.repositoryFamilyId,
      (counts.get(binding.repositoryFamilyId) ?? 0) + 1,
    );
  }
  if (counts.size < evidence.requiredRepositoryFamilies) {
    throw new Error(
      `C6 repository design evidence requires at least ${evidence.requiredRepositoryFamilies} repository families`,
    );
  }
  const episodeCount = dataset.episodes.length;
  const effectiveRepositoryFamilies =
    episodeCount ** 2 /
    [...counts.values()].reduce(
      (sum, count) => sum + count ** 2,
      0,
    );
  if (
    evidence.effectiveRepositoryFamilies !==
      effectiveRepositoryFamilies
  ) {
    throw new Error(
      "C6 repository design effective repository family count does not match dataset bindings",
    );
  }
  if (
    effectiveRepositoryFamilies <
      evidence.requiredRepositoryFamilies
  ) {
    throw new Error(
      `C6 repository design evidence requires at least ` +
        `${evidence.requiredRepositoryFamilies} effective repository families`,
    );
  }
  if (
    evidence.actualRepositoryFamilies !== counts.size ||
    evidence.allocation.repositoryFamilies !== counts.size ||
    evidence.allocation.episodes !== episodeCount ||
    JSON.stringify(evidence.allocation.episodeCountByFamily) !==
      JSON.stringify(Object.fromEntries(
        [...counts].sort(([left], [right]) =>
          left.localeCompare(right)
        ),
      ))
  ) {
    throw new Error(
      "C6 repository design evidence allocation does not match dataset bindings",
    );
  }

  const episodeCountsByRepositoryFamily = [...counts]
    .map(([repositoryFamilyId, episodes]) => ({
      episodes,
      repositoryFamilyId,
    }))
    .sort((first, second) =>
      first.repositoryFamilyId.localeCompare(second.repositoryFamilyId)
    );
  const descendingEpisodeCounts = episodeCountsByRepositoryFamily
    .map(({ episodes }) => episodes)
    .sort((first, second) => second - first);
  const allocationConcentration = descendingEpisodeCounts.reduce(
    (sum, count) => sum + (count / episodeCount) ** 2,
    0,
  );

  return {
    actualRepositoryFamilies: counts.size,
    algorithm: evidence.algorithm,
    alpha: evidence.alpha,
    allocationConcentrationEquivalentCount:
      1 / allocationConcentration,
    confidenceLevel: evidence.confidenceLevel,
    declaredOutcomeAccess: evidence.declaredOutcomeAccess,
    designPowerArtifactSha256: evidence.designPowerArtifactSha256,
    effectiveRepositoryFamilies,
    episodeCountsByRepositoryFamily,
    episodeRepositoryFamilyBindingsSha256:
      evidence.episodeFamilyBindingSha256,
    groupingPolicy: evidence.groupingPolicy,
    cryptographicAuthenticity: false,
    largestRepositoryEpisodeShare:
      descendingEpisodeCounts[0]! / episodeCount,
    maximumHalfWidth: evidence.maximumHalfWidth,
    minimumDetectableEffect: evidence.minimumDetectableEffect,
    minimumRepositoryFamilies: evidence.minimumRepositoryFamilies,
    planningRepositoryStandardDeviation:
      evidence.planningRepositoryStandardDeviation,
    power: evidence.power,
    powerInputArtifactSha256: evidence.powerInputArtifactSha256,
    powerRequiredRepositoryFamilies:
      evidence.powerRequiredRepositoryFamilies,
    precisionRequiredRepositoryFamilies:
      evidence.precisionRequiredRepositoryFamilies,
    repositoryLineageArtifactSha256:
      evidence.repositoryLineageArtifactSha256,
    requiredBefore: [...requiredBefore],
    requiredRepositoryFamilies: evidence.requiredRepositoryFamilies,
    reviewReceiptSha256: evidence.reviewReceiptSha256,
    status: "review-receipt-structure-verified",
    topThreeRepositoryEpisodeShare:
      descendingEpisodeCounts.slice(0, 3).reduce(
        (sum, count) => sum + count,
        0,
      ) / episodeCount,
  };
}

function validateInput(input: C6CandidatePlanInput): void {
  parseC6GatePolicy(input.gatePolicy);
  for (const value of [
    input.assetLockSha256,
    input.assetRootSha256,
    input.c5Evidence.gateSha256,
    input.c5Evidence.independentReviewSha256,
    input.c5Evidence.provenanceSha256,
    input.c5Evidence.reportSha256,
    input.c5Evidence.verificationSha256,
    input.codex.cliPackageJsonSha256,
    input.codex.launcherSha256,
    input.codex.nativeBinarySha256,
    input.codex.platformPackageJsonSha256,
    input.flatSummary.promptSha256,
    input.flatSummary.protocolSha256,
    input.flatSummary.tokenCounterSha256,
    input.gatePolicySha256,
    input.manifestSha256,
    input.package.filesManifestSha256,
    input.package.sha256,
    input.platform.environmentManifestSha256,
    input.platform.imageSha256,
    input.pricingReceiptSha256,
    input.pricingSnapshotSha256,
    input.staticLeakageAuditSha256,
    input.taskOriginReviewEvidence.dispatchSha256,
    input.taskOriginReviewEvidence.inputSha256,
    input.taskOriginReviewEvidence.provenanceSha256,
    input.taskOriginReviewEvidence.requestSha256,
    input.taskOriginReviewEvidence.responseSha256,
  ]) {
    if (!/^[a-f0-9]{64}$/u.test(value)) {
      throw new Error("C6 candidate bindings must be SHA-256 digests");
    }
  }
  if (input.codex.launcherSha256 === input.codex.nativeBinarySha256) {
    throw new Error(
      "C6 Codex launcher and native binary identities must be distinct",
    );
  }
  if (
    input.taskOriginReviewEvidence.cryptographicReceipt !== false ||
    input.taskOriginReviewEvidence.reviewerAgentName.length === 0 ||
    input.taskOriginReviewEvidence.reviewerAgentName.trim() !==
      input.taskOriginReviewEvidence.reviewerAgentName
  ) {
    throw new Error("C6 task-origin review evidence is invalid");
  }
  if (
    input.seeds.length !== 3 ||
    new Set(input.seeds).size !== 3 ||
    input.seeds.some((seed) => !Number.isSafeInteger(seed) || seed <= 0)
  ) {
    throw new Error("C6 candidate requires exactly three distinct seeds");
  }
  if (
    input.platform.operatingSystem !== "linux" ||
    input.platform.architecture !== "x64"
  ) {
    throw new Error("C6 claim candidate requires Linux x64");
  }
  if (
    !Number.isSafeInteger(input.maxConcurrency) ||
    input.maxConcurrency <= 0
  ) {
    throw new Error("C6 max concurrency must be a positive safe integer");
  }
  if (
    !Number.isSafeInteger(input.flatSummary.maxInjectedTokens) ||
    input.flatSummary.maxInjectedTokens <= 0
  ) {
    throw new Error("C6 flat-summary token budget must be positive");
  }
  if (
    input.flatSummary.tokenCounterSha256 !==
      C6_INJECTION_TOKEN_COUNTER_SHA256
  ) {
    throw new Error("C6 candidate requires the frozen injection token counter");
  }
  if (input.c5Evidence.planningMaterialEffectRate !== 0.1) {
    throw new Error(
      "C6 candidate requires the C5-powered 10 percentage-point material effect",
    );
  }
  if (
    input.c5Evidence.c5ReportedRequiredEpisodes !== 113 ||
    input.c5Evidence.headlineMinimumPosition !== 2 ||
    input.c5Evidence.headlineObservationsPerEpisode !== 6 ||
    input.c5Evidence.headlineDesignEffect !== 6
  ) {
    throw new Error("C6 candidate requires the conservative headline power correction");
  }
  if (
    !Number.isSafeInteger(input.c5Evidence.requiredEpisodes) ||
    input.c5Evidence.requiredEpisodes !== C6_HEADLINE_EPISODE_COUNT ||
    !Number.isSafeInteger(input.c5Evidence.requiredRepositories) ||
    input.c5Evidence.requiredRepositories < 6 ||
    !Number.isSafeInteger(input.c5Evidence.requiredScoredStages) ||
    input.c5Evidence.requiredScoredStages !==
      C6_HEADLINE_SCORED_STAGE_COUNT
  ) {
    throw new Error(
      "C6 candidate requires the exact conservative headline budget",
    );
  }
  if (
    !Number.isSafeInteger(input.c5Evidence.incomparablePairs) ||
    input.c5Evidence.incomparablePairs < 0 ||
    !Number.isSafeInteger(input.c5Evidence.infrastructureFailureCount) ||
    input.c5Evidence.infrastructureFailureCount < 0
  ) {
    throw new Error("C6 C5 prerequisite counts must be non-negative integers");
  }
  for (const value of [input.stageTimeoutMs, input.testTimeoutMs]) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error("C6 timeouts must be positive safe integers");
    }
  }
  if (
    !/^[a-f0-9]{40}$/u.test(input.runnerSource.commit) ||
    !/^[a-f0-9]{40}$/u.test(input.runnerSource.tree)
  ) {
    throw new Error("C6 runner source must bind a Git commit and tree");
  }
  for (const value of [
    input.c5Evidence.runId,
    input.codex.model,
    input.codex.reasoningEffort,
    input.codex.version,
    input.flatSummary.model,
    input.flatSummary.provider,
    input.package.version,
  ]) {
    if (value.length === 0 || value.trim() !== value) {
      throw new Error("C6 candidate identity values must be non-empty and trimmed");
    }
  }
  if (!Number.isSafeInteger(input.package.fileCount) || input.package.fileCount <= 0) {
    throw new Error("C6 package file count must be a positive safe integer");
  }
}

function validateDataset(
  input: C6CandidatePlanInput,
): CodexCodingEffectDatasetV3 {
  const parsed = parseCodexCodingEffectDataset(input.dataset);
  if (parsed.schemaVersion !== 3) {
    throw new Error("C6 candidate requires dataset schema version 3");
  }
  if (
    parsed.sourceLineage === undefined ||
    parsed.sourceLineage.sha256 !== input.datasetLineage.lineageSha256
  ) {
    throw new Error(
      "C6 candidate dataset source lineage does not match lineage evidence",
    );
  }
  const primaryCodingEpisodes = parsed.episodes.filter(
    isPrimaryCodingEpisode,
  );
  if (
    primaryCodingEpisodes.length !==
      input.c5Evidence.requiredEpisodes
  ) {
    throw new Error(
      `C6 candidate requires exactly ${input.c5Evidence.requiredEpisodes} primary coding cohort episodes`,
    );
  }
  const pilotOnly = parsed.episodes.find((episode) =>
    episode.claimEligibility !== "claim-eligible"
  );
  if (pilotOnly !== undefined) {
    throw new Error(`C6 candidate cannot include pilot-only episode ${pilotOnly.id}`);
  }
  const repositories = new Set(primaryCodingEpisodes.map((episode) =>
    episode.repository.url
  ));
  if (repositories.size < input.c5Evidence.requiredRepositories) {
    throw new Error(
      `C6 candidate requires at least ${input.c5Evidence.requiredRepositories} repositories`,
    );
  }
  if (
    new Set(primaryCodingEpisodes.map((episode) =>
      episode.ecosystem
    )).size < 2
  ) {
    throw new Error("C6 candidate requires at least 2 ecosystems");
  }
  if (parsed.episodes.some((episode) =>
    episode.sourceType === "controlled-mutation"
  )) {
    throw new Error(
      "C6 controlled-mutation diagnostics must be reported outside the primary candidate dataset",
    );
  }
  if (!parsed.episodes.some((episode) =>
    episode.sourceType === "real-history"
  )) {
    throw new Error("C6 candidate requires real-history episodes");
  }
  const realHistoryEpisodeCount = parsed.episodes.filter((episode) =>
    episode.sourceType === "real-history"
  ).length;
  if (realHistoryEpisodeCount < C6_MINIMUM_REAL_HISTORY_EPISODES) {
    throw new Error(
      `C6 candidate requires at least ${C6_MINIMUM_REAL_HISTORY_EPISODES} real-history episodes`,
    );
  }
  for (const episode of parsed.episodes) {
    const receipt = episode.taskOriginReceipt;
    const evidence = input.taskOriginEvidenceByEpisodeId[episode.id];
    if (
      receipt === undefined ||
      evidence === undefined ||
      evidence.receiptSha256 !== receipt.sha256 ||
      !/^[a-f0-9]{64}$/u.test(evidence.sourceRecordSha256) ||
      evidence.stageOrigins.length !== episode.stages.length ||
      evidence.relationshipEdges.length !== episode.stages.length - 1
    ) {
      throw new Error(
        `C6 ${episode.sourceType} episode ${episode.id} requires task-origin evidence`,
      );
    }
    if (
      evidence.candidateTaskContentSha256 !==
        input.taskContentSha256ByEpisodeId[episode.id]
    ) {
      throw new Error(
        `C6 ${episode.sourceType} episode ${episode.id} task-origin evidence does not bind task content`,
      );
    }
    const repositoryLocator = episode.repository.url.replace(/\.git$/u, "");
    const lineageStages =
      input.datasetLineage.episodeById[episode.id]?.stages;
    const allStageOriginsMatch = lineageStages !== undefined &&
      lineageStages.length === evidence.stageOrigins.length &&
      evidence.stageOrigins.every((origin, index) => {
        const stage = episode.stages[index];
        const lineageStage = lineageStages[index];
        const target = lineageStage?.target;
        return (
          stage !== undefined &&
          lineageStage !== undefined &&
          target !== undefined &&
          origin.stageId === stage.id &&
          origin.stageId === lineageStage.stageId &&
          origin.sourceLocator.startsWith(`${repositoryLocator}/`) &&
          /^[a-f0-9]{64}$/u.test(origin.originalRequestSha256) &&
          Number.isSafeInteger(origin.originReceiptBytes) &&
          origin.originReceiptBytes > 0 &&
          origin.originReceiptPath.startsWith(
            "provenance/task-origin/upstream-receipts/",
          ) &&
          /^[a-f0-9]{64}$/u.test(origin.originReceiptSha256) &&
          /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(
            origin.upstreamItemRevision,
          ) &&
          target.locator === origin.sourceLocator &&
          target.normalizedSourceRequestSha256 ===
            origin.originalRequestSha256 &&
          target.upstreamItemRevision === origin.upstreamItemRevision
        );
      });
    if (!allStageOriginsMatch) {
      throw new Error(
        `C6 ${episode.sourceType} episode ${episode.id} dataset lineage does not bind every stage origin`,
      );
    }
    const lineageRelationships =
      input.datasetLineage.episodeById[episode.id]?.relationships;
    const relationshipBindings = evidence.relationshipEdges.map(
      (relationship) => ({
        commitPathSha256: relationship.commitPathSha256,
        edgeId: relationship.edgeId,
        episodeId: relationship.episodeId,
        laterBaseCommit: relationship.laterBaseCommit,
        laterRequestAt: relationship.laterRequestAt,
        laterStageId: relationship.laterStageId,
        priorCompletionAt: relationship.priorCompletionAt,
        priorMergeCommit: relationship.priorMergeCommit,
        priorStageId: relationship.priorStageId,
        relationshipReceiptBytes:
          relationship.relationshipReceiptBytes,
        relationshipReceiptPath:
          relationship.relationshipReceiptPath,
        relationshipReceiptSha256:
          relationship.relationshipReceiptSha256,
      }),
    );
    if (
      lineageRelationships === undefined ||
      JSON.stringify(relationshipBindings) !==
        JSON.stringify(lineageRelationships)
    ) {
      throw new Error(
        `C6 ${episode.sourceType} episode ${episode.id} dataset lineage does not bind every task relationship`,
      );
    }
  }
  const reviewedEpisodeIds = parsed.episodes.map((episode) => episode.id);
  const relationshipDecisionIdentities = parsed.episodes.flatMap(
    (episode) =>
      input.taskOriginEvidenceByEpisodeId[episode.id]!.relationshipEdges
        .map((relationship) => ({
          edgeId: relationship.edgeId,
          episodeId: episode.id,
          relationshipReceiptSha256:
            relationship.relationshipReceiptSha256,
        })),
  );
  if (
    input.taskOriginReviewEvidence.reviewedEpisodeIdsSha256 !==
      sha256(JSON.stringify(reviewedEpisodeIds)) ||
    input.taskOriginReviewEvidence
      .relationshipDecisionIdentitySetSha256 !==
      sha256(JSON.stringify(relationshipDecisionIdentities)) ||
    input.taskOriginReviewEvidence.relationshipDecisionCount !==
      relationshipDecisionIdentities.length
  ) {
    throw new Error(
      "C6 task-origin review evidence does not bind the exact episode and relationship decision sets",
    );
  }
  if (
    parsed.episodes.some((episode) =>
      episode.author ===
        input.taskOriginReviewEvidence.reviewerAgentName
    ) ||
    Number.isNaN(Date.parse(input.taskOriginReviewEvidence.reviewedAt))
  ) {
    throw new Error(
      "C6 task-origin review evidence is not independently attributable",
    );
  }
  for (const episode of parsed.episodes) {
    if (
      episode.primaryStratum === undefined ||
      !episode.strata.includes(episode.primaryStratum)
    ) {
      throw new Error(
        `C6 candidate episode ${episode.id} requires one declared primary stratum`,
      );
    }
    for (const stage of episode.stages) {
      if (stage.position < 2) {
        continue;
      }
      const dependencyCategories = new Set(
        stage.memoryExpectation.dependencies.map((dependency) =>
          dependency.category
        ),
      );
      const hasIrrelevantControl = dependencyCategories.has(
        "irrelevant-memory-negative-control",
      );
      if (
        hasIrrelevantControl !==
          (stage.memoryExpectation.mode === "irrelevant-control") ||
        (
          stage.memoryExpectation.mode === "irrelevant-control" &&
          dependencyCategories.size !== 1
        )
      ) {
        throw new Error(
          `C6 candidate episode ${episode.id} irrelevant-memory-negative-control requires irrelevant-control mode`,
        );
      }
    }
    const headlineStrata = headlineMemoryStrata(episode);
    for (const stratum of episode.strata) {
      if (!headlineStrata.has(stratum)) {
        throw new Error(
          `C6 candidate episode ${episode.id} declares memory stratum ${stratum} without a positions-two-and-later memory expectation`,
        );
      }
    }
    if (episode.strata.includes("no-history-negative-control")) {
      const invalidStage = episode.stages.find((stage) =>
        stage.position >= 2 &&
        (
          stage.memoryExpectation.mode !== "none" ||
          stage.memoryExpectation.dependencies.length !== 0
        )
      );
      if (invalidStage !== undefined) {
        throw new Error(
          `C6 candidate episode ${episode.id} no-history-negative-control requires none mode`,
        );
      }
    }
  }
  const primaryStratumCounts = buildPrimaryStratumCounts(parsed);
  const minimumEpisodesPerStratum = Math.floor(
    input.c5Evidence.requiredEpisodes /
      CODEX_CODING_EFFECT_MEMORY_STRATA.length,
  );
  for (const stratum of CODEX_CODING_EFFECT_MEMORY_STRATA) {
    if (primaryStratumCounts[stratum] === 0) {
      throw new Error(`C6 candidate does not cover memory stratum ${stratum}`);
    }
    if (primaryStratumCounts[stratum] < minimumEpisodesPerStratum) {
      throw new Error(
        `C6 candidate requires at least ${minimumEpisodesPerStratum} primary episodes for memory stratum ${stratum}`,
      );
    }
  }
  for (const episode of parsed.episodes) {
    if (episode.stateMode !== "canonical-snapshot") {
      throw new Error(
        `C6 candidate episode ${episode.id} must use canonical-snapshot`,
      );
    }
    if (episode.stages.length !== C6_STAGES_PER_EPISODE) {
      throw new Error(
        `C6 candidate episode ${episode.id} requires exactly ${C6_STAGES_PER_EPISODE} stages`,
      );
    }
    if (
      episode.repository.license.toLowerCase() === "unknown" ||
      episode.repository.redistributionAllowed !== true ||
      episode.repository.redistributionReviewed !== true
    ) {
      throw new Error(
        `C6 candidate episode ${episode.id} requires a reviewed license`,
      );
    }
    if (episode.repository.assetPath === undefined) {
      throw new Error(
        `C6 candidate episode ${episode.id} requires an asset-locked repository`,
      );
    }
  }
  if (
    input.taskOriginReviewEvidence.relationshipDecisionCount !==
      C6_HEADLINE_EPISODE_COUNT * (C6_STAGES_PER_EPISODE - 1)
  ) {
    throw new Error(
      "C6 task-origin review must accept every adjacent task relationship",
    );
  }
  if (
    new Set(primaryCodingEpisodes.map((episode) =>
      episode.repository.assetPath
    )).size < input.c5Evidence.requiredRepositories
  ) {
    throw new Error(
      `C6 candidate requires at least ${input.c5Evidence.requiredRepositories} asset-locked repositories`,
    );
  }
  for (const episode of parsed.episodes) {
    const value = input.taskContentSha256ByEpisodeId[episode.id];
    assertSha256(value, `C6 candidate episode ${episode.id} task content`);
  }
  const repositoryAssetPaths = new Set(primaryCodingEpisodes.map((episode) =>
    episode.repository.assetPath!
  ));
  const repositoryContentSha256 = [...repositoryAssetPaths].map((path) => {
    const value = input.repositoryContentSha256ByAssetPath[path];
    assertSha256(value, `C6 candidate repository ${path} content`);
    return value;
  });
  if (
    new Set(repositoryContentSha256).size <
      input.c5Evidence.requiredRepositories
  ) {
    throw new Error(
      `C6 candidate requires at least ${input.c5Evidence.requiredRepositories} distinct repository content roots`,
    );
  }
  const scoredStages = parsed.episodes.reduce(
    (count, episode) => count + episode.stages.length,
    0,
  );
  const headlineScoredStages = primaryCodingEpisodes.reduce(
    (count, episode) => count + episode.stages.length,
    0,
  );
  if (
    headlineScoredStages !==
      input.c5Evidence.requiredScoredStages
  ) {
    throw new Error(
      `C6 candidate requires exactly ${input.c5Evidence.requiredScoredStages} scored stages`,
    );
  }
  validateDatasetLineageEvidence(input, parsed, scoredStages);
  const taskFingerprints = parsed.episodes.map((episode) =>
    candidateInputFingerprintSha256(episode, input)
  );
  if (new Set(taskFingerprints).size !== taskFingerprints.length) {
    throw new Error("C6 candidate rejects duplicate task content");
  }
  return parsed;
}

function validateDatasetLineageEvidence(
  input: C6CandidatePlanInput,
  dataset: CodexCodingEffectDatasetV3,
  scoredStages: number,
): void {
  assertSha256(
    input.datasetLineage.lineageSha256,
    "C6 candidate dataset lineage",
  );
  const lineageEpisodeIds = Object.keys(
    input.datasetLineage.episodeById,
  ).sort();
  const datasetEpisodeIds = dataset.episodes.map((episode) =>
    episode.id
  ).sort();
  if (
    lineageEpisodeIds.length !== datasetEpisodeIds.length ||
    lineageEpisodeIds.some((episodeId, index) =>
      episodeId !== datasetEpisodeIds[index]
    )
  ) {
    throw new Error("C6 candidate dataset lineage must cover every episode");
  }
  const sourceIds = new Set<string>();
  const targetKeys = new Set<string>();
  const targetRecordHashes = new Set<string>();
  const targetLocators = new Set<string>();
  for (const episode of dataset.episodes) {
    const lineage = input.datasetLineage.episodeById[episode.id];
    if (
      lineage === undefined ||
      lineage.sourceId.length === 0 ||
      lineage.sourceId.trim() !== lineage.sourceId ||
      lineage.stages.length !== episode.stages.length
    ) {
      throw new Error(
        `C6 candidate episode ${episode.id} requires dataset lineage`,
      );
    }
    assertSha256(
      lineage.agentVisibleTaskSha256,
      `C6 candidate episode ${episode.id} agent-visible task lineage`,
    );
    if (
      lineage.agentVisibleTaskSha256 !==
        input.taskContentSha256ByEpisodeId[episode.id]
    ) {
      throw new Error(
        `C6 candidate episode ${episode.id} agent-visible task lineage does not match`,
      );
    }
    assertSha256(
      lineage.stageHistoryClosureSha256,
      `C6 candidate episode ${episode.id} stage history closure`,
    );
    assertSha256(
      lineage.episodeStageClosureSha256,
      `C6 candidate episode ${episode.id} episode stage closure`,
    );
    sourceIds.add(lineage.sourceId);
    const noHistoryControl = episode.strata.includes(
      "no-history-negative-control",
    );
    const normalizedStages = lineage.stages.map((lineageStage, index) => {
      const stage = episode.stages[index]!;
      const { history, target } = lineageStage;
      if (
        lineageStage.stageId !== stage.id ||
        history.artifactSha256 !== stage.history.sha256 ||
        target.sourceUnitId.length === 0 ||
        target.sourceUnitId.trim() !== target.sourceUnitId
      ) {
        throw new Error(
          `C6 candidate episode ${episode.id} stage lineage does not match`,
        );
      }
      assertSha256(
        history.artifactSha256,
        `C6 candidate episode ${episode.id} stage history artifact`,
      );
      assertSha256(
        history.materializationSha256,
        `C6 candidate episode ${episode.id} stage history materialization`,
      );
      assertSha256(
        history.sourceUnitIdsSha256,
        `C6 candidate episode ${episode.id} stage history source units`,
      );
      if (
        !Number.isSafeInteger(history.sourceUnitCount) ||
        history.sourceUnitCount < 0
      ) {
        throw new Error(
          `C6 candidate episode ${episode.id} stage history source-unit count is invalid`,
        );
      }
      if (
        noHistoryControl &&
        (
          history.artifactSha256 !== EMPTY_FROZEN_PREHISTORY_SHA256 ||
          history.sourceUnitCount !== 0 ||
          history.sourceUnitIdsSha256 !== sha256(JSON.stringify([])) ||
          history.materializationSha256 !== sha256(JSON.stringify({
            historyArtifactSha256: EMPTY_FROZEN_PREHISTORY_SHA256,
            sourceId: lineage.sourceId,
            sourceUnitRecordSha256: [],
          }))
        )
      ) {
        throw new Error(
          `C6 candidate episode ${episode.id} no-history-negative-control requires canonical empty stage history`,
        );
      }
      if (
        !noHistoryControl &&
        (
          history.artifactSha256 === EMPTY_FROZEN_PREHISTORY_SHA256 ||
          history.sourceUnitCount === 0
        )
      ) {
        throw new Error(
          `C6 candidate episode ${episode.id} non-control stage history requires at least one source unit`,
        );
      }
      assertSha256(
        lineageStage.stageLineageSha256,
        `C6 candidate episode ${episode.id} stage lineage closure`,
      );
      assertSha256(
        target.normalizedSourceRequestSha256,
        `C6 candidate episode ${episode.id} normalized target source request`,
      );
      assertSha256(
        target.recordSha256,
        `C6 candidate episode ${episode.id} target lineage`,
      );
      assertSha256(
        target.sourceRequestSha256,
        `C6 candidate episode ${episode.id} target source request`,
      );
      if (
        target.sourceRequestNormalization !==
          "ecmascript-string-trim-v1" ||
        !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(
          target.upstreamItemRevision,
        )
      ) {
        throw new Error(
          `C6 candidate episode ${episode.id} target source binding is invalid`,
        );
      }
      if (
        !target.locator.startsWith("https://") ||
        target.locator.trim() !== target.locator
      ) {
        throw new Error(
          `C6 candidate episode ${episode.id} target locator is invalid`,
        );
      }
      const normalizedStage = {
        history: {
          artifactSha256: history.artifactSha256,
          materializationSha256: history.materializationSha256,
          sourceUnitCount: history.sourceUnitCount,
          sourceUnitIdsSha256: history.sourceUnitIdsSha256,
        },
        stageId: lineageStage.stageId,
        stageLineageSha256: lineageStage.stageLineageSha256,
        target: {
          locator: target.locator,
          normalizedSourceRequestSha256:
            target.normalizedSourceRequestSha256,
          recordSha256: target.recordSha256,
          sourceRequestSha256: target.sourceRequestSha256,
          sourceRequestNormalization:
            target.sourceRequestNormalization,
          sourceUnitId: target.sourceUnitId,
          upstreamItemRevision: target.upstreamItemRevision,
        },
      };
      const expectedStageLineageSha256 = sha256(JSON.stringify({
        history: normalizedStage.history,
        stageId: normalizedStage.stageId,
        target: normalizedStage.target,
      }));
      if (
        lineageStage.stageLineageSha256 !==
          expectedStageLineageSha256
      ) {
        throw new Error(
          `C6 candidate episode ${episode.id} stage lineage closure does not match`,
        );
      }
      const key = `${lineage.sourceId}:${target.sourceUnitId}`;
      if (targetKeys.has(key)) {
        throw new Error(
          "C6 candidate dataset lineage rejects reused target source unit",
        );
      }
      if (targetRecordHashes.has(target.recordSha256)) {
        throw new Error(
          "C6 candidate dataset lineage rejects reused target source record",
        );
      }
      if (targetLocators.has(target.locator)) {
        throw new Error(
          "C6 candidate dataset lineage rejects reused target source locator",
        );
      }
      targetKeys.add(key);
      targetRecordHashes.add(target.recordSha256);
      targetLocators.add(target.locator);
      return normalizedStage;
    });
    const expectedHistoryClosureSha256 = sha256(JSON.stringify(
      normalizedStages.map((stage, index) => ({
        historyArtifactSha256: stage.history.artifactSha256,
        historyMaterializationSha256:
          stage.history.materializationSha256,
        historySourceUnitCount: stage.history.sourceUnitCount,
        historySourceUnitIdsSha256:
          stage.history.sourceUnitIdsSha256,
        stageId: stage.stageId,
        stagePosition: index + 1,
      })),
    ));
    if (
      lineage.stageHistoryClosureSha256 !==
        expectedHistoryClosureSha256
    ) {
      throw new Error(
        `C6 candidate episode ${episode.id} stage history closure does not match`,
      );
    }
    const normalizedRelationships = lineage.relationships.map(
      (relationship) => ({
        commitPathSha256: relationship.commitPathSha256,
        edgeId: relationship.edgeId,
        episodeId: relationship.episodeId,
        laterBaseCommit: relationship.laterBaseCommit,
        laterRequestAt: relationship.laterRequestAt,
        laterStageId: relationship.laterStageId,
        priorCompletionAt: relationship.priorCompletionAt,
        priorMergeCommit: relationship.priorMergeCommit,
        priorStageId: relationship.priorStageId,
        relationshipReceiptBytes:
          relationship.relationshipReceiptBytes,
        relationshipReceiptPath:
          relationship.relationshipReceiptPath,
        relationshipReceiptSha256:
          relationship.relationshipReceiptSha256,
      }),
    );
    const expectedRelationshipClosureSha256 = sha256(JSON.stringify({
      episodeId: episode.id,
      relationships: normalizedRelationships,
    }));
    if (
      lineage.relationshipClosureSha256 !==
        expectedRelationshipClosureSha256
    ) {
      throw new Error(
        `C6 candidate episode ${episode.id} relationship closure does not match`,
      );
    }
    const expectedEpisodeClosureSha256 = sha256(JSON.stringify({
      agentVisibleTaskSha256: lineage.agentVisibleTaskSha256,
      episodeId: episode.id,
      relationshipClosureSha256:
        expectedRelationshipClosureSha256,
      relationships: normalizedRelationships,
      sourceId: lineage.sourceId,
      stages: normalizedStages,
    }));
    if (
      lineage.episodeStageClosureSha256 !==
        expectedEpisodeClosureSha256
    ) {
      throw new Error(
        `C6 candidate episode ${episode.id} episode stage closure does not match`,
      );
    }
  }
  const populationSourceIds = Object.keys(
    input.datasetLineage.sourcePopulationSha256BySourceId,
  );
  const licenseSourceIds = Object.keys(
    input.datasetLineage.licenseEvidenceSha256BySourceId,
  );
  if (
    input.datasetLineage.sourceSnapshotCount !== sourceIds.size ||
    populationSourceIds.length !== sourceIds.size ||
    licenseSourceIds.length !== sourceIds.size ||
    ![...sourceIds].every((sourceId) =>
      populationSourceIds.includes(sourceId) &&
      licenseSourceIds.includes(sourceId)
    )
  ) {
    throw new Error(
      "C6 candidate dataset lineage source snapshots do not match",
    );
  }
  for (const sourceId of sourceIds) {
    assertSha256(
      input.datasetLineage.sourcePopulationSha256BySourceId[sourceId],
      `C6 candidate dataset lineage source population ${sourceId}`,
    );
    assertSha256(
      input.datasetLineage.licenseEvidenceSha256BySourceId[sourceId],
      `C6 candidate dataset lineage license evidence ${sourceId}`,
    );
  }
  if (
    input.datasetLineage.targetSourceUnitCount !== scoredStages ||
    input.datasetLineage.uniqueTargetRecordFingerprints !== scoredStages ||
    targetKeys.size !== scoredStages ||
    targetRecordHashes.size !== scoredStages ||
    targetLocators.size !== scoredStages
  ) {
    throw new Error(
      "C6 candidate dataset lineage must bind one unique target per scored stage",
    );
  }
}

function buildEpisodeBinding(
  episode: CodexCodingEffectDatasetV3["episodes"][number],
  input: C6CandidatePlanInput,
  repositoryFamilyId: string | null,
): C6CandidateEpisodeBinding {
  const sourceLineage = input.datasetLineage.episodeById[episode.id]!;
  const taskOriginEvidence = input.taskOriginEvidenceByEpisodeId[episode.id];
  const taskContentSha256 =
    input.taskContentSha256ByEpisodeId[episode.id]!;
  const stageBindings = episode.stages.map((stage, index) => {
    const stageLineage = sourceLineage.stages[index]!;
    const lineageBinding = {
      history: {
        artifactSha256: stageLineage.history.artifactSha256,
        materializationSha256:
          stageLineage.history.materializationSha256,
        sourceUnitCount: stageLineage.history.sourceUnitCount,
        sourceUnitIdsSha256:
          stageLineage.history.sourceUnitIdsSha256,
      },
      stageLineageSha256: stageLineage.stageLineageSha256,
      target: {
        ...stageLineage.target,
      },
    };
    const treatment = buildStageTreatment(
      episode.strata.includes("no-history-negative-control"),
    );
    return {
      historySourceSha256: stage.history.sha256,
      sourceLineage: lineageBinding,
      stageId: stage.id,
      stageInputSha256: sha256(JSON.stringify({
        episodeId: episode.id,
        historySourceSha256: stage.history.sha256,
        promptPath: stage.promptPath,
        snapshot: stage.snapshot,
        stageId: stage.id,
        stageLineageSha256: stageLineage.stageLineageSha256,
        taskContentSha256,
        treatment,
      })),
      treatment,
    };
  });
  const episodeSourceLineage = {
    agentVisibleTaskSha256:
      sourceLineage.agentVisibleTaskSha256,
    episodeStageClosureSha256:
      sourceLineage.episodeStageClosureSha256,
    relationshipClosureSha256:
      sourceLineage.relationshipClosureSha256,
    sourceId: sourceLineage.sourceId,
    stageHistoryClosureSha256:
      sourceLineage.stageHistoryClosureSha256,
  };
  return {
    ecosystem: episode.ecosystem,
    episodeId: episode.id,
    episodeInputSha256: sha256(JSON.stringify({
      episodeId: episode.id,
      sourceLineage: episodeSourceLineage,
      stageInputs: stageBindings.map((stage) => ({
        stageId: stage.stageId,
        stageInputSha256: stage.stageInputSha256,
      })),
      taskContentSha256,
    })),
    language: episode.language,
    primaryStratum: episode.primaryStratum!,
    repository: {
      assetPath: episode.repository.assetPath!,
      baseCommit: episode.repository.baseCommit,
      contentSha256:
        input.repositoryContentSha256ByAssetPath[
          episode.repository.assetPath!
        ]!,
      license: episode.repository.license,
      redistributionAllowed: true,
      redistributionReviewed: true,
      url: episode.repository.url,
    },
    repositoryFamilyId,
    sourceType: episode.sourceType,
    sourceLineage: episodeSourceLineage,
    stageBindings,
    stateMode: "canonical-snapshot",
    strata: [...episode.strata],
    taskContentSha256,
    taskOriginEvidence: {
      candidateTaskContentSha256:
        taskOriginEvidence!.candidateTaskContentSha256,
      receiptPath: episode.taskOriginReceipt!.path,
      receiptSha256: taskOriginEvidence!.receiptSha256,
      reviewedAt: input.taskOriginReviewEvidence.reviewedAt,
      reviewerAgentName:
        input.taskOriginReviewEvidence.reviewerAgentName,
      relationshipEdges: sourceLineage.relationships.map(
        (relationship) => ({ ...relationship }),
      ),
      sourceRecordSha256: taskOriginEvidence!.sourceRecordSha256,
      stageOrigins: taskOriginEvidence!.stageOrigins.map((origin) => ({
        ...origin,
      })),
      status:
        "candidate-closure-accepted-readiness-artifact-verification-required",
    },
  };
}

function buildStageTreatment(
  noHistoryControl: boolean,
): C6CandidateEpisodeBinding["stageBindings"][number]["treatment"] {
  if (noHistoryControl) {
    return {
      flatSummary: {
        compositionSha256:
          C6_NO_HISTORY_ZERO_INJECTION_COMPOSITION_SHA256,
        injectionMode: "no-history-zero-injection",
        providerCall: "prohibited",
      },
      goodMemory: {
        compositionSha256:
          C6_NO_HISTORY_ZERO_INJECTION_COMPOSITION_SHA256,
        injectionMode: "no-history-zero-injection",
      },
    };
  }
  return {
    flatSummary: {
      compositionSha256:
        C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
      injectionMode: "content-injection",
      providerCall: "required",
    },
    goodMemory: {
      compositionSha256:
        C6_GOODMEMORY_INJECTION_COMPOSITION_SHA256,
      injectionMode: "content-injection",
    },
  };
}

function candidateInputFingerprintSha256(
  episode: CodexCodingEffectDatasetV3["episodes"][number],
  input: C6CandidatePlanInput,
): string {
  const lineage = input.datasetLineage.episodeById[episode.id]!;
  return sha256(JSON.stringify({
    stageHistories: episode.stages.map((stage, index) => ({
      history: lineage.stages[index]!.history,
      historySourceSha256: stage.history.sha256,
      stageId: stage.id,
    })),
    taskContentSha256:
      input.taskContentSha256ByEpisodeId[episode.id]!,
  }));
}

function candidateTaskFingerprintSha256(
  episode: C6CandidateEpisodeBinding,
): string {
  return sha256(JSON.stringify({
    stageHistories: episode.stageBindings.map((stage) => ({
      history: stage.sourceLineage.history,
      historySourceSha256: stage.historySourceSha256,
      stageId: stage.stageId,
    })),
    taskContentSha256: episode.taskContentSha256,
  }));
}

function buildHeadlineStratumCounts(
  dataset: CodexCodingEffectDatasetV3,
): Record<(typeof CODEX_CODING_EFFECT_MEMORY_STRATA)[number], number> {
  return Object.fromEntries(CODEX_CODING_EFFECT_MEMORY_STRATA.map((stratum) => [
    stratum,
    dataset.episodes.filter((episode) =>
      isPrimaryCodingEpisode(episode) &&
      headlineMemoryStrata(episode).has(stratum)
    ).length,
  ])) as Record<
    (typeof CODEX_CODING_EFFECT_MEMORY_STRATA)[number],
    number
  >;
}

function buildPrimaryStratumCounts(
  dataset: CodexCodingEffectDatasetV3,
): Record<(typeof CODEX_CODING_EFFECT_MEMORY_STRATA)[number], number> {
  return Object.fromEntries(CODEX_CODING_EFFECT_MEMORY_STRATA.map((stratum) => [
    stratum,
    dataset.episodes.filter((episode) =>
      isPrimaryCodingEpisode(episode) &&
      episode.primaryStratum === stratum
    ).length,
  ])) as Record<
    (typeof CODEX_CODING_EFFECT_MEMORY_STRATA)[number],
    number
  >;
}

function isPrimaryCodingEpisode(
  episode: CodexCodingEffectDatasetV3["episodes"][number],
): boolean {
  return episode.sourceType === "real-history" ||
    episode.sourceType === "external-benchmark";
}

function headlineMemoryStrata(
  episode: CodexCodingEffectDatasetV3["episodes"][number],
): Set<(typeof CODEX_CODING_EFFECT_MEMORY_STRATA)[number]> {
  const strata = new Set<
    (typeof CODEX_CODING_EFFECT_MEMORY_STRATA)[number]
  >();
  for (const stage of episode.stages) {
    if (stage.position < 2) {
      continue;
    }
    if (
      stage.memoryExpectation.mode === "none" &&
      episode.strata.includes("no-history-negative-control")
    ) {
      strata.add("no-history-negative-control");
    }
    for (const dependency of stage.memoryExpectation.dependencies) {
      strata.add(dependency.category);
    }
  }
  return strata;
}

function assertSha256(value: string | undefined, label: string): void {
  if (value === undefined || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be an asset-derived SHA-256 digest`);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
