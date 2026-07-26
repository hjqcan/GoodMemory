import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  readdir,
} from "node:fs/promises";
import {
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

import { z } from "zod";

import {
  C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_PARENTS_PAGE_QUERY,
  C6_LIVE_MULTILANG_NEIGHBOR_COMMITS_PAGE_QUERY,
  C6_LIVE_MULTILANG_NEIGHBOR_DEEP_INITIAL_QUERY,
  C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREAD_COMMENTS_PAGE_QUERY,
  C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREADS_PAGE_QUERY,
  C6_LIVE_MULTILANG_NEIGHBOR_REVIEWS_PAGE_QUERY,
  serializeC6LiveMultiLangNeighborDeepCaptureQueryPolicy,
} from "./c6-live-multilang-neighbor-deep-capture-plan";
import {
  serializeC6StructuralReviewEventPolicy,
} from "./c6-review-event-policy";

const ENDPOINT = "https://api.github.com/graphql";
const PAGE_SIZE = 100;
const MAX_RETRY_AFTER_MILLISECONDS = 60_000;
const RETRYABLE_HTTP_STATUS = new Set([
  429,
  502,
  503,
  504,
]);
const TRANSIENT_GRAPHQL_ERROR_TYPES = new Set([
  "INTERNAL",
  "INTERNAL_SERVER_ERROR",
  "RATE_LIMITED",
  "SERVICE_UNAVAILABLE",
  "TIMEOUT",
]);
const SOURCE_SPLITS = [
  "c",
  "cpp",
  "go",
  "js",
  "rust",
  "java",
  "ts",
  "cs",
] as const;
const REQUEST_FAMILIES = [
  "initial",
  "commits",
  "reviews",
  "reviewThreads",
  "commitParents",
  "reviewThreadComments",
] as const;
const RESPONSE_HEADER_NAMES = new Set([
  "content-type",
  "date",
  "etag",
  "retry-after",
  "x-github-request-id",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-ratelimit-resource",
  "x-ratelimit-used",
]);
const REQUIRED_SUCCESS_HEADERS = [
  "content-type",
  "date",
  "x-github-request-id",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-ratelimit-resource",
  "x-ratelimit-used",
] as const;

type RequestFamily = typeof REQUEST_FAMILIES[number];

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitOidSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const repositorySchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
);
const anchorSchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9]\d*$/u,
);
const captureDirectorySchema = z.string().regex(
  /^[A-Za-z0-9_.-]+__[A-Za-z0-9_.-]+__[1-9]\d*$/u,
);
const relativePathSchema = z.string().min(1).refine(
  isSafeRelativePath,
  "unsafe relative path",
);
const artifactReferenceSchema = z.object({
  bytes: z.number().int().nonnegative(),
  path: relativePathSchema,
  sha256: sha256Schema,
}).strict();
const completedBoundarySchema = z.object({
  acceptedEpisodeCount: z.literal(0),
  actorCaptureExecuted: z.literal(false),
  actorQualifiedEpisodeCount: z.literal(0),
  candidateManifestFrozen: z.literal(false),
  captureCompletenessProven: z.literal(true),
  codexRunReady: z.literal(false),
  deepCaptureExecuted: z.literal(true),
  machineQualifiedEpisodeCount: z.literal(0),
  semanticallyQualifiedEpisodeCount: z.literal(0),
  status: z.literal(
    "neighbor-structural-review-deep-capture-complete",
  ),
}).strict();
const plannedBoundarySchema = z.object({
  acceptedEpisodeCount: z.literal(0),
  actorCaptureExecuted: z.literal(false),
  actorQualifiedEpisodeCount: z.literal(0),
  candidateManifestFrozen: z.literal(false),
  captureCompletenessProven: z.literal(false),
  codexRunReady: z.literal(false),
  deepCaptureExecuted: z.literal(false),
  machineQualifiedEpisodeCount: z.literal(0),
  semanticallyQualifiedEpisodeCount: z.literal(0),
  status: z.literal(
    "neighbor-review-surface-deep-capture-plan-only",
  ),
}).strict();
const queryDescriptorSchema = z.object({
  operationName: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const queryHashesSchema = z.object({
  commitParents: sha256Schema,
  commits: sha256Schema,
  initial: sha256Schema,
  reviewThreadComments: sha256Schema,
  reviewThreads: sha256Schema,
  reviews: sha256Schema,
}).strict();
const planTargetSchema = z.object({
  authorLogin: z.string().min(1).nullable(),
  baseRefOid: commitOidSchema,
  canonicalAnchorId: anchorSchema,
  canonicalRepository: repositorySchema,
  captureDirectory: captureDirectorySchema,
  captureOrder: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  mergeCommitOid: commitOidSchema,
  mergedAt: z.iso.datetime(),
  observedReviewCount: z.number().int().nonnegative(),
  observedReviewThreadCount: z.number().int().nonnegative(),
  owner: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
  pilotRank: z.number().int().positive(),
  pullNumber: z.number().int().positive(),
  repo: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
  responseNodeRank: z.number().int().positive(),
  sourceSplit: z.enum(SOURCE_SPLITS),
  url: z.url(),
}).strict();
const legacyQualificationReferenceSchema =
  artifactReferenceSchema.extend({
    artifactKind: z.literal(
      "c6-live-multilang-neighbor-census-qualification",
    ),
    deepCaptureTargetProjectionSha256: sha256Schema,
    schemaVersion: z.union([
      z.literal(2),
      z.literal(3),
    ]),
  }).strict();
const commitCountQualificationReferenceSchema =
  artifactReferenceSchema.extend({
    artifactKind: z.literal(
      "c6-live-multilang-neighbor-commit-count-eligibility-qualification",
    ),
    deepCaptureTargetProjectionSha256: sha256Schema,
    deepPlanTargetProjectionSha256: sha256Schema,
    schemaVersion: z.literal(1),
  }).strict();
const planQualificationReferenceSchema = z.discriminatedUnion(
  "artifactKind",
  [
    legacyQualificationReferenceSchema,
    commitCountQualificationReferenceSchema,
  ],
);
const planSchema = z.object({
  artifactKind: z.literal(
    "c6-live-multilang-neighbor-deep-capture-plan",
  ),
  boundary: plannedBoundarySchema,
  counts: z.object({
    expectedRequestLowerBound: z.number().int().positive(),
    repositoryCount: z.number().int().positive(),
    targetCount: z.number().int().positive(),
  }).strict(),
  independenceBoundary: z.object({
    goldInput: z.literal(false),
    machineOutcomeInput: z.literal(false),
    patchInput: z.literal(false),
    qualificationDeepTargetProjectionSha256: sha256Schema,
    semanticDecisionInput: z.literal(false),
    targetProjectionSha256: sha256Schema,
    testInput: z.literal(false),
  }).strict(),
  inputs: z.object({
    qualification: planQualificationReferenceSchema,
  }).strict(),
  queryContract: z.object({
    capturePolicySha256: sha256Schema,
    endpoint: z.literal(ENDPOINT),
    initial: queryDescriptorSchema,
    structuralReviewPolicySha256: sha256Schema,
    supplements: z.object({
      commitParents: queryDescriptorSchema,
      commits: queryDescriptorSchema,
      reviewThreadComments: queryDescriptorSchema,
      reviewThreads: queryDescriptorSchema,
      reviews: queryDescriptorSchema,
    }).strict(),
  }).strict(),
  requestBoundary: z.object({
    initialRequestPerTarget: z.literal(1),
    paginationSupplementRequestCountKnown: z.literal(false),
    surfaceCompletenessClaimed: z.literal(false),
  }).strict(),
  rule: z.object({
    allowedBodyPaths: z.array(z.string().min(1)),
    endpoint: z.literal(ENDPOINT),
    forbiddenQueryPaths: z.array(z.string().min(1)),
    pagination: z.object({
      closureRequiredBeforeStructuralQualification:
        z.literal(true),
      pageSize: z.literal(PAGE_SIZE),
      supplementFamilies: z.array(z.string().min(1)),
      supplementScheduling: z.literal(
        "only-from-hasNextPage-with-prior-non-null-endCursor",
      ),
    }).strict(),
    policyId: z.literal(
      "c6-live-multilang-neighbor-deep-capture-query-v1",
    ),
    schemaVersion: z.literal(1),
    targetSelectionUsesReviewBodies: z.literal(false),
  }).strict(),
  sampleBoundary: z.object({
    adaptiveRepositoryExclusion: z.literal(true),
    mergedPullRequestsOnly: z.literal(true),
    newestPerRepositoryCap: z.literal(16),
    postMergeStructuralMetadataInput: z.literal(true),
    populationRepresentativenessProven: z.literal(false),
    repositorySampleRandom: z.literal(false),
    reviewSurfaceEnrichmentApplied: z.literal(true),
    reviewSurfacePretargetSelectionOnly: z.literal(true),
  }).strict(),
  schemaVersion: z.literal(1),
  sourceDataset: z.object({
    datasetId: z.literal("SWE-bench-Live/MultiLang"),
    revision: z.literal(
      "608f7ae9ab8ea1f9f0d030fe04562cf6bd1a0c8b",
    ),
  }).strict(),
  targets: z.array(planTargetSchema).min(1),
}).strict();

const cursorStepSchema = z.object({
  afterCursor: z.string().min(1).nullable(),
  collectedNodeCount: z.number().int().nonnegative(),
  endCursor: z.string().min(1).nullable(),
  hasNextPage: z.boolean(),
  nodeCount: z.number().int().nonnegative().max(PAGE_SIZE),
  page: z.number().int().positive(),
  totalCount: z.number().int().nonnegative(),
}).strict();
const requestConnectionStepSchema = cursorStepSchema.extend({
  connectionKey: z.string().min(1),
}).strict();
const publicConnectionSchema = z.object({
  collectedNodeCount: z.number().int().nonnegative(),
  complete: z.literal(true),
  cursorChain: z.array(cursorStepSchema).min(1),
  key: z.string().min(1),
  pageCount: z.number().int().positive(),
  parentNodeId: z.string().min(1).nullable(),
  path: z.string().min(1),
  totalCount: z.number().int().nonnegative(),
}).strict();
const transportErrorReferenceSchema =
  artifactReferenceSchema.extend({
    phase: z.enum(["body-read", "fetch", "timeout"]),
  }).strict();
const responseReferenceSchema = artifactReferenceSchema.extend({
  httpStatus: z.number().int().min(100).max(599),
}).strict();
const attemptSchema = z.object({
  attempt: z.number().int().positive().max(4),
  request: artifactReferenceSchema,
  response: responseReferenceSchema.optional(),
  responseHeaders: artifactReferenceSchema.optional(),
  retryAfterMilliseconds:
    z.number().int().nonnegative().max(60_000).optional(),
  transportError: transportErrorReferenceSchema.optional(),
}).strict();
const logicalRequestSchema = z.object({
  afterCursor: z.string().min(1).nullable(),
  attempts: z.array(attemptSchema).min(1).max(4),
  connections: z.array(requestConnectionStepSchema),
  family: z.enum(REQUEST_FAMILIES),
  page: z.number().int().positive(),
  parentNodeId: z.string().min(1).nullable(),
  requestOrder: z.number().int().positive(),
}).strict();
const identitySchema = z.object({
  authorLogin: z.string().min(1),
  baseRefOid: commitOidSchema,
  baseRepositoryId: z.string().min(1),
  baseRepositoryNameWithOwner: repositorySchema,
  createdAt: z.iso.datetime(),
  mergeCommitOid: commitOidSchema,
  mergedAt: z.iso.datetime(),
  pullRequestId: z.string().min(1),
  pullRequestNumber: z.number().int().positive(),
  pullRequestUrl: z.url(),
  repositoryId: z.string().min(1),
  repositoryNameWithOwner: repositorySchema,
}).strict();
const captureSchema = z.object({
  artifactKind: z.literal(
    "c6-live-multilang-neighbor-deep-capture-target",
  ),
  boundary: completedBoundarySchema,
  connections: z.array(publicConnectionSchema).min(1),
  counts: z.object({
    commitCount: z.number().int().nonnegative(),
    logicalRequestCount: z.number().int().positive(),
    networkRequestCount: z.number().int().positive(),
    parentEdgeCount: z.number().int().nonnegative(),
    reviewCount: z.number().int().nonnegative(),
    reviewThreadCommentCount: z.number().int().nonnegative(),
    reviewThreadCount: z.number().int().nonnegative(),
  }).strict(),
  identity: identitySchema,
  independenceBoundary: z.object({
    connectionClosureProjectionSha256: sha256Schema,
    rawReviewBodiesUsedForTargetSelection: z.literal(false),
  }).strict(),
  planTarget: planTargetSchema,
  requests: z.array(logicalRequestSchema).min(1),
  schemaVersion: z.literal(1),
}).strict();
const completionCaptureSchema = z.object({
  canonicalAnchorId: anchorSchema,
  captureDirectory: captureDirectorySchema,
  captureManifest: artifactReferenceSchema,
  captureOrder: z.number().int().positive(),
  connectionClosureProjectionSha256: sha256Schema,
  logicalRequestCount: z.number().int().positive(),
  networkRequestCount: z.number().int().positive(),
}).strict();
const completionSchema = z.object({
  artifactKind: z.literal(
    "c6-live-multilang-neighbor-deep-capture-completion",
  ),
  boundary: completedBoundarySchema,
  captures: z.array(completionCaptureSchema).min(1),
  counts: z.object({
    capturedTargetCount: z.number().int().positive(),
    logicalRequestCount: z.number().int().positive(),
    networkRequestCount: z.number().int().positive(),
    plannedTargetCount: z.number().int().positive(),
  }).strict(),
  independenceBoundary: z.object({
    captureProjectionSha256: sha256Schema,
    targetOrderPreserved: z.literal(true),
  }).strict(),
  plan: artifactReferenceSchema.extend({
    deepCaptureTargetProjectionSha256: sha256Schema,
    targetProjectionSha256: sha256Schema,
  }).strict(),
  queryHashes: queryHashesSchema,
  schemaVersion: z.literal(1),
}).strict();

const requestReceiptSchema = z.object({
  attempt: z.number().int().positive().max(4),
  endpoint: z.literal(ENDPOINT),
  headers: z.object({
    accept: z.literal("application/vnd.github+json"),
    authorization: z.literal("Bearer [REDACTED]"),
    "content-type": z.literal("application/json"),
    "user-agent": z.literal(
      "GoodMemory-C6-Neighbor-Deep-Capture/1",
    ),
    "x-github-api-version": z.literal("2022-11-28"),
  }).strict(),
  method: z.literal("POST"),
  operationName: z.string().min(1),
  query: z.string().min(1),
  querySha256: sha256Schema,
  variables: z.record(z.string(), z.unknown()),
}).strict();
const responseHeadersSchema = z.record(
  z.string(),
  z.string(),
).superRefine((headers, context) => {
  for (const name of Object.keys(headers)) {
    if (!RESPONSE_HEADER_NAMES.has(name)) {
      context.addIssue({
        code: "custom",
        message: `unknown response header ${name}`,
      });
    }
  }
});
const transportErrorSchema = z.object({
  artifactKind: z.literal(
    "c6-live-multilang-neighbor-deep-transport-error",
  ),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  message: z.string(),
  phase: z.enum(["body-read", "fetch", "timeout"]),
  retryScheduled: z.boolean(),
  schemaVersion: z.literal(1),
}).strict();

const rateLimitSchema = z.object({
  cost: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  resetAt: z.iso.datetime(),
}).strict();
const pageInfoSchema = z.object({
  endCursor: z.string().min(1).nullable(),
  hasNextPage: z.boolean(),
}).strict();
const authorSchema = z.object({
  login: z.string().min(1),
}).strict().nullable();
const parentSchema = z.object({
  oid: commitOidSchema,
}).strict();
const parentConnectionSchema = z.object({
  nodes: z.array(parentSchema).max(PAGE_SIZE),
  pageInfo: pageInfoSchema,
  totalCount: z.number().int().nonnegative(),
}).strict();
const commitNodeSchema = z.object({
  commit: z.object({
    committedDate: z.iso.datetime(),
    id: z.string().min(1),
    oid: commitOidSchema,
    parents: parentConnectionSchema,
  }).strict(),
}).strict();
const commitConnectionSchema = z.object({
  nodes: z.array(commitNodeSchema).max(PAGE_SIZE),
  pageInfo: pageInfoSchema,
  totalCount: z.number().int().nonnegative(),
}).strict();
const reviewSchema = z.object({
  author: authorSchema,
  body: z.string(),
  commit: z.object({
    oid: commitOidSchema,
  }).strict().nullable(),
  id: z.string().min(1),
  state: z.string().min(1),
  submittedAt: z.iso.datetime().nullable(),
}).strict();
const reviewConnectionSchema = z.object({
  nodes: z.array(reviewSchema).max(PAGE_SIZE),
  pageInfo: pageInfoSchema,
  totalCount: z.number().int().nonnegative(),
}).strict();
const reviewCommentSchema = z.object({
  author: authorSchema,
  body: z.string(),
  createdAt: z.iso.datetime(),
  id: z.string().min(1),
  originalCommit: z.object({
    oid: commitOidSchema,
  }).strict().nullable(),
}).strict();
const reviewCommentConnectionSchema = z.object({
  nodes: z.array(reviewCommentSchema).max(PAGE_SIZE),
  pageInfo: pageInfoSchema,
  totalCount: z.number().int().nonnegative(),
}).strict();
const reviewThreadSchema = z.object({
  comments: reviewCommentConnectionSchema,
  id: z.string().min(1),
}).strict();
const reviewThreadConnectionSchema = z.object({
  nodes: z.array(reviewThreadSchema).max(PAGE_SIZE),
  pageInfo: pageInfoSchema,
  totalCount: z.number().int().nonnegative(),
}).strict();
const pullIdentitySchema = z.object({
  id: z.string().min(1),
  number: z.number().int().positive(),
  url: z.url(),
}).strict();
const repositoryIdentitySchema = z.object({
  id: z.string().min(1),
  nameWithOwner: repositorySchema,
  pullRequest: pullIdentitySchema,
}).strict();
const initialResponseSchema = z.object({
  data: z.object({
    rateLimit: rateLimitSchema,
    repository: z.object({
      id: z.string().min(1),
      nameWithOwner: repositorySchema,
      pullRequest: pullIdentitySchema.extend({
        author: authorSchema,
        baseRefOid: commitOidSchema,
        baseRepository: z.object({
          id: z.string().min(1),
          nameWithOwner: repositorySchema,
        }).strict(),
        commits: commitConnectionSchema,
        createdAt: z.iso.datetime(),
        mergeCommit: z.object({
          oid: commitOidSchema,
        }).strict(),
        mergedAt: z.iso.datetime(),
        reviewThreads: reviewThreadConnectionSchema,
        reviews: reviewConnectionSchema,
      }).strict(),
    }).strict(),
  }).strict(),
}).strict();
const commitsResponseSchema = repositoryPageResponseSchema(
  "commits",
  commitConnectionSchema,
);
const reviewsResponseSchema = repositoryPageResponseSchema(
  "reviews",
  reviewConnectionSchema,
);
const reviewThreadsResponseSchema = repositoryPageResponseSchema(
  "reviewThreads",
  reviewThreadConnectionSchema,
);
const commitParentsResponseSchema = z.object({
  data: z.object({
    node: z.object({
      __typename: z.literal("Commit"),
      id: z.string().min(1),
      oid: commitOidSchema,
      parents: parentConnectionSchema,
    }).strict(),
    rateLimit: rateLimitSchema,
    repository: repositoryIdentitySchema,
  }).strict(),
}).strict();
const reviewThreadCommentsResponseSchema = z.object({
  data: z.object({
    node: z.object({
      __typename: z.literal("PullRequestReviewThread"),
      comments: reviewCommentConnectionSchema,
      id: z.string().min(1),
    }).strict(),
    rateLimit: rateLimitSchema,
    repository: repositoryIdentitySchema,
  }).strict(),
}).strict();

type Plan = z.infer<typeof planSchema>;
type PlanTarget = z.infer<typeof planTargetSchema>;
type Completion = z.infer<typeof completionSchema>;
type CompletionCapture = z.infer<typeof completionCaptureSchema>;
type Capture = z.infer<typeof captureSchema>;
type LogicalRequest = z.infer<typeof logicalRequestSchema>;
type RequestReceipt = z.infer<typeof requestReceiptSchema>;
type ArtifactReference = z.infer<typeof artifactReferenceSchema>;
type Identity = z.infer<typeof identitySchema>;
type CursorStep = z.infer<typeof cursorStepSchema>;

export interface C6LiveMultiLangNeighborNormalizedCommit {
  committedDate: string;
  id: string;
  oid: string;
  parentOids: string[];
}

export interface C6LiveMultiLangNeighborNormalizedReview {
  authorLogin: string | null;
  body: string;
  commitOid: string | null;
  id: string;
  state: string;
  submittedAt: string | null;
}

export interface C6LiveMultiLangNeighborNormalizedReviewComment {
  authorLogin: string | null;
  body: string;
  createdAt: string;
  id: string;
  originalCommitOid: string | null;
}

export interface C6LiveMultiLangNeighborNormalizedReviewThread {
  comments: C6LiveMultiLangNeighborNormalizedReviewComment[];
  id: string;
}

export type C6LiveMultiLangNeighborActorOccurrence =
  | {
    actorLogin: string;
    canonicalAnchorId: string;
    eventId: string;
    submittedAt: string | null;
    surface: "review";
  }
  | {
    actorLogin: string;
    canonicalAnchorId: string;
    createdAt: string;
    eventId: string;
    surface: "review-thread-comment";
    threadId: string;
  }
  | {
    actorLogin: string;
    canonicalAnchorId: string;
    eventId: string;
    surface: "pull-author";
  };

export interface C6LiveMultiLangNeighborRawResponseReference {
  attempt: number;
  family: RequestFamily;
  finalSuccessful: boolean;
  httpStatus: number;
  logicalRequestOrder: number;
  page: number;
  parentNodeId: string | null;
  reference: ArtifactReference;
}

export interface C6LiveMultiLangNeighborDeepEvidenceTarget {
  actorOccurrences: C6LiveMultiLangNeighborActorOccurrence[];
  canonicalAnchorId: string;
  captureDirectory: string;
  commits: C6LiveMultiLangNeighborNormalizedCommit[];
  identity: Identity;
  rawResponseReferences:
    C6LiveMultiLangNeighborRawResponseReference[];
  reviews: C6LiveMultiLangNeighborNormalizedReview[];
  reviewSurfaceClosureSha256: string;
  reviewThreads: C6LiveMultiLangNeighborNormalizedReviewThread[];
}

export interface C6LiveMultiLangNeighborDeepEvidence {
  actorOccurrences: C6LiveMultiLangNeighborActorOccurrence[];
  assetRootSha256: string;
  completionSha256: string;
  directoryCount: number;
  fileCount: number;
  finalSuccessfulResponseCount: number;
  logicalRequestCount: number;
  networkRequestCount: number;
  planSha256: string;
  targets: C6LiveMultiLangNeighborDeepEvidenceTarget[];
}

export interface C6LiveMultiLangNeighborDeepEvidenceInput {
  deepCaptureRoot: string;
  expectedAssetRootSha256: string;
  expectedCompletionSha256: string;
  expectedDirectoryCount: number;
  expectedFileCount: number;
  expectedPlanSha256: string;
  expectedTargetCount: number;
  planPath: string;
  testHooks?: {
    beforeTerminalVerification?: () => Promise<void> | void;
  };
}

interface SnapshotFile {
  bytes: number;
  mode: number;
  path: string;
  sha256: string;
}

interface TreeSnapshot {
  assetRootSha256: string;
  directories: Array<{
    mode: number;
    path: string;
  }>;
  files: SnapshotFile[];
}

interface ConnectionTracker {
  collectedNodeCount: number;
  complete: boolean;
  cursorChain: CursorStep[];
  key: string;
  nextCursor: string | null;
  pageCount: number;
  parentNodeId: string | null;
  path: string;
  seenCursors: Set<string>;
  seenNodeIds: Set<string>;
  totalCount: number | null;
}

interface MutableCommit
  extends C6LiveMultiLangNeighborNormalizedCommit {
  parentTracker: ConnectionTracker;
}

interface MutableThread
  extends C6LiveMultiLangNeighborNormalizedReviewThread {
  commentTracker: ConnectionTracker;
}

interface TargetReplayState {
  actorOccurrences: C6LiveMultiLangNeighborActorOccurrence[];
  commitIds: Set<string>;
  commitOids: Set<string>;
  commits: MutableCommit[];
  commentIds: Set<string>;
  connections: ConnectionTracker[];
  identity: Identity | null;
  rawResponseReferences:
    C6LiveMultiLangNeighborRawResponseReference[];
  reviewIds: Set<string>;
  reviews: C6LiveMultiLangNeighborNormalizedReview[];
  target: PlanTarget;
  threadIds: Set<string>;
  threads: MutableThread[];
}

interface SuccessfulRequest {
  raw: unknown;
  receipt: RequestReceipt;
}

export async function replayC6LiveMultiLangNeighborDeepEvidence(
  input: C6LiveMultiLangNeighborDeepEvidenceInput,
): Promise<C6LiveMultiLangNeighborDeepEvidence> {
  const expected = {
    assetRootSha256: sha256Schema.parse(
      input.expectedAssetRootSha256,
    ),
    completionSha256: sha256Schema.parse(
      input.expectedCompletionSha256,
    ),
    directoryCount: z.number().int().positive().parse(
      input.expectedDirectoryCount,
    ),
    fileCount: z.number().int().positive().parse(
      input.expectedFileCount,
    ),
    planSha256: sha256Schema.parse(input.expectedPlanSha256),
    targetCount: z.number().int().positive().parse(
      input.expectedTargetCount,
    ),
  };
  const planPath = await assertNoSymlinkPathComponents(
    input.planPath,
    "C6 deep-evidence plan",
  );
  const planFile = await readStableRegularFile(
    planPath,
    "C6 deep-evidence plan",
  );
  if (sha256(planFile.bytes) !== expected.planSha256) {
    throw new Error("C6 deep-evidence plan hash mismatch");
  }
  const plan = planSchema.parse(
    parseCanonicalJson(planFile.bytes, "plan"),
  );
  validatePlan(plan, expected.targetCount);

  const root = await assertNoSymlinkPathComponents(
    input.deepCaptureRoot,
    "C6 deep-evidence root",
  );
  const initialSnapshot = await buildTreeSnapshot(root);
  validateSnapshot(initialSnapshot, expected);
  const snapshotFiles = new Map(
    initialSnapshot.files.map((file) => [file.path, file]),
  );

  const completionFile = requiredSnapshotFile(
    snapshotFiles,
    "completion.json",
  );
  if (completionFile.sha256 !== expected.completionSha256) {
    throw new Error("C6 deep-evidence completion hash mismatch");
  }
  const completionBytes = (
    await readStableRegularFile(
      join(root, "completion.json"),
      "C6 deep-evidence completion",
    )
  ).bytes;
  assertReferenceContent(completionFile, completionBytes);
  const completion = completionSchema.parse(
    parseCanonicalJson(completionBytes, "completion"),
  );
  validateCompletion({
    completion,
    expectedTargetCount: expected.targetCount,
    plan,
    planBytes: planFile.bytes,
    planPath,
  });

  const expectedFiles = new Map<string, ArtifactReference>();
  registerExpectedReference(
    expectedFiles,
    artifactReference("completion.json", completionBytes),
  );
  const targets: C6LiveMultiLangNeighborDeepEvidenceTarget[] = [];
  let logicalRequestCount = 0;
  let networkRequestCount = 0;
  let finalSuccessfulResponseCount = 0;

  for (const [index, completionCapture] of
    completion.captures.entries()) {
    const target = plan.targets[index];
    const evidence = await replayTarget({
      completionCapture,
      expectedFiles,
      root,
      snapshotFiles,
      target,
      targetIndex: index + 1,
    });
    targets.push(evidence);
    logicalRequestCount +=
      completionCapture.logicalRequestCount;
    networkRequestCount +=
      completionCapture.networkRequestCount;
    const targetFinalSuccessfulResponseCount =
      evidence.rawResponseReferences.filter(
        (response) => response.finalSuccessful,
      ).length;
    if (
      targetFinalSuccessfulResponseCount !==
        completionCapture.logicalRequestCount
    ) {
      throw new Error(
        `C6 deep-evidence final-success count mismatch ${
          evidence.canonicalAnchorId
        }`,
      );
    }
    finalSuccessfulResponseCount +=
      targetFinalSuccessfulResponseCount;
  }

  if (
    logicalRequestCount !== completion.counts.logicalRequestCount ||
    networkRequestCount !== completion.counts.networkRequestCount ||
    finalSuccessfulResponseCount !== logicalRequestCount
  ) {
    throw new Error(
      "C6 deep-evidence completion request totals mismatch",
    );
  }
  assertExactReferenceClosure({
    expectedFiles,
    snapshot: initialSnapshot,
  });

  await input.testHooks?.beforeTerminalVerification?.();
  const terminalPlanPath =
    await assertNoSymlinkPathComponents(
      planPath,
      "C6 deep-evidence terminal plan",
    );
  const terminalRoot = await assertNoSymlinkPathComponents(
    root,
    "C6 deep-evidence terminal root",
  );
  if (
    terminalPlanPath !== planPath ||
    terminalRoot !== root
  ) {
    throw new Error(
      "C6 deep-evidence terminal path identity changed",
    );
  }
  const terminalPlan = await readStableRegularFile(
    terminalPlanPath,
    "C6 deep-evidence terminal plan",
  );
  if (
    sha256(terminalPlan.bytes) !== expected.planSha256 ||
    !terminalPlan.bytes.equals(planFile.bytes)
  ) {
    throw new Error("C6 deep-evidence plan changed during replay");
  }
  const terminalSnapshot = await buildTreeSnapshot(terminalRoot);
  if (
    serializeTreeSnapshot(terminalSnapshot) !==
      serializeTreeSnapshot(initialSnapshot)
  ) {
    throw new Error(
      "C6 deep-evidence asset closure changed during replay",
    );
  }
  validateSnapshot(terminalSnapshot, expected);

  const actorOccurrences = targets.flatMap(
    (target) => target.actorOccurrences,
  );
  return {
    actorOccurrences,
    assetRootSha256: terminalSnapshot.assetRootSha256,
    completionSha256: completionFile.sha256,
    directoryCount: terminalSnapshot.directories.length,
    fileCount: terminalSnapshot.files.length,
    finalSuccessfulResponseCount,
    logicalRequestCount,
    networkRequestCount,
    planSha256: expected.planSha256,
    targets,
  };
}

async function replayTarget(input: {
  completionCapture: CompletionCapture;
  expectedFiles: Map<string, ArtifactReference>;
  root: string;
  snapshotFiles: Map<string, SnapshotFile>;
  target: PlanTarget;
  targetIndex: number;
}): Promise<C6LiveMultiLangNeighborDeepEvidenceTarget> {
  const {
    completionCapture,
    expectedFiles,
    root,
    snapshotFiles,
    target,
    targetIndex,
  } = input;
  if (
    completionCapture.captureOrder !== targetIndex ||
    completionCapture.captureOrder !== target.captureOrder ||
    completionCapture.canonicalAnchorId !==
      target.canonicalAnchorId ||
    completionCapture.captureDirectory !==
      target.captureDirectory ||
    completionCapture.captureManifest.path !==
      `${target.captureDirectory}/capture.json`
  ) {
    throw new Error(
      `C6 deep-evidence completion capture order mismatch ${
        target.canonicalAnchorId
      }`,
    );
  }
  registerExpectedReference(
    expectedFiles,
    completionCapture.captureManifest,
  );
  const captureBytes = await readReferencedFile({
    reference: completionCapture.captureManifest,
    root,
    snapshotFiles,
  });
  const capture = captureSchema.parse(
    parseCanonicalJson(
      captureBytes,
      `capture ${target.canonicalAnchorId}`,
    ),
  );
  if (
    JSON.stringify(capture.planTarget) !== JSON.stringify(target) ||
    capture.counts.logicalRequestCount !==
      completionCapture.logicalRequestCount ||
    capture.counts.networkRequestCount !==
      completionCapture.networkRequestCount ||
    capture.independenceBoundary
      .connectionClosureProjectionSha256 !==
        completionCapture.connectionClosureProjectionSha256 ||
    sha256(JSON.stringify(capture.connections)) !==
      completionCapture.connectionClosureProjectionSha256
  ) {
    throw new Error(
      `C6 deep-evidence capture manifest mismatch ${
        target.canonicalAnchorId
      }`,
    );
  }

  const state: TargetReplayState = {
    actorOccurrences: [],
    commitIds: new Set(),
    commitOids: new Set(),
    commits: [],
    commentIds: new Set(),
    connections: [],
    identity: null,
    rawResponseReferences: [],
    reviewIds: new Set(),
    reviews: [],
    target,
    threadIds: new Set(),
    threads: [],
  };
  let networkRequestCount = 0;
  for (const [requestIndex, request] of capture.requests.entries()) {
    if (request.requestOrder !== requestIndex + 1) {
      throw new Error(
        `C6 deep-evidence request order mismatch ${
          target.canonicalAnchorId
        }`,
      );
    }
    networkRequestCount += request.attempts.length;
    const successful = await replayRequestArtifacts({
      captureDirectory: target.captureDirectory,
      expectedFiles,
      request,
      root,
      snapshotFiles,
      state,
    });
    const expectedSteps = applyResponsePage({
      raw: successful.raw,
      request,
      state,
    });
    if (
      JSON.stringify(expectedSteps) !==
        JSON.stringify(request.connections)
    ) {
      throw new Error(
        `C6 deep-evidence request connection steps mismatch ${
          target.canonicalAnchorId
        } request=${request.requestOrder}`,
      );
    }
  }
  if (
    capture.requests[0]?.family !== "initial" ||
    capture.requests.filter((request) =>
      request.family === "initial"
    ).length !== 1 ||
    state.identity === null ||
    state.connections.some((connection) => !connection.complete)
  ) {
    throw new Error(
      `C6 deep-evidence target closure incomplete ${
      target.canonicalAnchorId
      }`,
    );
  }
  if (
    JSON.stringify(state.identity) !==
      JSON.stringify(capture.identity)
  ) {
    throw new Error(
      `C6 deep-evidence manifest identity mismatch ${
        target.canonicalAnchorId
      }`,
    );
  }
  const publicConnections = orderedConnections(state).map(
    projectConnection,
  );
  if (
    JSON.stringify(publicConnections) !==
      JSON.stringify(capture.connections)
  ) {
    throw new Error(
      `C6 deep-evidence connection closure mismatch ${
        target.canonicalAnchorId
      }`,
    );
  }
  const commits = state.commits.map(
    ({ parentTracker: _parentTracker, ...commit }) => commit,
  );
  const reviewThreads = state.threads.map(
    ({ commentTracker: _commentTracker, ...thread }) => thread,
  );
  const counts = {
    commitCount: commits.length,
    logicalRequestCount: capture.requests.length,
    networkRequestCount,
    parentEdgeCount: commits.reduce(
      (count, commit) => count + commit.parentOids.length,
      0,
    ),
    reviewCount: state.reviews.length,
    reviewThreadCommentCount: reviewThreads.reduce(
      (count, thread) => count + thread.comments.length,
      0,
    ),
    reviewThreadCount: reviewThreads.length,
  };
  if (JSON.stringify(counts) !== JSON.stringify(capture.counts)) {
    throw new Error(
      `C6 deep-evidence normalized counts mismatch ${
        target.canonicalAnchorId
      }`,
    );
  }
  const reviewSurfaceClosure = {
    canonicalAnchorId: target.canonicalAnchorId,
    captureDirectory: target.captureDirectory,
    commits,
    identity: state.identity,
    rawResponseReferences: state.rawResponseReferences,
    reviews: state.reviews,
    reviewThreads,
  };
  return {
    actorOccurrences: state.actorOccurrences,
    canonicalAnchorId: target.canonicalAnchorId,
    captureDirectory: target.captureDirectory,
    commits,
    identity: state.identity,
    rawResponseReferences: state.rawResponseReferences,
    reviews: state.reviews,
    reviewSurfaceClosureSha256: sha256(
      JSON.stringify(reviewSurfaceClosure),
    ),
    reviewThreads,
  };
}

function orderedConnections(
  state: TargetReplayState,
): ConnectionTracker[] {
  return [
    requiredConnection(state, "commits"),
    ...state.commits.map((commit) => commit.parentTracker),
    requiredConnection(state, "reviews"),
    requiredConnection(state, "reviewThreads"),
    ...state.threads.map((thread) => thread.commentTracker),
  ];
}

async function replayRequestArtifacts(input: {
  captureDirectory: string;
  expectedFiles: Map<string, ArtifactReference>;
  request: LogicalRequest;
  root: string;
  snapshotFiles: Map<string, SnapshotFile>;
  state: TargetReplayState;
}): Promise<SuccessfulRequest> {
  const {
    captureDirectory,
    expectedFiles,
    request,
    root,
    snapshotFiles,
    state,
  } = input;
  validateRequestContext(request, state);
  let finalReceipt: RequestReceipt | null = null;
  let finalRaw: unknown;
  for (const [attemptIndex, attempt] of
    request.attempts.entries()) {
    const attemptNumber = attemptIndex + 1;
    const isFinal = attemptIndex === request.attempts.length - 1;
    if (attempt.attempt !== attemptNumber) {
      throw new Error("C6 deep-evidence attempt order mismatch");
    }
    const basePath = requestAttemptBasePath(
      request,
      attemptNumber,
    );
    if (
      attempt.request.path !== `${basePath}/request.json` ||
      attempt.responseHeaders?.path !==
        `${basePath}/response-headers.json` ||
      (
        attempt.response !== undefined &&
        attempt.response.path !== `${basePath}/response.json`
      ) ||
      (
        attempt.transportError !== undefined &&
        attempt.transportError.path !==
          `${basePath}/transport-error.json`
      )
    ) {
      throw new Error(
        "C6 deep-evidence request artifact path mismatch",
      );
    }
    for (const reference of [
      attempt.request,
      attempt.responseHeaders,
      attempt.response,
      attempt.transportError,
    ]) {
      if (reference !== undefined) {
        registerExpectedReference(expectedFiles, {
          bytes: reference.bytes,
          path: `${captureDirectory}/${reference.path}`,
          sha256: reference.sha256,
        });
      }
    }
    if (attempt.responseHeaders === undefined) {
      throw new Error(
        "C6 deep-evidence attempt lacks response headers",
      );
    }
    const requestBytes = await readTargetReferencedFile({
      captureDirectory,
      reference: attempt.request,
      root,
      snapshotFiles,
    });
    const receipt = requestReceiptSchema.parse(
      parseCanonicalJson(
        requestBytes,
        `request receipt ${request.requestOrder}/${attemptNumber}`,
      ),
    );
    validateRequestReceipt({
      attempt: attemptNumber,
      receipt,
      request,
      state,
    });
    const headerBytes = await readTargetReferencedFile({
      captureDirectory,
      reference: attempt.responseHeaders,
      root,
      snapshotFiles,
    });
    const headers = responseHeadersSchema.parse(
      parseCanonicalJson(
        headerBytes,
        `response headers ${request.requestOrder}/${attemptNumber}`,
      ),
    );

    if (attempt.transportError !== undefined) {
      if (
        attempt.response !== undefined ||
        isFinal ||
        attempt.retryAfterMilliseconds !==
          exponentialRetryDelay(attemptNumber)
      ) {
        throw new Error(
          "C6 deep-evidence transport retry boundary mismatch",
        );
      }
      const errorBytes = await readTargetReferencedFile({
        captureDirectory,
        reference: attempt.transportError,
        root,
        snapshotFiles,
      });
      const transportError = transportErrorSchema.parse(
        parseCanonicalJson(
          errorBytes,
          `transport error ${request.requestOrder}/${attemptNumber}`,
        ),
      );
      if (
        transportError.phase !== attempt.transportError.phase ||
        !transportError.retryScheduled
      ) {
        throw new Error(
          "C6 deep-evidence transport error mismatch",
        );
      }
      if (
        (
          transportError.httpStatus === null &&
          Object.keys(headers).length > 0
        ) ||
        (
          transportError.phase === "fetch" &&
          transportError.httpStatus !== null
        ) ||
        (
          transportError.phase === "body-read" &&
          transportError.httpStatus === null
        )
      ) {
        throw new Error(
          "C6 deep-evidence impossible transport provenance",
        );
      }
      continue;
    }
    if (attempt.response === undefined) {
      throw new Error(
        "C6 deep-evidence attempt lacks response evidence",
      );
    }
    const responseBytes = await readTargetReferencedFile({
      captureDirectory,
      reference: attempt.response,
      root,
      snapshotFiles,
    });
    const raw = parseJson(
      responseBytes,
      `response ${request.requestOrder}/${attemptNumber}`,
    );
    const hasErrors = graphqlErrors(raw).length > 0;
    const success =
      attempt.response.httpStatus === 200 && !hasErrors;
    state.rawResponseReferences.push({
      attempt: attemptNumber,
      family: request.family,
      finalSuccessful: isFinal && success,
      httpStatus: attempt.response.httpStatus,
      logicalRequestOrder: request.requestOrder,
      page: request.page,
      parentNodeId: request.parentNodeId,
      reference: {
        bytes: attempt.response.bytes,
        path:
          `${captureDirectory}/${attempt.response.path}`,
        sha256: attempt.response.sha256,
      },
    });
    if (isFinal) {
      if (
        !success ||
        attempt.retryAfterMilliseconds !== undefined
      ) {
        throw new Error(
          "C6 deep-evidence final attempt is not final-success",
        );
      }
      validateSuccessHeaders(headers);
      finalReceipt = receipt;
      finalRaw = raw;
      continue;
    }
    if (
      success ||
      attempt.retryAfterMilliseconds === undefined
    ) {
      throw new Error(
        "C6 deep-evidence retry attempt boundary mismatch",
      );
    }
    validateResponseRetry({
      attemptNumber,
      errors: graphqlErrors(raw),
      headers,
      retryAfterMilliseconds:
        attempt.retryAfterMilliseconds,
      status: attempt.response.httpStatus,
    });
  }
  if (finalReceipt === null) {
    throw new Error(
      "C6 deep-evidence logical request lacks final success",
    );
  }
  return {
    raw: finalRaw,
    receipt: finalReceipt,
  };
}

function applyResponsePage(input: {
  raw: unknown;
  request: LogicalRequest;
  state: TargetReplayState;
}): Array<CursorStep & { connectionKey: string }> {
  const { raw, request, state } = input;
  const steps: Array<CursorStep & { connectionKey: string }> = [];
  switch (request.family) {
    case "initial": {
      const parsed = initialResponseSchema.parse(raw);
      state.identity = validateInitialIdentity(
        parsed,
        state.target,
      );
      state.actorOccurrences.push({
        actorLogin: state.identity.authorLogin,
        canonicalAnchorId: state.target.canonicalAnchorId,
        eventId: state.identity.pullRequestId,
        surface: "pull-author",
      });
      const pull = parsed.data.repository.pullRequest;
      if (
        pull.reviews.totalCount !==
          state.target.observedReviewCount ||
        pull.reviewThreads.totalCount !==
          state.target.observedReviewThreadCount
      ) {
        throw new Error(
          "C6 deep-evidence observed review counts drifted",
        );
      }
      const commits = createTracker(
        "commits",
        "pullRequest.commits",
        null,
      );
      state.connections.push(commits);
      steps.push(acceptConnectionPage(
        commits,
        pull.commits,
        null,
        (node) => node.commit.id,
      ));
      registerCommits({
        nodes: pull.commits.nodes,
        state,
        steps,
      });

      const reviews = createTracker(
        "reviews",
        "pullRequest.reviews",
        null,
      );
      state.connections.push(reviews);
      steps.push(acceptConnectionPage(
        reviews,
        pull.reviews,
        null,
        (review) => review.id,
      ));
      registerReviews(state, pull.reviews.nodes);

      const threads = createTracker(
        "reviewThreads",
        "pullRequest.reviewThreads",
        null,
      );
      state.connections.push(threads);
      steps.push(acceptConnectionPage(
        threads,
        pull.reviewThreads,
        null,
        (thread) => thread.id,
      ));
      registerThreads({
        nodes: pull.reviewThreads.nodes,
        state,
        steps,
      });
      return steps;
    }
    case "commits": {
      const parsed = commitsResponseSchema.parse(raw);
      validateSupplementIdentity(
        parsed.data.repository,
        requiredIdentity(state),
      );
      const tracker = requiredConnection(state, "commits");
      const connection =
        parsed.data.repository.pullRequest.commits;
      steps.push(acceptConnectionPage(
        tracker,
        connection,
        request.afterCursor,
        (node) => node.commit.id,
      ));
      registerCommits({
        nodes: connection.nodes,
        state,
        steps,
      });
      return steps;
    }
    case "reviews": {
      const parsed = reviewsResponseSchema.parse(raw);
      validateSupplementIdentity(
        parsed.data.repository,
        requiredIdentity(state),
      );
      const tracker = requiredConnection(state, "reviews");
      const connection =
        parsed.data.repository.pullRequest.reviews;
      steps.push(acceptConnectionPage(
        tracker,
        connection,
        request.afterCursor,
        (review) => review.id,
      ));
      registerReviews(state, connection.nodes);
      return steps;
    }
    case "reviewThreads": {
      const parsed = reviewThreadsResponseSchema.parse(raw);
      validateSupplementIdentity(
        parsed.data.repository,
        requiredIdentity(state),
      );
      const tracker = requiredConnection(
        state,
        "reviewThreads",
      );
      const connection =
        parsed.data.repository.pullRequest.reviewThreads;
      steps.push(acceptConnectionPage(
        tracker,
        connection,
        request.afterCursor,
        (thread) => thread.id,
      ));
      registerThreads({
        nodes: connection.nodes,
        state,
        steps,
      });
      return steps;
    }
    case "commitParents": {
      const parsed = commitParentsResponseSchema.parse(raw);
      validateSupplementIdentity(
        parsed.data.repository,
        requiredIdentity(state),
      );
      const parentNodeId = requiredParentNodeId(request);
      const commit = state.commits.find(
        (candidate) => candidate.id === parentNodeId,
      );
      if (
        commit === undefined ||
        parsed.data.node.id !== commit.id ||
        parsed.data.node.oid !== commit.oid
      ) {
        throw new Error(
          "C6 deep-evidence commit-parent identity mismatch",
        );
      }
      const step = acceptConnectionPage(
        commit.parentTracker,
        parsed.data.node.parents,
        request.afterCursor,
        (parent) => parent.oid,
      );
      steps.push(step);
      commit.parentOids.push(
        ...parsed.data.node.parents.nodes.map(
          (parent) => parent.oid,
        ),
      );
      return steps;
    }
    case "reviewThreadComments": {
      const parsed =
        reviewThreadCommentsResponseSchema.parse(raw);
      validateSupplementIdentity(
        parsed.data.repository,
        requiredIdentity(state),
      );
      const parentNodeId = requiredParentNodeId(request);
      const thread = state.threads.find(
        (candidate) => candidate.id === parentNodeId,
      );
      if (
        thread === undefined ||
        parsed.data.node.id !== thread.id
      ) {
        throw new Error(
          "C6 deep-evidence review-thread identity mismatch",
        );
      }
      steps.push(acceptConnectionPage(
        thread.commentTracker,
        parsed.data.node.comments,
        request.afterCursor,
        (comment) => comment.id,
      ));
      registerComments({
        comments: parsed.data.node.comments.nodes,
        state,
        thread,
      });
      return steps;
    }
  }
}

function registerCommits(input: {
  nodes: z.infer<typeof commitNodeSchema>[];
  state: TargetReplayState;
  steps: Array<CursorStep & { connectionKey: string }>;
}): void {
  for (const node of input.nodes) {
    registerUnique(
      input.state.commitIds,
      node.commit.id,
      "commit ID",
    );
    registerUnique(
      input.state.commitOids,
      node.commit.oid,
      "commit OID",
    );
    const parentTracker = createTracker(
      `commitParents:${node.commit.id}`,
      `pullRequest.commits.nodes[${node.commit.id}].parents`,
      node.commit.id,
    );
    input.state.connections.push(parentTracker);
    input.steps.push(acceptConnectionPage(
      parentTracker,
      node.commit.parents,
      null,
      (parent) => parent.oid,
    ));
    input.state.commits.push({
      committedDate: node.commit.committedDate,
      id: node.commit.id,
      oid: node.commit.oid,
      parentOids: node.commit.parents.nodes.map(
        (parent) => parent.oid,
      ),
      parentTracker,
    });
  }
}

function registerReviews(
  state: TargetReplayState,
  reviews: z.infer<typeof reviewSchema>[],
): void {
  for (const review of reviews) {
    registerUnique(state.reviewIds, review.id, "review ID");
    const normalized = {
      authorLogin: review.author?.login ?? null,
      body: review.body,
      commitOid: review.commit?.oid ?? null,
      id: review.id,
      state: review.state,
      submittedAt: review.submittedAt,
    };
    state.reviews.push(normalized);
    if (normalized.authorLogin !== null) {
      state.actorOccurrences.push({
        actorLogin: normalized.authorLogin,
        canonicalAnchorId: state.target.canonicalAnchorId,
        eventId: normalized.id,
        submittedAt: normalized.submittedAt,
        surface: "review",
      });
    }
  }
}

function registerThreads(input: {
  nodes: z.infer<typeof reviewThreadSchema>[];
  state: TargetReplayState;
  steps: Array<CursorStep & { connectionKey: string }>;
}): void {
  for (const node of input.nodes) {
    registerUnique(
      input.state.threadIds,
      node.id,
      "review-thread ID",
    );
    const commentTracker = createTracker(
      `reviewThreadComments:${node.id}`,
      `pullRequest.reviewThreads.nodes[${node.id}].comments`,
      node.id,
    );
    input.state.connections.push(commentTracker);
    input.steps.push(acceptConnectionPage(
      commentTracker,
      node.comments,
      null,
      (comment) => comment.id,
    ));
    const thread: MutableThread = {
      commentTracker,
      comments: [],
      id: node.id,
    };
    input.state.threads.push(thread);
    registerComments({
      comments: node.comments.nodes,
      state: input.state,
      thread,
    });
  }
}

function registerComments(input: {
  comments: z.infer<typeof reviewCommentSchema>[];
  state: TargetReplayState;
  thread: MutableThread;
}): void {
  for (const comment of input.comments) {
    registerUnique(
      input.state.commentIds,
      comment.id,
      "review-comment ID",
    );
    const normalized = {
      authorLogin: comment.author?.login ?? null,
      body: comment.body,
      createdAt: comment.createdAt,
      id: comment.id,
      originalCommitOid: comment.originalCommit?.oid ?? null,
    };
    input.thread.comments.push(normalized);
    if (normalized.authorLogin !== null) {
      input.state.actorOccurrences.push({
        actorLogin: normalized.authorLogin,
        canonicalAnchorId:
          input.state.target.canonicalAnchorId,
        createdAt: normalized.createdAt,
        eventId: normalized.id,
        surface: "review-thread-comment",
        threadId: input.thread.id,
      });
    }
  }
}

function acceptConnectionPage<T>(
  tracker: ConnectionTracker,
  input: {
    nodes: T[];
    pageInfo: {
      endCursor: string | null;
      hasNextPage: boolean;
    };
    totalCount: number;
  },
  afterCursor: string | null,
  identify: (node: T) => string,
): CursorStep & { connectionKey: string } {
  const expectedAfter = tracker.pageCount === 0
    ? null
    : tracker.nextCursor;
  if (
    tracker.complete ||
    afterCursor !== expectedAfter ||
    (
      tracker.totalCount !== null &&
      tracker.totalCount !== input.totalCount
    ) ||
    input.nodes.length > PAGE_SIZE
  ) {
    throw new Error(
      `C6 deep-evidence connection boundary mismatch ${
        tracker.key
      }`,
    );
  }
  tracker.totalCount ??= input.totalCount;
  for (const node of input.nodes) {
    const id = identify(node);
    if (tracker.seenNodeIds.has(id)) {
      throw new Error(
        `C6 deep-evidence duplicate connection node ${
          tracker.key
        }/${id}`,
      );
    }
    tracker.seenNodeIds.add(id);
  }
  tracker.collectedNodeCount += input.nodes.length;
  if (tracker.collectedNodeCount > input.totalCount) {
    throw new Error(
      `C6 deep-evidence connection exceeds total ${
        tracker.key
      }`,
    );
  }
  const { endCursor, hasNextPage } = input.pageInfo;
  if (
    (
      hasNextPage &&
      (
        endCursor === null ||
        input.nodes.length === 0 ||
        tracker.collectedNodeCount >= input.totalCount
      )
    ) ||
    (input.nodes.length === 0 && endCursor !== null) ||
    (input.nodes.length > 0 && endCursor === null) ||
    (
      endCursor !== null &&
      tracker.seenCursors.has(endCursor)
    )
  ) {
    throw new Error(
      `C6 deep-evidence invalid cursor ${tracker.key}`,
    );
  }
  if (endCursor !== null) {
    tracker.seenCursors.add(endCursor);
  }
  tracker.pageCount += 1;
  tracker.nextCursor = hasNextPage ? endCursor : null;
  if (!hasNextPage) {
    if (tracker.collectedNodeCount !== input.totalCount) {
      throw new Error(
        `C6 deep-evidence collected count mismatch ${
          tracker.key
        }`,
      );
    }
    tracker.complete = true;
  }
  const step = {
    afterCursor,
    collectedNodeCount: tracker.collectedNodeCount,
    endCursor,
    hasNextPage,
    nodeCount: input.nodes.length,
    page: tracker.pageCount,
    totalCount: input.totalCount,
  };
  tracker.cursorChain.push(step);
  return {
    ...step,
    connectionKey: tracker.key,
  };
}

function createTracker(
  key: string,
  path: string,
  parentNodeId: string | null,
): ConnectionTracker {
  return {
    collectedNodeCount: 0,
    complete: false,
    cursorChain: [],
    key,
    nextCursor: null,
    pageCount: 0,
    parentNodeId,
    path,
    seenCursors: new Set(),
    seenNodeIds: new Set(),
    totalCount: null,
  };
}

function projectConnection(
  tracker: ConnectionTracker,
): z.infer<typeof publicConnectionSchema> {
  if (tracker.totalCount === null || !tracker.complete) {
    throw new Error(
      `C6 deep-evidence incomplete connection ${tracker.key}`,
    );
  }
  return {
    collectedNodeCount: tracker.collectedNodeCount,
    complete: true,
    cursorChain: tracker.cursorChain,
    key: tracker.key,
    pageCount: tracker.pageCount,
    parentNodeId: tracker.parentNodeId,
    path: tracker.path,
    totalCount: tracker.totalCount,
  };
}

function validateRequestContext(
  request: LogicalRequest,
  state: TargetReplayState,
): void {
  if (request.family === "initial") {
    if (
      request.requestOrder !== 1 ||
      request.page !== 1 ||
      request.parentNodeId !== null ||
      request.afterCursor !== null ||
      state.identity !== null
    ) {
      throw new Error(
        "C6 deep-evidence initial request context mismatch",
      );
    }
    return;
  }
  if (
    request.page < 2 ||
    request.afterCursor === null ||
    state.identity === null
  ) {
    throw new Error(
      "C6 deep-evidence supplement request context mismatch",
    );
  }
  const tracker = requestTracker(request, state);
  if (
    tracker.complete ||
    request.page !== tracker.pageCount + 1 ||
    request.afterCursor !== tracker.nextCursor ||
    request.parentNodeId !== tracker.parentNodeId
  ) {
    throw new Error(
      `C6 deep-evidence supplement cursor mismatch ${
        request.family
      }`,
    );
  }
}

function requestTracker(
  request: LogicalRequest,
  state: TargetReplayState,
): ConnectionTracker {
  switch (request.family) {
    case "commits":
      return requiredConnection(state, "commits");
    case "reviews":
      return requiredConnection(state, "reviews");
    case "reviewThreads":
      return requiredConnection(state, "reviewThreads");
    case "commitParents":
      return requiredConnection(
        state,
        `commitParents:${requiredParentNodeId(request)}`,
      );
    case "reviewThreadComments":
      return requiredConnection(
        state,
        `reviewThreadComments:${requiredParentNodeId(request)}`,
      );
    case "initial":
      throw new Error(
        "C6 deep-evidence initial request has no prior tracker",
      );
  }
}

function validateRequestReceipt(input: {
  attempt: number;
  receipt: RequestReceipt;
  request: LogicalRequest;
  state: TargetReplayState;
}): void {
  const { attempt, receipt, request, state } = input;
  const contract = queryContract(request.family);
  if (
    receipt.attempt !== attempt ||
    receipt.operationName !== contract.operationName ||
    receipt.query !== contract.query ||
    receipt.querySha256 !== sha256(contract.query)
  ) {
    throw new Error(
      `C6 deep-evidence query receipt mismatch ${
        request.family
      }`,
    );
  }
  const expectedVariables: Record<string, unknown> = {
    name: state.target.repo,
    number: state.target.pullNumber,
    owner: state.target.owner,
  };
  if (request.family !== "initial") {
    expectedVariables.after = request.afterCursor;
  }
  if (request.family === "commitParents") {
    expectedVariables.commitId =
      requiredParentNodeId(request);
  }
  if (request.family === "reviewThreadComments") {
    expectedVariables.threadId =
      requiredParentNodeId(request);
  }
  if (
    JSON.stringify(sortRecord(receipt.variables)) !==
      JSON.stringify(sortRecord(expectedVariables))
  ) {
    throw new Error(
      `C6 deep-evidence request variables mismatch ${
        request.family
      }`,
    );
  }
}

function queryContract(family: RequestFamily): {
  operationName: string;
  query: string;
} {
  switch (family) {
    case "initial":
      return {
        operationName: "C6NeighborDeepInitial",
        query: C6_LIVE_MULTILANG_NEIGHBOR_DEEP_INITIAL_QUERY,
      };
    case "commits":
      return {
        operationName: "C6NeighborDeepCommitsPage",
        query: C6_LIVE_MULTILANG_NEIGHBOR_COMMITS_PAGE_QUERY,
      };
    case "reviews":
      return {
        operationName: "C6NeighborDeepReviewsPage",
        query: C6_LIVE_MULTILANG_NEIGHBOR_REVIEWS_PAGE_QUERY,
      };
    case "reviewThreads":
      return {
        operationName: "C6NeighborDeepReviewThreadsPage",
        query:
          C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREADS_PAGE_QUERY,
      };
    case "commitParents":
      return {
        operationName: "C6NeighborDeepCommitParentsPage",
        query:
          C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_PARENTS_PAGE_QUERY,
      };
    case "reviewThreadComments":
      return {
        operationName:
          "C6NeighborDeepReviewThreadCommentsPage",
        query:
          C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREAD_COMMENTS_PAGE_QUERY,
      };
  }
}

function requestAttemptBasePath(
  request: LogicalRequest,
  attempt: number,
): string {
  return (
    `requests/${
      String(request.requestOrder).padStart(4, "0")
    }__${request.family}__page-${
      String(request.page).padStart(3, "0")
    }/attempt-${String(attempt).padStart(2, "0")}`
  );
}

function validatePlan(
  plan: Plan,
  expectedTargetCount: number,
): void {
  const qualification = plan.inputs.qualification;
  if (
    plan.targets.length !== expectedTargetCount ||
    plan.counts.targetCount !== expectedTargetCount ||
    plan.counts.expectedRequestLowerBound !==
      expectedTargetCount ||
    sha256(JSON.stringify(plan.targets)) !==
      plan.independenceBoundary.targetProjectionSha256 ||
    plan.independenceBoundary
      .qualificationDeepTargetProjectionSha256 !==
        qualification.deepCaptureTargetProjectionSha256 ||
    (
      qualification.artifactKind ===
        "c6-live-multilang-neighbor-commit-count-eligibility-qualification" &&
      qualification.deepPlanTargetProjectionSha256 !==
        plan.independenceBoundary.targetProjectionSha256
    )
  ) {
    throw new Error("C6 deep-evidence plan projection mismatch");
  }
  const currentHashes = currentQueryHashes();
  const planHashes = {
    commitParents:
      plan.queryContract.supplements.commitParents.sha256,
    commits: plan.queryContract.supplements.commits.sha256,
    initial: plan.queryContract.initial.sha256,
    reviewThreadComments:
      plan.queryContract.supplements.reviewThreadComments.sha256,
    reviewThreads:
      plan.queryContract.supplements.reviewThreads.sha256,
    reviews: plan.queryContract.supplements.reviews.sha256,
  };
  if (
    JSON.stringify(currentHashes) !==
      JSON.stringify(planHashes) ||
    plan.queryContract.capturePolicySha256 !== sha256(
      serializeC6LiveMultiLangNeighborDeepCaptureQueryPolicy(),
    ) ||
    plan.queryContract.structuralReviewPolicySha256 !== sha256(
      serializeC6StructuralReviewEventPolicy(),
    )
  ) {
    throw new Error("C6 deep-evidence plan query policy mismatch");
  }
  const anchors = new Set<string>();
  const directories = new Set<string>();
  const repositories = new Set<string>();
  for (const [index, target] of plan.targets.entries()) {
    if (
      target.captureOrder !== index + 1 ||
      target.canonicalRepository !==
        `${target.owner}/${target.repo}`.toLowerCase() ||
      target.canonicalAnchorId !==
        `${target.canonicalRepository}#${target.pullNumber}` ||
      anchors.has(target.canonicalAnchorId) ||
      directories.has(target.captureDirectory)
    ) {
      throw new Error(
        `C6 deep-evidence plan target mismatch ${index + 1}`,
      );
    }
    anchors.add(target.canonicalAnchorId);
    directories.add(target.captureDirectory);
    repositories.add(target.canonicalRepository);
  }
  if (repositories.size !== plan.counts.repositoryCount) {
    throw new Error(
      "C6 deep-evidence plan repository count mismatch",
    );
  }
}

function validateCompletion(input: {
  completion: Completion;
  expectedTargetCount: number;
  plan: Plan;
  planBytes: Buffer;
  planPath: string;
}): void {
  const { completion, expectedTargetCount, plan, planBytes } =
    input;
  if (
    completion.captures.length !== expectedTargetCount ||
    completion.counts.capturedTargetCount !==
      expectedTargetCount ||
    completion.counts.plannedTargetCount !==
      expectedTargetCount ||
    completion.plan.path !==
      input.planPath.split(sep).at(-1) ||
    completion.plan.bytes !== planBytes.byteLength ||
    completion.plan.sha256 !== sha256(planBytes) ||
    completion.plan.targetProjectionSha256 !==
      plan.independenceBoundary.targetProjectionSha256 ||
    completion.plan.deepCaptureTargetProjectionSha256 !==
      plan.independenceBoundary
        .qualificationDeepTargetProjectionSha256 ||
    completion.independenceBoundary.captureProjectionSha256 !==
      sha256(JSON.stringify(completion.captures)) ||
    JSON.stringify(completion.queryHashes) !==
      JSON.stringify(currentQueryHashes())
  ) {
    throw new Error(
      "C6 deep-evidence completion projection mismatch",
    );
  }
  let logicalRequests = 0;
  let networkRequests = 0;
  const anchors = new Set<string>();
  const directories = new Set<string>();
  for (const [index, capture] of
    completion.captures.entries()) {
    if (
      capture.captureOrder !== index + 1 ||
      capture.canonicalAnchorId !==
        plan.targets[index].canonicalAnchorId ||
      capture.captureDirectory !==
        plan.targets[index].captureDirectory ||
      anchors.has(capture.canonicalAnchorId) ||
      directories.has(capture.captureDirectory)
    ) {
      throw new Error(
        `C6 deep-evidence completion order mismatch ${
          index + 1
        }`,
      );
    }
    anchors.add(capture.canonicalAnchorId);
    directories.add(capture.captureDirectory);
    logicalRequests += capture.logicalRequestCount;
    networkRequests += capture.networkRequestCount;
  }
  if (
    logicalRequests !== completion.counts.logicalRequestCount ||
    networkRequests !== completion.counts.networkRequestCount
  ) {
    throw new Error(
      "C6 deep-evidence completion counts mismatch",
    );
  }
}

function currentQueryHashes(): z.infer<typeof queryHashesSchema> {
  return {
    commitParents: sha256(
      C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_PARENTS_PAGE_QUERY,
    ),
    commits: sha256(
      C6_LIVE_MULTILANG_NEIGHBOR_COMMITS_PAGE_QUERY,
    ),
    initial: sha256(
      C6_LIVE_MULTILANG_NEIGHBOR_DEEP_INITIAL_QUERY,
    ),
    reviewThreadComments: sha256(
      C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREAD_COMMENTS_PAGE_QUERY,
    ),
    reviewThreads: sha256(
      C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREADS_PAGE_QUERY,
    ),
    reviews: sha256(
      C6_LIVE_MULTILANG_NEIGHBOR_REVIEWS_PAGE_QUERY,
    ),
  };
}

function validateInitialIdentity(
  parsed: z.infer<typeof initialResponseSchema>,
  target: PlanTarget,
): Identity {
  const repository = parsed.data.repository;
  const pull = repository.pullRequest;
  const responseAuthor = pull.author?.login.toLowerCase() ?? null;
  const expectedAuthor =
    target.authorLogin?.toLowerCase() ?? null;
  if (
    repository.nameWithOwner.toLowerCase() !==
      target.canonicalRepository ||
    pull.baseRepository.nameWithOwner.toLowerCase() !==
      target.canonicalRepository ||
    repository.id !== pull.baseRepository.id ||
    pull.number !== target.pullNumber ||
    normalizeUrl(pull.url) !== normalizeUrl(target.url) ||
    responseAuthor !== expectedAuthor ||
    pull.createdAt !== target.createdAt ||
    pull.mergedAt !== target.mergedAt ||
    pull.baseRefOid !== target.baseRefOid ||
    pull.mergeCommit.oid !== target.mergeCommitOid ||
    pull.author === null
  ) {
    throw new Error(
      `C6 deep-evidence initial identity mismatch ${
        target.canonicalAnchorId
      }`,
    );
  }
  return {
    authorLogin: pull.author.login,
    baseRefOid: pull.baseRefOid,
    baseRepositoryId: pull.baseRepository.id,
    baseRepositoryNameWithOwner:
      pull.baseRepository.nameWithOwner,
    createdAt: pull.createdAt,
    mergeCommitOid: pull.mergeCommit.oid,
    mergedAt: pull.mergedAt,
    pullRequestId: pull.id,
    pullRequestNumber: pull.number,
    pullRequestUrl: pull.url,
    repositoryId: repository.id,
    repositoryNameWithOwner: repository.nameWithOwner,
  };
}

function validateSupplementIdentity(
  repository: z.infer<typeof repositoryIdentitySchema>,
  identity: Identity,
): void {
  if (
    repository.id !== identity.repositoryId ||
    repository.nameWithOwner.toLowerCase() !==
      identity.repositoryNameWithOwner.toLowerCase() ||
    repository.pullRequest.id !== identity.pullRequestId ||
    repository.pullRequest.number !==
      identity.pullRequestNumber ||
    normalizeUrl(repository.pullRequest.url) !==
      normalizeUrl(identity.pullRequestUrl)
  ) {
    throw new Error(
      "C6 deep-evidence supplement identity mismatch",
    );
  }
}

function requiredIdentity(state: TargetReplayState): Identity {
  if (state.identity === null) {
    throw new Error(
      "C6 deep-evidence initial identity is unavailable",
    );
  }
  return state.identity;
}

function requiredConnection(
  state: TargetReplayState,
  key: string,
): ConnectionTracker {
  const connection = state.connections.find(
    (candidate) => candidate.key === key,
  );
  if (connection === undefined) {
    throw new Error(
      `C6 deep-evidence missing connection ${key}`,
    );
  }
  return connection;
}

function requiredParentNodeId(
  request: LogicalRequest,
): string {
  if (request.parentNodeId === null) {
    throw new Error(
      `C6 deep-evidence ${
        request.family
      } request lacks parent node`,
    );
  }
  return request.parentNodeId;
}

function registerUnique(
  values: Set<string>,
  value: string,
  label: string,
): void {
  if (values.has(value)) {
    throw new Error(
      `C6 deep-evidence duplicate ${label} ${value}`,
    );
  }
  values.add(value);
}

async function buildTreeSnapshot(
  root: string,
): Promise<TreeSnapshot> {
  const rootStat = await lstat(root);
  if (
    !rootStat.isDirectory() ||
    (rootStat.mode & 0o7777) !== 0o700
  ) {
    throw new Error(
      "C6 deep-evidence root must be a mode-0700 directory",
    );
  }
  const directories = [{
    mode: rootStat.mode & 0o7777,
    path: "",
  }];
  const files: SnapshotFile[] = [];
  await walkTree({
    directories,
    files,
    relativeDirectory: "",
    root,
  });
  directories.sort((left, right) =>
    left.path.localeCompare(right.path)
  );
  files.sort((left, right) =>
    left.path.localeCompare(right.path)
  );
  return {
    assetRootSha256: sha256(JSON.stringify(files)),
    directories,
    files,
  };
}

async function walkTree(input: {
  directories: Array<{
    mode: number;
    path: string;
  }>;
  files: SnapshotFile[];
  relativeDirectory: string;
  root: string;
}): Promise<void> {
  const absoluteDirectory = input.relativeDirectory.length === 0
    ? input.root
    : join(
      input.root,
      ...input.relativeDirectory.split("/"),
    );
  const entries = (await readdir(absoluteDirectory, {
    withFileTypes: true,
  })).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relativePath =
      input.relativeDirectory.length === 0
        ? entry.name
        : `${input.relativeDirectory}/${entry.name}`;
    const absolutePath = join(absoluteDirectory, entry.name);
    const stat = await lstat(absolutePath);
    if (stat.isSymbolicLink()) {
      throw new Error(
        `C6 deep-evidence rejects symlink ${relativePath}`,
      );
    }
    if (stat.isDirectory()) {
      const mode = stat.mode & 0o7777;
      if (mode !== 0o700) {
        throw new Error(
          `C6 deep-evidence directory mode mismatch ${
            relativePath
          }`,
        );
      }
      input.directories.push({ mode, path: relativePath });
      await walkTree({
        ...input,
        relativeDirectory: relativePath,
      });
      continue;
    }
    if (!stat.isFile()) {
      throw new Error(
        `C6 deep-evidence rejects non-file ${relativePath}`,
      );
    }
    const file = await readStableRegularFile(
      absolutePath,
      `C6 deep-evidence tree file ${relativePath}`,
    );
    if (file.mode !== 0o600) {
      throw new Error(
        `C6 deep-evidence file mode mismatch ${relativePath}`,
      );
    }
    input.files.push({
      bytes: file.bytes.byteLength,
      mode: file.mode,
      path: relativePath,
      sha256: sha256(file.bytes),
    });
  }
}

function validateSnapshot(
  snapshot: TreeSnapshot,
  expected: {
    assetRootSha256: string;
    directoryCount: number;
    fileCount: number;
  },
): void {
  if (
    snapshot.assetRootSha256 !== expected.assetRootSha256 ||
    snapshot.directories.length !== expected.directoryCount ||
    snapshot.files.length !== expected.fileCount
  ) {
    throw new Error(
      "C6 deep-evidence exact tree identity mismatch",
    );
  }
}

function assertExactReferenceClosure(input: {
  expectedFiles: Map<string, ArtifactReference>;
  snapshot: TreeSnapshot;
}): void {
  const snapshotFiles = new Map(
    input.snapshot.files.map((file) => [file.path, file]),
  );
  if (input.expectedFiles.size !== snapshotFiles.size) {
    throw new Error(
      "C6 deep-evidence exact file closure count mismatch",
    );
  }
  for (const [path, reference] of input.expectedFiles) {
    const file = snapshotFiles.get(path);
    if (
      file === undefined ||
      file.bytes !== reference.bytes ||
      file.sha256 !== reference.sha256
    ) {
      throw new Error(
        `C6 deep-evidence exact file closure mismatch ${path}`,
      );
    }
  }
  const expectedDirectories = new Set([""]);
  for (const path of input.expectedFiles.keys()) {
    const components = path.split("/");
    for (
      let length = 1;
      length < components.length;
      length += 1
    ) {
      expectedDirectories.add(
        components.slice(0, length).join("/"),
      );
    }
  }
  const actualDirectories = new Set(
    input.snapshot.directories.map((directory) => directory.path),
  );
  if (
    expectedDirectories.size !== actualDirectories.size ||
    [...expectedDirectories].some(
      (path) => !actualDirectories.has(path),
    )
  ) {
    throw new Error(
      "C6 deep-evidence exact directory closure mismatch",
    );
  }
}

async function readTargetReferencedFile(input: {
  captureDirectory: string;
  reference: ArtifactReference;
  root: string;
  snapshotFiles: Map<string, SnapshotFile>;
}): Promise<Buffer> {
  return readReferencedFile({
    reference: {
      ...input.reference,
      path: `${input.captureDirectory}/${input.reference.path}`,
    },
    root: input.root,
    snapshotFiles: input.snapshotFiles,
  });
}

async function readReferencedFile(input: {
  reference: ArtifactReference;
  root: string;
  snapshotFiles: Map<string, SnapshotFile>;
}): Promise<Buffer> {
  const snapshot = requiredSnapshotFile(
    input.snapshotFiles,
    input.reference.path,
  );
  if (
    snapshot.bytes !== input.reference.bytes ||
    snapshot.sha256 !== input.reference.sha256
  ) {
    throw new Error(
      `C6 deep-evidence reference mismatch ${
        input.reference.path
      }`,
    );
  }
  const bytes = (
    await readStableRegularFile(
      join(input.root, ...input.reference.path.split("/")),
      `C6 deep-evidence referenced file ${
        input.reference.path
      }`,
    )
  ).bytes;
  assertReferenceContent(input.reference, bytes);
  return bytes;
}

function registerExpectedReference(
  references: Map<string, ArtifactReference>,
  reference: ArtifactReference,
): void {
  if (
    !isSafeRelativePath(reference.path) ||
    references.has(reference.path)
  ) {
    throw new Error(
      `C6 deep-evidence duplicate or unsafe reference ${
        reference.path
      }`,
    );
  }
  references.set(reference.path, reference);
}

function requiredSnapshotFile(
  files: Map<string, SnapshotFile>,
  path: string,
): SnapshotFile {
  const file = files.get(path);
  if (file === undefined) {
    throw new Error(
      `C6 deep-evidence missing tree file ${path}`,
    );
  }
  return file;
}

function assertReferenceContent(
  reference: Pick<ArtifactReference, "bytes" | "sha256">,
  bytes: Buffer,
): void {
  if (
    bytes.byteLength !== reference.bytes ||
    sha256(bytes) !== reference.sha256
  ) {
    throw new Error(
      "C6 deep-evidence referenced content mismatch",
    );
  }
}

async function readStableRegularFile(
  path: string,
  label: string,
): Promise<{
  bytes: Buffer;
  mode: number;
}> {
  const before = await lstat(path);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error(`${label} must be a regular file`);
  }
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const opened = await handle.stat();
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      !opened.isFile() ||
      opened.dev !== after.dev ||
      opened.ino !== after.ino ||
      opened.mode !== after.mode ||
      opened.mtimeMs !== after.mtimeMs ||
      opened.size !== after.size ||
      bytes.byteLength !== after.size
    ) {
      throw new Error(`${label} changed while being read`);
    }
    return {
      bytes,
      mode: after.mode & 0o7777,
    };
  } finally {
    await handle.close();
  }
}

