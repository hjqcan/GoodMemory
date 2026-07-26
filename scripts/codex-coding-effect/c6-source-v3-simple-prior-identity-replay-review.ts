import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { z } from "zod";

import {
  parseC6SourceV3SimplePriorRepositoryIdentityReplayReceipt,
} from "./c6-source-v3-simple-prior-repository-identity-replay";

const SOURCE_POOL_PATH =
  "fixtures/codex-coding-effect/c6-source-pool";
const RECEIPT_PATH =
  `${SOURCE_POOL_PATH}/provenance/source-v3-simple/` +
  "prior-repository-identity/" +
  "swe-bench-live-multilang-608f7ae9." +
  "source-v3-simple-prior-repository-identity-observation-replay-v1.json";
const RECEIPT_BYTES = 4_769;
const RECEIPT_SHA256 =
  "903912db14ed999cd19f32ffaef81658bc241daf8be9e2f33aa14b1784b94d0a";
const PROTOCOL_PATH =
  `${SOURCE_POOL_PATH}/swe-bench-live-multilang-608f7ae9.` +
  "source-v3-simple-protocol-v1.json";
const PLAN_PATH =
  `${SOURCE_POOL_PATH}/swe-bench-live-multilang-608f7ae9.` +
  "wave3-prior-repository-identity-plan-v1.json";
const SOURCE_UNIVERSE_PATH =
  `${SOURCE_POOL_PATH}/swe-bench-live-multilang-608f7ae9.` +
  "wave3-source-universe-v2.json";
const REPLAY_COMPARATOR_SOURCE_PATH =
  "scripts/codex-coding-effect/" +
  "c6-source-v3-simple-prior-repository-identity-replay.ts";
const BUNDLE_VERIFIER_SOURCE_PATH =
  "scripts/codex-coding-effect/" +
  "c6-source-v3-simple-prior-repository-identity.ts";
const REPLAY_MATERIALIZER_SOURCE_PATH =
  "scripts/record-codex-coding-effect-" +
  "c6-source-v3-simple-prior-identity-replay.ts";
const REVIEW_ROOT =
  "provenance/source-v3-simple/" +
  "prior-repository-identity/review";

export const C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS = {
  dispatch: `${REVIEW_ROOT}/dispatch.json`,
  input: `${REVIEW_ROOT}/input.json`,
  provenance: `${REVIEW_ROOT}/provenance.json`,
  request: `${REVIEW_ROOT}/request.json`,
  response: `${REVIEW_ROOT}/response.json`,
} as const;

export const C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_SOURCE_PATHS = {
  bundleVerifierSource: BUNDLE_VERIFIER_SOURCE_PATH,
  plan: PLAN_PATH,
  protocol: PROTOCOL_PATH,
  replayComparatorSource: REPLAY_COMPARATOR_SOURCE_PATH,
  replayMaterializerSource: REPLAY_MATERIALIZER_SOURCE_PATH,
  replayReceipt: RECEIPT_PATH,
  sourceUniverse: SOURCE_UNIVERSE_PATH,
} as const;

