import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import {
  buildC6AssetLock,
  serializeC6AssetLock,
} from "../../../scripts/codex-coding-effect/c6-asset-lock";
import type {
  C6CandidatePlan,
} from "../../../scripts/codex-coding-effect/c6-candidate-plan";
import type {
  C6FlatSummaryCorpus,
} from "../../../scripts/codex-coding-effect/c6-flat-summary";
import {
  C6_FLAT_SUMMARY_INJECTION_COMPOSITION,
  C6_INJECTION_TOKEN_COUNTER_ID,
  C6_INJECTION_TOKEN_COUNTER_SHA256,
} from "../../../scripts/codex-coding-effect/c6-flat-summary";
import {
  buildC6FlatSummaryCorpusExpectation,
  loadC6CandidateReadiness,
} from "../../../scripts/codex-coding-effect/c6-readiness";
import {
  CODEX_CODING_EFFECT_MEMORY_STRATA,
} from "../../../scripts/codex-coding-effect/dataset";
import type {
  CodexCodingEffectDatasetV3,
} from "../../../scripts/codex-coding-effect/dataset";
import { ciTestTimeout } from "../../support/ci-timeout";

const C5_EVIDENCE_ROOT = resolve(
  "reports/quality-gates/phase-73/c5-native-longitudinal-pilot-v16",
);
const DUPLICATE_TASK_EPISODE_INDEX = 30;
const SHA_A = "a".repeat(64);

