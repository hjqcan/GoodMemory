import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  buildC6AssetLock,
  readC6StableRegularFile,
  serializeC6AssetLock,
} from "./c6-asset-lock";
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
const MAX_RETRIES = 3;
const MAX_RETRY_AFTER_MILLISECONDS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MILLISECONDS = 60_000;
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const TRANSIENT_GRAPHQL_ERROR_TYPES = new Set([
  "INTERNAL",
  "INTERNAL_SERVER_ERROR",
  "RATE_LIMITED",
  "SERVICE_UNAVAILABLE",
  "TIMEOUT",
]);
const REQUEST_HEADERS = {
  accept: "application/vnd.github+json",
  "content-type": "application/json",
  "user-agent": "GoodMemory-C6-Neighbor-Deep-Capture/1",
  "x-github-api-version": "2022-11-28",
} as const;
const SELECTED_RESPONSE_HEADERS = [
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
] as const;
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

export interface C6LiveMultiLangNeighborDeepQueryHashes {
  commitParents: string;
  commits: string;
  initial: string;
  reviewThreadComments: string;
  reviewThreads: string;
  reviews: string;
}

export type C6LiveMultiLangNeighborDeepFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type RequestFamily = keyof C6LiveMultiLangNeighborDeepQueryHashes;

interface ArtifactReference {
  bytes: number;
  path: string;
  sha256: string;
}

interface ConnectionCursorStep {
  afterCursor: string | null;
  collectedNodeCount: number;
  endCursor: string | null;
  hasNextPage: boolean;
  nodeCount: number;
  page: number;
  totalCount: number;
}

interface ConnectionTracker {
  collectedNodeCount: number;
  complete: boolean;
  cursorChain: ConnectionCursorStep[];
  key: string;
  nextCursor: string | null;
  pageCount: number;
  parentNodeId: string | null;
  path: string;
  seenCursors: Set<string>;
  seenNodeIds: Set<string>;
  totalCount: number | null;
}

interface AttemptRecord {
  attempt: number;
  request: ArtifactReference;
  response?: ArtifactReference & {
    httpStatus: number;
  };
  responseHeaders?: ArtifactReference;
  retryAfterMilliseconds?: number;
  transportError?: ArtifactReference & {
    phase: TransportFailurePhase;
  };
}

interface LogicalRequestRecord {
  afterCursor: string | null;
  attempts: AttemptRecord[];
  connections: Array<ConnectionCursorStep & {
    connectionKey: string;
  }>;
  family: RequestFamily;
  page: number;
  parentNodeId: string | null;
  requestOrder: number;
}

interface RequestContext {
  family: RequestFamily;
  page: number;
  parentNodeId: string | null;
}

interface TargetCaptureState {
  commits: Set<string>;
  commitOids: Set<string>;
  connections: ConnectionTracker[];
  currentContext: RequestContext;
  identity: ResolvedIdentity | null;
  networkRequestCount: number;
  requestRecords: LogicalRequestRecord[];
  reviewCommentIds: Set<string>;
  reviewIds: Set<string>;
  reviewThreadIds: Set<string>;
  target: PlanTarget;
  targetIndex: number;
  targetRoot: string;
  totalTargets: number;
}

interface ResolvedIdentity {
  authorLogin: string;
  baseRefOid: string;
  baseRepositoryId: string;
  baseRepositoryNameWithOwner: string;
  createdAt: string;
  mergeCommitOid: string;
  mergedAt: string;
  pullRequestId: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  repositoryId: string;
  repositoryNameWithOwner: string;
}

interface ExecutedRequest {
  raw: unknown;
  record: LogicalRequestRecord;
}

type TransportFailurePhase =
  | "body-read"
  | "fetch"
  | "timeout";

type TransportResult =
  | {
    response: Response;
    responseBytes: Buffer;
    success: true;
  }
  | {
    error: unknown;
    phase: TransportFailurePhase;
    response: Response | null;
    success: false;
  };

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const repositorySchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
);
const anchorSchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9]\d*$/u,
);
const sourceSplitSchema = z.enum(SOURCE_SPLITS);
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
  baseRefOid: commitSchema,
  canonicalAnchorId: anchorSchema,
  canonicalRepository: repositorySchema,
  captureDirectory: z.string().regex(
    /^[A-Za-z0-9_.-]+__[A-Za-z0-9_.-]+__[1-9]\d*$/u,
  ),
  captureOrder: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  mergeCommitOid: commitSchema,
  mergedAt: z.iso.datetime(),
  observedReviewCount: z.number().int().nonnegative(),
  observedReviewThreadCount: z.number().int().nonnegative(),
  owner: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
  pilotRank: z.number().int().positive(),
  pullNumber: z.number().int().positive(),
  repo: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
  responseNodeRank: z.number().int().positive(),
  sourceSplit: sourceSplitSchema,
  url: z.url(),
}).strict();
const queryDescriptorSchema = z.object({
  operationName: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const planSchema = z.object({
  artifactKind: z.literal(
    "c6-live-multilang-neighbor-deep-capture-plan",
  ),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    actorCaptureExecuted: z.literal(false),
    actorQualifiedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    captureCompletenessProven: z.literal(false),
    codexRunReady: z.literal(false),
    deepCaptureExecuted: z.literal(false),
    machineQualifiedEpisodeCount: z.literal(0),
    semanticallyQualifiedEpisodeCount: z.literal(0),
  }).passthrough(),
  counts: z.object({
    expectedRequestLowerBound: z.number().int().positive(),
    targetCount: z.number().int().positive(),
  }).passthrough(),
  independenceBoundary: z.object({
    qualificationDeepTargetProjectionSha256: sha256Schema,
    targetProjectionSha256: sha256Schema,
  }).passthrough(),
  inputs: z.object({
    qualification: z.object({
      deepCaptureTargetProjectionSha256: sha256Schema,
    }).passthrough(),
  }).passthrough(),
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
  schemaVersion: z.literal(1),
  targets: z.array(planTargetSchema).min(1),
}).passthrough();