async function assertNoSymlinkPathComponents(
  path: string,
  label: string,
): Promise<string> {
  const resolvedPath = resolve(path);
  const root = parse(resolvedPath).root;
  let current = root;
  for (const component of relative(root, resolvedPath).split(sep)) {
    if (component.length === 0) {
      continue;
    }
    current = join(current, component);
    if ((await lstat(current)).isSymbolicLink()) {
      throw new Error(
        `${label} rejects symlink path component ${current}`,
      );
    }
  }
  return resolvedPath;
}

function parseCanonicalJson(
  bytes: Uint8Array,
  label: string,
): unknown {
  const raw = parseJson(bytes, label);
  if (
    Buffer.from(bytes).toString("utf8") !==
      `${JSON.stringify(raw, null, 2)}\n`
  ) {
    throw new Error(
      `C6 deep-evidence noncanonical ${label}`,
    );
  }
  return raw;
}

function parseJson(
  bytes: Uint8Array,
  label: string,
): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as
      unknown;
  } catch {
    throw new Error(
      `C6 deep-evidence invalid JSON ${label}`,
    );
  }
}

function validateSuccessHeaders(
  headers: Readonly<Record<string, string>>,
): void {
  for (const name of REQUIRED_SUCCESS_HEADERS) {
    if (headers[name] === undefined) {
      throw new Error(
        `C6 deep-evidence missing success header ${name}`,
      );
    }
  }
  if (
    !headers["content-type"]!.toLowerCase().startsWith(
      "application/json",
    ) ||
    headers["x-ratelimit-resource"] !== "graphql" ||
    !/^\d+$/u.test(headers["x-ratelimit-limit"]!) ||
    !/^\d+$/u.test(headers["x-ratelimit-remaining"]!) ||
    !/^\d+$/u.test(headers["x-ratelimit-reset"]!) ||
    !/^\d+$/u.test(headers["x-ratelimit-used"]!)
  ) {
    throw new Error(
      "C6 deep-evidence invalid success headers",
    );
  }
}

