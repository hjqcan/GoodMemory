import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import type { C6AssetLock } from "./c6-asset-lock";
import {
  parseCodexCodingEffectDataset,
} from "./dataset";
import type {
  CodexCodingEffectDatasetV3,
} from "./dataset";

const REVIEW_ROOT = "provenance/task-origin/review";
const INPUT_PATH = `${REVIEW_ROOT}/input.json`;
const REQUEST_PATH = `${REVIEW_ROOT}/request.json`;
const DISPATCH_PATH = `${REVIEW_ROOT}/dispatch.json`;
const RESPONSE_PATH = `${REVIEW_ROOT}/response.json`;
const PROVENANCE_PATH = `${REVIEW_ROOT}/provenance.json`;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const trimmedStringSchema = z.string().min(1).refine(
  (value) => value.trim() === value,
  "value cannot be whitespace-padded",
);
const inputReferenceSchema = z.object({
  byteLength: z.number().int().nonnegative(),
  path: z.literal(INPUT_PATH),
  sha256: sha256Schema,
}).strict();
const requestReferenceSchema = z.object({
  byteLength: z.number().int().nonnegative(),
  path: z.literal(REQUEST_PATH),
  sha256: sha256Schema,
}).strict();
const dispatchReferenceSchema = z.object({
  byteLength: z.number().int().nonnegative(),
  path: z.literal(DISPATCH_PATH),
  sha256: sha256Schema,
}).strict();
const responseReferenceSchema = z.object({
  byteLength: z.number().int().nonnegative(),
  path: z.literal(RESPONSE_PATH),
  sha256: sha256Schema,
}).strict();
const reviewedEpisodeSchema = z.object({
  episodeId: trimmedStringSchema,
  relationshipReceipts: z.array(z.object({
    bytes: z.number().int().positive(),
    edgeId: trimmedStringSchema,
    laterStageId: trimmedStringSchema,
    path: trimmedStringSchema,
    priorStageId: trimmedStringSchema,
    sha256: sha256Schema,
  }).strict()).min(1),
  receiptSha256: sha256Schema,
  sourceRecordSha256: sha256Schema,
  stageOriginReceipts: z.array(z.object({
    bytes: z.number().int().positive(),
    path: trimmedStringSchema,
    sha256: sha256Schema,
    stageId: trimmedStringSchema,
  }).strict()).min(1),
  taskContentSha256: sha256Schema,
}).strict();
const inputSchema = z.object({
  datasetId: trimmedStringSchema,
  reviewedEpisodes: z.array(reviewedEpisodeSchema).min(1),
  schemaVersion: z.literal(5),
}).strict();
const requestSchema = z.object({
  input: inputReferenceSchema,
  rawGoldAccess: z.literal(false),
  runOutcomeAccess: z.literal(false),
  requiredChecks: z.tuple([
    z.literal("source-record-matches-original-request"),
    z.literal("source-record-matches-agent-visible-task"),
    z.literal("repository-source-is-immutable"),
    z.literal("source-record-covers-every-stage"),
    z.literal("upstream-receipt-matches-every-stage"),
    z.literal(
      "relationship-receipt-proves-created-merge-created-order",
    ),
    z.literal(
      "relationship-receipt-proves-prior-merge-ancestry",
    ),
    z.literal(
      "prior-completion-semantically-implements-prior-request",
    ),
    z.literal(
      "later-request-has-concrete-prior-task-dependency",
    ),
  ]),
  schemaVersion: z.literal(5),
  task: z.literal("independent-task-origin-and-relationship-review-v5"),
}).strict();
const dispatchSchema = z.object({
  authorTaskName: trimmedStringSchema,
  contextPolicy: z.literal("fork-turns-none"),
  input: inputReferenceSchema,
  request: requestReferenceSchema,
  requestedTaskName: z.literal("c6_task_origin_review_v5"),
  responsePath: z.literal(RESPONSE_PATH),
  reviewerAgentName: trimmedStringSchema,
  schemaVersion: z.literal(5),
}).strict();
const relationshipDecisionSchema = z.object({
  decision: z.literal("accepted"),
  dependencyBasis: z.enum([
    "explicit-reference",
    "follow-up-correction",
    "prior-introduced-behavior",
    "prior-produced-artifact",
  ]),
  edgeId: trimmedStringSchema,
  episodeId: trimmedStringSchema,
  laterRequestDependsOnPriorTask: z.literal(true),
  priorCompletionMatchesPriorRequest: z.literal(true),
  rationale: trimmedStringSchema,
  relationshipReceiptSha256: sha256Schema,
}).strict();
const responseSchema = z.object({
  blockingFindings: z.array(trimmedStringSchema),
  datasetId: trimmedStringSchema,
  decision: z.literal("accepted"),
  inputSha256: sha256Schema,
  requestSha256: sha256Schema,
  relationshipDecisions: z.array(relationshipDecisionSchema).min(1),
  reviewedAt: z.iso.datetime(),
  reviewedEpisodeCount: z.number().int().positive(),
  reviewedEpisodeIdsSha256: sha256Schema,
  reviewerAgentName: trimmedStringSchema,
  schemaVersion: z.literal(5),
}).strict();
const provenanceSchema = z.object({
  authorTaskName: trimmedStringSchema,
  dispatch: dispatchReferenceSchema,
  input: inputReferenceSchema,
  recordedAt: z.iso.datetime(),
  request: requestReferenceSchema,
  response: responseReferenceSchema,
  reviewer: z.object({
    agentName: trimmedStringSchema,
    contextPolicy: z.literal("fork-turns-none"),
    orchestratorAttestation: z.object({
      attestedByTaskName: trimmedStringSchema,
      basis: z.literal(
        "orchestrator-observed-dispatch-no-cryptographic-receipt",
      ),
      cryptographicReceipt: z.literal(false),
    }).strict(),
    requestedTaskName: z.literal("c6_task_origin_review_v5"),
    type: z.literal("independent-ai-agent"),
  }).strict(),
  schemaVersion: z.literal(5),
}).strict();

