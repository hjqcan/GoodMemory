import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  buildC6SourceV3SimpleReviewBundle,
  C6_SOURCE_V3_SIMPLE_REVIEW_PATHS,
  C6_SOURCE_V3_SIMPLE_REVIEW_REQUIRED_CHECKS,
  validateC6SourceV3SimpleReview,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-review";

const SOURCE_POOL_ROOT = join(
  process.cwd(),
  "fixtures/codex-coding-effect/c6-source-pool",
);
const PROTOCOL_BASENAME =
  "swe-bench-live-multilang-608f7ae9." +
  "source-v3-simple-protocol-v1.json";
const SOURCE_V2_BASENAME =
  "swe-bench-live-multilang-608f7ae9." +
  "wave3-source-universe-v2.json";
const PRETARGET_POLICY_BASENAME =
  "swe-bench-live-multilang-608f7ae9." +
  "wave3-pretarget-policy-v1.json";
const VERIFIER_PATH =
  "scripts/codex-coding-effect/c6-source-v3-simple-review.ts";
const AUTHOR = "/root";
const REVIEWER = "/root/c6_source_v3_simple_review_v1";
const REVIEWED_AT = "2026-07-25T00:00:00.000Z";

describe("Codex coding-effect C6 source-v3-simple review", () => {
  it("builds a deterministic non-authorizing review request from exact source bytes", async () => {
    const artifacts = await sourceArtifacts();
    const first = buildC6SourceV3SimpleReviewBundle({
      ...artifacts,
      authorTaskName: AUTHOR,
      reviewerAgentName: REVIEWER,
    });
    const repeated = buildC6SourceV3SimpleReviewBundle({
      ...artifacts,
      authorTaskName: AUTHOR,
      reviewerAgentName: REVIEWER,
    });

    expect(first).toEqual(repeated);
    expect(JSON.parse(first.requestBytes)).toMatchObject({
      accessBoundary: {
        censusOutcomeAccess: false,
        downstreamOutcomeAccess: false,
        rawGoldAccess: false,
      },
      input: artifactReference(
        C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.input,
        first.inputBytes,
      ),
      requiredChecks:
        C6_SOURCE_V3_SIMPLE_REVIEW_REQUIRED_CHECKS,
      scope:
        "protocol-review-only-does-not-authorize-census-or-freeze",
    });
    expect(JSON.parse(first.dispatchBytes)).toMatchObject({
      authorTaskName: AUTHOR,
      contextPolicy: "fork-turns-none",
      reviewerAgentName: REVIEWER,
      responsePath:
        C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.response,
    });
    expect(first.inputBytes).not.toContain(
      "priorRepositoryNodeIdExclusion",
    );
    expect(first.formalCensusPermitted).toBe(false);
    expect(first.sourceV3SimpleFrozen).toBe(false);
  });

  it("verifies an exact review receipt structure without claiming independence or promotion", async () => {
    const artifacts = await sourceArtifacts();
    const bundle = buildC6SourceV3SimpleReviewBundle({
      ...artifacts,
      authorTaskName: AUTHOR,
      reviewerAgentName: REVIEWER,
    });
    const review = completedReview(bundle);
    const evidence = validateC6SourceV3SimpleReview({
      ...artifacts,
      authorTaskName: AUTHOR,
      dispatchBytes: bundle.dispatchBytes,
      inputBytes: bundle.inputBytes,
      provenanceBytes: review.provenanceBytes,
      requestBytes: bundle.requestBytes,
      responseBytes: review.responseBytes,
      reviewerAgentName: REVIEWER,
    });

    expect(evidence).toMatchObject({
      artifactLockVerified: false,
      candidateManifestFrozen: false,
      claimedReviewedAt: REVIEWED_AT,
      claimedReviewerAgentName: REVIEWER,
      codexRunReady: false,
      cryptographicReceipt: false,
      dispatchSha256: sha256(bundle.dispatchBytes),
      formalCensusPermitted: false,
      freezeAncestryVerified: false,
      independenceVerified: false,
      inputSha256: sha256(bundle.inputBytes),
      promotionReceiptComplete: false,
      provenanceSha256: sha256(review.provenanceBytes),
      requestSha256: sha256(bundle.requestBytes),
      responseSha256: sha256(review.responseBytes),
      reviewReceiptStructureVerified: true,
      sourceV3SimpleFrozen: false,
    });
  });

  it("fails closed on self-review, source drift, detached review bytes, and promotion claims", async () => {
    const artifacts = await sourceArtifacts();
    expect(() => buildC6SourceV3SimpleReviewBundle({
      ...artifacts,
      authorTaskName: AUTHOR,
      reviewerAgentName: AUTHOR,
    })).toThrow("reviewer must be separate from the author");

    const predicateDrift = Buffer.from(
      artifacts.metadataPredicate.bytes,
    );
    predicateDrift[predicateDrift.length - 2] = 0x20;
    expect(() => buildC6SourceV3SimpleReviewBundle({
      ...artifacts,
      authorTaskName: AUTHOR,
      metadataPredicate: {
        ...artifacts.metadataPredicate,
        bytes: predicateDrift,
      },
      reviewerAgentName: REVIEWER,
    })).toThrow("metadata predicate bytes do not match");

    const bundle = buildC6SourceV3SimpleReviewBundle({
      ...artifacts,
      authorTaskName: AUTHOR,
      reviewerAgentName: REVIEWER,
    });
    const review = completedReview(bundle);
    const response = JSON.parse(review.responseBytes) as {
      boundary: { formalCensusPermitted: boolean };
    };
    response.boundary.formalCensusPermitted = true;
    expect(() => validateC6SourceV3SimpleReview({
      ...artifacts,
      authorTaskName: AUTHOR,
      dispatchBytes: bundle.dispatchBytes,
      inputBytes: bundle.inputBytes,
      provenanceBytes: review.provenanceBytes,
      requestBytes: bundle.requestBytes,
      responseBytes: canonicalJson(response),
      reviewerAgentName: REVIEWER,
    })).toThrow();

    const detachedResponse = JSON.parse(review.responseBytes) as {
      inputSha256: string;
    };
    detachedResponse.inputSha256 = "a".repeat(64);
    expect(() => validateC6SourceV3SimpleReview({
      ...artifacts,
      authorTaskName: AUTHOR,
      dispatchBytes: bundle.dispatchBytes,
      inputBytes: bundle.inputBytes,
      provenanceBytes: provenanceFor(
        canonicalJson(detachedResponse),
        bundle,
      ),
      requestBytes: bundle.requestBytes,
      responseBytes: canonicalJson(detachedResponse),
      reviewerAgentName: REVIEWER,
    })).toThrow("response does not bind the exact review request");

    const exactReview = {
      ...artifacts,
      authorTaskName: AUTHOR,
      dispatchBytes: bundle.dispatchBytes,
      inputBytes: bundle.inputBytes,
      provenanceBytes: review.provenanceBytes,
      requestBytes: bundle.requestBytes,
      responseBytes: review.responseBytes,
      reviewerAgentName: REVIEWER,
    };
    for (
      const [field, label] of [
        ["inputBytes", "input"],
        ["requestBytes", "request"],
        ["dispatchBytes", "dispatch"],
        ["responseBytes", "response"],
        ["provenanceBytes", "provenance"],
      ] as const
    ) {
      expect(() => validateC6SourceV3SimpleReview({
        ...exactReview,
        [field]: Buffer.from([0xff]),
      })).toThrow(
        `review ${label} is not valid UTF-8`,
      );
    }

    const forgedAuthority = JSON.parse(
      review.responseBytes,
    ) as Record<string, unknown>;
    forgedAuthority.independenceVerified = true;
    forgedAuthority.promotionReceiptComplete = true;
    const forgedAuthorityBytes = canonicalJson(forgedAuthority);
    expect(() => validateC6SourceV3SimpleReview({
      ...exactReview,
      provenanceBytes: provenanceFor(
        forgedAuthorityBytes,
        bundle,
      ),
      responseBytes: forgedAuthorityBytes,
    })).toThrow();

    const driftedVerifier = Buffer.from(
      artifacts.verifierSource.bytes,
    );
    driftedVerifier[0] ^= 0x01;
    expect(() => validateC6SourceV3SimpleReview({
      ...artifacts,
      authorTaskName: AUTHOR,
      dispatchBytes: bundle.dispatchBytes,
      inputBytes: bundle.inputBytes,
      provenanceBytes: review.provenanceBytes,
      requestBytes: bundle.requestBytes,
      responseBytes: review.responseBytes,
      reviewerAgentName: REVIEWER,
      verifierSource: {
        ...artifacts.verifierSource,
        bytes: driftedVerifier,
      },
    })).toThrow(
      "review request bundle does not match the exact source inputs",
    );

    const substitutedAuthor = "/root/substituted-author";
    const substitutedBundle =
      buildC6SourceV3SimpleReviewBundle({
        ...artifacts,
        authorTaskName: substitutedAuthor,
        reviewerAgentName: REVIEWER,
      });
    expect(() => validateC6SourceV3SimpleReview({
      ...artifacts,
      authorTaskName: substitutedAuthor,
      dispatchBytes: substitutedBundle.dispatchBytes,
      inputBytes: substitutedBundle.inputBytes,
      provenanceBytes: provenanceFor(
        review.responseBytes,
        substitutedBundle,
        substitutedAuthor,
      ),
      requestBytes: substitutedBundle.requestBytes,
      responseBytes: review.responseBytes,
      reviewerAgentName: REVIEWER,
    })).toThrow("response does not bind the exact review request");
  });
});

