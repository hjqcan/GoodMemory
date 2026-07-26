import { createHash } from "node:crypto";

import { z } from "zod";

import {
  parseC6SourceV3SimpleProtocol,
} from "./c6-source-v3-simple";

const PROTOCOL_PATH =
  "swe-bench-live-multilang-608f7ae9." +
  "source-v3-simple-protocol-v1.json";
const PROTOCOL_BYTES = 3_992;
const PROTOCOL_SHA256 =
  "5f989ab640c684dac287142edc9d2f9d8ee46099c082f63bb20f2a9546205132";
const VERIFIER_PATH =
  "scripts/codex-coding-effect/c6-source-v3-simple-review.ts";
const REVIEW_ROOT = "provenance/source-v3-simple/review";

export const C6_SOURCE_V3_SIMPLE_REVIEW_PATHS = {
  dispatch: `${REVIEW_ROOT}/dispatch.json`,
  input: `${REVIEW_ROOT}/input.json`,
  provenance: `${REVIEW_ROOT}/provenance.json`,
  request: `${REVIEW_ROOT}/request.json`,
  response: `${REVIEW_ROOT}/response.json`,
} as const;

export const C6_SOURCE_V3_SIMPLE_REVIEW_REQUIRED_CHECKS = [
  "protocol-exact-byte-closure",
  "source-v2-and-metadata-predicate-exact-byte-closure",
  "complete-finite-frame-with-two-pass-equality",
  "no-quota-redraw-or-downstream-yield-stopping",
  "prior-repository-node-id-exclusion-required-for-later-promotion",
  "candidate-selection-and-census-remain-prohibited",
  "freeze-ancestry-required-after-review",
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
const artifactReferenceSchema = z.object({
  byteLength: z.number().int().positive(),
  path: relativePathSchema,
  sha256: sha256Schema,
}).strict();
const inputReferenceSchema = artifactReferenceSchema.extend({
  path: z.literal(C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.input),
}).strict();
const requestReferenceSchema = artifactReferenceSchema.extend({
  path: z.literal(C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.request),
}).strict();
const dispatchReferenceSchema = artifactReferenceSchema.extend({
  path: z.literal(C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.dispatch),
}).strict();
const responseReferenceSchema = artifactReferenceSchema.extend({
  path: z.literal(C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.response),
}).strict();
const requiredChecksSchema = z.tuple([
  z.literal(C6_SOURCE_V3_SIMPLE_REVIEW_REQUIRED_CHECKS[0]),
  z.literal(C6_SOURCE_V3_SIMPLE_REVIEW_REQUIRED_CHECKS[1]),
  z.literal(C6_SOURCE_V3_SIMPLE_REVIEW_REQUIRED_CHECKS[2]),
  z.literal(C6_SOURCE_V3_SIMPLE_REVIEW_REQUIRED_CHECKS[3]),
  z.literal(C6_SOURCE_V3_SIMPLE_REVIEW_REQUIRED_CHECKS[4]),
  z.literal(C6_SOURCE_V3_SIMPLE_REVIEW_REQUIRED_CHECKS[5]),
  z.literal(C6_SOURCE_V3_SIMPLE_REVIEW_REQUIRED_CHECKS[6]),
]);
const reviewInputSchema = z.object({
  artifactKind: z.literal("c6-source-v3-simple-review-input"),
  evaluationId: z.literal(
    "goodmemory-c6-codex-coding-effect-source-v3-simple-v1",
  ),
  metadataPredicate: artifactReferenceSchema,
  protocol: artifactReferenceSchema.extend({
    path: z.literal(PROTOCOL_PATH),
  }).strict(),
  schemaVersion: z.literal(1),
  sourceFrameProjectionSha256: sha256Schema,
  sourceV2: artifactReferenceSchema,
  verifierSource: artifactReferenceSchema.extend({
    path: z.literal(VERIFIER_PATH),
  }).strict(),
}).strict();
const reviewRequestSchema = z.object({
  accessBoundary: z.object({
    censusOutcomeAccess: z.literal(false),
    downstreamOutcomeAccess: z.literal(false),
    rawGoldAccess: z.literal(false),
  }).strict(),
  artifactKind: z.literal(
    "c6-source-v3-simple-review-request",
  ),
  input: inputReferenceSchema,
  requiredChecks: requiredChecksSchema,
  schemaVersion: z.literal(1),
  scope: z.literal(
    "protocol-review-only-does-not-authorize-census-or-freeze",
  ),
  task: z.literal("independent-c6-source-v3-simple-review-v1"),
}).strict();
const reviewDispatchSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v3-simple-review-dispatch",
  ),
  authorTaskName: trimmedStringSchema,
  contextPolicy: z.literal("fork-turns-none"),
  input: inputReferenceSchema,
  request: requestReferenceSchema,
  requestedTaskName: z.literal(
    "c6_source_v3_simple_review_v1",
  ),
  responsePath: z.literal(
    C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.response,
  ),
  reviewerAgentName: trimmedStringSchema,
  schemaVersion: z.literal(1),
}).strict();
const reviewResponseSchema = z.object({
  acceptedChecks: requiredChecksSchema,
  artifactKind: z.literal(
    "c6-source-v3-simple-review-response",
  ),
  blockingFindings: z.array(trimmedStringSchema),
  boundary: z.object({
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    formalCensusPermitted: z.literal(false),
    sourceV3SimpleFrozen: z.literal(false),
    status: z.literal(
      "protocol-review-accepted-freeze-and-promotion-receipt-still-required",
    ),
  }).strict(),
  decision: z.literal("accepted-for-freeze-preparation"),
  dispatchSha256: sha256Schema,
  inputSha256: sha256Schema,
  requestSha256: sha256Schema,
  reviewedAt: z.iso.datetime(),
  reviewerAgentName: trimmedStringSchema,
  schemaVersion: z.literal(1),
}).strict();
const reviewProvenanceSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v3-simple-review-provenance",
  ),
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
    requestedTaskName: z.literal(
      "c6_source_v3_simple_review_v1",
    ),
    type: z.literal("independent-ai-agent"),
  }).strict(),
  schemaVersion: z.literal(1),
}).strict();

