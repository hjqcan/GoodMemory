import { createHash } from "node:crypto";

import { z } from "zod";

import {
  C6_SOURCE_V4_BOUNDED_EVALUATION_ID,
} from "./c6-source-v4-bounded-contract";

const REVIEW_ROOT =
  "fixtures/codex-coding-effect/c6-source-pool/" +
  "provenance/source-v4-bounded/review";

export const C6_SOURCE_V4_BOUNDED_ACTIVATION_RECEIPT_PATH =
  "fixtures/codex-coding-effect/c6-source-pool/" +
  "provenance/source-v4-bounded/activation-receipt-v1.json";

export const C6_SOURCE_V4_BOUNDED_SELECTION_CHECKPOINT = {
  commitSha:
    "3b0ba2d13fc53a8a71b034342bf16c78b5e1507a",
  treeSha:
    "4d2c73ba54bd44b21c3fd16b3ae1b1c9869b9865",
} as const;

export interface C6SourceV4BoundedReviewSnapshotIdentity {
  assetBytes: number;
  assetLock: {
    byteLength: number;
    path: string;
    sha256: string;
  };
  assetRootSha256: string;
  manifest: {
    byteLength: number;
    path: string;
    sha256: string;
  };
  selectedRepositoriesSha256: string;
  selectedRepositoryCount: number;
}

export const C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY = {
  assetBytes: 269_523_056,
  assetLock: {
    byteLength: 2_314,
    path: "asset-lock.json",
    sha256:
      "73ccd3d157a1ea3e211c72be80f88c4891d08909226e95cf1011e65e37c3c3a9",
  },
  assetRootSha256:
    "61984ccf34bce0a77882e3fbfe68755a273d43793b6d5001b6bf69b70f51e28a",
  manifest: {
    byteLength: 2_565,
    path: "snapshot-manifest.json",
    sha256:
      "f1dc71516bb4a9c03cba480a88d1cebaf04b0df9cf5782f5ea2fee2a837d206c",
  },
  selectedRepositoriesSha256:
    "a7e858c844b6b79f73ac303fad32e9557c34418bc65619cace234673c7efefaf",
  selectedRepositoryCount: 16_384,
} as const satisfies
  C6SourceV4BoundedReviewSnapshotIdentity;

export const C6_SOURCE_V4_BOUNDED_REVIEW_PATHS = {
  dispatch: `${REVIEW_ROOT}/dispatch.json`,
  input: `${REVIEW_ROOT}/input.json`,
  provenance: `${REVIEW_ROOT}/provenance.json`,
  request: `${REVIEW_ROOT}/request.json`,
  response: `${REVIEW_ROOT}/response.json`,
} as const;

export const C6_SOURCE_V4_BOUNDED_REVIEW_REQUIRED_CHECKS = [
  "freeze-candidate-commit-tree-and-source-closure",
  "external-snapshot-asset-lock-root-and-manifest-closure",
  "outcome-blind-selection-and-complete-pilot-exclusion",
  "historical-v3-terminal-non-promotion-preserved",
  "pinned-bun-liveness-and-snapshot-mutation-gates",
  "clean-shell-worker-and-native-bun-fetch",
  "one-shot-live-capture-budget-with-no-redraw-or-top-up",
  "direct-review-child-and-strict-activation-still-required",
] as const;