export interface C6TaskOriginReviewEvidence {
  cryptographicReceipt: false;
  dispatchSha256: string;
  inputSha256: string;
  provenanceSha256: string;
  relationshipDecisionCount: number;
  relationshipDecisionIdentitySetSha256: string;
  requestSha256: string;
  responseSha256: string;
  reviewedEpisodeIdsSha256: string;
  reviewedAt: string;
  reviewerAgentName: string;
}

export function assertC6RelationshipReviewDecisionCoverage(
  expected: ReadonlyArray<{
    edgeId: string;
    episodeId: string;
    relationshipReceiptSha256: string;
  }>,
  actual: ReadonlyArray<{
    edgeId: string;
    episodeId: string;
    relationshipReceiptSha256: string;
  }>,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      "C6 task-origin review relationship decisions do not cover the exact edge set",
    );
  }
}

export async function validateC6TaskOriginReviewProvenance(input: {
  assetLock: C6AssetLock;
  dataset: CodexCodingEffectDatasetV3;
  datasetRoot: string;
  taskContentSha256ByEpisodeId: Readonly<Record<string, string>>;
  taskOriginEvidenceByEpisodeId: Readonly<Record<string, {
    relationshipEdges: ReadonlyArray<{
      edgeId: string;
      laterStageId: string;
      priorStageId: string;
      relationshipReceiptBytes: number;
      relationshipReceiptPath: string;
      relationshipReceiptSha256: string;
    }>;
    receiptSha256: string;
    sourceRecordSha256: string;
    stageOrigins: ReadonlyArray<{
      originReceiptBytes: number;
      originReceiptPath: string;
      originReceiptSha256: string;
      stageId: string;
    }>;
  }>>;
}): Promise<C6TaskOriginReviewEvidence> {
  if (Number(input.dataset.schemaVersion) !== 3) {
    throw new Error(
      "C6 task-origin review requires dataset schema version 3",
    );
  }
  parseCodexCodingEffectDataset(input.dataset);
  const reference = input.dataset.taskOriginReviewProvenance;
  if (reference === undefined) {
    throw new Error(
      "C6 task-origin review provenance is required before candidate freeze",
    );
  }
  if (reference.path !== PROVENANCE_PATH) {
    throw new Error("C6 task-origin review provenance path is invalid");
  }
  const filesByPath = new Map(
    input.assetLock.files.map((file) => [file.path, file]),
  );
  const provenanceBytes = await readLockedArtifact({
    datasetRoot: input.datasetRoot,
    expectedSha256: reference.sha256,
    filesByPath,
    label: "task-origin review provenance",
    path: PROVENANCE_PATH,
  });
  const provenance = parseCanonical(
    provenanceBytes,
    provenanceSchema,
    "task-origin review provenance",
  );
  const [inputBytes, requestBytes, dispatchBytes, responseBytes] =
    await Promise.all([
      readReferencedArtifact(
        input.datasetRoot,
        filesByPath,
        provenance.input,
        "task-origin review input",
      ).catch(() => {
        throw new Error(
          "C6 task-origin review provenance does not bind its input",
        );
      }),
      readReferencedArtifact(
        input.datasetRoot,
        filesByPath,
        provenance.request,
        "task-origin review request",
      ).catch(() => {
        throw new Error(
          "C6 task-origin review provenance does not bind its request",
        );
      }),
      readReferencedArtifact(
        input.datasetRoot,
        filesByPath,
        provenance.dispatch,
        "task-origin review dispatch",
      ).catch(() => {
        throw new Error(
          "C6 task-origin review provenance does not bind its dispatch",
        );
      }),
      readReferencedArtifact(
        input.datasetRoot,
        filesByPath,
        provenance.response,
        "task-origin review response",
      ).catch(() => {
        throw new Error(
          "C6 task-origin review provenance does not bind its response",
        );
      }),
    ]);
  const reviewInput = parseCanonical(
    inputBytes,
    inputSchema,
    "task-origin review input",
  );
  const request = parseCanonical(
    requestBytes,
    requestSchema,
    "task-origin review request",
  );
  const dispatch = parseCanonical(
    dispatchBytes,
    dispatchSchema,
    "task-origin review dispatch",
  );
  const response = parseCanonical(
    responseBytes,
    responseSchema,
    "task-origin review response",
  );

  if (
    !artifactReferenceMatches(request.input, inputBytes) ||
    !artifactReferenceMatches(dispatch.input, inputBytes) ||
    !artifactReferenceMatches(dispatch.request, requestBytes) ||
    dispatch.responsePath !== RESPONSE_PATH
  ) {
    throw new Error(
      "C6 task-origin review request or dispatch is evidence-unbound",
    );
  }
  if (
    provenance.authorTaskName !== dispatch.authorTaskName ||
    provenance.reviewer.agentName !== dispatch.reviewerAgentName ||
    provenance.reviewer.agentName !== response.reviewerAgentName ||
    provenance.reviewer.contextPolicy !== dispatch.contextPolicy ||
    provenance.reviewer.requestedTaskName !== dispatch.requestedTaskName ||
    provenance.recordedAt !== response.reviewedAt ||
    provenance.reviewer.orchestratorAttestation.attestedByTaskName !==
      provenance.authorTaskName ||
    provenance.authorTaskName === provenance.reviewer.agentName ||
    input.dataset.episodes.some((episode) =>
      episode.author === provenance.reviewer.agentName
    )
  ) {
    throw new Error("C6 task-origin review provenance is not independent");
  }
  const expectedReviewedEpisodes = input.dataset.episodes
    .filter((episode) => episode.sourceType !== "controlled-mutation")
    .map((episode) => {
      const evidence = input.taskOriginEvidenceByEpisodeId[episode.id];
      const taskContentSha256 =
        input.taskContentSha256ByEpisodeId[episode.id];
      if (evidence === undefined || taskContentSha256 === undefined) {
        throw new Error(
          `C6 task-origin review input is missing episode ${episode.id}`,
        );
      }
      return {
        episodeId: episode.id,
        relationshipReceipts: evidence.relationshipEdges.map((edge) => ({
          bytes: edge.relationshipReceiptBytes,
          edgeId: edge.edgeId,
          laterStageId: edge.laterStageId,
          path: edge.relationshipReceiptPath,
          priorStageId: edge.priorStageId,
          sha256: edge.relationshipReceiptSha256,
        })),
        receiptSha256: evidence.receiptSha256,
        sourceRecordSha256: evidence.sourceRecordSha256,
        stageOriginReceipts: evidence.stageOrigins.map((stage) => ({
          bytes: stage.originReceiptBytes,
          path: stage.originReceiptPath,
          sha256: stage.originReceiptSha256,
          stageId: stage.stageId,
        })),
        taskContentSha256,
      };
    });
  if (
    reviewInput.datasetId !== input.dataset.datasetId ||
    JSON.stringify(reviewInput.reviewedEpisodes) !==
      JSON.stringify(expectedReviewedEpisodes)
  ) {
    throw new Error(
      "C6 task-origin review input does not bind the candidate episodes",
    );
  }
  const reviewedEpisodeIdsSha256 = sha256(JSON.stringify(
    expectedReviewedEpisodes.map((episode) => episode.episodeId),
  ));
  const expectedRelationshipDecisions = expectedReviewedEpisodes.flatMap(
    (episode) => episode.relationshipReceipts.map((relationship) => ({
      edgeId: relationship.edgeId,
      episodeId: episode.episodeId,
      relationshipReceiptSha256: relationship.sha256,
    })),
  );
  const actualRelationshipDecisions = response.relationshipDecisions.map(
    (decision) => ({
      edgeId: decision.edgeId,
      episodeId: decision.episodeId,
      relationshipReceiptSha256:
        decision.relationshipReceiptSha256,
    }),
  );
  assertC6RelationshipReviewDecisionCoverage(
    expectedRelationshipDecisions,
    actualRelationshipDecisions,
  );
  if (
    response.datasetId !== input.dataset.datasetId ||
    response.inputSha256 !== sha256(inputBytes) ||
    response.requestSha256 !== sha256(requestBytes) ||
    response.reviewedEpisodeCount !== expectedReviewedEpisodes.length ||
    response.reviewedEpisodeIdsSha256 !== reviewedEpisodeIdsSha256 ||
    response.blockingFindings.length > 0
  ) {
    throw new Error(
      "C6 task-origin review response does not accept the bound input",
    );
  }
  return {
    cryptographicReceipt: false,
    dispatchSha256: sha256(dispatchBytes),
    inputSha256: sha256(inputBytes),
    provenanceSha256: sha256(provenanceBytes),
    relationshipDecisionCount:
      response.relationshipDecisions.length,
    relationshipDecisionIdentitySetSha256: sha256(
      JSON.stringify(actualRelationshipDecisions),
    ),
    requestSha256: sha256(requestBytes),
    responseSha256: sha256(responseBytes),
    reviewedAt: response.reviewedAt,
    reviewedEpisodeIdsSha256,
    reviewerAgentName: provenance.reviewer.agentName,
  };
}