export interface C6SourceV3SimpleReviewArtifact {
  bytes: string | Uint8Array;
  path: string;
}

interface C6SourceV3SimpleReviewSourceInput {
  metadataPredicate: C6SourceV3SimpleReviewArtifact;
  protocol: C6SourceV3SimpleReviewArtifact;
  sourceV2: C6SourceV3SimpleReviewArtifact;
  verifierSource: C6SourceV3SimpleReviewArtifact;
}

export interface C6SourceV3SimpleReviewBundle {
  dispatchBytes: string;
  formalCensusPermitted: false;
  inputBytes: string;
  requestBytes: string;
  sourceV3SimpleFrozen: false;
}

export interface C6SourceV3SimpleReviewEvidence {
  artifactLockVerified: false;
  candidateManifestFrozen: false;
  claimedReviewedAt: string;
  claimedReviewerAgentName: string;
  codexRunReady: false;
  cryptographicReceipt: false;
  dispatchSha256: string;
  formalCensusPermitted: false;
  freezeAncestryVerified: false;
  independenceVerified: false;
  inputSha256: string;
  promotionReceiptComplete: false;
  provenanceSha256: string;
  requestSha256: string;
  responseSha256: string;
  reviewReceiptStructureVerified: true;
  sourceV3SimpleFrozen: false;
}

