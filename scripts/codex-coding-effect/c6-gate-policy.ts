import { z } from "zod";

export const c6GatePolicySchema = z.object({
  bootstrap: z.object({
    algorithm: z.literal("paired-episode-cluster-percentile-v1"),
    claimRole: z.literal("diagnostic-only"),
    confidenceLevel: z.literal(0.95),
    resamplingUnit: z.literal("episode"),
    samples: z.literal(10_000),
    seed: z.number().int().positive(),
  }).strict(),
  claimBranches: z.object({
    flatSummaryDisclosureRequired: z.literal(true),
    noMemoryOnlyClaimMode: z.literal("durable-historical-context"),
    policySuperiorityRequiresStrongControl: z.literal(true),
    repositoryRobustnessRequiredForCodingEffectClaim: z.literal(true),
  }).strict(),
  estimand: z.object({
    metric: z.literal("positions-two-and-later-hidden-test-resolve-at-1"),
    minimumPosition: z.literal(2),
    primaryAggregation: z.literal(
      "equal-episode-mean-of-within-episode-paired-resolve-deltas-v1",
    ),
    withinEpisodeAggregation: z.literal(
      "mean-over-complete-seed-and-eligible-stage-cells-v1",
    ),
  }).strict(),
  hostGate: z.object({
    expectedHooksRegistered: z.literal(true),
    finalizedGoodMemoryHookWritebackSuccessRate: z.literal(1),
    goodMemoryStoreLifecycle: z.object({
      carryoverAcrossStagesSeedsOrArms: z.literal("prohibited"),
      initializeBeforeEveryStage:
        z.literal("rebuild-from-stage-sealed-prefix"),
      lifecycleReceiptRequired: z.literal(true),
      postWritebackDisposition:
        z.literal("record-stop-and-ledger-then-discard-store"),
    }).strict(),
    hooksFeatureEnabled: z.literal(true),
    injectionDecisionRecordedForEveryStage: z.literal(true),
    noCrossArmMemoryScope: z.literal(true),
    noRawTranscriptPersistence: z.literal(true),
    noSilentFallback: z.literal(true),
    stopOutcomeRecordedForEveryFinalizedStage: z.literal(true),
    writebackLedgerOutcomeRecordedForEveryFinalizedStage: z.literal(true),
  }).strict(),
  integrityGate: z.object({
    datasetAndLeakageAuditAccepted: z.literal(true),
    everyAttemptRetained: z.literal(true),
    everySelectedStageFinalized: z.literal(true),
    noHiddenLeakage: z.literal(true),
    noUnresolvedInfrastructureFailure: z.literal(true),
    packageCodexConfigHashesRequired: z.literal(true),
    pairedArmIdentityVerified: z.literal(true),
    rawTraceIndexesRequired: z.literal(true),
    sourceOutputPathIsolationVerified: z.literal(true),
  }).strict(),
  performanceGate: z.object({
    completeCostMetricsRequired: z.literal(true),
    completeLatencyMetricsRequired: z.literal(true),
    correctionSafetyRateMinimum: z.literal(0.95),
    episodeCompletionDeltaMinimum: z.literal(0),
    negativeControlNonInferiority: z.object({
      comparator: z.literal("no-memory"),
      confidenceIntervalLowerBound:
        z.literal("strictly-greater-than-negative-margin"),
      margin: z.literal(0.02),
      metric:
        z.literal("positions-two-and-later-hidden-test-resolve-at-1"),
    }).strict(),
    passToPassRegressionMargin: z.literal(0.02),
    rescueMustExceedRegression: z.literal(true),
    resolveDeltaVersusNoMemoryMinimum: z.literal(0.1),
    confidenceIntervalLowerBound: z.literal("strictly-greater-than-zero"),
  }).strict(),
  repositoryInference: z.object({
    bootstrap: z.object({
      algorithm: z.literal(
        "paired-repository-episode-hierarchical-percentile-v1",
      ),
      confidenceLevel: z.literal(0.95),
      resamplingUnits: z.tuple([
        z.literal("repository"),
        z.literal("episode"),
      ]),
      samples: z.literal(10_000),
      seed: z.number().int().positive(),
    }).strict(),
    claimAcceptance: z.object({
      nonInferiority: z.object({
        everyLeaveOneRepositoryOutDelta:
          z.literal("strictly-greater-than-negative-margin"),
        hierarchicalEpisodeWeightedCiLowerBound:
          z.literal("strictly-greater-than-negative-margin"),
        hierarchicalRepositoryEqualCiLowerBound:
          z.literal("strictly-greater-than-negative-margin"),
        margin: z.literal(0.02),
      }).strict(),
      superiority: z.object({
        everyLeaveOneRepositoryOutDelta:
          z.literal("strictly-greater-than-zero"),
        hierarchicalEpisodeWeightedCiLowerBound:
          z.literal("strictly-greater-than-zero"),
        hierarchicalRepositoryEqualCiLowerBound:
          z.literal("strictly-greater-than-zero"),
      }).strict(),
    }).strict(),
    clusterKey: z.literal(
      "canonical-upstream-repository-family-v1",
    ),
    designPowerEvidence: z.object({
      independentReviewRequired: z.literal(true),
      outcomeBlindRequired: z.literal(true),
      requiredBeforeCandidateFreeze: z.literal(true),
      requiredBeforeFullRun: z.literal(true),
    }).strict(),
    equalRepositorySensitivity: z.object({
      estimand: z.literal(
        "equal-repository-mean-of-equal-episode-deltas-v1",
      ),
      requiredForClaim: z.literal(true),
    }).strict(),
    leaveOneRepositoryOut: z.object({
      estimand: z.literal("equal-episode-paired-resolve-delta-v1"),
      reportEveryRepository: z.literal(true),
      requiredForClaim: z.literal(true),
    }).strict(),
  }).strict(),
  schemaVersion: z.literal(4),
  sourceCohorts: z.object({
    controlledMutation: z.object({
      claimRole: z.literal("diagnostic-only"),
      crossClassification: z.tuple([
        z.literal("repository-family"),
        z.literal("mutation-family"),
      ]),
      excludedFromPrimaryEstimand: z.literal(true),
      separateReportingRequired: z.literal(true),
    }).strict(),
    primaryCoding: z.object({
      includedSourceTypes: z.tuple([
        z.literal("real-history"),
        z.literal("external-benchmark"),
      ]),
      minimumEpisodeFloorBinding: z.literal(
        "c5-eligible-position-power-floor",
      ),
      stratumQuotaScope: z.literal(
        "primary-coding-cohort-only",
      ),
    }).strict(),
  }).strict(),
  strongControlGate: z.object({
    accuracyDeltaVersusFlatSummaryMinimum: z.literal(0.03),
    accuracySuperiorityCiLowerBound:
      z.literal("strictly-greater-than-zero"),
    costEfficiencyAlternative: z.object({
      accuracyNonInferiority: z.object({
        comparator: z.literal("flat-summary"),
        confidenceIntervalLowerBound:
          z.literal("strictly-greater-than-negative-margin"),
        margin: z.literal(0.02),
      }).strict(),
      accuracySuperiorityWordingAllowed: z.literal(false),
      costPerResolvedStageReductionMinimum: z.literal(0.2),
    }).strict(),
    equalInjectedTokenBudgetRequired: z.literal(true),
    independentPricingSourceReviewRequired: z.literal(true),
    summaryGenerationCostIncluded: z.literal(true),
  }).strict(),
}).strict();

export type C6GatePolicy = z.infer<typeof c6GatePolicySchema>;

export function parseC6GatePolicy(value: unknown): C6GatePolicy {
  const parsed = c6GatePolicySchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`invalid C6 gate policy: ${parsed.error.message}`);
  }
  return parsed.data;
}