export const C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_REQUIRED_CHECKS = [
  "canonical-replay-receipt-and-sha256",
  "capture-a-full-local-bundle-and-inner-outer-asset-lock-replay",
  "capture-b-full-local-bundle-and-inner-outer-asset-lock-replay",
  "356-final-request-ids-each-unique-and-cross-capture-intersection-zero",
  "178-repository-identities-and-node-id-dedup-agree",
  "all-authority-and-readiness-flags-remain-false",
  "no-live-network-external-authenticity-or-independent-process-claim",
  "no-formal-census-freeze-or-codex-ready-claim",
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
const absolutePathSchema = trimmedStringSchema.refine(
  (value) =>
    value.startsWith("/") &&
    resolve(value) === value,
  "capture root must be a normalized absolute path",
);
const artifactReferenceSchema = z.object({
  byteLength: z.number().int().positive(),
  path: relativePathSchema,
  sha256: sha256Schema,
}).strict();
const inputReferenceSchema = artifactReferenceSchema.extend({
  path: z.literal(
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.input,
  ),
}).strict();
const requestReferenceSchema = artifactReferenceSchema.extend({
  path: z.literal(
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.request,
  ),
}).strict();
const dispatchReferenceSchema = artifactReferenceSchema.extend({
  path: z.literal(
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.dispatch,
  ),
}).strict();
const responseReferenceSchema = artifactReferenceSchema.extend({
  path: z.literal(
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.response,
  ),
}).strict();
const requiredChecksSchema = z.tuple([
  z.literal(
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_REQUIRED_CHECKS[0],
  ),
  z.literal(
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_REQUIRED_CHECKS[1],
  ),
  z.literal(
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_REQUIRED_CHECKS[2],
  ),
  z.literal(
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_REQUIRED_CHECKS[3],
  ),
  z.literal(
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_REQUIRED_CHECKS[4],
  ),
  z.literal(
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_REQUIRED_CHECKS[5],
  ),
  z.literal(
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_REQUIRED_CHECKS[6],
  ),
  z.literal(
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_REQUIRED_CHECKS[7],
  ),
]);
const reviewInputSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v3-simple-prior-identity-replay-review-input",
  ),
  bundleVerifierSource: artifactReferenceSchema.extend({
    path: z.literal(BUNDLE_VERIFIER_SOURCE_PATH),
  }).strict(),
  captureRoots: z.object({
    captureA: absolutePathSchema,
    captureB: absolutePathSchema,
  }).strict(),
  evaluationId: z.literal(
    "goodmemory-c6-codex-coding-effect-source-v3-simple-prior-identity-replay-v1",
  ),
  plan: artifactReferenceSchema.extend({
    path: z.literal(PLAN_PATH),
  }).strict(),
  protocol: artifactReferenceSchema.extend({
    path: z.literal(PROTOCOL_PATH),
  }).strict(),
  replayComparatorSource: artifactReferenceSchema.extend({
    path: z.literal(REPLAY_COMPARATOR_SOURCE_PATH),
  }).strict(),
  replayMaterializerSource: artifactReferenceSchema.extend({
    path: z.literal(REPLAY_MATERIALIZER_SOURCE_PATH),
  }).strict(),
  replayReceipt: artifactReferenceSchema.extend({
    byteLength: z.literal(RECEIPT_BYTES),
    path: z.literal(RECEIPT_PATH),
    sha256: z.literal(RECEIPT_SHA256),
  }).strict(),
  schemaVersion: z.literal(1),
  sourceUniverse: artifactReferenceSchema.extend({
    path: z.literal(SOURCE_UNIVERSE_PATH),
  }).strict(),
}).strict();
const reviewRequestSchema = z.object({
  accessBoundary: z.object({
    censusOutcomeAccess: z.literal(false),
    downstreamOutcomeAccess: z.literal(false),
    rawGoldAccess: z.literal(false),
  }).strict(),
  artifactKind: z.literal(
    "c6-source-v3-simple-prior-identity-replay-review-request",
  ),
  input: inputReferenceSchema,
  requiredChecks: requiredChecksSchema,
  reviewExecutionBoundary: z.object({
    packetValidatorReplaysLocalBundles: z.literal(false),
    reviewerMustReplayBothLocalBundles: z.literal(true),
    reviewerMustVerifyInnerAndOuterAssetLocks: z.literal(true),
  }).strict(),
  schemaVersion: z.literal(1),
  scope: z.literal(
    "local-observation-replay-review-only-no-provenance-or-promotion-authority",
  ),
  task: z.literal(
    "independent-c6-source-v3-simple-prior-identity-replay-review-v1",
  ),
}).strict();
const reviewDispatchSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v3-simple-prior-identity-replay-review-dispatch",
  ),
  authorTaskName: trimmedStringSchema,
  contextPolicy: z.literal("fork-turns-none"),
  input: inputReferenceSchema,
  request: requestReferenceSchema,
  requestedTaskName: z.literal(
    "c6_source_v3_simple_prior_identity_replay_review_v1",
  ),
  responsePath: z.literal(
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.response,
  ),
  reviewerAgentName: trimmedStringSchema,
  schemaVersion: z.literal(1),
}).strict();
const reviewBoundarySchema = z.object({
  candidateManifestFrozen: z.literal(false),
  captureOriginIndependentlyVerified: z.literal(false),
  codexRunReady: z.literal(false),
  externalAuthenticityVerified: z.literal(false),
  formalCensusPermitted: z.literal(false),
  independentCaptureProcessProven: z.literal(false),
  liveNetworkExecutionProven: z.literal(false),
  priorRepositoryNodeIdExclusionComplete: z.literal(false),
  sourceV3SimpleFrozen: z.literal(false),
  status: z.literal(
    "local-observation-replay-review-accepted-no-live-provenance-or-promotion-authority",
  ),
}).strict();
const reviewResponseSchema = z.object({
  acceptedChecks: requiredChecksSchema,
  artifactKind: z.literal(
    "c6-source-v3-simple-prior-identity-replay-review-response",
  ),
  blockingFindings: z.array(trimmedStringSchema),
  boundary: reviewBoundarySchema,
  decision: z.literal(
    "accepted-as-local-observation-replay-only",
  ),
  dispatchSha256: sha256Schema,
  inputSha256: sha256Schema,
  requestSha256: sha256Schema,
  reviewedAt: z.iso.datetime(),
  reviewerAgentName: trimmedStringSchema,
  schemaVersion: z.literal(1),
}).strict();
const reviewProvenanceSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v3-simple-prior-identity-replay-review-provenance",
  ),
  attestationScope: z.literal(
    "orchestrator-attestation-only",
  ),
  authorTaskName: trimmedStringSchema,
  dispatch: dispatchReferenceSchema,
  independenceVerified: z.literal(false),
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
        "orchestrator-observed-local-replay-review-dispatch-no-cryptographic-receipt",
      ),
      cryptographicReceipt: z.literal(false),
    }).strict(),
    requestedTaskName: z.literal(
      "c6_source_v3_simple_prior_identity_replay_review_v1",
    ),
    type: z.literal(
      "separate-ai-agent-identity-claimed",
    ),
  }).strict(),
  schemaVersion: z.literal(1),
}).strict();

