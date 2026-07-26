import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
} from "./c6-asset-lock";
import {
  projectC6RealHistoryPrehistorySelection,
  serializeC6RealHistoryPrehistorySelection,
} from "./c6-real-history-prehistory-selection";
import type {
  C6RealHistoryPrehistorySelection,
} from "./c6-real-history-prehistory-selection";
import type {
  C6ReviewTrajectoryDiscovery,
} from "./c6-review-trajectory-discovery";

export const C6_REAL_HISTORY_TRAJECTORY_SHA256 =
  "5931a911b919a9c53068311185f0bd1c78c0be18220ebe92c3b795c8e38357fd";
export const C6_REAL_HISTORY_AUDIT_ORDER_SHA256 =
  "938ffaff2d185b3e3ba5d0ccf8e97f626879ffe0c7c44d65f6c6313958a06044";

const ARTIFACT_KIND = "c6-real-history-transition-qualification-intake";
const MINIMUM_REAL_HISTORY_EPISODES = 48;
const CAPPED_CANDIDATE_COUNT = 54;
const PRIORITY_CANDIDATE_COUNT = 48;

const STAGE_ROLES = [
  "original-task",
  "first-review",
  "second-review",
] as const;
const STAGE_REQUIREMENTS = [
  "agent-visible-target-request",
  "repository-before-snapshot-tree",
  "repository-after-snapshot-tree",
  "exact-stage-history-prefix",
  "transition-specific-fail-to-pass",
  "stage-protection-pass-to-pass",
  "linux-replay-receipt",
  "episode-wide-future-leakage-audit",
] as const;
const EPISODE_REQUIREMENTS = [
  "repository-url-commit-tree-reachability",
  "historical-license-review",
  "redistribution-review",
  "source-platform-authentication",
  "task-origin-review",
  "semantic-memory-dependency-review",
  "semantic-duplicate-review",
  "independent-reviewer-provenance",
] as const;
const CLOSED_DECISION_REASONS = [
  "qualification-evidence-not-collected",
  "three-stage-transition-evidence-incomplete",
  "history-prefix-closure-incomplete",
  "repository-closure-incomplete",
  "license-or-redistribution-review-incomplete",
  "transition-replay-failed",
  "future-leakage-detected",
  "source-authentication-incomplete",
  "semantic-dependency-rejected",
  "semantic-duplicate",
  "reviewer-independence-incomplete",
  "machine-qualified-pending-independent-review",
  "accepted-complete-closure",
] as const;
const EVIDENCE_ACCOUNTING_RULE =
  "not-collected is never evidence; source test signals are availability hints only";
const MACHINE_QUALIFICATION_RULE =
  "qualified only after all requirements for all three stages and all non-review episode requirements are complete";
const INDEPENDENT_ACCEPTANCE_RULE =
  "accepted only after machine qualification, complete independent-reviewer provenance, and an independent accepted verdict";
