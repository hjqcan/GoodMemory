import { describe, expect, it } from "bun:test";

import {
  parseC6GatePolicy,
} from "../../scripts/codex-coding-effect/c6-gate-policy";

describe("Codex coding-effect C6 gate policy", () => {
  it("freezes the positions-two-and-later performance and strong-control gates", () => {
    const policy = parseC6GatePolicy(validPolicy());

    expect(policy).toMatchObject({
      bootstrap: {
        claimRole: "diagnostic-only",
        samples: 10_000,
        seed: 20_260_724,
      },
      claimBranches: {
        repositoryRobustnessRequiredForCodingEffectClaim: true,
      },
      estimand: {
        minimumPosition: 2,
        primaryAggregation:
          "equal-episode-mean-of-within-episode-paired-resolve-deltas-v1",
        withinEpisodeAggregation:
          "mean-over-complete-seed-and-eligible-stage-cells-v1",
      },
      hostGate: {
        expectedHooksRegistered: true,
        goodMemoryStoreLifecycle: {
          carryoverAcrossStagesSeedsOrArms: "prohibited",
          initializeBeforeEveryStage:
            "rebuild-from-stage-sealed-prefix",
          lifecycleReceiptRequired: true,
          postWritebackDisposition:
            "record-stop-and-ledger-then-discard-store",
        },
        hooksFeatureEnabled: true,
        injectionDecisionRecordedForEveryStage: true,
        stopOutcomeRecordedForEveryFinalizedStage: true,
        writebackLedgerOutcomeRecordedForEveryFinalizedStage: true,
      },
      integrityGate: {
        datasetAndLeakageAuditAccepted: true,
        packageCodexConfigHashesRequired: true,
        pairedArmIdentityVerified: true,
        sourceOutputPathIsolationVerified: true,
      },
      performanceGate: {
        negativeControlNonInferiority: {
          comparator: "no-memory",
          confidenceIntervalLowerBound:
            "strictly-greater-than-negative-margin",
          margin: 0.02,
          metric:
            "positions-two-and-later-hidden-test-resolve-at-1",
        },
        resolveDeltaVersusNoMemoryMinimum: 0.1,
        rescueMustExceedRegression: true,
      },
      repositoryInference: {
        bootstrap: {
          algorithm:
            "paired-repository-episode-hierarchical-percentile-v1",
          confidenceLevel: 0.95,
          resamplingUnits: ["repository", "episode"],
          samples: 10_000,
          seed: 20_260_725,
        },
        claimAcceptance: {
          nonInferiority: {
            everyLeaveOneRepositoryOutDelta:
              "strictly-greater-than-negative-margin",
            hierarchicalEpisodeWeightedCiLowerBound:
              "strictly-greater-than-negative-margin",
            hierarchicalRepositoryEqualCiLowerBound:
              "strictly-greater-than-negative-margin",
            margin: 0.02,
          },
          superiority: {
            everyLeaveOneRepositoryOutDelta:
              "strictly-greater-than-zero",
            hierarchicalEpisodeWeightedCiLowerBound:
              "strictly-greater-than-zero",
            hierarchicalRepositoryEqualCiLowerBound:
              "strictly-greater-than-zero",
          },
        },
        clusterKey: "canonical-upstream-repository-family-v1",
        designPowerEvidence: {
          independentReviewRequired: true,
          outcomeBlindRequired: true,
          requiredBeforeCandidateFreeze: true,
          requiredBeforeFullRun: true,
        },
        equalRepositorySensitivity: {
          estimand:
            "equal-repository-mean-of-equal-episode-deltas-v1",
          requiredForClaim: true,
        },
        leaveOneRepositoryOut: {
          estimand: "equal-episode-paired-resolve-delta-v1",
          reportEveryRepository: true,
          requiredForClaim: true,
        },
      },
      schemaVersion: 4,
      sourceCohorts: {
        controlledMutation: {
          claimRole: "diagnostic-only",
          crossClassification: [
            "repository-family",
            "mutation-family",
          ],
          excludedFromPrimaryEstimand: true,
          separateReportingRequired: true,
        },
        primaryCoding: {
          includedSourceTypes: [
            "real-history",
            "external-benchmark",
          ],
          minimumEpisodeFloorBinding:
            "c5-eligible-position-power-floor",
          stratumQuotaScope: "primary-coding-cohort-only",
        },
      },
      strongControlGate: {
        accuracyDeltaVersusFlatSummaryMinimum: 0.03,
        equalInjectedTokenBudgetRequired: true,
        independentPricingSourceReviewRequired: true,
      },
    });
  });

  it("rejects a weakened threshold or missing claim branch", () => {
    expect(() => parseC6GatePolicy({
      ...validPolicy(),
      performanceGate: {
        ...validPolicy().performanceGate,
        resolveDeltaVersusNoMemoryMinimum: 0.05,
      },
    })).toThrow("invalid C6 gate policy");
    const { claimBranches: _, ...withoutClaimBranches } = validPolicy();
    expect(() => parseC6GatePolicy(withoutClaimBranches)).toThrow(
      "invalid C6 gate policy",
    );
    expect(() => parseC6GatePolicy({
      ...validPolicy(),
      schemaVersion: 3,
    })).toThrow("invalid C6 gate policy");
    expect(() => parseC6GatePolicy({
      ...validPolicy(),
      sourceCohorts: {
        ...validPolicy().sourceCohorts,
        controlledMutation: {
          ...validPolicy().sourceCohorts.controlledMutation,
          excludedFromPrimaryEstimand: false,
        },
      },
    })).toThrow("invalid C6 gate policy");
    expect(() => parseC6GatePolicy({
      ...validPolicy(),
      hostGate: {
        ...validPolicy().hostGate,
        goodMemoryStoreLifecycle: {
          ...validPolicy().hostGate.goodMemoryStoreLifecycle,
          initializeBeforeEveryStage:
            "rebuild-from-same-sealed-prehistory",
        },
      },
    })).toThrow("invalid C6 gate policy");
    expect(() => parseC6GatePolicy({
      ...validPolicy(),
      repositoryInference: {
        ...validPolicy().repositoryInference,
        clusterKey: "repository-url-v1",
      },
    })).toThrow("invalid C6 gate policy");
    expect(() => parseC6GatePolicy({
      ...validPolicy(),
      repositoryInference: {
        ...validPolicy().repositoryInference,
        claimAcceptance: {
          ...validPolicy().repositoryInference.claimAcceptance,
          superiority: {
            ...validPolicy().repositoryInference.claimAcceptance.superiority,
            everyLeaveOneRepositoryOutDelta: "report-only",
          },
        },
      },
    })).toThrow("invalid C6 gate policy");
    expect(() => parseC6GatePolicy({
      ...validPolicy(),
      bootstrap: {
        ...validPolicy().bootstrap,
        claimRole: "claim-gate",
      },
    })).toThrow("invalid C6 gate policy");
  });
});

