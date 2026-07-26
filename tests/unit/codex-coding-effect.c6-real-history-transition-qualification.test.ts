import { describe, expect, it } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  projectC6RealHistoryPrehistorySelection,
  serializeC6RealHistoryPrehistorySelection,
} from "../../scripts/codex-coding-effect/c6-real-history-prehistory-selection";
import {
  C6_REAL_HISTORY_AUDIT_ORDER_SHA256,
  C6_REAL_HISTORY_TRAJECTORY_SHA256,
  loadC6RealHistoryTransitionQualification,
  materializeC6RealHistoryTransitionQualification,
  parseC6RealHistoryTransitionQualification,
  projectC6RealHistoryTransitionQualification,
  replayC6RealHistoryTransitionQualification,
  serializeC6RealHistoryTransitionQualification,
} from "../../scripts/codex-coding-effect/c6-real-history-transition-qualification";
import {
  parseC6RealHistoryTransitionQualificationCliOptions,
  runC6RealHistoryTransitionQualificationSnapshotCommand,
} from "../../scripts/snapshot-codex-coding-effect-c6-real-history-transition-qualification";

const SOURCE_ROOT = resolve(
  "fixtures/codex-coding-effect/c6-source-pool",
);
const TRAJECTORY_PATH = join(
  SOURCE_ROOT,
  "multi-swe-full-56ff018.review-trajectory-discovery.json",
);
const AUDIT_ORDER_PATH = join(
  SOURCE_ROOT,
  "multi-swe-full-56ff018.real-history-prehistory-selection.json",
);