function validateResponseRetry(input: {
  attemptNumber: number;
  errors: unknown[];
  headers: Readonly<Record<string, string>>;
  retryAfterMilliseconds: number;
  status: number;
}): void {
  if (input.status === 200) {
    validateSuccessHeaders(input.headers);
    if (
      input.errors.length === 0 ||
      !input.errors.every(isTransientGraphqlError)
    ) {
      throw new Error(
        "C6 deep-evidence non-transient GraphQL retry",
      );
    }
    assertRetryDelay(
      input.retryAfterMilliseconds,
      graphqlRetryDelayRule(
        input.headers,
        input.attemptNumber,
      ),
    );
    return;
  }
  if (input.status === 403) {
    const retryAfter = retryAfterDelayRule(
      input.headers["retry-after"],
    );
    if (retryAfter.allowed) {
      assertRetryDelay(
        input.retryAfterMilliseconds,
        retryAfter,
      );
      return;
    }
    if (
      input.headers["x-ratelimit-remaining"] === "0" &&
      validRateLimitReset(
        input.headers["x-ratelimit-reset"],
      )
    ) {
      assertRetryDelay(input.retryAfterMilliseconds, {
        allowed: true,
        exact: null,
      });
      return;
    }
    throw new Error(
      "C6 deep-evidence non-rate-limited HTTP 403 retry",
    );
  }
  if (!RETRYABLE_HTTP_STATUS.has(input.status)) {
    throw new Error(
      `C6 deep-evidence non-retryable HTTP ${
        input.status
      }`,
    );
  }
  const retryAfter = retryAfterDelayRule(
    input.headers["retry-after"],
  );
  assertRetryDelay(
    input.retryAfterMilliseconds,
    retryAfter.allowed
      ? retryAfter
      : {
        allowed: true,
        exact: exponentialRetryDelay(input.attemptNumber),
      },
  );
}