type PlanTarget = z.infer<typeof planTargetSchema>;
type Plan = z.infer<typeof planSchema>;

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
  oid: commitSchema,
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
    oid: commitSchema,
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
    oid: commitSchema,
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
    oid: commitSchema,
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
        baseRefOid: commitSchema,
        baseRepository: z.object({
          id: z.string().min(1),
          nameWithOwner: repositorySchema,
        }).strict(),
        commits: commitConnectionSchema,
        createdAt: z.iso.datetime(),
        mergeCommit: z.object({
          oid: commitSchema,
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
      oid: commitSchema,
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

export interface C6LiveMultiLangNeighborDeepCaptureResult {
  assetRootSha256: string;
  captureCompletenessProven: true;
  capturedTargetCount: number;
  completionSha256: string;
  logicalRequestCount: number;
  networkRequestCount: number;
  outputRoot: string;
}

export async function captureC6LiveMultiLangNeighborDeep(input: {
  authorizationToken: string;
  expectedDeepCaptureTargetProjectionSha256: string;
  expectedPlanSha256: string;
  expectedQueryHashes: C6LiveMultiLangNeighborDeepQueryHashes;
  expectedTargetCount: number;
  fetchImpl?: C6LiveMultiLangNeighborDeepFetch;
  outputRoot: string;
  planPath: string;
  progress?: (message: string) => void;
  requestTimeoutMilliseconds?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  testHooks?: {
    beforePrepublicationVerification?: (
      temporaryRoot: string,
    ) => Promise<void> | void;
    beforePublishedVerification?: (
      publishedRoot: string,
    ) => Promise<void> | void;
    beforeTerminalVerification?: () => Promise<void> | void;
  };
}): Promise<C6LiveMultiLangNeighborDeepCaptureResult> {
  const token = requiredUnpadded(
    input.authorizationToken,
    "authorization token",
  );
  const expectedPlanSha256 = sha256Schema.parse(
    input.expectedPlanSha256,
  );
  const expectedDeepTargetProjection = sha256Schema.parse(
    input.expectedDeepCaptureTargetProjectionSha256,
  );
  const expectedTargetCount = z.number().int().positive().parse(
    input.expectedTargetCount,
  );
  const expectedQueryHashes = queryHashesSchema.parse(
    input.expectedQueryHashes,
  );
  const requestTimeoutMilliseconds = z.number().int().positive().max(
    DEFAULT_REQUEST_TIMEOUT_MILLISECONDS,
  ).parse(
    input.requestTimeoutMilliseconds ??
      DEFAULT_REQUEST_TIMEOUT_MILLISECONDS,
  );
  const planPath = await assertC6NoSymlinkPathComponents(
    input.planPath,
    "C6 neighbor deep-capture plan",
  );
  const planBytes = await readC6StableRegularFile(
    planPath,
    "neighbor deep-capture plan",
  );
  if (sha256(planBytes) !== expectedPlanSha256) {
    throw new Error("C6 neighbor deep-capture plan hash mismatch");
  }
  const rawPlan = canonicalJson(planBytes, "plan");
  const plan = planSchema.parse(rawPlan);
  validatePlan({
    expectedDeepTargetProjection,
    expectedQueryHashes,
    expectedTargetCount,
    plan,
    rawPlan,
  });

  const outputRoot = resolve(
    requiredUnpadded(input.outputRoot, "output root"),
  );
  await assertC6NoSymlinkPathComponents(
    dirname(outputRoot),
    "C6 neighbor deep-capture output parent",
  );
  await assertOutputRootMissing(outputRoot);
  const temporaryRoot = `${outputRoot}.incomplete-${randomUUID()}`;
  await mkdir(temporaryRoot, { mode: 0o700 });
  await assertC6NoSymlinkPathComponents(
    temporaryRoot,
    "C6 neighbor deep-capture temporary root",
  );
  const fetchImpl = input.fetchImpl ??
    ((request, init) => fetch(request, init));
  const progress = input.progress ??
    ((message: string) => process.stderr.write(`${message}\n`));
  const sleep = input.sleep ?? sleepMilliseconds;
  let outputRootCreated = false;
  try {
    const captures = [];
    const referencedFiles: ArtifactReference[] = [];
    let logicalRequestCount = 0;
    let networkRequestCount = 0;
    for (const [index, target] of plan.targets.entries()) {
      const capture = await captureTarget({
        fetchImpl,
        progress,
        requestTimeoutMilliseconds,
        sleep,
        target,
        targetIndex: index + 1,
        temporaryRoot,
        token,
        totalTargets: plan.targets.length,
      });
      captures.push(capture.completionEntry);
      referencedFiles.push(...capture.referencedFiles);
      logicalRequestCount += capture.logicalRequestCount;
      networkRequestCount += capture.networkRequestCount;
    }

    await input.testHooks?.beforeTerminalVerification?.();
    const terminalPlanBytes = await readC6StableRegularFile(
      planPath,
      "neighbor deep-capture terminal plan",
    );
    if (
      !terminalPlanBytes.equals(planBytes) ||
      sha256(terminalPlanBytes) !== expectedPlanSha256
    ) {
      throw new Error(
        "C6 neighbor deep-capture plan changed during capture",
      );
    }

    const completion = {
      artifactKind:
        "c6-live-multilang-neighbor-deep-capture-completion",
      boundary: completedBoundary(),
      captures,
      counts: {
        capturedTargetCount: captures.length,
        logicalRequestCount,
        networkRequestCount,
        plannedTargetCount: plan.targets.length,
      },
      independenceBoundary: {
        captureProjectionSha256: sha256(JSON.stringify(captures)),
        targetOrderPreserved: true,
      },
      plan: {
        ...artifactReference(basename(planPath), planBytes),
        deepCaptureTargetProjectionSha256:
          expectedDeepTargetProjection,
        targetProjectionSha256:
          plan.independenceBoundary.targetProjectionSha256,
      },
      queryHashes: expectedQueryHashes,
      schemaVersion: 1,
    };
    const completionBytes = canonicalBytes(completion);
    assertTokenAbsent(completionBytes, token, "completion");
    await writeFile(
      join(temporaryRoot, "completion.json"),
      completionBytes,
      { flag: "wx", mode: 0o600 },
    );
    referencedFiles.push(
      artifactReference("completion.json", completionBytes),
    );
    await input.testHooks?.beforePrepublicationVerification?.(
      temporaryRoot,
    );
    await assertExactCaptureTree(temporaryRoot, referencedFiles);
    const prepublicationLock = await buildC6AssetLock(temporaryRoot);

    await assertC6NoSymlinkPathComponents(
      dirname(outputRoot),
      "C6 neighbor deep-capture output parent",
    );
    await assertOutputRootMissing(outputRoot);
    try {
      await mkdir(outputRoot, { mode: 0o700 });
      outputRootCreated = true;
    } catch (error) {
      if (isErrorCode(error, "EEXIST")) {
        throw new Error(
          "C6 neighbor deep-capture output root already exists",
        );
      }
      throw error;
    }
    const entries = (await readdir(temporaryRoot)).sort(
      completionLast,
    );
    for (const entry of entries) {
      await publishNoReplace(
        join(temporaryRoot, entry),
        join(outputRoot, entry),
      );
    }
    const publishedLock = await buildC6AssetLock(outputRoot);
    if (
      serializeC6AssetLock(publishedLock) !==
        serializeC6AssetLock(prepublicationLock)
    ) {
      throw new Error(
        "C6 neighbor deep-capture published asset closure mismatch",
      );
    }
    await input.testHooks?.beforePublishedVerification?.(
      outputRoot,
    );
    await assertExactCaptureTree(outputRoot, referencedFiles);
    const terminalLock = await buildC6AssetLock(outputRoot);
    if (
      serializeC6AssetLock(terminalLock) !==
        serializeC6AssetLock(prepublicationLock) ||
      serializeC6AssetLock(terminalLock) !==
        serializeC6AssetLock(publishedLock)
    ) {
      throw new Error(
        "C6 neighbor deep-capture published asset closure mismatch",
      );
    }
    await rm(temporaryRoot, { recursive: true });
    return {
      assetRootSha256: terminalLock.assetRootSha256,
      captureCompletenessProven: true,
      capturedTargetCount: captures.length,
      completionSha256: sha256(completionBytes),
      logicalRequestCount,
      networkRequestCount,
      outputRoot,
    };
  } catch (error) {
    await rm(temporaryRoot, { force: true, recursive: true });
    if (outputRootCreated) {
      await rm(outputRoot, { force: true, recursive: true });
    }
    throw error;
  }
}

async function captureTarget(input: {
  fetchImpl: C6LiveMultiLangNeighborDeepFetch;
  progress: (message: string) => void;
  requestTimeoutMilliseconds: number;
  sleep: (milliseconds: number) => Promise<void>;
  target: PlanTarget;
  targetIndex: number;
  temporaryRoot: string;
  token: string;
  totalTargets: number;
}): Promise<{
  completionEntry: {
    canonicalAnchorId: string;
    captureDirectory: string;
    captureManifest: ArtifactReference;
    captureOrder: number;
    connectionClosureProjectionSha256: string;
    logicalRequestCount: number;
    networkRequestCount: number;
  };
  logicalRequestCount: number;
  networkRequestCount: number;
  referencedFiles: ArtifactReference[];
}> {
  const targetRoot = join(
    input.temporaryRoot,
    input.target.captureDirectory,
  );
  await mkdir(targetRoot, { mode: 0o700 });
  const state: TargetCaptureState = {
    commits: new Set(),
    commitOids: new Set(),
    connections: [],
    currentContext: {
      family: "initial",
      page: 1,
      parentNodeId: null,
    },
    identity: null,
    networkRequestCount: 0,
    requestRecords: [],
    reviewCommentIds: new Set(),
    reviewIds: new Set(),
    reviewThreadIds: new Set(),
    target: input.target,
    targetIndex: input.targetIndex,
    targetRoot,
    totalTargets: input.totalTargets,
  };
  try {
    const initial = await executeGraphqlRequest({
      context: state.currentContext,
      fetchImpl: input.fetchImpl,
      operationName: "C6NeighborDeepInitial",
      progress: input.progress,
      query: C6_LIVE_MULTILANG_NEIGHBOR_DEEP_INITIAL_QUERY,
      requestTimeoutMilliseconds:
        input.requestTimeoutMilliseconds,
      sleep: input.sleep,
      state,
      token: input.token,
      variables: {
        name: input.target.repo,
        number: input.target.pullNumber,
        owner: input.target.owner,
      },
    });
    const parsedInitial = initialResponseSchema.parse(initial.raw);
    state.identity = validateInitialIdentity(
      parsedInitial,
      input.target,
    );
    const pull = parsedInitial.data.repository.pullRequest;
    if (
      pull.reviews.totalCount !== input.target.observedReviewCount ||
      pull.reviewThreads.totalCount !==
        input.target.observedReviewThreadCount
    ) {
      throw new Error("observed review-surface count mismatch");
    }

    const commitsTracker = createTracker(
      "commits",
      "pullRequest.commits",
      null,
    );
    state.connections.push(commitsTracker);
    addConnectionStep(
      initial.record,
      acceptConnectionPage(
        commitsTracker,
        pull.commits,
        null,
        (node) => node.commit.id,
      ),
    );
    await registerCommitNodes({
      nodes: pull.commits.nodes,
      requestRecord: initial.record,
      runtime: input,
      state,
    });
    await closeCommitPages({
      runtime: input,
      state,
      tracker: commitsTracker,
    });

    const reviewsTracker = createTracker(
      "reviews",
      "pullRequest.reviews",
      null,
    );
    state.connections.push(reviewsTracker);
    addConnectionStep(
      initial.record,
      acceptConnectionPage(
        reviewsTracker,
        pull.reviews,
        null,
        (node) => node.id,
      ),
    );
    registerReviews(state, pull.reviews.nodes);
    await closeReviewPages({
      runtime: input,
      state,
      tracker: reviewsTracker,
    });

    const threadsTracker = createTracker(
      "reviewThreads",
      "pullRequest.reviewThreads",
      null,
    );
    state.connections.push(threadsTracker);
    addConnectionStep(
      initial.record,
      acceptConnectionPage(
        threadsTracker,
        pull.reviewThreads,
        null,
        (node) => node.id,
      ),
    );
    await registerReviewThreads({
      nodes: pull.reviewThreads.nodes,
      requestRecord: initial.record,
      runtime: input,
      state,
    });
    await closeReviewThreadPages({
      runtime: input,
      state,
      tracker: threadsTracker,
    });

    if (
      state.identity === null ||
      state.connections.some((connection) => !connection.complete)
    ) {
      throw new Error("connection closure is incomplete");
    }
    const connections = state.connections.map(publicConnection);
    const counts = {
      commitCount: commitsTracker.collectedNodeCount,
      logicalRequestCount: state.requestRecords.length,
      networkRequestCount: state.networkRequestCount,
      parentEdgeCount: connections
        .filter((connection) =>
          connection.path.endsWith(".parents")
        )
        .reduce(
          (sum, connection) =>
            sum + connection.collectedNodeCount,
          0,
        ),
      reviewCount: reviewsTracker.collectedNodeCount,
      reviewThreadCommentCount: connections
        .filter((connection) =>
          connection.path.endsWith(".comments")
        )
        .reduce(
          (sum, connection) =>
            sum + connection.collectedNodeCount,
          0,
        ),
      reviewThreadCount: threadsTracker.collectedNodeCount,
    };
    const connectionClosureProjectionSha256 = sha256(
      JSON.stringify(connections),
    );
    const capture = {
      artifactKind:
        "c6-live-multilang-neighbor-deep-capture-target",
      boundary: completedBoundary(),
      connections,
      counts,
      identity: state.identity,
      independenceBoundary: {
        connectionClosureProjectionSha256,
        rawReviewBodiesUsedForTargetSelection: false,
      },
      planTarget: input.target,
      requests: state.requestRecords,
      schemaVersion: 1,
    };
    const captureBytes = canonicalBytes(capture);
    assertTokenAbsent(captureBytes, input.token, "target manifest");
    await writeFile(
      join(targetRoot, "capture.json"),
      captureBytes,
      { flag: "wx", mode: 0o600 },
    );
    return {
      completionEntry: {
        canonicalAnchorId: input.target.canonicalAnchorId,
        captureDirectory: input.target.captureDirectory,
        captureManifest: artifactReference(
          `${input.target.captureDirectory}/capture.json`,
          captureBytes,
        ),
        captureOrder: input.target.captureOrder,
        connectionClosureProjectionSha256,
        logicalRequestCount: state.requestRecords.length,
        networkRequestCount: state.networkRequestCount,
      },
      logicalRequestCount: state.requestRecords.length,
      networkRequestCount: state.networkRequestCount,
      referencedFiles: targetReferencedFiles(
        input.target.captureDirectory,
        captureBytes,
        state.requestRecords,
      ),
    };
  } catch (error) {
    const context = state.currentContext;
    throw new Error(
      `C6 neighbor deep-capture target=${
        state.targetIndex
      }/${state.totalTargets} anchor=${
        state.target.canonicalAnchorId
      } family=${context.family} page=${context.page}: ${
        sanitizedError(error, input.token)
      }`,
    );
  }
}

async function registerCommitNodes(input: {
  nodes: z.infer<typeof commitNodeSchema>[];
  requestRecord: LogicalRequestRecord;
  runtime: RuntimeDependencies;
  state: TargetCaptureState;
}): Promise<void> {
  for (const node of input.nodes) {
    registerUnique(
      input.state.commits,
      node.commit.id,
      "commit node ID",
    );
    registerUnique(
      input.state.commitOids,
      node.commit.oid,
      "commit OID",
    );
    const tracker = createTracker(
      `commitParents:${node.commit.id}`,
      `pullRequest.commits.nodes[${node.commit.id}].parents`,
      node.commit.id,
    );
    input.state.connections.push(tracker);
    addConnectionStep(
      input.requestRecord,
      acceptConnectionPage(
        tracker,
        node.commit.parents,
        null,
        (parent) => parent.oid,
      ),
    );
    await closeCommitParentPages({
      commitId: node.commit.id,
      commitOid: node.commit.oid,
      runtime: input.runtime,
      state: input.state,
      tracker,
    });
  }
}

async function closeCommitPages(input: {
  runtime: RuntimeDependencies;
  state: TargetCaptureState;
  tracker: ConnectionTracker;
}): Promise<void> {
  while (!input.tracker.complete) {
    const after = requiredNextCursor(input.tracker);
    const page = input.tracker.pageCount + 1;
    input.state.currentContext = {
      family: "commits",
      page,
      parentNodeId: null,
    };
    const executed = await executeGraphqlRequest({
      context: input.state.currentContext,
      fetchImpl: input.runtime.fetchImpl,
      operationName: "C6NeighborDeepCommitsPage",
      progress: input.runtime.progress,
      query: C6_LIVE_MULTILANG_NEIGHBOR_COMMITS_PAGE_QUERY,
      requestTimeoutMilliseconds:
        input.runtime.requestTimeoutMilliseconds,
      sleep: input.runtime.sleep,
      state: input.state,
      token: input.runtime.token,
      variables: targetVariables(input.state.target, { after }),
    });
    const parsed = commitsResponseSchema.parse(executed.raw);
    validateSupplementIdentity(
      parsed.data.repository,
      requiredIdentity(input.state),
    );
    addConnectionStep(
      executed.record,
      acceptConnectionPage(
        input.tracker,
        parsed.data.repository.pullRequest.commits,
        after,
        (node) => node.commit.id,
      ),
    );
    await registerCommitNodes({
      nodes: parsed.data.repository.pullRequest.commits.nodes,
      requestRecord: executed.record,
      runtime: input.runtime,
      state: input.state,
    });
  }
}

async function closeReviewPages(input: {
  runtime: RuntimeDependencies;
  state: TargetCaptureState;
  tracker: ConnectionTracker;
}): Promise<void> {
  while (!input.tracker.complete) {
    const after = requiredNextCursor(input.tracker);
    const page = input.tracker.pageCount + 1;
    input.state.currentContext = {
      family: "reviews",
      page,
      parentNodeId: null,
    };
    const executed = await executeGraphqlRequest({
      context: input.state.currentContext,
      fetchImpl: input.runtime.fetchImpl,
      operationName: "C6NeighborDeepReviewsPage",
      progress: input.runtime.progress,
      query: C6_LIVE_MULTILANG_NEIGHBOR_REVIEWS_PAGE_QUERY,
      requestTimeoutMilliseconds:
        input.runtime.requestTimeoutMilliseconds,
      sleep: input.runtime.sleep,
      state: input.state,
      token: input.runtime.token,
      variables: targetVariables(input.state.target, { after }),
    });
    const parsed = reviewsResponseSchema.parse(executed.raw);
    validateSupplementIdentity(
      parsed.data.repository,
      requiredIdentity(input.state),
    );
    const connection =
      parsed.data.repository.pullRequest.reviews;
    addConnectionStep(
      executed.record,
      acceptConnectionPage(
        input.tracker,
        connection,
        after,
        (node) => node.id,
      ),
    );
    registerReviews(input.state, connection.nodes);
  }
}

async function registerReviewThreads(input: {
  nodes: z.infer<typeof reviewThreadSchema>[];
  requestRecord: LogicalRequestRecord;
  runtime: RuntimeDependencies;
  state: TargetCaptureState;
}): Promise<void> {
  for (const thread of input.nodes) {
    registerUnique(
      input.state.reviewThreadIds,
      thread.id,
      "review-thread ID",
    );
    const tracker = createTracker(
      `reviewThreadComments:${thread.id}`,
      `pullRequest.reviewThreads.nodes[${thread.id}].comments`,
      thread.id,
    );
    input.state.connections.push(tracker);
    addConnectionStep(
      input.requestRecord,
      acceptConnectionPage(
        tracker,
        thread.comments,
        null,
        (commentValue) => commentValue.id,
      ),
    );
    registerReviewComments(input.state, thread.comments.nodes);
    await closeReviewThreadCommentPages({
      runtime: input.runtime,
      state: input.state,
      threadId: thread.id,
      tracker,
    });
  }
}

async function closeReviewThreadPages(input: {
  runtime: RuntimeDependencies;
  state: TargetCaptureState;
  tracker: ConnectionTracker;
}): Promise<void> {
  while (!input.tracker.complete) {
    const after = requiredNextCursor(input.tracker);
    const page = input.tracker.pageCount + 1;
    input.state.currentContext = {
      family: "reviewThreads",
      page,
      parentNodeId: null,
    };
    const executed = await executeGraphqlRequest({
      context: input.state.currentContext,
      fetchImpl: input.runtime.fetchImpl,
      operationName: "C6NeighborDeepReviewThreadsPage",
      progress: input.runtime.progress,
      query: C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREADS_PAGE_QUERY,
      requestTimeoutMilliseconds:
        input.runtime.requestTimeoutMilliseconds,
      sleep: input.runtime.sleep,
      state: input.state,
      token: input.runtime.token,
      variables: targetVariables(input.state.target, { after }),
    });
    const parsed = reviewThreadsResponseSchema.parse(executed.raw);
    validateSupplementIdentity(
      parsed.data.repository,
      requiredIdentity(input.state),
    );
    const connection =
      parsed.data.repository.pullRequest.reviewThreads;
    addConnectionStep(
      executed.record,
      acceptConnectionPage(
        input.tracker,
        connection,
        after,
        (node) => node.id,
      ),
    );
    await registerReviewThreads({
      nodes: connection.nodes,
      requestRecord: executed.record,
      runtime: input.runtime,
      state: input.state,
    });
  }
}

async function closeCommitParentPages(input: {
  commitId: string;
  commitOid: string;
  runtime: RuntimeDependencies;
  state: TargetCaptureState;
  tracker: ConnectionTracker;
}): Promise<void> {
  while (!input.tracker.complete) {
    const after = requiredNextCursor(input.tracker);
    const page = input.tracker.pageCount + 1;
    input.state.currentContext = {
      family: "commitParents",
      page,
      parentNodeId: input.commitId,
    };
    const executed = await executeGraphqlRequest({
      context: input.state.currentContext,
      fetchImpl: input.runtime.fetchImpl,
      operationName: "C6NeighborDeepCommitParentsPage",
      progress: input.runtime.progress,
      query: C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_PARENTS_PAGE_QUERY,
      requestTimeoutMilliseconds:
        input.runtime.requestTimeoutMilliseconds,
      sleep: input.runtime.sleep,
      state: input.state,
      token: input.runtime.token,
      variables: targetVariables(input.state.target, {
        after,
        commitId: input.commitId,
      }),
    });
    const parsed = commitParentsResponseSchema.parse(executed.raw);
    validateSupplementIdentity(
      parsed.data.repository,
      requiredIdentity(input.state),
    );
    if (
      parsed.data.node.id !== input.commitId ||
      parsed.data.node.oid !== input.commitOid
    ) {
      throw new Error("commit-parent node identity mismatch");
    }
    addConnectionStep(
      executed.record,
      acceptConnectionPage(
        input.tracker,
        parsed.data.node.parents,
        after,
        (parent) => parent.oid,
      ),
    );
  }
}

async function closeReviewThreadCommentPages(input: {
  runtime: RuntimeDependencies;
  state: TargetCaptureState;
  threadId: string;
  tracker: ConnectionTracker;
}): Promise<void> {
  while (!input.tracker.complete) {
    const after = requiredNextCursor(input.tracker);
    const page = input.tracker.pageCount + 1;
    input.state.currentContext = {
      family: "reviewThreadComments",
      page,
      parentNodeId: input.threadId,
    };
    const executed = await executeGraphqlRequest({
      context: input.state.currentContext,
      fetchImpl: input.runtime.fetchImpl,
      operationName: "C6NeighborDeepReviewThreadCommentsPage",
      progress: input.runtime.progress,
      query:
        C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREAD_COMMENTS_PAGE_QUERY,
      requestTimeoutMilliseconds:
        input.runtime.requestTimeoutMilliseconds,
      sleep: input.runtime.sleep,
      state: input.state,
      token: input.runtime.token,
      variables: targetVariables(input.state.target, {
        after,
        threadId: input.threadId,
      }),
    });
    const parsed =
      reviewThreadCommentsResponseSchema.parse(executed.raw);
    validateSupplementIdentity(
      parsed.data.repository,
      requiredIdentity(input.state),
    );
    if (parsed.data.node.id !== input.threadId) {
      throw new Error("review-thread node identity mismatch");
    }
    addConnectionStep(
      executed.record,
      acceptConnectionPage(
        input.tracker,
        parsed.data.node.comments,
        after,
        (commentValue) => commentValue.id,
      ),
    );
    registerReviewComments(
      input.state,
      parsed.data.node.comments.nodes,
    );
  }
}

interface RuntimeDependencies {
  fetchImpl: C6LiveMultiLangNeighborDeepFetch;
  progress: (message: string) => void;
  requestTimeoutMilliseconds: number;
  sleep: (milliseconds: number) => Promise<void>;
  token: string;
}

async function executeGraphqlRequest(input: {
  context: RequestContext;
  fetchImpl: C6LiveMultiLangNeighborDeepFetch;
  operationName: string;
  progress: (message: string) => void;
  query: string;
  requestTimeoutMilliseconds: number;
  sleep: (milliseconds: number) => Promise<void>;
  state: TargetCaptureState;
  token: string;
  variables: Record<string, unknown>;
}): Promise<ExecutedRequest> {
  input.state.currentContext = input.context;
  const requestOrder = input.state.requestRecords.length + 1;
  const requestDirectory = join(
    input.state.targetRoot,
    "requests",
    `${
      String(requestOrder).padStart(4, "0")
    }__${input.context.family}__page-${
      String(input.context.page).padStart(3, "0")
    }`,
  );
  await mkdir(requestDirectory, {
    mode: 0o700,
    recursive: true,
  });
  const record: LogicalRequestRecord = {
    afterCursor:
      typeof input.variables.after === "string"
        ? input.variables.after
        : null,
    attempts: [],
    connections: [],
    family: input.context.family,
    page: input.context.page,
    parentNodeId: input.context.parentNodeId,
    requestOrder,
  };
  input.state.requestRecords.push(record);

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt += 1) {
    input.state.networkRequestCount += 1;
    const receipt = {
      attempt,
      endpoint: ENDPOINT,
      headers: {
        ...REQUEST_HEADERS,
        authorization: "Bearer [REDACTED]",
      },
      method: "POST",
      operationName: input.operationName,
      query: input.query,
      querySha256: sha256(input.query),
      variables: input.variables,
    };
    const requestBytes = canonicalBytes(receipt);
    assertTokenAbsent(
      requestBytes,
      input.token,
      "request receipt",
    );
    const attemptDirectory = join(
      requestDirectory,
      `attempt-${String(attempt).padStart(2, "0")}`,
    );
    await mkdir(attemptDirectory, { mode: 0o700 });
    await writeFile(
      join(attemptDirectory, "request.json"),
      requestBytes,
      { flag: "wx", mode: 0o600 },
    );
    const relativeAttemptPath =
      `requests/${
        basename(requestDirectory)
      }/${basename(attemptDirectory)}`;
    const attemptRecord: AttemptRecord = {
      attempt,
      request: artifactReference(
        `${relativeAttemptPath}/request.json`,
        requestBytes,
      ),
    };
    record.attempts.push(attemptRecord);

    const transport = await executeTransportAttempt({
      fetchImpl: input.fetchImpl,
      query: input.query,
      requestTimeoutMilliseconds:
        input.requestTimeoutMilliseconds,
      token: input.token,
      variables: input.variables,
    });
    if (!transport.success) {
      const responseHeaders = transport.response === null
        ? {}
        : selectResponseHeaders(transport.response.headers);
      const responseHeaderBytes = canonicalBytes(responseHeaders);
      const transportErrorBytes = canonicalBytes({
        artifactKind:
          "c6-live-multilang-neighbor-deep-transport-error",
        httpStatus: transport.response?.status ?? null,
        message: sanitizedError(transport.error, input.token),
        phase: transport.phase,
        retryScheduled: attempt <= MAX_RETRIES,
        schemaVersion: 1,
      });
      assertTokenAbsent(
        responseHeaderBytes,
        input.token,
        "transport response headers",
      );
      assertTokenAbsent(
        transportErrorBytes,
        input.token,
        "transport error",
      );
      await Promise.all([
        writeFile(
          join(attemptDirectory, "response-headers.json"),
          responseHeaderBytes,
          { flag: "wx", mode: 0o600 },
        ),
        writeFile(
          join(attemptDirectory, "transport-error.json"),
          transportErrorBytes,
          { flag: "wx", mode: 0o600 },
        ),
      ]);
      attemptRecord.responseHeaders = artifactReference(
        `${relativeAttemptPath}/response-headers.json`,
        responseHeaderBytes,
      );
      attemptRecord.transportError = {
        ...artifactReference(
          `${relativeAttemptPath}/transport-error.json`,
          transportErrorBytes,
        ),
        phase: transport.phase,
      };
      if (attempt <= MAX_RETRIES) {
        const retryAfterMilliseconds =
          exponentialRetryDelay(attempt);
        attemptRecord.retryAfterMilliseconds =
          retryAfterMilliseconds;
        input.progress(progressLine(
          input.state,
          input.context,
          `request=${requestOrder} transport=${transport.phase} ` +
            `retry=${attempt}/${MAX_RETRIES} ` +
            `retryAfterMs=${retryAfterMilliseconds} ` +
            "rateRemaining=unknown",
        ));
        await input.sleep(retryAfterMilliseconds);
        continue;
      }
      throw new Error(
        `transport ${transport.phase} failed after ${attempt} attempts: ${
          sanitizedError(transport.error, input.token)
        }`,
      );
    }

    const { response, responseBytes } = transport;
    const responseHeaders = selectResponseHeaders(response.headers);
    const responseHeaderBytes = canonicalBytes(responseHeaders);
    assertTokenAbsent(
      responseBytes,
      input.token,
      "raw response",
    );
    assertTokenAbsent(
      responseHeaderBytes,
      input.token,
      "response headers",
    );
    await Promise.all([
      writeFile(
        join(attemptDirectory, "response-headers.json"),
        responseHeaderBytes,
        { flag: "wx", mode: 0o600 },
      ),
      writeFile(
        join(attemptDirectory, "response.json"),
        responseBytes,
        { flag: "wx", mode: 0o600 },
      ),
    ]);
    attemptRecord.response = {
      ...artifactReference(
        `${relativeAttemptPath}/response.json`,
        responseBytes,
      ),
      httpStatus: response.status,
    };
    attemptRecord.responseHeaders = artifactReference(
      `${relativeAttemptPath}/response-headers.json`,
      responseHeaderBytes,
    );

    if (response.status === 200) {
      validateSuccessHeaders(responseHeaders);
      const raw = parseJson(responseBytes, "GraphQL response");
      const errors = graphqlErrors(raw);
      if (errors.length > 0) {
        if (
          attempt <= MAX_RETRIES &&
          errors.every(isTransientGraphqlError)
        ) {
          const retryAfterMilliseconds =
            graphqlRetryDelay(responseHeaders, attempt);
          attemptRecord.retryAfterMilliseconds =
            retryAfterMilliseconds;
          input.progress(progressLine(
            input.state,
            input.context,
            `request=${requestOrder} graphql=transient ` +
              `retry=${attempt}/${MAX_RETRIES} ` +
              `retryAfterMs=${retryAfterMilliseconds} ` +
              `rateRemaining=${
                responseHeaders["x-ratelimit-remaining"]
              }`,
          ));
          await input.sleep(retryAfterMilliseconds);
          continue;
        }
        throw new Error("GraphQL errors returned");
      }
      input.progress(progressLine(
        input.state,
        input.context,
        `request=${requestOrder} attempt=${attempt} ` +
          `rateRemaining=${
            responseHeaders["x-ratelimit-remaining"]
          }`,
      ));
      return { raw, record };
    }
    const retryAfterMilliseconds = httpRetryDelay(
      response.status,
      responseHeaders,
      attempt,
    );
    if (
      retryAfterMilliseconds !== null &&
      attempt <= MAX_RETRIES
    ) {
      attemptRecord.retryAfterMilliseconds =
        retryAfterMilliseconds;
      input.progress(progressLine(
        input.state,
        input.context,
        `request=${requestOrder} status=${response.status} ` +
          `retry=${attempt}/${MAX_RETRIES} ` +
          `retryAfterMs=${retryAfterMilliseconds} ` +
          `rateRemaining=${
            responseHeaders["x-ratelimit-remaining"] ?? "unknown"
          }`,
      ));
      await input.sleep(retryAfterMilliseconds);
      continue;
    }
    throw new Error(`unexpected HTTP ${response.status}`);
  }
  throw new Error("retry loop exhausted");
}

async function executeTransportAttempt(input: {
  fetchImpl: C6LiveMultiLangNeighborDeepFetch;
  query: string;
  requestTimeoutMilliseconds: number;
  token: string;
  variables: Record<string, unknown>;
}): Promise<TransportResult> {
  const controller = new AbortController();
  let phase: Exclude<TransportFailurePhase, "timeout"> = "fetch";
  let response: Response | null = null;
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(requestTimeoutError());
    }, input.requestTimeoutMilliseconds);
  });
  try {
    response = await Promise.race([
      input.fetchImpl(ENDPOINT, {
        body: JSON.stringify({
          query: input.query,
          variables: input.variables,
        }),
        headers: {
          ...REQUEST_HEADERS,
          authorization: `Bearer ${input.token}`,
        },
        method: "POST",
        redirect: "error",
        signal: controller.signal,
      }),
      timeout,
    ]);
    phase = "body-read";
    const responseBytes = Buffer.from(await Promise.race([
      response.arrayBuffer(),
      timeout,
    ]));
    return {
      response,
      responseBytes,
      success: true,
    };
  } catch (error) {
    return {
      error,
      phase:
        timedOut || isRequestTimeoutError(error)
          ? "timeout"
          : phase,
      response,
      success: false,
    };
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

function acceptConnectionPage<T>(inputTracker: ConnectionTracker, input: {
  nodes: T[];
  pageInfo: {
    endCursor: string | null;
    hasNextPage: boolean;
  };
  totalCount: number;
}, afterCursor: string | null, identify: (node: T) => string):
  ConnectionCursorStep & { connectionKey: string } {
  const expectedAfter = inputTracker.pageCount === 0
    ? null
    : inputTracker.nextCursor;
  if (
    inputTracker.complete ||
    afterCursor !== expectedAfter ||
    (
      inputTracker.totalCount !== null &&
      input.totalCount !== inputTracker.totalCount
    ) ||
    input.nodes.length > PAGE_SIZE
  ) {
    throw new Error(
      `connection ${inputTracker.key} count/cursor boundary mismatch`,
    );
  }
  inputTracker.totalCount ??= input.totalCount;
  for (const node of input.nodes) {
    const id = identify(node);
    if (inputTracker.seenNodeIds.has(id)) {
      throw new Error(
        `connection ${inputTracker.key} duplicate node ${id}`,
      );
    }
    inputTracker.seenNodeIds.add(id);
  }
  inputTracker.collectedNodeCount += input.nodes.length;
  if (inputTracker.collectedNodeCount > input.totalCount) {
    throw new Error(
      `connection ${inputTracker.key} exceeds totalCount`,
    );
  }
  const { endCursor, hasNextPage } = input.pageInfo;
  if (
    (
      hasNextPage &&
      (
        endCursor === null ||
        input.nodes.length === 0 ||
        inputTracker.collectedNodeCount >= input.totalCount
      )
    ) ||
    (
      input.nodes.length === 0 &&
      endCursor !== null
    ) ||
    (
      input.nodes.length > 0 &&
      endCursor === null
    ) ||
    (
      endCursor !== null &&
      inputTracker.seenCursors.has(endCursor)
    )
  ) {
    throw new Error(
      `connection ${inputTracker.key} invalid pageInfo cursor`,
    );
  }
  if (endCursor !== null) {
    inputTracker.seenCursors.add(endCursor);
  }
  inputTracker.pageCount += 1;
  inputTracker.nextCursor = hasNextPage ? endCursor : null;
  if (!hasNextPage) {
    if (inputTracker.collectedNodeCount !== input.totalCount) {
      throw new Error(
        `connection ${inputTracker.key} collected count mismatch`,
      );
    }
    inputTracker.complete = true;
  }
  const step: ConnectionCursorStep = {
    afterCursor,
    collectedNodeCount: inputTracker.collectedNodeCount,
    endCursor,
    hasNextPage,
    nodeCount: input.nodes.length,
    page: inputTracker.pageCount,
    totalCount: input.totalCount,
  };
  inputTracker.cursorChain.push(step);
  return {
    ...step,
    connectionKey: inputTracker.key,
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

function addConnectionStep(
  request: LogicalRequestRecord,
  step: ConnectionCursorStep & { connectionKey: string },
): void {
  request.connections.push(step);
}

function publicConnection(connection: ConnectionTracker): {
  collectedNodeCount: number;
  complete: boolean;
  cursorChain: ConnectionCursorStep[];
  key: string;
  pageCount: number;
  parentNodeId: string | null;
  path: string;
  totalCount: number;
} {
  if (connection.totalCount === null || !connection.complete) {
    throw new Error(
      `connection ${connection.key} is not complete`,
    );
  }
  return {
    collectedNodeCount: connection.collectedNodeCount,
    complete: true,
    cursorChain: connection.cursorChain,
    key: connection.key,
    pageCount: connection.pageCount,
    parentNodeId: connection.parentNodeId,
    path: connection.path,
    totalCount: connection.totalCount,
  };
}

function registerReviews(
  state: TargetCaptureState,
  reviews: z.infer<typeof reviewSchema>[],
): void {
  for (const reviewValue of reviews) {
    registerUnique(state.reviewIds, reviewValue.id, "review ID");
  }
}

function registerReviewComments(
  state: TargetCaptureState,
  comments: z.infer<typeof reviewCommentSchema>[],
): void {
  for (const commentValue of comments) {
    registerUnique(
      state.reviewCommentIds,
      commentValue.id,
      "review-comment ID",
    );
  }
}

function registerUnique(
  values: Set<string>,
  value: string,
  label: string,
): void {
  if (values.has(value)) {
    throw new Error(`duplicate ${label} ${value}`);
  }
  values.add(value);
}

function validateInitialIdentity(
  parsed: z.infer<typeof initialResponseSchema>,
  target: PlanTarget,
): ResolvedIdentity {
  const repository = parsed.data.repository;
  const pull = repository.pullRequest;
  const repositoryName = repository.nameWithOwner.toLowerCase();
  const baseRepositoryName =
    pull.baseRepository.nameWithOwner.toLowerCase();
  const targetAuthor = target.authorLogin?.toLowerCase() ?? null;
  const responseAuthor = pull.author?.login.toLowerCase() ?? null;
  if (
    repositoryName !== target.canonicalRepository ||
    baseRepositoryName !== target.canonicalRepository ||
    repository.id !== pull.baseRepository.id ||
    pull.number !== target.pullNumber ||
    normalizeUrl(pull.url) !== normalizeUrl(target.url) ||
    responseAuthor !== targetAuthor ||
    pull.createdAt !== target.createdAt ||
    pull.mergedAt !== target.mergedAt ||
    pull.baseRefOid !== target.baseRefOid ||
    pull.mergeCommit.oid !== target.mergeCommitOid
  ) {
    throw new Error("initial pull identity mismatch");
  }
  if (pull.author === null) {
    throw new Error("initial pull author is unavailable");
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
  identity: ResolvedIdentity,
): void {
  if (
    repository.id !== identity.repositoryId ||
    repository.nameWithOwner.toLowerCase() !==
      identity.repositoryNameWithOwner.toLowerCase() ||
    repository.pullRequest.id !== identity.pullRequestId ||
    repository.pullRequest.number !== identity.pullRequestNumber ||
    normalizeUrl(repository.pullRequest.url) !==
      normalizeUrl(identity.pullRequestUrl)
  ) {
    throw new Error("supplement pull identity mismatch");
  }
}

function validatePlan(input: {
  expectedDeepTargetProjection: string;
  expectedQueryHashes: C6LiveMultiLangNeighborDeepQueryHashes;
  expectedTargetCount: number;
  plan: Plan;
  rawPlan: unknown;
}): void {
  const rawTargets = (
    input.rawPlan as { targets?: unknown }
  ).targets;
  if (
    input.plan.targets.length !== input.expectedTargetCount ||
    input.plan.counts.targetCount !== input.expectedTargetCount ||
    input.plan.counts.expectedRequestLowerBound !==
      input.expectedTargetCount
  ) {
    throw new Error(
      "C6 neighbor deep-capture expected target count mismatch",
    );
  }
  if (
    JSON.stringify(rawTargets) !==
      JSON.stringify(input.plan.targets) ||
    sha256(JSON.stringify(input.plan.targets)) !==
      input.plan.independenceBoundary.targetProjectionSha256
  ) {
    throw new Error(
      "C6 neighbor deep-capture plan target projection mismatch",
    );
  }
  if (
    input.plan.independenceBoundary
      .qualificationDeepTargetProjectionSha256 !==
        input.expectedDeepTargetProjection ||
    input.plan.inputs.qualification
      .deepCaptureTargetProjectionSha256 !==
        input.expectedDeepTargetProjection
  ) {
    throw new Error(
      "C6 neighbor deep-capture deep-target projection mismatch",
    );
  }
  const moduleHashes = currentQueryHashes();
  const planHashes = {
    commitParents:
      input.plan.queryContract.supplements.commitParents.sha256,
    commits: input.plan.queryContract.supplements.commits.sha256,
    initial: input.plan.queryContract.initial.sha256,
    reviewThreadComments:
      input.plan.queryContract.supplements
        .reviewThreadComments.sha256,
    reviewThreads:
      input.plan.queryContract.supplements.reviewThreads.sha256,
    reviews: input.plan.queryContract.supplements.reviews.sha256,
  };
  for (const family of Object.keys(
    moduleHashes,
  ) as RequestFamily[]) {
    if (
      input.expectedQueryHashes[family] !== moduleHashes[family] ||
      planHashes[family] !== moduleHashes[family]
    ) {
      throw new Error(
        `C6 neighbor deep-capture query hash mismatch ${family}`,
      );
    }
  }
  if (
    input.plan.queryContract.capturePolicySha256 !==
      sha256(
        serializeC6LiveMultiLangNeighborDeepCaptureQueryPolicy(),
      ) ||
    input.plan.queryContract.structuralReviewPolicySha256 !==
      sha256(serializeC6StructuralReviewEventPolicy())
  ) {
    throw new Error(
      "C6 neighbor deep-capture policy hash mismatch",
    );
  }
  const anchors = new Set<string>();
  const directories = new Set<string>();
  for (const [index, target] of input.plan.targets.entries()) {
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
        `C6 neighbor deep-capture plan target order mismatch ${
          index + 1
        }`,
      );
    }
    anchors.add(target.canonicalAnchorId);
    directories.add(target.captureDirectory);
  }
}

function currentQueryHashes():
  C6LiveMultiLangNeighborDeepQueryHashes {
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
        pullRequest: pullIdentitySchema.extend(connection).strict(),
      }).strict(),
    }).strict(),
  }).strict();
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