export const C6_SOURCE_V4_BOUNDED_REVIEWED_PATHS = [
  "bun.lock",
  "bunfig.phase-73-gates.toml",
  "package.json",
  "scripts/activate-codex-coding-effect-c6-source-v4-bounded.ts",
  "scripts/codex-coding-effect/c6-asset-lock.ts",
  "scripts/codex-coding-effect/c6-bun-fs-liveness-stress.ts",
  "scripts/codex-coding-effect/c6-git-runtime.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-commit-count-eligibility-plan.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-commit-count-eligibility-qualification.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-deep-capture-plan.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-deep-evidence.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-structural-qualification.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-structural-union.ts",
  "scripts/codex-coding-effect/c6-review-event-policy.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-activation.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-contract.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-core.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-errors.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-executor.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-finalization.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-graphql.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-ledger.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-lock.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-preflight.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-runtime-source.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-transport.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-prior-exclusion.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-prior-identity-portable-evidence.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-prior-identity-replay-review.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-prior-repository-identity-replay.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-prior-repository-identity-structure.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-prior-repository-identity.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-promotion.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-review.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple.ts",
  "scripts/codex-coding-effect/c6-source-v4-bounded-activation.ts",
  "scripts/codex-coding-effect/c6-source-v4-bounded-contract.ts",
  "scripts/codex-coding-effect/c6-source-v4-bounded-frame.ts",
  "scripts/codex-coding-effect/c6-source-v4-bounded-receipts.ts",
  "scripts/codex-coding-effect/c6-source-v4-bounded-replay.ts",
  "scripts/codex-coding-effect/c6-source-v4-bounded-review.ts",
  "scripts/codex-coding-effect/c6-source-v4-bounded-snapshot.ts",
  "scripts/codex-coding-effect/c6-source-v4-bounded-v3-observation.ts",
  "scripts/codex-coding-effect/c6-source-v4-bounded-v3-reuse.ts",
  "scripts/codex-coding-effect/c6-source-v4-bounded-v3-runtime.ts",
  "scripts/codex-coding-effect/c6-wave3-pretarget-policy.ts",
  "scripts/codex-coding-effect/c6-wave3-prior-repository-identity-artifacts.ts",
  "scripts/codex-coding-effect/c6-wave3-prior-repository-identity-capture.ts",
  "scripts/codex-coding-effect/c6-wave3-prior-repository-identity-plan.ts",
  "scripts/codex-coding-effect/c6-wave3-source-universe-v2.ts",
  "scripts/materialize-codex-coding-effect-c6-source-v4-bounded.ts",
  "scripts/prepare-codex-coding-effect-c6-source-v4-bounded-review.ts",
  "scripts/record-codex-coding-effect-c6-source-v4-bounded-review-provenance.ts",
  "tests/quality-gates/phase-73/codex-coding-effect.c6-bun-fs-liveness-stress.gate.ts",
  "tests/quality-gates/phase-73/codex-coding-effect.c6-source-v3-simple-census-preflight.gate.ts",
  "tests/quality-gates/phase-73/codex-coding-effect.c6-source-v4-bounded-review-activation.gate.ts",
  "tests/quality-gates/phase-73/codex-coding-effect.c6-source-v4-bounded-snapshot.gate.ts",
  "tests/support/test-env.ts",
  "tests/support/test-env-isolation.ts",
  "tests/unit/codex-coding-effect.c6-source-v3-simple-census-preflight.test.ts",
  "tests/unit/codex-coding-effect.c6-source-v3-simple-frame-fixture.ts",
  "tests/unit/codex-coding-effect.c6-source-v4-bounded-activation.test.ts",
  "tests/unit/codex-coding-effect.c6-source-v4-bounded-contract.test.ts",
  "tests/unit/codex-coding-effect.c6-source-v4-bounded-frame.test.ts",
  "tests/unit/codex-coding-effect.c6-source-v4-bounded-receipts.test.ts",
  "tests/unit/codex-coding-effect.c6-source-v4-bounded-replay.test.ts",
  "tests/unit/codex-coding-effect.c6-source-v4-bounded-review-workflow.test.ts",
  "tests/unit/codex-coding-effect.c6-source-v4-bounded-review.test.ts",
  "tests/unit/codex-coding-effect.c6-source-v4-bounded-snapshot.test.ts",
  "tests/unit/codex-coding-effect.c6-source-v4-bounded-v3-observation.test.ts",
  "tests/unit/codex-coding-effect.c6-source-v4-bounded-v3-runtime.test.ts",
] as const;

const sha1Schema = z.string().regex(/^[a-f0-9]{40}$/u);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const trimmedStringSchema = z.string().min(1).refine(
  (value) => value.trim() === value,
  "value cannot be whitespace-padded",
);
const relativePathSchema = trimmedStringSchema.refine(
  (value) =>
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every(
      (part) =>
        part.length > 0 &&
        part !== "." &&
        part !== "..",
    ),
  "path must be a normalized relative path",
);
const artifactReferenceSchema = z.object({
  byteLength: z.number().int().positive(),
  path: relativePathSchema,
  sha256: sha256Schema,
}).strict();
const reviewedSourceReferenceSchema =
  artifactReferenceSchema.extend({
    gitBlobSha1: sha1Schema,
    mode: z.literal("100644"),
  }).strict();