const DATASET_ASSEMBLY_RULE =
  "allow only when at least 48 candidates have complete three-stage transition, commit, prefix, repository, license, replay, and independent-review closure";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const artifactReferenceSchema = z.object({
  bytes: z.number().int().positive(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const sourceReferenceSchema = z.object({
  path: z.string().min(1),
  rowIndex: z.number().int().nonnegative(),
  rowSha256: sha256Schema,
}).strict();
const evidenceRequirementSchema = z.object({
  requirement: z.enum([
    ...STAGE_REQUIREMENTS,
    ...EPISODE_REQUIREMENTS,
  ]),
  status: z.literal("not-collected"),
}).strict();
const transitionSourceLineageSchema = z.discriminatedUnion("status", [
  z.object({
    afterCommit: commitSchema,
    status: z.literal(
      "source-signal-only-base-and-original-request-not-bound",
    ),
  }).strict(),
  z.object({
    afterCommit: commitSchema,
    beforeCommit: commitSchema,
    status: z.literal("source-signal-only-not-replayed"),
  }).strict(),
]);
const candidateStageSchema = z.object({
  evidence: z.array(evidenceRequirementSchema).length(
    STAGE_REQUIREMENTS.length,
  ),
  position: z.number().int().min(1).max(3),
  role: z.enum(STAGE_ROLES),
  sourceTransitionLineage: transitionSourceLineageSchema,
}).strict();
const candidateSchema = z.object({
  anchorId: z.string().min(1),
  auditClass: z.enum(["priority", "reserve"]),
  cappedPoolRank: z.number().int().min(1).max(CAPPED_CANDIDATE_COUNT),
  currentDecision: z.literal("blocked-evidence-not-collected"),
  decisionReason: z.literal("qualification-evidence-not-collected"),
  eligibleRank: z.number().int().positive(),
  episodeEvidence: z.array(evidenceRequirementSchema).length(
    EPISODE_REQUIREMENTS.length,
  ),
  independentAcceptance: z.literal("not-reviewed"),
  machineQualification: z.literal("not-qualified"),
  priorityRank: z.number().int().min(1).max(PRIORITY_CANDIDATE_COUNT)
    .nullable(),
  repository: z.string().min(1),
  source: sourceReferenceSchema,
  sourceSignalAvailability: z.object({
    failToPassCount: z.number().int().nonnegative(),
    interpretation: z.literal(
      "final-source-test-signal-only-not-transition-specific-evidence",
    ),
    passToPassCount: z.number().int().nonnegative(),
  }).strict(),
  stages: z.array(candidateStageSchema).length(3),
}).strict();
const projectionSchema = z.object({
  artifactKind: z.literal(ARTIFACT_KIND),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    datasetAssemblyAllowed: z.literal(false),
    independentAcceptedCount: z.literal(0),
    machineQualifiedCount: z.literal(0),
    status: z.literal("qualification-intake-only-no-transition-evidence"),
  }).strict(),
  candidateClosureSha256: sha256Schema,
  candidates: z.array(candidateSchema).length(CAPPED_CANDIDATE_COUNT),
  counts: z.object({
    blockedCandidateCount: z.literal(CAPPED_CANDIDATE_COUNT),
    cappedCandidateCount: z.literal(CAPPED_CANDIDATE_COUNT),
    independentlyAcceptedCount: z.literal(0),
    machineQualifiedCount: z.literal(0),
    priorityCandidateCount: z.literal(PRIORITY_CANDIDATE_COUNT),
    reserveCandidateCount: z.literal(
      CAPPED_CANDIDATE_COUNT - PRIORITY_CANDIDATE_COUNT,
    ),
    sourceF2pAndP2pSignalCount: z.number().int().nonnegative(),
    sourceF2pSignalCount: z.number().int().nonnegative(),
  }).strict(),
  inputs: z.object({
    auditOrder: artifactReferenceSchema,
    auditOrderRecomputedFromTrajectory: z.literal(true),
    trajectory: artifactReferenceSchema,
  }).strict(),
  policy: z.object({
    auditOrder: z.literal(
      "all-54-capped-candidates-in-cappedPoolRank-order",
    ),
    closedDecisionReasons: z.tuple([
      z.literal(CLOSED_DECISION_REASONS[0]),
      z.literal(CLOSED_DECISION_REASONS[1]),
      z.literal(CLOSED_DECISION_REASONS[2]),
      z.literal(CLOSED_DECISION_REASONS[3]),
      z.literal(CLOSED_DECISION_REASONS[4]),
      z.literal(CLOSED_DECISION_REASONS[5]),
      z.literal(CLOSED_DECISION_REASONS[6]),
      z.literal(CLOSED_DECISION_REASONS[7]),
      z.literal(CLOSED_DECISION_REASONS[8]),
      z.literal(CLOSED_DECISION_REASONS[9]),
      z.literal(CLOSED_DECISION_REASONS[10]),
      z.literal(CLOSED_DECISION_REASONS[11]),
      z.literal(CLOSED_DECISION_REASONS[12]),
    ]),
    evidenceAccountingRule: z.literal(EVIDENCE_ACCOUNTING_RULE),
    episodeEvidenceRequirements: z.tuple([
      z.literal(EPISODE_REQUIREMENTS[0]),
      z.literal(EPISODE_REQUIREMENTS[1]),
      z.literal(EPISODE_REQUIREMENTS[2]),
      z.literal(EPISODE_REQUIREMENTS[3]),
      z.literal(EPISODE_REQUIREMENTS[4]),
      z.literal(EPISODE_REQUIREMENTS[5]),
      z.literal(EPISODE_REQUIREMENTS[6]),
      z.literal(EPISODE_REQUIREMENTS[7]),
    ]),
    forbiddenAuditOrderFields: z.tuple([
      z.literal("sourceTestSignals"),
      z.literal("patch"),
      z.literal("test"),
      z.literal("gold"),
      z.literal("outcome"),
    ]),
    independentAcceptanceRule: z.literal(INDEPENDENT_ACCEPTANCE_RULE),
    machineQualificationRule: z.literal(MACHINE_QUALIFICATION_RULE),
    stageEvidenceRequirements: z.tuple([
      z.literal(STAGE_REQUIREMENTS[0]),
      z.literal(STAGE_REQUIREMENTS[1]),
      z.literal(STAGE_REQUIREMENTS[2]),
      z.literal(STAGE_REQUIREMENTS[3]),
      z.literal(STAGE_REQUIREMENTS[4]),
      z.literal(STAGE_REQUIREMENTS[5]),
      z.literal(STAGE_REQUIREMENTS[6]),
      z.literal(STAGE_REQUIREMENTS[7]),
    ]),
    stageRoles: z.tuple([
      z.literal(STAGE_ROLES[0]),
      z.literal(STAGE_ROLES[1]),
      z.literal(STAGE_ROLES[2]),
    ]),
  }).strict(),
  schemaVersion: z.literal(1),
  stopGo: z.object({
    datasetAssemblyAllowed: z.literal(false),
    independentAcceptedCount: z.literal(0),
    machineQualifiedCount: z.literal(0),
    minimumIndependentAccepted: z.literal(MINIMUM_REAL_HISTORY_EPISODES),
    minimumMachineQualified: z.literal(MINIMUM_REAL_HISTORY_EPISODES),
    reasons: z.tuple([
      z.literal("machine-qualified-below-48"),
      z.literal("independent-accepted-below-48"),
    ]),
    rule: z.literal(DATASET_ASSEMBLY_RULE),
  }).strict(),
}).strict();

export type C6RealHistoryTransitionQualification = z.infer<
  typeof projectionSchema
>;

export function projectC6RealHistoryTransitionQualification(input: {
  auditOrderBytes: Uint8Array;
  auditOrderPath: string;
  trajectoryBytes: Uint8Array;
  trajectoryPath: string;
}): C6RealHistoryTransitionQualification {
  const trajectoryBytes = Buffer.from(input.trajectoryBytes);
  const auditOrderBytes = Buffer.from(input.auditOrderBytes);
  const auditOrder = projectC6RealHistoryPrehistorySelection({
    inputBytes: trajectoryBytes,
    inputPath: input.trajectoryPath,
  });
  const recomputedAuditOrderBytes = Buffer.from(
    serializeC6RealHistoryPrehistorySelection(auditOrder),
  );
  if (!auditOrderBytes.equals(recomputedAuditOrderBytes)) {
    throw new Error(
      "C6 transition qualification audit-order projection does not match deterministic recomputation",
    );
  }
  const trajectory = JSON.parse(
    trajectoryBytes.toString("utf8"),
  ) as C6ReviewTrajectoryDiscovery;
  const candidates = buildCandidates(trajectory, auditOrder);
  const sourceF2pSignalCount = candidates.filter((candidate) =>
    candidate.sourceSignalAvailability.failToPassCount > 0
  ).length;
  const sourceF2pAndP2pSignalCount = candidates.filter((candidate) =>
    candidate.sourceSignalAvailability.failToPassCount > 0 &&
    candidate.sourceSignalAvailability.passToPassCount > 0
  ).length;
  const projection = {
    artifactKind: ARTIFACT_KIND,
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      datasetAssemblyAllowed: false,
      independentAcceptedCount: 0,
      machineQualifiedCount: 0,
      status: "qualification-intake-only-no-transition-evidence",
    },
    candidateClosureSha256: sha256(JSON.stringify(candidates)),
    candidates,
    counts: {
      blockedCandidateCount: CAPPED_CANDIDATE_COUNT,
      cappedCandidateCount: CAPPED_CANDIDATE_COUNT,
      independentlyAcceptedCount: 0,
      machineQualifiedCount: 0,
      priorityCandidateCount: PRIORITY_CANDIDATE_COUNT,
      reserveCandidateCount:
        CAPPED_CANDIDATE_COUNT - PRIORITY_CANDIDATE_COUNT,
      sourceF2pAndP2pSignalCount,
      sourceF2pSignalCount,
    },
    inputs: {
      auditOrder: {
        bytes: auditOrderBytes.byteLength,
        path: basename(resolve(input.auditOrderPath)),
        sha256: sha256(auditOrderBytes),
      },
      auditOrderRecomputedFromTrajectory: true,
      trajectory: {
        bytes: trajectoryBytes.byteLength,
        path: basename(resolve(input.trajectoryPath)),
        sha256: sha256(trajectoryBytes),
      },
    },
    policy: {
      auditOrder: "all-54-capped-candidates-in-cappedPoolRank-order",
      closedDecisionReasons: CLOSED_DECISION_REASONS,
      evidenceAccountingRule: EVIDENCE_ACCOUNTING_RULE,
      episodeEvidenceRequirements: EPISODE_REQUIREMENTS,
      forbiddenAuditOrderFields: [
        "sourceTestSignals",
        "patch",
        "test",
        "gold",
        "outcome",
      ],
      independentAcceptanceRule: INDEPENDENT_ACCEPTANCE_RULE,
      machineQualificationRule: MACHINE_QUALIFICATION_RULE,
      stageEvidenceRequirements: STAGE_REQUIREMENTS,
      stageRoles: STAGE_ROLES,
    },
    schemaVersion: 1,
    stopGo: {
      datasetAssemblyAllowed: false,
      independentAcceptedCount: 0,
      machineQualifiedCount: 0,
      minimumIndependentAccepted: MINIMUM_REAL_HISTORY_EPISODES,
      minimumMachineQualified: MINIMUM_REAL_HISTORY_EPISODES,
      reasons: [
        "machine-qualified-below-48",
        "independent-accepted-below-48",
      ],
      rule: DATASET_ASSEMBLY_RULE,
    },
  } as const;
  return parseC6RealHistoryTransitionQualification(projection);
}

