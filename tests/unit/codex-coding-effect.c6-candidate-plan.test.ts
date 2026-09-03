import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import {
  buildC6CandidatePlan,
  serializeC6CandidatePlan,
  verifyC6CandidatePlan,
} from "../../scripts/codex-coding-effect/c6-candidate-plan";
import type {
  C6CandidatePlanInput,
} from "../../scripts/codex-coding-effect/c6-candidate-plan";
import {
  C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
  C6_GOODMEMORY_INJECTION_COMPOSITION_SHA256,
  C6_INJECTION_TOKEN_COUNTER_ID,
  C6_INJECTION_TOKEN_COUNTER_SHA256,
  computeC6FlatSummaryGenerationKey,
} from "../../scripts/codex-coding-effect/c6-flat-summary";
import {
  CODEX_CODING_EFFECT_MEMORY_STRATA,
} from "../../scripts/codex-coding-effect/dataset";
import type {
  CodexCodingEffectDatasetV2,
  CodexCodingEffectDatasetV3,
} from "../../scripts/codex-coding-effect/dataset";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const SHA_E = "e".repeat(64);
const SHA_F = "f".repeat(64);

describe("Codex coding-effect C6 candidate plan", () => {
  it("builds the 391-primary-episode, three-arm, three-seed preflight candidate", () => {
    const input = planInput(candidateDataset());
    const plan = buildC6CandidatePlan(input);

    expect(plan).toMatchObject({
      analysis: {
        episodeOnlyBootstrap: {
          claimRole: "diagnostic-only",
          resamplingUnit: "episode",
        },
        minimumEpisodeFloor: 391,
        primaryEstimand:
          "equal-episode-mean-of-within-episode-paired-resolve-deltas-v1",
        sourceCohorts: {
          controlledMutationDiagnostics: {
            candidateDatasetInclusion: "prohibited",
            claimRole: "diagnostic-only",
            excludedFromPrimaryEstimand: true,
            externalRegistryConsumed: false,
            separateReportingRequired: true,
          },
          primaryCoding: {
            episodeCount: 391,
            includedSourceTypes: [
              "real-history",
              "external-benchmark",
            ],
          },
        },
        repositoryInference: {
          algorithm:
            "paired-repository-episode-hierarchical-percentile-v1",
          clusterKey: "canonical-upstream-repository-family-v1",
          equalRepositoryEstimand:
            "equal-repository-mean-of-equal-episode-deltas-v1",
          leaveOneRepositoryOutRequired: true,
          resamplingUnits: ["repository", "episode"],
        },
      },
      arms: ["no-memory", "flat-summary", "goodmemory-installed"],
      claimBoundary: "candidate-only-pending-c7-gate",
      claimScope:
        "stage-scoped-sealed-prefix-selection-and-injection-not-native-writeback",
      candidateClaims: {
        primary:
          "Under the stage-scoped sealed-prefix protocol on the frozen real-history and external-benchmark coding cohort, excluding controlled mutations, the packaged GoodMemory installed-host treatment improves positions-two-and-later fresh-session Codex hidden-test resolve@1 versus no memory.",
        strongControl:
          "Under the stage-scoped sealed-prefix protocol and an equal injection budget on the frozen real-history and external-benchmark coding cohort, excluding controlled mutations, GoodMemory improves positions-two-and-later fresh-session Codex hidden-test resolve@1 versus a flat summary.",
      },
      counts: {
        armRuns: 3_519,
        clusters: 1_173,
        codexProcesses: 10_557,
        ecosystems: 2,
        episodes: 391,
        flatSummaryCodexProcesses: 3_519,
        headlineEpisodes: 391,
        pairedTreatmentCodexProcesses: 7_038,
        repositories: 6,
        scoredStages: 1_173,
        summaryGenerationCalls: 1_029,
        summaryStageArtifactBindings: 1_029,
      },
      evidenceClass: "codex-coding-effect-candidate",
      excludedHosts: ["claude-code"],
      goodMemoryStateIsolation: {
        carryoverAcrossStagesSeedsOrArms: "prohibited",
        initializeBeforeEveryStage:
          "rebuild-from-stage-sealed-prefix",
        lifecycleReceiptRequired: true,
        postWritebackDisposition:
          "record-stop-and-ledger-then-discard-store",
        writebackRole: "host-integrity-observation-only",
      },
      noHistoryControl: {
        flatSummaryProviderCall: "prohibited",
        historySourceSha256: sha256(""),
        injectedContentSha256: sha256(""),
        injectedTokenCount: 0,
        injectionMode: "no-history-zero-injection",
        zeroInjectionArms: [
          "flat-summary",
          "goodmemory-installed",
        ],
        zeroInjectionComposition:
          "no-history-zero-additional-context-v1",
        zeroInjectionCompositionSha256: sha256(
          "no-history-zero-additional-context-v1",
        ),
      },
      host: "codex",
      phase: "C6",
      platform: {
        architecture: "x64",
        operatingSystem: "linux",
      },
      publicClaimEligible: false,
      publicCodingEffectProof: false,
      candidateManifestFrozen: false,
      codexRunReady: false,
      packageSourceEvidence: {
        archiveInspection: "structure-only-accepted",
        status: "required-before-candidate-freeze",
      },
      repositorySourceEvidence: {
        lockedDistinctContentRoots: 6,
        status: "required-before-candidate-freeze",
      },
      readinessStage: "preflight-accepted-freeze-prerequisites-required",
      readmeRowAllowed: false,
      samplingEvidence: {
        minimumEpisodeFloor: 391,
        minimumEpisodesPerStratum: 48,
        primaryDatasetSourceTypeCounts: {
          externalBenchmark: 312,
          realHistory: 79,
        },
        repositoryDesignEvidence: {
          actualRepositoryFamilies: null,
          algorithm: null,
          alpha: null,
          confidenceLevel: null,
          declaredOutcomeAccess: null,
          designPowerArtifactSha256: null,
          effectiveRepositoryFamilies: null,
          groupingPolicy:
            "canonical-upstream-repository-family-v1",
          cryptographicAuthenticity: false,
          maximumHalfWidth: null,
          minimumDetectableEffect: null,
          minimumRepositoryFamilies: null,
          planningRepositoryStandardDeviation: null,
          power: null,
          powerInputArtifactSha256: null,
          powerRequiredRepositoryFamilies: null,
          precisionRequiredRepositoryFamilies: null,
          repositoryLineageArtifactSha256: null,
          requiredBefore: [
            "candidate-manifest-freeze",
            "full-codex-run",
          ],
          requiredRepositoryFamilies: null,
          reviewReceiptSha256: null,
          status:
            "required-before-candidate-freeze-and-full-run",
        },
        semanticDuplicateReviewStatus:
          "required-before-candidate-freeze",
        taskOriginEvidence: {
          cryptographicReceipt: false,
          independentAuthenticityStatus:
            "required-before-candidate-freeze",
          reviewedPrimaryEpisodes: 391,
          relationshipDecisionCount: 782,
          relationshipReviewStatus:
            "exact-edge-identity-closure-accepted-readiness-artifact-verification-required",
          reviewProvenanceStatus:
            "review-reference-closure-accepted-readiness-artifact-verification-required",
          status:
            "candidate-closure-accepted-readiness-artifact-verification-required",
        },
        taskContentDeduplication:
          "agent-visible-repository-ordered-prompts-and-stage-histories-v2",
        uniqueTaskContentFingerprints: 391,
      },
      schemaVersion: 7,
      seeds: [101, 202, 303],
    });
    expect(plan.counts).not.toHaveProperty(
      "diagnosticControlledMutationEpisodes",
    );
    expect(plan.samplingEvidence).not.toHaveProperty(
      "sourceTypeCounts",
    );
    expect(plan.clusters).toHaveLength(1_173);
    expect(plan.episodeBindings).toHaveLength(391);
    expect(plan.episodeBindings.every((binding) =>
      binding.repositoryFamilyId === null
    )).toBeTrue();
    expect(plan.episodeBindings[0]?.taskOriginEvidence).toMatchObject({
      candidateTaskContentSha256: sha256("task-content-candidate-001"),
    });
    expect(
      plan.episodeBindings[0]?.taskOriginEvidence?.stageOrigins,
    ).toHaveLength(3);
    expect(plan.episodeBindings[0]?.stageBindings).toHaveLength(3);
    expect(plan.episodeBindings[0]?.stageBindings[0]).toMatchObject({
      historySourceSha256: sha256("history-0-1"),
      sourceLineage: {
        history: {
          artifactSha256: sha256("history-0-1"),
        },
        target: {
          sourceUnitId: "target-candidate-001-stage-1",
        },
        },
      stageId: "stage-1",
      treatment: {
        flatSummary: {
          injectionMode: "content-injection",
          providerCall: "required",
          },
        goodMemory: {
          injectionMode: "content-injection",
        },
      },
    });
    expect(
      plan.episodeBindings[0]?.stageBindings[0]?.sourceLineage
        .stageLineageSha256,
    ).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      plan.episodeBindings[0]?.stageBindings[0]?.stageInputSha256,
    ).toMatch(/^[a-f0-9]{64}$/u);
    expect(plan.episodeBindings[0]).not.toHaveProperty(
      "historySourceSha256",
    );
    expect(plan.episodeBindings[0]).not.toHaveProperty(
      "stageInputSha256",
    );
    expect(plan.episodeBindings[0]?.sourceLineage).not.toHaveProperty(
      "stageTargets",
    );
    const serialized = serializeC6CandidatePlan(plan);
    expect(serialized).not.toContain('"prehistory');
    expect(serialized).not.toContain('"stageTargets"');
    expect(serialized).not.toContain(
      "rebuild-from-same-sealed-prehistory",
    );
    expect(
      plan.episodeBindings[0]?.taskOriginEvidence?.stageOrigins[0],
    ).toEqual({
      originalRequestSha256: sha256(
        "task-origin-original-request-candidate-001-stage-1",
      ),
      originReceiptBytes: 128,
      originReceiptPath:
        "provenance/task-origin/upstream-receipts/candidate-001-stage-1.json",
      originReceiptSha256: sha256(
        "task-origin-upstream-receipt-candidate-001-stage-1",
      ),
      sourceLocator:
        "https://example.invalid/c6/repository-0/issues/real-history-0-stage-1",
      stageId: "stage-1",
      upstreamItemRevision:
        sha256("task-origin-revision-candidate-001-stage-1"),
    });
    expect(new Set(plan.clusters.map((cluster) => cluster.id)).size).toBe(1_173);

    for (const arm of plan.arms) {
      expect(plan.clusters.filter((cluster) =>
        cluster.armOrder[0] === arm
      )).toHaveLength(391);
      expect(plan.clusters.filter((cluster) =>
        cluster.armOrder[1] === arm
      )).toHaveLength(391);
      expect(plan.clusters.filter((cluster) =>
        cluster.armOrder[2] === arm
      )).toHaveLength(391);
    }
    for (const episode of plan.episodeBindings) {
      const clusters = plan.clusters.filter((cluster) =>
        cluster.episodeId === episode.episodeId
      );
      expect(clusters).toHaveLength(3);
      for (const arm of plan.arms) {
        expect(clusters.map((cluster) =>
          cluster.armOrder.indexOf(arm)
        ).sort()).toEqual([0, 1, 2]);
      }
    }
    expect(() => verifyC6CandidatePlan(plan, input)).not.toThrow();
  });

  it("binds the frozen repository power input and verified episode-family map", () => {
    const dataset = candidateDataset();
    const input = planInput(dataset);
    input.repositoryDesignEvidence = repositoryDesignEvidence(dataset);

    const plan = buildC6CandidatePlan(input);
    const repositoryEvidence =
      plan.samplingEvidence.repositoryDesignEvidence;

    expect(repositoryEvidence).toMatchObject({
      actualRepositoryFamilies: 6,
      algorithm: "repository-mean-normal-power-and-precision-v1",
      alpha: 0.05,
      confidenceLevel: 0.95,
      declaredOutcomeAccess: "prohibited",
      designPowerArtifactSha256: SHA_E,
      effectiveRepositoryFamilies:
        repositoryDesignEvidence(dataset).effectiveRepositoryFamilies,
      groupingPolicy: "canonical-upstream-repository-family-v1",
      cryptographicAuthenticity: false,
      maximumHalfWidth: 0.02,
      minimumDetectableEffect: 0.03,
      minimumRepositoryFamilies: 2,
      planningRepositoryStandardDeviation: 0.01,
      power: 0.8,
      powerInputArtifactSha256: SHA_C,
      powerRequiredRepositoryFamilies: 1,
      precisionRequiredRepositoryFamilies: 1,
      repositoryLineageArtifactSha256: SHA_D,
      requiredBefore: [
        "candidate-manifest-freeze",
        "full-codex-run",
      ],
      requiredRepositoryFamilies: 2,
      reviewReceiptSha256: SHA_F,
      status: "review-receipt-structure-verified",
    });
    expect(plan.episodeBindings.every((binding) =>
      binding.sourceType === "controlled-mutation"
        ? binding.repositoryFamilyId === null
        : binding.repositoryFamilyId ===
          input.repositoryDesignEvidence
            ?.repositoryFamilyByEpisodeId[binding.episodeId]
    )).toBeTrue();
    expect(repositoryEvidence.episodeCountsByRepositoryFamily).toEqual([
      {
        episodes: 66,
        repositoryFamilyId: "example.invalid/c6/repository-0",
      },
      {
        episodes: 65,
        repositoryFamilyId: "example.invalid/c6/repository-1",
      },
      {
        episodes: 65,
        repositoryFamilyId: "example.invalid/c6/repository-2",
      },
      {
        episodes: 65,
        repositoryFamilyId: "example.invalid/c6/repository-3",
      },
      {
        episodes: 65,
        repositoryFamilyId: "example.invalid/c6/repository-4",
      },
      {
        episodes: 65,
        repositoryFamilyId: "example.invalid/c6/repository-5",
      },
    ]);
    expect(repositoryEvidence.largestRepositoryEpisodeShare).toBeCloseTo(
      66 / 391,
    );
    expect(repositoryEvidence.topThreeRepositoryEpisodeShare).toBeCloseTo(
      196 / 391,
    );
    expect(
      repositoryEvidence.allocationConcentrationEquivalentCount,
    ).toBeCloseTo(
      1 / (
        (66 / 391) ** 2 +
        5 * (65 / 391) ** 2
      ),
    );
    expect(repositoryEvidence).not.toHaveProperty(
      "maximumRepositoryEpisodeShare",
    );
    expect(plan.candidateManifestFrozen).toBe(false);
    expect(plan.codexRunReady).toBe(false);
    expect(() => verifyC6CandidatePlan(plan, input)).not.toThrow();
  });

  it("rejects incomplete, mislabelled, gate-mismatched, or underpowered repository design evidence", () => {
    const dataset = candidateDataset();
    const incomplete = planInput(dataset);
    incomplete.repositoryDesignEvidence = repositoryDesignEvidence(dataset);
    delete incomplete.repositoryDesignEvidence
      .repositoryFamilyByEpisodeId["candidate-391"];
    expect(() => buildC6CandidatePlan(incomplete)).toThrow(
      "C6 repository family evidence must cover every episode",
    );

    const mislabelled = planInput(dataset);
    mislabelled.repositoryDesignEvidence = {
      ...repositoryDesignEvidence(dataset),
      reviewReceiptStatus: "caller-declared-accepted",
    } as unknown as C6CandidatePlanInput["repositoryDesignEvidence"];
    expect(() => buildC6CandidatePlan(mislabelled)).toThrow(
      "C6 repository design evidence requires a verified review receipt structure",
    );

    const underpowered = planInput(dataset);
    underpowered.repositoryDesignEvidence = {
      ...repositoryDesignEvidence(dataset),
      requiredRepositoryFamilies: 7,
    };
    expect(() => buildC6CandidatePlan(underpowered)).toThrow(
      "C6 repository design evidence restates a different required repository family count",
    );

    const effectMismatch = planInput(dataset);
    effectMismatch.repositoryDesignEvidence = {
      ...repositoryDesignEvidence(dataset),
      minimumDetectableEffect: 0.04,
    };
    expect(() => buildC6CandidatePlan(effectMismatch)).toThrow(
      "minimum detectable effect must match the strictest gate delta",
    );

    const halfWidthMismatch = planInput(dataset);
    halfWidthMismatch.repositoryDesignEvidence = {
      ...repositoryDesignEvidence(dataset),
      maximumHalfWidth: 0.03,
    };
    expect(() => buildC6CandidatePlan(halfWidthMismatch)).toThrow(
      "maximum half-width must be smaller than the strictest gate delta",
    );

    const splitRepository = planInput(dataset);
    splitRepository.repositoryDesignEvidence =
      repositoryDesignEvidence(dataset);
    splitRepository.repositoryDesignEvidence
      .repositoryFamilyByEpisodeId["candidate-007"] =
        "forged-split-family";
    expect(() => buildC6CandidatePlan(splitRepository)).toThrow(
      "C6 repository family evidence splits one repository URL",
    );
  });

  it("is byte-deterministic and binds the summary, package, pilot, and dataset", () => {
    const input = planInput(candidateDataset());
    const first = buildC6CandidatePlan(input);
    const repeated = buildC6CandidatePlan(input);

    expect(serializeC6CandidatePlan(first)).toBe(
      serializeC6CandidatePlan(repeated),
    );
    expect(first.bindings).toEqual({
      assetLockSha256: SHA_B,
      assetRootSha256: SHA_C,
      c5GateSha256: SHA_D,
      c5IndependentReviewSha256: SHA_A,
      c5ProvenanceSha256: SHA_B,
      c5ReportSha256: SHA_E,
      c5VerificationSha256: SHA_F,
      codexCliPackageJsonSha256: SHA_B,
      codexLauncherSha256: SHA_E,
      codexNativeBinarySha256: SHA_D,
      codexPlatformPackageJsonSha256: SHA_C,
      datasetLineageSha256: SHA_F,
      environmentManifestSha256: SHA_F,
      flatSummaryInjectionCompositionSha256:
        C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
      gatePolicySha256: SHA_D,
      goodMemoryInjectionCompositionSha256:
        C6_GOODMEMORY_INJECTION_COMPOSITION_SHA256,
      injectionTokenCounterSha256: C6_INJECTION_TOKEN_COUNTER_SHA256,
      manifestSha256: SHA_A,
      packageFilesManifestSha256: SHA_C,
      packageSha256: SHA_B,
      pricingReceiptSha256: SHA_D,
      pricingSnapshotSha256: SHA_C,
      repositoryDesignPowerArtifactSha256: null,
      repositoryLineageArtifactSha256: null,
      repositoryPowerInputArtifactSha256: null,
      repositoryReviewReceiptSha256: null,
      runnerCommit: "1".repeat(40),
      runnerTree: "2".repeat(40),
      staticLeakageAuditSha256: SHA_A,
      summaryPromptSha256: SHA_D,
      summaryProtocolSha256: SHA_E,
      taskOriginReviewProvenanceSha256: SHA_C,
    });
    expect(first.gatePolicy).toMatchObject({
      estimand: {
        minimumPosition: 2,
      },
      performanceGate: {
        resolveDeltaVersusNoMemoryMinimum: 0.1,
      },
      strongControlGate: {
        accuracyDeltaVersusFlatSummaryMinimum: 0.03,
      },
    });
    expect(first.analysis).toMatchObject({
      planningMaterialEffectRate: 0.1,
      power: 0.8,
    });
    expect(first.flatSummary).toMatchObject({
      equalBudgetStatus: "pending-packaged-linux-host-profile-capture",
      generationProvenance: {
        requiredBefore: "run-identity-and-codex-execution",
        status: "authenticated-provider-receipts-required",
      },
      generationPolicy:
        "once-per-nonempty-stage-history-before-arm-execution",
      historySource: "same-stage-sealed-prefix-as-goodmemory",
      leakageAuditRequired: true,
      maxInjectedTokens: 512,
      model: "gpt-5.6-terra",
      provider: "gurkiai-openai-compatible",
      rawGoldAccess: false,
      seedReusePolicy: "one-output-hash-reused-across-all-three-seeds",
      tokenCounterId: C6_INJECTION_TOKEN_COUNTER_ID,
      tokenCounterSha256: C6_INJECTION_TOKEN_COUNTER_SHA256,
    });
    expect(first.execution).toEqual({
      repetitionCount: 1,
      stageTimeoutMs: 900_000,
      testTimeoutMs: 300_000,
    });
    expect(first.pricingSourceEvidence).toEqual({
      receiptBinding: "local-receipt-accepted",
      status: "independent-source-review-required-before-cost-claim",
    });

    expect(() => verifyC6CandidatePlan({
      ...first,
      publicClaimEligible: true as false,
    }, input)).toThrow("C6 candidate plan does not match its frozen inputs");
  });

  it("rejects review evidence detached from the exact episode and relationship decision sets", () => {
    const relationshipHashDrift = planInput(candidateDataset());
    relationshipHashDrift.taskOriginReviewEvidence = {
      ...relationshipHashDrift.taskOriginReviewEvidence,
      relationshipDecisionIdentitySetSha256: SHA_A,
    };
    const episodeHashDrift = planInput(candidateDataset());
    episodeHashDrift.taskOriginReviewEvidence = {
      ...episodeHashDrift.taskOriginReviewEvidence,
      reviewedEpisodeIdsSha256: SHA_A,
    };
    const decisionCountDrift = planInput(candidateDataset());
    decisionCountDrift.taskOriginReviewEvidence = {
      ...decisionCountDrift.taskOriginReviewEvidence,
      relationshipDecisionCount:
        decisionCountDrift.taskOriginReviewEvidence
          .relationshipDecisionCount + 1,
    };

    for (const input of [
      relationshipHashDrift,
      episodeHashDrift,
      decisionCountDrift,
    ]) {
      expect(() => buildC6CandidatePlan(input)).toThrow(
        "C6 task-origin review evidence does not bind the exact episode and relationship decision sets",
      );
    }
  });

  it("binds stage history without hashing hidden or evaluator-only fields", () => {
    const dataset = candidateDataset();
    const baseline = buildC6CandidatePlan(planInput(dataset));
    const evaluatorMutation = structuredClone(dataset);
    const mutatedStage = evaluatorMutation.episodes[0]!.stages[0]!;
    mutatedStage.expectedChangedFiles = ["src/forged-evaluator-only.ts"];
    mutatedStage.goldPatch = {
      path: "evaluator/forged.patch",
      sha256: SHA_A,
    };
    mutatedStage.hiddenFailToPass = ["false"];
    mutatedStage.hiddenPassToPass = ["false"];
    const evaluatorMutated = buildC6CandidatePlan(
      planInput(evaluatorMutation),
    );

    expect(evaluatorMutated.episodeBindings[0]).toEqual(
      baseline.episodeBindings[0],
    );

    const historyMutation = structuredClone(dataset);
    historyMutation.episodes[0]!.stages[0]!.history.sha256 =
      sha256("different-stage-history");
    const historyMutated = buildC6CandidatePlan(planInput(historyMutation));
    expect(
      historyMutated.episodeBindings[0]!.stageBindings[0]!.stageInputSha256,
    ).not.toBe(
      baseline.episodeBindings[0]!.stageBindings[0]!.stageInputSha256,
    );
  });

  it("counts distinct frozen stage histories separately from stage artifact bindings", () => {
    const dataset = candidateDataset();
    const sourceEpisode = dataset.episodes[1]!;
    const targetEpisode = dataset.episodes[8]!;
    const sourceStage = sourceEpisode.stages[0]!;
    const targetStage = targetEpisode.stages[0]!;
    targetStage.id = "stage-1-alias";
    targetStage.history = structuredClone(sourceStage.history);
    const input = planInput(dataset);
    const sourceHistory = input.datasetLineage.episodeById[
      sourceEpisode.id
    ]!.stages[0]!.history;
    const targetLineage =
      input.datasetLineage.episodeById[targetEpisode.id]!;
    targetLineage.stages[0]!.history = structuredClone(sourceHistory);
    refreshLineageClosures(targetEpisode.id, targetLineage);

    const plan = buildC6CandidatePlan(input);

    expect(plan.counts).toMatchObject({
      scoredStages: 1_173,
      summaryGenerationCalls: 1_028,
      summaryStageArtifactBindings: 1_029,
    });
    const sourceBinding = plan.episodeBindings.find((episode) =>
      episode.episodeId === sourceEpisode.id
    )!.stageBindings[0]!;
    const targetBinding = plan.episodeBindings.find((episode) =>
      episode.episodeId === targetEpisode.id
    )!.stageBindings[0]!;
    expect(computeC6FlatSummaryGenerationKey(
      targetBinding.sourceLineage.history,
    )).toBe(
      computeC6FlatSummaryGenerationKey(
        sourceBinding.sourceLineage.history,
      ),
    );
  });

  it("rejects legacy dataset and gate-policy protocols", () => {
    const dataset = candidateDataset();
    const legacyDatasetInput = planInput(dataset);
    legacyDatasetInput.dataset =
      legacyDataset(dataset) as unknown as CodexCodingEffectDatasetV3;
    expect(() => buildC6CandidatePlan(legacyDatasetInput)).toThrow(
      "C6 candidate requires dataset schema version 3",
    );

    const legacyGateVersionInput = planInput(dataset);
    legacyGateVersionInput.gatePolicy = {
      ...legacyGateVersionInput.gatePolicy,
      schemaVersion: 2,
    } as unknown as C6CandidatePlanInput["gatePolicy"];
    expect(() => buildC6CandidatePlan(legacyGateVersionInput)).toThrow(
      "invalid C6 gate policy",
    );

    const legacyLifecycleInput = planInput(dataset);
    legacyLifecycleInput.gatePolicy = {
      ...legacyLifecycleInput.gatePolicy,
      hostGate: {
        ...legacyLifecycleInput.gatePolicy.hostGate,
        goodMemoryStoreLifecycle: {
          ...legacyLifecycleInput.gatePolicy.hostGate
            .goodMemoryStoreLifecycle,
          initializeBeforeEveryStage:
            "rebuild-from-same-sealed-prehistory",
        },
      },
    } as unknown as C6CandidatePlanInput["gatePolicy"];
    expect(() => buildC6CandidatePlan(legacyLifecycleInput)).toThrow(
      "invalid C6 gate policy",
    );
  });

  it("rejects detached stage and episode lineage closures", () => {
    const stageClosure = planInput(candidateDataset());
    stageClosure.datasetLineage.episodeById[
      "candidate-001"
    ]!.stages[0]!.stageLineageSha256 = SHA_A;
    expect(() => buildC6CandidatePlan(stageClosure)).toThrow(
      "stage lineage closure does not match",
    );

    const historyClosure = planInput(candidateDataset());
    historyClosure.datasetLineage.episodeById[
      "candidate-001"
    ]!.stageHistoryClosureSha256 = SHA_A;
    expect(() => buildC6CandidatePlan(historyClosure)).toThrow(
      "stage history closure does not match",
    );

    const relationshipClosure = planInput(candidateDataset());
    relationshipClosure.datasetLineage.episodeById[
      "candidate-001"
    ]!.relationshipClosureSha256 = SHA_A;
    expect(() => buildC6CandidatePlan(relationshipClosure)).toThrow(
      "relationship closure does not match",
    );

    const episodeClosure = planInput(candidateDataset());
    episodeClosure.datasetLineage.episodeById[
      "candidate-001"
    ]!.episodeStageClosureSha256 = SHA_A;
    expect(() => buildC6CandidatePlan(episodeClosure)).toThrow(
      "episode stage closure does not match",
    );

    const detachedRelationship = planInput(candidateDataset());
    const detachedLineage =
      detachedRelationship.datasetLineage.episodeById["candidate-001"]!;
    detachedLineage.relationships[0]!.relationshipReceiptSha256 = SHA_A;
    refreshLineageClosures("candidate-001", detachedLineage);
    expect(() => buildC6CandidatePlan(detachedRelationship)).toThrow(
      "dataset lineage does not bind every task relationship",
    );
  });

  it("rejects stage targets reused by key, record hash, or locator", () => {
    for (const alias of ["key", "record", "locator"] as const) {
      const input = planInput(candidateDataset());
      const episodeId = "candidate-002";
      const lineage = input.datasetLineage.episodeById[episodeId]!;
      const first = lineage.stages[0]!.target;
      const second = lineage.stages[1]!.target;
      if (alias === "key") {
        second.sourceUnitId = first.sourceUnitId;
      } else if (alias === "record") {
        second.recordSha256 = first.recordSha256;
      } else {
        second.locator = first.locator;
        input.taskOriginEvidenceByEpisodeId[
          episodeId
        ]!.stageOrigins[1]!.sourceLocator = first.locator;
      }
      refreshLineageClosures(episodeId, lineage);

      expect(() => buildC6CandidatePlan(input)).toThrow(
        `reused target source ${alias === "key" ? "unit" : alias}`,
      );
    }
  });

  it("fails closed on undersized, pilot-only, or non-diverse datasets", () => {
    const dataset = candidateDataset();
    expect(() => buildC6CandidatePlan(planInput({
      ...dataset,
      episodes: dataset.episodes.slice(0, 390),
    }))).toThrow(
      "C6 candidate requires exactly 391 primary coding cohort episodes",
    );

    expect(() => buildC6CandidatePlan(planInput({
      ...dataset,
      episodes: dataset.episodes.map((episode, index) =>
        index === 0
          ? { ...episode, claimEligibility: "pilot-only" as const }
          : episode
      ),
    }))).toThrow("C6 candidate cannot include pilot-only episode");

    expect(() => buildC6CandidatePlan(planInput({
      ...dataset,
      episodes: dataset.episodes.map((episode) => ({
        ...episode,
        ecosystem: "bun-typescript",
        language: "TypeScript",
        repository: {
          ...episode.repository,
          url: "https://example.invalid/c6/repository-0.git",
        },
      })),
    }))).toThrow("C6 candidate requires at least 6 repositories");

    expect(() => buildC6CandidatePlan(planInput({
      ...dataset,
      episodes: dataset.episodes.map((episode, index) =>
        index === 0
          ? { ...episode, taskOriginReceipt: undefined }
          : episode
      ),
    }))).toThrow(
      "C6 real-history episode candidate-001 requires task-origin evidence",
    );

    const externalWithoutOrigin = candidateDataset();
    const externalEpisode = externalWithoutOrigin.episodes.find(
      (episode) => episode.sourceType === "external-benchmark",
    )!;
    externalEpisode.taskOriginReceipt = undefined;
    const externalWithoutOriginInput = planInput(externalWithoutOrigin);
    delete externalWithoutOriginInput.taskOriginEvidenceByEpisodeId[
      externalEpisode.id
    ];
    expect(() =>
      buildC6CandidatePlan(externalWithoutOriginInput)
    ).toThrow(
      `C6 external-benchmark episode ${externalEpisode.id} requires task-origin evidence`,
    );

    const forgedOrigin = planInput(dataset);
    forgedOrigin.taskOriginEvidenceByEpisodeId["candidate-001"] = {
      ...forgedOrigin.taskOriginEvidenceByEpisodeId["candidate-001"]!,
      candidateTaskContentSha256: SHA_A,
    };
    expect(() => buildC6CandidatePlan(forgedOrigin)).toThrow(
      "C6 real-history episode candidate-001 task-origin evidence does not bind task content",
    );

    const forgedOriginRequest = planInput(dataset);
    forgedOriginRequest.datasetLineage.episodeById[
      "candidate-001"
    ]!.stages[0]!.target.normalizedSourceRequestSha256 = SHA_A;
    expect(() => buildC6CandidatePlan(forgedOriginRequest)).toThrow(
      "C6 real-history episode candidate-001 dataset lineage does not bind every stage origin",
    );

    const forgedOriginRevision = planInput(dataset);
    forgedOriginRevision.datasetLineage.episodeById[
      "candidate-001"
    ]!.stages[0]!.target.upstreamItemRevision = SHA_A;
    expect(() => buildC6CandidatePlan(forgedOriginRevision)).toThrow(
      "C6 real-history episode candidate-001 dataset lineage does not bind every stage origin",
    );

    const forgedLaterStageOrigin = planInput(dataset);
    const laterStageLineage = forgedLaterStageOrigin.datasetLineage
      .episodeById["candidate-001"]!;
    Object.assign(
      forgedLaterStageOrigin.taskOriginEvidenceByEpisodeId["candidate-001"]!,
      {
        stageOrigins: laterStageLineage.stages.map((stage) => ({
          originalRequestSha256:
            stage.target.normalizedSourceRequestSha256,
          originReceiptBytes: 128,
          originReceiptPath:
            `provenance/task-origin/upstream-receipts/candidate-001-${stage.stageId}.json`,
          originReceiptSha256: sha256(
            `task-origin-upstream-receipt-candidate-001-${stage.stageId}`,
          ),
          sourceLocator: stage.target.locator,
          stageId: stage.stageId,
          upstreamItemRevision: stage.target.upstreamItemRevision,
        })),
      },
    );
    laterStageLineage.stages[1]!.target.locator =
      "https://example.invalid/c6/repository-0/issues/forged-stage-2";
    expect(() => buildC6CandidatePlan(forgedLaterStageOrigin)).toThrow(
      "C6 real-history episode candidate-001 dataset lineage does not bind every stage origin",
    );

    expect(() => buildC6CandidatePlan(planInput({
      ...dataset,
      episodes: dataset.episodes.map((episode) => ({
        ...episode,
        repository: {
          ...episode.repository,
          assetPath: "repositories/repository-0",
        },
      })),
    }))).toThrow("C6 candidate requires at least 6 asset-locked repositories");

    expect(() => buildC6CandidatePlan(planInput({
      ...dataset,
      episodes: dataset.episodes.map((episode, index) =>
        index === 0
          ? {
              ...episode,
              repository: {
                baseCommit: episode.repository.baseCommit,
                license: episode.repository.license,
                redistributionAllowed: true,
                redistributionReviewed: true,
                url: episode.repository.url,
              },
            }
          : episode
      ),
    }))).toThrow("requires an asset-locked repository");

    const weakened = planInput(dataset);
    expect(() => buildC6CandidatePlan({
      ...weakened,
      c5Evidence: {
        ...weakened.c5Evidence,
        requiredEpisodes: 30,
        requiredScoredStages: 90,
      },
    })).toThrow(
      "C6 candidate requires the exact conservative headline budget",
    );
  });

  it("requires the exact frozen 391-episode by 3-stage run schedule", () => {
    const oversized = candidateDataset();
    oversized.episodes.push(episode(391));
    expect(() => buildC6CandidatePlan(planInput(oversized))).toThrow(
      "C6 candidate requires exactly 391 primary coding cohort episodes",
    );

    const extraStage = candidateDataset();
    const fourthStage = structuredClone(
      extraStage.episodes[0]!.stages[2]!,
    );
    fourthStage.id = "stage-4";
    fourthStage.position = 4;
    fourthStage.expectedChangedFiles = ["src/task-4.ts"];
    fourthStage.goldPatch = {
      path: "evaluator/gold/candidate-1-stage-4.patch",
      sha256: sha256("gold-0-4"),
    };
    fourthStage.hiddenFailToPass = ["bun", "test", "hidden-4"];
    fourthStage.hiddenPassToPass = [
      "bun",
      "test",
      "protection-4",
    ];
    fourthStage.history = {
      ...fourthStage.history,
      path: "history/candidate-1-stage-4.jsonl",
      sha256: sha256("history-0-4"),
    };
    fourthStage.promptPath = "prompts/candidate-1-stage-4.md";
    fourthStage.snapshot = sha256("snapshot-0-4");
    fourthStage.visibleTest = ["bun", "test", "visible-4"];
    extraStage.episodes[0]!.stages.push(fourthStage);
    expect(() => buildC6CandidatePlan(planInput(extraStage))).toThrow(
      "C6 candidate episode candidate-001 requires exactly 3 stages",
    );

    const expandedBudget = planInput(candidateDataset());
    expandedBudget.c5Evidence.requiredEpisodes = 392;
    expandedBudget.c5Evidence.requiredScoredStages = 1_176;
    expect(() => buildC6CandidatePlan(expandedBudget)).toThrow(
      "C6 candidate requires the exact conservative headline budget",
    );
  });

  it("requires a preregistered real-history cohort of at least 48 episodes", () => {
    const dataset = candidateDataset();
    let retainedRealHistory = false;
    dataset.episodes = dataset.episodes.map((episode) => {
      if (episode.sourceType !== "real-history") {
        return episode;
      }
      if (!retainedRealHistory) {
        retainedRealHistory = true;
        return episode;
      }
      return {
        ...episode,
        sourceType: "external-benchmark" as const,
      };
    });

    expect(() => buildC6CandidatePlan(planInput(dataset))).toThrow(
      "C6 candidate requires at least 48 real-history episodes",
    );
  });

  it("does not let controlled mutations satisfy the 391-episode headline floor", () => {
    const dataset = candidateDataset();
    const headline = dataset.episodes.find((episode) =>
      episode.sourceType === "external-benchmark"
    )!;
    headline.sourceType = "controlled-mutation";

    expect(() => buildC6CandidatePlan(planInput(dataset))).toThrow(
      "C6 candidate requires exactly 391 primary coding cohort episodes",
    );

    const diagnosticInsidePrimaryDataset = candidateDataset();
    const diagnostic = episode(391);
    diagnostic.sourceType = "controlled-mutation";
    diagnosticInsidePrimaryDataset.episodes.push(diagnostic);
    expect(() =>
      buildC6CandidatePlan(planInput(diagnosticInsidePrimaryDataset))
    ).toThrow(
      "C6 controlled-mutation diagnostics must be reported outside the primary candidate dataset",
    );
  });

  it("rejects copied task content, aliased repository content, and symbolic strata coverage", () => {
    const dataset = candidateDataset();
    const copiedTask = planInput(dataset);
    const firstEpisode = copiedTask.dataset.episodes[0]!;
    const secondEpisode = copiedTask.dataset.episodes[1]!;
    const firstLineage =
      copiedTask.datasetLineage.episodeById[firstEpisode.id]!;
    const secondLineage =
      copiedTask.datasetLineage.episodeById[secondEpisode.id]!;
    copiedTask.taskContentSha256ByEpisodeId[secondEpisode.id] =
      copiedTask.taskContentSha256ByEpisodeId[firstEpisode.id]!;
    copiedTask.taskOriginEvidenceByEpisodeId[
      secondEpisode.id
    ]!.candidateTaskContentSha256 =
      copiedTask.taskContentSha256ByEpisodeId[firstEpisode.id]!;
    secondLineage.agentVisibleTaskSha256 =
      firstLineage.agentVisibleTaskSha256;
    for (const [index, stage] of secondEpisode.stages.entries()) {
      stage.history.sha256 =
        firstEpisode.stages[index]!.history.sha256;
      secondLineage.stages[index]!.history =
        structuredClone(firstLineage.stages[index]!.history);
    }
    refreshLineageClosures(secondEpisode.id, secondLineage);
    expect(() => buildC6CandidatePlan(copiedTask)).toThrow(
      "C6 candidate rejects duplicate task content",
    );

    const aliasedRepository = planInput(dataset);
    for (const path of Object.keys(
      aliasedRepository.repositoryContentSha256ByAssetPath,
    )) {
      aliasedRepository.repositoryContentSha256ByAssetPath[path] = SHA_A;
    }
    expect(() => buildC6CandidatePlan(aliasedRepository)).toThrow(
      "C6 candidate requires at least 6 distinct repository content roots",
    );

    const underrepresented = candidateDataset();
    const rareStratum = CODEX_CODING_EFFECT_MEMORY_STRATA.at(-1)!;
    let retainedRareEpisode = false;
    underrepresented.episodes = underrepresented.episodes.map((episode) => {
      if (!episode.strata.includes(rareStratum)) {
        return episode;
      }
      if (!retainedRareEpisode) {
        retainedRareEpisode = true;
        return episode;
      }
      return {
        ...episode,
        primaryStratum: CODEX_CODING_EFFECT_MEMORY_STRATA[0],
        stages: episode.stages.map((stage) => ({
          ...stage,
          memoryExpectation: stage.position === 1
            ? stage.memoryExpectation
            : {
              dependencies: [{
                category: CODEX_CODING_EFFECT_MEMORY_STRATA[0],
                description: "Open-loop dependency",
              }],
              mode: "required" as const,
            },
        })),
        strata: [CODEX_CODING_EFFECT_MEMORY_STRATA[0]],
      };
    });
    expect(() => buildC6CandidatePlan(planInput(underrepresented))).toThrow(
      `C6 candidate requires at least 48 primary episodes for memory stratum ${rareStratum}`,
    );

    const labelInflated = candidateDataset();
    labelInflated.episodes = labelInflated.episodes.map((episode) => ({
      ...episode,
      strata: [...CODEX_CODING_EFFECT_MEMORY_STRATA],
    }));
    expect(() => buildC6CandidatePlan(planInput(labelInflated))).toThrow(
      "without a positions-two-and-later memory expectation",
    );

    const falseNegativeControl = candidateDataset();
    const irrelevant = falseNegativeControl.episodes.find((episode) =>
      episode.strata.includes("irrelevant-memory-negative-control")
    )!;
    irrelevant.stages = irrelevant.stages.map((stage) => ({
      ...stage,
      memoryExpectation: stage.memoryExpectation.mode ===
          "irrelevant-control"
        ? {
          ...stage.memoryExpectation,
          mode: "required" as const,
        }
        : stage.memoryExpectation,
    }));
    expect(() => buildC6CandidatePlan(planInput(falseNegativeControl))).toThrow(
      "irrelevant-memory-negative-control requires irrelevant-control mode",
    );
  });

  it("uses one exclusive primary stratum per episode for the sampling quota", () => {
    const dataset = candidateDataset();
    const rareStratum = "irrelevant-memory-negative-control" as const;
    let reassigned = 0;
    dataset.episodes = dataset.episodes.map((episode) => {
      if (
        episode.primaryStratum !== rareStratum ||
        reassigned >= 2
      ) {
        return episode;
      }
      reassigned += 1;
      return {
        ...episode,
        primaryStratum: "open-loop-handoff" as const,
        stages: episode.stages.map((stage) =>
          stage.position === 3
            ? {
              ...stage,
              memoryExpectation: {
                dependencies: [{
                  category: "open-loop-handoff" as const,
                  description: "Open-loop dependency",
                }],
                mode: "required" as const,
              },
            }
            : stage
        ),
        strata: [
          rareStratum,
          "open-loop-handoff" as const,
        ],
      };
    });

    expect(() => buildC6CandidatePlan(planInput(dataset))).toThrow(
      `C6 candidate requires at least 48 primary episodes for memory stratum ${rareStratum}`,
    );
  });

  it("rejects no-history controls that declare required memory", () => {
    const dataset = candidateDataset();
    dataset.episodes = dataset.episodes.map((episode) =>
      episode.primaryStratum === "no-history-negative-control"
        ? {
          ...episode,
          stages: episode.stages.map((stage) =>
            stage.position < 2
              ? stage
              : {
                ...stage,
                memoryExpectation: {
                  dependencies: [{
                    category: "no-history-negative-control" as const,
                    description: "Invalid required history",
                  }],
                  mode: "required" as const,
                },
              }
          ),
        }
        : episode
    );

    expect(() => buildC6CandidatePlan(planInput(dataset))).toThrow(
      "no-history-negative-control requires none mode",
    );
  });

  it("binds only canonical empty history to no-history controls", () => {
    const dataset = candidateDataset();
    const noHistoryEpisode = dataset.episodes.find((episode) =>
      episode.strata.includes("no-history-negative-control")
    )!;
    const plan = buildC6CandidatePlan(planInput(dataset));
    const binding = plan.episodeBindings.find((episode) =>
      episode.episodeId === noHistoryEpisode.id
    )!;

    expect(binding.stageBindings.every((stage) =>
      stage.historySourceSha256 === sha256("") &&
      stage.sourceLineage.history.artifactSha256 === sha256("") &&
      stage.sourceLineage.history.sourceUnitCount === 0 &&
      stage.sourceLineage.history.sourceUnitIdsSha256 ===
        sha256(JSON.stringify([])) &&
      stage.treatment.flatSummary.injectionMode ===
        "no-history-zero-injection" &&
      stage.treatment.flatSummary.providerCall === "prohibited" &&
      stage.treatment.goodMemory.injectionMode ===
        "no-history-zero-injection"
    )).toBe(true);
    expect(binding.stageBindings.every((stage) =>
      !("generationKey" in stage.treatment.flatSummary)
    )).toBe(true);
    expect(plan.flatSummary.historySource).toBe(
      "same-stage-sealed-prefix-as-goodmemory",
    );

    const nonemptyControl = planInput(candidateDataset());
    const nonemptyControlLineage =
      nonemptyControl.datasetLineage.episodeById[noHistoryEpisode.id]!;
    nonemptyControlLineage.stages[0]!.history.sourceUnitCount = 1;
    refreshLineageClosures(noHistoryEpisode.id, nonemptyControlLineage);
    expect(() => buildC6CandidatePlan(nonemptyControl)).toThrow(
      "no-history-negative-control requires canonical empty stage history",
    );

    for (
      const detachedField of [
        "materializationSha256",
        "sourceUnitIdsSha256",
      ] as const
    ) {
      const detachedClosure = planInput(candidateDataset());
      const detachedLineage =
        detachedClosure.datasetLineage.episodeById[noHistoryEpisode.id]!;
      detachedLineage.stages[0]!.history[detachedField] = SHA_A;
      refreshLineageClosures(noHistoryEpisode.id, detachedLineage);
      expect(() => buildC6CandidatePlan(detachedClosure)).toThrow(
        "no-history-negative-control requires canonical empty stage history",
      );
    }

    const emptyTreatment = planInput(candidateDataset());
    const treatmentEpisode = emptyTreatment.dataset.episodes.find((episode) =>
      !episode.strata.includes("no-history-negative-control")
    )!;
    const emptyTreatmentLineage =
      emptyTreatment.datasetLineage.episodeById[treatmentEpisode.id]!;
    emptyTreatmentLineage.stages[0]!.history.sourceUnitCount = 0;
    refreshLineageClosures(treatmentEpisode.id, emptyTreatmentLineage);
    expect(() => buildC6CandidatePlan(emptyTreatment)).toThrow(
      "non-control stage history requires at least one source unit",
    );
  });

  it("requires exactly three distinct seeds and a frozen Linux x64 image", () => {
    const input = planInput(candidateDataset());
    expect(() => buildC6CandidatePlan({
      ...input,
      seeds: [101, 101, 303],
    })).toThrow("C6 candidate requires exactly three distinct seeds");
    expect(() => buildC6CandidatePlan({
      ...input,
      platform: {
        ...input.platform,
        architecture: "arm64",
      },
    })).toThrow("C6 claim candidate requires Linux x64");
    expect(() => buildC6CandidatePlan({
      ...input,
      flatSummary: {
        ...input.flatSummary,
        tokenCounterSha256: SHA_F,
      },
    })).toThrow("C6 candidate requires the frozen injection token counter");
  });

  it("rejects persistent-branch carryover under the stage-scoped protocol", () => {
    const dataset = candidateDataset();
    dataset.episodes[0]!.stateMode = "persistent-branch";

    expect(() => buildC6CandidatePlan(planInput(dataset))).toThrow(
      "C6 candidate episode candidate-001 must use canonical-snapshot",
    );
  });

  it("rejects a launcher hash substituted for the Codex native binary", () => {
    const input = planInput(candidateDataset());
    input.codex.nativeBinarySha256 = input.codex.launcherSha256;

    expect(() => buildC6CandidatePlan(input)).toThrow(
      "C6 Codex launcher and native binary identities must be distinct",
    );
  });
});