export interface C6SourceV3SimplePriorIdentityReplayReviewArtifact {
  bytes: string | Uint8Array;
  path: string;
}

interface C6SourceV3SimplePriorIdentityReplayReviewSourceInput {
  bundleVerifierSource:
    C6SourceV3SimplePriorIdentityReplayReviewArtifact;
  captureA: string;
  captureB: string;
  plan: C6SourceV3SimplePriorIdentityReplayReviewArtifact;
  protocol: C6SourceV3SimplePriorIdentityReplayReviewArtifact;
  replayComparatorSource:
    C6SourceV3SimplePriorIdentityReplayReviewArtifact;
  replayMaterializerSource:
    C6SourceV3SimplePriorIdentityReplayReviewArtifact;
  replayReceipt:
    C6SourceV3SimplePriorIdentityReplayReviewArtifact;
  sourceUniverse:
    C6SourceV3SimplePriorIdentityReplayReviewArtifact;
}

export interface C6SourceV3SimplePriorIdentityReplayReviewBundle {
  dispatchBytes: string;
  formalCensusPermitted: false;
  inputBytes: string;
  localReplayReviewAccepted: false;
  priorRepositoryNodeIdExclusionComplete: false;
  requestBytes: string;
  sourceV3SimpleFrozen: false;
}