describe("Codex coding-effect C6 real-history transition qualification intake", () => {
  it("freezes all 54 capped candidates without promoting source signals", async () => {
    const projection = await projectTrackedInputs();

    expect(projection.boundary).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      datasetAssemblyAllowed: false,
      independentAcceptedCount: 0,
      machineQualifiedCount: 0,
      status: "qualification-intake-only-no-transition-evidence",
    });
    expect(projection.counts).toEqual({
      blockedCandidateCount: 54,
      cappedCandidateCount: 54,
      independentlyAcceptedCount: 0,
      machineQualifiedCount: 0,
      priorityCandidateCount: 48,
      reserveCandidateCount: 6,
      sourceF2pAndP2pSignalCount: 19,
      sourceF2pSignalCount: 22,
    });
    expect(projection.candidates).toHaveLength(54);
    expect(projection.candidates.map((candidate) => candidate.cappedPoolRank))
      .toEqual(Array.from({ length: 54 }, (_, index) => index + 1));
    expect(projection.candidates.filter((candidate) =>
      candidate.auditClass === "priority"
    )).toHaveLength(48);
    expect(projection.candidates.filter((candidate) =>
      candidate.auditClass === "reserve"
    )).toHaveLength(6);
    expect(projection.candidates.every((candidate) =>
      candidate.currentDecision === "blocked-evidence-not-collected" &&
      candidate.machineQualification === "not-qualified" &&
      candidate.independentAcceptance === "not-reviewed" &&
      candidate.stages.length === 3 &&
      candidate.stages.every((stage) =>
        stage.evidence.every((requirement) =>
          requirement.status === "not-collected"
        )
      ) &&
      candidate.episodeEvidence.every((requirement) =>
        requirement.status === "not-collected"
      )
    )).toBe(true);
    expect(projection.stopGo).toEqual({
      datasetAssemblyAllowed: false,
      independentAcceptedCount: 0,
      machineQualifiedCount: 0,
      minimumIndependentAccepted: 48,
      minimumMachineQualified: 48,
      reasons: [
        "machine-qualified-below-48",
        "independent-accepted-below-48",
      ],
      rule: "allow only when at least 48 candidates have complete three-stage transition, commit, prefix, repository, license, replay, and independent-review closure",
    });
    expect(projection.policy).toMatchObject({
      evidenceAccountingRule:
        "not-collected is never evidence; source test signals are availability hints only",
      independentAcceptanceRule:
        "accepted only after machine qualification, complete independent-reviewer provenance, and an independent accepted verdict",
      machineQualificationRule:
        "qualified only after all requirements for all three stages and all non-review episode requirements are complete",
    });
  });

  it("keeps audit order independent from source test-signal outcomes", async () => {
    const [trajectoryBytes, auditOrderBytes] = await trackedInputBytes();
    const original = projectC6RealHistoryTransitionQualification({
      auditOrderBytes,
      auditOrderPath: AUDIT_ORDER_PATH,
      trajectoryBytes,
      trajectoryPath: TRAJECTORY_PATH,
    });
    const mutatedTrajectory = JSON.parse(
      trajectoryBytes.toString("utf8"),
    ) as {
      targets: Array<{
        sourceTestSignals: {
          f2pCount: number;
          p2pCount: number;
        };
      }>;
    };
    for (const target of mutatedTrajectory.targets) {
      target.sourceTestSignals.f2pCount += 1000;
      target.sourceTestSignals.p2pCount += 1000;
    }
    const mutatedTrajectoryBytes = Buffer.from(
      `${JSON.stringify(mutatedTrajectory, null, 2)}\n`,
    );
    const recomputedAuditOrder = projectC6RealHistoryPrehistorySelection({
      inputBytes: mutatedTrajectoryBytes,
      inputPath: TRAJECTORY_PATH,
    });
    const mutated = projectC6RealHistoryTransitionQualification({
      auditOrderBytes: Buffer.from(
        serializeC6RealHistoryPrehistorySelection(recomputedAuditOrder),
      ),
      auditOrderPath: AUDIT_ORDER_PATH,
      trajectoryBytes: mutatedTrajectoryBytes,
      trajectoryPath: TRAJECTORY_PATH,
    });

    expect(mutated.candidates.map(candidateIdentity)).toEqual(
      original.candidates.map(candidateIdentity),
    );
    expect(mutated.counts.sourceF2pAndP2pSignalCount).toBe(54);
    expect(mutated.counts.sourceF2pSignalCount).toBe(54);
  });

  it("rejects missing, duplicate, reordered, or outcome-influenced capped closure", async () => {
    const [trajectoryBytes, auditOrderBytes] = await trackedInputBytes();
    const original = JSON.parse(auditOrderBytes.toString("utf8")) as {
      eligibleRankClosure: Array<Record<string, unknown>>;
    };
    const mutations = [
      (value: typeof original) => {
        const index = value.eligibleRankClosure.findIndex((entry) =>
          entry.cappedPoolRank === 54
        );
        value.eligibleRankClosure.splice(index, 1);
      },
      (value: typeof original) => {
        const capped = value.eligibleRankClosure.filter((entry) =>
          typeof entry.cappedPoolRank === "number"
        );
        capped[1]!.anchorId = capped[0]!.anchorId;
      },
      (value: typeof original) => {
        const capped = value.eligibleRankClosure.filter((entry) =>
          typeof entry.cappedPoolRank === "number"
        );
        const firstRank = capped[0]!.cappedPoolRank;
        capped[0]!.cappedPoolRank = capped[1]!.cappedPoolRank;
        capped[1]!.cappedPoolRank = firstRank;
      },
      (value: typeof original) => {
        const capped = value.eligibleRankClosure.filter((entry) =>
          typeof entry.cappedPoolRank === "number"
        );
        capped[0]!.priorityDecision = "deferred-after-global-priority-rank";
      },
    ];

    for (const mutate of mutations) {
      const value = structuredClone(original);
      mutate(value);
      expect(() => projectC6RealHistoryTransitionQualification({
        auditOrderBytes: Buffer.from(`${JSON.stringify(value, null, 2)}\n`),
        auditOrderPath: AUDIT_ORDER_PATH,
        trajectoryBytes,
        trajectoryPath: TRAJECTORY_PATH,
      })).toThrow(
        "audit-order projection does not match deterministic recomputation",
      );
    }
  });

  it("rejects fabricated qualification and every required evidence gap", async () => {
    const projection = await projectTrackedInputs();
    const mutations: Array<(value: Record<string, unknown>) => void> = [
      (value) => {
        const candidate = firstCandidate(value);
        candidate.currentDecision = "accepted";
      },
      (value) => {
        const candidate = firstCandidate(value);
        const stages = candidate.stages as Array<Record<string, unknown>>;
        for (const stage of stages) {
          stage.sharedFinalTestSha256 = "a".repeat(64);
        }
      },
      (value) => {
        const candidate = firstCandidate(value);
        const stages = candidate.stages as Array<{
          evidence: Array<Record<string, unknown>>;
        }>;
        removeRequirement(
          stages[0]!.evidence,
          "exact-stage-history-prefix",
        );
      },
      (value) => {
        const candidate = firstCandidate(value);
        const stages = candidate.stages as Array<{
          sourceTransitionLineage: Record<string, unknown>;
        }>;
        delete stages[1]!.sourceTransitionLineage.beforeCommit;
      },
      (value) => {
        const candidate = firstCandidate(value);
        const stages = candidate.stages as Array<{
          evidence: Array<Record<string, unknown>>;
        }>;
        removeRequirement(
          stages[2]!.evidence,
          "linux-replay-receipt",
        );
      },
      (value) => {
        const candidate = firstCandidate(value);
        const evidence = candidate.episodeEvidence as Array<
          Record<string, unknown>
        >;
        removeRequirement(evidence, "historical-license-review");
      },
      (value) => {
        const candidate = firstCandidate(value);
        const evidence = candidate.episodeEvidence as Array<
          Record<string, unknown>
        >;
        removeRequirement(evidence, "independent-reviewer-provenance");
      },
      (value) => {
        const boundary = value.boundary as Record<string, unknown>;
        boundary.machineQualifiedCount = 48;
        boundary.independentAcceptedCount = 48;
        boundary.datasetAssemblyAllowed = true;
      },
      (value) => {
        const candidates = value.candidates as Array<Record<string, unknown>>;
        candidates.pop();
      },
      (value) => {
        delete firstCandidate(value).currentDecision;
      },
      (value) => {
        const candidate = firstCandidate(value);
        candidate.currentDecision = "rejected";
        delete candidate.decisionReason;
      },
    ];

    for (const mutate of mutations) {
      const value = structuredClone(projection) as unknown as Record<
        string,
        unknown
      >;
      mutate(value);
      refreshCandidateClosure(value);
      expect(() => parseC6RealHistoryTransitionQualification(value)).toThrow();
    }
  });

  it("materializes once, loads canonically, and replays exact tracked inputs", async () => {
    const outputPath = join(
      await realpath(tmpdir()),
      `c6-transition-qualification-${randomUUID()}.json`,
    );
    try {
      const materialized =
        await materializeC6RealHistoryTransitionQualification({
          auditOrderPath: AUDIT_ORDER_PATH,
          outputPath,
          trajectoryPath: TRAJECTORY_PATH,
        });
      const loaded = await loadC6RealHistoryTransitionQualification(
        outputPath,
        { expectedSha256: materialized.projectionSha256 },
      );
      expect(loaded).toEqual(materialized.projection);
      await expect(materializeC6RealHistoryTransitionQualification({
        auditOrderPath: AUDIT_ORDER_PATH,
        outputPath,
        trajectoryPath: TRAJECTORY_PATH,
      })).rejects.toThrow();

      const replay = await replayC6RealHistoryTransitionQualification({
        auditOrderPath: AUDIT_ORDER_PATH,
        expectedProjectionSha256: materialized.projectionSha256,
        projectionPath: outputPath,
        trajectoryPath: TRAJECTORY_PATH,
      });
      expect(replay).toMatchObject({
        auditOrderSha256: C6_REAL_HISTORY_AUDIT_ORDER_SHA256,
        projectionSha256: materialized.projectionSha256,
        reproduced: true,
        trajectorySha256: C6_REAL_HISTORY_TRAJECTORY_SHA256,
      });

      await writeFile(outputPath, "{}\n");
      await expect(loadC6RealHistoryTransitionQualification(
        outputPath,
        { expectedSha256: materialized.projectionSha256 },
      )).rejects.toThrow("projection hash mismatch");
    } finally {
      await rm(outputPath, { force: true });
    }
  });

  it("exposes a strict one-shot snapshot command", async () => {
    expect(() =>
      parseC6RealHistoryTransitionQualificationCliOptions([
        `--trajectory=${TRAJECTORY_PATH}`,
        `--audit-order=${AUDIT_ORDER_PATH}`,
      ])
    ).toThrow("--output is required exactly once");
    expect(() =>
      parseC6RealHistoryTransitionQualificationCliOptions([
        `--trajectory=${TRAJECTORY_PATH}`,
        `--audit-order=${AUDIT_ORDER_PATH}`,
        "--output=projection.json",
        "--unknown=value",
      ])
    ).toThrow("unknown C6 transition qualification option --unknown");

    const outputPath = join(
      await realpath(tmpdir()),
      `c6-transition-qualification-cli-${randomUUID()}.json`,
    );
    try {
      const result =
        await runC6RealHistoryTransitionQualificationSnapshotCommand([
          `--trajectory=${TRAJECTORY_PATH}`,
          `--audit-order=${AUDIT_ORDER_PATH}`,
          `--output=${outputPath}`,
        ]);
      expect(result).toMatchObject({
        boundary: {
          acceptedEpisodeCount: 0,
          candidateManifestFrozen: false,
          datasetAssemblyAllowed: false,
          machineQualifiedCount: 0,
        },
        counts: {
          cappedCandidateCount: 54,
          independentlyAcceptedCount: 0,
          machineQualifiedCount: 0,
        },
        output: outputPath,
      });
      expect(result.outputSha256).toMatch(/^[a-f0-9]{64}$/u);
    } finally {
      await rm(outputPath, { force: true });
    }
  });
});

