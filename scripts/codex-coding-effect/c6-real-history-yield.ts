import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  buildC6AssetLock,
  readC6StableRegularFile,
  serializeC6AssetLock,
} from "./c6-asset-lock";

const SOURCE_REVISION =
  "56ff018c04a38e27ada1e9d0a6d5839a51f88f0d";
const requestPattern =
  /\b(?:please|should|could you|can you|need(?:s)? to|must|change|fix|remove|add|rename|update|instead|avoid|prefer|use|make|move|handle|support|test)\b/iu;
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const treeReceiptSchema = z.array(z.object({
  lfs: z.object({
    oid: sha256Schema,
    pointerSize: z.number().int().positive(),
    size: z.number().int().nonnegative(),
  }).passthrough().optional(),
  oid: commitSchema,
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  type: z.enum(["directory", "file"]),
}).passthrough());
const sourceRowSchema = z.object({
  number: z.number().int().positive(),
  org: z.string().min(1),
  repo: z.string().min(1),
  resolved_issues: z.array(z.object({
    number: z.number().int().positive(),
  }).passthrough()),
}).passthrough();
const pullSchema = z.object({
  base: z.object({
    repo: z.object({
      full_name: z.string().min(1),
    }).passthrough(),
  }).passthrough(),
  html_url: z.url(),
  number: z.number().int().positive(),
  user: z.object({
    login: z.string().min(1),
  }).passthrough(),
}).passthrough();
const reviewCommentSchema = z.object({
  body: z.string(),
  commit_id: commitSchema.nullable(),
  created_at: z.iso.datetime(),
  original_commit_id: commitSchema.nullable(),
  user: z.object({
    login: z.string().min(1),
  }).passthrough().nullable(),
}).passthrough();
const reviewSchema = z.object({
  body: z.string().nullable(),
  commit_id: commitSchema.nullable(),
  state: z.string(),
  submitted_at: z.iso.datetime(),
  user: z.object({
    login: z.string().min(1),
  }).passthrough().nullable(),
}).passthrough();
const pullCommitSchema = z.object({
  commit: z.object({
    committer: z.object({
      date: z.iso.datetime(),
    }).passthrough(),
  }).passthrough(),
  sha: commitSchema,
}).passthrough();

type Decision =
  | "fewer-than-two-review-events"
  | "no-resolved-issue-reference"
  | "no-review-fix-review-fix-sequence"
  | "strict-heuristic-signal"
  | "upstream-identity-mismatch";

interface ArtifactReference {
  bytes: number;
  path: string;
  sha256: string;
}

interface AnchorSourceUnit {
  path: string;
  rowIndex: number;
  rowSha256: string;
}

interface Anchor {
  number: number;
  org: string;
  repo: string;
  resolvedIssueCount: number;
  sourceUnits: AnchorSourceUnit[];
}

interface ReviewEvent {
  author: string;
  body: string;
  captureSha256: string;
  createdAt: string;
  currentCommitSha: string | null;
  reviewedCommitSha: string;
  source: "review-body" | "review-comment";
}