const commitIdentitySchema = z.object({
  commitSha: sha1Schema,
  treeSha: sha1Schema,
}).strict();
const canonicalSnapshotIdentitySchema = z.object({
  assetBytes: z.literal(
    C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
      .assetBytes,
  ),
  assetLock: z.object({
    byteLength: z.literal(
      C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
        .assetLock.byteLength,
    ),
    path: z.literal(
      C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
        .assetLock.path,
    ),
    sha256: z.literal(
      C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
        .assetLock.sha256,
    ),
  }).strict(),
  assetRootSha256: z.literal(
    C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
      .assetRootSha256,
  ),
  manifest: z.object({
    byteLength: z.literal(
      C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
        .manifest.byteLength,
    ),
    path: z.literal(
      C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
        .manifest.path,
    ),
    sha256: z.literal(
      C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
        .manifest.sha256,
    ),
  }).strict(),
  selectedRepositoriesSha256: z.literal(
    C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
      .selectedRepositoriesSha256,
  ),
  selectedRepositoryCount: z.literal(
    C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
      .selectedRepositoryCount,
  ),
}).strict();
const requiredChecksSchema = z.tuple([
  z.literal(C6_SOURCE_V4_BOUNDED_REVIEW_REQUIRED_CHECKS[0]),
  z.literal(C6_SOURCE_V4_BOUNDED_REVIEW_REQUIRED_CHECKS[1]),
  z.literal(C6_SOURCE_V4_BOUNDED_REVIEW_REQUIRED_CHECKS[2]),
  z.literal(C6_SOURCE_V4_BOUNDED_REVIEW_REQUIRED_CHECKS[3]),
  z.literal(C6_SOURCE_V4_BOUNDED_REVIEW_REQUIRED_CHECKS[4]),
  z.literal(C6_SOURCE_V4_BOUNDED_REVIEW_REQUIRED_CHECKS[5]),
  z.literal(C6_SOURCE_V4_BOUNDED_REVIEW_REQUIRED_CHECKS[6]),
  z.literal(C6_SOURCE_V4_BOUNDED_REVIEW_REQUIRED_CHECKS[7]),
]);
const inputReferenceSchema = artifactReferenceSchema.extend({
  path: z.literal(
    C6_SOURCE_V4_BOUNDED_REVIEW_PATHS.input,
  ),
}).strict();
const requestReferenceSchema = artifactReferenceSchema.extend({
  path: z.literal(
    C6_SOURCE_V4_BOUNDED_REVIEW_PATHS.request,
  ),
}).strict();
const dispatchReferenceSchema = artifactReferenceSchema.extend({
  path: z.literal(
    C6_SOURCE_V4_BOUNDED_REVIEW_PATHS.dispatch,
  ),
}).strict();
const responseReferenceSchema = artifactReferenceSchema.extend({
  path: z.literal(
    C6_SOURCE_V4_BOUNDED_REVIEW_PATHS.response,
  ),
}).strict();
const reviewInputSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v4-bounded-review-input",
  ),
  evaluationId: z.literal(
    C6_SOURCE_V4_BOUNDED_EVALUATION_ID,
  ),
  freezeCandidate: commitIdentitySchema,
  reviewedSources: z.array(
    reviewedSourceReferenceSchema,
  ).length(
    C6_SOURCE_V4_BOUNDED_REVIEWED_PATHS.length,
  ),
  schemaVersion: z.literal(1),
  selectionCheckpoint: z.object({
    commitSha: z.literal(
      C6_SOURCE_V4_BOUNDED_SELECTION_CHECKPOINT
        .commitSha,
    ),
    treeSha: z.literal(
      C6_SOURCE_V4_BOUNDED_SELECTION_CHECKPOINT
        .treeSha,
    ),
  }).strict(),
  snapshot: canonicalSnapshotIdentitySchema,
}).strict();
const reviewRequestSchema = z.object({
  accessBoundary: z.object({
    codexOutcomeAccess: z.literal(false),
    episodeQualificationOutcomeAccess:
      z.literal(false),
    rawGoldAccess: z.literal(false),
    sourceCaptureOutcomeAccess: z.literal(false),
  }).strict(),
  artifactKind: z.literal(
    "c6-source-v4-bounded-review-request",
  ),
  input: inputReferenceSchema,
  requiredChecks: requiredChecksSchema,
  schemaVersion: z.literal(1),
  scope: z.literal(
    "selection-review-only-no-live-capture-or-codex-run-authority",
  ),
  task: z.literal(
    "independent-c6-source-v4-bounded-review-v1",
  ),
}).strict();
const reviewDispatchSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v4-bounded-review-dispatch",
  ),
  authorTaskName: trimmedStringSchema,
  contextPolicy: z.literal("fork-turns-none"),
  input: inputReferenceSchema,
  request: requestReferenceSchema,
  requestedTaskName: z.literal(
    "c6_source_v4_bounded_review_v1",
  ),
  responsePath: z.literal(
    C6_SOURCE_V4_BOUNDED_REVIEW_PATHS.response,
  ),
  reviewerAgentName: trimmedStringSchema,
  schemaVersion: z.literal(1),
}).strict();
const reviewResponseSchema = z.object({
  acceptedChecks: requiredChecksSchema,
  artifactKind: z.literal(
    "c6-source-v4-bounded-review-response",
  ),
  blockingFindings: z.array(trimmedStringSchema),
  boundary: z.object({
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    liveCaptureAuthorized: z.literal(false),
    sourceSelectionFrozen: z.literal(false),
    status: z.literal(
      "review-accepted-freeze-and-activation-required",
    ),
  }).strict(),
  decision: z.literal("accepted-for-freeze"),
  dispatchSha256: sha256Schema,
  inputSha256: sha256Schema,
  requestSha256: sha256Schema,
  reviewedAt: z.iso.datetime(),
  reviewerAgentName: trimmedStringSchema,
  schemaVersion: z.literal(1),
}).strict();
const reviewProvenanceSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v4-bounded-review-provenance",
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
      "c6_source_v4_bounded_review_v1",
    ),
    type: z.literal("independent-ai-agent"),
  }).strict(),
  schemaVersion: z.literal(1),
}).strict();

