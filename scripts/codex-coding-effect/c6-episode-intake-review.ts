import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { z } from "zod";

import type { C6AssetLock } from "./c6-asset-lock";

const REVIEW_ROOT = "provenance/episode-intake-review";
const INPUT_PATH = `${REVIEW_ROOT}/input.json`;
const REQUEST_PATH = `${REVIEW_ROOT}/request.json`;
const DISPATCH_PATH = `${REVIEW_ROOT}/dispatch.json`;
const RESPONSE_PATH = `${REVIEW_ROOT}/response.json`;
const PROVENANCE_PATH = `${REVIEW_ROOT}/provenance.json`;

const REQUIRED_CHECKS = [
  "complete-constructed-candidate-universe",
  "canonical-origin-anchor",
  "semantic-family-partition",
  "same-origin-anchor-same-family",
  "same-coding-task-surface-same-family",
  "deterministic-family-representative",
  "representative-selected-or-qualified-reserve",
  "non-representative-semantic-duplicate",
  "selected-and-qualified-reserve-sets-complete",
  "selected-set-matches-final-dataset",
] as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const trimmedStringSchema = z.string().min(1).refine(
  (value) => value.trim() === value,
  "value cannot be whitespace-padded",
);
const relativePathSchema = trimmedStringSchema.refine(
  (value) =>
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((part) =>
      part.length > 0 && part !== "." && part !== ".."
    ),
  "path must be a normalized relative path",
);
const httpsUrlSchema = z.url().refine(
  (value) => new URL(value).protocol === "https:",
  "URL must use HTTPS",
);
const artifactReferenceSchema = z.object({
  byteLength: z.number().int().nonnegative(),
  path: relativePathSchema,
  sha256: sha256Schema,
}).strict();
const inputReferenceSchema = artifactReferenceSchema.extend({
  path: z.literal(INPUT_PATH),
}).strict();
const requestReferenceSchema = artifactReferenceSchema.extend({
  path: z.literal(REQUEST_PATH),
}).strict();
const dispatchReferenceSchema = artifactReferenceSchema.extend({
  path: z.literal(DISPATCH_PATH),
}).strict();
const responseReferenceSchema = artifactReferenceSchema.extend({
  path: z.literal(RESPONSE_PATH),
}).strict();
const originTargetSchema = z.object({
  locator: trimmedStringSchema,
  stageId: trimmedStringSchema,
  upstreamItemRevision: trimmedStringSchema,
}).strict();
const originAnchorSchema = z.object({
  algorithm: z.literal("repository-and-ordered-origin-items-v1"),
  orderedTargets: z.array(originTargetSchema).min(1),
  repositoryUrl: httpsUrlSchema,
  sha256: sha256Schema,
}).strict();
const candidateSchema = z.object({
  author: trimmedStringSchema,
  candidateId: trimmedStringSchema,
  codingTaskSurfaceSha256: sha256Schema,
  fullAgentVisibleInputSha256: sha256Schema,
  originAnchor: originAnchorSchema,
  selectionRankSha256: sha256Schema,
}).strict();
const inputSchema = z.object({
  candidates: z.array(candidateSchema).min(1),
  schemaVersion: z.literal(2),
  sourceIntakeClosure: artifactReferenceSchema,
  sourceIntakeProjection: artifactReferenceSchema,
}).strict();
const requestSchema = z.object({
  hiddenEvaluatorAccess: z.literal(false),
  input: inputReferenceSchema,
  outcomeAccess: z.literal(false),
  rawGoldAccess: z.literal(false),
  requiredChecks: z.tuple([
    z.literal(REQUIRED_CHECKS[0]),
    z.literal(REQUIRED_CHECKS[1]),
    z.literal(REQUIRED_CHECKS[2]),
    z.literal(REQUIRED_CHECKS[3]),
    z.literal(REQUIRED_CHECKS[4]),
    z.literal(REQUIRED_CHECKS[5]),
    z.literal(REQUIRED_CHECKS[6]),
    z.literal(REQUIRED_CHECKS[7]),
    z.literal(REQUIRED_CHECKS[8]),
    z.literal(REQUIRED_CHECKS[9]),
  ]),
  schemaVersion: z.literal(2),
  task: z.literal("independent-c6-episode-intake-review-v2"),
}).strict();
const dispatchSchema = z.object({
  authorTaskName: trimmedStringSchema,
  contextPolicy: z.literal("fork-turns-none"),
  input: inputReferenceSchema,
  request: requestReferenceSchema,
  requestedTaskName: z.literal("c6_episode_intake_review_v2"),
  responsePath: z.literal(RESPONSE_PATH),
  reviewerAgentName: trimmedStringSchema,
  schemaVersion: z.literal(2),
}).strict();
const familyMemberSchema = z.object({
  candidateId: trimmedStringSchema,
  codingTaskSurfaceSha256: sha256Schema,
  fullAgentVisibleInputSha256: sha256Schema,
  originAnchorSha256: sha256Schema,
}).strict();
const familySchema = z.object({
  familyId: z.string().regex(/^semantic-family-[a-f0-9]{64}$/u),
  members: z.array(familyMemberSchema).min(1),
  representativeCandidateId: trimmedStringSchema,
}).strict();
const candidateReviewSchema = z.object({
  candidateId: trimmedStringSchema,
  decision: z.enum([
    "selected",
    "qualified-reserve",
    "semantic-duplicate",
  ]),
  familyId: z.string().regex(/^semantic-family-[a-f0-9]{64}$/u),
  representativeCandidateId: trimmedStringSchema,
}).strict();
const responseSchema = z.object({
  blockingFindings: z.array(trimmedStringSchema),
  candidateReviews: z.array(candidateReviewSchema).min(1),
  candidateUniverseSha256: sha256Schema,
  decision: z.literal("accepted"),
  families: z.array(familySchema).min(1),
  familyCount: z.number().int().positive(),
  inputSha256: sha256Schema,
  qualifiedReserveCandidateCount: z.number().int().nonnegative(),
  qualifiedReserveCandidateIds: z.array(trimmedStringSchema),
  qualifiedReserveCandidateIdsSha256: sha256Schema,
  requestSha256: sha256Schema,
  reviewedAt: z.iso.datetime(),
  reviewedCandidateCount: z.number().int().positive(),
  reviewerAgentName: trimmedStringSchema,
  schemaVersion: z.literal(2),
  selectedCandidateIds: z.array(trimmedStringSchema).min(1),
  selectedCandidateIdsSha256: sha256Schema,
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
    requestedTaskName: z.literal("c6_episode_intake_review_v2"),
    type: z.literal("independent-ai-agent"),
  }).strict(),
  schemaVersion: z.literal(2),
}).strict();

