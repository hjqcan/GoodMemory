import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  buildC6SourceV3SimplePriorIdentityReplayReviewBundle,
  C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS,
  C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_REQUIRED_CHECKS,
  validateC6SourceV3SimplePriorIdentityReplayReview,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-prior-identity-replay-review";

const AUTHOR = "/root";
const REVIEWER =
  "/root/c6_source_v3_simple_prior_identity_replay_review_v1";
const REVIEWED_AT = "2026-07-26T14:00:00.000Z";
const CAPTURE_A =
  "/private/tmp/goodmemory-c6-source-v3-simple-prior-identity-live-20260725-v1";
const CAPTURE_B =
  "/private/tmp/goodmemory-c6-source-v3-simple-prior-identity-live-20260725-v2";
const SOURCE_POOL_ROOT = join(
  process.cwd(),
  "fixtures/codex-coding-effect/c6-source-pool",
);
const RECEIPT_PATH =
  "fixtures/codex-coding-effect/c6-source-pool/provenance/" +
  "source-v3-simple/prior-repository-identity/" +
  "swe-bench-live-multilang-608f7ae9." +
  "source-v3-simple-prior-repository-identity-observation-replay-v1.json";
const PROTOCOL_PATH =
  "fixtures/codex-coding-effect/c6-source-pool/" +
  "swe-bench-live-multilang-608f7ae9." +
  "source-v3-simple-protocol-v1.json";
const PLAN_PATH =
  "fixtures/codex-coding-effect/c6-source-pool/" +
  "swe-bench-live-multilang-608f7ae9." +
  "wave3-prior-repository-identity-plan-v1.json";
const SOURCE_UNIVERSE_PATH =
  "fixtures/codex-coding-effect/c6-source-pool/" +
  "swe-bench-live-multilang-608f7ae9." +
  "wave3-source-universe-v2.json";
const COMPARATOR_PATH =
  "scripts/codex-coding-effect/" +
  "c6-source-v3-simple-prior-repository-identity-replay.ts";
const BUNDLE_VERIFIER_PATH =
  "scripts/codex-coding-effect/" +
  "c6-source-v3-simple-prior-repository-identity.ts";
const MATERIALIZER_PATH =
  "scripts/record-codex-coding-effect-" +
  "c6-source-v3-simple-prior-identity-replay.ts";