export interface C6RealHistoryYieldCensus {
  boundary: {
    acceptedEpisodeCount: 0;
    candidateManifestFrozen: false;
    status:
      "strict-partial-review-signal-scan-not-accepted-episodes";
  };
  captureBoundary: {
    pageRequestsCaptured: false;
    paginationClosureVerified: false;
    platformAuthenticityVerified: false;
    responseHeadersCaptured: false;
    status:
      "local-response-bodies-only-request-pagination-and-authenticity-unverified";
  };
  captureClosureSha256: string;
  counts: {
    canonicalAnchors: number;
    fewerThanTwoReviewEvents: number;
    localApiBodyFiles: number;
    noResolvedIssueReference: number;
    noReviewFixReviewFixSequence: number;
    sourceAliases: number;
    sourceFiles: number;
    sourceRows: number;
    strictHeuristicSignals: number;
    upstreamIdentityMismatch: number;
  };
  criterion: {
    eventFilter:
      "non-author-non-bot-username-request-pattern-inline-comment-or-review-body";
    eventSurface:
      "partial-review-surfaces-no-issue-or-pull-discussion-comments";
    sequence:
      "timestamp-only-review-fix-review-fix-heuristic-no-ancestry-proof";
    solutionPullBodyUsedAsPrompt: false;
  };
  decisions: Array<{
    anchorId: string;
    captures: {
      commits: ArtifactReference;
      pull: ArtifactReference;
      reviewComments: ArtifactReference;
      reviews: ArtifactReference;
    };
    decision: Decision;
    observedPullIdentity: {
      number: number;
      repository: string;
      url: string;
    };
    pullNumber: number;
    repository: string;
    resolvedIssueCount: number;
    sequence?: {
      firstFixCommitSha: string;
      firstReview: ReviewEvidence;
      initialCommitSha: string;
      method:
        "event-and-commit-timestamp-heuristic-no-ancestry-proof";
      secondFixCommitSha: string;
      secondReview: ReviewEvidence;
    };
    sourceUnits: AnchorSourceUnit[];
  }>;
  quota: {
    feasibilityConclusion:
      "not-estimable-from-partial-review-signal-surface";
    minimumRealHistoryEpisodes: number;
    observedGapToMinimum: number;
    strictHeuristicSignals: number;
  };
  requiredNextEvidence: readonly string[];
  schemaVersion: 1;
  source: {
    datasetId: "ByteDance-Seed/Multi-SWE-bench";
    maximumSourceFileBytes: number;
    revision: typeof SOURCE_REVISION;
    selectionPolicy:
      "all-provided-local-tree-receipt-dataset-jsonl-files-at-or-below-byte-threshold-v1";
    sourceClosureSha256: string;
    sourceFiles: Array<{
      bytes: number;
      path: string;
      revisionIdentity: "git-blob-sha1" | "git-lfs-sha256";
      receiptReportedRevisionObjectOid: string;
      rows: number;
      sha256: string;
    }>;
    treeReceipt: ArtifactReference;
    treeReceiptBoundary:
      "expected-hash-bound-local-body-request-and-pagination-unverified";
  };
  sourcePopulationSha256: string;
}

interface ReviewEvidence {
  author: string;
  bodyBytes: number;
  bodySha256: string;
  captureSha256: string;
  createdAt: string;
  currentCommitSha: string | null;
  reviewedCommitSha: string;
  source: ReviewEvent["source"];
}

