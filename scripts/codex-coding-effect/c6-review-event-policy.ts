import { createHash } from "node:crypto";

const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const ANCHOR_PATTERN = /^[^/#]+\/[^/#]+#[1-9]\d*$/u;
const LINEAGE_DOMAIN_SEPARATOR =
  "goodmemory:c6:prospective-structural-review-v2:lineage:v1";

export const C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2 = {
  boundary: {
    adaptiveProspective: true,
    application: "prospective-expansion-tranches-only",
    legacyFrameImmutable: true,
    personnelOutcomeBlindnessClaimed: false,
  },
  eventOrdering: [
    "createdAt",
    "reviewedCommit",
    "source",
    "threadId",
    "bodySha256",
    "id",
  ],
  inputClosure: {
    selectionDependsOnUnlistedFields: false,
    usedFields: [
      "pullAuthor",
      "reviews[].author",
      "reviews[].body",
      "reviews[].commit",
      "reviews[].id",
      "reviews[].state",
      "reviews[].submittedAt",
      "reviewThreads[].id",
      "reviewThreads[].comments[].author",
      "reviewThreads[].comments[].body",
      "reviewThreads[].comments[].createdAt",
      "reviewThreads[].comments[].id",
      "reviewThreads[].comments[].originalCommit",
      "commits[].committedAt",
      "commits[].oid",
      "commits[].parents",
    ],
  },
  lineage: {
    domainSeparator: LINEAGE_DOMAIN_SEPARATOR,
    perAnchorSelection: "minimum-lineage-sha256",
    search: "all-legal-linear-review-fix-review-fix-sequences",
  },
  normalization: {
    body: "crlf-and-cr-to-lf-then-ecmascript-trim",
    identity: "author-login-case-insensitive",
  },
  policyId: "prospective-structural-review-v2",
  reviewThreadComments: {
    bodyMinimumUtf8Bytes: 0,
    commitBinding: "originalCommit-required",
    selection: "first-canonical-non-author-non-bot-comment-per-thread",
    threadResolutionAffectsSelection: false,
  },
  schemaVersion: 2,
  wholeReviews: {
    bodyMinimumUtf8Bytes: 10,
    commitBinding: "commit-required",
    state: "CHANGES_REQUESTED",
  },
} as const;

export interface C6ReviewPolicyCommit {
  committedAt: string;
  oid: string;
  parents: string[];
}

export interface C6ReviewPolicyReview {
  author: string | null;
  body: string;
  commit: string | null;
  id: string;
  state: string;
  submittedAt: string;
}

export interface C6ReviewPolicyThreadComment {
  author: string | null;
  body: string;
  createdAt: string;
  id: string;
  originalCommit: string | null;
}

export interface C6ReviewPolicyThread {
  comments: C6ReviewPolicyThreadComment[];
  id: string;
}

export interface C6StructuralReviewEvent {
  author: string;
  body: string;
  bodyBytes: number;
  bodySha256: string;
  createdAt: string;
  id: string;
  reviewedCommit: string;
  source: "review-thread-comment" | "whole-review";
  threadId: string | null;
}

export interface C6LinearReviewSequence {
  firstFixCommit: string;
  firstReview: C6StructuralReviewEvent;
  initialCommit: string;
  secondFixCommit: string;
  secondReview: C6StructuralReviewEvent;
}

export interface C6MinimumLinearReviewSequence {
  legalSequenceCount: number;
  lineageIdentitySha256: string;
  sequence: C6LinearReviewSequence;
}

export function serializeC6StructuralReviewEventPolicy(): string {
  return `${JSON.stringify(C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2, null, 2)}\n`;
}

export function projectC6StructuralReviewPretargetEvents(input: {
  reviews: readonly C6ReviewPolicyReview[];
  reviewThreads: readonly C6ReviewPolicyThread[];
}): C6StructuralReviewEvent[] {
  return sortAndValidateEvents([
    ...input.reviews.flatMap((review) =>
      projectWholeReview(review, null)
    ),
    ...input.reviewThreads.flatMap((thread) =>
      thread.comments.flatMap((comment) =>
        projectThreadComment(thread.id, comment, null)
      )
    ),
  ]);
}

export function projectC6StructuralReviewEvents(input: {
  pullAuthor: string;
  reviews: readonly C6ReviewPolicyReview[];
  reviewThreads: readonly C6ReviewPolicyThread[];
}): C6StructuralReviewEvent[] {
  const pullAuthor = normalizeLogin(input.pullAuthor, "pull author");
  const wholeReviews = input.reviews.flatMap((review) =>
    projectWholeReview(review, pullAuthor)
  );
  const threadComments = input.reviewThreads.flatMap((thread) => {
    const selected = [...thread.comments]
      .sort(compareThreadComments)
      .find((comment) =>
        projectThreadComment(thread.id, comment, pullAuthor).length === 1
      );
    return selected === undefined
      ? []
      : projectThreadComment(thread.id, selected, pullAuthor);
  });
  return sortAndValidateEvents([...wholeReviews, ...threadComments]);
}

export function selectC6MinimumLinearReviewSequence(input: {
  anchorId: string;
  commits: readonly C6ReviewPolicyCommit[];
  events: readonly C6StructuralReviewEvent[];
}): C6MinimumLinearReviewSequence | null {
  if (!ANCHOR_PATTERN.test(input.anchorId)) {
    throw new Error(`invalid C6 structural review anchor ${input.anchorId}`);
  }
  const commits = validateAndSortCommits(input.commits);
  const events = sortAndValidateEvents(input.events);
  const commitByOid = new Map(
    commits.map((commit) => [commit.oid, commit]),
  );
  const ancestry = createAncestryLookup(commitByOid);
  let legalSequenceCount = 0;
  let selected: {
    canonicalLineage: string;
    lineageIdentitySha256: string;
    sequence: C6LinearReviewSequence;
  } | null = null;

  for (const firstReview of events) {
    const initialCommit = commitByOid.get(firstReview.reviewedCommit);
    if (
      initialCommit === undefined ||
      timestamp(initialCommit.committedAt) >
        timestamp(firstReview.createdAt)
    ) {
      continue;
    }
    for (const firstFix of commits) {
      if (
        firstFix.oid === initialCommit.oid ||
        timestamp(firstFix.committedAt) <= timestamp(firstReview.createdAt) ||
        !ancestry(firstFix.oid, initialCommit.oid)
      ) {
        continue;
      }
      for (const secondReview of events) {
        const secondReviewedCommit = commitByOid.get(
          secondReview.reviewedCommit,
        );
        if (
          secondReview.id === firstReview.id ||
          secondReview.reviewedCommit === firstReview.reviewedCommit ||
          secondReviewedCommit === undefined ||
          timestamp(secondReview.createdAt) <=
            timestamp(firstReview.createdAt) ||
          timestamp(secondReview.createdAt) <
            timestamp(firstFix.committedAt) ||
          timestamp(secondReviewedCommit.committedAt) >
            timestamp(secondReview.createdAt) ||
          !ancestry(secondReviewedCommit.oid, firstFix.oid)
        ) {
          continue;
        }
        for (const secondFix of commits) {
          if (
            secondFix.oid === firstFix.oid ||
            secondFix.oid === secondReviewedCommit.oid ||
            timestamp(secondFix.committedAt) <=
              timestamp(secondReview.createdAt) ||
            !ancestry(secondFix.oid, secondReviewedCommit.oid) ||
            !ancestry(secondFix.oid, firstFix.oid)
          ) {
            continue;
          }
          legalSequenceCount += 1;
          const sequence = {
            firstFixCommit: firstFix.oid,
            firstReview,
            initialCommit: initialCommit.oid,
            secondFixCommit: secondFix.oid,
            secondReview,
          };
          const canonicalLineage = JSON.stringify({
            anchorId: input.anchorId,
            sequence,
          });
          const lineageIdentitySha256 = sha256(
            `${LINEAGE_DOMAIN_SEPARATOR}\0${canonicalLineage}`,
          );
          if (
            selected === null ||
            lineageIdentitySha256 < selected.lineageIdentitySha256 ||
            (
              lineageIdentitySha256 === selected.lineageIdentitySha256 &&
              canonicalLineage < selected.canonicalLineage
            )
          ) {
            selected = {
              canonicalLineage,
              lineageIdentitySha256,
              sequence,
            };
          }
        }
      }
    }
  }
  return selected === null
    ? null
    : {
      legalSequenceCount,
      lineageIdentitySha256: selected.lineageIdentitySha256,
      sequence: selected.sequence,
    };
}

function projectWholeReview(
  review: C6ReviewPolicyReview,
  pullAuthor: string | null,
): C6StructuralReviewEvent[] {
  if (
    review.author === null ||
    review.commit === null ||
    review.state !== C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2.wholeReviews.state
  ) {
    return [];
  }
  const author = normalizeLogin(review.author, "review author");
  const body = normalizeBody(review.body);
  if (
    isBot(author) ||
    (pullAuthor !== null && author === pullAuthor) ||
    Buffer.byteLength(body) <
      C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2.wholeReviews.bodyMinimumUtf8Bytes
  ) {
    return [];
  }
  return [{
    author: review.author,
    body,
    bodyBytes: Buffer.byteLength(body),
    bodySha256: sha256(body),
    createdAt: validateTimestamp(review.submittedAt),
    id: validateIdentity(review.id, "review id"),
    reviewedCommit: validateCommit(review.commit),
    source: "whole-review",
    threadId: null,
  }];
}

function projectThreadComment(
  threadId: string,
  comment: C6ReviewPolicyThreadComment,
  pullAuthor: string | null,
): C6StructuralReviewEvent[] {
  if (comment.author === null || comment.originalCommit === null) {
    return [];
  }
  const author = normalizeLogin(comment.author, "thread comment author");
  if (
    isBot(author) ||
    (pullAuthor !== null && author === pullAuthor)
  ) {
    return [];
  }
  const body = normalizeBody(comment.body);
  return [{
    author: comment.author,
    body,
    bodyBytes: Buffer.byteLength(body),
    bodySha256: sha256(body),
    createdAt: validateTimestamp(comment.createdAt),
    id: validateIdentity(comment.id, "thread comment id"),
    reviewedCommit: validateCommit(comment.originalCommit),
    source: "review-thread-comment",
    threadId: validateIdentity(threadId, "review thread id"),
  }];
}

function validateAndSortCommits(
  values: readonly C6ReviewPolicyCommit[],
): C6ReviewPolicyCommit[] {
  const commits = values.map((commit) => ({
    committedAt: validateTimestamp(commit.committedAt),
    oid: validateCommit(commit.oid),
    parents: commit.parents.map(validateCommit),
  })).sort(compareCommits);
  const seen = new Set<string>();
  for (const commit of commits) {
    if (seen.has(commit.oid)) {
      throw new Error(`duplicate C6 structural review commit ${commit.oid}`);
    }
    seen.add(commit.oid);
  }
  return commits;
}

function sortAndValidateEvents(
  values: readonly C6StructuralReviewEvent[],
): C6StructuralReviewEvent[] {
  const events = [...values].sort(compareEvents);
  const seen = new Set<string>();
  for (const event of events) {
    const key = `${event.source}\0${event.threadId ?? ""}\0${event.id}`;
    if (seen.has(key)) {
      throw new Error(`duplicate C6 structural review event ${event.id}`);
    }
    seen.add(key);
  }
  return events;
}

function createAncestryLookup(
  commits: ReadonlyMap<string, C6ReviewPolicyCommit>,
): (descendant: string, ancestor: string) => boolean {
  const memo = new Map<string, boolean>();
  return (descendant, ancestor) => {
    const key = `${descendant}\0${ancestor}`;
    const cached = memo.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const pending = [descendant];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (current === ancestor) {
        memo.set(key, true);
        return true;
      }
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      pending.push(...(commits.get(current)?.parents ?? []));
    }
    memo.set(key, false);
    return false;
  };
}