export interface C6SourceV4BoundedReviewArtifact {
  bytes: string | Uint8Array;
  path: string;
}

export interface C6SourceV4BoundedReviewSourceInput {
  authorTaskName: string;
  freezeCandidate: {
    commitSha: string;
    treeSha: string;
  };
  reviewedSources:
    readonly C6SourceV4BoundedReviewArtifact[];
  reviewerAgentName: string;
  snapshot:
    C6SourceV4BoundedReviewSnapshotIdentity;
}

export interface C6SourceV4BoundedReviewBundle {
  dispatchBytes: string;
  inputBytes: string;
  requestBytes: string;
}

export interface C6SourceV4BoundedReviewEvidence {
  candidateManifestFrozen: false;
  claimedReviewedAt: string;
  claimedReviewerAgentName: string;
  codexRunReady: false;
  cryptographicReviewIndependence: false;
  dispatchSha256: string;
  freezeAncestryVerified: false;
  independentReviewAccepted: true;
  inputSha256: string;
  liveCaptureAuthorized: false;
  provenanceSha256: string;
  requestSha256: string;
  responseSha256: string;
  reviewReceiptStructureVerified: true;
  sourceSelectionFrozen: false;
}

export function buildC6SourceV4BoundedReviewBundle(
  input: C6SourceV4BoundedReviewSourceInput,
): C6SourceV4BoundedReviewBundle {
  const authorTaskName = trimmedStringSchema.parse(
    input.authorTaskName,
  );
  const reviewerAgentName = trimmedStringSchema.parse(
    input.reviewerAgentName,
  );
  if (authorTaskName === reviewerAgentName) {
    throw new Error(
      "C6 source-v4 bounded reviewer must be separate from the author",
    );
  }
  const freezeCandidate =
    commitIdentitySchema.parse(
      input.freezeCandidate,
    );
  let snapshot:
    z.infer<typeof canonicalSnapshotIdentitySchema>;
  try {
    snapshot =
      canonicalSnapshotIdentitySchema.parse(
        input.snapshot,
      );
  } catch {
    throw new Error(
      "C6 source-v4 bounded review requires the canonical snapshot identity",
    );
  }
  const actualPaths = input.reviewedSources.map(
    (source) => source.path,
  );
  if (
    JSON.stringify(actualPaths) !==
      JSON.stringify(
        C6_SOURCE_V4_BOUNDED_REVIEWED_PATHS,
      )
  ) {
    throw new Error(
      "C6 source-v4 bounded reviewed source path set mismatch",
    );
  }
  const reviewedSources =
    input.reviewedSources.map(
      (source, index) => {
        const expectedPath =
          C6_SOURCE_V4_BOUNDED_REVIEWED_PATHS[index]!;
        const bytes = exactArtifactBytes(
          source,
          expectedPath,
          "reviewed source",
        );
        return reviewedSourceReferenceSchema.parse({
          ...artifactReference(
            expectedPath,
            bytes,
          ),
          gitBlobSha1: gitBlobSha1(bytes),
          mode: "100644",
        });
      },
    );

  const inputBytes = canonicalJson(
    reviewInputSchema.parse({
      artifactKind:
        "c6-source-v4-bounded-review-input",
      evaluationId:
        C6_SOURCE_V4_BOUNDED_EVALUATION_ID,
      freezeCandidate,
      reviewedSources,
      schemaVersion: 1,
      selectionCheckpoint:
        C6_SOURCE_V4_BOUNDED_SELECTION_CHECKPOINT,
      snapshot,
    }),
  );
  const requestBytes = canonicalJson(
    reviewRequestSchema.parse({
      accessBoundary: {
        codexOutcomeAccess: false,
        episodeQualificationOutcomeAccess: false,
        rawGoldAccess: false,
        sourceCaptureOutcomeAccess: false,
      },
      artifactKind:
        "c6-source-v4-bounded-review-request",
      input: artifactReference(
        C6_SOURCE_V4_BOUNDED_REVIEW_PATHS.input,
        inputBytes,
      ),
      requiredChecks:
        C6_SOURCE_V4_BOUNDED_REVIEW_REQUIRED_CHECKS,
      schemaVersion: 1,
      scope:
        "selection-review-only-no-live-capture-or-codex-run-authority",
      task:
        "independent-c6-source-v4-bounded-review-v1",
    }),
  );
  const dispatchBytes = canonicalJson(
    reviewDispatchSchema.parse({
      artifactKind:
        "c6-source-v4-bounded-review-dispatch",
      authorTaskName,
      contextPolicy: "fork-turns-none",
      input: artifactReference(
        C6_SOURCE_V4_BOUNDED_REVIEW_PATHS.input,
        inputBytes,
      ),
      request: artifactReference(
        C6_SOURCE_V4_BOUNDED_REVIEW_PATHS.request,
        requestBytes,
      ),
      requestedTaskName:
        "c6_source_v4_bounded_review_v1",
      responsePath:
        C6_SOURCE_V4_BOUNDED_REVIEW_PATHS.response,
      reviewerAgentName,
      schemaVersion: 1,
    }),
  );
  return {
    dispatchBytes,
    inputBytes,
    requestBytes,
  };
}

