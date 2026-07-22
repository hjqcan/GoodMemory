import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  persistC5EvidenceVerification,
  projectC5RunEvidence,
  runC5EvidenceGate,
  serializeC5EvidenceVerification,
  verifyC5EvidenceProjection,
} from "../../../scripts/codex-coding-effect/c5-evidence";
import type {
  C5EvidenceProjectionManifest,
} from "../../../scripts/codex-coding-effect/c5-evidence";
import type {
  C5LongitudinalPairResult,
  C5RecordedStageExecution,
} from "../../../scripts/codex-coding-effect/c5-longitudinal";
import {
  serializeC5PilotPlan,
} from "../../../scripts/codex-coding-effect/c5-pilot-plan";
import type {
  C5PilotArm,
  C5PilotEpisodeArmRun,
  C5PilotPlan,
  C5PilotStageRun,
} from "../../../scripts/codex-coding-effect/c5-pilot-plan";
import {
  buildC5PilotReport,
  serializeC5PilotReport,
} from "../../../scripts/codex-coding-effect/c5-reporting";
import {
  buildC5IndependentReviewDispatch,
  buildC5IndependentReviewProvenance,
  buildC5IndependentReviewSpawnMessage,
  buildC5ReviewInputBundle,
  buildC5ReviewRequest,
  serializeC5ReviewArtifact,
} from "../../../scripts/codex-coding-effect/c5-review-artifacts";
import {
  c4RepositoryIdForUrl,
  materializeC4SourceRepository,
} from "../../../scripts/codex-coding-effect/c4-controlled-dataset";
import { buildC4BaselinePrompt } from "../../../scripts/codex-coding-effect/c4-baseline-ceiling";
import { buildC3HostConfigurationEvidence } from "../../../scripts/codex-coding-effect/c3-host-configuration";
import type {
  C4HiddenArtifact,
  C4LeakageSurface,
} from "../../../scripts/codex-coding-effect/c4-leakage";
import { buildC5StageLeakageInput } from "../../../scripts/codex-coding-effect/c5-leakage-input";
import {
  hashC5ComparableHostEnvironment,
  parseC5HostEnvironment,
} from "../../../scripts/codex-coding-effect/c5-host-environment";
import {
  auditC5LiveLeakageSurfaces,
} from "../../../scripts/codex-coding-effect/c5-live-leakage";
import { loadCodexCodingEffectDataset } from "../../../scripts/codex-coding-effect/dataset";
import { loadC5PilotReadiness } from "../../../scripts/codex-coding-effect/c5-readiness";
import {
  withAcceptedC4ReadinessFixture,
} from "../../support/codex-coding-effect-c4-readiness-fixture";