export type C6EpisodeIntakeCandidate = z.infer<typeof candidateSchema>;

export interface C6EpisodeIntakeReviewEvidence {
  candidateCount: number;
  cryptographicReceipt: false;
  dispatchSha256: string;
  familyCount: number;
  inputSha256: string;
  provenanceSha256: string;
  qualifiedReserveCandidateCount: number;
  requestSha256: string;
  responseSha256: string;
  reviewerAgentName: string;
  selectedCandidateCount: number;
  selectionClosureRebuilt: false;
  semanticDuplicateCount: number;
  sourceIntakeClosureRebuilt: false;
}

export async function validateC6EpisodeIntakeReview(input: {
  assetLock: C6AssetLock;
  datasetRoot: string;
  expectedCandidates: readonly C6EpisodeIntakeCandidate[];
  finalDatasetEpisodeIds: readonly string[];
}): Promise<C6EpisodeIntakeReviewEvidence> {
  const expectedCandidates = candidateSchema.array().min(1).parse(
    input.expectedCandidates,
  );
  assertUnique(
    expectedCandidates.map((candidate) => candidate.candidateId),
    "C6 externally reconstructed candidate universe has duplicate candidate ids",
  );
  for (const candidate of expectedCandidates) {
    assertCanonicalOriginAnchor(candidate);
  }
  const finalDatasetEpisodeIds = trimmedStringSchema.array().min(1).parse(
    input.finalDatasetEpisodeIds,
  );
  assertUnique(
    finalDatasetEpisodeIds,
    "C6 final dataset episode ids contain duplicates",
  );

  const filesByPath = assetFilesByPath(input.assetLock);
  const provenanceBytes = await readLockedPath({
    datasetRoot: input.datasetRoot,
    filesByPath,
    label: "episode intake provenance",
    path: PROVENANCE_PATH,
  });
  const provenance = parseCanonical(
    provenanceBytes,
    provenanceSchema,
    "episode intake provenance",
  );
  const [inputBytes, requestBytes, dispatchBytes, responseBytes] =
    await Promise.all([
      readReferencedArtifact(
        input.datasetRoot,
        filesByPath,
        provenance.input,
        "episode intake input",
      ),
      readReferencedArtifact(
        input.datasetRoot,
        filesByPath,
        provenance.request,
        "episode intake request",
      ),
      readReferencedArtifact(
        input.datasetRoot,
        filesByPath,
        provenance.dispatch,
        "episode intake dispatch",
      ),
      readReferencedArtifact(
        input.datasetRoot,
        filesByPath,
        provenance.response,
        "episode intake response",
      ),
    ]);
  const reviewInput = parseCanonical(
    inputBytes,
    inputSchema,
    "episode intake input",
  );
  const request = parseCanonical(
    requestBytes,
    requestSchema,
    "episode intake request",
  );
  const dispatch = parseCanonical(
    dispatchBytes,
    dispatchSchema,
    "episode intake dispatch",
  );
  const response = parseCanonical(
    responseBytes,
    responseSchema,
    "episode intake response",
  );

  assertArtifactBinding(
    request.input,
    inputBytes,
    "episode intake request input",
  );
  assertArtifactBinding(
    dispatch.input,
    inputBytes,
    "episode intake dispatch input",
  );
  assertArtifactBinding(
    dispatch.request,
    requestBytes,
    "episode intake dispatch request",
  );
  if (
    provenance.authorTaskName !== dispatch.authorTaskName ||
    provenance.reviewer.agentName !== dispatch.reviewerAgentName ||
    provenance.reviewer.agentName !== response.reviewerAgentName ||
    provenance.reviewer.contextPolicy !== dispatch.contextPolicy ||
    provenance.reviewer.requestedTaskName !== dispatch.requestedTaskName ||
    provenance.reviewer.orchestratorAttestation.attestedByTaskName !==
      provenance.authorTaskName ||
    provenance.authorTaskName === provenance.reviewer.agentName ||
    expectedCandidates.some((candidate) =>
      candidate.author === provenance.reviewer.agentName
    )
  ) {
    throw new Error(
      "C6 episode intake review provenance is not independent",
    );
  }
  if (
    reviewInput.sourceIntakeClosure.path.startsWith(`${REVIEW_ROOT}/`) ||
    reviewInput.sourceIntakeProjection.path.startsWith(`${REVIEW_ROOT}/`) ||
    reviewInput.sourceIntakeClosure.path ===
      reviewInput.sourceIntakeProjection.path
  ) {
    throw new Error("C6 source intake references are not independent inputs");
  }
  await Promise.all([
    readReferencedArtifact(
      input.datasetRoot,
      filesByPath,
      reviewInput.sourceIntakeClosure,
      "source intake closure",
    ),
    readReferencedArtifact(
      input.datasetRoot,
      filesByPath,
      reviewInput.sourceIntakeProjection,
      "source intake projection",
    ),
  ]);
  if (
    JSON.stringify(reviewInput.candidates) !==
      JSON.stringify(expectedCandidates)
  ) {
    throw new Error(
      "C6 episode intake input does not equal the externally reconstructed candidate universe",
    );
  }
  for (const candidate of reviewInput.candidates) {
    assertCanonicalOriginAnchor(candidate);
  }

  validateResponse({
    expectedCandidates,
    finalDatasetEpisodeIds,
    inputBytes,
    requestBytes,
    response,
  });

  return {
    candidateCount: expectedCandidates.length,
    cryptographicReceipt: false,
    dispatchSha256: sha256(dispatchBytes),
    familyCount: response.families.length,
    inputSha256: sha256(inputBytes),
    provenanceSha256: sha256(provenanceBytes),
    qualifiedReserveCandidateCount:
      response.qualifiedReserveCandidateIds.length,
    requestSha256: sha256(requestBytes),
    responseSha256: sha256(responseBytes),
    reviewerAgentName: provenance.reviewer.agentName,
    selectedCandidateCount: response.selectedCandidateIds.length,
    selectionClosureRebuilt: false,
    semanticDuplicateCount: response.candidateReviews.filter((review) =>
      review.decision === "semantic-duplicate"
    ).length,
    sourceIntakeClosureRebuilt: false,
  };
}

