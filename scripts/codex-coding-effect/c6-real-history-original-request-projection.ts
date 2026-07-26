import { createHash } from "node:crypto";

import { z } from "zod";

import {
  C6_MULTI_SWE_ORIGINAL_REQUEST_POLICY,
  constructC6MultiSWEOriginalRequest,
} from "./c6-multi-swe-original-request";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const sourceSchema = z.object({
  fileBytes: z.number().int().positive(),
  fileSha256: sha256Schema,
  path: z.string().min(1),
  rowIndex: z.number().int().positive(),
  rowSha256: sha256Schema,
}).strict();
const resolvedIssueSchema = z.object({
  body: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string().min(1),
}).strict();
const projectionSchema = z.object({
  anchorId: z.string().regex(/^[^/#]+\/[^/#]+#[1-9]\d*$/u),
  cappedPoolRank: z.number().int().positive(),
  originalRequest: z.object({
    bytes: z.number().int().positive(),
    sha256: sha256Schema,
    value: z.string().min(1),
  }).strict(),
  recording: z.object({
    externalSourceCaptureAuthenticated: z.literal(false),
    fullSourceFileRetained: z.literal(false),
    fullSourceRowRetained: z.literal(false),
    projectionProvesUpstreamAuthenticity: z.literal(false),
  }).strict(),
  resolvedIssueRecordSha256: sha256Schema,
  resolvedIssues: z.array(resolvedIssueSchema).min(1),
  source: sourceSchema,
  sourcePullExcluded: z.object({
    bodySha256: sha256Schema,
    titleSha256: sha256Schema,
  }).strict(),
}).strict();
const artifactSchema = z.object({
  artifactKind: z.literal(
    "c6-real-history-original-request-projection",
  ),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    machineQualificationCandidateCount: z.literal(0),
  }).strict(),
  policy: z.literal(C6_MULTI_SWE_ORIGINAL_REQUEST_POLICY),
  projections: z.array(projectionSchema).min(1),
  recording: z.object({
    exactSourceFilesRequiredForReplay: z.literal(true),
    externalSourceCaptureAuthenticated: z.literal(false),
    independentReviewComplete: z.literal(false),
  }).strict(),
  schemaVersion: z.literal(1),
  source: z.object({
    datasetId: z.literal("ByteDance-Seed/Multi-SWE-bench"),
    inventorySha256: sha256Schema,
    revision: commitSchema,
  }).strict(),
}).strict();
const sourceRowSchema = z.object({
  body: z.string(),
  instance_id: z.string().min(1),
  number: z.number().int().positive(),
  org: z.string().min(1),
  repo: z.string().min(1),
  resolved_issues: z.array(z.object({
    body: z.string(),
    number: z.number().int().positive(),
    title: z.string(),
  }).strict()).min(1),
  title: z.string(),
}).passthrough();

export type C6RealHistoryOriginalRequestProjection =
  z.infer<typeof projectionSchema>;
export type C6RealHistoryOriginalRequestProjectionArtifact =
  z.infer<typeof artifactSchema>;

export interface C6OriginalRequestContinuationCandidate {
  anchorId: string;
  cappedPoolRank: number;
  source: {
    path: string;
    rowIndex: number;
    rowSha256: string;
  };
}