export async function buildC6RealHistoryYieldCensus(input: {
  captureRoot: string;
  expectedTreeReceiptSha256: string;
  maximumSourceFileBytes: number;
  minimumRequiredEpisodes: number;
  sourceRoot: string;
  treeReceiptPath: string;
}): Promise<C6RealHistoryYieldCensus> {
  if (
    !Number.isSafeInteger(input.maximumSourceFileBytes) ||
    input.maximumSourceFileBytes <= 0
  ) {
    throw new Error(
      "C6 real-history census source-file byte ceiling must be a positive safe integer",
    );
  }
  if (
    !Number.isSafeInteger(input.minimumRequiredEpisodes) ||
    input.minimumRequiredEpisodes <= 0
  ) {
    throw new Error(
      "C6 real-history census minimum must be a positive safe integer",
    );
  }
  const sourceRoot = resolve(input.sourceRoot);
  const captureRoot = resolve(input.captureRoot);
  const treeReceiptPath = resolve(input.treeReceiptPath);
  const expectedTreeReceiptSha256 = sha256Schema.parse(
    input.expectedTreeReceiptSha256,
  );
  await assertC6NoSymlinkPathComponents(
    treeReceiptPath,
    "C6 real-history tree receipt",
  );
  const [treeReceiptBytes, sourceClosure, captureClosure] =
    await Promise.all([
      readC6StableRegularFile(
        treeReceiptPath,
        "real-history census tree receipt",
      ),
      buildC6AssetLock(sourceRoot),
      buildC6AssetLock(captureRoot),
    ]);
  if (sha256(treeReceiptBytes) !== expectedTreeReceiptSha256) {
    throw new Error(
      "C6 real-history census tree receipt does not match expected hash",
    );
  }
  const tree = treeReceiptSchema.parse(
    JSON.parse(treeReceiptBytes.toString("utf8")) as unknown,
  );
  const selectedTreeEntries = tree
    .filter((entry) =>
      entry.type === "file" &&
      entry.path.endsWith("_dataset.jsonl") &&
      entry.size <= input.maximumSourceFileBytes
    )
    .sort((left, right) => compareCanonicalString(left.path, right.path));
  if (selectedTreeEntries.length === 0) {
    throw new Error(
      "C6 real-history census selected source population is empty",
    );
  }
  const actualSourcePaths = sourceClosure.files
    .map((file) => file.path)
    .sort(compareCanonicalString);
  if (
    JSON.stringify(actualSourcePaths) !==
      JSON.stringify(selectedTreeEntries.map((entry) => entry.path))
  ) {
    throw new Error("C6 real-history census source file is missing");
  }

  const anchorsById = new Map<string, Anchor>();
  const sourceFiles: C6RealHistoryYieldCensus["source"]["sourceFiles"] = [];
  let sourceRows = 0;
  for (const entry of selectedTreeEntries) {
    const bytes = await readC6StableRegularFile(
      join(sourceRoot, entry.path),
      "real-history census source file",
    );
    const sourceSha256 = sha256(bytes);
    const sourceIdentityMatches = entry.lfs === undefined
      ? gitBlobOid(bytes) === entry.oid
      : (
        entry.lfs.size === entry.size &&
        sourceSha256 === entry.lfs.oid
      );
    if (
      bytes.byteLength !== entry.size ||
      !sourceIdentityMatches
    ) {
      throw new Error(
        `C6 real-history census source file identity does not match ${entry.path}`,
      );
    }
    const text = bytes.toString("utf8");
    if (!text.endsWith("\n")) {
      throw new Error(
        `C6 real-history census source file is not LF-terminated ${entry.path}`,
      );
    }
    const lines = text.slice(0, -1).split("\n");
    sourceFiles.push({
      bytes: bytes.byteLength,
      path: entry.path,
      revisionIdentity: entry.lfs === undefined
        ? "git-blob-sha1"
        : "git-lfs-sha256",
      receiptReportedRevisionObjectOid: entry.oid,
      rows: lines.length,
      sha256: sourceSha256,
    });
    sourceRows += lines.length;
    lines.forEach((line, lineIndex) => {
      const row = sourceRowSchema.parse(JSON.parse(line) as unknown);
      const repository = normalizeRepository(row.org, row.repo);
      const anchorId = `${repository}#${row.number}`;
      const sourceUnit = {
        path: entry.path,
        rowIndex: lineIndex + 1,
        rowSha256: sha256(`${line}\n`),
      };
      const existing = anchorsById.get(anchorId);
      if (existing === undefined) {
        anchorsById.set(anchorId, {
          number: row.number,
          org: row.org,
          repo: row.repo,
          resolvedIssueCount: new Set(
            row.resolved_issues.map((issue) => issue.number),
          ).size,
          sourceUnits: [sourceUnit],
        });
      } else {
        existing.sourceUnits.push(sourceUnit);
      }
    });
  }
  assertReferencesMatchClosure(
    sourceFiles.map((file) => ({
      bytes: file.bytes,
      path: file.path,
      sha256: file.sha256,
    })),
    sourceClosure.files,
    "source",
  );
  const anchors = [...anchorsById.values()].sort((left, right) =>
    compareCanonicalString(anchorId(left), anchorId(right))
  );
  const decisions: C6RealHistoryYieldCensus["decisions"] = [];
  for (const anchor of anchors) {
    decisions.push(await inspectAnchor(captureRoot, anchor));
  }
  const decisionCount = (decision: Decision): number =>
    decisions.filter((item) => item.decision === decision).length;
  const strictHeuristicSignals = decisionCount("strict-heuristic-signal");
  const captureReferences = decisions.flatMap((decision) =>
    Object.values(decision.captures)
  );
  assertReferencesMatchClosure(
    captureReferences,
    captureClosure.files,
    "capture",
  );
  const [terminalTreeReceiptBytes] = await Promise.all([
    readC6StableRegularFile(
      treeReceiptPath,
      "real-history census terminal tree receipt",
    ),
    verifyDirectoryClosure(sourceRoot, sourceClosure, "source"),
    verifyDirectoryClosure(captureRoot, captureClosure, "capture"),
  ]);
  if (!terminalTreeReceiptBytes.equals(treeReceiptBytes)) {
    throw new Error(
      "C6 real-history census tree receipt changed during scan",
    );
  }
  return {
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      status:
        "strict-partial-review-signal-scan-not-accepted-episodes",
    },
    captureBoundary: {
      pageRequestsCaptured: false,
      paginationClosureVerified: false,
      platformAuthenticityVerified: false,
      responseHeadersCaptured: false,
      status:
        "local-response-bodies-only-request-pagination-and-authenticity-unverified",
    },
    captureClosureSha256: captureClosure.assetRootSha256,
    counts: {
      canonicalAnchors: anchors.length,
      fewerThanTwoReviewEvents:
        decisionCount("fewer-than-two-review-events"),
      localApiBodyFiles: captureReferences.length,
      noResolvedIssueReference:
        decisionCount("no-resolved-issue-reference"),
      noReviewFixReviewFixSequence:
        decisionCount("no-review-fix-review-fix-sequence"),
      sourceAliases: sourceRows - anchors.length,
      sourceFiles: sourceFiles.length,
      sourceRows,
      strictHeuristicSignals,
      upstreamIdentityMismatch:
        decisionCount("upstream-identity-mismatch"),
    },
    criterion: {
      eventFilter:
        "non-author-non-bot-username-request-pattern-inline-comment-or-review-body",
      eventSurface:
        "partial-review-surfaces-no-issue-or-pull-discussion-comments",
      sequence:
        "timestamp-only-review-fix-review-fix-heuristic-no-ancestry-proof",
      solutionPullBodyUsedAsPrompt: false,
    },
    decisions,
    quota: {
      feasibilityConclusion:
        "not-estimable-from-partial-review-signal-surface",
      minimumRealHistoryEpisodes: input.minimumRequiredEpisodes,
      observedGapToMinimum: Math.max(
        0,
        input.minimumRequiredEpisodes - strictHeuristicSignals,
      ),
      strictHeuristicSignals,
    },
    requiredNextEvidence: [
      "independent-gold-blind-semantic-review",
      "upstream-capture-authentication",
      "request-response-header-and-pagination-closure",
      "issue-and-pull-discussion-event-surface",
      "repository-commit-and-tree-reachability",
      "stage-specific-base-gold-protection-linux-replay",
      "historical-project-license-review",
      "cross-stage-leakage-review",
      "deterministic-prehistory-materialization",
      "accepted-episode-intake-review",
    ],
    schemaVersion: 1,
    source: {
      datasetId: "ByteDance-Seed/Multi-SWE-bench",
      maximumSourceFileBytes: input.maximumSourceFileBytes,
      revision: SOURCE_REVISION,
      selectionPolicy:
        "all-provided-local-tree-receipt-dataset-jsonl-files-at-or-below-byte-threshold-v1",
      sourceClosureSha256: sourceClosure.assetRootSha256,
      sourceFiles,
      treeReceipt: artifactReference(
        basename(treeReceiptPath),
        treeReceiptBytes,
      ),
      treeReceiptBoundary:
        "expected-hash-bound-local-body-request-and-pagination-unverified",
    },
    sourcePopulationSha256: sha256(JSON.stringify(
      anchors.map((anchor) => ({
        anchorId: anchorId(anchor),
        resolvedIssueCount: anchor.resolvedIssueCount,
        sourceUnits: anchor.sourceUnits,
      })),
    )),
  };
}