function validateResponse(input: {
  expectedCandidates: readonly C6EpisodeIntakeCandidate[];
  finalDatasetEpisodeIds: readonly string[];
  inputBytes: string;
  requestBytes: string;
  response: z.infer<typeof responseSchema>;
}): void {
  const {
    expectedCandidates,
    finalDatasetEpisodeIds,
    inputBytes,
    requestBytes,
    response,
  } = input;
  if (
    response.inputSha256 !== sha256(inputBytes) ||
    response.requestSha256 !== sha256(requestBytes) ||
    response.candidateUniverseSha256 !==
      sha256(JSON.stringify(expectedCandidates)) ||
    response.reviewedCandidateCount !== expectedCandidates.length ||
    response.familyCount !== response.families.length ||
    response.blockingFindings.length > 0
  ) {
    throw new Error(
      "C6 episode intake response does not accept the bound candidate universe",
    );
  }
  assertUnique(
    response.selectedCandidateIds,
    "C6 selected candidate ids contain duplicates",
  );
  assertUnique(
    response.qualifiedReserveCandidateIds,
    "C6 qualified-reserve candidate ids contain duplicates",
  );
  if (
    response.selectedCandidateIdsSha256 !==
      sha256(JSON.stringify(response.selectedCandidateIds))
  ) {
    throw new Error("C6 selected candidate ids digest does not match");
  }
  if (
    response.qualifiedReserveCandidateIdsSha256 !==
      sha256(JSON.stringify(response.qualifiedReserveCandidateIds))
  ) {
    throw new Error(
      "C6 qualified-reserve candidate ids digest does not match",
    );
  }
  if (
    response.qualifiedReserveCandidateCount !==
      response.qualifiedReserveCandidateIds.length
  ) {
    throw new Error("C6 qualified-reserve candidate count does not match");
  }
  assertSorted(
    response.families.map((family) => family.familyId),
    "C6 semantic families must be sorted by family id",
  );

  const candidatesById = new Map(
    expectedCandidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  const familyByCandidateId = new Map<string, string>();
  const familyByOriginAnchor = new Map<string, string>();
  const familyByCodingTaskSurface = new Map<string, string>();
  for (const family of response.families) {
    assertSorted(
      family.members.map((member) => member.candidateId),
      "C6 semantic family members must be sorted by candidate id",
    );
    if (family.familyId !== deriveFamilyId(family.members)) {
      throw new Error("C6 semantic family id is not derived from its members");
    }
    for (const member of family.members) {
      const candidate = candidatesById.get(member.candidateId);
      if (
        candidate === undefined ||
        member.originAnchorSha256 !== candidate.originAnchor.sha256 ||
        member.codingTaskSurfaceSha256 !==
          candidate.codingTaskSurfaceSha256 ||
        member.fullAgentVisibleInputSha256 !==
          candidate.fullAgentVisibleInputSha256 ||
        familyByCandidateId.has(member.candidateId)
      ) {
        throw new Error(
          "C6 semantic families do not partition the candidate universe",
        );
      }
      familyByCandidateId.set(member.candidateId, family.familyId);
      bindSharedSurface(
        familyByOriginAnchor,
        candidate.originAnchor.sha256,
        family.familyId,
        "same origin anchor must share one semantic family",
      );
      bindSharedSurface(
        familyByCodingTaskSurface,
        candidate.codingTaskSurfaceSha256,
        family.familyId,
        "same coding task surface must share one semantic family",
      );
    }
    const representative = family.members
      .map((member) => candidatesById.get(member.candidateId)!)
      .sort(compareCandidateRank)[0]!;
    if (family.representativeCandidateId !== representative.candidateId) {
      throw new Error(
        "C6 semantic family representative is not deterministic",
      );
    }
  }
  if (
    familyByCandidateId.size !== expectedCandidates.length ||
    expectedCandidates.some((candidate) =>
      !familyByCandidateId.has(candidate.candidateId)
    )
  ) {
    throw new Error(
      "C6 semantic families do not partition the candidate universe",
    );
  }

  assertSorted(
    response.candidateReviews.map((review) => review.candidateId),
    "C6 candidate reviews must be sorted by candidate id",
  );
  assertUnique(
    response.candidateReviews.map((review) => review.candidateId),
    "C6 candidate reviews contain duplicate candidate ids",
  );
  if (
    response.candidateReviews.length !== expectedCandidates.length ||
    response.candidateReviews.some((review) =>
      !candidatesById.has(review.candidateId)
    )
  ) {
    throw new Error(
      "C6 candidate reviews do not cover the complete candidate universe",
    );
  }
  for (const review of response.candidateReviews) {
    const family = response.families.find((value) =>
      value.familyId === review.familyId
    );
    const isRepresentative =
      review.candidateId === family?.representativeCandidateId;
    const isRepresentativeDecision =
      review.decision === "selected" ||
      review.decision === "qualified-reserve";
    if (
      family === undefined ||
      familyByCandidateId.get(review.candidateId) !== review.familyId ||
      review.representativeCandidateId !==
        family.representativeCandidateId ||
      (isRepresentative && !isRepresentativeDecision) ||
      (!isRepresentative && review.decision !== "semantic-duplicate")
    ) {
      throw new Error(
        "C6 candidate review is detached from its semantic family representative",
      );
    }
  }
  const selectedFromReviews = response.candidateReviews
    .filter((review) => review.decision === "selected")
    .map((review) => review.candidateId);
  if (
    JSON.stringify(response.selectedCandidateIds) !==
      JSON.stringify(selectedFromReviews)
  ) {
    throw new Error(
      "C6 selected candidate ids do not match candidate review decisions",
    );
  }
  const qualifiedReserveFromReviews = response.candidateReviews
    .filter((review) => review.decision === "qualified-reserve")
    .map((review) => review.candidateId);
  if (
    JSON.stringify(response.qualifiedReserveCandidateIds) !==
      JSON.stringify(qualifiedReserveFromReviews)
  ) {
    throw new Error(
      "C6 qualified-reserve candidate ids do not match candidate review decisions",
    );
  }
  if (
    JSON.stringify(response.selectedCandidateIds) !==
      JSON.stringify(finalDatasetEpisodeIds)
  ) {
    throw new Error(
      "C6 selected candidate ids do not equal final dataset episode ids",
    );
  }
}

function assertCanonicalOriginAnchor(
  candidate: C6EpisodeIntakeCandidate,
): void {
  const orderedTargetIds = candidate.originAnchor.orderedTargets.map(
    (target) => `${target.stageId}\u0000${target.locator}`,
  );
  if (
    new Set(orderedTargetIds).size !== orderedTargetIds.length ||
    candidate.originAnchor.sha256 !== sha256(JSON.stringify({
      repositoryUrl: candidate.originAnchor.repositoryUrl,
      orderedTargets: candidate.originAnchor.orderedTargets,
    }))
  ) {
    throw new Error(
      `C6 candidate ${candidate.candidateId} origin anchor is not canonical`,
    );
  }
}

function deriveFamilyId(
  members: readonly z.infer<typeof familyMemberSchema>[],
): string {
  const sorted = [...members].sort((left, right) =>
    compareCanonicalString(left.candidateId, right.candidateId)
  );
  return `semantic-family-${sha256(JSON.stringify(sorted))}`;
}

function compareCandidateRank(
  left: C6EpisodeIntakeCandidate,
  right: C6EpisodeIntakeCandidate,
): number {
  return compareCanonicalString(
    left.selectionRankSha256,
    right.selectionRankSha256,
  ) || compareCanonicalString(left.candidateId, right.candidateId);
}

function bindSharedSurface(
  familyBySurface: Map<string, string>,
  surface: string,
  familyId: string,
  message: string,
): void {
  const existing = familyBySurface.get(surface);
  if (existing !== undefined && existing !== familyId) {
    throw new Error(`C6 ${message}`);
  }
  familyBySurface.set(surface, familyId);
}

function assetFilesByPath(
  assetLock: C6AssetLock,
): ReadonlyMap<string, { bytes: number; sha256: string }> {
  const filesByPath = new Map(
    assetLock.files.map((file) => [file.path, file]),
  );
  if (filesByPath.size !== assetLock.files.length) {
    throw new Error("C6 asset lock contains duplicate paths");
  }
  return filesByPath;
}

async function readReferencedArtifact(
  datasetRoot: string,
  filesByPath: ReadonlyMap<string, { bytes: number; sha256: string }>,
  reference: z.infer<typeof artifactReferenceSchema>,
  label: string,
): Promise<string> {
  const bytes = await readLockedPath({
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

async function readLockedPath(input: {
  datasetRoot: string;
  expectedSha256?: string;
  filesByPath: ReadonlyMap<string, { bytes: number; sha256: string }>;
  label: string;
  path: string;
}): Promise<string> {
  const locked = input.filesByPath.get(input.path);
  if (
    locked === undefined ||
    (input.expectedSha256 !== undefined &&
      locked.sha256 !== input.expectedSha256)
  ) {
    throw new Error(`C6 ${input.label} does not match the asset lock`);
  }
  const root = resolve(input.datasetRoot);
  const path = resolve(root, input.path);
  const relativePath = relative(root, path);
  if (
    relativePath.length === 0 ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    resolve(root, relativePath) !== path
  ) {
    throw new Error(`C6 ${input.label} path escapes the dataset root`);
  }
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
      bytes.byteLength !== after.size ||
      bytes.byteLength !== locked.bytes ||
      sha256(bytes) !== locked.sha256
    ) {
      throw new Error(`C6 ${input.label} bytes do not match`);
    }
    return bytes.toString("utf8");
  } finally {
    await handle.close();
  }
}

function assertArtifactBinding(
  reference: { byteLength: number; sha256: string },
  bytes: string,
  label: string,
): void {
  if (
    reference.byteLength !== Buffer.byteLength(bytes) ||
    reference.sha256 !== sha256(bytes)
  ) {
    throw new Error(`C6 ${label} is evidence-unbound`);
  }
}

function parseCanonical<T>(
  bytes: string,
  schema: z.ZodType<T>,
  label: string,
): T {
  let value: unknown;
  try {
    value = JSON.parse(bytes) as unknown;
  } catch {
    throw new Error(`invalid C6 ${label}`);
  }
  const parsed = schema.safeParse(value);
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

function assertUnique(values: readonly string[], message: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(message);
  }
}

function assertSorted(values: readonly string[], message: string): void {
  const sorted = [...values].sort(compareCanonicalString);
  if (JSON.stringify(values) !== JSON.stringify(sorted)) {
    throw new Error(message);
  }
}

function compareCanonicalString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
