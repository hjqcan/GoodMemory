import { createHash } from "node:crypto";

import { z } from "zod";

import type {
  C6RealHistoryTransitionQualification,
} from "./c6-real-history-transition-qualification";
import {
  C6_MULTI_SWE_ORIGINAL_REQUEST_POLICY,
} from "./c6-multi-swe-original-request";
import type {
  C6ReviewTrajectoryDiscovery,
} from "./c6-review-trajectory-discovery";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const trimmedStringSchema = z.string().min(1).refine(
  (value) => value.trim() === value,
  "value cannot be whitespace-padded",
);
const artifactReferenceSchema = z.object({
  path: trimmedStringSchema,
  sha256: sha256Schema,
}).strict();
const stageSchema = z.object({
  afterCommit: commitSchema,
  beforeCommit: commitSchema.nullable(),
  classification: z.enum([
    "behavioral-coding-request",
    "behavioral-request-transition-mismatch",
    "ambiguous-review-request",
    "non-behavioral-style-only",
  ]),
  finding: trimmedStringSchema,
  position: z.number().int().min(1).max(3),
  targetKind: z.enum(["review", "review-comment", "source-row"]),
  targetSha256: sha256Schema,
}).strict();
const reviewSchema = z.object({
  assessmentSha256: sha256Schema,
  authorTaskName: trimmedStringSchema,
  contextPolicy: z.enum(["fork-turns-none", "fork-turns-3"]),
  cryptographicReceipt: z.literal(false),
  hiddenEvaluatorAccess: z.literal(false),
  outcomeAccess: z.literal(false),
  rawGoldAccess: z.literal(false),
  reviewedAt: z.iso.datetime(),
  reviewerAgentName: trimmedStringSchema,
}).strict();
const assessmentSchema = z.object({
  anchorId: trimmedStringSchema,
  blockingStagePositions: z.array(
    z.number().int().min(1).max(3),
  ),
  cappedPoolRank: z.number().int().positive(),
  decisionReason: z.enum([
    "semantic-dependency-rejected",
    "semantic-screening-passed-machine-qualification-required",
  ]),
  finding: trimmedStringSchema,
  screeningDecision: z.enum([
    "continue-machine-qualification",
    "reject",
  ]),
  stages: z.array(stageSchema).length(3),
  review: reviewSchema,
}).strict();
const ledgerSchema = z.object({
  artifactKind: z.literal("c6-real-history-semantic-screening-ledger"),
  assessments: z.array(assessmentSchema).min(1),
  originalRequestConstruction: z.object({
    agentVisiblePromptProjectionCount: z.literal(0),
    policy: z.literal(C6_MULTI_SWE_ORIGINAL_REQUEST_POLICY),
    sourcePullTitleBodyExcluded: z.literal(true),
    stage1Binding: z.literal(
      "source-row-only-agent-visible-prompt-not-materialized",
    ),
    status: z.literal(
      "policy-defined-projection-materialization-required",
    ),
  }).strict(),
  qualification: artifactReferenceSchema,
  schemaVersion: z.literal(3),
  trajectory: artifactReferenceSchema,
}).strict();

export interface C6RealHistorySemanticScreeningEvidence {
  acceptedEpisodeCount: 0;
  assessedCandidateCount: number;
  candidateManifestFrozen: false;
  codexRunReady: false;
  laterStageContinuationCount: number;
  machineQualificationCandidateCount: 0;
  nextUnauditedCappedPoolRank: number;
  originalRequestProjectionCount: 0;
  rejectedCandidateCount: number;
  reviewCryptographicReceipt: false;
  semanticScreeningOnly: true;
  stage1AgentVisibleRequestsBound: false;
}

export interface C6RealHistorySemanticScreeningLedgerState {
  assessedCandidateCount: number;
  continuationAnchorIds: string[];
  nextUnauditedCappedPoolRank: number;
  rejectedAnchorIds: string[];
  rejectedCandidateCount: number;
}

export function inspectC6RealHistorySemanticScreeningLedger(
  ledger: unknown,
): C6RealHistorySemanticScreeningLedgerState {
  const assessments = ledgerSchema.parse(ledger).assessments;
  const rejectedAnchorIds = assessments
    .filter((assessment) => assessment.screeningDecision === "reject")
    .map((assessment) => assessment.anchorId);
  return {
    assessedCandidateCount: assessments.length,
    continuationAnchorIds: assessments
      .filter((assessment) =>
        assessment.screeningDecision === "continue-machine-qualification"
      )
      .map((assessment) => assessment.anchorId),
    nextUnauditedCappedPoolRank: assessments.length + 1,
    rejectedAnchorIds,
    rejectedCandidateCount: rejectedAnchorIds.length,
  };
}

export function listC6RealHistorySemanticRejectedAnchorIds(
  ledger: unknown,
): string[] {
  return inspectC6RealHistorySemanticScreeningLedger(
    ledger,
  ).rejectedAnchorIds;
}