async function sourceArtifacts() {
  const [
    protocolBytes,
    sourceV2Bytes,
    metadataPredicateBytes,
    verifierSourceBytes,
  ] = await Promise.all([
    readFile(join(SOURCE_POOL_ROOT, PROTOCOL_BASENAME)),
    readFile(join(SOURCE_POOL_ROOT, SOURCE_V2_BASENAME)),
    readFile(join(SOURCE_POOL_ROOT, PRETARGET_POLICY_BASENAME)),
    readFile(join(process.cwd(), VERIFIER_PATH)),
  ]);
  return {
    metadataPredicate: {
      bytes: metadataPredicateBytes,
      path: PRETARGET_POLICY_BASENAME,
    },
    protocol: {
      bytes: protocolBytes,
      path: PROTOCOL_BASENAME,
    },
    sourceV2: {
      bytes: sourceV2Bytes,
      path: SOURCE_V2_BASENAME,
    },
    verifierSource: {
      bytes: verifierSourceBytes,
      path: VERIFIER_PATH,
    },
  };
}

function completedReview(bundle: {
  dispatchBytes: string;
  inputBytes: string;
  requestBytes: string;
}) {
  const responseBytes = canonicalJson({
    acceptedChecks: C6_SOURCE_V3_SIMPLE_REVIEW_REQUIRED_CHECKS,
    artifactKind: "c6-source-v3-simple-review-response",
    blockingFindings: [],
    boundary: {
      candidateManifestFrozen: false,
      codexRunReady: false,
      formalCensusPermitted: false,
      sourceV3SimpleFrozen: false,
      status:
        "protocol-review-accepted-freeze-and-promotion-receipt-still-required",
    },
    decision: "accepted-for-freeze-preparation",
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
  authorTaskName = AUTHOR,
): string {
  return canonicalJson({
    artifactKind: "c6-source-v3-simple-review-provenance",
    authorTaskName,
    dispatch: artifactReference(
      C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.dispatch,
      bundle.dispatchBytes,
    ),
    input: artifactReference(
      C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.input,
      bundle.inputBytes,
    ),
    recordedAt: REVIEWED_AT,
    request: artifactReference(
      C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.request,
      bundle.requestBytes,
    ),
    response: artifactReference(
      C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.response,
      responseBytes,
    ),
    reviewer: {
      agentName: REVIEWER,
      contextPolicy: "fork-turns-none",
      orchestratorAttestation: {
        attestedByTaskName: authorTaskName,
        basis:
          "orchestrator-observed-dispatch-no-cryptographic-receipt",
        cryptographicReceipt: false,
      },
      requestedTaskName: "c6_source_v3_simple_review_v1",
      type: "independent-ai-agent",
    },
    schemaVersion: 1,
  });
}

function artifactReference(path: string, bytes: string | Uint8Array) {
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