export interface C6SourceV3SimplePriorIdentityReplayReviewEvidence {
  candidateManifestFrozen: false;
  captureOriginIndependentlyVerified: false;
  claimedReviewedAt: string;
  claimedReviewerAgentName: string;
  codexRunReady: false;
  cryptographicReceipt: false;
  dispatchSha256: string;
  externalAuthenticityVerified: false;
  formalCensusPermitted: false;
  independenceVerified: false;
  independentCaptureProcessProven: false;
  inputSha256: string;
  liveNetworkExecutionProven: false;
  localBundleReplayVerifiedByValidator: false;
  localReplayReviewAccepted: true;
  priorRepositoryNodeIdExclusionComplete: false;
  provenanceSha256: string;
  requestSha256: string;
  responseSha256: string;
  reviewReceiptStructureVerified: true;
  sourceV3SimpleFrozen: false;
}

export function buildC6SourceV3SimplePriorIdentityReplayReviewBundle(
  input:
    C6SourceV3SimplePriorIdentityReplayReviewSourceInput & {
      authorTaskName: string;
      reviewerAgentName: string;
    },
): C6SourceV3SimplePriorIdentityReplayReviewBundle {
  const authorTaskName = trimmedStringSchema.parse(
    input.authorTaskName,
  );
  const reviewerAgentName = trimmedStringSchema.parse(
    input.reviewerAgentName,
  );
  if (authorTaskName === reviewerAgentName) {
    throw new Error(
      "C6 prior identity replay reviewer must be separate from the author",
    );
  }
  const captureA = absolutePathSchema.parse(input.captureA);
  const captureB = absolutePathSchema.parse(input.captureB);
  if (captureA === captureB) {
    throw new Error(
      "C6 prior identity replay review requires distinct capture roots",
    );
  }
  const replayReceiptBytes = exactArtifactBytes(
    input.replayReceipt,
    RECEIPT_PATH,
    "replay receipt",
  );
  if (
    replayReceiptBytes.byteLength !== RECEIPT_BYTES ||
    sha256(replayReceiptBytes) !== RECEIPT_SHA256
  ) {
    throw new Error(
      "C6 prior identity replay receipt does not match the exact local observation receipt",
    );
  }
  const replayReceipt =
    parseC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
      replayReceiptBytes,
    );
  const protocolBytes = exactArtifactBytes(
    input.protocol,
    PROTOCOL_PATH,
    "protocol",
  );
  const planBytes = exactArtifactBytes(
    input.plan,
    PLAN_PATH,
    "plan",
  );
  const sourceUniverseBytes = exactArtifactBytes(
    input.sourceUniverse,
    SOURCE_UNIVERSE_PATH,
    "source universe",
  );
  assertReceiptInput(
    protocolBytes,
    replayReceipt.inputs.protocol,
    "protocol",
  );
  assertReceiptInput(
    planBytes,
    replayReceipt.inputs.plan,
    "plan",
  );
  assertReceiptInput(
    sourceUniverseBytes,
    replayReceipt.inputs.sourceUniverse,
    "source universe",
  );
  const replayComparatorSourceBytes = exactArtifactBytes(
    input.replayComparatorSource,
    REPLAY_COMPARATOR_SOURCE_PATH,
    "replay comparator source",
  );
  const bundleVerifierSourceBytes = exactArtifactBytes(
    input.bundleVerifierSource,
    BUNDLE_VERIFIER_SOURCE_PATH,
    "bundle verifier source",
  );
  const replayMaterializerSourceBytes = exactArtifactBytes(
    input.replayMaterializerSource,
    REPLAY_MATERIALIZER_SOURCE_PATH,
    "replay materializer source",
  );
  const inputBytes = canonicalJson(reviewInputSchema.parse({
    artifactKind:
      "c6-source-v3-simple-prior-identity-replay-review-input",
    bundleVerifierSource: artifactReference(
      BUNDLE_VERIFIER_SOURCE_PATH,
      bundleVerifierSourceBytes,
    ),
    captureRoots: {
      captureA,
      captureB,
    },
    evaluationId:
      "goodmemory-c6-codex-coding-effect-source-v3-simple-prior-identity-replay-v1",
    plan: artifactReference(PLAN_PATH, planBytes),
    protocol: artifactReference(PROTOCOL_PATH, protocolBytes),
    replayComparatorSource: artifactReference(
      REPLAY_COMPARATOR_SOURCE_PATH,
      replayComparatorSourceBytes,
    ),
    replayMaterializerSource: artifactReference(
      REPLAY_MATERIALIZER_SOURCE_PATH,
      replayMaterializerSourceBytes,
    ),
    replayReceipt: artifactReference(
      RECEIPT_PATH,
      replayReceiptBytes,
    ),
    schemaVersion: 1,
    sourceUniverse: artifactReference(
      SOURCE_UNIVERSE_PATH,
      sourceUniverseBytes,
    ),
  }));
  const requestBytes = canonicalJson(reviewRequestSchema.parse({
    accessBoundary: {
      censusOutcomeAccess: false,
      downstreamOutcomeAccess: false,
      rawGoldAccess: false,
    },
    artifactKind:
      "c6-source-v3-simple-prior-identity-replay-review-request",
    input: artifactReference(
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.input,
      inputBytes,
    ),
    requiredChecks:
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_REQUIRED_CHECKS,
    reviewExecutionBoundary: {
      packetValidatorReplaysLocalBundles: false,
      reviewerMustReplayBothLocalBundles: true,
      reviewerMustVerifyInnerAndOuterAssetLocks: true,
    },
    schemaVersion: 1,
    scope:
      "local-observation-replay-review-only-no-provenance-or-promotion-authority",
    task:
      "independent-c6-source-v3-simple-prior-identity-replay-review-v1",
  }));
  const dispatchBytes = canonicalJson(reviewDispatchSchema.parse({
    artifactKind:
      "c6-source-v3-simple-prior-identity-replay-review-dispatch",
    authorTaskName,
    contextPolicy: "fork-turns-none",
    input: artifactReference(
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.input,
      inputBytes,
    ),
    request: artifactReference(
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.request,
      requestBytes,
    ),
    requestedTaskName:
      "c6_source_v3_simple_prior_identity_replay_review_v1",
    responsePath:
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.response,
    reviewerAgentName,
    schemaVersion: 1,
  }));
  return {
    dispatchBytes,
    formalCensusPermitted: false,
    inputBytes,
    localReplayReviewAccepted: false,
    priorRepositoryNodeIdExclusionComplete: false,
    requestBytes,
    sourceV3SimpleFrozen: false,
  };
}