export function buildC6SourceV3SimpleReviewBundle(
  input: C6SourceV3SimpleReviewSourceInput & {
    authorTaskName: string;
    reviewerAgentName: string;
  },
): C6SourceV3SimpleReviewBundle {
  const authorTaskName = trimmedStringSchema.parse(
    input.authorTaskName,
  );
  const reviewerAgentName = trimmedStringSchema.parse(
    input.reviewerAgentName,
  );
  if (authorTaskName === reviewerAgentName) {
    throw new Error(
      "C6 source-v3-simple reviewer must be separate from the author",
    );
  }
  const protocolBytes = exactArtifactBytes(
    input.protocol,
    PROTOCOL_PATH,
    "protocol",
  );
  if (
    protocolBytes.byteLength !== PROTOCOL_BYTES ||
    sha256(protocolBytes) !== PROTOCOL_SHA256
  ) {
    throw new Error(
      "C6 source-v3-simple protocol bytes do not match the exact proposal",
    );
  }
  const protocol = parseC6SourceV3SimpleProtocol(protocolBytes);
  const sourceV2Bytes = exactArtifactBytes(
    input.sourceV2,
    protocol.sourceFrame.sourceV2.path,
    "source-v2",
  );
  assertProtocolArtifact(
    sourceV2Bytes,
    protocol.sourceFrame.sourceV2,
    "source-v2",
  );
  const metadataPredicateBytes = exactArtifactBytes(
    input.metadataPredicate,
    protocol.sourceFrame.metadataPredicate.path,
    "metadata predicate",
  );
  assertProtocolArtifact(
    metadataPredicateBytes,
    protocol.sourceFrame.metadataPredicate,
    "metadata predicate",
  );
  const verifierSourceBytes = exactArtifactBytes(
    input.verifierSource,
    VERIFIER_PATH,
    "verifier source",
  );
  if (
    new Set([
      input.protocol.path,
      input.sourceV2.path,
      input.metadataPredicate.path,
      input.verifierSource.path,
    ]).size !== 4
  ) {
    throw new Error(
      "C6 source-v3-simple review source paths must be distinct external inputs",
    );
  }

  const inputBytes = canonicalJson(reviewInputSchema.parse({
    artifactKind: "c6-source-v3-simple-review-input",
    evaluationId:
      "goodmemory-c6-codex-coding-effect-source-v3-simple-v1",
    metadataPredicate: artifactReference(
      input.metadataPredicate.path,
      metadataPredicateBytes,
    ),
    protocol: artifactReference(
      input.protocol.path,
      protocolBytes,
    ),
    schemaVersion: 1,
    sourceFrameProjectionSha256:
      protocol.sourceFrame.sourceFrameProjectionSha256,
    sourceV2: artifactReference(
      input.sourceV2.path,
      sourceV2Bytes,
    ),
    verifierSource: artifactReference(
      input.verifierSource.path,
      verifierSourceBytes,
    ),
  }));
  const requestBytes = canonicalJson(reviewRequestSchema.parse({
    accessBoundary: {
      censusOutcomeAccess: false,
      downstreamOutcomeAccess: false,
      rawGoldAccess: false,
    },
    artifactKind: "c6-source-v3-simple-review-request",
    input: artifactReference(
      C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.input,
      inputBytes,
    ),
    requiredChecks:
      C6_SOURCE_V3_SIMPLE_REVIEW_REQUIRED_CHECKS,
    schemaVersion: 1,
    scope:
      "protocol-review-only-does-not-authorize-census-or-freeze",
    task: "independent-c6-source-v3-simple-review-v1",
  }));
  const dispatchBytes = canonicalJson(reviewDispatchSchema.parse({
    artifactKind: "c6-source-v3-simple-review-dispatch",
    authorTaskName,
    contextPolicy: "fork-turns-none",
    input: artifactReference(
      C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.input,
      inputBytes,
    ),
    request: artifactReference(
      C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.request,
      requestBytes,
    ),
    requestedTaskName: "c6_source_v3_simple_review_v1",
    responsePath: C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.response,
    reviewerAgentName,
    schemaVersion: 1,
  }));
  return {
    dispatchBytes,
    formalCensusPermitted: false,
    inputBytes,
    requestBytes,
    sourceV3SimpleFrozen: false,
  };
}

export function validateC6SourceV3SimpleReview(
  input: C6SourceV3SimpleReviewSourceInput & {
    authorTaskName: string;
    dispatchBytes: string | Uint8Array;
    inputBytes: string | Uint8Array;
    provenanceBytes: string | Uint8Array;
    requestBytes: string | Uint8Array;
    responseBytes: string | Uint8Array;
    reviewerAgentName: string;
  },
): C6SourceV3SimpleReviewEvidence {
  const expected = buildC6SourceV3SimpleReviewBundle(input);
  const inputArtifact = exactUtf8Artifact(
    input.inputBytes,
    "input",
  );
  const requestArtifact = exactUtf8Artifact(
    input.requestBytes,
    "request",
  );
  const dispatchArtifact = exactUtf8Artifact(
    input.dispatchBytes,
    "dispatch",
  );
  if (
    inputArtifact.text !== expected.inputBytes ||
    requestArtifact.text !== expected.requestBytes ||
    dispatchArtifact.text !== expected.dispatchBytes
  ) {
    throw new Error(
      "C6 source-v3-simple review request bundle does not match the exact source inputs",
    );
  }
  const responseArtifact = exactUtf8Artifact(
    input.responseBytes,
    "response",
  );
  const provenanceArtifact = exactUtf8Artifact(
    input.provenanceBytes,
    "provenance",
  );
  const response = parseCanonical(
    responseArtifact.text,
    reviewResponseSchema,
    "response",
  );
  const provenance = parseCanonical(
    provenanceArtifact.text,
    reviewProvenanceSchema,
    "provenance",
  );
  if (
    response.inputSha256 !== sha256(inputArtifact.bytes) ||
    response.requestSha256 !== sha256(requestArtifact.bytes) ||
    response.dispatchSha256 !== sha256(dispatchArtifact.bytes) ||
    response.blockingFindings.length !== 0
  ) {
    throw new Error(
      "C6 source-v3-simple review response does not bind the exact review request",
    );
  }
  if (
    response.reviewerAgentName !== input.reviewerAgentName ||
    provenance.authorTaskName !== input.authorTaskName ||
    provenance.recordedAt !== response.reviewedAt ||
    provenance.reviewer.agentName !== input.reviewerAgentName ||
    provenance.reviewer.orchestratorAttestation.attestedByTaskName !==
      input.authorTaskName ||
    input.authorTaskName === input.reviewerAgentName
  ) {
    throw new Error(
      "C6 source-v3-simple review provenance identity fields are inconsistent",
    );
  }
  assertArtifactReference(
    provenance.input,
    C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.input,
    inputArtifact.bytes,
    "provenance input",
  );
  assertArtifactReference(
    provenance.request,
    C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.request,
    requestArtifact.bytes,
    "provenance request",
  );
  assertArtifactReference(
    provenance.dispatch,
    C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.dispatch,
    dispatchArtifact.bytes,
    "provenance dispatch",
  );
  assertArtifactReference(
    provenance.response,
    C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.response,
    responseArtifact.bytes,
    "provenance response",
  );
  return {
    artifactLockVerified: false,
    candidateManifestFrozen: false,
    claimedReviewedAt: response.reviewedAt,
    claimedReviewerAgentName: response.reviewerAgentName,
    codexRunReady: false,
    cryptographicReceipt: false,
    dispatchSha256: sha256(dispatchArtifact.bytes),
    formalCensusPermitted: false,
    freezeAncestryVerified: false,
    independenceVerified: false,
    inputSha256: sha256(inputArtifact.bytes),
    promotionReceiptComplete: false,
    provenanceSha256: sha256(provenanceArtifact.bytes),
    requestSha256: sha256(requestArtifact.bytes),
    responseSha256: sha256(responseArtifact.bytes),
    reviewReceiptStructureVerified: true,
    sourceV3SimpleFrozen: false,
  };
}