function isTransientGraphqlError(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const directType = "type" in value && typeof value.type === "string"
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

function selectResponseHeaders(
  headers: Headers,
): Record<string, string> {
  const selected: Record<string, string> = {};
  for (const name of SELECTED_RESPONSE_HEADERS) {
    const value = headers.get(name);
    if (value !== null) {
      selected[name] = value;
    }
  }
  return selected;
}

function validateSuccessHeaders(
  headers: Record<string, string>,
): void {
  for (const name of REQUIRED_SUCCESS_HEADERS) {
    if (headers[name] === undefined) {
      throw new Error(`missing response header ${name}`);
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
    throw new Error("invalid response headers");
  }
}

function httpRetryDelay(
  status: number,
  headers: Readonly<Record<string, string>>,
  retryNumber: number,
): number | null {
  const retryAfter = retryAfterDelay(headers["retry-after"]);
  if (status === 403) {
    if (retryAfter !== null) {
      return retryAfter;
    }
    return headers["x-ratelimit-remaining"] === "0"
      ? rateLimitResetDelay(headers["x-ratelimit-reset"])
      : null;
  }
  if (!RETRYABLE_STATUS.has(status)) {
    return null;
  }
  return retryAfter ?? exponentialRetryDelay(retryNumber);
}

function graphqlRetryDelay(
  headers: Readonly<Record<string, string>>,
  retryNumber: number,
): number {
  const retryAfter = retryAfterDelay(headers["retry-after"]);
  if (retryAfter !== null) {
    return retryAfter;
  }
  if (headers["x-ratelimit-remaining"] === "0") {
    const resetDelay = rateLimitResetDelay(
      headers["x-ratelimit-reset"],
    );
    if (resetDelay !== null) {
      return resetDelay;
    }
  }
  return exponentialRetryDelay(retryNumber);
}

function retryAfterDelay(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  if (/^\d+(?:\.\d+)?$/u.test(value)) {
    return boundedRetryDelay(Math.ceil(Number(value) * 1_000));
  }
  const now = Date.now();
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? boundedRetryDelay(timestamp - now)
    : null;
}

function rateLimitResetDelay(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/u.test(value)) {
    return null;
  }
  const resetSeconds = Number(value);
  if (!Number.isSafeInteger(resetSeconds)) {
    return null;
  }
  const now = Date.now();
  return boundedRetryDelay(resetSeconds * 1_000 - now);
}

function exponentialRetryDelay(retryNumber: number): number {
  return Math.min(
    1_000 * 2 ** (retryNumber - 1),
    MAX_RETRY_AFTER_MILLISECONDS,
  );
}

function boundedRetryDelay(milliseconds: number): number {
  return Math.min(
    Math.max(0, milliseconds),
    MAX_RETRY_AFTER_MILLISECONDS,
  );
}

function requestTimeoutError(): Error & {
  code: "C6_REQUEST_TIMEOUT";
} {
  return Object.assign(
    new Error("request attempt timed out"),
    { code: "C6_REQUEST_TIMEOUT" as const },
  );
}

function isRequestTimeoutError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "C6_REQUEST_TIMEOUT"
  );
}