export function parseC6RealHistoryTransitionQualification(
  value: unknown,
): C6RealHistoryTransitionQualification {
  const projection = projectionSchema.parse(value);
  const expectedRanks = Array.from(
    { length: CAPPED_CANDIDATE_COUNT },
    (_, index) => index + 1,
  );
  if (
    projection.candidates.some((candidate, index) =>
      candidate.cappedPoolRank !== expectedRanks[index] ||
      candidate.auditClass !==
        (candidate.cappedPoolRank <= PRIORITY_CANDIDATE_COUNT
          ? "priority"
          : "reserve") ||
      candidate.priorityRank !==
        (candidate.auditClass === "priority"
          ? candidate.cappedPoolRank
          : null) ||
      candidate.stages.some((stage, stageIndex) =>
        stage.position !== stageIndex + 1 ||
        stage.role !== STAGE_ROLES[stageIndex] ||
        !hasExactRequirements(stage.evidence, STAGE_REQUIREMENTS)
      ) ||
      !hasExactRequirements(
        candidate.episodeEvidence,
        EPISODE_REQUIREMENTS,
      )
    )
  ) {
    throw new Error(
      "C6 transition qualification does not retain the complete ordered evidence checklist",
    );
  }
  const anchorIds = projection.candidates.map((candidate) => candidate.anchorId);
  if (new Set(anchorIds).size !== anchorIds.length) {
    throw new Error(
      "C6 transition qualification contains duplicate capped candidates",
    );
  }
  if (
    projection.candidateClosureSha256 !==
      sha256(JSON.stringify(projection.candidates))
  ) {
    throw new Error(
      "C6 transition qualification candidate closure does not match",
    );
  }
  const sourceF2pSignalCount = projection.candidates.filter((candidate) =>
    candidate.sourceSignalAvailability.failToPassCount > 0
  ).length;
  const sourceF2pAndP2pSignalCount = projection.candidates.filter((candidate) =>
    candidate.sourceSignalAvailability.failToPassCount > 0 &&
    candidate.sourceSignalAvailability.passToPassCount > 0
  ).length;
  if (
    projection.counts.sourceF2pSignalCount !== sourceF2pSignalCount ||
    projection.counts.sourceF2pAndP2pSignalCount !==
      sourceF2pAndP2pSignalCount
  ) {
    throw new Error(
      "C6 transition qualification source-signal counts do not match",
    );
  }
  return projection;
}

