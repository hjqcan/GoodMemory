import { describe, expect, it } from "bun:test";

import {
  C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2,
  projectC6StructuralReviewEvents,
  projectC6StructuralReviewPretargetEvents,
  selectC6MinimumLinearReviewSequence,
  serializeC6StructuralReviewEventPolicy,
} from "../../scripts/codex-coding-effect/c6-review-event-policy";

const commits = [
  commit("a", "2026-01-01T00:00:00Z", []),
  commit("b", "2026-01-01T02:00:00Z", ["a"]),
  commit("c", "2026-01-01T04:00:00Z", ["b"]),
  commit("d", "2026-01-01T06:00:00Z", ["c"]),
];

describe("Codex coding-effect C6 structural review-event policy", () => {
  it("uses structural whole-review and first non-author thread rules", () => {
    const input = {
      pullAuthor: "pull-author",
      reviews: [
        review({
          author: "reviewer-one",
          body: "  This needs a structural correction.\r\n",
          commit: "a",
          id: "review-accepted",
          state: "CHANGES_REQUESTED",
          submittedAt: "2026-01-01T01:00:00Z",
        }),
        review({
          author: "reviewer-two",
          body: "please change this but the state is only a comment",
          commit: "a",
          id: "review-commented",
          state: "COMMENTED",
          submittedAt: "2026-01-01T01:10:00Z",
        }),
        review({
          author: "pull-author",
          body: "This author-owned review must not qualify.",
          commit: "a",
          id: "review-author",
          state: "CHANGES_REQUESTED",
          submittedAt: "2026-01-01T01:20:00Z",
        }),
        review({
          author: "automation[bot]",
          body: "This automated review must not qualify.",
          commit: "a",
          id: "review-bot",
          state: "CHANGES_REQUESTED",
          submittedAt: "2026-01-01T01:30:00Z",
        }),
        review({
          author: "reviewer-three",
          body: "short",
          commit: "a",
          id: "review-short",
          state: "CHANGES_REQUESTED",
          submittedAt: "2026-01-01T01:40:00Z",
        }),
      ],
      reviewThreads: [{
        id: "thread-one",
        isResolved: true,
        comments: [
          comment({
            author: "pull-author",
            body: "The author opened this thread.",
            createdAt: "2026-01-01T02:10:00Z",
            id: "thread-author",
            originalCommit: "b",
          }),
          comment({
            author: "automation[bot]",
            body: "Automated thread message.",
            createdAt: "2026-01-01T02:20:00Z",
            id: "thread-bot",
            originalCommit: "b",
          }),
          comment({
            author: "reviewer-two",
            body: "  No keyword is required here.  ",
            createdAt: "2026-01-01T03:00:00Z",
            id: "thread-selected",
            originalCommit: "b",
          }),
          comment({
            author: "reviewer-three",
            body: "A later reviewer comment is not selected.",
            createdAt: "2026-01-01T03:10:00Z",
            id: "thread-later",
            originalCommit: "b",
          }),
        ],
      }],
    };

    const events = projectC6StructuralReviewEvents(input);

    expect(events.map((event) => ({
      author: event.author,
      body: event.body,
      id: event.id,
      reviewedCommit: event.reviewedCommit,
      source: event.source,
      threadId: event.threadId,
    }))).toEqual([{
      author: "reviewer-one",
      body: "This needs a structural correction.",
      id: "review-accepted",
      reviewedCommit: oid("a"),
      source: "whole-review",
      threadId: null,
    }, {
      author: "reviewer-two",
      body: "No keyword is required here.",
      id: "thread-selected",
      reviewedCommit: oid("b"),
      source: "review-thread-comment",
      threadId: "thread-one",
    }]);
  });

  it("keeps GraphQL pretargets broad until the pull author is known", () => {
    const reviewThreads = [{
      id: "thread-one",
      isResolved: false,
      comments: [
        comment({
          author: "pull-author",
          body: "Author response that cannot be filtered yet.",
          createdAt: "2026-01-01T02:10:00Z",
          id: "author-first",
          originalCommit: "b",
        }),
        comment({
          author: "reviewer",
          body: "Reviewer response selected only in exact projection.",
          createdAt: "2026-01-01T03:00:00Z",
          id: "reviewer-second",
          originalCommit: "b",
        }),
      ],
    }];
    const reviews = [
      review({
        author: "pull-author",
        body: "Author review cannot be filtered without pull metadata.",
        commit: "a",
        id: "author-review",
        state: "CHANGES_REQUESTED",
        submittedAt: "2026-01-01T01:00:00Z",
      }),
    ];

    expect(
      projectC6StructuralReviewPretargetEvents({
        reviews,
        reviewThreads,
      }).map((event) => event.id),
    ).toEqual([
      "author-review",
      "author-first",
      "reviewer-second",
    ]);
    expect(
      projectC6StructuralReviewEvents({
        pullAuthor: "pull-author",
        reviews,
        reviewThreads,
      }).map((event) => event.id),
    ).toEqual(["reviewer-second"]);
  });

  it("selects the minimum legal linear lineage independent of input order", () => {
    const events = projectC6StructuralReviewEvents({
      pullAuthor: "pull-author",
      reviews: [
        review({
          author: "reviewer-one",
          body: "A structural observation without command keywords.",
          commit: "a",
          id: "review-one",
          state: "CHANGES_REQUESTED",
          submittedAt: "2026-01-01T01:00:00Z",
        }),
      ],
      reviewThreads: [{
        id: "thread-two",
        comments: [
          comment({
            author: "reviewer-two",
            body: "Second structural observation.",
            createdAt: "2026-01-01T03:00:00Z",
            id: "review-two",
            originalCommit: "b",
          }),
        ],
      }],
    });

    const selected = selectC6MinimumLinearReviewSequence({
      anchorId: "example/repository#1",
      commits,
      events,
    });
    const replay = selectC6MinimumLinearReviewSequence({
      anchorId: "example/repository#1",
      commits: [...commits].reverse(),
      events: [...events].reverse(),
    });

    expect(selected).not.toBeNull();
    expect(replay).toEqual(selected);
    expect(selected).toMatchObject({
      legalSequenceCount: 2,
      sequence: {
        firstFixCommit: oid("b"),
        firstReview: { id: "review-one" },
        initialCommit: oid("a"),
        secondFixCommit: oid("c"),
        secondReview: { id: "review-two" },
      },
    });
    expect(selected!.lineageIdentitySha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("freezes a prospective-only policy without outcome fields", () => {
    const serialized = serializeC6StructuralReviewEventPolicy();

    expect(serialized).toBe(
      `${JSON.stringify(C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2, null, 2)}\n`,
    );
    expect(C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2.boundary).toEqual({
      adaptiveProspective: true,
      application: "prospective-expansion-tranches-only",
      legacyFrameImmutable: true,
      personnelOutcomeBlindnessClaimed: false,
    });
    expect(serialized).not.toMatch(
      /sourceTestSignals|patch|hidden|gold|outcome|isResolved/u,
    );
  });
});

function commit(label: string, committedAt: string, parents: string[]) {
  return {
    committedAt,
    oid: oid(label),
    parents: parents.map(oid),
  };
}

function review(input: {
  author: string | null;
  body: string;
  commit: string | null;
  id: string;
  state: string;
  submittedAt: string;
}) {
  return {
    ...input,
    commit: input.commit === null ? null : oid(input.commit),
  };
}

function comment(input: {
  author: string | null;
  body: string;
  createdAt: string;
  id: string;
  originalCommit: string | null;
}) {
  return {
    ...input,
    originalCommit: input.originalCommit === null
      ? null
      : oid(input.originalCommit),
  };
}

function oid(label: string): string {
  return label.repeat(40).slice(0, 40);
}