function progressLine(
  state: TargetCaptureState,
  context: RequestContext,
  suffix: string,
): string {
  return `[c6-neighbor-deep] target=${
    state.targetIndex
  }/${state.totalTargets} anchor=${
    state.target.canonicalAnchorId
  } family=${context.family} page=${context.page} ${suffix}`;
}

function completedBoundary() {
  return {
    acceptedEpisodeCount: 0 as const,
    actorCaptureExecuted: false as const,
    actorQualifiedEpisodeCount: 0 as const,
    candidateManifestFrozen: false as const,
    captureCompletenessProven: true as const,
    codexRunReady: false as const,
    deepCaptureExecuted: true as const,
    machineQualifiedEpisodeCount: 0 as const,
    semanticallyQualifiedEpisodeCount: 0 as const,
    status:
      "neighbor-structural-review-deep-capture-complete" as const,
  };
}

function targetVariables(
  target: PlanTarget,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    owner: target.owner,
    name: target.repo,
    number: target.pullNumber,
    ...extra,
  };
}

function requiredIdentity(state: TargetCaptureState): ResolvedIdentity {
  if (state.identity === null) {
    throw new Error("initial identity is unavailable");
  }
  return state.identity;
}

function requiredNextCursor(tracker: ConnectionTracker): string {
  if (tracker.nextCursor === null) {
    throw new Error(
      `connection ${tracker.key} missing next cursor`,
    );
  }
  return tracker.nextCursor;
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

function targetReferencedFiles(
  captureDirectory: string,
  captureBytes: Uint8Array,
  requests: LogicalRequestRecord[],
): ArtifactReference[] {
  const references = [
    artifactReference(
      `${captureDirectory}/capture.json`,
      captureBytes,
    ),
  ];
  for (const request of requests) {
    for (const attempt of request.attempts) {
      for (const reference of [
        attempt.request,
        attempt.responseHeaders,
        attempt.response,
        attempt.transportError,
      ]) {
        if (reference === undefined) {
          continue;
        }
        references.push({
          ...reference,
          path: `${captureDirectory}/${reference.path}`,
        });
      }
    }
  }
  return references;
}

async function assertExactCaptureTree(
  root: string,
  references: readonly ArtifactReference[],
): Promise<void> {
  await assertC6NoSymlinkPathComponents(
    root,
    "C6 neighbor deep-capture exact tree root",
  );
  const expectedFiles = new Map<string, ArtifactReference>();
  const expectedDirectories = new Set<string>();
  for (const reference of references) {
    const components = reference.path.split("/");
    if (
      components.some((component) =>
        component.length === 0 ||
        component === "." ||
        component === ".." ||
        component.includes("\\")
      ) ||
      expectedFiles.has(reference.path)
    ) {
      throw new Error(
        `C6 neighbor deep-capture invalid closure path ${
          reference.path
        }`,
      );
    }
    expectedFiles.set(reference.path, reference);
    for (let length = 1; length < components.length; length += 1) {
      expectedDirectories.add(
        components.slice(0, length).join("/"),
      );
    }
  }

  const remainingFiles = new Map(expectedFiles);
  const remainingDirectories = new Set(expectedDirectories);
  await walkExactCaptureTree(
    root,
    "",
    remainingFiles,
    remainingDirectories,
  );
  if (
    remainingFiles.size > 0 ||
    remainingDirectories.size > 0
  ) {
    const missing = [
      ...remainingFiles.keys(),
      ...remainingDirectories,
    ].sort()[0];
    throw new Error(
      `C6 neighbor deep-capture exact tree missing ${missing}`,
    );
  }
}

async function walkExactCaptureTree(
  root: string,
  relativeDirectory: string,
  remainingFiles: Map<string, ArtifactReference>,
  remainingDirectories: Set<string>,
): Promise<void> {
  const directory = relativeDirectory.length === 0
    ? root
    : join(root, ...relativeDirectory.split("/"));
  for (
    const entry of (await readdir(directory, {
      withFileTypes: true,
    })).sort((left, right) => left.name.localeCompare(right.name))
  ) {
    const relativePath = relativeDirectory.length === 0
      ? entry.name
      : `${relativeDirectory}/${entry.name}`;
    const absolutePath = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `C6 neighbor deep-capture exact tree rejects symlink ${
          relativePath
        }`,
      );
    }
    if (entry.isDirectory()) {
      if (!remainingDirectories.delete(relativePath)) {
        throw new Error(
          `C6 neighbor deep-capture exact tree unexpected directory ${
            relativePath
          }`,
        );
      }
      await walkExactCaptureTree(
        root,
        relativePath,
        remainingFiles,
        remainingDirectories,
      );
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        `C6 neighbor deep-capture exact tree rejects non-file ${
          relativePath
        }`,
      );
    }
    const expected = remainingFiles.get(relativePath);
    if (expected === undefined) {
      throw new Error(
        `C6 neighbor deep-capture exact tree unexpected file ${
          relativePath
        }`,
      );
    }
    const bytes = await readC6StableRegularFile(
      absolutePath,
      "neighbor deep-capture exact tree file",
    );
    if (
      bytes.byteLength !== expected.bytes ||
      sha256(bytes) !== expected.sha256
    ) {
      throw new Error(
        `C6 neighbor deep-capture exact tree content mismatch ${
          relativePath
        }`,
      );
    }
    remainingFiles.delete(relativePath);
  }
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function canonicalJson(
  bytes: Uint8Array,
  label: string,
): unknown {
  const raw = parseJson(bytes, label);
  if (
    Buffer.from(bytes).toString("utf8") !==
      `${JSON.stringify(raw, null, 2)}\n`
  ) {
    throw new Error(
      `C6 neighbor deep-capture noncanonical ${label}`,
    );
  }
  return raw;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(
      `C6 neighbor deep-capture invalid ${label} JSON`,
    );
  }
}