export async function materializeC6RealHistoryTransitionQualification(input: {
  auditOrderPath: string;
  outputPath: string;
  testHooks?: {
    beforeTerminalInputVerification?: () => Promise<void> | void;
  };
  trajectoryPath: string;
}): Promise<{
  projection: C6RealHistoryTransitionQualification;
  projectionSha256: string;
}> {
  const [trajectoryPath, auditOrderPath] = await Promise.all([
    assertC6NoSymlinkPathComponents(
      input.trajectoryPath,
      "C6 transition qualification trajectory",
    ),
    assertC6NoSymlinkPathComponents(
      input.auditOrderPath,
      "C6 transition qualification audit order",
    ),
  ]);
  const [trajectoryBytes, auditOrderBytes] = await Promise.all([
    readC6StableRegularFile(
      trajectoryPath,
      "transition qualification trajectory",
    ),
    readC6StableRegularFile(
      auditOrderPath,
      "transition qualification audit order",
    ),
  ]);
  assertTrackedInputs(trajectoryBytes, auditOrderBytes);
  const projection = projectC6RealHistoryTransitionQualification({
    auditOrderBytes,
    auditOrderPath,
    trajectoryBytes,
    trajectoryPath,
  });
  await input.testHooks?.beforeTerminalInputVerification?.();
  await Promise.all([
    assertC6NoSymlinkPathComponents(
      trajectoryPath,
      "C6 transition qualification terminal trajectory",
    ),
    assertC6NoSymlinkPathComponents(
      auditOrderPath,
      "C6 transition qualification terminal audit order",
    ),
  ]);
  const [terminalTrajectoryBytes, terminalAuditOrderBytes] = await Promise.all([
    readC6StableRegularFile(
      trajectoryPath,
      "transition qualification terminal trajectory",
    ),
    readC6StableRegularFile(
      auditOrderPath,
      "transition qualification terminal audit order",
    ),
  ]);
  if (
    !terminalTrajectoryBytes.equals(trajectoryBytes) ||
    !terminalAuditOrderBytes.equals(auditOrderBytes)
  ) {
    throw new Error(
      "C6 transition qualification inputs changed during materialization",
    );
  }
  const serialized = serializeC6RealHistoryTransitionQualification(projection);
  await assertC6NoSymlinkPathComponents(
    dirname(resolve(input.outputPath)),
    "C6 transition qualification output parent",
  );
  const handle = await open(resolve(input.outputPath), "wx", 0o644);
  try {
    await handle.writeFile(serialized, "utf8");
  } finally {
    await handle.close();
  }
  return {
    projection,
    projectionSha256: sha256(serialized),
  };
}