export function validateC6RealHistorySemanticScreening(input: {
  ledger: unknown;
  qualification: C6RealHistoryTransitionQualification;
  trajectory: C6ReviewTrajectoryDiscovery;
}): C6RealHistorySemanticScreeningEvidence {
  const ledger = ledgerSchema.parse(input.ledger);
  assertArtifactBinding(
    ledger.qualification,
    input.qualification,
    "qualification intake",
  );
  assertArtifactBinding(
    ledger.trajectory,
    input.trajectory,
    "trajectory discovery",
  );
  if (
    input.qualification.boundary.acceptedEpisodeCount !== 0 ||
    input.qualification.boundary.machineQualifiedCount !== 0 ||
    input.trajectory.boundary.acceptedEpisodeCount !== 0
  ) {
    throw new Error(
      "C6 semantic screening inputs exceed the source-intake boundary",
    );
  }

  for (const [index, assessment] of ledger.assessments.entries()) {
    if (
      assessment.review.authorTaskName ===
        assessment.review.reviewerAgentName
    ) {
      throw new Error(
        `C6 semantic screening reviewer ${index + 1} is not independent`,
      );
    }
    const { review, ...reviewedAssessment } = assessment;
    if (
      review.assessmentSha256 !==
        sha256(JSON.stringify(reviewedAssessment))
    ) {
      throw new Error(
        `C6 semantic screening assessment ${index + 1} hash does not match`,
      );
    }
    const expectedRank = index + 1;
    if (assessment.cappedPoolRank !== expectedRank) {
      throw new Error(
        "C6 semantic screening must assess the capped rank prefix without gaps",
      );
    }
    const candidate = input.qualification.candidates[index];
    const trajectoryTarget = input.trajectory.targets.find((target) =>
      target.anchorId === assessment.anchorId
    );
    if (
      candidate === undefined ||
      candidate.cappedPoolRank !== assessment.cappedPoolRank ||
      candidate.anchorId !== assessment.anchorId ||
      trajectoryTarget === undefined ||
      trajectoryTarget.source.rowSha256 !== candidate.source.rowSha256 ||
      trajectoryTarget.rest.status !== "strict-rest-closure" ||
      trajectoryTarget.rest.linearReviewAncestrySequence === null
    ) {
      throw new Error(
        `C6 semantic screening assessment ${assessment.cappedPoolRank} does not match the frozen candidate`,
      );
    }
    const stageOneRequestEvidence = candidate.stages[0]?.evidence.find(
      (entry) => entry.requirement === "agent-visible-target-request",
    );
    if (stageOneRequestEvidence?.status !== "not-collected") {
      throw new Error(
        "C6 semantic screening cannot predate a materialized stage-1 agent-visible request",
      );
    }
    const sequence =
      trajectoryTarget.rest.linearReviewAncestrySequence;
    for (const [stageIndex, stage] of assessment.stages.entries()) {
      const expectedPosition = stageIndex + 1;
      const candidateStage = candidate.stages[stageIndex];
      if (
        stage.position !== expectedPosition ||
        candidateStage === undefined ||
        stage.afterCommit !==
          candidateStage.sourceTransitionLineage.afterCommit ||
        stage.beforeCommit !== (
          "beforeCommit" in candidateStage.sourceTransitionLineage
            ? candidateStage.sourceTransitionLineage.beforeCommit
            : null
        )
      ) {
        throw new Error(
          `C6 semantic screening stage ${assessment.cappedPoolRank}/${expectedPosition} does not match transition lineage`,
        );
      }
      if (
        expectedPosition === 1 &&
        stage.beforeCommit === null &&
        stage.classification ===
          "behavioral-request-transition-mismatch"
      ) {
        throw new Error(
          "C6 semantic screening cannot classify an unbound stage-1 transition as mismatched",
        );
      }
      const expectedTarget = expectedPosition === 1
        ? {
          kind: "source-row" as const,
          sha256: candidate.source.rowSha256,
        }
        : expectedPosition === 2
        ? {
          kind: sequence.firstReview.source,
          sha256: sequence.firstReview.bodySha256,
        }
        : {
          kind: sequence.secondReview.source,
          sha256: sequence.secondReview.bodySha256,
        };
      if (
        stage.targetKind !== expectedTarget.kind ||
        stage.targetSha256 !== expectedTarget.sha256
      ) {
        throw new Error(
          `C6 semantic screening stage ${assessment.cappedPoolRank}/${expectedPosition} target does not match source request`,
        );
      }
    }
    const blockingStagePositions = assessment.stages
      .filter((stage) =>
        stage.classification !== "behavioral-coding-request"
      )
      .map((stage) => stage.position);
    if (
      JSON.stringify(assessment.blockingStagePositions) !==
        JSON.stringify(blockingStagePositions)
    ) {
      throw new Error(
        "C6 semantic screening blocking stages do not match classifications",
      );
    }
    if (assessment.screeningDecision === "reject") {
      if (blockingStagePositions.length === 0) {
        throw new Error(
          "C6 semantic screening rejection requires at least one semantic blocker",
        );
      }
      if (assessment.decisionReason !== "semantic-dependency-rejected") {
        throw new Error(
          "C6 semantic screening rejection reason does not match",
        );
      }
    } else if (
      blockingStagePositions.length > 0 ||
      assessment.decisionReason !==
        "semantic-screening-passed-machine-qualification-required"
    ) {
      throw new Error(
        "C6 semantic screening continuation cannot retain blockers",
      );
    }
  }

  const rejectedCandidateCount = ledger.assessments.filter((assessment) =>
    assessment.screeningDecision === "reject"
  ).length;
  return {
    acceptedEpisodeCount: 0,
    assessedCandidateCount: ledger.assessments.length,
    candidateManifestFrozen: false,
    codexRunReady: false,
    laterStageContinuationCount:
      ledger.assessments.length - rejectedCandidateCount,
    machineQualificationCandidateCount: 0,
    nextUnauditedCappedPoolRank: ledger.assessments.length + 1,
    originalRequestProjectionCount:
      ledger.originalRequestConstruction
        .agentVisiblePromptProjectionCount,
    rejectedCandidateCount,
    reviewCryptographicReceipt: false,
    semanticScreeningOnly: true,
    stage1AgentVisibleRequestsBound: false,
  };
}

function assertArtifactBinding(
  reference: z.infer<typeof artifactReferenceSchema>,
  value: unknown,
  label: string,
): void {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  if (sha256(bytes) !== reference.sha256) {
    throw new Error(`C6 semantic screening ${label} hash does not match`);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