export function validateC6SourceV3SimplePriorIdentityReplayReview(
  input:
    C6SourceV3SimplePriorIdentityReplayReviewSourceInput & {
      authorTaskName: string;
      dispatchBytes: string | Uint8Array;
      inputBytes: string | Uint8Array;
      provenanceBytes: string | Uint8Array;
      requestBytes: string | Uint8Array;
      responseBytes: string | Uint8Array;
      reviewerAgentName: string;
    },
): C6SourceV3SimplePriorIdentityReplayReviewEvidence {
  const expected =
    buildC6SourceV3SimplePriorIdentityReplayReviewBundle(
      input,
    );
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
      "C6 prior identity replay review request bundle does not match the exact source inputs",
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
    response.requestSha256 !==
      sha256(requestArtifact.bytes) ||
    response.dispatchSha256 !==
      sha256(dispatchArtifact.bytes)
  ) {
    throw new Error(
      "C6 prior identity replay review response does not bind the exact review request",
    );
  }
  if (response.blockingFindings.length !== 0) {
    throw new Error(
      "C6 prior identity replay review response has blocking findings",
    );
  }
  if (
    response.reviewerAgentName !== input.reviewerAgentName ||
    provenance.authorTaskName !== input.authorTaskName ||
    provenance.recordedAt !== response.reviewedAt ||
    provenance.reviewer.agentName !==
      input.reviewerAgentName ||
    provenance.reviewer.orchestratorAttestation
        .attestedByTaskName !== input.authorTaskName ||
    input.authorTaskName === input.reviewerAgentName
  ) {
    throw new Error(
      "C6 prior identity replay review provenance identity fields are inconsistent",
    );
  }
  assertArtifactReference(
    provenance.input,
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.input,
    inputArtifact.bytes,
    "provenance input",
  );
  assertArtifactReference(
    provenance.request,
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.request,
    requestArtifact.bytes,
    "provenance request",
  );
  assertArtifactReference(
    provenance.dispatch,
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.dispatch,
    dispatchArtifact.bytes,
    "provenance dispatch",
  );
  assertArtifactReference(
    provenance.response,
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.response,
    responseArtifact.bytes,
    "provenance response",
  );
  return {
    candidateManifestFrozen: false,
    captureOriginIndependentlyVerified: false,
    claimedReviewedAt: response.reviewedAt,
    claimedReviewerAgentName: response.reviewerAgentName,
    codexRunReady: false,
    cryptographicReceipt: false,
    dispatchSha256: sha256(dispatchArtifact.bytes),
    externalAuthenticityVerified: false,
    formalCensusPermitted: false,
    independenceVerified: false,
    independentCaptureProcessProven: false,
    inputSha256: sha256(inputArtifact.bytes),
    liveNetworkExecutionProven: false,
    localBundleReplayVerifiedByValidator: false,
    localReplayReviewAccepted: true,
    priorRepositoryNodeIdExclusionComplete: false,
    provenanceSha256: sha256(provenanceArtifact.bytes),
    requestSha256: sha256(requestArtifact.bytes),
    responseSha256: sha256(responseArtifact.bytes),
    reviewReceiptStructureVerified: true,
    sourceV3SimpleFrozen: false,
  };
}