describe.serial("Codex coding-effect C6 candidate protocol readiness", () => {
  it("freezes the candidate plan without pretending summaries or Codex runs exist", async () => {
    const fixture = await createFixture();
    try {
      const readinessInput = {
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        repositoryDesignEvidence: fixture.repositoryDesignEvidence,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      };
      const result = await loadC6CandidateReadiness(readinessInput);

      expect(result).toMatchObject({
        codexRunReady: false,
        readinessStage: "preflight-accepted-freeze-prerequisites-required",
        summaryArtifacts: {
          authenticatedGenerationReceipts: 0,
          providerAuthenticityVerified: false,
          requiredGenerationReceipts: 343,
          requiredStageBindings: 3_087,
          schemaVersion: 1,
          status: "structural-preflight-only",
          structurallyVerifiedGenerationReceipts: 0,
          structurallyVerifiedStageBindings: 0,
        },
      });
      expect(result.plan).toMatchObject({
        bindings: {
          datasetLineageSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          repositoryDesignPowerArtifactSha256:
            fixture.repositoryDesignEvidence
              .expectedDesignPowerArtifactSha256,
          repositoryLineageArtifactSha256:
            fixture.repositoryDesignEvidence
              .expectedRepositoryLineageArtifactSha256,
          repositoryPowerInputArtifactSha256:
            fixture.repositoryDesignEvidence
              .expectedPowerInputArtifactSha256,
          repositoryReviewReceiptSha256:
            fixture.repositoryDesignEvidence
              .expectedReviewReceiptSha256,
        },
        counts: {
          codexProcesses: 10_557,
          episodes: 391,
          headlineEpisodes: 391,
          summaryGenerationCalls: 343,
          summaryStageArtifactBindings: 1_029,
        },
        pricingSourceEvidence: {
          receiptBinding: "local-receipt-accepted",
          status: "independent-source-review-required-before-cost-claim",
        },
        samplingEvidence: {
          repositoryDesignEvidence: {
            actualRepositoryFamilies: 6,
            cryptographicAuthenticity: false,
            minimumDetectableEffect: 0.03,
            powerInputArtifactSha256:
              fixture.repositoryDesignEvidence
                .expectedPowerInputArtifactSha256,
            requiredRepositoryFamilies: 2,
            status: "review-receipt-structure-verified",
          },
          sourceLineageEvidence: {
            externalSourceAuthenticityStatus:
              "required-before-candidate-freeze",
            sourceSnapshots: 2,
            status:
              "asset-bound-normalized-source-record-consistency-accepted",
            targetSourceUnits: 1_173,
            uniqueTargetRecordFingerprints: 1_173,
          },
          primaryDatasetSourceTypeCounts: {
            externalBenchmark: 312,
            realHistory: 79,
          },
          stratumQuotaPolicy:
            "exclusive-primary-stratum-within-primary-coding-cohort-v2",
          taskOriginEvidence: {
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
        },
        publicClaimEligible: false,
      });
      expect(result.plan.analysis.sourceCohorts).toEqual({
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
      });
      expect(result.plan.counts).not.toHaveProperty(
        "diagnosticControlledMutationEpisodes",
      );
      expect(
        result.plan.episodeBindings[0]?.taskOriginEvidence?.stageOrigins[0],
      ).toMatchObject({
        originReceiptBytes: expect.any(Number),
        originReceiptPath:
          "provenance/task-origin/upstream-receipts/candidate-001-stage-1.json",
        originReceiptSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      });
      expect(
        result.plan.episodeBindings[0]?.taskOriginEvidence
          .relationshipEdges,
      ).toHaveLength(2);
      expect(
        result.plan.episodeBindings[0]?.sourceLineage
          .relationshipClosureSha256,
      ).toMatch(/^[a-f0-9]{64}$/u);
      expect(
        result.plan.episodeBindings[0]?.repositoryFamilyId,
      ).toBe("family-0");
      expect(result.plan.episodeBindings.every((episode) =>
        episode.sourceType !== "controlled-mutation" &&
        episode.repositoryFamilyId !== null
      )).toBe(true);
      expect(result.plan.schemaVersion).toBe(7);
      expect(result.plan.candidateManifestFrozen).toBe(false);
      expect(result.plan.codexRunReady).toBe(false);
      expect(result.plan.flatSummary.generationPolicy).toBe(
        "once-per-nonempty-stage-history-before-arm-execution",
      );
      expect(result.plan.flatSummary.historySource).toBe(
        "same-stage-sealed-prefix-as-goodmemory",
      );
      expect(
        result.plan.goodMemoryStateIsolation.initializeBeforeEveryStage,
      ).toBe("rebuild-from-stage-sealed-prefix");
      expect(result.planBytes).not.toContain('"prehistory"');
      const firstStage =
        result.plan.episodeBindings[0]!.stageBindings[0]!;
      expect(firstStage.historySourceSha256)
        .toMatch(/^[a-f0-9]{64}$/u);
      expect(firstStage.sourceLineage.stageLineageSha256)
        .toMatch(/^[a-f0-9]{64}$/u);
      expect(firstStage.sourceLineage.target.recordSha256)
        .toMatch(/^[a-f0-9]{64}$/u);
      const noHistoryBinding = result.plan.episodeBindings.find((episode) =>
        episode.primaryStratum === "no-history-negative-control"
      )!;
      expect(noHistoryBinding.stageBindings.every((stage) =>
        stage.historySourceSha256 === sha256("") &&
        stage.sourceLineage.history.artifactSha256 === sha256("") &&
        stage.sourceLineage.history.sourceUnitCount === 0 &&
        stage.sourceLineage.history.sourceUnitIdsSha256 ===
          sha256(JSON.stringify([])) &&
        stage.treatment.flatSummary.providerCall === "prohibited" &&
        stage.treatment.flatSummary.injectionMode ===
          "no-history-zero-injection" &&
        stage.treatment.goodMemory.injectionMode ===
          "no-history-zero-injection"
      )).toBe(true);
      expect(result.plan.noHistoryControl).toMatchObject({
        flatSummaryProviderCall: "prohibited",
        historySourceSha256: sha256(""),
        injectedContentSha256: sha256(""),
        injectedTokenCount: 0,
        injectionMode: "no-history-zero-injection",
      });
      expect(
        await readFile(
          join(fixture.datasetRoot, "history", "empty.jsonl"),
          "utf8",
        ),
      ).toBe("");
      expect(result.planSha256).toMatch(/^[a-f0-9]{64}$/u);

      const structurallyVerified = await loadC6CandidateReadiness({
        ...readinessInput,
        summaryCorpus: structuralSummaryCorpus(result.plan),
      });
      expect(structurallyVerified).toMatchObject({
        codexRunReady: false,
        summaryArtifacts: {
          authenticatedGenerationReceipts: 0,
          providerAuthenticityVerified: false,
          requiredGenerationReceipts: 343,
          requiredStageBindings: 3_087,
          schemaVersion: 1,
          status: "structural-preflight-only",
          structurallyVerifiedGenerationReceipts: 343,
          structurallyVerifiedStageBindings: 3_087,
        },
      });
      expect(structurallyVerified.plan.candidateManifestFrozen).toBe(false);
      expect(structurallyVerified.plan.codexRunReady).toBe(false);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(60_000));

  it("propagates every visible stage mutation into task, episode, and stage input closures", async () => {
    const baselineFixture = await createFixture();
    try {
      const baselineResult = await loadFixtureReadiness(baselineFixture);
      const baseline = baselineResult.plan.episodeBindings.find(
        (episode) => episode.episodeId === "candidate-002",
      )!;
      for (const mutation of [
        "allowed-feedback",
        "history",
        "prompt",
        "snapshot",
      ] as const) {
        const mutatedFixture = await createFixture({
          stageInputMutation: mutation,
        });
        try {
          const mutatedResult =
            await loadFixtureReadiness(mutatedFixture);
          const mutated = mutatedResult.plan.episodeBindings.find(
            (episode) => episode.episodeId === "candidate-002",
          )!;
          expect(mutated.taskContentSha256)
            .not.toBe(baseline.taskContentSha256);
          expect(mutated.episodeInputSha256)
            .not.toBe(baseline.episodeInputSha256);
          expect(mutated.stageBindings[0]!.stageInputSha256)
            .not.toBe(baseline.stageBindings[0]!.stageInputSha256);
        } finally {
          await rm(mutatedFixture.root, {
            force: true,
            recursive: true,
          });
        }
      }
    } finally {
      await rm(baselineFixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(240_000));

  it("rejects legacy dataset, gate, and summary protocols", async () => {
    for (const probe of [
      {
        expected: "C6 candidate requires dataset schema version 3",
        input: { legacyDatasetProtocol: true },
      },
      {
        expected: "invalid C6 gate policy",
        input: { legacyGatePolicy: true },
      },
      {
        expected: "invalid C6 summary protocol",
        input: { legacySummaryProtocol: true },
      },
    ] as const) {
      const fixture = await createFixture(probe.input);
      try {
        await expect(loadFixtureReadiness(fixture)).rejects.toThrow(
          probe.expected,
        );
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    }
  }, 90_000);

  it("rejects package drift before a summary or Codex call", async () => {
    const fixture = await createFixture();
    try {
      await writeFile(fixture.packageTarballPath, "drifted package\n");
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow("C6 package tarball hash does not match");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rechecks every external input after the terminal test hook", async () => {
    const fixture = await createFixture();
    const c5EvidenceRoot = join(fixture.root, "c5-evidence");
    try {
      await cp(C5_EVIDENCE_ROOT, c5EvidenceRoot, { recursive: true });
      const probes = [
        fixture.packageTarballPath,
        fixture.gatePolicyPath,
        fixture.summaryProtocolPath,
        fixture.summaryPromptPath,
        join(dirname(fixture.summaryProtocolPath), "pricing.json"),
        fixture.pricingReceiptPath,
        join(c5EvidenceRoot, "c5-gate.json"),
        join(c5EvidenceRoot, "c5-verification.json"),
        join(c5EvidenceRoot, "report.json"),
        join(c5EvidenceRoot, "independent-review.json"),
        join(c5EvidenceRoot, "provenance.json"),
      ];
      for (const [index, path] of probes.entries()) {
        const originalBytes = await readFile(path);
        await expect(loadC6CandidateReadiness({
          c5EvidenceRoot,
          datasetRoot: fixture.datasetRoot,
          environmentManifestPath: fixture.environmentManifestPath,
          gatePolicyPath: fixture.gatePolicyPath,
          packageTarballPath: fixture.packageTarballPath,
          repositoryDesignEvidence: fixture.repositoryDesignEvidence,
          seeds: [101, 202, 303],
          summaryProtocolPath: fixture.summaryProtocolPath,
          testHooks: {
            beforeTerminalExternalClosure: () =>
              writeFile(path, `terminal drift ${index}\n`),
          },
        })).rejects.toThrow(
          "C6 external input closure changed during preflight",
        );
        await writeFile(path, originalBytes);
      }
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(120_000));

  it("rejects an external evidence root reached through a symlinked parent", async () => {
    const fixture = await createFixture();
    const physical = join(fixture.root, "physical-c5");
    const alias = join(fixture.root, "c5-parent-alias");
    try {
      await cp(C5_EVIDENCE_ROOT, physical, { recursive: true });
      await symlink(physical, alias);
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: alias,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow("rejects symlink path component");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects direct external inputs and Codex artifacts under symlinked parents", async () => {
    const fixture = await createFixture();
    const rootAlias = join(fixture.root, "external-root-alias");
    try {
      await symlink(fixture.root, rootAlias);
      const baseInput = {
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      };
      for (const [key, physicalPath] of [
        ["environmentManifestPath", fixture.environmentManifestPath],
        ["gatePolicyPath", fixture.gatePolicyPath],
        ["packageTarballPath", fixture.packageTarballPath],
        ["summaryProtocolPath", fixture.summaryProtocolPath],
      ] as const) {
        await expect(loadC6CandidateReadiness({
          ...baseInput,
          [key]: join(rootAlias, relative(fixture.root, physicalPath)),
        })).rejects.toThrow("rejects symlink path component");
      }

      const codexRoot = join(fixture.root, "codex-runtime");
      const physicalCodexRoot =
        join(fixture.root, "physical-codex-runtime");
      await rename(codexRoot, physicalCodexRoot);
      await symlink(physicalCodexRoot, codexRoot);
      await expect(loadC6CandidateReadiness(baseInput)).rejects.toThrow(
        "rejects symlink path component",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects a Codex launcher substituted for the native binary", async () => {
    const fixture = await createFixture({
      codexNativeRefUsesLauncher: true,
    });
    try {
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow(
        "Codex launcher and native binary identities must be distinct",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects package metadata substituted for the Codex launcher", async () => {
    const fixture = await createFixture({
      codexLauncherRefUsesPackageJson: true,
    });
    try {
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow(
        "C6 Codex launcher path does not match the CLI package bin entry",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects Codex native bytes that drift from the environment manifest", async () => {
    const fixture = await createFixture();
    try {
      const driftedNativeBinary = createTestElf64(0x3e);
      driftedNativeBinary[24] = 1;
      await writeFile(
        fixture.codexNativeBinaryPath,
        driftedNativeBinary,
      );
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow(
        "C6 Codex native binary SHA-256 does not match",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects an ARM64 executable declared as the Linux x64 Codex binary", async () => {
    const fixture = await createFixture({
      codexNativeMachine: 0xb7,
    });
    try {
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow(
        "C6 Codex native binary must be ELF64 little-endian x86-64",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects a platform package whose bytes do not identify Linux x64 Codex", async () => {
    const fixture = await createFixture({
      codexPlatformPackageName: "@openai/not-codex",
    });
    try {
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow(
        "C6 Codex Linux x64 package metadata is invalid",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects a symlinked summary protocol input", async () => {
    const fixture = await createFixture();
    try {
      await rm(fixture.summaryPromptPath);
      await symlink(fixture.packageTarballPath, fixture.summaryPromptPath);
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow("C6 summary prompt rejects symlink");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects copied task bytes before a candidate manifest can freeze", async () => {
    const fixture = await createFixture({ duplicateTaskContent: true });
    try {
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow("C6 candidate rejects duplicate task content");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects duplicate agent-visible tasks even when hidden gold differs", async () => {
    const fixture = await createFixture({
      duplicateAgentVisibleTaskWithDistinctGold: true,
    });
    try {
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow("C6 candidate rejects duplicate task content");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects reuse of one upstream target unit across distinct candidate tasks", async () => {
    const fixture = await createFixture({
      duplicateLineageTarget: true,
    });
    try {
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow(
        "C6 dataset lineage external-benchmark stage origin does not match",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("requires source lineage before the candidate dataset can freeze", async () => {
    const fixture = await createFixture({
      omitDatasetLineage: true,
    });
    try {
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow(
        "C6 candidate dataset requires source lineage",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects a target source unit that also appears in stage history", async () => {
    const fixture = await createFixture({
      lineageTargetInStageHistory: true,
    });
    try {
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow(
        "C6 dataset lineage rejects target source unit in stage history",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects a target locator aliased under another stage-history unit", async () => {
    const fixture = await createFixture({
      aliasedTargetInStageHistory: true,
    });
    try {
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow(
        "C6 dataset lineage rejects target source locator in stage history",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects lineage detached from a stage history artifact", async () => {
    const fixture = await createFixture({
      detachedLineageStageHistory: true,
    });
    try {
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow(
        "C6 dataset lineage history artifact does not match",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects a stage-history unit list detached from its materialization receipt", async () => {
    const fixture = await createFixture({
      detachedLineageStageHistoryMaterialization: true,
    });
    try {
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow(
        "C6 dataset lineage history materialization does not match",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects a frozen source record detached from its stage prompt", async () => {
    const fixture = await createFixture({
      detachedLineageTargetPrompt: true,
    });
    try {
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow(
        "C6 dataset lineage target prompt does not match",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects lineage detached from the agent-visible task", async () => {
    const fixture = await createFixture({
      detachedLineageTaskContent: true,
    });
    try {
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow(
        "C6 dataset lineage agent-visible task does not match",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects task-origin review for another request at the same locator", async () => {
    const fixture = await createFixture({
      detachedTaskOriginRequest: true,
    });
    try {
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow(
        "C6 task-origin upstream receipt for candidate-001:stage-2 does not match the source record",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects task-origin review for another item revision at the same locator", async () => {
    const fixture = await createFixture({
      detachedTaskOriginRevision: true,
    });
    try {
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow(
        "C6 task-origin upstream receipt for candidate-001:stage-2 does not match the source record",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects a later-stage upstream receipt detached from its source record", async () => {
    const fixture = await createFixture({
      detachedUpstreamReceiptRequest: true,
    });
    try {
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow(
        "C6 task-origin upstream receipt for candidate-001:stage-2 does not match the source record",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects a later-stage upstream locator detached from its source record", async () => {
    const fixture = await createFixture({
      detachedUpstreamReceiptLocator: true,
    });
    try {
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow(
        "C6 task-origin upstream receipt for candidate-001:stage-3 does not match the source record",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects a fully rehashed relationship receipt whose completion is a sibling commit", async () => {
    const fixture = await createFixture({
      relationshipMutation: "sibling-ancestry",
    });
    try {
      await expect(loadFixtureReadiness(fixture)).rejects.toThrow(
        "Git commit path is not an ancestry chain",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects a fully rehashed review decision detached from its exact relationship receipt", async () => {
    const fixture = await createFixture({
      taskOriginRelationshipReviewMutation: "receipt-hash-drift",
    });
    try {
      await expect(loadFixtureReadiness(fixture)).rejects.toThrow(
        "C6 task-origin review relationship decisions do not cover the exact edge set",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects non-canonical source-record rows even when hashes agree", async () => {
    const fixture = await createFixture({
      nonCanonicalLineageSourceRecord: true,
    });
    try {
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow(
        "C6 dataset lineage source record is not canonical",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects lineage detached from its frozen source population", async () => {
    const fixture = await createFixture({
      detachedLineagePopulation: true,
    });
    try {
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow(
        "C6 dataset lineage source population does not match the asset lock",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects task-origin review provenance without reviewer separation", async () => {
    const fixture = await createFixture({
      taskOriginReviewAgentName: "C6 fixture author",
    });
    try {
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow(
        "C6 task-origin review provenance is not independent",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  for (const artifact of [
    "input",
    "request",
    "dispatch",
    "response",
  ] as const) {
    it(`rejects task-origin review provenance detached from its ${artifact}`, async () => {
      const fixture = await createFixture({
        detachedTaskOriginReviewArtifact: artifact,
      });
      try {
        await expect(loadC6CandidateReadiness({
          c5EvidenceRoot: C5_EVIDENCE_ROOT,
          datasetRoot: fixture.datasetRoot,
          environmentManifestPath: fixture.environmentManifestPath,
          gatePolicyPath: fixture.gatePolicyPath,
          packageTarballPath: fixture.packageTarballPath,
          seeds: [101, 202, 303],
          summaryProtocolPath: fixture.summaryProtocolPath,
        })).rejects.toThrow(
          `C6 task-origin review provenance does not bind its ${artifact}`,
        );
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    }, ciTestTimeout(30_000));
  }

  it("rejects a real-history source record detached from candidate task content", async () => {
    const fixture = await createFixture({
      taskOriginTaskContentSha256: SHA_A,
    });
    try {
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow("does not bind candidate task content");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));

  it("rejects pricing receipt drift before the cost branch can be used", async () => {
    const fixture = await createFixture();
    try {
      await writeFile(fixture.pricingReceiptPath, "unbound pricing\n");
      await expect(loadC6CandidateReadiness({
        c5EvidenceRoot: C5_EVIDENCE_ROOT,
        datasetRoot: fixture.datasetRoot,
        environmentManifestPath: fixture.environmentManifestPath,
        gatePolicyPath: fixture.gatePolicyPath,
        packageTarballPath: fixture.packageTarballPath,
        seeds: [101, 202, 303],
        summaryProtocolPath: fixture.summaryProtocolPath,
      })).rejects.toThrow("C6 pricing receipt hash does not match");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, ciTestTimeout(30_000));
});

async function createFixture(input: {
  aliasedTargetInStageHistory?: boolean;
  codexLauncherRefUsesPackageJson?: boolean;
  codexNativeMachine?: number;
  codexNativeRefUsesLauncher?: boolean;
  codexPlatformPackageName?: string;
  detachedLineageStageHistory?: boolean;
  detachedLineageStageHistoryMaterialization?: boolean;
  detachedLineagePopulation?: boolean;
  detachedLineageTaskContent?: boolean;
  detachedLineageTargetPrompt?: boolean;
  detachedTaskOriginReviewArtifact?:
    | "dispatch"
    | "input"
    | "request"
    | "response";
  duplicateAgentVisibleTaskWithDistinctGold?: boolean;
  duplicateLineageTarget?: boolean;
  duplicateTaskContent?: boolean;
  detachedUpstreamReceiptLocator?: boolean;
  detachedUpstreamReceiptRequest?: boolean;
  lineageTargetInStageHistory?: boolean;
  legacyDatasetProtocol?: boolean;
  legacyGatePolicy?: boolean;
  legacySummaryProtocol?: boolean;
  nonCanonicalLineageSourceRecord?: boolean;
  omitDatasetLineage?: boolean;
  relationshipMutation?: "sibling-ancestry";
  stageInputMutation?:
    | "allowed-feedback"
    | "history"
    | "prompt"
    | "snapshot";
  taskOriginRelationshipReviewMutation?: "receipt-hash-drift";
  taskOriginReviewAgentName?: string;
  detachedTaskOriginRequest?: boolean;
  detachedTaskOriginRevision?: boolean;
  taskOriginTaskContentSha256?: string;
} = {}): Promise<{
  codexNativeBinaryPath: string;
  datasetRoot: string;
  environmentManifestPath: string;
  gatePolicyPath: string;
  packageTarballPath: string;
  pricingReceiptPath: string;
  repositoryDesignEvidence: {
    expectedDesignPowerArtifactSha256: string;
    expectedPowerInputArtifactSha256: string;
    expectedRepositoryLineageArtifactSha256: string;
    expectedReviewReceiptSha256: string;
  };
  root: string;
  summaryPromptPath: string;
  summaryProtocolPath: string;
}> {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "goodmemory-c6-ready-"),
  );
  const datasetRoot = join(root, "dataset");
  const protocolRoot = join(root, "protocol");
  await Promise.all([
    mkdir(join(datasetRoot, "evaluator"), { recursive: true }),
    mkdir(join(datasetRoot, "prompts"), { recursive: true }),
    mkdir(join(datasetRoot, "history"), { recursive: true }),
    mkdir(join(
      datasetRoot,
      "provenance",
      "dataset-lineage",
      "licenses",
    ), { recursive: true }),
    mkdir(join(
      datasetRoot,
      "provenance",
      "dataset-lineage",
      "populations",
    ), { recursive: true }),
    mkdir(join(
      datasetRoot,
      "provenance",
      "dataset-lineage",
      "records",
    ), { recursive: true }),
    mkdir(join(
      datasetRoot,
      "provenance",
      "task-origin",
      "relationships",
    ), { recursive: true }),
    mkdir(join(
      datasetRoot,
      "provenance",
      "task-origin",
      "repository-objects",
    ), { recursive: true }),
    mkdir(join(
      datasetRoot,
      "provenance",
      "task-origin",
      "reviews",
    ), { recursive: true }),
    mkdir(join(
      datasetRoot,
      "provenance",
      "task-origin",
      "source-records",
    ), { recursive: true }),
    mkdir(join(
      datasetRoot,
      "provenance",
      "task-origin",
      "upstream-receipts",
    ), { recursive: true }),
    mkdir(protocolRoot, { recursive: true }),
  ]);
  for (let index = 0; index < 6; index += 1) {
    const repositoryRoot = join(
      datasetRoot,
      "repositories",
      `repository-${index}`,
    );
    await mkdir(join(repositoryRoot, "src"), { recursive: true });
    await Promise.all([
      writeFile(
        join(repositoryRoot, "README.md"),
        repositoryReadmeFor(index),
      ),
      writeFile(
        join(repositoryRoot, "src", "task.ts"),
        repositorySource(),
      ),
    ]);
  }
  const history = fixtureHistory();
  await Promise.all([
    writeFile(join(datasetRoot, "history", "shared.jsonl"), history),
    writeFile(join(datasetRoot, "history", "empty.jsonl"), ""),
  ]);
  const mutatedHistory = `${JSON.stringify({
    payload: {
      content: [{
        text: "A distinct visible history was sealed for the mutation probe.",
        type: "input_text",
      }],
      role: "user",
      type: "message",
    },
    type: "response_item",
  })}\n`;
  if (input.stageInputMutation === "history") {
    await writeFile(
      join(datasetRoot, "history", "mutated.jsonl"),
      mutatedHistory,
    );
  }
  const dataset = candidateDataset({
    duplicateAgentVisibleTaskWithDistinctGold:
      input.duplicateAgentVisibleTaskWithDistinctGold ?? false,
    duplicateLineageTarget: input.duplicateLineageTarget ?? false,
    duplicateTaskContent: input.duplicateTaskContent ?? false,
    historySha256: sha256(history),
    mutatedHistorySha256: sha256(mutatedHistory),
    stageInputMutation: input.stageInputMutation,
    detachedTaskOriginRequest: input.detachedTaskOriginRequest ?? false,
    detachedTaskOriginRevision: input.detachedTaskOriginRevision ?? false,
  });
  const taskOriginBundlesByEpisodeId = new Map<
    string,
    TaskOriginFixtureBundle
  >();
  const taskOriginFiles = new Map<string, string>();
  for (const [index, episode] of dataset.episodes.entries()) {
    if (episode.sourceType === "controlled-mutation") {
      continue;
    }
    const bundle = buildTaskOriginFixtureBundle(episode, index, {
      detachedTaskOriginRequest:
        input.detachedTaskOriginRequest ?? false,
      detachedTaskOriginRevision:
        input.detachedTaskOriginRevision ?? false,
      detachedUpstreamReceiptLocator:
        input.detachedUpstreamReceiptLocator ?? false,
      detachedUpstreamReceiptRequest:
        input.detachedUpstreamReceiptRequest ?? false,
      siblingAncestryMutation:
        input.relationshipMutation === "sibling-ancestry" &&
        index === 0,
      taskContentSha256:
        input.taskOriginTaskContentSha256 ??
          candidateTaskContentSha256ForEpisode(episode),
    });
    taskOriginBundlesByEpisodeId.set(episode.id, bundle);
    episode.taskOriginReceipt!.sha256 = sha256(bundle.receipt);
    for (const file of bundle.files) {
      const existing = taskOriginFiles.get(file.path);
      if (existing !== undefined && existing !== file.bytes) {
        throw new Error(`fixture task-origin asset collision ${file.path}`);
      }
      taskOriginFiles.set(file.path, file.bytes);
    }
  }
  const taskOriginDirectories = new Set(
    [...taskOriginFiles.keys()].map((path) =>
      dirname(join(datasetRoot, path))
    ),
  );
  for (const directory of taskOriginDirectories) {
    await mkdir(directory, { recursive: true });
  }
  await writeFixtureFiles(
    [...taskOriginFiles].map(([path, bytes]) => ({
      bytes,
      path: join(datasetRoot, path),
    })),
  );
  const taskAssets = new Map<string, string>();
  dataset.episodes.forEach((episode) => {
    for (const stage of episode.stages) {
      const promptContentIndex = Number.parseInt(
        stage.promptPath.match(/task-(\d+)-stage-\d+\.md$/u)![1]!,
        10,
      );
      const goldContentIndex = Number.parseInt(
        stage.goldPatch.path.match(/gold-(\d+)\.patch$/u)![1]!,
        10,
      );
      taskAssets.set(
        stage.promptPath,
        promptFor(promptContentIndex, stage.position),
      );
      taskAssets.set(stage.goldPatch.path, goldFor(goldContentIndex));
    }
  });
  await writeFixtureFiles(
    [...taskAssets].map(([path, bytes]) => ({
      bytes,
      path: join(datasetRoot, path),
    })),
  );
  const evaluatorCases = {
    cases: dataset.episodes.flatMap((episode) =>
      episode.stages.map((stage) => ({
        episodeId: episode.id,
        failToPass: [{
          args: [episode.id, stage.id],
          expected: `gold-${episode.id}-${stage.id}`,
        }],
        functionName: "evaluateCandidateStage",
        hiddenSentinel: `hidden-${episode.id}-${stage.id}`,
        passToPass: [{
          args: ["protection", stage.id],
          expected: "base-protection",
        }],
        stageId: stage.id,
      }))
    ),
    schemaVersion: 1,
  };
  const evaluatorCasesBytes = `${JSON.stringify(evaluatorCases, null, 2)}\n`;
  const evaluatorRunnerBytes =
    "export const evaluatorOnlySentinel = 'hidden-evaluator-source';\n";
  await Promise.all([
    writeFile(
      join(datasetRoot, "evaluator", "cases.json"),
      evaluatorCasesBytes,
    ),
    writeFile(
      join(datasetRoot, "evaluator", "runner.ts"),
      evaluatorRunnerBytes,
    ),
  ]);
  const forbiddenHashes = [
    sha256(evaluatorCasesBytes),
    sha256(evaluatorRunnerBytes),
  ];
  for (const episode of dataset.episodes) {
    episode.forbiddenLeakage.fileSha256 = [
      ...episode.forbiddenLeakage.fileSha256,
      ...forbiddenHashes,
    ];
    for (const stage of episode.stages) {
      stage.history.forbiddenLeakageSha256 = [
        ...stage.history.forbiddenLeakageSha256,
        ...forbiddenHashes,
      ];
    }
  }
  const taskOriginReviewArtifacts = buildTaskOriginReviewArtifacts(dataset, {
    detachedArtifact: input.detachedTaskOriginReviewArtifact,
    relationshipReviewMutation:
      input.taskOriginRelationshipReviewMutation,
    reviewerAgentName:
      input.taskOriginReviewAgentName ?? "/root/c6_task_origin_review_v5",
    detachedRequest: input.detachedTaskOriginRequest ?? false,
    detachedRevision: input.detachedTaskOriginRevision ?? false,
    taskContentSha256Override: input.taskOriginTaskContentSha256,
    taskOriginBundlesByEpisodeId,
  });
  Object.assign(dataset, {
    taskOriginReviewProvenance: {
      path: taskOriginReviewArtifacts.provenance.path,
      sha256: sha256(taskOriginReviewArtifacts.provenance.bytes),
    },
  });
  await Promise.all(taskOriginReviewArtifacts.files.map((file) => {
    const path = join(datasetRoot, file.path);
    return mkdir(dirname(path), { recursive: true }).then(() =>
      writeFile(path, file.bytes)
    );
  }));
  const datasetLineageArtifacts = buildDatasetLineageArtifacts(dataset, {
    aliasedTargetInStageHistory:
      input.aliasedTargetInStageHistory ?? false,
    detachedStageHistory: input.detachedLineageStageHistory ?? false,
    detachedStageHistoryMaterialization:
      input.detachedLineageStageHistoryMaterialization ?? false,
    detachedPopulation: input.detachedLineagePopulation ?? false,
    detachedTaskContent: input.detachedLineageTaskContent ?? false,
    detachedTargetPrompt: input.detachedLineageTargetPrompt ?? false,
    duplicateTaskHistory:
      input.duplicateTaskContent === true ||
      input.duplicateAgentVisibleTaskWithDistinctGold === true,
    duplicateTarget: input.duplicateLineageTarget ?? false,
    nonCanonicalSourceRecord:
      input.nonCanonicalLineageSourceRecord ?? false,
    targetInStageHistory: input.lineageTargetInStageHistory ?? false,
  });
  if (!input.omitDatasetLineage) {
    Object.assign(dataset, {
      sourceLineage: {
        path: datasetLineageArtifacts.lineage.path,
        sha256: sha256(datasetLineageArtifacts.lineage.bytes),
      },
    });
  }
  await Promise.all(datasetLineageArtifacts.files.map((file) =>
    writeFile(join(datasetRoot, file.path), file.bytes)
  ));
  const manifestDataset = input.legacyDatasetProtocol
    ? legacyDataset(dataset)
    : dataset;
  const datasetBytes = `${JSON.stringify(manifestDataset, null, 2)}\n`;
  await writeFile(join(datasetRoot, "manifest.json"), datasetBytes);
  const repositoryDesignEvidence =
    await writeRepositoryDesignEvidenceArtifacts({
      dataset,
      datasetRoot,
      datasetSha256: sha256(datasetBytes),
    });
  await writeFile(
    join(datasetRoot, "asset-lock.json"),
    serializeC6AssetLock(await buildC6AssetLock(datasetRoot)),
  );

  const packaged = await createPackageTarball(root);
  const packageTarballPath = packaged.path;
  const environmentManifestPath = join(root, "environment.json");
  const codexVersion = "0.145.0";
  const codexRoot = join(
    root,
    "codex-runtime",
    "node_modules",
    "@openai",
    "codex",
  );
  const codexPlatformRoot = join(
    root,
    "codex-runtime",
    "node_modules",
    "@openai",
    "codex-linux-x64",
  );
  const codexCliPackageJsonPath = join(codexRoot, "package.json");
  const codexLauncherPath = join(codexRoot, "bin", "codex.js");
  const codexPlatformPackageJsonPath = join(
    codexPlatformRoot,
    "package.json",
  );
  const codexNativeBinaryPath = join(
    codexPlatformRoot,
    "vendor",
    "x86_64-unknown-linux-musl",
    "bin",
    "codex",
  );
  const codexCliPackageJson = `${JSON.stringify({
    bin: {
      codex: "bin/codex.js",
    },
    name: "@openai/codex",
    optionalDependencies: {
      "@openai/codex-linux-x64":
        `npm:@openai/codex@${codexVersion}-linux-x64`,
    },
    version: codexVersion,
  }, null, 2)}\n`;
  const codexLauncher = [
    "#!/usr/bin/env node",
    "const target = 'x86_64-unknown-linux-musl';",
    "const platformPackage = '@openai/codex-linux-x64';",
    "",
  ].join("\n");
  const codexPlatformPackageJson = `${JSON.stringify({
    cpu: ["x64"],
    files: ["vendor"],
    name: input.codexPlatformPackageName ?? "@openai/codex",
    os: ["linux"],
    version: `${codexVersion}-linux-x64`,
  }, null, 2)}\n`;
  const codexNativeBinary = createTestElf64(
    input.codexNativeMachine ?? 0x3e,
  );
  await Promise.all([
    mkdir(dirname(codexLauncherPath), { recursive: true }),
    mkdir(dirname(codexNativeBinaryPath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(codexCliPackageJsonPath, codexCliPackageJson),
    writeFile(codexLauncherPath, codexLauncher),
    writeFile(codexPlatformPackageJsonPath, codexPlatformPackageJson),
    writeFile(codexNativeBinaryPath, codexNativeBinary, { mode: 0o755 }),
  ]);
  const artifactReference = (
    path: string,
    bytes: string | Uint8Array,
  ) => ({
    bytes: Buffer.byteLength(bytes),
    path: relative(root, path).split("\\").join("/"),
    sha256: sha256(bytes),
  });
  const nativeBinaryReference = input.codexNativeRefUsesLauncher
    ? artifactReference(codexLauncherPath, codexLauncher)
    : artifactReference(codexNativeBinaryPath, codexNativeBinary);
  const launcherReference = input.codexLauncherRefUsesPackageJson
    ? artifactReference(codexCliPackageJsonPath, codexCliPackageJson)
    : artifactReference(codexLauncherPath, codexLauncher);
  await writeFile(environmentManifestPath, `${JSON.stringify({
    architecture: "x64",
    codex: {
      cliPackage: {
        name: "@openai/codex",
        packageJson: artifactReference(
          codexCliPackageJsonPath,
          codexCliPackageJson,
        ),
        version: codexVersion,
      },
      launcher: launcherReference,
      model: "gpt-5.6-sol",
      nativeBinary: nativeBinaryReference,
      platformPackage: {
        dependencyAlias: "@openai/codex-linux-x64",
        packageJson: artifactReference(
          codexPlatformPackageJsonPath,
          codexPlatformPackageJson,
        ),
        version: `${codexVersion}-linux-x64`,
      },
      reasoningEffort: "xhigh",
      version: codexVersion,
    },
    execution: {
      maxConcurrency: 2,
      stageTimeoutMs: 900_000,
      testTimeoutMs: 300_000,
    },
    goodMemoryInstallSource: "package-tarball-only",
    image: {
      sha256: SHA_A,
    },
    networkAccess: false,
    operatingSystem: "linux",
    package: {
      sha256: packaged.sha256,
      version: "0.7.0",
    },
    runnerSource: {
      commit: "1".repeat(40),
      tree: "2".repeat(40),
    },
    schemaVersion: 3,
  }, null, 2)}\n`);

  const summaryPrompt = "Summarize only the supplied prior history.\n";
  const pricingReceipt = [
    "Provider pricing page receipt",
    "Model: gpt-5.6-terra",
    "Observed: 2026-07-24T00:00:00.000Z",
    "Input: 1 USD/M tokens",
    "Cached input: 0.1 USD/M tokens",
    "Output: 4 USD/M tokens",
    "",
  ].join("\n");
  const pricingReceiptPath = join(protocolRoot, "pricing-receipt.txt");
  const pricingBytes = `${JSON.stringify({
    cachedInputUsdPerMillionTokens: 0.1,
    currency: "USD",
    effectiveAt: "2026-07-24T00:00:00.000Z",
    inputUsdPerMillionTokens: 1,
    model: "gpt-5.6-terra",
    observedAt: "2026-07-24T00:00:00.000Z",
    outputUsdPerMillionTokens: 4,
    provider: "gurkiai-openai-compatible",
    schemaVersion: 1,
    source: {
      locator: "https://ai.gurkiai.com/pricing",
      receipt: {
        path: "pricing-receipt.txt",
        sha256: sha256(pricingReceipt),
      },
      type: "provider-published-pricing",
    },
  }, null, 2)}\n`;
  await Promise.all([
    writeFile(join(protocolRoot, "summary-prompt.md"), summaryPrompt),
    writeFile(join(protocolRoot, "pricing.json"), pricingBytes),
    writeFile(pricingReceiptPath, pricingReceipt),
  ]);
  const summaryProtocolPath = join(protocolRoot, "summary-protocol.json");
  const summaryProtocol = {
    generationPolicy: input.legacySummaryProtocol
      ? "once-per-stage-history-before-arm-execution"
      : "once-per-nonempty-stage-history-before-arm-execution",
    historySource: "same-stage-sealed-prefix-as-goodmemory",
    injectionComposition: C6_FLAT_SUMMARY_INJECTION_COMPOSITION,
    leakageAuditRequired: true,
    maxInjectedTokens: 512,
    model: "gpt-5.6-terra",
    noHistoryControl: input.legacySummaryProtocol
      ? undefined
      : {
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
    pricingSnapshot: {
      path: "pricing.json",
      sha256: sha256(pricingBytes),
    },
    prompt: {
      path: "summary-prompt.md",
      sha256: sha256(summaryPrompt),
    },
    provider: "gurkiai-openai-compatible",
    rawGoldAccess: false,
    schemaVersion: input.legacySummaryProtocol ? 2 : 3,
    seedReusePolicy: "one-output-hash-reused-across-all-three-seeds",
    tokenCounter: {
      id: C6_INJECTION_TOKEN_COUNTER_ID,
      sha256: C6_INJECTION_TOKEN_COUNTER_SHA256,
    },
  };
  await writeFile(
    summaryProtocolPath,
    `${JSON.stringify(summaryProtocol, null, 2)}\n`,
  );
  const gatePolicyPath = join(root, "gate-policy.json");
  await writeFile(
    gatePolicyPath,
    `${JSON.stringify(gatePolicy(input.legacyGatePolicy), null, 2)}\n`,
  );

  return {
    codexNativeBinaryPath,
    datasetRoot,
    environmentManifestPath,
    gatePolicyPath,
    packageTarballPath,
    pricingReceiptPath,
    repositoryDesignEvidence,
    root,
    summaryPromptPath: join(protocolRoot, "summary-prompt.md"),
    summaryProtocolPath,
  };
}

function structuralSummaryCorpus(
  plan: C6CandidatePlan,
): C6FlatSummaryCorpus {
  const expectation = buildC6FlatSummaryCorpusExpectation(plan);
  const generationReceipts = expectation.generationBindings.map(
    ({ generationKey, historySourceSha256 }) => ({
      generationKey,
      historySourceSha256,
      outputSha256: sha256(`summary-output:${generationKey}`),
      providerArtifactSha256:
        sha256(`provider-artifact:${generationKey}`),
    }),
  );
  const outputSha256ByGenerationKey = new Map(
    generationReceipts.map((receipt) => [
      receipt.generationKey,
      receipt.outputSha256,
    ]),
  );
  return {
    generationReceipts,
    providerAuthenticityVerified: false,
    schemaVersion: 1,
    stageBindingReceipts: expectation.stageBindings.flatMap((stage) =>
      expectation.seeds.map((seed) => ({
        episodeId: stage.episodeId,
        generationKey: stage.generationKey,
        outputSha256:
          outputSha256ByGenerationKey.get(stage.generationKey)!,
        seed,
        stageId: stage.stageId,
      }))
    ),
    status: "structural-preflight-only",
  };
}

async function loadFixtureReadiness(
  fixture: Awaited<ReturnType<typeof createFixture>>,
) {
  return loadC6CandidateReadiness({
    c5EvidenceRoot: C5_EVIDENCE_ROOT,
    datasetRoot: fixture.datasetRoot,
    environmentManifestPath: fixture.environmentManifestPath,
    gatePolicyPath: fixture.gatePolicyPath,
    packageTarballPath: fixture.packageTarballPath,
    repositoryDesignEvidence: fixture.repositoryDesignEvidence,
    seeds: [101, 202, 303],
    summaryProtocolPath: fixture.summaryProtocolPath,
  });
}

async function writeFixtureFiles(
  files: ReadonlyArray<{ bytes: string; path: string }>,
): Promise<void> {
  for (let index = 0; index < files.length; index += 64) {
    await Promise.all(files.slice(index, index + 64).map((file) =>
      writeFile(file.path, file.bytes)
    ));
  }
}

async function writeRepositoryDesignEvidenceArtifacts(input: {
  dataset: CodexCodingEffectDatasetV3;
  datasetRoot: string;
  datasetSha256: string;
}): Promise<{
  expectedDesignPowerArtifactSha256: string;
  expectedPowerInputArtifactSha256: string;
  expectedRepositoryLineageArtifactSha256: string;
  expectedReviewReceiptSha256: string;
}> {
  const primaryCodingEpisodes = input.dataset.episodes.filter((episode) =>
    episode.sourceType !== "controlled-mutation"
  );
  const evidenceRoot = join(
    input.datasetRoot,
    "provenance",
    "repository-design",
  );
  const reviewRoot = join(evidenceRoot, "review");
  await mkdir(reviewRoot, { recursive: true });
  const repositories = Array.from({ length: 6 }, (_, index) => ({
    canonicalUrl: `https://github.com/c6-fixture/repository-${index}`,
    familyId: `family-${index}`,
    rawUrl: `https://github.com/c6-fixture/repository-${index}.git`,
    relation: "direct",
    upstreamIdentity: `github:c6-fixture/repository-${index}`,
  }));
  const lineageBytes = canonicalRepositoryDesignJson({
    datasetSha256: input.datasetSha256,
    repositories,
    schemaVersion: 1,
  });
  const lineageSha256 = sha256(lineageBytes);
  await writeFile(
    join(evidenceRoot, "repository-lineage.json"),
    lineageBytes,
  );

  const familyByEpisode = Object.fromEntries(
    primaryCodingEpisodes.map((episode) => [
      episode.id,
      `family-${
        Number.parseInt(
          episode.repository.assetPath!.slice(
            "repositories/repository-".length,
          ),
          10,
        )
      }`,
    ]),
  );
  const bindingSha256 = sha256(canonicalRepositoryDesignJson(
    Object.entries(familyByEpisode)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([episodeId, familyId]) => ({ episodeId, familyId })),
  ));
  const episodesByFamily = new Map<string, string[]>();
  for (const [episodeId, familyId] of Object.entries(familyByEpisode)) {
    const episodeIds = episodesByFamily.get(familyId) ?? [];
    episodeIds.push(episodeId);
    episodesByFamily.set(familyId, episodeIds);
  }
  const allocationSha256 = sha256(canonicalRepositoryDesignJson(
    [...episodesByFamily.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([familyId, episodeIds]) => ({
        episodeIds: episodeIds.sort(),
        familyId,
      })),
  ));
  const powerInputBytes = canonicalRepositoryDesignJson({
    algorithm: "repository-mean-normal-power-and-precision-v1",
    alpha: 0.05,
    confidenceLevel: 0.95,
    maximumHalfWidth: 0.02,
    minimumDetectableEffect: 0.03,
    minimumRepositoryFamilies: 2,
    planningRepositoryStandardDeviation: 0.01,
    power: 0.8,
    schemaVersion: 1,
  });
  const powerInputSha256 = sha256(powerInputBytes);
  await writeFile(
    join(evidenceRoot, "power-input.json"),
    powerInputBytes,
  );
  const designBytes = canonicalRepositoryDesignJson({
    author: "c6-repository-design-author",
    createdAt: "2026-07-24T12:00:00.000Z",
    datasetEpisodeCount: primaryCodingEpisodes.length,
    datasetSha256: input.datasetSha256,
    episodeFamilyBindingSha256: bindingSha256,
    groupingPolicy: "canonical-upstream-repository-family-v1",
    powerInputArtifactSha256: powerInputSha256,
    powerRequiredRepositoryFamilies: 1,
    precisionRequiredRepositoryFamilies: 1,
    repositoryFamilyAllocationSha256: allocationSha256,
    requiredRepositoryFamilies: 2,
    schemaVersion: 1,
  });
  const designSha256 = sha256(designBytes);
  await writeFile(join(evidenceRoot, "design-power.json"), designBytes);

  const reviewInputBytes = canonicalRepositoryDesignJson({
    datasetSha256: input.datasetSha256,
    designPowerArtifactSha256: designSha256,
    powerInputArtifactSha256: powerInputSha256,
    repositoryLineageArtifactSha256: lineageSha256,
    schemaVersion: 1,
  });
  const reviewInputSha256 = sha256(reviewInputBytes);
  const reviewRequestBytes = canonicalRepositoryDesignJson({
    declaredOutcomeAccess: "prohibited",
    inputSha256: reviewInputSha256,
    schemaVersion: 1,
    task: "repository-design-review",
  });
  const reviewRequestSha256 = sha256(reviewRequestBytes);
  const reviewDispatchBytes = canonicalRepositoryDesignJson({
    author: "c6-repository-design-author",
    inputSha256: reviewInputSha256,
    requestSha256: reviewRequestSha256,
    reviewer: "c6-repository-design-reviewer",
    schemaVersion: 1,
  });
  const reviewResponseBytes = canonicalRepositoryDesignJson({
    decision: "accepted",
    designPowerArtifactSha256: designSha256,
    inputSha256: reviewInputSha256,
    requestSha256: reviewRequestSha256,
    reviewedAt: "2026-07-24T13:00:00.000Z",
    reviewer: "c6-repository-design-reviewer",
    schemaVersion: 1,
  });
  const reviewReceiptBytes = canonicalRepositoryDesignJson({
    author: "c6-repository-design-author",
    decision: "accepted",
    designPowerArtifactSha256: designSha256,
    provenance: {
      dispatch: {
        path: "provenance/repository-design/review/dispatch.json",
        sha256: sha256(reviewDispatchBytes),
      },
      input: {
        path: "provenance/repository-design/review/input.json",
        sha256: reviewInputSha256,
      },
      request: {
        path: "provenance/repository-design/review/request.json",
        sha256: reviewRequestSha256,
      },
      response: {
        path: "provenance/repository-design/review/response.json",
        sha256: sha256(reviewResponseBytes),
      },
    },
    powerInputArtifactSha256: powerInputSha256,
    repositoryLineageArtifactSha256: lineageSha256,
    reviewedAt: "2026-07-24T13:00:00.000Z",
    reviewer: "c6-repository-design-reviewer",
    schemaVersion: 1,
  });
  await Promise.all([
    writeFile(join(reviewRoot, "input.json"), reviewInputBytes),
    writeFile(join(reviewRoot, "request.json"), reviewRequestBytes),
    writeFile(join(reviewRoot, "dispatch.json"), reviewDispatchBytes),
    writeFile(join(reviewRoot, "response.json"), reviewResponseBytes),
    writeFile(
      join(evidenceRoot, "review-receipt.json"),
      reviewReceiptBytes,
    ),
  ]);
  return {
    expectedDesignPowerArtifactSha256: designSha256,
    expectedPowerInputArtifactSha256: powerInputSha256,
    expectedRepositoryLineageArtifactSha256: lineageSha256,
    expectedReviewReceiptSha256: sha256(reviewReceiptBytes),
  };
}

function canonicalRepositoryDesignJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }
  return value;
}

function createTestElf64(machine: number, suffix = ""): Buffer {
  const bytes = Buffer.alloc(64 + Buffer.byteLength(suffix));
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0);
  bytes.writeUInt16LE(2, 16);
  bytes.writeUInt16LE(machine, 18);
  bytes.writeUInt32LE(1, 20);
  bytes.write(suffix, 64);
  return bytes;
}

async function createPackageTarball(root: string): Promise<{
  path: string;
  sha256: string;
}> {
  const sourceRoot = join(root, "npm-source");
  const packageRoot = join(sourceRoot, "package");
  for (const path of [
    "scripts/goodmemory-cli.js",
    "scripts/goodmemory-mcp.js",
    "dist/bin/goodmemory-cli.js",
    "dist/bin/goodmemory-mcp.js",
    "dist/host/index.js",
  ]) {
    const absolutePath = join(packageRoot, path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, `// ${path}\n`);
  }
  await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({
    name: "goodmemory",
    version: "0.7.0",
  }, null, 2)}\n`);
  const path = join(root, "goodmemory.tgz");
  const child = Bun.spawn({
    cmd: ["tar", "-czf", path, "-C", sourceRoot, "package"],
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`C6 test package creation failed: ${stderr}`);
  }
  return {
    path,
    sha256: sha256(new Uint8Array(await Bun.file(path).arrayBuffer())),
  };
}

function gatePolicy(legacy = false) {
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
          legacy
            ? "rebuild-from-same-sealed-prehistory"
            : "rebuild-from-stage-sealed-prefix",
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
    schemaVersion: legacy ? 3 : 4,
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
        minimumEpisodeFloorBinding: "c5-eligible-position-power-floor",
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

function candidateDataset(input: {
  duplicateAgentVisibleTaskWithDistinctGold: boolean;
  duplicateLineageTarget: boolean;
  duplicateTaskContent: boolean;
  historySha256: string;
  mutatedHistorySha256: string;
  stageInputMutation?:
    | "allowed-feedback"
    | "history"
    | "prompt"
    | "snapshot";
  detachedTaskOriginRequest: boolean;
  detachedTaskOriginRevision: boolean;
}): CodexCodingEffectDatasetV3 {
  const dataset: CodexCodingEffectDatasetV3 = {
    datasetId: "codex-c6-claim-candidate-v1",
    episodes: Array.from({ length: 391 }, (_, index) => {
      const duplicatesFirstVisibleTask =
        index === DUPLICATE_TASK_EPISODE_INDEX &&
        (
          input.duplicateTaskContent ||
          input.duplicateAgentVisibleTaskWithDistinctGold
        );
      const promptContentIndex =
        duplicatesFirstVisibleTask ? 0 : index;
      const goldContentIndex =
        input.duplicateTaskContent && duplicatesFirstVisibleTask ? 0 : index;
      const goldSha256 = sha256(goldFor(goldContentIndex));
      const stratum =
        CODEX_CODING_EFFECT_MEMORY_STRATA[
          index % CODEX_CODING_EFFECT_MEMORY_STRATA.length
      ]!;
      const noHistory = stratum === "no-history-negative-control";
      const irrelevant =
        stratum === "irrelevant-memory-negative-control";
      const realHistory = index % 5 === 0;
      return {
        author: "C6 fixture author",
        claimEligibility: "claim-eligible" as const,
        ecosystem: index % 2 === 0 ? "bun-typescript" : "python",
        forbiddenLeakage: {
          fileSha256: [goldSha256],
          strings: [`forbidden-${index}`],
        },
        id: `candidate-${String(index + 1).padStart(3, "0")}`,
        historyPolicy: "stage-scoped-sealed-prefix-v1" as const,
        language: index % 2 === 0 ? "TypeScript" : "Python",
        preparation: {
          command: ["true"],
          networkMode: "disabled" as const,
        },
        primaryStratum: stratum,
        provenance: `C6 fixture provenance ${index}`,
        repository: {
          assetPath: `repositories/repository-${index % 6}`,
          baseCommit: sha256(`commit-${index % 6}`),
          license: "MIT",
          redistributionAllowed: true,
          redistributionReviewed: true,
          url: `https://github.com/c6-fixture/repository-${index % 6}.git`,
        },
        sourceType: realHistory
          ? "real-history" as const
          : "external-benchmark" as const,
        stages: [1, 2, 3].map((position) => {
          const mutationTarget = index === 1 && position === 1;
          const stagePromptContentIndex =
            input.stageInputMutation === "prompt" &&
                mutationTarget
              ? 10_001
              : input.duplicateLineageTarget &&
              index === 7 &&
              position === 1
              ? 1
              : promptContentIndex;
          const stageSnapshotIndex =
            duplicatesFirstVisibleTask
              ? 0
              : input.duplicateLineageTarget &&
                  index === 7 &&
                  position === 1
              ? 1
              : index;
          return {
          allowedFeedback:
            input.stageInputMutation === "allowed-feedback" &&
              mutationTarget
              ? ["Use the public alpha API established by the prior attempt."]
              : [],
          expectedChangedFiles: ["src/task.ts"],
          goldPatch: {
            path: `evaluator/gold-${goldContentIndex}.patch`,
            sha256: goldSha256,
          },
          hiddenFailToPass: ["bun", "test", "hidden"],
          hiddenPassToPass: ["bun", "test", "protection"],
          history: {
            forbiddenLeakageSha256: [goldSha256],
            path: noHistory
              ? "history/empty.jsonl"
              : input.stageInputMutation === "history" && index === 1
                ? "history/mutated.jsonl"
                : "history/shared.jsonl",
            sha256: noHistory
              ? sha256("")
              : input.stageInputMutation === "history" && index === 1
                ? input.mutatedHistorySha256
                : input.historySha256,
            source: "frozen-artifact" as const,
          },
          id: `stage-${position}`,
          memoryExpectation: position === 1 || noHistory
            ? { dependencies: [], mode: "none" as const }
            : {
              dependencies: [{
                category: stratum,
                description: `Memory dependency ${index}`,
              }],
              mode: irrelevant
                ? "irrelevant-control" as const
                : "required" as const,
          },
          position,
          promptPath:
            `prompts/task-${stagePromptContentIndex}-stage-${position}.md`,
          snapshot:
            input.stageInputMutation === "snapshot" && mutationTarget
              ? alternateTaskGitSnapshot()
              : taskGitSnapshot(stageSnapshotIndex % 6, position),
          timeoutMs: 300_000,
          visibleTest: ["bun", "test", "visible"],
          };
        }),
        stateMode: "canonical-snapshot" as const,
        strata: [stratum],
        taskOriginReceipt: {
          path:
            `provenance/task-origin/reviews/candidate-${String(index + 1).padStart(3, "0")}.json`,
          sha256: SHA_A,
        },
      };
    }),
    schemaVersion: 3,
  };
  return dataset;
}

function legacyDataset(dataset: CodexCodingEffectDatasetV3): unknown {
  return {
    ...dataset,
    episodes: dataset.episodes.map((episode) => {
      const {
        historyPolicy: _historyPolicy,
        stages,
        ...legacyEpisode
      } = episode;
      return {
        ...legacyEpisode,
        prehistory: stages[0]!.history,
        stages: stages.map((stage) => {
          const {
            history: _history,
            ...legacyStage
          } = stage;
          return legacyStage;
        }),
      };
    }),
    schemaVersion: 2,
  };
}

function promptFor(index: number, position: number): string {
  const action = ["Create", "Repair", "Harden"][position - 1]!;
  const subject = ["alpha", "beta", "gamma"][position - 1]!;
  return `${action} ${subject}-${index} behavior.\n`;
}

function repositoryReadmeFor(index: number): string {
  return `# Repository ${index}\n\nImplementation is in src/task.ts.\n`;
}

function repositorySource(): string {
  return "export const currentValue = 'base';\n";
}

interface TaskOriginFixtureBundle {
  files: Array<{ bytes: string; path: string }>;
  receipt: string;
  sourceRecord: string;
}

interface TaskOriginArtifactReference {
  bytes: number;
  path: string;
  sha256: string;
}

interface TaskGitObject {
  bytes: string;
  oid: string;
}

function buildTaskOriginFixtureBundle(
  episode: CodexCodingEffectDatasetV3["episodes"][number],
  index: number,
  input: {
    detachedTaskOriginRequest: boolean;
    detachedTaskOriginRevision: boolean;
    detachedUpstreamReceiptLocator: boolean;
    detachedUpstreamReceiptRequest: boolean;
    siblingAncestryMutation: boolean;
    taskContentSha256: string;
  },
): TaskOriginFixtureBundle {
  const relationship = taskOriginRelationshipArtifactsFor(
    episode,
    index,
    input.siblingAncestryMutation,
  );
  const promptContentIndexes = promptContentIndexesForEpisode(episode);
  const sourceRecord = taskOriginSourceRecordFor(
    index,
    promptContentIndexes[0]!,
    {
      detachedRequest: input.detachedTaskOriginRequest,
      detachedRevision: input.detachedTaskOriginRevision,
      promptContentIndexes,
      relationships: relationship.references,
      taskContentSha256: input.taskContentSha256,
    },
  );
  const receipt = taskOriginReceiptFor(
    index,
    sourceRecord,
  );
  return {
    files: [
      ...episode.stages.map((stage) => ({
        bytes: taskOriginUpstreamReceiptFor(
          index,
          promptContentIndexes[stage.position - 1]!,
          stage.position,
          {
            detachedLocator: input.detachedUpstreamReceiptLocator,
            detachedRequest: input.detachedUpstreamReceiptRequest,
          },
        ),
        path: taskOriginUpstreamReceiptPath(episode.id, stage.id),
      })),
      ...relationship.files,
      {
        bytes: sourceRecord,
        path:
          `provenance/task-origin/source-records/${episode.id}.json`,
      },
      {
        bytes: receipt,
        path: episode.taskOriginReceipt!.path,
      },
    ],
    receipt,
    sourceRecord,
  };
}

function taskOriginRelationshipArtifactsFor(
  episode: CodexCodingEffectDatasetV3["episodes"][number],
  index: number,
  siblingAncestryMutation = false,
): {
  files: Array<{ bytes: string; path: string }>;
  references: TaskOriginArtifactReference[];
} {
  const history = taskGitHistory(index % 6);
  const files = new Map<string, string>();
  const references = episode.stages.slice(1).map((laterStage, edgeIndex) => {
    const priorStage = episode.stages[edgeIndex]!;
    const laterCommit = history.stageSnapshots[edgeIndex + 1]!;
    const priorCompletion =
      siblingAncestryMutation && edgeIndex === 0
        ? taskGitObject(
          `repository-${index % 6}-sibling-completion`,
          [history.stageSnapshots[0]!.oid],
        )
        : history.completions[edgeIndex]!;
    if (laterStage.snapshot !== laterCommit.oid) {
      throw new Error(
        `fixture stage snapshot does not match relationship history ${episode.id}:${laterStage.id}`,
      );
    }
    const completionPath = taskOriginCompletionReceiptPath(
      episode.id,
      priorStage.id,
    );
    const completionBytes = taskOriginCompletionReceiptFor({
      index,
      mergeCommitSha: priorCompletion.oid,
      mergedAt: taskOriginCompletionTime(priorStage.position),
      position: priorStage.position,
    });
    files.set(completionPath, completionBytes);
    for (const commit of [laterCommit, priorCompletion]) {
      files.set(
        `provenance/task-origin/repository-objects/${commit.oid}.commit`,
        commit.bytes,
      );
    }
    const relationshipPath = taskOriginRelationshipReceiptPath(
      episode.id,
      priorStage.id,
      laterStage.id,
    );
    const relationshipBytes = canonicalJson({
      commitPath: [laterCommit, priorCompletion].map((commit) => ({
        ...taskOriginArtifactReference(
          `provenance/task-origin/repository-objects/${commit.oid}.commit`,
          commit.bytes,
        ),
        oid: commit.oid,
      })),
      edgeId: `${episode.id}/${priorStage.id}->${laterStage.id}`,
      episodeId: episode.id,
      laterRequest: {
        ...taskOriginArtifactReference(
          taskOriginUpstreamReceiptPath(episode.id, laterStage.id),
          taskOriginUpstreamReceiptFor(
            index,
            promptContentIndexesForEpisode(episode)[
              laterStage.position - 1
            ]!,
            laterStage.position,
          ),
        ),
        format: "github-issue-api-json-v2",
      },
      laterStageId: laterStage.id,
      priorCompletion: {
        ...taskOriginArtifactReference(
          completionPath,
          completionBytes,
        ),
        format: "github-pull-request-api-json-v1",
      },
      priorRequest: {
        ...taskOriginArtifactReference(
          taskOriginUpstreamReceiptPath(episode.id, priorStage.id),
          taskOriginUpstreamReceiptFor(
            index,
            promptContentIndexesForEpisode(episode)[
              priorStage.position - 1
            ]!,
            priorStage.position,
          ),
        ),
        format: "github-issue-api-json-v2",
      },
      priorStageId: priorStage.id,
      schemaVersion: 1,
    });
    files.set(relationshipPath, relationshipBytes);
    return taskOriginArtifactReference(
      relationshipPath,
      relationshipBytes,
    );
  });
  return {
    files: [...files].map(([path, bytes]) => ({ bytes, path })),
    references,
  };
}

function taskGitHistory(repositoryIndex: number): {
  completions: [TaskGitObject, TaskGitObject];
  stageSnapshots: [TaskGitObject, TaskGitObject, TaskGitObject];
} {
  const stage1 = taskGitObject(`repository-${repositoryIndex}-stage-1`);
  const completion1 = taskGitObject(
    `repository-${repositoryIndex}-completion-1`,
    [stage1.oid],
  );
  const stage2 = taskGitObject(
    `repository-${repositoryIndex}-stage-2`,
    [completion1.oid],
  );
  const completion2 = taskGitObject(
    `repository-${repositoryIndex}-completion-2`,
    [stage2.oid],
  );
  const stage3 = taskGitObject(
    `repository-${repositoryIndex}-stage-3`,
    [completion2.oid],
  );
  return {
    completions: [completion1, completion2],
    stageSnapshots: [stage1, stage2, stage3],
  };
}

function taskGitObject(label: string, parents: string[] = []): TaskGitObject {
  const bytes = [
    `tree ${sha256(`tree-${label}`)}`,
    ...parents.map((parent) => `parent ${parent}`),
    "author C6 Fixture <c6@example.invalid> 0 +0000",
    "committer C6 Fixture <c6@example.invalid> 0 +0000",
    "",
    `${label}\n`,
  ].join("\n");
  return {
    bytes,
    oid: createHash("sha256")
      .update(`commit ${Buffer.byteLength(bytes)}\0`)
      .update(bytes)
      .digest("hex"),
  };
}

function taskGitSnapshot(repositoryIndex: number, position: number): string {
  return taskGitHistory(repositoryIndex).stageSnapshots[position - 1]!.oid;
}

function alternateTaskGitSnapshot(): string {
  return taskGitObject("alternate-stage-snapshot").oid;
}

function taskOriginArtifactReference(
  path: string,
  bytes: string,
): TaskOriginArtifactReference {
  return {
    bytes: Buffer.byteLength(bytes),
    path,
    sha256: sha256(bytes),
  };
}

function taskOriginSourceRecordFor(
  index: number,
  contentIndex: number,
  input: {
    detachedRequest?: boolean;
    detachedRevision?: boolean;
    promptContentIndexes?: readonly number[];
    relationships?: readonly TaskOriginArtifactReference[];
    taskContentSha256?: string;
  } = {},
): string {
  const episodeId = `candidate-${String(index + 1).padStart(3, "0")}`;
  const sourceType = index % 5 === 0
    ? "real-history"
    : "external-benchmark";
  return `${JSON.stringify({
    candidateTaskContentSha256:
      input.taskContentSha256 ??
        candidateTaskContentSha256For(index, contentIndex),
    episodeId,
    repository: {
      baseCommit: sha256(`commit-${index % 6}`),
      url: `https://github.com/c6-fixture/repository-${index % 6}.git`,
    },
    relationships: input.relationships ?? [],
    schemaVersion: 5,
    sourceType,
    stages: [1, 2, 3].map((position) => {
      const stageId = `stage-${position}`;
      const stageContentIndex =
        input.promptContentIndexes?.[position - 1] ?? contentIndex;
      const upstreamReceipt = taskOriginUpstreamReceiptFor(
        index,
        stageContentIndex,
        position,
      );
      const originalRequest =
        input.detachedRequest && index === 0 && position === 2
          ? "Different reviewed original request."
          : promptFor(stageContentIndex, position).trimEnd();
      return {
        originalRequest,
        originalRequestSha256: sha256(originalRequest),
        originReceipt: {
          bytes: Buffer.byteLength(upstreamReceipt),
          format: "github-issue-api-json-v2",
          path: taskOriginUpstreamReceiptPath(episodeId, stageId),
          sha256: sha256(upstreamReceipt),
        },
        source: {
          kind: "issue",
          locator: taskOriginLocator(index, position),
          revision:
            input.detachedRevision && index === 0 && position === 2
              ? SHA_A
              : sha256(upstreamReceipt),
        },
        stageId,
      };
    }),
  }, null, 2)}\n`;
}

function taskOriginUpstreamReceiptPath(
  episodeId: string,
  stageId: string,
): string {
  return `provenance/task-origin/upstream-receipts/${episodeId}-${stageId}.json`;
}

function taskOriginLocator(index: number, position: number): string {
  const issueNumber = index * 3 + position;
  return `https://github.com/c6-fixture/repository-${index % 6}/issues/${issueNumber}`;
}

function taskOriginUpstreamReceiptFor(
  index: number,
  contentIndex: number,
  position: number,
  input: {
    detachedLocator?: boolean;
    detachedRequest?: boolean;
  } = {},
): string {
  const issueNumber = index * 3 + position;
  const body =
    input.detachedRequest && index === 0 && position === 2
      ? "Different upstream request."
      : promptFor(contentIndex, position).trimEnd();
  return `${JSON.stringify({
    body,
    created_at: taskOriginRequestTime(position),
    html_url:
      input.detachedLocator && index === 0 && position === 3
        ? "https://github.com/c6-fixture/repository-0/issues/999999"
        : taskOriginLocator(index, position),
    node_id: `c6-fixture-issue-${issueNumber}`,
    number: issueNumber,
    repository_url:
      `https://api.github.com/repos/c6-fixture/repository-${index % 6}`,
    updated_at: taskOriginRequestTime(position),
  }, null, 2)}\n`;
}

function taskOriginRequestTime(position: number): string {
  return `2026-01-${String(position * 2 - 1).padStart(2, "0")}T00:00:00.000Z`;
}

function taskOriginCompletionTime(position: number): string {
  return `2026-01-${String(position * 2).padStart(2, "0")}T00:00:00.000Z`;
}

function taskOriginCompletionReceiptPath(
  episodeId: string,
  priorStageId: string,
): string {
  return `provenance/task-origin/upstream-receipts/${episodeId}-${priorStageId}-completion.json`;
}

function taskOriginCompletionReceiptFor(input: {
  index: number;
  mergeCommitSha: string;
  mergedAt: string;
  position: number;
}): string {
  const pullNumber = input.index * 3 + input.position;
  return canonicalJson({
    html_url:
      `https://github.com/c6-fixture/repository-${input.index % 6}/pull/${pullNumber}`,
    merge_commit_sha: input.mergeCommitSha,
    merged: true,
    merged_at: input.mergedAt,
    node_id: `c6-fixture-pull-${pullNumber}`,
    number: pullNumber,
    repository_url:
      `https://api.github.com/repos/c6-fixture/repository-${input.index % 6}`,
  });
}

function taskOriginRelationshipReceiptPath(
  episodeId: string,
  priorStageId: string,
  laterStageId: string,
): string {
  return `provenance/task-origin/relationships/${episodeId}/${priorStageId}-to-${laterStageId}.json`;
}

function taskOriginReceiptFor(
  index: number,
  sourceRecord: string,
): string {
  const episodeId = `candidate-${String(index + 1).padStart(3, "0")}`;
  const sourceType = index % 5 === 0
    ? "real-history"
    : "external-benchmark";
  return `${JSON.stringify({
    episodeId,
    schemaVersion: 5,
    sourceRecord: {
      path: `provenance/task-origin/source-records/${episodeId}.json`,
      sha256: sha256(sourceRecord),
    },
    sourceType,
  }, null, 2)}\n`;
}

function promptContentIndexesForEpisode(
  episode: CodexCodingEffectDatasetV3["episodes"][number],
): number[] {
  return episode.stages.map((stage) =>
    Number.parseInt(
      stage.promptPath.match(/task-(\d+)-stage-\d+\.md$/u)![1]!,
      10,
    )
  );
}

function candidateTaskContentSha256For(
  index: number,
  contentIndex: number | readonly number[],
  snapshotIndex = index,
): string {
  const contentIndexes = typeof contentIndex === "number"
    ? [contentIndex, contentIndex, contentIndex]
    : contentIndex;
  const noHistory =
    CODEX_CODING_EFFECT_MEMORY_STRATA[
      index % CODEX_CODING_EFFECT_MEMORY_STRATA.length
    ] === "no-history-negative-control";
  const repositoryFiles = [
    {
      bytes: Buffer.byteLength(repositoryReadmeFor(index % 6)),
      mode: 0o644,
      path: "README.md",
      sha256: sha256(repositoryReadmeFor(index % 6)),
    },
    {
      bytes: Buffer.byteLength(repositorySource()),
      mode: 0o644,
      path: "src/task.ts",
      sha256: sha256(repositorySource()),
    },
  ];
  return sha256(JSON.stringify({
    repository: {
      assetPath: `repositories/repository-${index % 6}`,
      baseCommit: sha256(`commit-${index % 6}`),
      contentSha256: sha256(JSON.stringify(repositoryFiles)),
      url: `https://github.com/c6-fixture/repository-${index % 6}.git`,
    },
    stages: contentIndexes.map((promptIndex, stageIndex) => ({
      allowedFeedback: [],
      historySha256: noHistory ? sha256("") : sha256(fixtureHistory()),
      promptSha256: sha256(promptFor(promptIndex, stageIndex + 1)),
      snapshot: taskGitSnapshot(
        snapshotIndex % 6,
        stageIndex + 1,
      ),
    })),
  }));
}

function candidateTaskContentSha256ForEpisode(
  episode: CodexCodingEffectDatasetV3["episodes"][number],
): string {
  const repositoryIndex = Number.parseInt(
    episode.repository.assetPath!.slice("repositories/repository-".length),
    10,
  );
  const repositoryFiles = [
    {
      bytes: Buffer.byteLength(repositoryReadmeFor(repositoryIndex)),
      mode: 0o644,
      path: "README.md",
      sha256: sha256(repositoryReadmeFor(repositoryIndex)),
    },
    {
      bytes: Buffer.byteLength(repositorySource()),
      mode: 0o644,
      path: "src/task.ts",
      sha256: sha256(repositorySource()),
    },
  ];
  return sha256(JSON.stringify({
    repository: {
      assetPath: episode.repository.assetPath,
      baseCommit: episode.repository.baseCommit,
      contentSha256: sha256(JSON.stringify(repositoryFiles)),
      url: episode.repository.url,
    },
    stages: episode.stages.map((stage) => {
      const promptIndex = Number.parseInt(
        stage.promptPath.match(/task-(\d+)-stage-\d+\.md$/u)![1]!,
        10,
      );
      return {
        allowedFeedback: stage.allowedFeedback,
        historySha256: stage.history.sha256,
        promptSha256: sha256(promptFor(promptIndex, stage.position)),
        snapshot: stage.snapshot,
      };
    }),
  }));
}

function fixtureHistory(): string {
  return `${JSON.stringify({
    payload: {
      content: [{
        text: "The prior work established a general repository convention.",
        type: "input_text",
      }],
      role: "user",
      type: "message",
    },
    type: "response_item",
  })}\n`;
}

function buildDatasetLineageArtifacts(
  dataset: CodexCodingEffectDatasetV3,
  input: {
    aliasedTargetInStageHistory: boolean;
    detachedStageHistory: boolean;
    detachedStageHistoryMaterialization: boolean;
    detachedPopulation: boolean;
    detachedTaskContent: boolean;
    detachedTargetPrompt: boolean;
    duplicateTaskHistory: boolean;
    duplicateTarget: boolean;
    nonCanonicalSourceRecord: boolean;
    targetInStageHistory: boolean;
  },
): {
  files: Array<{ bytes: string; path: string }>;
  lineage: { bytes: string; path: string };
} {
  const sourceTypes = [
    "external-benchmark",
    "real-history",
  ] as const;
  const files: Array<{ bytes: string; path: string }> = [];
  const recordSha256BySourceUnitKey = new Map<string, string>();
  const sources = sourceTypes.map((sourceType) => {
    const sourceId = `${sourceType}-source`;
    const revision = sha256(`${sourceId}-revision`);
    const records: Array<Record<string, unknown>> = [];
    for (const episode of dataset.episodes.filter((candidate) =>
      candidate.sourceType === sourceType
    )) {
      const episodeIndex = Number.parseInt(
        episode.id.slice("candidate-".length),
        10,
      ) - 1;
      const historyId = `history-${episode.id}`;
      const historyRequest = episode.stages[0]!.history.path ===
          "history/mutated.jsonl"
        ? "A distinct visible history was sealed for the mutation probe."
        : "The prior work established a general repository convention.";
      records.push({
        id: historyId,
        locator: input.aliasedTargetInStageHistory &&
            episode.id === "candidate-002"
          ? taskOriginLocator(0, 1)
          : `https://example.invalid/c6/source-units/${sourceId}/${historyId}`,
        repository: {
          baseCommit: episode.repository.baseCommit,
          url: episode.repository.url,
        },
        schemaVersion: 1,
        sourceRequest: historyRequest,
        sourceRequestSha256: sha256(historyRequest),
        sourceSnapshotRevision: revision,
        sourceType,
        upstreamItemRevision: sha256(
          `upstream-item-revision-${historyId}`,
        ),
        historyMessage: {
          role: "user",
          text: historyRequest,
        },
        role: "prehistory",
      });
      for (const stage of episode.stages) {
        const targetId = `target-${episode.id}-${stage.id}`;
        const promptIndex = Number.parseInt(
          stage.promptPath.match(/task-(\d+)-stage-\d+\.md$/u)![1]!,
          10,
        );
        const sourceRequest = promptFor(promptIndex, stage.position);
        records.push({
          id: targetId,
          locator: taskOriginLocator(episodeIndex, stage.position),
          repository: {
            baseCommit: episode.repository.baseCommit,
            url: episode.repository.url,
          },
          schemaVersion: 1,
          sourceRequest,
          sourceRequestSha256: sha256(sourceRequest),
          sourceSnapshotRevision: revision,
          sourceType,
          upstreamItemRevision: sha256(taskOriginUpstreamReceiptFor(
            episodeIndex,
            promptIndex,
            stage.position,
          )),
          agentVisiblePromptSha256:
            input.detachedTargetPrompt &&
              sourceType === "external-benchmark" &&
              episode.id === "candidate-002" &&
              stage.position === 1
              ? SHA_A
              : sha256(sourceRequest),
          promptDerivation: "verbatim-source-request-v1",
          role: "target",
          stageSnapshot: stage.snapshot,
        });
      }
    }
    const recordLines = records.map((record, index) => {
      const line = JSON.stringify(record);
      return input.nonCanonicalSourceRecord &&
          sourceType === "external-benchmark" &&
          index === 0
        ? ` ${line}`
        : line;
    });
    const recordsBytes = recordLines.map((line) => `${line}\n`).join("");
    const recordsPath =
      `provenance/dataset-lineage/records/${sourceId}.jsonl`;
    const units = records.map((record, index) => {
      const id = record.id as string;
      const recordSha256 = sha256(`${recordLines[index]!}\n`);
      recordSha256BySourceUnitKey.set(`${sourceId}:${id}`, recordSha256);
      return {
        id,
        recordIndex: index + 1,
        recordSha256,
      };
    });
    const populationBytes = canonicalJson({
      recordsArtifact: {
        path: recordsPath,
        sha256: sha256(recordsBytes),
      },
      revision,
      schemaVersion: 1,
      sourceId,
      sourceType,
      units,
    });
    const populationPath =
      `provenance/dataset-lineage/populations/${sourceId}.json`;
    const licenseBytes = canonicalJson({
      decision: "accepted",
      license: "fixture-only",
      reviewedAt: "2026-07-24T00:00:00.000Z",
      reviewer: "C6 fixture source-license reviewer",
      schemaVersion: 1,
      sourceId,
      sourceRevision: revision,
    });
    const licensePath =
      `provenance/dataset-lineage/licenses/${sourceId}.json`;
    files.push(
      { bytes: populationBytes, path: populationPath },
      { bytes: licenseBytes, path: licensePath },
      { bytes: recordsBytes, path: recordsPath },
    );
    return {
      id: sourceId,
      licenseEvidence: {
        path: licensePath,
        sha256: sha256(licenseBytes),
      },
      locator: `https://example.invalid/c6/source-populations/${sourceId}`,
      populationManifest: {
        path: populationPath,
        sha256: input.detachedPopulation &&
            sourceType === "external-benchmark"
          ? SHA_A
          : sha256(populationBytes),
      },
      revision,
      sourceType,
    };
  });
  const episodes = dataset.episodes.map((episode, index) => {
    const sourceId = `${episode.sourceType}-source`;
    const stages = episode.stages.map((stage) => {
      const historySourceUnitIds =
        episode.strata.includes("no-history-negative-control")
          ? []
          : [
            input.targetInStageHistory && index === 1
              ? `target-${episode.id}-${stage.id}`
              : input.duplicateTaskHistory &&
                  index === DUPLICATE_TASK_EPISODE_INDEX
              ? "history-candidate-001"
              : `history-${episode.id}`,
          ];
      const historyArtifactSha256 =
        input.detachedStageHistory && index === 1
          ? SHA_A
          : stage.history.sha256;
      return {
        historyArtifactSha256,
        historyMaterializationSha256:
          input.detachedStageHistoryMaterialization && index === 1
            ? SHA_A
            : sha256(JSON.stringify({
              historyArtifactSha256,
              sourceId,
              sourceUnitRecordSha256: historySourceUnitIds.map(
                (sourceUnitId) =>
                  recordSha256BySourceUnitKey.get(
                    `${sourceId}:${sourceUnitId}`,
                  )!
              ),
            })),
        historySourceUnitIds,
        stageId: stage.id,
        targetSourceUnitId: `target-${episode.id}-${stage.id}`,
      };
    });
    if (input.duplicateTarget && index === 7) {
      stages[0] = {
        ...stages[0]!,
        targetSourceUnitId: "target-candidate-002-stage-1",
      };
    }
    return {
      agentVisibleTaskSha256:
        input.detachedTaskContent && index === 1
          ? SHA_A
          : candidateTaskContentSha256ForEpisode(episode),
      episodeId: episode.id,
      sourceId,
      stages,
    };
  });
  const lineagePath = "provenance/dataset-lineage/lineage.json";
  const lineageBytes = canonicalJson({
    datasetId: dataset.datasetId,
    episodes,
    schemaVersion: 2,
    sources,
  });
  files.push({ bytes: lineageBytes, path: lineagePath });
  return {
    files,
    lineage: {
      bytes: lineageBytes,
      path: lineagePath,
    },
  };
}

function buildTaskOriginReviewArtifacts(
  dataset: CodexCodingEffectDatasetV3,
  input: {
    detachedArtifact?:
      | "dispatch"
      | "input"
      | "request"
      | "response";
    detachedRequest: boolean;
    detachedRevision: boolean;
    relationshipReviewMutation?: "receipt-hash-drift";
    reviewerAgentName: string;
    taskContentSha256Override?: string;
    taskOriginBundlesByEpisodeId: ReadonlyMap<
      string,
      TaskOriginFixtureBundle
    >;
  },
): {
  files: Array<{ bytes: string; path: string }>;
  provenance: { bytes: string; path: string };
} {
  const reviewRoot = "provenance/task-origin/review";
  const authorTaskName = "C6 fixture author";
  const reviewedAt = "2026-07-24T00:00:00.000Z";
  const inputPath = `${reviewRoot}/input.json`;
  const requestPath = `${reviewRoot}/request.json`;
  const dispatchPath = `${reviewRoot}/dispatch.json`;
  const responsePath = `${reviewRoot}/response.json`;
  const provenancePath = `${reviewRoot}/provenance.json`;
  const reviewedEpisodes = dataset.episodes
    .filter((episode) => episode.sourceType !== "controlled-mutation")
    .map((episode) => {
      const sourceRecord =
        input.taskOriginBundlesByEpisodeId.get(episode.id)?.sourceRecord;
      if (sourceRecord === undefined) {
        throw new Error(
          `fixture task-origin bundle is missing ${episode.id}`,
        );
      }
      const parsedSourceRecord = JSON.parse(sourceRecord) as {
        candidateTaskContentSha256: string;
        relationships: Array<{
          bytes: number;
          path: string;
          sha256: string;
        }>;
        stages: Array<{
          originReceipt: {
            bytes: number;
            path: string;
            sha256: string;
          };
          stageId: string;
        }>;
      };
      return {
        episodeId: episode.id,
        relationshipReceipts: parsedSourceRecord.relationships.map(
          (relationship) => {
            const relationshipBytes =
              input.taskOriginBundlesByEpisodeId.get(episode.id)?.files
                .find((file) => file.path === relationship.path)?.bytes;
            if (relationshipBytes === undefined) {
              throw new Error(
                `fixture relationship receipt is missing ${relationship.path}`,
              );
            }
            const parsed = JSON.parse(relationshipBytes) as {
              edgeId: string;
              laterStageId: string;
              priorStageId: string;
            };
            return {
              bytes: relationship.bytes,
              edgeId: parsed.edgeId,
              laterStageId: parsed.laterStageId,
              path: relationship.path,
              priorStageId: parsed.priorStageId,
              sha256: relationship.sha256,
            };
          },
        ),
        receiptSha256: episode.taskOriginReceipt!.sha256,
        sourceRecordSha256: sha256(sourceRecord),
        stageOriginReceipts: parsedSourceRecord.stages.map((stage) => ({
          bytes: stage.originReceipt.bytes,
          path: stage.originReceipt.path,
          sha256: stage.originReceipt.sha256,
          stageId: stage.stageId,
        })),
        taskContentSha256: parsedSourceRecord.candidateTaskContentSha256,
      };
    });
  const inputBytes = canonicalJson({
    datasetId: dataset.datasetId,
    reviewedEpisodes,
    schemaVersion: 5,
  });
  const requestBytes = canonicalJson({
    input: artifactReference(inputPath, inputBytes),
    rawGoldAccess: false,
    runOutcomeAccess: false,
    requiredChecks: [
      "source-record-matches-original-request",
      "source-record-matches-agent-visible-task",
      "repository-source-is-immutable",
      "source-record-covers-every-stage",
      "upstream-receipt-matches-every-stage",
      "relationship-receipt-proves-created-merge-created-order",
      "relationship-receipt-proves-prior-merge-ancestry",
      "prior-completion-semantically-implements-prior-request",
      "later-request-has-concrete-prior-task-dependency",
    ],
    schemaVersion: 5,
    task: "independent-task-origin-and-relationship-review-v5",
  });
  const reviewedEpisodeIdsSha256 = sha256(JSON.stringify(
    reviewedEpisodes.map((episode) => episode.episodeId),
  ));
  const relationshipDecisions = reviewedEpisodes.flatMap((episode) =>
    episode.relationshipReceipts.map((relationship) => ({
      decision: "accepted" as const,
      dependencyBasis: "prior-introduced-behavior" as const,
      edgeId: relationship.edgeId,
      episodeId: episode.episodeId,
      laterRequestDependsOnPriorTask: true,
      priorCompletionMatchesPriorRequest: true,
      rationale:
        "Fixture reviewer accepted the exact prior completion and later dependency.",
      relationshipReceiptSha256: relationship.sha256,
    }))
  );
  if (
    input.relationshipReviewMutation === "receipt-hash-drift" &&
    relationshipDecisions[0] !== undefined
  ) {
    relationshipDecisions[0] = {
      ...relationshipDecisions[0],
      relationshipReceiptSha256: SHA_A,
    };
  }
  const responseBytes = canonicalJson({
    blockingFindings: [],
    datasetId: dataset.datasetId,
    decision: "accepted",
    inputSha256: sha256(inputBytes),
    requestSha256: sha256(requestBytes),
    relationshipDecisions,
    reviewedAt,
    reviewedEpisodeCount: reviewedEpisodes.length,
    reviewedEpisodeIdsSha256,
    reviewerAgentName: input.reviewerAgentName,
    schemaVersion: 5,
  });
  const dispatchBytes = canonicalJson({
    authorTaskName,
    contextPolicy: "fork-turns-none",
    input: artifactReference(inputPath, inputBytes),
    request: artifactReference(requestPath, requestBytes),
    requestedTaskName: "c6_task_origin_review_v5",
    responsePath,
    reviewerAgentName: input.reviewerAgentName,
    schemaVersion: 5,
  });
  const inputReference = detachArtifactReference(
    "input",
    artifactReference(inputPath, inputBytes),
    input.detachedArtifact,
  );
  const requestReference = detachArtifactReference(
    "request",
    artifactReference(requestPath, requestBytes),
    input.detachedArtifact,
  );
  const dispatchReference = detachArtifactReference(
    "dispatch",
    artifactReference(dispatchPath, dispatchBytes),
    input.detachedArtifact,
  );
  const responseReference = detachArtifactReference(
    "response",
    artifactReference(responsePath, responseBytes),
    input.detachedArtifact,
  );
  const provenanceBytes = canonicalJson({
    authorTaskName,
    dispatch: dispatchReference,
    input: inputReference,
    recordedAt: reviewedAt,
    request: requestReference,
    response: responseReference,
    reviewer: {
      agentName: input.reviewerAgentName,
      contextPolicy: "fork-turns-none",
      orchestratorAttestation: {
        attestedByTaskName: authorTaskName,
        basis: "orchestrator-observed-dispatch-no-cryptographic-receipt",
        cryptographicReceipt: false,
      },
      requestedTaskName: "c6_task_origin_review_v5",
      type: "independent-ai-agent",
    },
    schemaVersion: 5,
  });
  const files = [
    { bytes: inputBytes, path: inputPath },
    { bytes: requestBytes, path: requestPath },
    { bytes: dispatchBytes, path: dispatchPath },
    { bytes: responseBytes, path: responsePath },
    { bytes: provenanceBytes, path: provenancePath },
  ];
  return {
    files,
    provenance: {
      bytes: provenanceBytes,
      path: provenancePath,
    },
  };
}

function detachArtifactReference<T extends {
  sha256: string;
}>(
  name: "dispatch" | "input" | "request" | "response",
  reference: T,
  detachedArtifact:
    | "dispatch"
    | "input"
    | "request"
    | "response"
    | undefined,
): T {
  return name === detachedArtifact
    ? { ...reference, sha256: SHA_A }
    : reference;
}

function artifactReference(path: string, bytes: string) {
  return {
    byteLength: Buffer.byteLength(bytes),
    path,
    sha256: sha256(bytes),
  };
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function goldFor(index: number): string {
  return [
    "diff --git a/src/task.ts b/src/task.ts",
    "--- a/src/task.ts",
    "+++ b/src/task.ts",
    "@@ -1 +1 @@",
    "-export const currentValue = 'base';",
    `+export const currentValue = 'gold-secret-value-${index}';`,
    "",
  ].join("\n");
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
