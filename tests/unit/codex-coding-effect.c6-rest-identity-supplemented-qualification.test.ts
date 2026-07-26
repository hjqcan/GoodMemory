import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import {
  deriveC6RestIdentitySupplementedQualification,
} from "../../scripts/codex-coding-effect/c6-rest-identity-supplemented-qualification";

describe("Codex coding-effect C6 REST identity supplemented qualification", () => {
  it("replaces every missing identity closure in the original order", () => {
    const fixture = createFixture();
    const qualification =
      deriveC6RestIdentitySupplementedQualification(fixture);

    expect(qualification.boundary).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      machineQualifiedEpisodeCount: 0,
      originalFullRestCaptureAttemptCompletenessProven: false,
      pullIdentitySupplementClosureComplete: true,
      status:
        "exact-structural-screening-complete-semantic-qualification-required",
    });
    expect(qualification.counts).toEqual({
      exactStructuralCandidateCount: 1,
      exactStructuralRepositoryCount: 1,
      fullRestClosureCount: 0,
      identitySupplementClosureCount: 1,
      missingClosureCount: 0,
      noExactStructuralSequenceCount: 0,
      repositoryCappedStructuralCeiling: 1,
      targetCount: 1,
    });
    expect(qualification.results[0]).toMatchObject({
      anchorId: "requested/repo#1",
      canonicalAnchorId: "canonical/repo#1",
      captureOrder: 1,
      exactEventCount: 2,
      qualificationSource: "pull-identity-supplement-v1",
      status: "exact-structural-candidate",
    });
  });

  it("rejects missing, extra, and identity-drifted supplement closures", () => {
    const missing = createFixture();
    missing.supplementClosures.clear();
    expect(() => deriveC6RestIdentitySupplementedQualification(missing))
      .toThrow("missing identity supplement closure");

    const extra = createFixture();
    extra.supplementClosures.set("extra__repo__2", closure());
    expect(() => deriveC6RestIdentitySupplementedQualification(extra))
      .toThrow("unknown identity supplement closure");

    const drift = createFixture();
    drift.supplementClosures.set("requested__repo__1", {
      ...closure(),
      canonicalAnchorId: "canonical/repo#2",
    });
    expect(() => deriveC6RestIdentitySupplementedQualification(drift))
      .toThrow("identity supplement mismatch");
  });
});

function createFixture() {
  const originalQualification = {
    artifactKind: "c6-source-expansion-rest-qualification",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      captureAttemptCompletenessProven: false,
      codexRunReady: false,
      machineQualifiedEpisodeCount: 0,
    },
    counts: {
      capturedClosureCount: 0,
      exactStructuralCandidateCount: 0,
      exactStructuralRepositoryCount: 0,
      missingClosureCount: 1,
      repositoryCappedStructuralCeiling: 0,
      targetCount: 1,
    },
    inputs: {
      capturePlanSha256: sha256("capture-plan"),
      graphqlRootSha256: sha256("graphql-root"),
      restRootSha256: sha256("rest-root"),
    },
    results: [{
      anchorId: "requested/repo#1",
      canonicalAnchorId: "canonical/repo#1",
      captureDirectory: "requested__repo__1",
      captureOrder: 1,
      source: {
        path: "ts/requested__repo_dataset.jsonl",
        rowIndex: 1,
        rowSha256: sha256("source-row"),
      },
      status: "missing-rest-closure",
    }],
    schemaVersion: 1,
  };
  return {
    graphqlRootSha256: sha256("graphql-root"),
    originalQualification,
    originalQualificationSha256: sha256("qualification"),
    supplementPlanSha256: sha256("supplement-plan"),
    supplementRootSha256: sha256("supplement-root"),
    supplementClosures: new Map([
      ["requested__repo__1", closure()],
    ]),
  };
}

function closure() {
  const first = "1".repeat(40);
  const second = "2".repeat(40);
  const third = "3".repeat(40);
  return {
    canonicalAnchorId: "canonical/repo#1",
    commits: [
      { committedAt: "2026-01-01T00:00:00.000Z", oid: first, parents: [] },
      {
        committedAt: "2026-01-01T02:00:00.000Z",
        oid: second,
        parents: [first],
      },
      {
        committedAt: "2026-01-01T04:00:00.000Z",
        oid: third,
        parents: [second],
      },
    ],
    pullAuthor: "pull-author",
    reviews: [
      {
        author: "reviewer-one",
        body: "change the first behavior",
        commit: first,
        id: "review-one",
        state: "CHANGES_REQUESTED",
        submittedAt: "2026-01-01T01:00:00.000Z",
      },
      {
        author: "reviewer-two",
        body: "change the second behavior",
        commit: second,
        id: "review-two",
        state: "CHANGES_REQUESTED",
        submittedAt: "2026-01-01T03:00:00.000Z",
      },
    ],
    reviewThreads: [],
    supplementManifestSha256: sha256("manifest"),
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