function assertTokenAbsent(
  bytes: Uint8Array,
  token: string,
  label: string,
): void {
  if (Buffer.from(bytes).includes(Buffer.from(token))) {
    throw new Error(
      `authorization token appeared in ${label}`,
    );
  }
}

function sanitizedError(error: unknown, token: string): string {
  const message = error instanceof Error
    ? error.message
    : String(error);
  return message.split(token).join("[REDACTED]");
}

function requiredUnpadded(value: string, label: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(
      `C6 neighbor deep-capture ${label} is invalid`,
    );
  }
  return value;
}

function normalizeUrl(value: string): string {
  const parsed = new URL(value);
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.pathname = parsed.pathname.toLowerCase().replace(/\/+$/u, "");
  return parsed.toString();
}

async function assertOutputRootMissing(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }
  throw new Error(
    "C6 neighbor deep-capture output root already exists",
  );
}

async function publishNoReplace(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  const stat = await lstat(sourcePath);
  if (stat.isSymbolicLink()) {
    throw new Error(
      `C6 neighbor deep-capture refuses symlink ${sourcePath}`,
    );
  }
  if (stat.isDirectory()) {
    await mkdir(destinationPath, { mode: stat.mode & 0o777 });
    for (const entry of (await readdir(sourcePath)).sort()) {
      await publishNoReplace(
        join(sourcePath, entry),
        join(destinationPath, entry),
      );
    }
    return;
  }
  if (!stat.isFile()) {
    throw new Error(
      `C6 neighbor deep-capture refuses non-file ${sourcePath}`,
    );
  }
  await link(sourcePath, destinationPath);
}

function completionLast(left: string, right: string): number {
  if (left === "completion.json") {
    return 1;
  }
  if (right === "completion.json") {
    return -1;
  }
  return left.localeCompare(right);
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

async function sleepMilliseconds(milliseconds: number): Promise<void> {
  await new Promise<void>((resolveSleep) => {
    setTimeout(resolveSleep, milliseconds);
  });
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