describe("C6 source-v3-simple prior identity replay review", () => {
  it("builds a deterministic packet that binds the exact local replay evidence", async () => {
    const artifacts = await sourceArtifacts();
    const first =
      buildC6SourceV3SimplePriorIdentityReplayReviewBundle({
        ...artifacts,
        authorTaskName: AUTHOR,
        captureA: CAPTURE_A,
        captureB: CAPTURE_B,
        reviewerAgentName: REVIEWER,
      });
    const repeated =
      buildC6SourceV3SimplePriorIdentityReplayReviewBundle({
        ...artifacts,
        authorTaskName: AUTHOR,
        captureA: CAPTURE_A,
        captureB: CAPTURE_B,
        reviewerAgentName: REVIEWER,
      });
    const reviewInput = JSON.parse(first.inputBytes) as {
      captureRoots: { captureA: string; captureB: string };
      replayReceipt: {
        byteLength: number;
        path: string;
        sha256: string;
      };
    };

    expect(first).toEqual(repeated);
    expect(reviewInput).toMatchObject({
      captureRoots: {
        captureA: CAPTURE_A,
        captureB: CAPTURE_B,
      },
      replayReceipt: {
        byteLength: 4_769,
        path: RECEIPT_PATH,
        sha256:
          "903912db14ed999cd19f32ffaef81658bc241daf8be9e2f33aa14b1784b94d0a",
      },
    });
    expect(JSON.parse(first.requestBytes)).toMatchObject({
      input: artifactReference(
        C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.input,
        first.inputBytes,
      ),
      requiredChecks:
        C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_REQUIRED_CHECKS,
      reviewExecutionBoundary: {
        packetValidatorReplaysLocalBundles: false,
        reviewerMustReplayBothLocalBundles: true,
        reviewerMustVerifyInnerAndOuterAssetLocks: true,
      },
      scope:
        "local-observation-replay-review-only-no-provenance-or-promotion-authority",
    });
    expect(JSON.parse(first.dispatchBytes)).toMatchObject({
      authorTaskName: AUTHOR,
      contextPolicy: "fork-turns-none",
      reviewerAgentName: REVIEWER,
      responsePath:
        C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.response,
    });
    expect(first.formalCensusPermitted).toBe(false);
    expect(first.localReplayReviewAccepted).toBe(false);
    expect(first.priorRepositoryNodeIdExclusionComplete).toBe(false);
    expect(first.sourceV3SimpleFrozen).toBe(false);
  });

  it("accepts only an exact non-authorizing local replay review receipt", async () => {
    const artifacts = await sourceArtifacts();
    const bundle =
      buildC6SourceV3SimplePriorIdentityReplayReviewBundle({
        ...artifacts,
        authorTaskName: AUTHOR,
        captureA: CAPTURE_A,
        captureB: CAPTURE_B,
        reviewerAgentName: REVIEWER,
      });
    const review = completedReview(bundle);
    const evidence =
      validateC6SourceV3SimplePriorIdentityReplayReview({
        ...artifacts,
        authorTaskName: AUTHOR,
        captureA: CAPTURE_A,
        captureB: CAPTURE_B,
        dispatchBytes: bundle.dispatchBytes,
        inputBytes: bundle.inputBytes,
        provenanceBytes: review.provenanceBytes,
        requestBytes: bundle.requestBytes,
        responseBytes: review.responseBytes,
        reviewerAgentName: REVIEWER,
      });

    expect(evidence).toMatchObject({
      candidateManifestFrozen: false,
      captureOriginIndependentlyVerified: false,
      codexRunReady: false,
      cryptographicReceipt: false,
      externalAuthenticityVerified: false,
      formalCensusPermitted: false,
      independenceVerified: false,
      independentCaptureProcessProven: false,
      liveNetworkExecutionProven: false,
      localBundleReplayVerifiedByValidator: false,
      localReplayReviewAccepted: true,
      priorRepositoryNodeIdExclusionComplete: false,
      reviewReceiptStructureVerified: true,
      sourceV3SimpleFrozen: false,
    });
  });

  it("fails closed on self-review, source mutation, detached hashes, findings, and authority claims", async () => {
    const artifacts = await sourceArtifacts();
    expect(() =>
      buildC6SourceV3SimplePriorIdentityReplayReviewBundle({
        ...artifacts,
        authorTaskName: AUTHOR,
        captureA: CAPTURE_A,
        captureB: CAPTURE_B,
        reviewerAgentName: AUTHOR,
      })
    ).toThrow("reviewer must be separate from the author");

    const bundle =
      buildC6SourceV3SimplePriorIdentityReplayReviewBundle({
        ...artifacts,
        authorTaskName: AUTHOR,
        captureA: CAPTURE_A,
        captureB: CAPTURE_B,
        reviewerAgentName: REVIEWER,
      });
    const review = completedReview(bundle);
    const exactReview = {
      ...artifacts,
      authorTaskName: AUTHOR,
      captureA: CAPTURE_A,
      captureB: CAPTURE_B,
      dispatchBytes: bundle.dispatchBytes,
      inputBytes: bundle.inputBytes,
      provenanceBytes: review.provenanceBytes,
      requestBytes: bundle.requestBytes,
      responseBytes: review.responseBytes,
      reviewerAgentName: REVIEWER,
    };
    const mutatedComparator = Buffer.from(
      artifacts.replayComparatorSource.bytes,
    );
    mutatedComparator[0] ^= 0x01;
    expect(() =>
      validateC6SourceV3SimplePriorIdentityReplayReview({
        ...exactReview,
        replayComparatorSource: {
          ...artifacts.replayComparatorSource,
          bytes: mutatedComparator,
        },
      })
    ).toThrow("request bundle does not match the exact source inputs");

    const detached = JSON.parse(review.responseBytes) as {
      inputSha256: string;
    };
    detached.inputSha256 = "a".repeat(64);
    const detachedBytes = canonicalJson(detached);
    expect(() =>
      validateC6SourceV3SimplePriorIdentityReplayReview({
        ...exactReview,
        provenanceBytes: provenanceFor(detachedBytes, bundle),
        responseBytes: detachedBytes,
      })
    ).toThrow("response does not bind the exact review request");

    const findings = JSON.parse(review.responseBytes) as {
      blockingFindings: string[];
    };
    findings.blockingFindings = ["local replay did not verify"];
    const findingsBytes = canonicalJson(findings);
    expect(() =>
      validateC6SourceV3SimplePriorIdentityReplayReview({
        ...exactReview,
        provenanceBytes: provenanceFor(findingsBytes, bundle),
        responseBytes: findingsBytes,
      })
    ).toThrow("blocking findings");

    const authority = JSON.parse(review.responseBytes) as {
      boundary: {
        externalAuthenticityVerified: boolean;
        formalCensusPermitted: boolean;
      };
    };
    authority.boundary.externalAuthenticityVerified = true;
    authority.boundary.formalCensusPermitted = true;
    const authorityBytes = canonicalJson(authority);
    expect(() =>
      validateC6SourceV3SimplePriorIdentityReplayReview({
        ...exactReview,
        provenanceBytes: provenanceFor(authorityBytes, bundle),
        responseBytes: authorityBytes,
      })
    ).toThrow();
  });
});

