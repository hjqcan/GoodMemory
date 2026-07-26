import { describe, expect, it } from "bun:test";

import {
  deriveC6SourceExpansionRestQualification,
} from "../../scripts/codex-coding-effect/c6-source-expansion-rest-qualification";

describe("Codex coding-effect C6 source-expansion REST qualification", () => {
  it("keeps missing captures in order and applies exact pull-author filtering", () => {
    const qualification = deriveC6SourceExpansionRestQualification({
      capturePlanSha256: "a".repeat(64),
      graphqlRootSha256: "b".repeat(64),
      restRootSha256: "c".repeat(64),
      targets: [{
        anchorId: "example/alpha#1",
        canonicalAnchorId: "example/alpha#1",
        captureDirectory: "example__alpha__1",
        captureOrder: 1,
      }, {
        anchorId: "example/beta#2",
        canonicalAnchorId: "example/beta#2",
        captureDirectory: "example__beta__2",
        captureOrder: 2,
      }],
      validatedClosures: new Map([[
        "example__alpha__1",
        {
          captureManifestSha256: "d".repeat(64),
          commits: [
            commit("a", "2026-01-01T00:00:00Z", []),
            commit("b", "2026-01-01T02:00:00Z", ["a"]),
            commit("c", "2026-01-01T04:00:00Z", ["b"]),
          ],
          pullAuthor: "pull-author",
          reviews: [{
            author: "pull-author",
            body: "Author-owned review is excluded.",
            commit: oid("a"),
            id: "author-review",
            state: "CHANGES_REQUESTED",
            submittedAt: "2026-01-01T00:30:00Z",
          }, {
            author: "reviewer-one",
            body: "First structural correction.",
            commit: oid("a"),
            id: "review-one",
            state: "CHANGES_REQUESTED",
            submittedAt: "2026-01-01T01:00:00Z",
          }],
          reviewThreads: [{
            id: "thread-one",
            comments: [{
              author: "pull-author",
              body: "Author response.",
              createdAt: "2026-01-01T02:30:00Z",
              id: "author-comment",
              originalCommit: oid("b"),
            }, {
              author: "reviewer-two",
              body: "Second structural correction.",
              createdAt: "2026-01-01T03:00:00Z",
              id: "review-two",
              originalCommit: oid("b"),
            }],
          }],
        },
      ]]),
    });

    expect(qualification.counts).toEqual({
      capturedClosureCount: 1,
      exactStructuralCandidateCount: 1,
      exactStructuralRepositoryCount: 1,
      missingClosureCount: 1,
      repositoryCappedStructuralCeiling: 1,
      targetCount: 2,
    });
    expect(qualification.results).toEqual([{
      anchorId: "example/alpha#1",
      canonicalAnchorId: "example/alpha#1",
      captureDirectory: "example__alpha__1",
      captureManifestSha256: "d".repeat(64),
      captureOrder: 1,
      exactEventCount: 2,
      exactLineageIdentitySha256: expect.stringMatching(
        /^[a-f0-9]{64}$/u,
      ),
      exactSequence: expect.objectContaining({
        firstReview: expect.objectContaining({ id: "review-one" }),
        secondReview: expect.objectContaining({ id: "review-two" }),
      }),
      status: "exact-structural-candidate",
    }, {
      anchorId: "example/beta#2",
      canonicalAnchorId: "example/beta#2",
      captureDirectory: "example__beta__2",
      captureOrder: 2,
      status: "missing-rest-closure",
    }]);
    expect(qualification.boundary).toMatchObject({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      captureAttemptCompletenessProven: false,
      codexRunReady: false,
      machineQualifiedEpisodeCount: 0,
    });
  });
});

function commit(label: string, committedAt: string, parents: string[]) {
  return {
    committedAt,
    oid: oid(label),
    parents: parents.map(oid),
  };
}

function oid(label: string): string {
  return label.repeat(40).slice(0, 40);
}