export function createC6RealHistoryOriginalRequestProjection(
  input: {
    anchorId: string;
    cappedPoolRank: number;
    rawRecord: string;
    source: z.input<typeof sourceSchema>;
  },
): C6RealHistoryOriginalRequestProjection {
  const source = sourceSchema.parse(input.source);
  if (
    !input.rawRecord.endsWith("\n") ||
    sha256(input.rawRecord) !== source.rowSha256
  ) {
    throw new Error(
      "C6 original-request projection source row does not match",
    );
  }
  const row = sourceRowSchema.parse(
    JSON.parse(input.rawRecord.slice(0, -1)) as unknown,
  );
  if (
    `${row.org}/${row.repo}#${row.number}` !== input.anchorId ||
    row.instance_id !==
      `${row.org}__${row.repo}-${row.number}`
  ) {
    throw new Error(
      "C6 original-request projection candidate does not match source row",
    );
  }
  const request = constructC6MultiSWEOriginalRequest(row);
  return projectionSchema.parse({
    anchorId: input.anchorId,
    cappedPoolRank: input.cappedPoolRank,
    originalRequest: {
      bytes: Buffer.byteLength(request.originalRequest),
      sha256: request.originalRequestSha256,
      value: request.originalRequest,
    },
    recording: {
      externalSourceCaptureAuthenticated: false,
      fullSourceFileRetained: false,
      fullSourceRowRetained: false,
      projectionProvesUpstreamAuthenticity: false,
    },
    resolvedIssueRecordSha256:
      request.resolvedIssueRecordSha256,
    resolvedIssues: request.resolvedIssues,
    source,
    sourcePullExcluded: {
      bodySha256: sha256(row.body),
      titleSha256: sha256(row.title),
    },
  });
}

export function parseC6RealHistoryOriginalRequestProjectionArtifact(
  value: unknown,
): C6RealHistoryOriginalRequestProjectionArtifact {
  return artifactSchema.parse(value);
}

export function validateC6RealHistoryOriginalRequestProjectionArtifact(
  input: {
    artifact: unknown;
    continuationCandidates:
      readonly C6OriginalRequestContinuationCandidate[];
  },
) {
  const artifact =
    parseC6RealHistoryOriginalRequestProjectionArtifact(
      input.artifact,
    );
  if (
    artifact.projections.length !==
      input.continuationCandidates.length
  ) {
    throw new Error(
      "C6 original-request projections do not cover semantic continuations",
    );
  }
  const seen = new Set<string>();
  for (const [index, projection] of artifact.projections.entries()) {
    const candidate = input.continuationCandidates[index];
    if (
      candidate === undefined ||
      projection.anchorId !== candidate.anchorId ||
      projection.cappedPoolRank !== candidate.cappedPoolRank ||
      projection.source.path !== candidate.source.path ||
      projection.source.rowIndex !== candidate.source.rowIndex ||
      projection.source.rowSha256 !== candidate.source.rowSha256 ||
      seen.has(projection.anchorId)
    ) {
      throw new Error(
        "C6 original-request projection does not match continuation order",
      );
    }
    seen.add(projection.anchorId);
    if (
      Buffer.byteLength(projection.originalRequest.value) !==
        projection.originalRequest.bytes ||
      sha256(projection.originalRequest.value) !==
        projection.originalRequest.sha256
    ) {
      throw new Error(
        "C6 original-request projection prompt bytes do not match",
      );
    }
    const derived = constructC6MultiSWEOriginalRequest({
      body: "excluded",
      resolved_issues: projection.resolvedIssues,
      title: "excluded",
    });
    if (
      JSON.stringify(derived.resolvedIssues) !==
        JSON.stringify(projection.resolvedIssues) ||
      derived.resolvedIssueRecordSha256 !==
        projection.resolvedIssueRecordSha256 ||
      derived.originalRequest !== projection.originalRequest.value ||
      derived.originalRequestSha256 !==
        projection.originalRequest.sha256
    ) {
      throw new Error(
        "C6 original-request projection prompt derivation does not match",
      );
    }
  }
  return {
    acceptedEpisodeCount: 0 as const,
    candidateManifestFrozen: false as const,
    codexRunReady: false as const,
    machineQualificationCandidateCount: 0 as const,
    materializedPromptCount: artifact.projections.length,
    promptDerivationVerified: true as const,
    stage1SemanticReviewPendingCount:
      artifact.projections.length,
    upstreamSourceAuthenticated: false as const,
  };
}

export function serializeC6RealHistoryOriginalRequestProjectionArtifact(
  artifact: C6RealHistoryOriginalRequestProjectionArtifact,
): string {
  return `${JSON.stringify(artifactSchema.parse(artifact), null, 2)}\n`;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