function planInput(
  dataset: CodexCodingEffectDatasetV3,
): C6CandidatePlanInput {
  const datasetLineage = datasetLineageFor(dataset);
  return {
    assetLockSha256: SHA_B,
    assetRootSha256: SHA_C,
    c5Evidence: {
      c5ReportedRequiredEpisodes: 113,
      gateSha256: SHA_D,
      headlineDesignEffect: 6,
      headlineMinimumPosition: 2,
      headlineObservationsPerEpisode: 6,
      independentReviewSha256: SHA_A,
      provenanceSha256: SHA_B,
      reportSha256: SHA_E,
      requiredEpisodes: 391,
      requiredRepositories: 6,
      requiredScoredStages: 1_173,
      planningMaterialEffectRate: 0.1,
      runId: "run-c5-pilot-v16-20260721T150112Z",
      verificationSha256: SHA_F,
      externalAuthenticityVerified: false,
      incomparablePairs: 6,
      infrastructureFailureCount: 6,
    },
    codex: {
      cliPackageJsonSha256: SHA_B,
      launcherSha256: SHA_E,
      model: "gpt-5.6-sol",
      nativeBinarySha256: SHA_D,
      platformPackageJsonSha256: SHA_C,
      reasoningEffort: "xhigh",
      version: "0.145.0",
    },
    dataset,
    datasetLineage,
    flatSummary: {
      maxInjectedTokens: 512,
      model: "gpt-5.6-terra",
      promptSha256: SHA_D,
      protocolSha256: SHA_E,
      provider: "gurkiai-openai-compatible",
      tokenCounterSha256: C6_INJECTION_TOKEN_COUNTER_SHA256,
    },
    gatePolicy: gatePolicy(),
    gatePolicySha256: SHA_D,
    manifestSha256: SHA_A,
    maxConcurrency: 2,
    package: {
      fileCount: 42,
      filesManifestSha256: SHA_C,
      sha256: SHA_B,
      version: "0.7.0",
    },
    platform: {
      architecture: "x64",
      environmentManifestSha256: SHA_F,
      imageSha256: SHA_E,
      operatingSystem: "linux",
    },
    pricingSnapshotSha256: SHA_C,
    pricingReceiptSha256: SHA_D,
    runnerSource: {
      commit: "1".repeat(40),
      tree: "2".repeat(40),
    },
    seeds: [101, 202, 303],
    stageTimeoutMs: 900_000,
    staticLeakageAuditSha256: SHA_A,
    taskContentSha256ByEpisodeId: Object.fromEntries(
      dataset.episodes.map((episode) => [
        episode.id,
        sha256(`task-content-${episode.id}`),
      ]),
    ),
    taskOriginEvidenceByEpisodeId: Object.fromEntries(
      dataset.episodes.map((episode) => [
          episode.id,
          {
            candidateTaskContentSha256: sha256(`task-content-${episode.id}`),
            receiptSha256: episode.taskOriginReceipt?.sha256 ?? SHA_F,
            relationshipEdges:
              datasetLineage.episodeById[episode.id]!.relationships.map(
                (relationship) => ({ ...relationship }),
              ),
            sourceRecordSha256: sha256(`task-origin-source-${episode.id}`),
            stageOrigins: datasetLineage.episodeById[episode.id]!
              .stages.map(({ stageId, target }) => ({
                originalRequestSha256:
                  target.normalizedSourceRequestSha256,
                originReceiptBytes: 128,
                originReceiptPath:
                  `provenance/task-origin/upstream-receipts/${episode.id}-${stageId}.json`,
                originReceiptSha256: sha256(
                  `task-origin-upstream-receipt-${episode.id}-${stageId}`,
                ),
                sourceLocator: target.locator,
                stageId,
                upstreamItemRevision: target.upstreamItemRevision,
              })),
          },
        ]),
    ),
    taskOriginReviewEvidence: {
      cryptographicReceipt: false,
      dispatchSha256: SHA_A,
      inputSha256: SHA_B,
      provenanceSha256: SHA_C,
      relationshipDecisionCount: dataset.episodes.reduce(
        (count, episode) =>
          count +
          datasetLineage.episodeById[episode.id]!.relationships.length,
        0,
      ),
      relationshipDecisionIdentitySetSha256: sha256(JSON.stringify(
        dataset.episodes.flatMap((episode) =>
          datasetLineage.episodeById[episode.id]!.relationships.map(
            (relationship) => ({
              edgeId: relationship.edgeId,
              episodeId: episode.id,
              relationshipReceiptSha256:
                relationship.relationshipReceiptSha256,
            }),
          )
        ),
      )),
      requestSha256: SHA_D,
      responseSha256: SHA_E,
      reviewedAt: "2026-07-24T00:00:00.000Z",
      reviewedEpisodeIdsSha256: sha256(JSON.stringify(
        dataset.episodes.map((episode) => episode.id),
      )),
      reviewerAgentName: "/root/c6_task_origin_review_v1",
    },
    testTimeoutMs: 300_000,
    repositoryContentSha256ByAssetPath: Object.fromEntries(
      dataset.episodes.map((episode) => [
        episode.repository.assetPath!,
        sha256(`repository-content-${episode.repository.assetPath}`),
      ]),
    ),
  };
}