export function serializeC6RealHistoryYieldCensus(
  census: C6RealHistoryYieldCensus,
): string {
  return `${JSON.stringify(census, null, 2)}\n`;
}

async function inspectAnchor(
  captureRoot: string,
  anchor: Anchor,
): Promise<C6RealHistoryYieldCensus["decisions"][number]> {
  const directory = `${anchor.org}__${anchor.repo}__${anchor.number}`;
  try {
    const [
      pullArtifact,
      reviewCommentsArtifact,
      reviewsArtifact,
      commitsArtifact,
    ] = await Promise.all([
      readCapture(captureRoot, directory, "pull.json"),
      readCapture(captureRoot, directory, "review-comments.json"),
      readCapture(captureRoot, directory, "reviews.json"),
      readCapture(captureRoot, directory, "commits.json"),
    ]);
    const pull = pullSchema.parse(
      JSON.parse(pullArtifact.bytes.toString("utf8")) as unknown,
    );
    const reviewComments = parsePages(
      reviewCommentsArtifact.bytes,
      reviewCommentSchema,
    );
    const reviews = parsePages(reviewsArtifact.bytes, reviewSchema);
    const commits = parsePages(commitsArtifact.bytes, pullCommitSchema);
    if (commits.length === 0) {
      throw new Error("local pull commit response body is empty");
    }
    const repository = normalizeRepository(anchor.org, anchor.repo);
    const observedPullIdentity = {
      number: pull.number,
      repository: pull.base.repo.full_name.toLowerCase(),
      url: normalizePullUrl(pull.html_url),
    };
    const captures = {
      commits: commitsArtifact.reference,
      pull: pullArtifact.reference,
      reviewComments: reviewCommentsArtifact.reference,
      reviews: reviewsArtifact.reference,
    };
    if (
      pull.number !== anchor.number ||
      pull.base.repo.full_name.toLowerCase() !== repository ||
      observedPullIdentity.url !==
        `https://github.com/${repository}/pull/${anchor.number}`
    ) {
      return {
        anchorId: anchorId(anchor),
        captures,
        decision: "upstream-identity-mismatch",
        observedPullIdentity,
        pullNumber: anchor.number,
        repository,
        resolvedIssueCount: anchor.resolvedIssueCount,
        sourceUnits: anchor.sourceUnits,
      };
    }
    const events: ReviewEvent[] = [
      ...reviewComments
        .filter(hasOriginalReviewedCommit)
        .filter(hasReviewAuthor)
        .map((comment) => ({
          author: comment.user.login,
          body: comment.body,
          captureSha256: reviewCommentsArtifact.reference.sha256,
          createdAt: comment.created_at,
          currentCommitSha: comment.commit_id,
          reviewedCommitSha: comment.original_commit_id,
          source: "review-comment" as const,
        })),
      ...reviews
        .filter(hasReviewedCommit)
        .filter(hasReviewAuthor)
        .map((review) => ({
          author: review.user.login,
          body: review.body ?? "",
          captureSha256: reviewsArtifact.reference.sha256,
          createdAt: review.submitted_at,
          currentCommitSha: review.commit_id,
          reviewedCommitSha: review.commit_id,
          source: "review-body" as const,
        })),
    ].filter((event) =>
      isNonAuthorNonBotUsername(event.author, pull.user.login) &&
      event.body.trim().length >= 10 &&
      requestPattern.test(event.body)
    ).sort(compareEvents);
    const sequence = findSequence(commits, events);
    const decision: Decision =
      anchor.resolvedIssueCount === 0
        ? "no-resolved-issue-reference"
        : events.length < 2
        ? "fewer-than-two-review-events"
        : sequence === undefined
        ? "no-review-fix-review-fix-sequence"
        : "strict-heuristic-signal";
    return {
      anchorId: anchorId(anchor),
      captures,
      decision,
      observedPullIdentity,
      pullNumber: anchor.number,
      repository,
      resolvedIssueCount: anchor.resolvedIssueCount,
      sequence,
      sourceUnits: anchor.sourceUnits,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `C6 real-history census capture is incomplete for ${anchorId(anchor)}: ${message}`,
    );
  }
}

