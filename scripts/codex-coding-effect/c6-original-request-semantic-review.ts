import { createHash } from "node:crypto";

import { z } from "zod";

import {
  parseC6RealHistoryOriginalRequestProjectionArtifact,
  serializeC6RealHistoryOriginalRequestProjectionArtifact,
} from "./c6-real-history-original-request-projection";

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
const receiptSchema = z.object({
  artifactKind: z.literal(
    "c6-original-request-semantic-review-receipt",
  ),
  assessments: z.array(z.object({
    anchorId: trimmedStringSchema,
    beforeCommit: commitSchema,
    beforeCommitBinding: z.literal(
      "reviewer-derived-public-ancestry-not-qualification-bound",
    ),
    cappedPoolRank: z.number().int().positive(),
    classification: z.literal("behavioral-coding-request"),
    decision: z.literal("stage1-semantic-pass"),
    finding: trimmedStringSchema,
    promptBytes: z.number().int().positive(),
    promptSha256: sha256Schema,
    stage1AfterCommit: commitSchema,
  }).strict()).min(1),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    machineQualificationCandidateCount: z.literal(0),
    stage1TransitionQualificationBound: z.literal(false),
    status: z.literal(
      "semantic-review-only-source-auth-and-machine-qualification-required",
    ),
  }).strict(),
  projection: artifactReferenceSchema,
  qualification: artifactReferenceSchema,
  review: z.object({
    authorTaskName: trimmedStringSchema,
    contextPolicy: z.literal("fork-turns-none"),
    cryptographicReceipt: z.literal(false),
    hiddenEvaluatorAccess: z.literal(false),
    outcomeAccess: z.literal(false),
    rawGoldAccess: z.literal(false),
    reviewedAt: z.iso.datetime(),
    reviewerAgentName: trimmedStringSchema,
    sourcePullTitleBodyAccess: z.literal(false),
    sourceRowAccess: z.literal(false),
  }).strict(),
  schemaVersion: z.literal(1),
}).strict();

export interface C6OriginalRequestStage1Candidate {
  anchorId: string;
  cappedPoolRank: number;
  stage1AfterCommit: string;
}

export function validateC6OriginalRequestSemanticReviewReceipt(
  input: {
    projectionArtifact: unknown;
    projectionArtifactSha256: string;
    qualificationSha256: string;
    receipt: unknown;
    stage1Candidates:
      readonly C6OriginalRequestStage1Candidate[];
  },
) {
  const artifact =
    parseC6RealHistoryOriginalRequestProjectionArtifact(
      input.projectionArtifact,
    );
  const receipt = receiptSchema.parse(input.receipt);
  const projectionSha256 = sha256(
    serializeC6RealHistoryOriginalRequestProjectionArtifact(
      artifact,
    ),
  );
  if (
    input.projectionArtifactSha256 !== projectionSha256 ||
    receipt.projection.sha256 !== projectionSha256 ||
    receipt.qualification.sha256 !== input.qualificationSha256
  ) {
    throw new Error(
      "C6 original-request semantic review input binding does not match",
    );
  }
  if (
    receipt.review.authorTaskName ===
      receipt.review.reviewerAgentName ||
    receipt.assessments.length !== artifact.projections.length ||
    receipt.assessments.length !== input.stage1Candidates.length
  ) {
    throw new Error(
      "C6 original-request semantic review provenance does not match",
    );
  }

  for (const [index, assessment] of receipt.assessments.entries()) {
    const projection = artifact.projections[index];
    const candidate = input.stage1Candidates[index];
    if (
      projection === undefined ||
      candidate === undefined ||
      assessment.anchorId !== projection.anchorId ||
      assessment.anchorId !== candidate.anchorId ||
      assessment.cappedPoolRank !== projection.cappedPoolRank ||
      assessment.cappedPoolRank !== candidate.cappedPoolRank ||
      assessment.promptBytes !== projection.originalRequest.bytes ||
      assessment.promptSha256 !==
        projection.originalRequest.sha256 ||
      assessment.stage1AfterCommit !==
        candidate.stage1AfterCommit
    ) {
      throw new Error(
        "C6 original-request semantic review assessment does not match",
      );
    }
  }

  return {
    acceptedEpisodeCount: 0 as const,
    candidateManifestFrozen: false as const,
    codexRunReady: false as const,
    externalSourceCaptureAuthenticated: false as const,
    machineQualificationCandidateCount: 0 as const,
    materializedPromptCount: artifact.projections.length,
    reviewCryptographicReceipt: false as const,
    stage1SemanticReviewPendingCount: 0 as const,
    stage1SemanticReviewedCount: receipt.assessments.length,
    stage1TransitionQualificationBound: false as const,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