async function readReferencedArtifact(
  datasetRoot: string,
  filesByPath: ReadonlyMap<string, { bytes: number; sha256: string }>,
  reference: { byteLength: number; path: string; sha256: string },
  label: string,
): Promise<string> {
  const bytes = await readLockedArtifact({
    datasetRoot,
    expectedSha256: reference.sha256,
    filesByPath,
    label,
    path: reference.path,
  });
  if (Buffer.byteLength(bytes) !== reference.byteLength) {
    throw new Error(`C6 ${label} byte length does not match`);
  }
  return bytes;
}

async function readLockedArtifact(input: {
  datasetRoot: string;
  expectedSha256: string;
  filesByPath: ReadonlyMap<string, { bytes: number; sha256: string }>;
  label: string;
  path: string;
}): Promise<string> {
  const locked = input.filesByPath.get(input.path);
  if (
    locked === undefined ||
    locked.sha256 !== input.expectedSha256
  ) {
    throw new Error(`C6 ${input.label} does not match the asset lock`);
  }
  const path = resolve(input.datasetRoot, input.path);
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const before = await handle.stat();
    if (!before.isFile()) {
      throw new Error(`C6 ${input.label} must be a regular file`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.mode !== after.mode ||
      before.mtimeMs !== after.mtimeMs ||
      before.size !== after.size ||
      bytes.byteLength !== locked.bytes ||
      bytes.byteLength !== after.size ||
      sha256(bytes) !== input.expectedSha256
    ) {
      throw new Error(`C6 ${input.label} bytes do not match`);
    }
    return bytes.toString("utf8");
  } finally {
    await handle.close();
  }
}

function artifactReferenceMatches(
  reference: { byteLength: number; sha256: string },
  bytes: string,
): boolean {
  return reference.byteLength === Buffer.byteLength(bytes) &&
    reference.sha256 === sha256(bytes);
}

function parseCanonical<T>(
  bytes: string,
  schema: z.ZodType<T>,
  label: string,
): T {
  const parsed = schema.safeParse(JSON.parse(bytes) as unknown);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `invalid C6 ${label}: ${issue?.path.join(".")}: ${issue?.message}`,
    );
  }
  if (bytes !== `${JSON.stringify(parsed.data, null, 2)}\n`) {
    throw new Error(`invalid C6 ${label}`);
  }
  return parsed.data;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
