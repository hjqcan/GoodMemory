import { describe, expect, it } from "bun:test";

import {
  deriveC6ReviewerActorFilteredQualification,
} from "../../scripts/codex-coding-effect/c6-reviewer-actor-filtered-qualification";

describe("Codex coding-effect C6 reviewer actor filtered qualification", () => {
  it("reselects an exact sequence from the full raw event set after actor filtering", () => {
    const qualification = deriveC6ReviewerActorFilteredQualification({
      actorPlanSha256: "1".repeat(64),
      actorRootSha256: "2".repeat(64),
      actors: new Map([
        ["human-one", actor(true, "a")],
        ["human-two", actor(true, "b")],
        ["copilot-swe-agent", actor(false, "c")],
      ]),
      baseQualificationSha256: "3".repeat(64),
      closures: new Map([
        ["example__repo__1", closure()],
      ]),
      graphqlRootSha256: "4".repeat(64),
      sourceDataset: {
        datasetId: "SWE-bench-Live/MultiLang",
        revision: "5".repeat(40),
      },
      targets: [target()],
    });

    expect(qualification.counts).toEqual({
      actorFilteredExactFreshCandidateCount: 1,
      actorFilteredNoExactFreshSequenceCount: 0,
      actorIneligibleEventCount: 1,
      actorPlanTargetCount: 3,
      actorQualifiedEventCount: 2,
      priorFrameOverlapCount: 0,
      targetCount: 1,
    });
    expect(qualification.results[0]).toMatchObject({
      actorIneligibleEventCount: 1,
      actorQualifiedEventCount: 2,
      status: "actor-filtered-exact-structural-candidate",
      exactSequence: {
        firstReview: { author: "human-one" },
        secondReview: { author: "human-two" },
      },
    });
    expect(qualification.boundary).toMatchObject({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      humanReviewerIdentityProven: false,
      machineQualifiedEpisodeCount: 0,
    });
  });

  it("fails closed when an event actor is absent and rejects all-ineligible sequences", () => {
    const value = target();
    expect(() =>
      deriveC6ReviewerActorFilteredQualification({
        actorPlanSha256: "1".repeat(64),
        actorRootSha256: "2".repeat(64),
        actors: new Map([
          ["human-one", actor(true, "a")],
        ]),
        baseQualificationSha256: "3".repeat(64),
        closures: new Map([
          ["example__repo__1", closure()],
        ]),
        graphqlRootSha256: "4".repeat(64),
        targets: [value],
      })
    ).toThrow("missing actor closure");

    const filtered = deriveC6ReviewerActorFilteredQualification({
      actorPlanSha256: "1".repeat(64),
      actorRootSha256: "2".repeat(64),
      actors: new Map([
        ["human-one", actor(false, "a")],
        ["human-two", actor(false, "b")],
        ["copilot-swe-agent", actor(false, "c")],
      ]),
      baseQualificationSha256: "3".repeat(64),
      closures: new Map([
        ["example__repo__1", closure()],
      ]),
      graphqlRootSha256: "4".repeat(64),
      targets: [value],
    });
    expect(filtered.results[0]!.status).toBe(
      "no-actor-filtered-exact-structural-sequence",
    );
  });

  it("promotes a later eligible comment after filtering an ineligible thread head", () => {
    const value = deriveC6ReviewerActorFilteredQualification({
      actorPlanSha256: "1".repeat(64),
      actorRootSha256: "2".repeat(64),
      actors: new Map([
        ["human-one", actor(true, "a")],
        ["human-two", actor(true, "b")],
        ["service-automation", actor(false, "c")],
      ]),
      baseQualificationSha256: "3".repeat(64),
      closures: new Map([
        ["example__repo__1", {
          commits: [
            commit("a", "2026-01-01T00:00:00Z", []),
            commit("b", "2026-01-01T02:00:00Z", ["a"]),
            commit("c", "2026-01-01T04:00:00Z", ["b"]),
          ],
          reviews: [
            review(
              "human-two",
              "b",
              "2026-01-01T03:00:00Z",
              "two",
            ),
          ],
          reviewThreads: [{
            comments: [
              threadComment(
                "service-automation",
                "a",
                "2026-01-01T00:30:00Z",
                "automation",
              ),
              threadComment(
                "human-one",
                "a",
                "2026-01-01T01:00:00Z",
                "human",
              ),
            ],
            id: "thread-one",
          }],
        }],
      ]),
      graphqlRootSha256: "4".repeat(64),
      targets: [target()],
    });

    expect(value.results[0]).toMatchObject({
      actorIneligibleEventCount: 1,
      status: "actor-filtered-exact-structural-candidate",
      exactSequence: {
        firstReview: {
          author: "human-one",
          id: "comment-human",
          source: "review-thread-comment",
        },
        secondReview: {
          author: "human-two",
        },
      },
    });
  });
});

function target() {
  return {
    agentVisibleRequestSha256: "6".repeat(64),
    canonicalAnchorId: "example/repo#1",
    canonicalRepository: "example/repo",
    captureDirectory: "example__repo__1",
    captureOrder: 1,
    instanceId: "example__repo-1",
    pullAuthor: "pull-author",
    requestedAnchorId: "example/repo#1",
    rowIndex: 0,
    sourceSplit: "go",
    sourceSplitRowIndex: 0,
    status: "exact-structural-candidate" as const,
  };
}

function actor(eligible: boolean, marker: string) {
  return {
    captureManifestSha256: marker.repeat(64),
    eligible,
    reason: eligible
      ? "eligible-platform-user" as const
      : "known-automation-login" as const,
  };
}

function closure() {
  return {
    commits: [
      commit("a", "2026-01-01T00:00:00Z", []),
      commit("b", "2026-01-01T02:00:00Z", ["a"]),
      commit("c", "2026-01-01T04:00:00Z", ["b"]),
    ],
    reviews: [
      review("human-one", "a", "2026-01-01T01:00:00Z", "one"),
      review("human-two", "b", "2026-01-01T03:00:00Z", "two"),
      review(
        "copilot-swe-agent",
        "a",
        "2026-01-01T01:30:00Z",
        "bot",
      ),
    ],
    reviewThreads: [],
  };
}

function commit(label: string, committedAt: string, parents: string[]) {
  return {
    committedAt,
    oid: oid(label),
    parents: parents.map(oid),
  };
}

function review(
  author: string,
  commitLabel: string,
  submittedAt: string,
  marker: string,
) {
  return {
    author,
    body: `Behavioral correction ${marker}`,
    commit: oid(commitLabel),
    id: `review-${marker}`,
    state: "CHANGES_REQUESTED",
    submittedAt,
  };
}

function threadComment(
  author: string,
  commitLabel: string,
  createdAt: string,
  marker: string,
) {
  return {
    author,
    body: `Behavioral correction ${marker}`,
    createdAt,
    id: `comment-${marker}`,
    originalCommit: oid(commitLabel),
  };
}

function oid(label: string): string {
  return label.repeat(40).slice(0, 40);
}