async function sourceArtifacts() {
  const [
    replayReceiptBytes,
    replayComparatorSourceBytes,
    bundleVerifierSourceBytes,
    replayMaterializerSourceBytes,
    protocolBytes,
    planBytes,
    sourceUniverseBytes,
  ] = await Promise.all([
    readFile(join(process.cwd(), RECEIPT_PATH)),
    readFile(join(process.cwd(), COMPARATOR_PATH)),
    readFile(join(process.cwd(), BUNDLE_VERIFIER_PATH)),
    readFile(join(process.cwd(), MATERIALIZER_PATH)),
    readFile(join(process.cwd(), PROTOCOL_PATH)),
    readFile(join(process.cwd(), PLAN_PATH)),
    readFile(join(process.cwd(), SOURCE_UNIVERSE_PATH)),
  ]);
  return {
    bundleVerifierSource: {
      bytes: bundleVerifierSourceBytes,
      path: BUNDLE_VERIFIER_PATH,
    },
    plan: {
      bytes: planBytes,
      path: PLAN_PATH,
    },
    protocol: {
      bytes: protocolBytes,
      path: PROTOCOL_PATH,
    },
    replayComparatorSource: {
      bytes: replayComparatorSourceBytes,
      path: COMPARATOR_PATH,
    },
    replayMaterializerSource: {
      bytes: replayMaterializerSourceBytes,
      path: MATERIALIZER_PATH,
    },
    replayReceipt: {
      bytes: replayReceiptBytes,
      path: RECEIPT_PATH,
    },
    sourceUniverse: {
      bytes: sourceUniverseBytes,
      path: SOURCE_UNIVERSE_PATH,
    },
  };
}

function completedReview(bundle: {
  dispatchBytes: string;
  inputBytes: string;
  requestBytes: string;
}) {
  const responseBytes = canonicalJson({
    acceptedChecks:
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_REQUIRED_CHECKS,
    artifactKind:
      "c6-source-v3-simple-prior-identity-replay-review-response",
    blockingFindings: [],
    boundary: {
      candidateManifestFrozen: false,
      captureOriginIndependentlyVerified: false,
      codexRunReady: false,
      externalAuthenticityVerified: false,
      formalCensusPermitted: false,
      independentCaptureProcessProven: false,
      liveNetworkExecutionProven: false,
      priorRepositoryNodeIdExclusionComplete: false,
      sourceV3SimpleFrozen: false,
      status:
        "local-observation-replay-review-accepted-no-live-provenance-or-promotion-authority",
    },
    decision: "accepted-as-local-observation-replay-only",
    dispatchSha256: sha256(bundle.dispatchBytes),
    inputSha256: sha256(bundle.inputBytes),
    requestSha256: sha256(bundle.requestBytes),
    reviewedAt: REVIEWED_AT,
    reviewerAgentName: REVIEWER,
    schemaVersion: 1,
  });
  return {
    provenanceBytes: provenanceFor(responseBytes, bundle),
    responseBytes,
  };
}

function provenanceFor(
  responseBytes: string,
  bundle: {
    dispatchBytes: string;
    inputBytes: string;
    requestBytes: string;
  },
): string {
  return canonicalJson({
    artifactKind:
      "c6-source-v3-simple-prior-identity-replay-review-provenance",
    attestationScope: "orchestrator-attestation-only",
    authorTaskName: AUTHOR,
    dispatch: artifactReference(
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.dispatch,
      bundle.dispatchBytes,
    ),
    independenceVerified: false,
    input: artifactReference(
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.input,
      bundle.inputBytes,
    ),
    recordedAt: REVIEWED_AT,
    request: artifactReference(
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.request,
      bundle.requestBytes,
    ),
    response: artifactReference(
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.response,
      responseBytes,
    ),
    reviewer: {
      agentName: REVIEWER,
      contextPolicy: "fork-turns-none",
      orchestratorAttestation: {
        attestedByTaskName: AUTHOR,
        basis:
          "orchestrator-observed-local-replay-review-dispatch-no-cryptographic-receipt",
        cryptographicReceipt: false,
      },
      requestedTaskName:
        "c6_source_v3_simple_prior_identity_replay_review_v1",
      type: "separate-ai-agent-identity-claimed",
    },
    schemaVersion: 1,
  });
}

function artifactReference(
  path: string,
  bytes: string | Uint8Array,
) {
  const value = typeof bytes === "string"
    ? Buffer.from(bytes)
    : Buffer.from(bytes);
  return {
    byteLength: value.byteLength,
    path,
    sha256: sha256(value),
  };
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