export function validateC6SourceV4BoundedReview(
  input: C6SourceV4BoundedReviewSourceInput &
    C6SourceV4BoundedReviewBundle & {
      provenanceBytes: string | Uint8Array;
      responseBytes: string | Uint8Array;
    },
): C6SourceV4BoundedReviewEvidence {
  const expected =
    buildC6SourceV4BoundedReviewBundle(input);
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
      "C6 source-v4 bounded review bundle does not match the exact inputs",
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
    response.inputSha256 !==
      sha256(inputArtifact.bytes) ||
    response.requestSha256 !==
      sha256(requestArtifact.bytes) ||
    response.dispatchSha256 !==
      sha256(dispatchArtifact.bytes) ||
    response.blockingFindings.length !== 0
  ) {
    throw new Error(
      "C6 source-v4 bounded review response does not bind the exact request",
    );
  }
  if (
    response.reviewerAgentName !==
      input.reviewerAgentName ||
    provenance.authorTaskName !==
      input.authorTaskName ||
    provenance.recordedAt !== response.reviewedAt ||
    provenance.reviewer.agentName !==
      input.reviewerAgentName ||
    provenance.reviewer.orchestratorAttestation
        .attestedByTaskName !==
      input.authorTaskName ||
    input.authorTaskName === input.reviewerAgentName
  ) {
    throw new Error(
      "C6 source-v4 bounded review provenance identity fields are inconsistent",
    );
  }
  assertArtifactReference(
    provenance.input,
    C6_SOURCE_V4_BOUNDED_REVIEW_PATHS.input,
    inputArtifact.bytes,
    "provenance input",
  );
  assertArtifactReference(
    provenance.request,
    C6_SOURCE_V4_BOUNDED_REVIEW_PATHS.request,
    requestArtifact.bytes,
    "provenance request",
  );
  assertArtifactReference(
    provenance.dispatch,
    C6_SOURCE_V4_BOUNDED_REVIEW_PATHS.dispatch,
    dispatchArtifact.bytes,
    "provenance dispatch",
  );
  assertArtifactReference(
    provenance.response,
    C6_SOURCE_V4_BOUNDED_REVIEW_PATHS.response,
    responseArtifact.bytes,
    "provenance response",
  );
  return {
    candidateManifestFrozen: false,
    claimedReviewedAt: response.reviewedAt,
    claimedReviewerAgentName:
      response.reviewerAgentName,
    codexRunReady: false,
    cryptographicReviewIndependence: false,
    dispatchSha256:
      sha256(dispatchArtifact.bytes),
    freezeAncestryVerified: false,
    independentReviewAccepted: true,
    inputSha256: sha256(inputArtifact.bytes),
    liveCaptureAuthorized: false,
    provenanceSha256:
      sha256(provenanceArtifact.bytes),
    requestSha256:
      sha256(requestArtifact.bytes),
    responseSha256:
      sha256(responseArtifact.bytes),
    reviewReceiptStructureVerified: true,
    sourceSelectionFrozen: false,
  };
}