export async function loadC6RealHistoryTransitionQualification(
  path: string,
  options: { expectedSha256?: string } = {},
): Promise<C6RealHistoryTransitionQualification> {
  const resolvedPath = await assertC6NoSymlinkPathComponents(
    path,
    "C6 transition qualification projection",
  );
  const bytes = await readC6StableRegularFile(
    resolvedPath,
    "transition qualification projection",
  );
  if (
    options.expectedSha256 !== undefined &&
    sha256(bytes) !== sha256Schema.parse(options.expectedSha256)
  ) {
    throw new Error("C6 transition qualification projection hash mismatch");
  }
  const projection = parseC6RealHistoryTransitionQualification(
    JSON.parse(bytes.toString("utf8")) as unknown,
  );
  assertProjectionBindsTrackedInputs(projection);
  if (
    serializeC6RealHistoryTransitionQualification(projection) !==
      bytes.toString()
  ) {
    throw new Error(
      "C6 transition qualification projection is not canonical JSON",
    );
  }
  return projection;
}

export async function replayC6RealHistoryTransitionQualification(input: {
  auditOrderPath: string;
  expectedProjectionSha256: string;
  projectionPath: string;
  trajectoryPath: string;
}): Promise<{
  auditOrderSha256: string;
  projection: C6RealHistoryTransitionQualification;
  projectionSha256: string;
  reproduced: true;
  trajectorySha256: string;
}> {
  const [trajectoryPath, auditOrderPath, projectionPath] = await Promise.all([
    assertC6NoSymlinkPathComponents(
      input.trajectoryPath,
      "C6 transition qualification replay trajectory",
    ),
    assertC6NoSymlinkPathComponents(
      input.auditOrderPath,
      "C6 transition qualification replay audit order",
    ),
    assertC6NoSymlinkPathComponents(
      input.projectionPath,
      "C6 transition qualification replay projection",
    ),
  ]);
  const [trajectoryBytes, auditOrderBytes, projectionBytes] = await Promise.all([
    readC6StableRegularFile(
      trajectoryPath,
      "transition qualification replay trajectory",
    ),
    readC6StableRegularFile(
      auditOrderPath,
      "transition qualification replay audit order",
    ),
    readC6StableRegularFile(
      projectionPath,
      "transition qualification replay projection",
    ),
  ]);
  assertTrackedInputs(trajectoryBytes, auditOrderBytes);
  const projectionSha256 = sha256(projectionBytes);
  if (
    projectionSha256 !==
      sha256Schema.parse(input.expectedProjectionSha256)
  ) {
    throw new Error("C6 transition qualification replay projection hash mismatch");
  }
  const projection = projectC6RealHistoryTransitionQualification({
    auditOrderBytes,
    auditOrderPath,
    trajectoryBytes,
    trajectoryPath,
  });
  if (
    serializeC6RealHistoryTransitionQualification(projection) !==
      projectionBytes.toString()
  ) {
    throw new Error(
      "C6 transition qualification projection does not match recomputation",
    );
  }
  await Promise.all([
    assertC6NoSymlinkPathComponents(
      trajectoryPath,
      "C6 transition qualification replay terminal trajectory",
    ),
    assertC6NoSymlinkPathComponents(
      auditOrderPath,
      "C6 transition qualification replay terminal audit order",
    ),
    assertC6NoSymlinkPathComponents(
      projectionPath,
      "C6 transition qualification replay terminal projection",
    ),
  ]);
  const [terminalTrajectoryBytes, terminalAuditOrderBytes, terminalProjection] =
    await Promise.all([
      readC6StableRegularFile(
        trajectoryPath,
        "transition qualification replay terminal trajectory",
      ),
      readC6StableRegularFile(
        auditOrderPath,
        "transition qualification replay terminal audit order",
      ),
      readC6StableRegularFile(
        projectionPath,
        "transition qualification replay terminal projection",
      ),
    ]);
  if (
    !terminalTrajectoryBytes.equals(trajectoryBytes) ||
    !terminalAuditOrderBytes.equals(auditOrderBytes) ||
    !terminalProjection.equals(projectionBytes)
  ) {
    throw new Error("C6 transition qualification replay inputs changed");
  }
  return {
    auditOrderSha256: sha256(auditOrderBytes),
    projection,
    projectionSha256,
    reproduced: true,
    trajectorySha256: sha256(trajectoryBytes),
  };
}

