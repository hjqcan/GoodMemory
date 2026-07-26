import { describe, expect, it } from "bun:test";

import {
  deriveC6MultilingualSourceExpansionQualification,
} from "../../scripts/codex-coding-effect/c6-multilingual-source-expansion-qualification";

describe("Codex coding-effect C6 multilingual source expansion qualification", () => {
  it("applies pull-author filtering and keeps overlap mutually exclusive", () => {
    const qualification =
      deriveC6MultilingualSourceExpansionQualification({
        expansionSha256: "1".repeat(64),
        graphqlRootSha256: "2".repeat(64),
        identityPlanSha256: "3".repeat(64),
        identityRootSha256: "4".repeat(64),
        targets: [
          target("example/overlap#1", 1, "prior-frame-overlap"),
          target("example/fresh#2", 2, "broad-structural-pretarget"),
          target("example/author#3", 3, "broad-structural-pretarget"),
        ],
        validatedClosures: new Map([
          ["example__overlap__1", closure("reviewer")],
          ["example__fresh__2", closure("reviewer")],
          ["example__author__3", closure("reviewer-one")],
        ]),
      });

    expect(qualification.counts).toEqual({
      exactFreshCandidateCount: 1,
      exactFreshRepositoryCount: 1,
      identityClosureCount: 3,
      noExactFreshSequenceCount: 1,
      priorFrameOverlapCount: 1,
      repositoryCappedFreshCeiling: 1,
      targetCount: 3,
    });
    expect(
      qualification.results.map((result) => result.status),
    ).toEqual([
      "prior-frame-overlap",
      "exact-structural-candidate",
      "no-exact-structural-sequence",
    ]);
    expect(qualification.results[0]).toMatchObject({
      exactQualification: "exact-sequence",
      status: "prior-frame-overlap",
    });
    expect(qualification.results[1]).toMatchObject({
      exactEventCount: 2,
      status: "exact-structural-candidate",
    });
    expect(qualification.boundary).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      machineQualifiedEpisodeCount: 0,
      pullIdentityClosureComplete: true,
      status:
        "multilingual-exact-structural-screening-semantic-review-required",
    });
  });

  it("requires every planned identity closure exactly once", () => {
    const targets = [
      target("example/one#1", 1, "broad-structural-pretarget"),
    ];
    expect(() =>
      deriveC6MultilingualSourceExpansionQualification({
        expansionSha256: "1".repeat(64),
        graphqlRootSha256: "2".repeat(64),
        identityPlanSha256: "3".repeat(64),
        identityRootSha256: "4".repeat(64),
        targets,
        validatedClosures: new Map(),
      })
    ).toThrow("missing identity closure example__one__1");

    expect(() =>
      deriveC6MultilingualSourceExpansionQualification({
        expansionSha256: "1".repeat(64),
        graphqlRootSha256: "2".repeat(64),
        identityPlanSha256: "3".repeat(64),
        identityRootSha256: "4".repeat(64),
        targets,
        validatedClosures: new Map([
          ["example__one__1", closure("reviewer")],
          ["unexpected__repo__9", closure("reviewer")],
        ]),
      })
    ).toThrow("unexpected identity closure unexpected__repo__9");
  });

  it("preserves an optional source descriptor and split locator", () => {
    const value = target(
      "example/live#5",
      5,
      "broad-structural-pretarget",
    );
    const qualification =
      deriveC6MultilingualSourceExpansionQualification({
        expansionSha256: "1".repeat(64),
        graphqlRootSha256: "2".repeat(64),
        identityPlanSha256: "3".repeat(64),
        identityRootSha256: "4".repeat(64),
        sourceDataset: {
          datasetId: "SWE-bench-Live/MultiLang",
          revision: "608f7ae9ab8ea1f9f0d030fe04562cf6bd1a0c8b",
        },
        targets: [{
          ...value,
          sourceSplit: "go",
          sourceSplitRowIndex: 4,
        }],
        validatedClosures: new Map([
          ["example__live__5", closure("reviewer")],
        ]),
      });

    expect(qualification.sourceDataset).toEqual({
      datasetId: "SWE-bench-Live/MultiLang",
      revision: "608f7ae9ab8ea1f9f0d030fe04562cf6bd1a0c8b",
    });
    expect(qualification.results[0]).toMatchObject({
      sourceSplit: "go",
      sourceSplitRowIndex: 4,
    });
  });
});

function target(
  canonicalAnchorId: string,
  captureOrder: number,
  status: "broad-structural-pretarget" | "prior-frame-overlap",
) {
  const [repository, pullNumber] = canonicalAnchorId.split("#");
  const [owner, repo] = repository!.split("/");
  return {
    agentVisibleRequestSha256: String(captureOrder).repeat(64),
    canonicalAnchorId,
    canonicalRepository: repository!,
    captureDirectory: `${owner}__${repo}__${pullNumber}`,
    captureOrder,
    instanceId: `${owner}__${repo}-${pullNumber}`,
    requestedAnchorId: canonicalAnchorId,
    rowIndex: captureOrder - 1,
    status,
  };
}

function closure(pullAuthor: string) {
  return {
    commits: [
      commit("a", "2026-01-01T00:00:00Z", []),
      commit("b", "2026-01-01T02:00:00Z", ["a"]),
      commit("c", "2026-01-01T04:00:00Z", ["b"]),
    ],
    identityManifestSha256: "a".repeat(64),
    pullAuthor,
    reviews: [{
      author: "reviewer-one",
      body: "First structural correction.",
      commit: oid("a"),
      id: "review-one",
      state: "CHANGES_REQUESTED",
      submittedAt: "2026-01-01T01:00:00Z",
    }],
    reviewThreads: [{
      comments: [{
        author: "reviewer-two",
        body: "Second structural correction.",
        createdAt: "2026-01-01T03:00:00Z",
        id: "review-two",
        originalCommit: oid("b"),
      }],
      id: "thread-one",
    }],
  };
}

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