function exactArtifactBytes(
  artifact: C6SourceV4BoundedReviewArtifact,
  expectedPath: string,
  label: string,
): Buffer {
  const path = relativePathSchema.parse(artifact.path);
  if (path !== expectedPath) {
    throw new Error(
      `C6 source-v4 bounded ${label} path mismatch`,
    );
  }
  const bytes = typeof artifact.bytes === "string"
    ? Buffer.from(artifact.bytes)
    : Buffer.from(artifact.bytes);
  if (bytes.byteLength === 0) {
    throw new Error(
      `C6 source-v4 bounded ${label} is empty`,
    );
  }
  return bytes;
}

function artifactReference(
  path: string,
  value: string | Uint8Array,
): z.infer<typeof artifactReferenceSchema> {
  const bytes = typeof value === "string"
    ? Buffer.from(value)
    : Buffer.from(value);
  return artifactReferenceSchema.parse({
    byteLength: bytes.byteLength,
    path,
    sha256: sha256(bytes),
  });
}

function assertArtifactReference(
  reference: z.infer<
    typeof artifactReferenceSchema
  >,
  path: string,
  bytes: string | Uint8Array,
  label: string,
): void {
  if (
    JSON.stringify(reference) !==
      JSON.stringify(
        artifactReference(path, bytes),
      )
  ) {
    throw new Error(
      `C6 source-v4 bounded ${label} reference mismatch`,
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
      `C6 source-v4 bounded review ${label} is not JSON`,
    );
  }
  if (input !== canonicalJson(raw)) {
    throw new Error(
      `C6 source-v4 bounded review ${label} is not canonical JSON`,
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
    text = new TextDecoder(
      "utf-8",
      { fatal: true },
    ).decode(bytes);
  } catch {
    throw new Error(
      `C6 source-v4 bounded review ${label} is not valid UTF-8`,
    );
  }
  if (!Buffer.from(text).equals(bytes)) {
    throw new Error(
      `C6 source-v4 bounded review ${label} is not exact UTF-8`,
    );
  }
  return { bytes, text };
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function gitBlobSha1(value: Uint8Array): string {
  return createHash("sha1")
    .update(`blob ${value.byteLength}\0`)
    .update(value)
    .digest("hex");
}

function sha256(
  value: string | Uint8Array,
): string {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}