export function serializeC6RealHistoryTransitionQualification(
  projection: C6RealHistoryTransitionQualification,
): string {
  return `${JSON.stringify(projection, null, 2)}\n`;
}

function buildCandidates(
  trajectory: C6ReviewTrajectoryDiscovery,
  auditOrder: C6RealHistoryPrehistorySelection,
): C6RealHistoryTransitionQualification["candidates"] {
  const targetsByAnchor = new Map(
    trajectory.targets.map((target) => [target.anchorId, target]),
  );
  const candidates = auditOrder.eligibleRankClosure
    .filter((candidate) => candidate.cappedPoolRank !== null)
    .sort((left, right) =>
      left.cappedPoolRank! - right.cappedPoolRank!
    )
    .map((candidate) => {
      const target = targetsByAnchor.get(candidate.anchorId);
      if (target === undefined) {
        throw new Error(
          `C6 transition qualification missing trajectory ${candidate.anchorId}`,
        );
      }
      const sequence = candidate.linearReviewAncestry;
      const stages = [
        {
          evidence: missingRequirements(STAGE_REQUIREMENTS),
          position: 1,
          role: "original-task",
          sourceTransitionLineage: {
            afterCommit: sequence.initialCommit,
            status:
              "source-signal-only-base-and-original-request-not-bound",
          },
        },
        {
          evidence: missingRequirements(STAGE_REQUIREMENTS),
          position: 2,
          role: "first-review",
          sourceTransitionLineage: {
            afterCommit: sequence.firstFixCommit,
            beforeCommit: sequence.firstReview.reviewedCommit,
            status: "source-signal-only-not-replayed",
          },
        },
        {
          evidence: missingRequirements(STAGE_REQUIREMENTS),
          position: 3,
          role: "second-review",
          sourceTransitionLineage: {
            afterCommit: sequence.secondFixCommit,
            beforeCommit: sequence.secondReview.reviewedCommit,
            status: "source-signal-only-not-replayed",
          },
        },
      ] as const;
      return {
        anchorId: candidate.anchorId,
        auditClass: candidate.priorityRank === null
          ? "reserve" as const
          : "priority" as const,
        cappedPoolRank: candidate.cappedPoolRank!,
        currentDecision: "blocked-evidence-not-collected" as const,
        decisionReason: "qualification-evidence-not-collected" as const,
        eligibleRank: candidate.eligibleRank,
        episodeEvidence: missingRequirements(EPISODE_REQUIREMENTS),
        independentAcceptance: "not-reviewed" as const,
        machineQualification: "not-qualified" as const,
        priorityRank: candidate.priorityRank,
        repository: candidate.repository,
        source: candidate.source,
        sourceSignalAvailability: {
          failToPassCount: target.sourceTestSignals.f2pCount,
          interpretation:
            "final-source-test-signal-only-not-transition-specific-evidence" as const,
          passToPassCount: target.sourceTestSignals.p2pCount,
        },
        stages: [...stages],
      };
    });
  if (
    candidates.length !== CAPPED_CANDIDATE_COUNT ||
    candidates.some((candidate, index) =>
      candidate.cappedPoolRank !== index + 1
    )
  ) {
    throw new Error(
      "C6 transition qualification requires the complete ordered 54-candidate capped pool",
    );
  }
  return candidates;
}