function findSequence(
  commits: readonly z.infer<typeof pullCommitSchema>[],
  events: readonly ReviewEvent[],
): C6RealHistoryYieldCensus["decisions"][number]["sequence"] {
  for (let firstIndex = 0; firstIndex < events.length; firstIndex += 1) {
    const firstReview = events[firstIndex]!;
    const firstReviewTime = Date.parse(firstReview.createdAt);
    const firstFix = commits.find((commit) =>
      commit.sha !== firstReview.reviewedCommitSha &&
      commitTimestamp(commit) > firstReviewTime
    );
    const initialCommit = commits.find((commit) =>
      commitTimestamp(commit) <= firstReviewTime
    );
    if (firstFix === undefined || initialCommit === undefined) {
      continue;
    }
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < events.length;
      secondIndex += 1
    ) {
      const secondReview = events[secondIndex]!;
      const secondReviewTime = Date.parse(secondReview.createdAt);
      if (
        secondReview.reviewedCommitSha === firstReview.reviewedCommitSha ||
        secondReviewTime <= firstReviewTime ||
        secondReviewTime < commitTimestamp(firstFix)
      ) {
        continue;
      }
      const secondFix = commits.find((commit) =>
        commit.sha !== secondReview.reviewedCommitSha &&
        commit.sha !== firstFix.sha &&
        commitTimestamp(commit) > secondReviewTime
      );
      if (secondFix === undefined) {
        continue;
      }
      return {
        firstFixCommitSha: firstFix.sha,
        firstReview: reviewEvidence(firstReview),
        initialCommitSha: initialCommit.sha,
        method:
          "event-and-commit-timestamp-heuristic-no-ancestry-proof",
        secondFixCommitSha: secondFix.sha,
        secondReview: reviewEvidence(secondReview),
      };
    }
  }
}