function datasetLineageFor(
  dataset: CodexCodingEffectDatasetV3,
): C6CandidatePlanInput["datasetLineage"] {
  const sourceIds = [...new Set(dataset.episodes.map((episode) =>
    `${episode.sourceType}-source`
  ))].sort();
  const episodeById = Object.fromEntries(dataset.episodes.map((episode) => {
    const sourceId = `${episode.sourceType}-source`;
    const episodeIndex = Number.parseInt(episode.id.slice(-3), 10) - 1;
    const agentVisibleTaskSha256 = sha256(`task-content-${episode.id}`);
    const stages = episode.stages.map((stage) => {
      const noHistory = episode.strata.includes(
        "no-history-negative-control",
      );
      const history = {
        artifactSha256: stage.history.sha256,
        materializationSha256: noHistory
          ? sha256(JSON.stringify({
            historyArtifactSha256: stage.history.sha256,
            sourceId,
            sourceUnitRecordSha256: [],
          }))
          : sha256(
            `history-materialization-${episode.id}-${stage.id}`,
          ),
        sourceUnitCount: noHistory ? 0 : stage.position,
        sourceUnitIdsSha256: noHistory
          ? sha256(JSON.stringify([]))
          : sha256(`history-source-units-${episode.id}-${stage.id}`),
      };
      const target = {
        locator:
          `${episode.repository.url.replace(/\.git$/u, "")}/issues/` +
          `${episode.sourceType}-${episodeIndex}-${stage.id}`,
        normalizedSourceRequestSha256:
          episode.sourceType === "real-history"
            ? sha256(
              `task-origin-original-request-${episode.id}-${stage.id}`,
            )
            : sha256(
              `normalized-source-request-${episode.id}-${stage.id}`,
            ),
        recordSha256: sha256(
          `target-content-${episode.id}-${stage.id}`,
        ),
        sourceRequestSha256: sha256(
          `target-source-request-${episode.id}-${stage.id}`,
        ),
        sourceRequestNormalization: "ecmascript-string-trim-v1" as const,
        sourceUnitId: `target-${episode.id}-${stage.id}`,
        upstreamItemRevision:
          episode.sourceType === "real-history"
            ? sha256(`task-origin-revision-${episode.id}-${stage.id}`)
            : sha256(
              `upstream-item-revision-${episode.id}-${stage.id}`,
            ),
      };
      return {
        history,
        stageId: stage.id,
        stageLineageSha256: sha256(JSON.stringify({
          history,
          stageId: stage.id,
          target,
        })),
        target,
      };
    });
    const relationships = episode.stages.slice(1).map(
      (laterStage, index) => {
        const priorStage = episode.stages[index]!;
        return {
          commitPathSha256: sha256(
            `commit-path-${episode.id}-${priorStage.id}-${laterStage.id}`,
          ),
          edgeId:
            `${episode.id}/${priorStage.id}->${laterStage.id}`,
          episodeId: episode.id,
          laterBaseCommit: laterStage.snapshot,
          laterRequestAt: "2026-02-01T00:00:00.000Z",
          laterStageId: laterStage.id,
          priorCompletionAt: "2026-01-15T00:00:00.000Z",
          priorMergeCommit: sha256(
            `merge-${episode.id}-${priorStage.id}`,
          ),
          priorStageId: priorStage.id,
          relationshipReceiptBytes: 128,
          relationshipReceiptPath:
            `provenance/task-origin/relationships/${episode.id}/${priorStage.id}-to-${laterStage.id}.json`,
          relationshipReceiptSha256: sha256(
            `relationship-${episode.id}-${priorStage.id}-${laterStage.id}`,
          ),
        };
      },
    );
    const relationshipClosureSha256 = sha256(JSON.stringify({
      episodeId: episode.id,
      relationships,
    }));
    return [
      episode.id,
      {
        agentVisibleTaskSha256,
        episodeStageClosureSha256: sha256(JSON.stringify({
          agentVisibleTaskSha256,
          episodeId: episode.id,
          relationshipClosureSha256,
          relationships,
          sourceId,
          stages,
        })),
        relationshipClosureSha256,
        relationships,
        sourceId,
        stageHistoryClosureSha256: stageHistoryClosureSha256(stages),
        stages,
      },
    ];
  }));
  const scoredStages = dataset.episodes.reduce(
    (count, episode) => count + episode.stages.length,
    0,
  );
  return {
    episodeById,
    licenseEvidenceSha256BySourceId: Object.fromEntries(
      sourceIds.map((sourceId) => [
        sourceId,
        sha256(`license-${sourceId}`),
      ]),
    ),
    lineageSha256: SHA_F,
    sourcePopulationSha256BySourceId: Object.fromEntries(
      sourceIds.map((sourceId) => [
        sourceId,
        sha256(`population-${sourceId}`),
      ]),
    ),
    sourceSnapshotCount: sourceIds.length,
    targetSourceUnitCount: scoredStages,
    uniqueTargetRecordFingerprints: scoredStages,
  };
}