function exactArtifactBytes(
  artifact: C6SourceV3SimpleReviewArtifact,
  expectedPath: string,
  label: string,
): Buffer {
  const path = relativePathSchema.parse(artifact.path);
  if (path !== expectedPath) {
    throw new Error(
      `C6 source-v3-simple ${label} path does not match`,
    );
  }
  return artifactBytes(artifact, label);
}

function artifactBytes(
  artifact: C6SourceV3SimpleReviewArtifact,
  label: string,
): Buffer {
  const bytes = typeof artifact.bytes === "string"
    ? Buffer.from(artifact.bytes)
    : Buffer.from(artifact.bytes);
  if (bytes.byteLength === 0) {
    throw new Error(`C6 source-v3-simple ${label} is empty`);
  }
  return bytes;
}

function assertProtocolArtifact(
  bytes: Uint8Array,
  expected: { bytes: number; sha256: string },
  label: string,
): void {
  if (
    bytes.byteLength !== expected.bytes ||
    sha256(bytes) !== expected.sha256
  ) {
    throw new Error(
      `C6 source-v3-simple ${label} bytes do not match the protocol`,
    );
  }
}

function artifactReference(
  path: string,
  bytes: string | Uint8Array,
) {
  const value = typeof bytes === "string"
    ? Buffer.from(bytes)
    : Buffer.from(bytes);
  return artifactReferenceSchema.parse({
    byteLength: value.byteLength,
    path,
    sha256: sha256(value),
  });
}

function assertArtifactReference(
  reference: z.infer<typeof artifactReferenceSchema>,
  path: string,
  bytes: string | Uint8Array,
  label: string,
): void {
  if (
    JSON.stringify(reference) !==
      JSON.stringify(artifactReference(path, bytes))
  ) {
    throw new Error(
      `C6 source-v3-simple ${label} reference does not match`,
    );
  }
}

function parseCanonical<T>(
  input: string,
  schema: z.ZodType<T>,
  label: string,
): T {
  let raw: unknown;
  try {
    raw = JSON.parse(input) as unknown;
  } catch {
    throw new Error(
      `C6 source-v3-simple review ${label} is not JSON`,
    );
  }
  if (input !== canonicalJson(raw)) {
    throw new Error(
      `C6 source-v3-simple review ${label} is not canonical JSON`,
    );
  }
  return schema.parse(raw);
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function exactUtf8Artifact(
  value: string | Uint8Array,
  label: string,
): { bytes: Buffer; text: string } {
  const bytes = typeof value === "string"
    ? Buffer.from(value)
    : Buffer.from(value);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(
      `C6 source-v3-simple review ${label} is not valid UTF-8`,
    );
  }
  if (!Buffer.from(text).equals(bytes)) {
    throw new Error(
      `C6 source-v3-simple review ${label} is not exact UTF-8`,
    );
  }
  return { bytes, text };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