function commitTimestamp(
  commit: z.infer<typeof pullCommitSchema>,
): number {
  return Date.parse(commit.commit.committer.date);
}

function reviewEvidence(event: ReviewEvent): ReviewEvidence {
  return {
    author: event.author,
    bodyBytes: Buffer.byteLength(event.body),
    bodySha256: sha256(event.body),
    captureSha256: event.captureSha256,
    createdAt: event.createdAt,
    currentCommitSha: event.currentCommitSha,
    reviewedCommitSha: event.reviewedCommitSha,
    source: event.source,
  };
}

async function readCapture(
  root: string,
  directory: string,
  filename: string,
): Promise<{
  bytes: Buffer;
  reference: ArtifactReference;
}> {
  const path = `${directory}/${filename}`;
  const bytes = await readC6StableRegularFile(
    join(root, path),
    "real-history census API capture",
  );
  return {
    bytes,
    reference: artifactReference(path, bytes),
  };
}

function parsePages<Schema extends z.ZodType>(
  bytes: Buffer,
  schema: Schema,
): Array<z.infer<Schema>> {
  return z.array(z.array(schema)).parse(
    JSON.parse(bytes.toString("utf8")) as unknown,
  ).flat();
}

function artifactReference(
  path: string,
  bytes: Uint8Array,
): ArtifactReference {
  return {
    bytes: bytes.byteLength,
    path,
    sha256: sha256(bytes),
  };
}

function anchorId(anchor: Anchor): string {
  return `${normalizeRepository(anchor.org, anchor.repo)}#${anchor.number}`;
}

function normalizeRepository(org: string, repo: string): string {
  const value = `${org}/${repo}`.toLowerCase();
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/u.test(value)) {
    throw new Error(`invalid C6 real-history repository ${org}/${repo}`);
  }
  return value;
}

function normalizePullUrl(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.toLowerCase()}${
    url.search
  }`;
}

function compareEvents(left: ReviewEvent, right: ReviewEvent): number {
  return Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
    compareCanonicalString(
      left.reviewedCommitSha,
      right.reviewedCommitSha,
    ) ||
    compareCanonicalString(left.source, right.source) ||
    compareCanonicalString(sha256(left.body), sha256(right.body));
}

function hasReviewedCommit<T extends { commit_id: string | null }>(
  value: T,
): value is T & { commit_id: string } {
  return value.commit_id !== null;
}

function hasOriginalReviewedCommit<T extends {
  original_commit_id: string | null;
}>(value: T): value is T & { original_commit_id: string } {
  return value.original_commit_id !== null;
}

function hasReviewAuthor<T extends {
  user: { login: string } | null;
}>(value: T): value is T & { user: { login: string } } {
  return value.user !== null;
}

function isNonAuthorNonBotUsername(
  author: string,
  pullAuthor: string,
): boolean {
  return author.toLowerCase() !== pullAuthor.toLowerCase() &&
    !author.toLowerCase().endsWith("[bot]");
}

function compareCanonicalString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertReferencesMatchClosure(
  references: readonly ArtifactReference[],
  closureFiles: readonly {
    bytes: number;
    path: string;
    sha256: string;
  }[],
  label: string,
): void {
  const normalize = (
    values: readonly {
      bytes: number;
      path: string;
      sha256: string;
    }[],
  ) => values
    .map(({ bytes, path, sha256 }) => ({ bytes, path, sha256 }))
    .sort((left, right) => compareCanonicalString(left.path, right.path));
  if (
    JSON.stringify(normalize(references)) !==
      JSON.stringify(normalize(closureFiles))
  ) {
    throw new Error(
      `C6 real-history census parsed ${label} references do not match initial closure`,
    );
  }
}

async function verifyDirectoryClosure(
  root: string,
  expected: Awaited<ReturnType<typeof buildC6AssetLock>>,
  label: string,
): Promise<void> {
  const current = await buildC6AssetLock(root);
  if (
    serializeC6AssetLock(current) !== serializeC6AssetLock(expected)
  ) {
    throw new Error(
      `C6 real-history census ${label} closure changed during scan`,
    );
  }
}

function gitBlobOid(bytes: Uint8Array): string {
  return createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