function exactArtifactBytes(
  artifact:
    C6SourceV3SimplePriorIdentityReplayReviewArtifact,
  expectedPath: string,
  label: string,
): Buffer {
  const path = relativePathSchema.parse(artifact.path);
  if (path !== expectedPath) {
    throw new Error(
      `C6 prior identity replay review ${label} path does not match`,
    );
  }
  const bytes = typeof artifact.bytes === "string"
    ? Buffer.from(artifact.bytes)
    : Buffer.from(artifact.bytes);
  if (bytes.byteLength === 0) {
    throw new Error(
      `C6 prior identity replay review ${label} is empty`,
    );
  }
  return bytes;
}

function assertReceiptInput(
  bytes: Uint8Array,
  reference: { bytes: number; sha256: string },
  label: string,
): void {
  if (
    bytes.byteLength !== reference.bytes ||
    sha256(bytes) !== reference.sha256
  ) {
    throw new Error(
      `C6 prior identity replay review ${label} does not match the replay receipt`,
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
      `C6 prior identity replay review ${label} reference does not match`,
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
      `C6 prior identity replay review ${label} is not JSON`,
    );
  }
  if (input !== canonicalJson(raw)) {
    throw new Error(
      `C6 prior identity replay review ${label} is not canonical JSON`,
    );
  }
  return schema.parse(raw);
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
    text = new TextDecoder("utf-8", {
      fatal: true,
    }).decode(bytes);
  } catch {
    throw new Error(
      `C6 prior identity replay review ${label} is not valid UTF-8`,
    );
  }
  if (!Buffer.from(text).equals(bytes)) {
    throw new Error(
      `C6 prior identity replay review ${label} is not exact UTF-8`,
    );
  }
  return { bytes, text };
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