const SHA = "a".repeat(64);
const GIT_OBJECT = "b".repeat(40);
const GENERATED_AT = "2026-07-16T00:00:00.000Z";
const RUN_ID = "c5-evidence-fixture";
setDefaultTimeout(300_000);
const REQUIRED_ALIAS_LABELS = [
  "current-runtime-auth",
  "evaluator-runner",
  "gold-patch",
  "installed-package",
  "other-arm-workspace",
  "source-auth",
] as const;
describe("Codex coding-effect C5 evidence closure", () => {
  it("projects the complete sanitized allowlist and accepts independent verification plus review gate", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-evidence-"));
    try {
      const fixture = await createRawFixture(root);
      const projection = join(root, "projection");
      const manifest = await projectC5RunEvidence({
        outputDirectory: projection,
        rawRunDirectory: fixture.raw,
      });

      expect(manifest.files).toHaveLength(394);
      expect(manifest.files.some((file) => file.path.endsWith("agent.patch")))
        .toBe(true);
      expect(manifest.files.some((file) =>
        file.path.endsWith("codex-rollout.sanitized.jsonl")
      )).toBe(true);
      expect(manifest.files.some((file) =>
        file.path.endsWith("permission-isolation-preflight.json")
      )).toBe(false);
      expect(manifest.files.some((file) =>
        file.path.includes("auth.json") ||
        file.path.includes("raw-transcript") ||
        file.path === "evaluator/runner.ts"
      )).toBe(false);

      const verification = await verifyC5EvidenceProjection({
        projectionDirectory: projection,
      });
      expect(verification).toMatchObject({
        checks: {
          actualFileHashesVerified: true,
          exactPlanTopologyVerified: true,
          hostPreflightVerified: true,
          noInfrastructureFailure: true,
          noLeakageRejection: true,
          noMemoryChannelFailure: true,
          noSilentFallback: true,
          reportRecomputed: true,
        },
        counts: {
          hostPreflights: 12,
          opaqueProcessOnlyTrajectoryOrigins: 36,
          pairs: 36,
          projectedFiles: 394,
          stageExecutions: 72,
          taskAliasAudits: 24,
        },
        decision: "accepted",
        externalAuthenticityVerified: false,
        publicClaimEligible: false,
        runId: RUN_ID,
      });
      const verificationPath = join(projection, "c5-verification.json");
      await persistC5EvidenceVerification({
        path: verificationPath,
        verification,
      });
      await writeReviewArtifacts({ manifest, projection, verification });

      const gate = await runC5EvidenceGate({ projectionDirectory: projection });
      expect(gate).toMatchObject({
        decision: "accepted",
        publicClaimEligible: false,
        publicCodingEffectProof: false,
        reasons: [],
        runId: RUN_ID,
      });
      expect(gate.independentReviewSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(gate.reviewProvenanceSha256).toMatch(/^[a-f0-9]{64}$/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects normalized host configuration drift across clusters after rebinding local receipts", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-host-drift-"));
    try {
      const fixture = await createRawFixture(root);
      const cluster = fixture.plan.clusters[0]!;
      const preflightPath = join(
        fixture.raw,
        "trajectories",
        clusterDigest(cluster.id),
        "host-preflight.sanitized.json",
      );
      const preflight = JSON.parse(await readFile(preflightPath, "utf8")) as {
        hostEnvironment: ReturnType<typeof c5HostEnvironment>;
        hostIdentity: Record<string, unknown> & {
          comparableHostEnvironmentSha256: string;
        };
        hostIdentitySha256: string;
      };
      const installed =
        preflight.hostEnvironment.configurations.arms.goodmemoryInstalled;
      const configurations = buildC3HostConfigurationEvidence({
        goodmemoryInstalled: {
          ...installed,
          goodmemoryConfig: {
            ...installed.goodmemoryConfig!,
            normalizedText: '{"writebackMode":"disabled"}',
          },
        },
        noMemory: preflight.hostEnvironment.configurations.arms.noMemory,
      });
      const driftedEnvironment = parseC5HostEnvironment({
        ...preflight.hostEnvironment,
        configurations,
      });
      preflight.hostEnvironment = driftedEnvironment;
      preflight.hostIdentity.comparableHostEnvironmentSha256 =
        hashC5ComparableHostEnvironment(driftedEnvironment);
      preflight.hostIdentitySha256 = sha256(
        JSON.stringify(preflight.hostIdentity),
      );
      await writeJson(preflightPath, preflight);

      await expect(projectC5RunEvidence({
        outputDirectory: join(root, "projection"),
        rawRunDirectory: fixture.raw,
      })).rejects.toThrow("host identity drifted across the 12 cluster preflights");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a post-projection mutation of the actual agent patch", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-patch-mutation-"));
    try {
      const fixture = await createRawFixture(root);
      const projection = join(root, "projection");
      const manifest = await projectC5RunEvidence({
        outputDirectory: projection,
        rawRunDirectory: fixture.raw,
      });
      const patchPath = manifest.files.find((file) =>
        file.path.endsWith("agent.patch")
      )!.path;
      await writeFile(join(projection, ...patchPath.split("/")), "mutated\n");

      const verification = await verifyC5EvidenceProjection({
        projectionDirectory: projection,
      });
      expect(verification.decision).toBe("rejected");
      expect(verification.reasons.join(" ")).toContain("hash mismatch");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("projects a fully accounted infrastructure failure without survivor filtering", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-failure-evidence-"));
    try {
      const fixture = await createRawFixture(root);
      await makeFirstInstalledStageFail(fixture);
      const projection = join(root, "projection");
      const manifest = await projectC5RunEvidence({
        outputDirectory: projection,
        rawRunDirectory: fixture.raw,
      });
      const verification = await verifyC5EvidenceProjection({
        projectionDirectory: projection,
      });

      expect(manifest.files).toHaveLength(394);
      expect(verification.decision).toBe("accepted");
      expect(verification.checks.noInfrastructureFailure).toBe(false);
      expect(verification.checks.noMemoryChannelFailure).toBe(false);
      expect(verification.counts.stageExecutions).toBe(72);
      expect(verification.counts.pairs).toBe(36);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("projects and independently verifies interrupted resume attempts", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-resume-evidence-"));
    try {
      const fixture = await createRawFixture(root);
      await addInterruptedAttempt(fixture);
      const projection = join(root, "projection");
      const manifest = await projectC5RunEvidence({
        outputDirectory: projection,
        rawRunDirectory: fixture.raw,
      });
      const verification = await verifyC5EvidenceProjection({
        projectionDirectory: projection,
      });

      expect(manifest.files).toHaveLength(395);
      expect(manifest.files.some((file) =>
        file.path.endsWith("attempt.sanitized.json")
      )).toBe(true);
      expect(verification.decision).toBe("accepted");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("projects a pre-cluster interrupted attempt with no partial artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-pre-cluster-evidence-"));
    try {
      const fixture = await createRawFixture(root);
      await addInterruptedAttempt(fixture, { empty: true });
      const projection = join(root, "projection");
      const manifest = await projectC5RunEvidence({
        outputDirectory: projection,
        rawRunDirectory: fixture.raw,
      });
      const verification = await verifyC5EvidenceProjection({
        projectionDirectory: projection,
      });

      expect(manifest.files).toHaveLength(395);
      expect(verification.decision).toBe("accepted");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects required recall outside the isolated pre-stage export", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-recall-binding-"));
    try {
      const fixture = await createRawFixture(root);
      const run = fixture.plan.episodeArmRuns.find((candidate) =>
        candidate.arm === "goodmemory-installed" &&
        candidate.stages.some((stage) => stage.memoryExpectation === "required")
      )!;
      const stage = run.stages.find((candidate) =>
        candidate.memoryExpectation === "required"
      )!;
      await replaceHostCanaryRecall(fixture, run, stage, "not-written-by-stop");

      await expect(projectC5RunEvidence({
        outputDirectory: join(root, "projection"),
        rawRunDirectory: fixture.raw,
      })).rejects.toThrow(/prior native Stop|memory export|recall/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects an effective prompt receipt that drifted from the asset-locked fixture", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-prompt-binding-"));
    try {
      const fixture = await createRawFixture(root);
      const run = fixture.plan.episodeArmRuns.find((candidate) =>
        candidate.arm === "goodmemory-installed"
      )!;
      const stage = run.stages[0]!;
      const stagePath = join(
        fixture.raw,
        "trajectories",
        clusterDigest(run.clusterId),
        run.arm,
        stage.stageId,
        "stage-execution.sanitized.json",
      );
      const evidence = JSON.parse(await readFile(stagePath, "utf8")) as Record<
        string,
        unknown
      >;
      evidence.effectivePromptSha256 = "c".repeat(64);
      await writeJson(stagePath, evidence);
      await rebindStageEvidenceAndReport(fixture, stage.id, stagePath);

      await expect(projectC5RunEvidence({
        outputDirectory: join(root, "projection"),
        rawRunDirectory: fixture.raw,
      })).rejects.toThrow(/prompt drifted from the frozen dataset/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a plan whose projected C4 prerequisite evidence is mutated", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-c4-prerequisite-"));
    try {
      const fixture = await createRawFixture(root);
      const prerequisitePath = join(
        fixture.raw,
        "c4-prerequisite-evidence.json",
      );
      const prerequisite = JSON.parse(
        await readFile(prerequisitePath, "utf8"),
      ) as { c4ReadinessReportBytes: string };
      const readiness = JSON.parse(prerequisite.c4ReadinessReportBytes) as {
        status: string;
      };
      readiness.status = "rejected";
      prerequisite.c4ReadinessReportBytes = `${JSON.stringify(
        readiness,
        null,
        2,
      )}\n`;
      await writeJson(prerequisitePath, prerequisite);

      await expect(projectC5RunEvidence({
        outputDirectory: join(root, "projection"),
        rawRunDirectory: fixture.raw,
      })).rejects.toThrow(/C4 readiness|prerequisite/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects raw evidence when alias isolation or live leakage is mutated", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-raw-mutation-"));
    try {
      const fixture = await createRawFixture(root);
      const alias = fixture.plan.episodeArmRuns[0]!;
      const aliasPath = join(
        fixture.raw,
        "trajectories",
        clusterDigest(alias.clusterId),
        alias.arm,
        "task-alias-isolation.json",
      );
      const aliasEvidence = JSON.parse(await readFile(aliasPath, "utf8")) as {
        aliases: Array<{ denied: boolean }>;
      };
      aliasEvidence.aliases[0]!.denied = false;
      await writeJson(aliasPath, aliasEvidence);

      await expect(projectC5RunEvidence({
        outputDirectory: join(root, "rejected-alias"),
        rawRunDirectory: fixture.raw,
      })).rejects.toThrow(/hash mismatch|alias-isolation/u);

      const cleanRoot = join(root, "clean-second");
      const second = await createRawFixture(cleanRoot);
      const cluster = second.plan.clusters[0]!;
      const stage = second.plan.episodeArmRuns.find((run) =>
        run.clusterId === cluster.id
      )!.stages[0]!;
      const leakagePath = join(
        second.raw,
        "pairs",
        clusterDigest(cluster.id),
        stage.stageId,
        "live-leakage-audit.json",
      );
      const leakage = JSON.parse(await readFile(leakagePath, "utf8")) as {
        status: string;
      };
      leakage.status = "rejected";
      await writeJson(leakagePath, leakage);
      await expect(projectC5RunEvidence({
        outputDirectory: join(root, "rejected-leakage"),
        rawRunDirectory: second.raw,
      })).rejects.toThrow(/rejected|leakage/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects schema v5 leakage provenance mutations after rebinding the evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-leakage-v2-"));
    try {
      const fixture = await createRawFixture(root);
      const target = await readLeakageTarget(fixture, 2);
      const mutations: Array<{
        mutate(audit: Record<string, unknown>): void;
        name: string;
        reason: RegExp;
      }> = [
        {
          mutate: (audit) => {
            audit.schemaVersion = 1;
          },
          name: "schema-downgrade",
          reason: /incompletely audited/u,
        },
        {
          mutate: (audit) => {
            audit.fullMatrixAuditSha256 = "c".repeat(64);
          },
          name: "full-matrix-hash",
          reason: /full matrix receipt hash/u,
        },
        {
          mutate: (audit) => {
            const matrix = audit.fullMatrixAuditReceipt as Record<
              string,
              unknown
            >;
            const fullCell = (matrix.cells as Array<Record<string, unknown>>)
              .find((cell) =>
                cell.surfaceId === "goodmemory-export-after-seeding" &&
                cell.artifactId === "gold-patches"
              )!;
            const liveCell = (audit.liveCells as Array<Record<string, unknown>>)
              .find((cell) =>
                cell.surfaceId === fullCell.surfaceId &&
                cell.artifactId === fullCell.artifactId
              )!;
            fullCell.candidateFragmentCount =
              Number(fullCell.candidateFragmentCount) + 1;
            liveCell.candidateFragmentCount = fullCell.candidateFragmentCount;
            bindMatrixAuditHash(matrix);
            audit.fullMatrixAuditSha256 = matrix.auditSha256;
          },
          name: "coherent-full-matrix-receipt",
          reason: /live matrix drifted from frozen artifacts/u,
        },
        {
          mutate: (audit) => {
            audit.trajectoryOriginAuditSha256 = "c".repeat(64);
          },
          name: "trajectory-audit-hash",
          reason: /trajectory-origin audit hash/u,
        },
        {
          mutate: (audit) => {
            const origins = audit.trajectoryOrigins as Array<
              Record<string, unknown>
            >;
            origins[0]!.id = `${target.stage.stageId}:effective-prompt`;
          },
          name: "current-stage-origin",
          reason: /trajectory origin receipt/u,
        },
        {
          mutate: (audit) => {
            const origins = audit.trajectoryOrigins as Array<
              Record<string, unknown>
            >;
            origins.find((origin) =>
              String(origin.id).endsWith(":effective-prompt")
            )!.sha256 = "c".repeat(64);
          },
          name: "prompt-hash",
          reason: /trajectory origin receipt/u,
        },
        {
          mutate: (audit) => {
            const origins = audit.trajectoryOrigins as Array<
              Record<string, unknown>
            >;
            origins.find((origin) =>
              String(origin.id).endsWith(":agent-patch")
            )!.sha256 = "c".repeat(64);
          },
          name: "patch-hash",
          reason: /trajectory origin receipt/u,
        },
        {
          mutate: (audit) => {
            const origins = audit.trajectoryOrigins as Array<
              Record<string, unknown>
            >;
            origins.find((origin) =>
              String(origin.id).endsWith(":codex-jsonl-output")
            )!.sha256 = "c".repeat(64);
          },
          name: "codex-output-hash-binding",
          reason: /not bound/u,
        },
        {
          mutate: (audit) => {
            const origins = audit.trajectoryOrigins as Array<
              Record<string, unknown>
            >;
            const index = origins.findIndex((origin) =>
              String(origin.id).endsWith(":codex-jsonl-output")
            );
            origins.splice(index, 1);
            audit.trajectoryOriginAuditSha256 = sha256(JSON.stringify(origins));
          },
          name: "missing-codex-output-origin",
          reason: /receipts are incomplete/u,
        },
        {
          mutate: (audit) => {
            const origins = audit.trajectoryOrigins as Array<
              Record<string, unknown>
            >;
            const origin = origins.find((candidate) =>
              String(candidate.id).endsWith(":codex-jsonl-output")
            )!;
            const matrix = origin.matrixAuditReceipt as Record<string, unknown>;
            const cell = (matrix.cells as Array<Record<string, unknown>>)
              .find((candidate) =>
                candidate.surfaceId === "effective-codex-input-after-seeding"
              )!;
            cell.candidateFragmentCount = Number(cell.candidateFragmentCount) + 1;
            bindMatrixAuditHash(matrix);
            audit.trajectoryOriginAuditSha256 = sha256(JSON.stringify(origins));
          },
          name: "codex-output-origin-matrix",
          reason: /drifted from frozen artifacts/u,
        },
        {
          mutate: (audit) => {
            const origins = audit.trajectoryOrigins as Array<
              Record<string, unknown>
            >;
            const matrix = origins[0]!.matrixAuditReceipt as Record<
              string,
              unknown
            >;
            const cell = (matrix.cells as Array<Record<string, unknown>>)[0]!;
            cell.candidateFragmentCount = Number(cell.candidateFragmentCount) + 1;
            bindMatrixAuditHash(matrix);
            audit.trajectoryOriginAuditSha256 = sha256(JSON.stringify(origins));
          },
          name: "origin-matrix-receipt",
          reason: /matrix was not recomputed/u,
        },
        {
          mutate: (audit) => {
            const cell = (audit.liveCells as Array<Record<string, unknown>>)[0]!;
            cell.exactOverlapCount = 1;
            cell.matchedFragmentSha256 = ["c".repeat(64)];
            cell.status = "rejected";
            audit.liveOverlapCount = 1;
          },
          name: "partition",
          reason: /live matrix claims an unknown candidate/u,
        },
        {
          mutate: (audit) => {
            audit.trajectoryOriginOverlapCount = 1;
          },
          name: "origin-count",
          reason: /leakage result/u,
        },
        {
          mutate: (audit) => {
            const digest = "c".repeat(64);
            const cell = (audit.liveCells as Array<Record<string, unknown>>)[0]!;
            cell.exactOverlapCount = 1;
            cell.matchedFragmentSha256 = [digest];
            cell.provenanceStatus = "rejected";
            cell.status = "rejected";
            cell.unexplainedMatchSha256 = [digest];
            audit.liveOverlapCount = 1;
            audit.unexplainedLiveOverlapCount = 1;
          },
          name: "accepted-unexplained-overlap",
          reason: /unknown candidate|leakage cell|leakage result/u,
        },
      ];

      for (const mutation of mutations) {
        const audit = JSON.parse(JSON.stringify(target.audit)) as Record<
          string,
          unknown
        >;
        mutation.mutate(audit);
        bindAuditHash(audit);
        await replaceLeakageEvidence(fixture, target, audit);
        await expect(projectC5RunEvidence({
          outputDirectory: join(root, `projection-${mutation.name}`),
          rawRunDirectory: fixture.raw,
        })).rejects.toThrow(mutation.reason);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 600_000);

  it("accepts a strictly bound schema v5 infrastructure-rejected leakage variant", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-leakage-failure-"));
    try {
      const fixture = await createRawFixture(root);
      const target = await readLeakageTarget(fixture, 2);
      const audit: Record<string, unknown> = {
        failureReasonSha256: sha256("host canary did not produce live surfaces"),
        schemaVersion: 5,
        status: "rejected",
        variant: "infrastructure-rejected",
      };
      bindAuditHash(audit);
      await replaceLeakageEvidence(fixture, target, audit, true);

      const projection = join(root, "projection");
      await projectC5RunEvidence({
        outputDirectory: projection,
        rawRunDirectory: fixture.raw,
      });
      const verification = await verifyC5EvidenceProjection({
        projectionDirectory: projection,
      });
      expect(verification.decision).toBe("accepted");
      expect(verification.checks.noLeakageRejection).toBe(false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a missing scheduled attempt before creating a projection", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-missing-attempt-"));
    try {
      const fixture = await createRawFixture(root);
      const ledgerPath = join(fixture.raw, "stage-executions.jsonl");
      const rows = (await readFile(ledgerPath, "utf8")).trim().split("\n");
      await writeText(ledgerPath, `${rows.slice(1).join("\n")}\n`);

      await expect(projectC5RunEvidence({
        outputDirectory: join(root, "projection"),
        rawRunDirectory: fixture.raw,
      })).rejects.toThrow("cluster commit is not bound");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a sanitized rollout that no longer matches its host-canary hash", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-rollout-mutation-"));
    try {
      const fixture = await createRawFixture(root);
      const run = fixture.plan.episodeArmRuns.find((candidate) =>
        candidate.arm === "goodmemory-installed"
      )!;
      const stage = run.stages[0]!;
      const rolloutPath = join(
        fixture.raw,
        "trajectories",
        clusterDigest(run.clusterId),
        run.arm,
        stage.stageId,
        "host-canary",
        "codex-rollout.sanitized.jsonl",
      );
      await writeText(
        rolloutPath,
        `${await readFile(rolloutPath, "utf8")}{"mutated":true}\n`,
      );

      await expect(projectC5RunEvidence({
        outputDirectory: join(root, "projection"),
        rawRunDirectory: fixture.raw,
      })).rejects.toThrow("sanitized transcript hash");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects single-sided live-source receipt mutations after rebinding outer evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-source-receipts-"));
    try {
      const fixture = await createRawFixture(root);
      const run = fixture.plan.episodeArmRuns.find((candidate) =>
        candidate.arm === "goodmemory-installed" &&
        candidate.stages.some((stage) => stage.memoryExpectation === "required")
      )!;
      const stage = run.stages.find((candidate) =>
        candidate.memoryExpectation === "required"
      )!;
      const stageRoot = join(
        fixture.raw,
        "trajectories",
        clusterDigest(run.clusterId),
        run.arm,
        stage.stageId,
      );
      const canaryPath = join(
        stageRoot,
        "host-canary",
        "host-canary.sanitized.json",
      );
      const stagePath = join(stageRoot, "stage-execution.sanitized.json");
      const leakageTarget = {
        clusterId: run.clusterId,
        path: join(
          fixture.raw,
          "pairs",
          clusterDigest(run.clusterId),
          stage.stageId,
          "live-leakage-audit.json",
        ),
        stage,
      };
      const originalCanary = JSON.parse(
        await readFile(canaryPath, "utf8"),
      ) as Record<string, unknown>;
      const originalAudit = JSON.parse(
        await readFile(leakageTarget.path, "utf8"),
      ) as Record<string, unknown>;
      const mutations: Array<{
        mutate(input: {
          audit: Record<string, unknown>;
          canary: Record<string, unknown>;
        }): "audit" | "canary";
        name: string;
        reason: RegExp;
      }> = [
        {
          mutate: ({ canary }) => {
            const result = canary.canary as Record<string, unknown>;
            const contexts = result.hookContexts as Array<Record<string, unknown>>;
            contexts[0]!.contentHash = `content:${"c".repeat(24)}`;
            return "canary";
          },
          name: "hook-content-hash",
          reason: /hook context hash is not derived/u,
        },
        {
          mutate: ({ canary }) => {
            const receipts = canary.sourceReceipts as Record<string, unknown>;
            const injection = receipts.injection as Record<string, unknown>;
            injection.sourceSha256 = "c".repeat(64);
            return "canary";
          },
          name: "injection-source-binding",
          reason: /injection source receipt is not bound/u,
        },
        {
          mutate: ({ canary }) => {
            const receipts = canary.sourceReceipts as Record<string, unknown>;
            const memoryExport = receipts.memoryExport as Record<string, unknown>;
            memoryExport.semanticSurfaceCommitmentSha256 = "c".repeat(64);
            return "canary";
          },
          name: "memory-export-semantic-commitment",
          reason: /live semantic surface is not source-bound/u,
        },
        {
          mutate: ({ canary }) => {
            const receipts = canary.sourceReceipts as Record<string, unknown>;
            const memoryExport = receipts.memoryExport as Record<string, unknown>;
            memoryExport.recordIds = [];
            return "canary";
          },
          name: "memory-export-missing-stop-lineage",
          reason: /prior-memory lineage|prior native Stop/u,
        },
        {
          mutate: ({ audit }) => {
            const receipts = audit.liveSurfaceReceipts as Array<
              Record<string, unknown>
            >;
            const exported = receipts.find((receipt) =>
              receipt.id === "goodmemory-export-after-seeding"
            )!;
            exported.utf8Bytes = Number(exported.utf8Bytes) + 1;
            return "audit";
          },
          name: "memory-export-byte-length",
          reason: /live surface claims drifted from host receipts/u,
        },
      ];

      for (const mutation of mutations) {
        const canary = JSON.parse(JSON.stringify(originalCanary)) as Record<
          string,
          unknown
        >;
        const audit = JSON.parse(JSON.stringify(originalAudit)) as Record<
          string,
          unknown
        >;
        const target = mutation.mutate({ audit, canary });
        if (target === "canary") {
          await writeJson(canaryPath, canary);
          await rebindHostCanaryEvidence(fixture, stage.id, stagePath, canaryPath);
        } else {
          bindAuditHash(audit);
          await replaceLeakageEvidence(fixture, leakageTarget, audit);
        }
        await expect(projectC5RunEvidence({
          outputDirectory: join(root, `projection-${mutation.name}`),
          rawRunDirectory: fixture.raw,
        })).rejects.toThrow(mutation.reason);

        await writeJson(canaryPath, originalCanary);
        await rebindHostCanaryEvidence(fixture, stage.id, stagePath, canaryPath);
        await replaceLeakageEvidence(fixture, leakageTarget, originalAudit);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects forbidden files injected into an otherwise valid projection", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-forbidden-file-"));
    try {
      const fixture = await createRawFixture(root);
      const projection = join(root, "projection");
      await projectC5RunEvidence({
        outputDirectory: projection,
        rawRunDirectory: fixture.raw,
      });
      await writeText(join(projection, "auth.json"), "forbidden-secret\n");

      const verification = await verifyC5EvidenceProjection({
        projectionDirectory: projection,
      });
      expect(verification.decision).toBe("rejected");
      expect(verification.reasons.join(" ")).toContain("unsupported file");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects runner-source drift and independently recomputed report drift", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-report-drift-"));
    try {
      const runnerFixture = await createRawFixture(join(root, "runner"));
      const postPath = join(
        runnerFixture.raw,
        "runner-source-state-post-run.json",
      );
      const post = JSON.parse(await readFile(postPath, "utf8")) as {
        files: Array<{ bytes: number }>;
      };
      post.files[0]!.bytes += 1;
      await writeJson(postPath, post);
      await expect(projectC5RunEvidence({
        outputDirectory: join(root, "runner-projection"),
        rawRunDirectory: runnerFixture.raw,
      })).rejects.toThrow("runner source changed");

      const reportFixture = await createRawFixture(join(root, "report"));
      const reportPath = join(reportFixture.raw, "report.json");
      const report = JSON.parse(await readFile(reportPath, "utf8")) as {
        attempts: { accountedCount: number };
      };
      report.attempts.accountedCount = 71;
      await writeJson(reportPath, report);
      await expect(projectC5RunEvidence({
        outputDirectory: join(root, "report-projection"),
        rawRunDirectory: reportFixture.raw,
      })).rejects.toThrow("report attempts");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects review provenance when author and reviewer are not independent", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-review-mutation-"));
    try {
      const fixture = await createRawFixture(root);
      const projection = join(root, "projection");
      const manifest = await projectC5RunEvidence({
        outputDirectory: projection,
        rawRunDirectory: fixture.raw,
      });
      const verification = await verifyC5EvidenceProjection({
        projectionDirectory: projection,
      });
      await persistC5EvidenceVerification({
        path: join(projection, "c5-verification.json"),
        verification,
      });
      await writeReviewArtifacts({ manifest, projection, verification });
      const provenancePath = join(projection, "review", "provenance.json");
      const provenance = JSON.parse(
        await readFile(provenancePath, "utf8"),
      ) as {
        authorTaskName: string;
        reviewer: { agentName: string };
      };
      provenance.authorTaskName = provenance.reviewer.agentName;
      await writeJson(provenancePath, provenance);

      const gate = await runC5EvidenceGate({ projectionDirectory: projection });
      expect(gate.decision).toBe("rejected");
      expect(gate.reasons.join(" ")).toContain("must differ");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

async function createRawFixture(root: string): Promise<{
  plan: C5PilotPlan;
  raw: string;
}> {
  const raw = join(root, "raw");
  await mkdir(raw, { recursive: true });
  const loaded = await loadCodexCodingEffectDataset(
    "fixtures/codex-coding-effect/c4-controlled-pilot",
  );
  const readiness = await withAcceptedC4ReadinessFixture((fixture) =>
    loadC5PilotReadiness({
      ...fixture.paths,
      datasetRoot: "fixtures/codex-coding-effect/c4-controlled-pilot",
      materialEffectPercentagePoints: 10,
      orderSeed: 73,
    })
  );
  const plan = readiness.plan;
  if (loaded.dataset.schemaVersion !== 2) {
    throw new Error("C5 evidence fixture requires the v2 controlled dataset");
  }
  const repositoryRoots = new Map<string, string>();
  const leakageInputs = new Map<string, {
    artifacts: C4HiddenArtifact[];
    staticSurfaces: C4LeakageSurface[];
  }>();
  const promptContents = new Map<string, string>();
  for (const episode of loaded.dataset.episodes) {
    let repositoryRoot = repositoryRoots.get(episode.repository.url);
    if (repositoryRoot === undefined) {
      repositoryRoot = join(
        root,
        "fixture-repositories",
        c4RepositoryIdForUrl(episode.repository.url),
      );
      await materializeC4SourceRepository({
        datasetRoot: "fixtures/codex-coding-effect/c4-controlled-pilot",
        destination: repositoryRoot,
        repositoryId: c4RepositoryIdForUrl(episode.repository.url),
      });
      repositoryRoots.set(episode.repository.url, repositoryRoot);
    }
    for (const stage of episode.stages) {
      const key = `${episode.id}/${stage.id}`;
      promptContents.set(key, buildC4BaselinePrompt({
        allowedFeedback: stage.allowedFeedback,
        prompt: await readFile(
          join(
            "fixtures/codex-coding-effect/c4-controlled-pilot",
            stage.promptPath,
          ),
          "utf8",
        ),
      }));
      leakageInputs.set(
        key,
        await buildC5StageLeakageInput({
          datasetRoot: "fixtures/codex-coding-effect/c4-controlled-pilot",
          episode,
          repositoryRoot,
          stage,
        }),
      );
    }
  }
  const planBytes = serializeC5PilotPlan(plan);
  const planSha256 = sha256(planBytes);
  await Promise.all([
    writeText(
      join(raw, "c4-prerequisite-evidence.json"),
      readiness.prerequisiteEvidenceBytes,
    ),
    writeText(join(raw, "pilot-plan.json"), planBytes),
  ]);

  const runnerFiles = [
    "bun.lock",
    "bunfig.toml",
    "package.json",
    "scripts/prepare-codex-coding-effect-c5-pilot.ts",
    "scripts/run-codex-coding-effect-c5-pilot.ts",
    "tsconfig.json",
  ].map((path) => ({
    bytes: 1,
    path,
    sha256: sha256("x"),
    sourceBase64: Buffer.from("x").toString("base64"),
  }));
  const runnerSource = {
    aggregateSha256: sha256(`${JSON.stringify(runnerFiles)}\n`),
    files: runnerFiles,
    schemaVersion: 2,
  };
  await Promise.all([
    writeJson(join(raw, "runner-source-state.json"), runnerSource),
    writeJson(join(raw, "runner-source-state-post-run.json"), runnerSource),
  ]);
  await writeJson(join(raw, "run-identity.json"), {
    claimBoundary: "internal-native-longitudinal-pilot-only",
    evidenceClass: "native-longitudinal-pilot",
    generatedAt: GENERATED_AT,
    host: "codex",
    model: "gpt-test",
    mutableRootsSha256: SHA,
    networkAccess: false,
    phase: "C5",
    planSha256,
    publicClaimEligible: false,
    publicCodingEffectProof: false,
    reasoningEffort: "high",
    runId: RUN_ID,
    runnerSourceAggregateSha256: runnerSource.aggregateSha256,
    schemaVersion: 1,
    stageTimeoutMs: 1_000,
    testTimeoutMs: 1_000,
  });

  const stageExecutions: C5RecordedStageExecution[] = [];
  const pairs: C5LongitudinalPairResult[] = [];
  const hostEnvironment = c5HostEnvironment();
  const hostIdentity = {
    codexExecutableSha256: SHA,
    codexVersion: "codex-test",
    goodMemoryPackageSha256: SHA,
    goodMemoryPackageVersion: "0.6.0",
    comparableHostEnvironmentSha256:
      hashC5ComparableHostEnvironment(hostEnvironment),
    installedProfile: installedProfile(),
    model: "gpt-test",
    reasoningEffort: "high",
  };
  for (const cluster of plan.clusters) {
    const clusterHostEnvironment = withClusterHostConfigurationReceipts(
      hostEnvironment,
      cluster.id,
    );
    const trajectory = join(raw, "trajectories", clusterDigest(cluster.id));
    const runs = plan.episodeArmRuns
      .filter((run) => run.clusterId === cluster.id)
      .sort((first, second) =>
        first.armOrderPosition - second.armOrderPosition
      );
    const armPreflights: Array<Record<string, unknown>> = [];
    for (const run of runs) {
      const armRoot = join(trajectory, run.arm);
      const permission = permissionEvidence();
      const permissionPath = join(
        armRoot,
        "permission-isolation-preflight.sanitized.json",
      );
      await writeJson(permissionPath, permission);
      const alias = aliasEvidence();
      const aliasPath = join(armRoot, "task-alias-isolation.json");
      await writeJson(aliasPath, alias);
      armPreflights.push({
        arm: run.arm,
        instructionSha256: SHA,
        noMemoryAbsence: run.arm === "no-memory"
          ? {
              goodMemoryFileCount: 0,
              hookConfigPresent: false,
              mcpConfigPresent: false,
              passed: true,
              preexistingSessionCount: 0,
            }
          : null,
        permissionIsolationSha256: sha256(
          await readFile(permissionPath, "utf8"),
        ),
        taskAliasIsolationSha256: sha256(await readFile(aliasPath, "utf8")),
      });

      const priorWrittenMemoryIds: string[] = [];
      for (const [stageIndex, stage] of run.stages.entries()) {
        const writebackRequired = priorWrittenMemoryIds.length === 0 &&
          run.stages.slice(stageIndex + 1).some(
            ({ memoryExpectation }) => memoryExpectation === "required",
          );
        const stageRoot = join(armRoot, stage.stageId);
        const threadId = `thread-${stage.stageRunIdentitySha256}`;
        const patch = agentPatchForStage(stage);
        await writeText(join(stageRoot, "agent.patch"), patch);
        let canaryEvidenceSha256: string | null = null;
        const memoryObservation = run.arm === "no-memory"
          ? null
          : memoryObservationFor(stage.memoryExpectation, writebackRequired);
        if (run.arm === "goodmemory-installed") {
          const transcript = sanitizedTranscript(threadId);
          const transcriptPath = join(
            stageRoot,
            "host-canary",
            "codex-rollout.sanitized.jsonl",
          );
          await writeText(transcriptPath, transcript);
          const canary = hostCanaryEvidence({
            effectivePrompt: requiredPrompt(
              promptContents,
              run.episodeId,
              stage.stageId,
            ),
            expectedPriorMemoryIds: priorWrittenMemoryIds,
            memoryExpectation: stage.memoryExpectation,
            sanitizedTranscriptSha256: sha256(transcript),
            stageId: stage.id,
            writebackRequired,
          });
          const canaryPath = join(
            stageRoot,
            "host-canary",
            "host-canary.sanitized.json",
          );
          await writeJson(canaryPath, canary);
          canaryEvidenceSha256 = sha256(await readFile(canaryPath, "utf8"));
          priorWrittenMemoryIds.push(...canary.canary.currentWrittenMemoryIds);
        }
        const executionBasis = {
          arm: run.arm,
          codexDurationMs: 100,
          codexStatus: "completed",
          codexUsage: {
            cachedInputTokens: 10,
            inputTokens: 20,
            outputTokens: 5,
          },
          infrastructureFailureStage: null,
          memoryObservation,
          memoryChannelStatus: run.arm === "no-memory"
            ? "not-applicable" as const
            : "passed" as const,
          stageRunId: stage.id,
          threadId,
        };
        const stageEvidence = {
          canaryEvidenceSha256,
          codex: {
            durationMs: 100,
            eventCount: 2,
            exitCode: 0,
            status: "completed",
            timedOut: false,
            usage: executionBasis.codexUsage,
          },
          effectivePromptSha256: sha256(requiredPrompt(
            promptContents,
            run.episodeId,
            stage.stageId,
          )),
          events: stageEvents({
            arm: run.arm,
            episodeId: run.episodeId,
            repetition: run.repetition,
            seed: plan.randomization.orderSeed,
            stageId: stage.stageId,
            stageRunId: stage.id,
          }),
          execution: executionBasis,
          failureReasonSha256: null,
          patch: {
            changedFiles: ["src/index.ts"],
            forbiddenFiles: [],
            hasPatch: true,
            sha256: sha256(patch),
            untrackedFiles: [],
          },
          permissionIsolationSha256: armPreflights.at(-1)!
            .permissionIsolationSha256,
          schemaVersion: 1,
          visibleBaseHealth: {
            durationMs: 10,
            exitCode: 0,
            passed: true,
            status: "passed",
          },
        };
        const stageEvidencePath = join(
          stageRoot,
          "stage-execution.sanitized.json",
        );
        await writeJson(stageEvidencePath, stageEvidence);
        stageExecutions.push({
          ...executionBasis,
          stageEvidenceSha256: sha256(
            await readFile(stageEvidencePath, "utf8"),
          ),
          clusterId: cluster.id,
          episodeId: run.episodeId,
          repetition: run.repetition,
          stageId: stage.stageId,
        });
      }
    }
    await writeJson(join(trajectory, "host-preflight.sanitized.json"), {
      arms: armPreflights,
      clusterId: cluster.id,
      hostEnvironment: clusterHostEnvironment,
      hostIdentity,
      hostIdentitySha256: sha256(JSON.stringify(hostIdentity)),
      networkAccess: false,
      repository: { commit: GIT_OBJECT, tree: GIT_OBJECT },
      schemaVersion: 2,
    });

    const installedRun = runs.find((run) => run.arm === "goodmemory-installed")!;
    for (const stage of runs[0]!.stages) {
      const pairRoot = join(
        raw,
        "pairs",
        clusterDigest(cluster.id),
        stage.stageId,
      );
      const installedStage = installedRun.stages.find((candidate) =>
        candidate.stageId === stage.stageId
      )!;
      const leakage = leakageEvidence({
        leakageInput: leakageInputs.get(
          `${cluster.episodeId}/${installedStage.stageId}`,
        )!,
        promptContents,
        run: installedRun,
        stage: installedStage,
      });
      await writeJson(join(pairRoot, "live-leakage-audit.json"), leakage);
      const evaluations = [] as C5LongitudinalPairResult["evaluations"];
      for (const arm of ["no-memory", "goodmemory-installed"] as const) {
        const resolved = arm === "goodmemory-installed";
        const reasons = resolved ? [] : ["hidden-fail-to-pass-failed"];
        const evidence = evaluatorEvidence({ arm, reasons, resolved });
        const path = join(pairRoot, `${arm}-evaluation.json`);
        await writeJson(path, evidence);
        evaluations.push({
          arm,
          disposition: "finalized",
          evaluationEvidenceSha256: sha256(await readFile(path, "utf8")),
          resolved,
          taskFailureReasons: reasons,
        });
      }
      pairs.push({
        clusterId: cluster.id,
        comparable: true,
        episodeId: cluster.episodeId,
        evaluations,
        incomparabilityReasons: [],
        leakageAuditSha256: leakage.auditSha256,
        memoryExpectation: stage.memoryExpectation,
        outcome: "rescue",
        repetition: cluster.repetition,
        stageId: stage.stageId,
      });
    }
  }

  await writeText(
    join(raw, "stage-executions.jsonl"),
    `${stageExecutions.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
  await writeText(
    join(raw, "pairs.jsonl"),
    `${pairs.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
  await writeText(
    join(raw, "cluster-commits.jsonl"),
    `${plan.clusters.map((cluster) => JSON.stringify({
      clusterId: cluster.id,
      schemaVersion: 1,
    })).join("\n")}\n`,
  );
  await writeText(join(raw, "run-attempts.jsonl"), "");
  const report = buildC5PilotReport({
    generatedAt: GENERATED_AT,
    plan,
    planSha256,
    result: { pairs, stageExecutions },
    runId: RUN_ID,
  });
  await writeText(join(raw, "report.json"), serializeC5PilotReport(report));

  await Promise.all([
    writeText(join(raw, "auth.json"), "secret-auth-must-not-project\n"),
    writeText(
      join(raw, "raw-transcript.jsonl"),
      '{"raw":"must-not-project"}\n',
    ),
    writeText(
      join(raw, "evaluator", "runner.ts"),
      "throw new Error('hidden evaluator source');\n",
    ),
    writeText(join(raw, "gold.patch"), "hidden gold patch\n"),
    writeText(
      join(
        raw,
        "trajectories",
        clusterDigest(plan.clusters[0]!.id),
        "no-memory",
        "permission-isolation-preflight.json",
      ),
      '{"path":"/private/raw/path"}\n',
    ),
  ]);
  return { plan, raw };
}

async function makeFirstInstalledStageFail(fixture: {
  plan: C5PilotPlan;
  raw: string;
}): Promise<void> {
  const run = fixture.plan.episodeArmRuns.find((item) =>
    item.arm === "goodmemory-installed"
  )!;
  const stage = run.stages[0]!;
  const stagePath = join(
    fixture.raw,
    "trajectories",
    clusterDigest(run.clusterId),
    run.arm,
    stage.stageId,
    "stage-execution.sanitized.json",
  );
  const evidence = JSON.parse(await readFile(stagePath, "utf8")) as Record<
    string,
    unknown
  >;
  const execution = evidence.execution as Record<string, unknown>;
  execution.infrastructureFailureStage = "host-canary";
  execution.memoryChannelStatus = "failed";
  const canaryRoot = join(dirname(stagePath), "host-canary");
  const canaryPath = join(canaryRoot, "host-canary.sanitized.json");
  const transcriptPath = join(canaryRoot, "codex-rollout.sanitized.jsonl");
  const canary = JSON.parse(await readFile(canaryPath, "utf8")) as {
    canary: { memoryChannelStatus: string; passed: boolean; reasons: string[] };
    collectionFailures: unknown[];
    sessionDigest: string;
    sources: {
      sanitizedTranscriptSha256: string;
      transcriptSourceSha256: string | null;
    };
  };
  const errorSha256 = sha256("transcript collection failed");
  const transcript = `${JSON.stringify({
    payload: {
      errorSha256,
      sessionDigest: canary.sessionDigest,
      source: "codex-transcript",
    },
    type: "source_failure",
  })}\n`;
  canary.collectionFailures = [{ errorSha256, source: "codex-transcript" }];
  canary.canary.memoryChannelStatus = "failed";
  canary.canary.passed = false;
  canary.canary.reasons = ["source-collection-failed:codex-transcript"];
  canary.sources.sanitizedTranscriptSha256 = sha256(transcript);
  canary.sources.transcriptSourceSha256 = null;
  await writeText(transcriptPath, transcript);
  await writeJson(canaryPath, canary);
  evidence.canaryEvidenceSha256 = sha256(await readFile(canaryPath, "utf8"));
  evidence.failureReasonSha256 = sha256("source-collection-failed:codex-transcript");
  await writeJson(stagePath, evidence);

  const stageExecutions = (await readFile(
    join(fixture.raw, "stage-executions.jsonl"),
    "utf8",
  )).trim().split("\n").map((line) =>
    JSON.parse(line) as C5RecordedStageExecution
  );
  const recorded = stageExecutions.find((item) => item.stageRunId === stage.id)!;
  Object.assign(recorded, execution, {
    stageEvidenceSha256: sha256(await readFile(stagePath, "utf8")),
  });

  const pairs = (await readFile(join(fixture.raw, "pairs.jsonl"), "utf8"))
    .trim().split("\n").map((line) =>
      JSON.parse(line) as C5LongitudinalPairResult
    );
  const pair = pairs.find((item) =>
    item.clusterId === run.clusterId && item.stageId === stage.stageId
  )!;
  pair.comparable = false;
  pair.incomparabilityReasons = [
    "goodmemory-installed-infrastructure-host-canary",
    ...(stage.memoryExpectation === "required"
      ? ["goodmemory-required-memory-channel-failed"]
      : []),
  ];
  pair.outcome = "incomparable";

  await writeText(
    join(fixture.raw, "stage-executions.jsonl"),
    `${stageExecutions.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
  await writeText(
    join(fixture.raw, "pairs.jsonl"),
    `${pairs.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
  const planBytes = serializeC5PilotPlan(fixture.plan);
  const report = buildC5PilotReport({
    generatedAt: GENERATED_AT,
    plan: fixture.plan,
    planSha256: sha256(planBytes),
    result: { pairs, stageExecutions },
    runId: RUN_ID,
  });
  await writeText(
    join(fixture.raw, "report.json"),
    serializeC5PilotReport(report),
  );
}

async function addInterruptedAttempt(fixture: {
  plan: C5PilotPlan;
  raw: string;
}, options: { empty?: boolean } = {}): Promise<void> {
  const cluster = fixture.plan.clusters.at(-1)!;
  const attemptId = `${clusterDigest(cluster.id)}-attempt-1`;
  const attemptEvidencePath =
    `interrupted-attempts/${attemptId}/attempt.sanitized.json`;
  const stages = (await readFile(
    join(fixture.raw, "stage-executions.jsonl"),
    "utf8",
  )).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  const stage = stages.find((row) => row.clusterId === cluster.id)!;
  const artifactBytes = '{"partial":true}\n';
  const evidence = {
    artifacts: options.empty
      ? []
      : [{
          bytesBase64: Buffer.from(artifactBytes).toString("base64"),
          path: `trajectories/${clusterDigest(cluster.id)}/goodmemory-installed/stage-1/stage-execution.sanitized.json`,
          sha256: sha256(artifactBytes),
        }],
    attemptId,
    clusterId: cluster.id,
    commitTornTail: null,
    disposition: "process-interrupted-before-cluster-commit",
    pairRows: [],
    pairTornTail: null,
    schemaVersion: 1,
    stageRows: options.empty ? [] : [stage],
    stageTornTail: null,
  };
  await writeJson(join(fixture.raw, attemptEvidencePath), evidence);
  const evidenceBytes = await readFile(
    join(fixture.raw, attemptEvidencePath),
    "utf8",
  );
  await writeText(join(fixture.raw, "run-attempts.jsonl"), `${JSON.stringify({
    attemptEvidencePath,
    attemptEvidenceSha256: sha256(evidenceBytes),
    attemptId,
    clusterId: cluster.id,
    disposition: "process-interrupted-before-cluster-commit",
    schemaVersion: 1,
  })}\n`);
}

async function replaceHostCanaryRecall(
  fixture: { plan: C5PilotPlan; raw: string },
  run: C5PilotEpisodeArmRun,
  stage: C5PilotStageRun,
  recalledId: string,
): Promise<void> {
  const stageRoot = join(
    fixture.raw,
    "trajectories",
    clusterDigest(run.clusterId),
    run.arm,
    stage.stageId,
  );
  const canaryPath = join(
    stageRoot,
    "host-canary",
    "host-canary.sanitized.json",
  );
  const canary = JSON.parse(await readFile(canaryPath, "utf8")) as {
    canary: {
      injectedRecordIds: string[];
      recalledPriorMemoryIds: string[];
    };
    sourceReceipts: {
      injection: {
        events: Array<{ decision: string; recordIds: string[] }>;
        injectedRecordIds: string[];
      };
    };
  };
  canary.canary.injectedRecordIds = [recalledId];
  canary.canary.recalledPriorMemoryIds = [recalledId];
  canary.sourceReceipts.injection.injectedRecordIds = [recalledId];
  for (const event of canary.sourceReceipts.injection.events) {
    if (event.decision === "injected" || event.decision === "duplicate_context") {
      event.recordIds = [recalledId];
    }
  }
  await writeJson(canaryPath, canary);

  await rebindHostCanaryEvidence(
    fixture,
    stage.id,
    join(stageRoot, "stage-execution.sanitized.json"),
    canaryPath,
  );
}

async function rebindHostCanaryEvidence(
  fixture: { plan: C5PilotPlan; raw: string },
  stageRunId: string,
  stagePath: string,
  canaryPath: string,
): Promise<void> {
  const evidence = JSON.parse(await readFile(stagePath, "utf8")) as Record<
    string,
    unknown
  >;
  evidence.canaryEvidenceSha256 = sha256(await readFile(canaryPath, "utf8"));
  await writeJson(stagePath, evidence);

  await rebindStageEvidenceAndReport(fixture, stageRunId, stagePath);
}

async function rebindStageEvidenceAndReport(
  fixture: { plan: C5PilotPlan; raw: string },
  stageRunId: string,
  stagePath: string,
): Promise<void> {
  const stagesPath = join(fixture.raw, "stage-executions.jsonl");
  const stages = (await readFile(stagesPath, "utf8")).trim().split("\n")
    .map((row) => JSON.parse(row) as C5RecordedStageExecution);
  stages.find((candidate) => candidate.stageRunId === stageRunId)!
    .stageEvidenceSha256 = sha256(await readFile(stagePath, "utf8"));
  await writeText(
    stagesPath,
    `${stages.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );

  const pairs = (await readFile(join(fixture.raw, "pairs.jsonl"), "utf8"))
    .trim().split("\n").map((row) =>
      JSON.parse(row) as C5LongitudinalPairResult
    );
  const report = buildC5PilotReport({
    generatedAt: GENERATED_AT,
    plan: fixture.plan,
    planSha256: sha256(serializeC5PilotPlan(fixture.plan)),
    result: { pairs, stageExecutions: stages },
    runId: RUN_ID,
  });
  await writeText(
    join(fixture.raw, "report.json"),
    serializeC5PilotReport(report),
  );
}

async function readLeakageTarget(
  fixture: { plan: C5PilotPlan; raw: string },
  position: number,
): Promise<{
  audit: Record<string, unknown>;
  clusterId: string;
  path: string;
  stage: C5PilotStageRun;
}> {
  const cluster = fixture.plan.clusters[0]!;
  const run = fixture.plan.episodeArmRuns.find((candidate) =>
    candidate.clusterId === cluster.id &&
    candidate.arm === "goodmemory-installed"
  )!;
  const stage = run.stages[position - 1]!;
  const path = join(
    fixture.raw,
    "pairs",
    clusterDigest(cluster.id),
    stage.stageId,
    "live-leakage-audit.json",
  );
  return {
    audit: JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>,
    clusterId: cluster.id,
    path,
    stage,
  };
}

async function replaceLeakageEvidence(
  fixture: { plan: C5PilotPlan; raw: string },
  target: { clusterId: string; path: string; stage: C5PilotStageRun },
  audit: Record<string, unknown>,
  accountForRejection = false,
): Promise<void> {
  const auditSha256 = String(audit.auditSha256);
  await writeJson(target.path, audit);
  const pairsPath = join(fixture.raw, "pairs.jsonl");
  const pairs = (await readFile(pairsPath, "utf8")).trim().split("\n")
    .map((row) => JSON.parse(row) as C5LongitudinalPairResult);
  const pair = pairs.find((candidate) =>
    candidate.clusterId === target.clusterId &&
    candidate.stageId === target.stage.stageId
  )!;
  pair.leakageAuditSha256 = auditSha256;
  if (accountForRejection) {
    pair.comparable = false;
    pair.incomparabilityReasons = ["live-leakage-audit-rejected"];
    pair.outcome = "incomparable";
  }
  await writeText(
    pairsPath,
    `${pairs.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
  const stages = (await readFile(
    join(fixture.raw, "stage-executions.jsonl"),
    "utf8",
  )).trim().split("\n").map((row) =>
    JSON.parse(row) as C5RecordedStageExecution
  );
  const planSha256 = sha256(serializeC5PilotPlan(fixture.plan));
  const report = buildC5PilotReport({
    generatedAt: GENERATED_AT,
    plan: fixture.plan,
    planSha256,
    result: { pairs, stageExecutions: stages },
    runId: RUN_ID,
  });
  await writeText(
    join(fixture.raw, "report.json"),
    serializeC5PilotReport(report),
  );
}

function bindAuditHash(audit: Record<string, unknown>): void {
  delete audit.auditSha256;
  audit.auditSha256 = sha256(JSON.stringify(audit));
}

function bindMatrixAuditHash(audit: Record<string, unknown>): void {
  delete audit.auditSha256;
  audit.auditSha256 = sha256(JSON.stringify(audit));
}

function permissionEvidence() {
  return {
    configSha256: SHA,
    deniedReads: Array.from({ length: 12 }, (_, index) => ({
      denied: true,
      exitCode: 1,
      label: `denied-${String(index).padStart(2, "0")}`,
      pathSha256: sha256(`path-${index}`),
    })),
    networkAccess: false,
    networkDenied: true,
    networkPositiveControl: true,
    passed: true,
    phase: "preflight",
    profileName: "c3-task",
    reasons: [],
    schemaVersion: 1,
    workspaceRead: true,
    workspaceWrite: true,
  };
}

function aliasEvidence() {
  return {
    aliases: REQUIRED_ALIAS_LABELS.map((label) => ({
      denied: true,
      exitCode: 1,
      label,
      targetPathSha256: sha256(label),
    })),
    passed: true,
    profileName: "c3-task",
    schemaVersion: 1,
  };
}

function installedProfile() {
  return {
    activationMode: "global",
    hookRegistered: true,
    mcpRegistered: true,
    persistRawTranscript: false,
    retrievalProfile: "coding_agent",
    workspaceStatus: "ok",
    writebackMode: "selective",
  } as const;
}

function memoryObservationFor(
  expectation: "irrelevant-control" | "none" | "required",
  writebackRequired: boolean,
) {
  const required = expectation === "required";
  return {
    injectedRecordCount: required ? 1 : 0,
    irrelevantInjection: false,
    recalledPriorMemoryCount: required ? 1 : 0,
    writebackCommitted: writebackRequired,
    writtenMemoryCount: writebackRequired ? 1 : 0,
  };
}

function sanitizedTranscript(threadId: string): string {
  return [
    JSON.stringify({ payload: { id: threadId }, type: "session_meta" }),
    JSON.stringify({
      payload: {
        content: [{
          length: 10,
          text: "<redacted-user-text>",
          textSha256: SHA,
          type: "input_text",
        }],
        role: "user",
        type: "message",
      },
      type: "response_item",
    }),
    JSON.stringify({
      payload: {
        content: [{
          length: 10,
          text: "<redacted-assistant-text>",
          textSha256: SHA,
          type: "output_text",
        }],
        role: "assistant",
        type: "message",
      },
      type: "response_item",
    }),
  ].join("\n") + "\n";
}

function hostCanaryEvidence(input: {
  effectivePrompt: string;
  expectedPriorMemoryIds: readonly string[];
  memoryExpectation: "irrelevant-control" | "none" | "required";
  sanitizedTranscriptSha256: string;
  stageId: string;
  writebackRequired: boolean;
}) {
  const required = input.memoryExpectation === "required";
  const recalled = required ? [input.expectedPriorMemoryIds[0]!] : [];
  const written = input.writebackRequired ? [`written-${input.stageId}`] : [];
  const hookContext = fixtureHookContext(input.memoryExpectation, input.stageId);
  const contentHashes = hookContext.length === 0
    ? []
    : [`content:${sha256(hookContext).slice(0, 24)}`];
  const sessionDigest = sha256(input.stageId);
  const hookContextReceipts = contentHashes.map((contentHash) => ({
    contentByteLength: Buffer.byteLength(hookContext, "utf8"),
    contentHash,
    contentSha256: sha256(hookContext),
  }));
  const effectiveInputSurfaceSha256 = sha256(
    hookContext.length === 0
      ? input.effectivePrompt
      : `${input.effectivePrompt}\n\n${hookContext}`,
  );
  const effectiveInputComposition = {
    hookContextReceiptSha256: sha256(JSON.stringify(hookContextReceipts)),
    promptSha256: sha256(input.effectivePrompt),
    semanticSurfaceCommitmentSha256: sha256(JSON.stringify([
      hookContext.length === 0
        ? input.effectivePrompt
        : `${input.effectivePrompt}\n\n${hookContext}`,
    ])),
    separatorPolicy: "prompt-then-double-lf-hook-context-v1",
    surfaceSha256: effectiveInputSurfaceSha256,
  };
  return {
    canary: {
      currentWrittenMemoryIds: written,
      hookContexts: hookContextReceipts,
      injectedRecordIds: recalled,
      irrelevantInjection: false,
      memoryChannelStatus: "passed",
      passed: true,
      recalledPriorMemoryIds: recalled,
      reasons: [],
      stopCursorAdvanced: true,
      writebackCommitted: input.writebackRequired,
    },
    collectionFailures: [],
    liveSurfaceSha256: Object.fromEntries(fixtureLiveSurfaces(
      input.effectivePrompt,
      hookContext,
    ).map((surface) => [surface.id, sha256(surface.content)])),
    schemaVersion: 3,
    sessionDigest,
    sourceReceipts: {
      cursor: {
        sessionDigest,
        sessionDigests: [sessionDigest],
        sourceSha256: SHA,
      },
      effectiveInput: {
        ...effectiveInputComposition,
        compositionSha256: sha256(JSON.stringify(effectiveInputComposition)),
      },
      injection: {
        contentHashes,
        events: recalled.length === 0
          ? []
          : [{
              command: "user-prompt-submit",
              decision: "injected",
              recordIds: recalled,
            }],
        hookContextSegments: hookContext.length === 0
          ? []
          : [{
              contentByteLength: Buffer.byteLength(hookContext, "utf8"),
              contentSha256: sha256(hookContext),
            }],
        hookContextSurfaceCommitmentSha256: sha256(JSON.stringify(
          hookContext.length === 0 ? [] : [hookContext],
        )),
        injectedRecordIds: recalled,
        sessionDigest,
        sourceSha256: SHA,
      },
      memoryExport: {
        recordIds: input.expectedPriorMemoryIds,
        semanticDocumentSha256: [],
        semanticSurfaceCommitmentSha256: sha256(JSON.stringify([])),
        sourceSha256: sha256(emptyMemoryExport()),
        utf8Bytes: Buffer.byteLength(emptyMemoryExport(), "utf8"),
      },
      writeback: {
        events: written.length === 0
          ? []
          : [{
              command: "turn-end",
              linkedRecordIds: written.map((id) => ({ id, type: "memory" })),
              status: "committed",
            }],
        sessionDigest,
        sourceSha256: SHA,
      },
    },
    sources: {
      cursorSourceSha256: SHA,
      injectionSourceSha256: SHA,
      memoryExportSha256: sha256(emptyMemoryExport()),
      sanitizedTranscriptSha256: input.sanitizedTranscriptSha256,
      transcriptSourceSha256: SHA,
      writebackSourceSha256: SHA,
    },
  };
}

function stageEvents(input: {
  arm: C5PilotArm;
  episodeId: string;
  repetition: 1 | 2;
  seed: number;
  stageId: string;
  stageRunId: string;
}) {
  const base = {
    arm: input.arm,
    attemptId: `${input.stageRunId}#attempt-1`,
    episodeId: input.episodeId,
    repetition: input.repetition,
    runId: RUN_ID,
    seed: input.seed,
    stageId: input.stageId,
    timestamp: GENERATED_AT,
    traceId: input.stageRunId,
  };
  return [
    {
      ...base,
      details: { argumentCount: 10, executableSha256: SHA },
      event: "codex_process_started",
    },
    {
      ...base,
      details: {
        durationMs: 100,
        exitCode: 0,
        status: "exited",
        timedOut: false,
      },
      event: "codex_process_exited",
    },
    {
      ...base,
      details: {
        changedFileCount: 1,
        forbiddenFileCount: 0,
        hasPatch: true,
        sha256: sha256(
          `diff --git a/src/index.ts b/src/index.ts\n${input.stageRunId}\n`,
        ),
        untrackedFileCount: 0,
      },
      event: "patch_captured",
    },
  ];
}

function leakageEvidence(input: {
  leakageInput: {
    artifacts: C4HiddenArtifact[];
    staticSurfaces: C4LeakageSurface[];
  };
  promptContents: ReadonlyMap<string, string>;
  run: C5PilotEpisodeArmRun;
  stage: C5PilotStageRun;
}) {
  return auditC5LiveLeakageSurfaces({
    artifacts: input.leakageInput.artifacts,
    liveSurfaces: fixtureLiveSurfaces(requiredPrompt(
      input.promptContents,
      input.run.episodeId,
      input.stage.stageId,
    ), fixtureHookContext(input.stage.memoryExpectation, input.stage.id)),
    staticSurfaces: input.leakageInput.staticSurfaces,
    trajectoryOrigins: input.stage.priorStageIds.flatMap((priorStageId) => {
    const priorStage = input.run.stages.find((candidate) =>
      candidate.stageId === priorStageId
    )!;
    return [{
      content: requiredPrompt(
        input.promptContents,
        input.run.episodeId,
        priorStageId,
      ),
      id: `${priorStageId}:effective-prompt`,
    }, {
      content: agentPatchForStage(priorStage),
      id: `${priorStageId}:agent-patch`,
    }, {
      content: codexJsonlOutputForStage(priorStage),
      id: `${priorStageId}:codex-jsonl-output`,
    }];
    }),
  });
}

function codexJsonlOutputForStage(stage: C5PilotStageRun): string {
  return `${JSON.stringify({
    item: { id: stage.id, type: "agent_message" },
    type: "item.completed",
  })}\n`;
}

function fixtureHookContext(
  memoryExpectation: "irrelevant-control" | "none" | "required",
  stageId: string,
): string {
  return memoryExpectation === "required"
    ? `Same-trajectory prior context for ${stageId}.`
    : "";
}

function fixtureLiveSurfaces(
  effectivePrompt: string,
  hookContext = "",
): C4LeakageSurface[] {
  return [
    {
      content: hookContext.length === 0
        ? effectivePrompt
        : `${effectivePrompt}\n\n${hookContext}`,
      id: "effective-codex-input-after-seeding",
    },
    { content: "", id: "flat-summary-after-seeding" },
    {
      content: emptyMemoryExport(),
      hiddenValueContents: [],
      id: "goodmemory-export-after-seeding",
    },
    {
      content: hookContext,
      hiddenValueContents: hookContext.length === 0 ? [] : [hookContext],
      id: "goodmemory-hook-context-after-seeding",
    },
  ];
}

function emptyMemoryExport(): string {
  return JSON.stringify({
    durable: {
      archives: [],
      episodes: [],
      evidence: [],
      experiences: [],
      facts: [],
      feedback: [],
      preferences: [],
      profile: null,
      promotions: [],
      proposals: [],
      references: [],
      sourceMessages: [],
    },
  });
}

function agentPatchForStage(stage: C5PilotStageRun): string {
  return `diff --git a/src/index.ts b/src/index.ts\n${stage.id}\n`;
}

function requiredPrompt(
  prompts: ReadonlyMap<string, string>,
  episodeId: string,
  stageId: string,
): string {
  const prompt = prompts.get(`${episodeId}/${stageId}`);
  if (prompt === undefined) throw new Error("missing C5 evidence fixture prompt");
  return prompt;
}

function c5HostEnvironment() {
  const installedConfigSha256 = sha256("installed-codex-config");
  const noMemoryConfigSha256 = sha256("no-memory-codex-config");
  const goodmemoryConfigSha256 = sha256("goodmemory-config");
  const hooksConfigSha256 = sha256("hooks-config");
  const configurations = buildC3HostConfigurationEvidence({
    goodmemoryInstalled: {
      codexConfig: {
        normalizedText: "features.hooks=true",
        sourceSha256: installedConfigSha256,
      },
      environment: c5ControlledHostEnvironment(),
      goodmemoryConfig: {
        normalizedText: '{"writebackMode":"selective"}',
        sourceSha256: goodmemoryConfigSha256,
      },
      hooksConfig: {
        normalizedText: '{"hooks":["SessionStart","Stop"]}',
        sourceSha256: hooksConfigSha256,
      },
      profile: installedProfile(),
    },
    noMemory: {
      codexConfig: {
        normalizedText: "features.hooks=false",
        sourceSha256: noMemoryConfigSha256,
      },
      environment: c5ControlledHostEnvironment(),
      goodmemoryConfig: null,
      hooksConfig: null,
      profile: null,
    },
  });

  return parseC5HostEnvironment({
    codexFeatures: {
      goodmemoryInstalled: c5FeatureEvidence(true),
      noMemory: c5FeatureEvidence(false),
    },
    configurations,
    goodmemory: {
      configSha256: goodmemoryConfigSha256,
      executableSha256: SHA,
      hooksSha256: hooksConfigSha256,
      mcpExecutableSha256: SHA,
      packageSha256: SHA,
    },
    platform: {
      arch: "arm64",
      cpuCount: 8,
      name: "darwin",
      totalMemoryBytes: 16_000_000_000,
    },
    repositoryPolicy: {
      dirtyStatePolicy: "reject",
      workspaceIsolation: "fresh-isolated-clone-per-stage",
    },
    toolchain: Object.fromEntries(
      ["bun", "git", "node", "npm", "python"].map((name) => [
        name,
        { sha256: SHA, version: `${name}-test` },
      ]),
    ),
  });
}

function withClusterHostConfigurationReceipts(
  environment: ReturnType<typeof c5HostEnvironment>,
  clusterId: string,
) {
  const installed = environment.configurations.arms.goodmemoryInstalled;
  const noMemory = environment.configurations.arms.noMemory;
  const goodmemoryConfigSha256 = sha256(`${clusterId}:goodmemory-config`);
  const hooksConfigSha256 = sha256(`${clusterId}:hooks-config`);
  const configurations = buildC3HostConfigurationEvidence({
    goodmemoryInstalled: {
      ...installed,
      codexConfig: {
        ...installed.codexConfig,
        sourceSha256: sha256(`${clusterId}:installed-codex-config`),
      },
      goodmemoryConfig: {
        ...installed.goodmemoryConfig!,
        sourceSha256: goodmemoryConfigSha256,
      },
      hooksConfig: {
        ...installed.hooksConfig!,
        sourceSha256: hooksConfigSha256,
      },
    },
    noMemory: {
      ...noMemory,
      codexConfig: {
        ...noMemory.codexConfig,
        sourceSha256: sha256(`${clusterId}:no-memory-codex-config`),
      },
    },
  });

  return parseC5HostEnvironment({
    ...environment,
    configurations,
    goodmemory: {
      ...environment.goodmemory,
      configSha256: goodmemoryConfigSha256,
      hooksSha256: hooksConfigSha256,
    },
  });
}

function c5ControlledHostEnvironment(): Record<string, string> {
  return {
    CODEX_HOME: "<codex-home>",
    GOODMEMORY_HOME: "<home>/.goodmemory",
    HOME: "<home>",
    PATH: "<package-prefix>/bin:<host-path>",
    TMPDIR: "<temp>",
  };
}

function c5FeatureEvidence(hooksEnabled: boolean) {
  const rawOutput = `hooks stable ${hooksEnabled}\nmemories stable false\n`;
  return {
    hooks: { enabled: hooksEnabled, maturity: "stable" },
    memories: { enabled: false, maturity: "stable" },
    outputSha256: sha256(rawOutput),
    rawOutput,
  };
}

function evaluatorEvidence(input: {
  arm: C5PilotArm;
  reasons: string[];
  resolved: boolean;
}) {
  const testResult = (
    kind: "fail-to-pass" | "pass-to-pass",
    status: "failed" | "passed",
  ) => ({
    commandSha256: SHA,
    durationMs: 10,
    exitCode: status === "passed" ? 0 : 1,
    kind,
    status,
  });
  return {
    arm: input.arm,
    evaluatorFiles: [
      { relativePath: "cases.json", sha256: SHA },
      { relativePath: "runner.ts", sha256: SHA },
    ],
    failToPass: testResult(
      "fail-to-pass",
      input.resolved ? "passed" : "failed",
    ),
    passToPass: testResult("pass-to-pass", "passed"),
    sandbox: {
      configSha256: SHA,
      configWriteDenied: true,
      copiedAuthRemovedBeforeEvaluator: true,
      evaluatorRead: true,
      evaluatorWriteDenied: true,
      networkAccess: false,
      networkDenied: true,
      networkPositiveControl: true,
      originalAuthAliasDenied: true,
      originalAuthDenied: true,
      profileName: "c4-evaluator",
      schemaVersion: 1,
      workspaceRead: true,
      workspaceWrite: true,
    },
    schemaVersion: 1,
    score: {
      disposition: "finalized",
      executionFailureStage: null,
      resolved: input.resolved,
      taskFailureReasons: input.reasons,
    },
  };
}

async function writeReviewArtifacts(input: {
  manifest: C5EvidenceProjectionManifest;
  projection: string;
  verification: Awaited<ReturnType<typeof verifyC5EvidenceProjection>>;
}): Promise<void> {
  const manifestSha256 = sha256(await readFile(
    join(input.projection, "projection-manifest.json"),
    "utf8",
  ));
  const reportSha256 = sha256(await readFile(
    join(input.projection, "report.json"),
    "utf8",
  ));
  const verificationSha256 = sha256(
    serializeC5EvidenceVerification(input.verification),
  );
  const manifestBytes = await readFile(
    join(input.projection, "projection-manifest.json"),
    "utf8",
  );
  const reportBytes = await readFile(
    join(input.projection, "report.json"),
    "utf8",
  );
  const verificationBytes = serializeC5EvidenceVerification(input.verification);
  const bundle = buildC5ReviewInputBundle({
    createdAt: GENERATED_AT,
    projectionManifestBytes: manifestBytes,
    projectionRootPath: input.projection,
    reportBytes,
    runId: RUN_ID,
    verificationBytes,
  });
  const inputBundleBytes = serializeC5ReviewArtifact(bundle);
  const requestBytes = buildC5ReviewRequest({
    inputBundle: bundle,
    inputBundleSha256: sha256(inputBundleBytes),
  });
  const dispatchBytes = serializeC5ReviewArtifact(
    buildC5IndependentReviewDispatch({
      projectionRootPath: input.projection,
      spawnMessage: buildC5IndependentReviewSpawnMessage(input.projection),
    }),
  );
  const review = {
    assertions: {
      claimBoundary: true,
      everyAttemptAccounted: true,
      failureTaxonomyReviewed: true,
      noSilentFallback: true,
      powerAnalysis: true,
    },
    claimBoundary: "internal-native-longitudinal-pilot-only" as const,
    decision: "accepted",
    failureTaxonomySha256: bundle.artifacts.failureTaxonomy.sha256,
    findings: [],
    inputBundleSha256: sha256(inputBundleBytes),
    phase: "C5",
    projectionManifestSha256: manifestSha256,
    publicClaimEligible: false,
    publicCodingEffectProof: false,
    rationale: "The sanitized projection passes all independent assertions.",
    readmeRowAllowed: false,
    reportSha256,
    reviewedAt: GENERATED_AT,
    reviewer: "independent C5 reviewer",
    reviewerTaskName: "/root/c5_final_independent_review_v1",
    runId: RUN_ID,
    schemaVersion: 1,
    scope: "sanitized-projection-only",
    verificationSha256,
  };
  const reviewDirectory = join(input.projection, "review");
  await Promise.all([
    writeText(join(reviewDirectory, "request.md"), requestBytes),
    writeText(join(reviewDirectory, "dispatch.json"), dispatchBytes),
    writeText(join(reviewDirectory, "input-bundle.json"), inputBundleBytes),
  ]);
  const reviewPath = join(
    reviewDirectory,
    "independent-review.json",
  );
  const reviewBytes = serializeC5ReviewArtifact(review);
  await writeText(reviewPath, reviewBytes);
  const provenance = buildC5IndependentReviewProvenance({
    authorTaskName: "/root",
    dispatchBytes,
    inputBundleBytes,
    recordedAt: GENERATED_AT,
    requestBytes,
    responseBytes: reviewBytes,
    reviewerAgentName: "/root/c5_final_independent_review_v1",
  });
  await writeText(
    join(reviewDirectory, "provenance.json"),
    serializeC5ReviewArtifact(provenance),
  );
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}

function clusterDigest(clusterId: string): string {
  return sha256(clusterId).slice(0, 16);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