function compareThreadComments(
  left: C6ReviewPolicyThreadComment,
  right: C6ReviewPolicyThreadComment,
): number {
  return timestamp(left.createdAt) - timestamp(right.createdAt) ||
    compareStrings(left.id, right.id);
}

function compareCommits(
  left: C6ReviewPolicyCommit,
  right: C6ReviewPolicyCommit,
): number {
  return timestamp(left.committedAt) - timestamp(right.committedAt) ||
    compareStrings(left.oid, right.oid);
}

function compareEvents(
  left: C6StructuralReviewEvent,
  right: C6StructuralReviewEvent,
): number {
  return timestamp(left.createdAt) - timestamp(right.createdAt) ||
    compareStrings(left.reviewedCommit, right.reviewedCommit) ||
    compareStrings(left.source, right.source) ||
    compareStrings(left.threadId ?? "", right.threadId ?? "") ||
    compareStrings(left.bodySha256, right.bodySha256) ||
    compareStrings(left.id, right.id);
}

function normalizeBody(value: string): string {
  return value.replace(/\r\n?/gu, "\n").trim();
}

function normalizeLogin(value: string, label: string): string {
  const normalized = validateIdentity(value, label).toLowerCase();
  return normalized;
}

function isBot(author: string): boolean {
  return author.endsWith("[bot]");
}

function validateCommit(value: string): string {
  if (!COMMIT_PATTERN.test(value)) {
    throw new Error(`invalid C6 structural review commit ${value}`);
  }
  return value;
}

function validateTimestamp(value: string): string {
  timestamp(value);
  return value;
}

function validateIdentity(value: string, label: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(`invalid C6 structural review ${label}`);
  }
  return value;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid C6 structural review timestamp ${value}`);
  }
  return parsed;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
