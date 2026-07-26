import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import {
  createC6RealHistoryOriginalRequestProjection,
  serializeC6RealHistoryOriginalRequestProjectionArtifact,
} from "../../scripts/codex-coding-effect/c6-real-history-original-request-projection";
import {
  validateC6OriginalRequestSemanticReviewReceipt,
} from "../../scripts/codex-coding-effect/c6-original-request-semantic-review";

const rawRecord = `${JSON.stringify({
  body: "excluded solution",
  instance_id: "org__repo-7",
  number: 7,
  org: "org",
  repo: "repo",
  resolved_issues: [{
    body: "Observable behavior is wrong.",
    number: 6,
    title: "Fix observable behavior",
  }],
  title: "excluded pull title",
})}\n`;
const projection = createC6RealHistoryOriginalRequestProjection({
  anchorId: "org/repo#7",
  cappedPoolRank: 2,
  rawRecord,
  source: {
    fileBytes: Buffer.byteLength(rawRecord),
    fileSha256: sha256(rawRecord),
    path: "ts/org__repo_dataset.jsonl",
    rowIndex: 1,
    rowSha256: sha256(rawRecord),
  },
});
const projectionArtifact = {
  artifactKind:
    "c6-real-history-original-request-projection" as const,
  boundary: {
    acceptedEpisodeCount: 0 as const,
    candidateManifestFrozen: false as const,
    codexRunReady: false as const,
    machineQualificationCandidateCount: 0 as const,
  },
  policy:
    "resolved-issues-only-sorted-lf-trim-v1" as const,
  projections: [projection],
  recording: {
    exactSourceFilesRequiredForReplay: true as const,
    externalSourceCaptureAuthenticated: false as const,
    independentReviewComplete: false as const,
  },
  schemaVersion: 1 as const,
  source: {
    datasetId: "ByteDance-Seed/Multi-SWE-bench" as const,
    inventorySha256: "b".repeat(64),
    revision:
      "56ff018c04a38e27ada1e9d0a6d5839a51f88f0d",
  },
};
const projectionSha256 = sha256(
  serializeC6RealHistoryOriginalRequestProjectionArtifact(
    projectionArtifact,
  ),
);
const qualificationSha256 = "c".repeat(64);

describe("C6 original-request semantic review receipt", () => {
  it("binds a gold-blind stage-1 semantic pass without promoting machine qualification", () => {
    expect(validateC6OriginalRequestSemanticReviewReceipt({
      projectionArtifact,
      projectionArtifactSha256: projectionSha256,
      qualificationSha256,
      receipt: validReceipt(),
      stage1Candidates: [{
        anchorId: "org/repo#7",
        cappedPoolRank: 2,
        stage1AfterCommit:
          "2222222222222222222222222222222222222222",
      }],
    })).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      externalSourceCaptureAuthenticated: false,
      machineQualificationCandidateCount: 0,
      materializedPromptCount: 1,
      reviewCryptographicReceipt: false,
      stage1SemanticReviewPendingCount: 0,
      stage1SemanticReviewedCount: 1,
      stage1TransitionQualificationBound: false,
    });
  });

  it("rejects projection, candidate, access-boundary, and reviewer drift", () => {
    const mutations: Array<
      (receipt: ReturnType<typeof validReceipt>) => void
    > = [
      (receipt) => {
        receipt.projection.sha256 = "d".repeat(64);
      },
      (receipt) => {
        receipt.assessments[0]!.promptSha256 = "e".repeat(64);
      },
      (receipt) => {
        receipt.assessments[0]!.stage1AfterCommit =
          "3333333333333333333333333333333333333333";
      },
      (receipt) => {
        receipt.review.sourcePullTitleBodyAccess = true as false;
      },
      (receipt) => {
        receipt.review.reviewerAgentName = receipt.review.authorTaskName;
      },
    ];

    for (const mutate of mutations) {
      const receipt = validReceipt();
      mutate(receipt);
      expect(() =>
        validateC6OriginalRequestSemanticReviewReceipt({
          projectionArtifact,
          projectionArtifactSha256: projectionSha256,
          qualificationSha256,
          receipt,
          stage1Candidates: [{
            anchorId: "org/repo#7",
            cappedPoolRank: 2,
            stage1AfterCommit:
              "2222222222222222222222222222222222222222",
          }],
        })
      ).toThrow();
    }
  });
});

function validReceipt() {
  return {
    artifactKind:
      "c6-original-request-semantic-review-receipt" as const,
    assessments: [{
      anchorId: "org/repo#7",
      beforeCommit:
        "1111111111111111111111111111111111111111",
      beforeCommitBinding:
        "reviewer-derived-public-ancestry-not-qualification-bound" as const,
      cappedPoolRank: 2,
      classification: "behavioral-coding-request" as const,
      decision: "stage1-semantic-pass" as const,
      finding:
        "The prompt defines observable behavior and the reviewed public diff responds.",
      promptBytes: projection.originalRequest.bytes,
      promptSha256: projection.originalRequest.sha256,
      stage1AfterCommit:
        "2222222222222222222222222222222222222222",
    }],
    boundary: {
      acceptedEpisodeCount: 0 as const,
      candidateManifestFrozen: false as const,
      codexRunReady: false as const,
      machineQualificationCandidateCount: 0 as const,
      stage1TransitionQualificationBound: false as const,
      status:
        "semantic-review-only-source-auth-and-machine-qualification-required" as const,
    },
    projection: {
      path:
        "multi-swe-full-56ff018.real-history-original-request-projections.json",
      sha256: projectionSha256,
    },
    qualification: {
      path:
        "multi-swe-full-56ff018.real-history-transition-qualification.json",
      sha256: qualificationSha256,
    },
    review: {
      authorTaskName: "/root",
      contextPolicy: "fork-turns-none" as const,
      cryptographicReceipt: false as const,
      hiddenEvaluatorAccess: false as const,
      outcomeAccess: false as const,
      rawGoldAccess: false as const,
      reviewedAt: "2026-07-25T23:31:03.000Z",
      reviewerAgentName: "/root/c6-stage1-reviewer",
      sourcePullTitleBodyAccess: false as const,
      sourceRowAccess: false as const,
    },
    schemaVersion: 1 as const,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