function gatePolicy() {
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
        resamplingUnits: [
          "repository",
          "episode",
        ] as ["repository", "episode"],
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
        ] as ["repository-family", "mutation-family"],
        excludedFromPrimaryEstimand: true,
        separateReportingRequired: true,
      },
      primaryCoding: {
        includedSourceTypes: [
          "real-history",
          "external-benchmark",
        ] as ["real-history", "external-benchmark"],
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

function repositoryDesignEvidence(
  dataset: CodexCodingEffectDatasetV3,
): NonNullable<C6CandidatePlanInput["repositoryDesignEvidence"]> {
  const primaryCodingEpisodes = dataset.episodes.filter((episode) =>
    episode.sourceType !== "controlled-mutation"
  );
  const repositoryFamilyByEpisodeId = Object.fromEntries(
    primaryCodingEpisodes.map((episode) => [
      episode.id,
      episode.repository.url
        .replace(/^https?:\/\//u, "")
        .replace(/\.git$/u, ""),
    ]),
  );
  const episodeCountByFamily = Object.fromEntries(
    Object.values(repositoryFamilyByEpisodeId).sort().reduce(
      (counts, familyId) => {
        counts.set(familyId, (counts.get(familyId) ?? 0) + 1);
        return counts;
      },
      new Map<string, number>(),
    ),
  );
  const effectiveRepositoryFamilies =
    primaryCodingEpisodes.length ** 2 /
    Object.values(episodeCountByFamily).reduce(
      (sum, count) => sum + count ** 2,
      0,
    );
  return {
    actualRepositoryFamilies: 6,
    algorithm: "repository-mean-normal-power-and-precision-v1",
    alpha: 0.05,
    allocation: {
      allocationSha256: SHA_D,
      episodeCountByFamily,
      episodes: primaryCodingEpisodes.length,
      repositoryFamilies: 6,
    },
    confidenceLevel: 0.95,
    createdAt: "2026-07-24T12:00:00.000Z",
    cryptographicAuthenticity: false,
    datasetSha256: SHA_A,
    declaredOutcomeAccess: "prohibited",
    designPowerArtifactSha256: SHA_E,
    effectiveRepositoryFamilies,
    episodeFamilyBindingSha256: SHA_B,
    groupingPolicy: "canonical-upstream-repository-family-v1",
    maximumHalfWidth: 0.02,
    minimumDetectableEffect: 0.03,
    minimumRepositoryFamilies: 2,
    planningRepositoryStandardDeviation: 0.01,
    power: 0.8,
    powerInputArtifactSha256: SHA_C,
    powerRequiredRepositoryFamilies: 1,
    precisionRequiredRepositoryFamilies: 1,
    repositoryFamilyByEpisodeId,
    repositoryLineageArtifactSha256: SHA_D,
    requiredRepositoryFamilies: 2,
    reviewReceiptSha256: SHA_F,
    reviewReceiptStatus: "review-receipt-structure-verified",
    reviewedAt: "2026-07-24T13:00:00.000Z",
  };
}

function candidateDataset(): CodexCodingEffectDatasetV3 {
  return {
    datasetId: "codex-c6-claim-candidate-v1",
    episodes: Array.from({ length: 391 }, (_, index) => episode(index)),
    schemaVersion: 3,
    sourceLineage: {
      path: "provenance/dataset-lineage/lineage.json",
      sha256: SHA_F,
    },
  };
}

function episode(
  index: number,
): CodexCodingEffectDatasetV3["episodes"][number] {
  const stratum =
    CODEX_CODING_EFFECT_MEMORY_STRATA[
      index % CODEX_CODING_EFFECT_MEMORY_STRATA.length
    ]!;
  const noUsefulHistory = stratum === "no-history-negative-control";
  const irrelevant = stratum === "irrelevant-memory-negative-control";
  const dependency = {
    category: stratum,
    description: `Memory dependency ${index}`,
  };
  const mode = noUsefulHistory
    ? "none" as const
    : irrelevant
    ? "irrelevant-control" as const
    : "required" as const;
  const realHistory = index % 5 === 0;
  const sourceType = realHistory
    ? "real-history" as const
    : "external-benchmark" as const;

  return {
    author: "C6 fixture author",
    claimEligibility: "claim-eligible",
    ecosystem: index % 2 === 0 ? "bun-typescript" : "python",
    forbiddenLeakage: {
      fileSha256: [sha256(`hidden-${index}`)],
      strings: [`forbidden candidate value ${index}`],
    },
    historyPolicy: "stage-scoped-sealed-prefix-v1",
    id: `candidate-${String(index + 1).padStart(3, "0")}`,
    language: index % 2 === 0 ? "TypeScript" : "Python",
    preparation: {
      command: ["true"],
      networkMode: "disabled",
    },
    primaryStratum: stratum,
    provenance: `C6 generated test provenance ${index}`,
    repository: {
      assetPath: `repositories/repository-${index % 6}`,
      baseCommit: sha256(`commit-${index % 6}`),
      license: "MIT",
      redistributionAllowed: true,
      redistributionReviewed: true,
      url: `https://example.invalid/c6/repository-${index % 6}.git`,
    },
    sourceType,
    stages: [1, 2, 3].map((position) => ({
      allowedFeedback: [],
      expectedChangedFiles: [`src/task-${position}.ts`],
      goldPatch: {
        path: `evaluator/gold/candidate-${index + 1}-stage-${position}.patch`,
        sha256: sha256(`gold-${index}-${position}`),
      },
      hiddenFailToPass: ["bun", "test", `hidden-${position}`],
      hiddenPassToPass: ["bun", "test", `protection-${position}`],
      history: {
        forbiddenLeakageSha256: [sha256(`hidden-${index}`)],
        path: noUsefulHistory
          ? "history/empty.jsonl"
          : `history/candidate-${index + 1}-stage-${position}.jsonl`,
        sha256: noUsefulHistory
          ? sha256("")
          : sha256(`history-${index}-${position}`),
        source: "frozen-artifact",
      },
      id: `stage-${position}`,
      memoryExpectation: position === 1 || noUsefulHistory
        ? { dependencies: [], mode: "none" as const }
        : { dependencies: [dependency], mode },
      position,
      promptPath: `prompts/candidate-${index + 1}-stage-${position}.md`,
      snapshot: sha256(`snapshot-${index}-${position}`),
      timeoutMs: 300_000,
      visibleTest: ["bun", "test", `visible-${position}`],
    })),
    stateMode: "canonical-snapshot",
    strata: [stratum],
    taskOriginReceipt: {
      path: `provenance/task-origin/reviews/candidate-${index + 1}.json`,
      sha256: sha256(`task-origin-receipt-${index}`),
    },
  };
}

function legacyDataset(
  dataset: CodexCodingEffectDatasetV3,
): CodexCodingEffectDatasetV2 {
  return {
    datasetId: dataset.datasetId,
    episodes: dataset.episodes.map((episode) => {
      const {
        historyPolicy,
        stages,
        ...shared
      } = episode;
      void historyPolicy;
      return {
        ...shared,
        prehistory: stages[0]!.history,
        stages: stages.map((stage) => {
          const {
            history,
            ...legacyStage
          } = stage;
          void history;
          return legacyStage;
        }),
      };
    }),
    schemaVersion: 2,
  };
}

type EpisodeLineage =
  C6CandidatePlanInput["datasetLineage"]["episodeById"][string];

function refreshLineageClosures(
  episodeId: string,
  lineage: EpisodeLineage,
): void {
  for (const stage of lineage.stages) {
    stage.stageLineageSha256 = sha256(JSON.stringify({
      history: stage.history,
      stageId: stage.stageId,
      target: stage.target,
    }));
  }
  lineage.stageHistoryClosureSha256 =
    stageHistoryClosureSha256(lineage.stages);
  lineage.relationshipClosureSha256 = sha256(JSON.stringify({
    episodeId,
    relationships: lineage.relationships,
  }));
  lineage.episodeStageClosureSha256 = sha256(JSON.stringify({
    agentVisibleTaskSha256: lineage.agentVisibleTaskSha256,
    episodeId,
    relationshipClosureSha256: lineage.relationshipClosureSha256,
    relationships: lineage.relationships,
    sourceId: lineage.sourceId,
    stages: lineage.stages,
  }));
}

function stageHistoryClosureSha256(
  stages: EpisodeLineage["stages"],
): string {
  return sha256(JSON.stringify(stages.map((stage, index) => ({
    historyArtifactSha256: stage.history.artifactSha256,
    historyMaterializationSha256: stage.history.materializationSha256,
    historySourceUnitCount: stage.history.sourceUnitCount,
    historySourceUnitIdsSha256: stage.history.sourceUnitIdsSha256,
    stageId: stage.stageId,
    stagePosition: index + 1,
  }))));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