function missingRequirements<T extends string>(
  requirements: readonly T[],
): Array<{ requirement: T; status: "not-collected" }> {
  return requirements.map((requirement) => ({
    requirement,
    status: "not-collected",
  }));
}

function hasExactRequirements(
  actual: ReadonlyArray<{ requirement: string }>,
  expected: readonly string[],
): boolean {
  return actual.length === expected.length &&
    actual.every((requirement, index) =>
      requirement.requirement === expected[index]
    );
}

function assertTrackedInputs(
  trajectoryBytes: Uint8Array,
  auditOrderBytes: Uint8Array,
): void {
  if (sha256(trajectoryBytes) !== C6_REAL_HISTORY_TRAJECTORY_SHA256) {
    throw new Error("C6 transition qualification trajectory hash mismatch");
  }
  if (sha256(auditOrderBytes) !== C6_REAL_HISTORY_AUDIT_ORDER_SHA256) {
    throw new Error("C6 transition qualification audit-order hash mismatch");
  }
}

function assertProjectionBindsTrackedInputs(
  projection: C6RealHistoryTransitionQualification,
): void {
  if (
    projection.inputs.trajectory.sha256 !==
      C6_REAL_HISTORY_TRAJECTORY_SHA256 ||
    projection.inputs.auditOrder.sha256 !==
      C6_REAL_HISTORY_AUDIT_ORDER_SHA256
  ) {
    throw new Error(
      "C6 transition qualification projection does not bind tracked inputs",
    );
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