function graphqlRetryDelayRule(
  headers: Readonly<Record<string, string>>,
  attemptNumber: number,
): RetryDelayRule {
  const retryAfter = retryAfterDelayRule(
    headers["retry-after"],
  );
  if (retryAfter.allowed) {
    return retryAfter;
  }
  if (
    headers["x-ratelimit-remaining"] === "0" &&
    validRateLimitReset(headers["x-ratelimit-reset"])
  ) {
    return {
      allowed: true,
      exact: null,
    };
  }
  return {
    allowed: true,
    exact: exponentialRetryDelay(attemptNumber),
  };
}

interface RetryDelayRule {
  allowed: boolean;
  exact: number | null;
}

function retryAfterDelayRule(
  value: string | undefined,
): RetryDelayRule {
  if (value === undefined) {
    return { allowed: false, exact: null };
  }
  if (/^\d+(?:\.\d+)?$/u.test(value)) {
    return {
      allowed: true,
      exact: Math.min(
        Math.ceil(Number(value) * 1_000),
        MAX_RETRY_AFTER_MILLISECONDS,
      ),
    };
  }
  return {
    allowed: Number.isFinite(Date.parse(value)),
    exact: null,
  };
}

function validRateLimitReset(
  value: string | undefined,
): boolean {
  if (value === undefined || !/^\d+$/u.test(value)) {
    return false;
  }
  return Number.isSafeInteger(Number(value));
}