async function trackedInputBytes(): Promise<[Buffer, Buffer]> {
  return Promise.all([
    readFile(TRAJECTORY_PATH),
    readFile(AUDIT_ORDER_PATH),
  ]);
}

async function projectTrackedInputs() {
  const [trajectoryBytes, auditOrderBytes] = await trackedInputBytes();
  return projectC6RealHistoryTransitionQualification({
    auditOrderBytes,
    auditOrderPath: AUDIT_ORDER_PATH,
    trajectoryBytes,
    trajectoryPath: TRAJECTORY_PATH,
  });
}

function candidateIdentity(candidate: {
  anchorId: string;
  auditClass: string;
  cappedPoolRank: number;
  repository: string;
}) {
  return {
    anchorId: candidate.anchorId,
    auditClass: candidate.auditClass,
    cappedPoolRank: candidate.cappedPoolRank,
    repository: candidate.repository,
  };
}

function firstCandidate(value: Record<string, unknown>): Record<string, unknown> {
  return (value.candidates as Array<Record<string, unknown>>)[0]!;
}

function removeRequirement(
  evidence: Array<Record<string, unknown>>,
  requirement: string,
): void {
  const index = evidence.findIndex((entry) =>
    entry.requirement === requirement
  );
  evidence.splice(index, 1);
}

function refreshCandidateClosure(value: Record<string, unknown>): void {
  const candidates = value.candidates;
  value.candidateClosureSha256 = createHash("sha256")
    .update(JSON.stringify(candidates))
    .digest("hex");
}