function validPolicy() {
  return {
    bootstrap: {
      algorithm: "paired-episode-cluster-percentile-v1",
      claimRole: "diagnostic-only",
      confidenceLevel: 0.95,
      resamplingUnit: "episode",
      samples: 10_000,
      seed: 20_260_724,
    },
    claimBranches: {
      flatSummaryDisclosureRequired: true,
      noMemoryOnlyClaimMode: "durable-historical-context",
      policySuperiorityRequiresStrongControl: true,
      repositoryRobustnessRequiredForCodingEffectClaim: true,
    },
    estimand: {
      metric: "positions-two-and-later-hidden-test-resolve-at-1",
      minimumPosition: 2,
      primaryAggregation:
        "equal-episode-mean-of-within-episode-paired-resolve-deltas-v1",
      withinEpisodeAggregation:
        "mean-over-complete-seed-and-eligible-stage-cells-v1",
    },
    hostGate: {
      expectedHooksRegistered: true,
      finalizedGoodMemoryHookWritebackSuccessRate: 1,
      goodMemoryStoreLifecycle: {
        carryoverAcrossStagesSeedsOrArms: "prohibited",
        initializeBeforeEveryStage:
          "rebuild-from-stage-sealed-prefix",
        lifecycleReceiptRequired: true,
        postWritebackDisposition:
          "record-stop-and-ledger-then-discard-store",
      },
      hooksFeatureEnabled: true,
      injectionDecisionRecordedForEveryStage: true,
      noCrossArmMemoryScope: true,
      noRawTranscriptPersistence: true,
      noSilentFallback: true,
      stopOutcomeRecordedForEveryFinalizedStage: true,
      writebackLedgerOutcomeRecordedForEveryFinalizedStage: true,
    },
    integrityGate: {
      datasetAndLeakageAuditAccepted: true,
      everyAttemptRetained: true,
      everySelectedStageFinalized: true,
      noHiddenLeakage: true,
      noUnresolvedInfrastructureFailure: true,
      packageCodexConfigHashesRequired: true,
      pairedArmIdentityVerified: true,
      rawTraceIndexesRequired: true,
      sourceOutputPathIsolationVerified: true,
    },
    performanceGate: {
      completeCostMetricsRequired: true,
      completeLatencyMetricsRequired: true,
      confidenceIntervalLowerBound: "strictly-greater-than-zero",
      correctionSafetyRateMinimum: 0.95,
      episodeCompletionDeltaMinimum: 0,
      negativeControlNonInferiority: {
        comparator: "no-memory",
        confidenceIntervalLowerBound:
          "strictly-greater-than-negative-margin",
        margin: 0.02,
        metric: "positions-two-and-later-hidden-test-resolve-at-1",
      },
      passToPassRegressionMargin: 0.02,
      rescueMustExceedRegression: true,
      resolveDeltaVersusNoMemoryMinimum: 0.1,
    },
    repositoryInference: {
      bootstrap: {
        algorithm:
          "paired-repository-episode-hierarchical-percentile-v1",
        confidenceLevel: 0.95,
        resamplingUnits: ["repository", "episode"],
        samples: 10_000,
        seed: 20_260_725,
      },
      claimAcceptance: {
        nonInferiority: {
          everyLeaveOneRepositoryOutDelta:
            "strictly-greater-than-negative-margin",
          hierarchicalEpisodeWeightedCiLowerBound:
            "strictly-greater-than-negative-margin",
          hierarchicalRepositoryEqualCiLowerBound:
            "strictly-greater-than-negative-margin",
          margin: 0.02,
        },
        superiority: {
          everyLeaveOneRepositoryOutDelta:
            "strictly-greater-than-zero",
          hierarchicalEpisodeWeightedCiLowerBound:
            "strictly-greater-than-zero",
          hierarchicalRepositoryEqualCiLowerBound:
            "strictly-greater-than-zero",
        },
      },
      clusterKey: "canonical-upstream-repository-family-v1",
      designPowerEvidence: {
        independentReviewRequired: true,
        outcomeBlindRequired: true,
        requiredBeforeCandidateFreeze: true,
        requiredBeforeFullRun: true,
      },
      equalRepositorySensitivity: {
        estimand:
          "equal-repository-mean-of-equal-episode-deltas-v1",
        requiredForClaim: true,
      },
      leaveOneRepositoryOut: {
        estimand: "equal-episode-paired-resolve-delta-v1",
        reportEveryRepository: true,
        requiredForClaim: true,
      },
    },
    schemaVersion: 4,
    sourceCohorts: {
      controlledMutation: {
        claimRole: "diagnostic-only",
        crossClassification: [
          "repository-family",
          "mutation-family",
        ],
        excludedFromPrimaryEstimand: true,
        separateReportingRequired: true,
      },
      primaryCoding: {
        includedSourceTypes: [
          "real-history",
          "external-benchmark",
        ],
        minimumEpisodeFloorBinding:
          "c5-eligible-position-power-floor",
        stratumQuotaScope: "primary-coding-cohort-only",
      },
    },
    strongControlGate: {
      accuracyDeltaVersusFlatSummaryMinimum: 0.03,
      accuracySuperiorityCiLowerBound: "strictly-greater-than-zero",
      costEfficiencyAlternative: {
        accuracyNonInferiority: {
          comparator: "flat-summary",
          confidenceIntervalLowerBound:
            "strictly-greater-than-negative-margin",
          margin: 0.02,
        },
        accuracySuperiorityWordingAllowed: false,
        costPerResolvedStageReductionMinimum: 0.2,
      },
      equalInjectedTokenBudgetRequired: true,
      independentPricingSourceReviewRequired: true,
      summaryGenerationCostIncluded: true,
    },
  } as const;
}