function assertRetryDelay(
  actual: number,
  rule: RetryDelayRule,
): void {
  if (
    !rule.allowed ||
    (
      rule.exact !== null &&
      actual !== rule.exact
    )
  ) {
    throw new Error(
      "C6 deep-evidence retry delay mismatch",
    );
  }
}

function exponentialRetryDelay(
  attemptNumber: number,
): number {
  return Math.min(
    1_000 * 2 ** (attemptNumber - 1),
    MAX_RETRY_AFTER_MILLISECONDS,
  );
}

function isTransientGraphqlError(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const directType =
    "type" in value && typeof value.type === "string"
      ? value.type
      : null;
  const extensionType =
    "extensions" in value &&
      typeof value.extensions === "object" &&
      value.extensions !== null &&
      "code" in value.extensions &&
      typeof value.extensions.code === "string"
      ? value.extensions.code
      : null;
  const type = directType ?? extensionType;
  return (
    type !== null &&
    TRANSIENT_GRAPHQL_ERROR_TYPES.has(type.toUpperCase())
  );
}

function graphqlErrors(raw: unknown): unknown[] {
  if (
    typeof raw === "object" &&
    raw !== null &&
    "errors" in raw &&
    Array.isArray(raw.errors)
  ) {
    return raw.errors;
  }
  return [];
}

function repositoryPageResponseSchema<
  Key extends "commits" | "reviews" | "reviewThreads",
  Schema extends z.ZodType,
>(key: Key, schema: Schema) {
  const connection = {
    [key]: schema,
  } as { [ConnectionKey in Key]: Schema };
  return z.object({
    data: z.object({
      rateLimit: rateLimitSchema,
      repository: z.object({
        id: z.string().min(1),
        nameWithOwner: repositorySchema,
        pullRequest:
          pullIdentitySchema.extend(connection).strict(),
      }).strict(),
    }).strict(),
  }).strict();
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

function sortRecord(
  value: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right)
    ),
  );
}

function serializeTreeSnapshot(snapshot: TreeSnapshot): string {
  return JSON.stringify(snapshot);
}

function isSafeRelativePath(path: string): boolean {
  const components = path.split("/");
  return (
    components.length > 0 &&
    components.every((component) =>
      component.length > 0 &&
      component !== "." &&
      component !== ".." &&
      !component.includes("\\")
    )
  );
}

function normalizeUrl(value: string): string {
  const parsed = new URL(value);
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.pathname = parsed.pathname
    .toLowerCase()
    .replace(/\/+$/u, "");
  return parsed.toString();
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
