import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  readdir,
} from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import { Transform } from "node:stream";

import { z } from "zod";

import type { C6AssetLock } from "./c6-asset-lock";
import {
  assertC6NoSymlinkPathComponents,
  buildC6AssetLock,
  readC6StableRegularFile,
} from "./c6-asset-lock";
import {
  C6_GITHUB_GRAPHQL_DISCOVERY_QUERY,
} from "./c6-github-graphql-discovery";

const GRAPHQL_FILES = [
  "capture.json",
  "request.json",
  "response-headers.json",
  "response.json",
] as const;
const REST_PAGE_SIZE = 100;
const REQUEST_PATTERN =
  /\b(?:please|should|could you|can you|need(?:s)? to|must|change|fix|remove|add|rename|update|instead|avoid|prefer|use|make|move|handle|support|test)\b/iu;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const artifactReferenceSchema = z.object({
  bytes: z.number().int().nonnegative(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const pageInfoSchema = z.object({
  endCursor: z.string().nullable(),
  hasNextPage: z.boolean(),
}).passthrough();
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
  f2p_tests: z.unknown().optional(),
  number: z.number().int().positive(),
  org: z.string().min(1),
  p2p_tests: z.unknown().optional(),
  repo: z.string().min(1),
  resolved_issues: z.array(z.object({
    number: z.number().int().positive(),
  }).passthrough()),
}).passthrough();
const graphqlCaptureSchema = z.object({
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    status: z.literal("single-pr-graphql-discovery-not-accepted-evidence"),
    upperBoundClaimPermitted: z.literal(false),
  }).strict(),
  discovery: z.object({
    discoverySurfaceComplete: z.boolean(),
    paginationGaps: z.array(z.object({
      endCursor: z.string().nullable(),
      path: z.string().min(1),
    }).strict()),
    rateLimit: z.object({
      cost: z.number().int().nonnegative(),
      remaining: z.number().int().nonnegative(),
      resetAt: z.iso.datetime(),
    }).strict(),
  }).strict(),
  request: z.object({
    body: artifactReferenceSchema,
    endpoint: z.literal("https://api.github.com/graphql"),
    headers: z.object({
      accept: z.literal("application/vnd.github+json"),
      authorization: z.literal("Bearer [REDACTED]"),
      "content-type": z.literal("application/json"),
      "user-agent": z.literal("GoodMemory-C6-GraphQL-Discovery/1"),
      "x-github-api-version": z.literal("2022-11-28"),
    }).strict(),
    method: z.literal("POST"),
    variables: z.object({
      name: z.string().min(1),
      number: z.number().int().positive(),
      owner: z.string().min(1),
    }).strict(),
  }).strict(),
  response: z.object({
    body: artifactReferenceSchema,
    headers: artifactReferenceSchema,
    httpStatus: z.literal(200),
  }).strict(),
  schemaVersion: z.literal(1),
  target: z.object({
    pullNumber: z.number().int().positive(),
    repository: z.string().min(1),
    repositoryRedirect: z.object({
      requestedRepository: z.string().min(1),
      resolvedRepository: z.string().min(1),
      status: z.literal("explicit-graphql-resolution-observed"),
    }).strict().optional(),
    url: z.url(),
  }).strict(),
}).strict();
const graphqlRequestSchema = z.object({
  query: z.literal(C6_GITHUB_GRAPHQL_DISCOVERY_QUERY),
  variables: z.object({
    name: z.string().min(1),
    number: z.number().int().positive(),
    owner: z.string().min(1),
  }).strict(),
}).strict();
const graphqlCommitSchema = z.object({
  commit: z.object({
    committedDate: z.iso.datetime(),
    oid: commitSchema,
    parents: z.object({
      nodes: z.array(z.object({
        oid: commitSchema,
      }).passthrough().nullable()),
      pageInfo: pageInfoSchema,
    }).passthrough(),
  }).passthrough(),
}).passthrough();
const graphqlReviewSchema = z.object({
  author: z.object({ login: z.string().min(1) }).passthrough().nullable(),
  body: z.string(),
  commit: z.object({ oid: commitSchema }).passthrough().nullable(),
  id: z.string().min(1),
  submittedAt: z.iso.datetime(),
}).passthrough();
const graphqlReviewCommentSchema = z.object({
  author: z.object({ login: z.string().min(1) }).passthrough().nullable(),
  body: z.string(),
  createdAt: z.iso.datetime(),
  id: z.string().min(1),
  originalCommit: z.object({ oid: commitSchema }).passthrough().nullable(),
}).passthrough();
const graphqlResponseSchema = z.object({
  data: z.object({
    rateLimit: z.object({
      cost: z.number().int().nonnegative(),
      remaining: z.number().int().nonnegative(),
      resetAt: z.iso.datetime(),
    }).passthrough(),
    repository: z.object({
      nameWithOwner: z.string().min(1),
      pullRequest: z.object({
        baseRefOid: commitSchema,
        baseRepository: z.object({
          nameWithOwner: z.string().min(1),
        }).passthrough(),
        commits: z.object({
          nodes: z.array(graphqlCommitSchema.nullable()),
          pageInfo: pageInfoSchema,
        }).passthrough(),
        headRefOid: commitSchema.nullable(),
        number: z.number().int().positive(),
        reviewThreads: z.object({
          nodes: z.array(z.object({
            comments: z.object({
              nodes: z.array(graphqlReviewCommentSchema.nullable()),
              pageInfo: pageInfoSchema,
            }).passthrough(),
            id: z.string().min(1),
          }).passthrough().nullable()),
          pageInfo: pageInfoSchema,
        }).passthrough(),
        reviews: z.object({
          nodes: z.array(graphqlReviewSchema.nullable()),
          pageInfo: pageInfoSchema,
        }).passthrough(),
        url: z.url(),
      }).passthrough(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();
const restResponseHeaderSchema = z.object({
  "content-type": z.string().min(1),
  date: z.string().min(1),
  etag: z.string().min(1),
  "x-github-api-version-selected": z.literal("2022-11-28"),
  "x-github-request-id": z.string().min(1),
  "x-ratelimit-limit": z.string().regex(/^\d+$/u),
  "x-ratelimit-remaining": z.string().regex(/^\d+$/u),
  "x-ratelimit-reset": z.string().regex(/^\d+$/u),
  "x-ratelimit-resource": z.literal("core"),
  "x-ratelimit-used": z.string().regex(/^\d+$/u),
  link: z.string().nullable(),
}).strict();
const restRequestSchema = z.object({
  endpoint: z.enum([
    "commits",
    "issue",
    "issue-comments",
    "pull",
    "pull-discussion-comments",
    "review-comments",
    "reviews",
  ]),
  issueNumber: z.number().int().positive().nullable(),
  page: z.number().int().positive().nullable(),
  request: z.object({
    headers: z.object({
      accept: z.literal("application/vnd.github+json"),
      authorization: z.literal("redacted"),
      "user-agent": z.literal("goodmemory-c6-github-rest-capture/1"),
      "x-github-api-version": z.literal("2022-11-28"),
    }).strict(),
    method: z.literal("GET"),
    url: z.url(),
  }).strict(),
  response: z.object({
    headers: restResponseHeaderSchema,
    rawBody: artifactReferenceSchema,
    status: z.literal(200),
  }).strict(),
}).strict();
const restManifestSchema = z.object({
  boundary: z.object({
    authorizationRecordedAs: z.literal("redacted"),
    bearerAuthorizationHeaderSent: z.literal(true),
    cryptographicPlatformReceipt: z.literal(false),
    httpsUrlEnforced: z.literal(true),
    platformAuthenticationCryptographicallyProven: z.literal(false),
    status: z.literal(
      "https-bearer-rest-session-local-capture-not-cryptographic-platform-receipt",
    ),
    tlsPeerReceiptCaptured: z.literal(false),
  }).strict(),
  generatedBy: z.literal(
    "scripts/codex-coding-effect/c6-github-rest-capture.ts",
  ),
  input: z.object({
    owner: z.string().min(1),
    pullNumber: z.number().int().positive(),
    repository: z.string().min(1),
    resolvedIssueNumbers: z.array(z.number().int().positive()),
  }).strict(),
  requestProtocol: z.object({
    accept: z.literal("application/vnd.github+json"),
    apiRoot: z.literal("https://api.github.com"),
    apiVersion: z.literal("2022-11-28"),
    pagination: z.literal(
      "per-page-100-follow-validated-link-next-until-absent",
    ),
    userAgent: z.literal("goodmemory-c6-github-rest-capture/1"),
  }).strict(),
  requests: z.array(restRequestSchema).min(1),
  responseClosureSha256: sha256Schema,
  schemaVersion: z.literal(1),
}).strict();
const restPullSchema = z.object({
  base: z.object({
    repo: z.object({
      full_name: z.string().min(1),
      id: z.number().int().positive(),
    }).passthrough(),
    sha: commitSchema,
  }).passthrough(),
  comments: z.number().int().nonnegative(),
  commits: z.number().int().nonnegative(),
  head: z.object({ sha: commitSchema }).passthrough(),
  html_url: z.url(),
  number: z.number().int().positive(),
  review_comments: z.number().int().nonnegative(),
  user: z.object({ login: z.string().min(1) }).passthrough(),
}).passthrough();
const restCommitSchema = z.object({
  commit: z.object({
    committer: z.object({
      date: z.iso.datetime(),
    }).passthrough(),
  }).passthrough(),
  parents: z.array(z.object({ sha: commitSchema }).passthrough()),
  sha: commitSchema,
}).passthrough();
const restReviewCommentSchema = z.object({
  body: z.string(),
  created_at: z.iso.datetime(),
  original_commit_id: commitSchema.nullable(),
  user: z.object({ login: z.string().min(1) }).passthrough().nullable(),
}).passthrough();
const restReviewSchema = z.object({
  body: z.string().nullable(),
  commit_id: commitSchema.nullable(),
  submitted_at: z.iso.datetime(),
  user: z.object({ login: z.string().min(1) }).passthrough().nullable(),
}).passthrough();
const restIssueSchema = z.object({
  comments: z.number().int().nonnegative(),
  number: z.number().int().positive(),
}).passthrough();

interface FileReference {
  bytes: number;
  mode: number;
  path: string;
  sha256: string;
}

interface SourceRecord {
  anchorId: string;
  anchorKey: string;
  directory: string;
  issueNumbers: number[];
  number: number;
  org: string;
  repo: string;
  source: {
    path: string;
    rowIndex: number;
    rowSha256: string;
  };
  testSignals: {
    f2pCount: number;
    p2pCount: number;
  };
}

interface CommitRecord {
  committedAt: string;
  oid: string;
  parents: string[];
}

interface RequestEvent {
  author: string;
  body: string;
  createdAt: string;
  id: string;
  reviewedCommit: string;
  source: "review" | "review-comment" | "review-thread-comment";
}

interface TrajectorySequence {
  firstFix: CommitRecord;
  firstReview: RequestEvent;
  initialCommit: CommitRecord;
  secondFix: CommitRecord;
  secondReview: RequestEvent;
}

interface GraphqlTrajectory {
  baseRefOid: string;
  captureManifestSha256: string;
  commitOrder: string[];
  commits: CommitRecord[];
  headRefOid: string | null;
  paginationComplete: boolean;
  pullUrl: string;
  requestEventCount: number;
  requestedRepository: string;
  resolvedRepository: string;
  responseSha256: string;
  timestampSequence: TrajectorySequence | null;
}

interface RestResponseCapture {
  body: unknown;
  request: z.infer<typeof restRequestSchema>;
}

type SequenceOutput = ReturnType<typeof sequenceOutput>;
type AncestryEvidence = ReturnType<typeof buildAncestryEvidence>;
type LinearAncestryEvidence = ReturnType<
  typeof buildLinearReviewAncestryEvidence
>;

export interface C6ReviewTrajectoryDiscovery {
  artifactKind: "c6-review-trajectory-discovery";
  boundary: {
    acceptedEpisodeCount: 0;
    candidateManifestFrozen: false;
    codexRunReady: false;
    signalsNotEpisodes: true;
    status: "review-trajectory-signals-not-episodes";
    upperBoundClaimPermitted: false;
  };
  counts: {
    f2pAndP2pNonempty: number;
    f2pNonempty: number;
    graphqlParentAncestrySequences: number;
    graphqlPaginationIncomplete: number;
    linearReviewAncestrySequences: number;
    linearReviewF2pAndP2pNonempty: number;
    linearReviewF2pNonempty: number;
    nonAuthorRequestEventsAtLeast2: number;
    preliminarySignalCandidates: number;
    restExpectedClosures: number;
    restMissingClosures: number;
    restStrictCompleteClosures: number;
    sourceAnchors: number;
    sourceFiles: number;
    timestampSequences: number;
  };
  graphqlCapture: {
    files: number;
    rootSha256: string;
  };
  missingRestClosures: Array<{
    anchorId: string;
    directory: string;
    status: "missing-strict-rest-closure";
  }>;
  provenance: {
    platformCryptographicReceipt: false;
    status:
      "capture-local-https-responses-not-platform-authenticity-receipts";
    transport: "https-response-body-and-selected-header-capture";
  };
  restCapture: {
    files: number;
    rootSha256: string;
  };
  schemaVersion: 1;
  selectionAudit: {
    fullAncestrySearchSequences: number;
    legacyTimestampFirstPairwiseAncestrySequences: number;
    linearReviewAncestrySequences: number;
    nonlinearThreeEdgeSignals: string[];
    recoveredByFullSearch: string[];
    rejectedByFullSearch: string[];
    status:
      "legacy-timestamp-first-is-diagnostic-not-canonical-selection";
  };
  source: {
    anchorsSha256: string;
    datasetId: "ByteDance-Seed/Multi-SWE-bench";
    declaredRevision: string;
    files: number;
    revisionReceiptBound: false;
    revisionStatus:
      "declared-source-revision-not-bound-by-tree-receipt";
    rootSha256: string;
    treeReceipt: {
      bytes: number;
      path: string;
      sha256: string;
    };
  };
  targetReceipt: {
    bytes: number;
    path: string;
    sha256: string;
  };
  targets: Array<{
    anchorId: string;
    directory: string;
    graphql: {
      captureManifestSha256: string;
      repositoryIdentity: {
        requested: string;
        resolved: string;
        status: "redirect-observed" | "requested-identity";
      };
      requestEventCount: number;
      responseSha256: string;
      timestampSequence: SequenceOutput;
    };
    rest: {
      status: "missing-strict-rest-closure";
    } | {
      commitClosure: {
        commitCount: number;
        graphqlSha256: string;
        matchedCommits: CommitRecord[];
        restSha256: string;
        status: "rest-graphql-parent-and-committed-at-exact-match";
      };
      graphqlParentAncestryEvidence: AncestryEvidence;
      graphqlParentAncestrySequence: SequenceOutput | null;
      graphqlParentAncestryValid: boolean;
      linearReviewAncestryEvidence: LinearAncestryEvidence;
      linearReviewAncestrySequence: SequenceOutput | null;
      linearReviewAncestryValid: boolean;
      manifestSha256: string;
      nonAuthorRequestEventCount: number;
      pullAuthor: string;
      status: "strict-rest-closure";
      timestampSequence: SequenceOutput | null;
      timestampOnlyPairwiseAncestryValid: boolean;
    };
    source: SourceRecord["source"];
    sourceTestSignals: SourceRecord["testSignals"];
  }>;
}

export async function buildC6ReviewTrajectoryDiscovery(input: {
  declaredSourceRevision: string;
  expectedGraphqlRootSha256: string;
  expectedRestRootSha256: string;
  expectedSourceRootSha256: string;
  expectedTargetsSha256: string;
  expectedTreeReceiptSha256: string;
  graphqlCaptureRoot: string;
  restCaptureRoot: string;
  sourceRoot: string;
  targetsPath: string;
  testHooks?: {
    beforeTerminalVerification?: () => Promise<void> | void;
  };
  treeReceiptPath: string;
}): Promise<C6ReviewTrajectoryDiscovery> {
  const expectedGraphqlRootSha256 = sha256Schema.parse(
    input.expectedGraphqlRootSha256,
  );
  const expectedRestRootSha256 = sha256Schema.parse(
    input.expectedRestRootSha256,
  );
  const expectedSourceRootSha256 = sha256Schema.parse(
    input.expectedSourceRootSha256,
  );
  const expectedTargetsSha256 = sha256Schema.parse(
    input.expectedTargetsSha256,
  );
  const expectedTreeReceiptSha256 = sha256Schema.parse(
    input.expectedTreeReceiptSha256,
  );
  const declaredSourceRevision = commitSchema.parse(
    input.declaredSourceRevision,
  );
  const sourceRoot = await assertC6NoSymlinkPathComponents(
    input.sourceRoot,
    "C6 review trajectory source root",
  );
  const graphqlRoot = await assertC6NoSymlinkPathComponents(
    input.graphqlCaptureRoot,
    "C6 review trajectory GraphQL root",
  );
  const restRoot = await assertC6NoSymlinkPathComponents(
    input.restCaptureRoot,
    "C6 review trajectory REST root",
  );
  const targetsPath = await assertC6NoSymlinkPathComponents(
    input.targetsPath,
    "C6 review trajectory target receipt",
  );
  const treeReceiptPath = await assertC6NoSymlinkPathComponents(
    input.treeReceiptPath,
    "C6 review trajectory tree receipt",
  );

  const treeReceiptBytes = await readC6StableRegularFile(
    treeReceiptPath,
    "review trajectory tree receipt",
  );
  if (sha256(treeReceiptBytes) !== expectedTreeReceiptSha256) {
    throw new Error("C6 review trajectory tree receipt hash mismatch");
  }
  const tree = treeReceiptSchema.parse(parseJson(
    treeReceiptBytes,
    "tree receipt",
  ));
  const sourceEntries = tree
    .filter((entry) =>
      entry.type === "file" && entry.path.endsWith("_dataset.jsonl")
    )
    .sort((left, right) => compareStrings(left.path, right.path));
  const sourcePaths = await walkFiles(sourceRoot);
  if (
    sourceEntries.length === 0 ||
    JSON.stringify(sourcePaths) !==
      JSON.stringify(sourceEntries.map((entry) => entry.path))
  ) {
    throw new Error(
      "C6 review trajectory source root does not match tree receipt",
    );
  }
  const sourceRecords: SourceRecord[] = [];
  const sourceFiles: FileReference[] = [];
  for (const entry of sourceEntries) {
    assertSafeRelativePath(entry.path);
    const parsed = await parseSourceFile(join(sourceRoot, entry.path), entry.path);
    if (
      parsed.file.bytes !== entry.size ||
      (
        entry.lfs === undefined
          ? parsed.gitBlobOid !== entry.oid
          : (
            parsed.file.sha256 !== entry.lfs.oid ||
            parsed.file.bytes !== entry.lfs.size
          )
      )
    ) {
      throw new Error(
        `C6 review trajectory source receipt mismatch ${entry.path}`,
      );
    }
    sourceFiles.push(parsed.file);
    sourceRecords.push(...parsed.records);
  }
  const sourceRootSha256 = closureSha256(sourceFiles);
  if (sourceRootSha256 !== expectedSourceRootSha256) {
    throw new Error("C6 review trajectory source root hash mismatch");
  }
  const sourceByKey = new Map<string, SourceRecord>();
  for (const record of sourceRecords) {
    if (sourceByKey.has(record.anchorKey)) {
      throw new Error(
        `C6 review trajectory duplicate source anchor ${record.anchorId}`,
      );
    }
    sourceByKey.set(record.anchorKey, record);
  }

  const graphqlLock = await buildC6AssetLock(graphqlRoot);
  if (graphqlLock.assetRootSha256 !== expectedGraphqlRootSha256) {
    throw new Error("C6 review trajectory GraphQL root hash mismatch");
  }
  assertGraphqlStructure(graphqlLock, sourceRecords);
  const graphqlFiles = fileMap(graphqlLock);
  const graphqlByKey = new Map<string, GraphqlTrajectory>();
  for (const source of sourceRecords) {
    graphqlByKey.set(
      source.anchorKey,
      await validateGraphqlCapture(
        graphqlRoot,
        source,
        graphqlFiles,
      ),
    );
  }
  const preliminaryKeys = new Set(
    sourceRecords
      .filter((source) => {
        const graphql = graphqlByKey.get(source.anchorKey)!;
        return graphql.paginationComplete &&
          graphql.timestampSequence !== null;
      })
      .map((source) => source.anchorKey),
  );
  const targetBytes = Buffer.from(sourceRecords
    .filter((source) => preliminaryKeys.has(source.anchorKey))
    .map((source) => {
      const issueNumbers = [...source.issueNumbers].sort(
        (left, right) => left - right,
      );
      if (
        issueNumbers.length === 0 ||
        new Set(issueNumbers).size !== issueNumbers.length
      ) {
        throw new Error(
          `C6 review trajectory invalid resolved issues ${source.anchorId}`,
        );
      }
      return `${source.org}\t${source.repo}\t${source.number}\t${
        issueNumbers.join(",")
      }\n`;
    }).join(""));
  const capturedTargetBytes = await readC6StableRegularFile(
    targetsPath,
    "review trajectory target receipt",
  );
  if (
    sha256(capturedTargetBytes) !== expectedTargetsSha256 ||
    !capturedTargetBytes.equals(targetBytes)
  ) {
    throw new Error("C6 review trajectory target receipt hash mismatch");
  }

  const restLock = await buildC6AssetLock(restRoot);
  if (restLock.assetRootSha256 !== expectedRestRootSha256) {
    throw new Error("C6 review trajectory REST root hash mismatch");
  }
  const restDirectories = await readRootDirectories(restRoot);
  const targetDirectorySet = new Set(
    sourceRecords
      .filter((source) => preliminaryKeys.has(source.anchorKey))
      .map((source) => source.directory),
  );
  for (const directory of restDirectories) {
    if (!targetDirectorySet.has(directory)) {
      throw new Error(
        `C6 review trajectory unexpected REST directory ${directory}`,
      );
    }
  }
  const restFiles = fileMap(restLock);
  const missingRestClosures:
    C6ReviewTrajectoryDiscovery["missingRestClosures"] = [];
  const targets: C6ReviewTrajectoryDiscovery["targets"] = [];
  for (const source of sourceRecords) {
    if (!preliminaryKeys.has(source.anchorKey)) {
      continue;
    }
    const graphql = graphqlByKey.get(source.anchorKey)!;
    const graphqlOutput = {
      captureManifestSha256: graphql.captureManifestSha256,
      repositoryIdentity: {
        requested: graphql.requestedRepository,
        resolved: graphql.resolvedRepository,
        status: graphql.requestedRepository === graphql.resolvedRepository
          ? "requested-identity" as const
          : "redirect-observed" as const,
      },
      requestEventCount: graphql.requestEventCount,
      responseSha256: graphql.responseSha256,
      timestampSequence: sequenceOutput(graphql.timestampSequence!),
    };
    if (!restDirectories.includes(source.directory)) {
      missingRestClosures.push({
        anchorId: source.anchorId,
        directory: source.directory,
        status: "missing-strict-rest-closure",
      });
      targets.push({
        anchorId: source.anchorId,
        directory: source.directory,
        graphql: graphqlOutput,
        rest: { status: "missing-strict-rest-closure" },
        source: source.source,
        sourceTestSignals: source.testSignals,
      });
      continue;
    }
    const rest = await validateRestCapture(
      restRoot,
      source,
      graphql,
      restFiles,
    );
    targets.push({
      anchorId: source.anchorId,
      directory: source.directory,
      graphql: graphqlOutput,
      rest,
      source: source.source,
      sourceTestSignals: source.testSignals,
    });
  }

  await input.testHooks?.beforeTerminalVerification?.();
  await assertTerminalInputPaths({
    graphqlRoot,
    restRoot,
    sourceRoot,
    targetsPath,
    treeReceiptPath,
  });
  await assertTerminalSourceClosure(sourceRoot, sourceFiles);
  await assertTerminalAssetLock(graphqlRoot, graphqlLock, "GraphQL");
  await assertTerminalAssetLock(restRoot, restLock, "REST");
  if (
    JSON.stringify(await readRootDirectories(restRoot)) !==
      JSON.stringify(restDirectories) ||
    !(await readC6StableRegularFile(
      treeReceiptPath,
      "review trajectory terminal tree receipt",
    )).equals(treeReceiptBytes) ||
    !(await readC6StableRegularFile(
      targetsPath,
      "review trajectory terminal target receipt",
    )).equals(capturedTargetBytes)
  ) {
    throw new Error(
      "C6 review trajectory external receipt changed during analysis",
    );
  }
  await assertTerminalInputPaths({
    graphqlRoot,
    restRoot,
    sourceRoot,
    targetsPath,
    treeReceiptPath,
  });

  const strictTargets = targets.filter(hasStrictRestClosure);
  const ancestryTargets = strictTargets.filter(
    (target) => target.rest.graphqlParentAncestryValid,
  );
  const legacyAncestryTargets = strictTargets.filter(
    (target) => target.rest.timestampOnlyPairwiseAncestryValid,
  );
  const linearAncestryTargets = strictTargets.filter(
    (target) => target.rest.linearReviewAncestryValid,
  );
  return {
    artifactKind: "c6-review-trajectory-discovery",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      signalsNotEpisodes: true,
      status: "review-trajectory-signals-not-episodes",
      upperBoundClaimPermitted: false,
    },
    counts: {
      f2pAndP2pNonempty: ancestryTargets.filter(
        (target) =>
          target.sourceTestSignals.f2pCount > 0 &&
          target.sourceTestSignals.p2pCount > 0,
      ).length,
      f2pNonempty: ancestryTargets.filter(
        (target) => target.sourceTestSignals.f2pCount > 0,
      ).length,
      graphqlParentAncestrySequences: ancestryTargets.length,
      graphqlPaginationIncomplete: [...graphqlByKey.values()].filter(
        (graphql) => !graphql.paginationComplete,
      ).length,
      linearReviewAncestrySequences: linearAncestryTargets.length,
      linearReviewF2pAndP2pNonempty: linearAncestryTargets.filter(
        (target) =>
          target.sourceTestSignals.f2pCount > 0 &&
          target.sourceTestSignals.p2pCount > 0,
      ).length,
      linearReviewF2pNonempty: linearAncestryTargets.filter(
        (target) => target.sourceTestSignals.f2pCount > 0,
      ).length,
      nonAuthorRequestEventsAtLeast2: strictTargets.filter(
        (target) => target.rest.nonAuthorRequestEventCount >= 2,
      ).length,
      preliminarySignalCandidates: targets.length,
      restExpectedClosures: targets.length,
      restMissingClosures: missingRestClosures.length,
      restStrictCompleteClosures: strictTargets.length,
      sourceAnchors: sourceRecords.length,
      sourceFiles: sourceFiles.length,
      timestampSequences: strictTargets.filter(
        (target) => target.rest.timestampSequence !== null,
      ).length,
    },
    graphqlCapture: {
      files: graphqlLock.files.length,
      rootSha256: graphqlLock.assetRootSha256,
    },
    missingRestClosures,
    provenance: {
      platformCryptographicReceipt: false,
      status:
        "capture-local-https-responses-not-platform-authenticity-receipts",
      transport: "https-response-body-and-selected-header-capture",
    },
    restCapture: {
      files: restLock.files.length,
      rootSha256: restLock.assetRootSha256,
    },
    schemaVersion: 1,
    selectionAudit: {
      fullAncestrySearchSequences: ancestryTargets.length,
      legacyTimestampFirstPairwiseAncestrySequences:
        legacyAncestryTargets.length,
      linearReviewAncestrySequences: linearAncestryTargets.length,
      nonlinearThreeEdgeSignals: ancestryTargets
        .filter((target) => !target.rest.linearReviewAncestryValid)
        .map((target) => target.anchorId),
      recoveredByFullSearch: ancestryTargets
        .filter((target) =>
          !target.rest.timestampOnlyPairwiseAncestryValid
        )
        .map((target) => target.anchorId),
      rejectedByFullSearch: legacyAncestryTargets
        .filter((target) => !target.rest.graphqlParentAncestryValid)
        .map((target) => target.anchorId),
      status:
        "legacy-timestamp-first-is-diagnostic-not-canonical-selection",
    },
    source: {
      anchorsSha256: sha256(JSON.stringify(sourceRecords)),
      datasetId: "ByteDance-Seed/Multi-SWE-bench",
      declaredRevision: declaredSourceRevision,
      files: sourceFiles.length,
      revisionReceiptBound: false,
      revisionStatus:
        "declared-source-revision-not-bound-by-tree-receipt",
      rootSha256: sourceRootSha256,
      treeReceipt: {
        bytes: treeReceiptBytes.byteLength,
        path: basename(treeReceiptPath),
        sha256: expectedTreeReceiptSha256,
      },
    },
    targetReceipt: {
      bytes: capturedTargetBytes.byteLength,
      path: basename(targetsPath),
      sha256: expectedTargetsSha256,
    },
    targets,
  };
}

export function serializeC6ReviewTrajectoryDiscovery(
  discovery: C6ReviewTrajectoryDiscovery,
): string {
  return `${JSON.stringify(discovery, null, 2)}\n`;
}

function hasStrictRestClosure(
  target: C6ReviewTrajectoryDiscovery["targets"][number],
): target is C6ReviewTrajectoryDiscovery["targets"][number] & {
  rest: Extract<
    C6ReviewTrajectoryDiscovery["targets"][number]["rest"],
    { status: "strict-rest-closure" }
  >;
} {
  return target.rest.status === "strict-rest-closure";
}

async function validateGraphqlCapture(
  root: string,
  source: SourceRecord,
  initialFiles: ReadonlyMap<string, FileReference>,
): Promise<GraphqlTrajectory> {
  const directory = join(root, source.directory);
  const [captureBytes, requestBytes, headerBytes, responseBytes] =
    await Promise.all([
      readBoundFile(
        directory,
        "capture.json",
        source.directory,
        initialFiles,
        "GraphQL",
      ),
      readBoundFile(
        directory,
        "request.json",
        source.directory,
        initialFiles,
        "GraphQL",
      ),
      readBoundFile(
        directory,
        "response-headers.json",
        source.directory,
        initialFiles,
        "GraphQL",
      ),
      readBoundFile(
        directory,
        "response.json",
        source.directory,
        initialFiles,
        "GraphQL",
      ),
    ]);
  const rawCapture = parseJson(captureBytes, "GraphQL capture manifest");
  const capture = graphqlCaptureSchema.parse(rawCapture);
  if (
    captureBytes.toString("utf8") !==
      `${JSON.stringify(rawCapture, null, 2)}\n`
  ) {
    throw new Error(
      `C6 review trajectory non-canonical GraphQL manifest ${
        source.anchorId
      }`,
    );
  }
  assertArtifactReference(
    capture.request.body,
    "request.json",
    requestBytes,
    "GraphQL",
    source.anchorId,
  );
  assertArtifactReference(
    capture.response.headers,
    "response-headers.json",
    headerBytes,
    "GraphQL",
    source.anchorId,
  );
  assertArtifactReference(
    capture.response.body,
    "response.json",
    responseBytes,
    "GraphQL",
    source.anchorId,
  );
  const request = graphqlRequestSchema.parse(
    parseJson(requestBytes, "GraphQL request"),
  );
  const expectedVariables = {
    name: source.repo,
    number: source.number,
    owner: source.org,
  };
  if (
    requestBytes.toString("utf8") !== JSON.stringify(request) ||
    JSON.stringify(request.variables) !== JSON.stringify(expectedVariables) ||
    JSON.stringify(capture.request.variables) !==
      JSON.stringify(expectedVariables)
  ) {
    throw new Error(
      `C6 review trajectory GraphQL request target mismatch ${
        source.anchorId
      }`,
    );
  }
  const headers = parseJson(headerBytes, "GraphQL response headers");
  if (
    typeof headers !== "object" ||
    headers === null ||
    !("content-type" in headers) ||
    typeof headers["content-type"] !== "string" ||
    headers["content-type"].split(";", 1)[0]!.trim().toLowerCase() !==
      "application/json"
  ) {
    throw new Error(
      `C6 review trajectory GraphQL response headers mismatch ${
        source.anchorId
      }`,
    );
  }
  const rawResponse = parseJson(responseBytes, "GraphQL response");
  if (
    typeof rawResponse === "object" &&
    rawResponse !== null &&
    "errors" in rawResponse &&
    Array.isArray(rawResponse.errors) &&
    rawResponse.errors.length > 0
  ) {
    throw new Error(
      `C6 review trajectory GraphQL errors ${source.anchorId}`,
    );
  }
  const response = graphqlResponseSchema.parse(rawResponse);
  const pull = response.data.repository.pullRequest;
  const requestedRepository = `${source.org}/${source.repo}`.toLowerCase();
  const resolvedRepository = normalizeRepositoryName(
    response.data.repository.nameWithOwner,
  );
  const baseRepository = normalizeRepositoryName(
    pull.baseRepository.nameWithOwner,
  );
  const redirect = capture.target.repositoryRedirect;
  const redirected = resolvedRepository !== requestedRepository;
  if (
    pull.number !== source.number ||
    baseRepository !== resolvedRepository ||
    normalizeRepositoryName(capture.target.repository) !==
      resolvedRepository ||
    capture.target.pullNumber !== source.number ||
    (
      redirected
        ? (
          redirect === undefined ||
          normalizeRepositoryName(redirect.requestedRepository) !==
            requestedRepository ||
          normalizeRepositoryName(redirect.resolvedRepository) !==
            resolvedRepository
        )
        : redirect !== undefined
    )
  ) {
    throw new Error(
      `C6 review trajectory GraphQL identity mismatch ${source.anchorId}`,
    );
  }
  const expectedUrl =
    `https://github.com/${resolvedRepository}/pull/${source.number}`;
  if (
    normalizeGitHubUrl(pull.url) !== normalizeGitHubUrl(expectedUrl) ||
    normalizeGitHubUrl(capture.target.url) !== normalizeGitHubUrl(expectedUrl)
  ) {
    throw new Error(
      `C6 review trajectory GraphQL URL mismatch ${source.anchorId}`,
    );
  }
  const paginationGaps = collectPaginationGaps(rawResponse, "");
  if (
    JSON.stringify(capture.discovery.paginationGaps) !==
      JSON.stringify(paginationGaps) ||
    capture.discovery.discoverySurfaceComplete !==
      (paginationGaps.length === 0) ||
    JSON.stringify(capture.discovery.rateLimit) !==
      JSON.stringify(response.data.rateLimit)
  ) {
    throw new Error(
      `C6 review trajectory GraphQL pagination manifest mismatch ${
        source.anchorId
      }`,
    );
  }
  const commitsInPullOrder = pull.commits.nodes
    .filter(isPresent)
    .map((node) => ({
      committedAt: node.commit.committedDate,
      oid: node.commit.oid,
      parents: node.commit.parents.nodes
        .filter(isPresent)
        .map((parent) => parent.oid),
    }));
  const commits = [...commitsInPullOrder].sort(compareCommits);
  if (
    new Set(commits.map((commit) => commit.oid)).size !== commits.length
  ) {
    throw new Error(
      `C6 review trajectory duplicate GraphQL commit ${source.anchorId}`,
    );
  }
  const events: RequestEvent[] = [];
  for (const review of pull.reviews.nodes.filter(isPresent)) {
    if (
      review.author !== null &&
      review.commit !== null
    ) {
      events.push({
        author: review.author.login,
        body: review.body,
        createdAt: review.submittedAt,
        id: review.id,
        reviewedCommit: review.commit.oid,
        source: "review",
      });
    }
  }
  for (const thread of pull.reviewThreads.nodes.filter(isPresent)) {
    for (const comment of thread.comments.nodes.filter(isPresent)) {
      if (
        comment.author !== null &&
        comment.originalCommit !== null
      ) {
        events.push({
          author: comment.author.login,
          body: comment.body,
          createdAt: comment.createdAt,
          id: comment.id,
          reviewedCommit: comment.originalCommit.oid,
          source: "review-thread-comment",
        });
      }
    }
  }
  const requestEvents = events
    .filter(isRequestEvent)
    .sort(compareEvents);
  const paginationComplete =
    !pull.commits.pageInfo.hasNextPage &&
    pull.commits.nodes.filter(isPresent).every(
      (node) => !node.commit.parents.pageInfo.hasNextPage,
    ) &&
    !pull.reviews.pageInfo.hasNextPage &&
    !pull.reviewThreads.pageInfo.hasNextPage &&
    pull.reviewThreads.nodes.filter(isPresent).every(
      (thread) => !thread.comments.pageInfo.hasNextPage,
    );
  return {
    baseRefOid: pull.baseRefOid,
    captureManifestSha256: sha256(captureBytes),
    commitOrder: commitsInPullOrder.map((commit) => commit.oid),
    commits,
    headRefOid: pull.headRefOid,
    paginationComplete,
    pullUrl: expectedUrl,
    requestEventCount: requestEvents.length,
    requestedRepository,
    resolvedRepository,
    responseSha256: sha256(responseBytes),
    timestampSequence: findTimestampSequence(commits, requestEvents),
  };
}

function findTimestampSequence(
  commits: readonly CommitRecord[],
  events: readonly RequestEvent[],
  accepts: (sequence: TrajectorySequence) => boolean = () => true,
): TrajectorySequence | null {
  const commitByOid = new Map(commits.map((commit) => [commit.oid, commit]));
  for (let firstIndex = 0; firstIndex < events.length; firstIndex += 1) {
    const firstReview = events[firstIndex]!;
    const firstReviewTime = timestamp(firstReview.createdAt);
    const initialCommit = commitByOid.get(firstReview.reviewedCommit) ??
      [...commits].reverse().find(
        (commit) => timestamp(commit.committedAt) <= firstReviewTime,
      );
    if (initialCommit === undefined) {
      continue;
    }
    for (const firstFix of commits) {
      if (
        firstFix.oid === firstReview.reviewedCommit ||
        timestamp(firstFix.committedAt) <= firstReviewTime
      ) {
        continue;
      }
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < events.length;
        secondIndex += 1
      ) {
        const secondReview = events[secondIndex]!;
        const secondReviewTime = timestamp(secondReview.createdAt);
        if (
          secondReview.reviewedCommit === firstReview.reviewedCommit ||
          secondReviewTime <= firstReviewTime ||
          secondReviewTime < timestamp(firstFix.committedAt)
        ) {
          continue;
        }
        for (const secondFix of commits) {
          if (
            secondFix.oid === secondReview.reviewedCommit ||
            secondFix.oid === firstFix.oid ||
            timestamp(secondFix.committedAt) <= secondReviewTime
          ) {
            continue;
          }
          const sequence = {
            firstFix,
            firstReview,
            initialCommit,
            secondFix,
            secondReview,
          };
          if (accepts(sequence)) {
            return sequence;
          }
        }
      }
    }
  }
  return null;
}

function sequenceOutput(sequence: TrajectorySequence) {
  return {
    firstFixCommit: sequence.firstFix.oid,
    firstReview: eventOutput(sequence.firstReview),
    initialCommit: sequence.initialCommit.oid,
    secondFixCommit: sequence.secondFix.oid,
    secondReview: eventOutput(sequence.secondReview),
  };
}

function eventOutput(event: RequestEvent) {
  return {
    author: event.author,
    bodyBytes: Buffer.byteLength(event.body),
    bodySha256: sha256(event.body),
    createdAt: event.createdAt,
    id: event.id,
    reviewedCommit: event.reviewedCommit,
    source: event.source,
  };
}

function isRequestEvent(event: RequestEvent): boolean {
  return !event.author.toLowerCase().endsWith("[bot]") &&
    event.body.trim().length >= 10 &&
    REQUEST_PATTERN.test(event.body);
}

function compareCommits(left: CommitRecord, right: CommitRecord): number {
  return timestamp(left.committedAt) - timestamp(right.committedAt) ||
    compareStrings(left.oid, right.oid);
}

function compareEvents(left: RequestEvent, right: RequestEvent): number {
  return timestamp(left.createdAt) - timestamp(right.createdAt) ||
    compareStrings(left.reviewedCommit, right.reviewedCommit) ||
    compareStrings(left.source, right.source) ||
    compareStrings(left.body, right.body) ||
    compareStrings(left.id, right.id);
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`C6 review trajectory invalid timestamp ${value}`);
  }
  return parsed;
}

async function validateRestCapture(
  root: string,
  source: SourceRecord,
  graphql: GraphqlTrajectory,
  initialFiles: ReadonlyMap<string, FileReference>,
): Promise<Extract<
  C6ReviewTrajectoryDiscovery["targets"][number]["rest"],
  { status: "strict-rest-closure" }
>> {
  const directory = join(root, source.directory);
  const manifestBytes = await readBoundFile(
    directory,
    "manifest.json",
    source.directory,
    initialFiles,
    "REST",
  );
  const rawManifest = parseJson(manifestBytes, "REST manifest");
  const manifest = restManifestSchema.parse(rawManifest);
  if (
    manifestBytes.toString("utf8") !==
      `${JSON.stringify(rawManifest, null, 2)}\n` ||
    manifest.input.owner !== source.org ||
    manifest.input.repository !== source.repo ||
    manifest.input.pullNumber !== source.number ||
    JSON.stringify(manifest.input.resolvedIssueNumbers) !==
      JSON.stringify([...source.issueNumbers].sort(
        (left, right) => left - right,
      ))
  ) {
    throw new Error(
      `C6 review trajectory REST manifest target mismatch ${source.anchorId}`,
    );
  }
  const expectedFiles = new Set(["manifest.json"]);
  const requests: RestResponseCapture[] = [];
  const requestKeys = new Set<string>();
  for (const request of manifest.requests) {
    const relativePath = request.response.rawBody.path;
    assertSafeRelativePath(relativePath);
    const key = [
      request.endpoint,
      request.issueNumber ?? "none",
      request.page ?? "none",
    ].join(":");
    if (
      relativePath === "manifest.json" ||
      expectedFiles.has(relativePath) ||
      requestKeys.has(key)
    ) {
      throw new Error(
        `C6 review trajectory duplicate REST artifact ${source.anchorId}`,
      );
    }
    expectedFiles.add(relativePath);
    requestKeys.add(key);
    const bytes = await readBoundFile(
      directory,
      relativePath,
      source.directory,
      initialFiles,
      "REST",
    );
    assertArtifactReference(
      request.response.rawBody,
      relativePath,
      bytes,
      "REST",
      source.anchorId,
    );
    if (
      request.response.headers["content-type"]
        .split(";", 1)[0]!
        .trim()
        .toLowerCase() !== "application/json"
    ) {
      throw new Error(
        `C6 review trajectory REST content type mismatch ${source.anchorId}`,
      );
    }
    requests.push({
      body: parseJson(bytes, "REST response"),
      request,
    });
  }
  const directoryFiles = [...initialFiles.keys()]
    .filter((path) => path.startsWith(`${source.directory}/`))
    .map((path) => path.slice(source.directory.length + 1))
    .sort(compareStrings);
  if (
    JSON.stringify(directoryFiles) !==
      JSON.stringify([...expectedFiles].sort(compareStrings)) ||
    manifest.responseClosureSha256 !== sha256(JSON.stringify(
      manifest.requests.map((request) => request.response.rawBody),
    ))
  ) {
    throw new Error(
      `C6 review trajectory REST file closure mismatch ${source.anchorId}`,
    );
  }
  const structure = await readRelativeStructure(directory);
  const expectedStructure = buildExpectedStructure(expectedFiles);
  if (JSON.stringify(structure) !== JSON.stringify(expectedStructure)) {
    throw new Error(
      `C6 review trajectory REST directory structure mismatch ${
        source.anchorId
      }`,
    );
  }

  const pullItems = requests.filter(
    (item) => item.request.endpoint === "pull",
  );
  if (pullItems.length !== 1) {
    throw new Error(
      `C6 review trajectory requires one REST pull ${source.anchorId}`,
    );
  }
  const pull = restPullSchema.parse(pullItems[0]!.body);
  if (
    pull.number !== source.number ||
    normalizeRepositoryName(pull.base.repo.full_name) !==
      graphql.resolvedRepository ||
    normalizeGitHubUrl(pull.html_url) !== normalizeGitHubUrl(
      graphql.pullUrl,
    ) ||
    pull.base.sha !== graphql.baseRefOid ||
    pull.head.sha !== graphql.headRefOid
  ) {
    throw new Error(
      `C6 review trajectory REST pull identity mismatch ${source.anchorId}`,
    );
  }

  const groups = new Map<string, typeof requests>();
  for (const item of requests) {
    validateRestRequestIdentity(
      item.request,
      manifest,
      pull.base.repo.id,
      source.anchorId,
    );
    const key = restGroupKey(item.request);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    validateRestGroup(
      group,
      manifest,
      pull.base.repo.id,
      source.anchorId,
    );
  }
  const commits = parseRestGroup(
    groups,
    "commits:none",
    restCommitSchema,
    source.anchorId,
  );
  const reviewComments = parseRestGroup(
    groups,
    "review-comments:none",
    restReviewCommentSchema,
    source.anchorId,
  );
  const reviews = parseRestGroup(
    groups,
    "reviews:none",
    restReviewSchema,
    source.anchorId,
  );
  const discussionComments = parseRestArray(
    groups,
    `pull-discussion-comments:${source.number}`,
    source.anchorId,
  );
  const graphqlCommitsByOid = new Map(
    graphql.commits.map((commit) => [commit.oid, commit]),
  );
  const graphqlCommitClosure = graphql.commitOrder.map((oid) => {
    const commit = graphqlCommitsByOid.get(oid);
    if (commit === undefined) {
      throw new Error(
        `C6 review trajectory missing GraphQL commit ${source.anchorId}`,
      );
    }
    return commit;
  });
  const restCommitClosure: CommitRecord[] = commits.map((commit) => ({
    committedAt: commit.commit.committer.date,
    oid: commit.sha,
    parents: commit.parents.map((parent) => parent.sha),
  }));
  if (
    JSON.stringify(restCommitClosure) !==
      JSON.stringify(graphqlCommitClosure)
  ) {
    throw new Error(
      `C6 review trajectory REST/GraphQL commit closure mismatch ${
        source.anchorId
      }`,
    );
  }
  if (
    pull.commits !== commits.length ||
    pull.review_comments !== reviewComments.length ||
    pull.comments !== discussionComments.length
  ) {
    throw new Error(
      `C6 review trajectory REST count or commit binding mismatch ${
        source.anchorId
      }`,
    );
  }
  for (const issueNumber of source.issueNumbers) {
    const issueItems = groups.get(`issue:${issueNumber}`);
    if (issueItems === undefined || issueItems.length !== 1) {
      throw new Error(
        `C6 review trajectory missing REST issue ${source.anchorId}`,
      );
    }
    const issue = restIssueSchema.parse(issueItems[0]!.body);
    const issueComments = parseRestArray(
      groups,
      `issue-comments:${issueNumber}`,
      source.anchorId,
    );
    if (
      issue.number !== issueNumber ||
      "pull_request" in (issueItems[0]!.body as Record<PropertyKey, unknown>) ||
      issue.comments !== issueComments.length
    ) {
      throw new Error(
        `C6 review trajectory REST issue count mismatch ${source.anchorId}`,
      );
    }
  }
  const pullAuthor = pull.user.login;
  const events: RequestEvent[] = [
    ...reviewComments.flatMap((comment, index) =>
      comment.user === null || comment.original_commit_id === null
        ? []
        : [{
          author: comment.user.login,
          body: comment.body,
          createdAt: comment.created_at,
          id: `review-comment:${index}:${sha256(comment.body)}`,
          reviewedCommit: comment.original_commit_id,
          source: "review-comment" as const,
        }]
    ),
    ...reviews.flatMap((review, index) =>
      review.user === null || review.commit_id === null
        ? []
        : [{
          author: review.user.login,
          body: review.body ?? "",
          createdAt: review.submitted_at,
          id: `review:${index}:${sha256(review.body ?? "")}`,
          reviewedCommit: review.commit_id,
          source: "review" as const,
        }]
    ),
  ].filter((event) =>
    event.author.toLowerCase() !== pullAuthor.toLowerCase() &&
    isRequestEvent(event)
  ).sort(compareEvents);
  const restCommits: CommitRecord[] = commits.map((commit) => ({
    committedAt: commit.commit.committer.date,
    oid: commit.sha,
    parents: commit.parents.map((parent) => parent.sha),
  })).sort(compareCommits);
  const timestampSequence = findTimestampSequence(restCommits, events);
  const timestampOnlyPairwiseAncestryValid = timestampSequence !== null &&
    isDescendant(
      graphql.commits,
      timestampSequence.firstFix.oid,
      timestampSequence.firstReview.reviewedCommit,
    ) &&
    isDescendant(
      graphql.commits,
      timestampSequence.secondFix.oid,
      timestampSequence.secondReview.reviewedCommit,
    );
  const graphqlParentAncestrySequence = findTimestampSequence(
    restCommits,
    events,
    (sequence) =>
      isDescendant(
        graphql.commits,
        sequence.firstFix.oid,
        sequence.firstReview.reviewedCommit,
      ) &&
      isDescendant(
        graphql.commits,
        sequence.secondFix.oid,
        sequence.secondReview.reviewedCommit,
      ) &&
      isDescendant(
        graphql.commits,
        sequence.secondFix.oid,
        sequence.firstFix.oid,
      ),
  );
  const graphqlParentAncestryEvidence =
    graphqlParentAncestrySequence === null
      ? null
      : buildAncestryEvidence(
        graphql.commits,
        graphqlParentAncestrySequence,
      );
  if (
    graphqlParentAncestrySequence !== null &&
    graphqlParentAncestryEvidence === null
  ) {
    throw new Error(
      `C6 review trajectory ancestry evidence mismatch ${source.anchorId}`,
    );
  }
  const linearReviewAncestrySequence = findTimestampSequence(
    restCommits,
    events,
    (sequence) => isLinearReviewSequence(graphql.commits, sequence),
  );
  const linearReviewAncestryEvidence =
    linearReviewAncestrySequence === null
      ? null
      : buildLinearReviewAncestryEvidence(
        graphql.commits,
        linearReviewAncestrySequence,
      );
  if (
    linearReviewAncestrySequence !== null &&
    linearReviewAncestryEvidence === null
  ) {
    throw new Error(
      `C6 review trajectory linear ancestry evidence mismatch ${source.anchorId}`,
    );
  }
  return {
    commitClosure: {
      commitCount: restCommitClosure.length,
      graphqlSha256: sha256(JSON.stringify(graphqlCommitClosure)),
      matchedCommits: restCommitClosure,
      restSha256: sha256(JSON.stringify(restCommitClosure)),
      status: "rest-graphql-parent-and-committed-at-exact-match",
    },
    graphqlParentAncestryEvidence,
    graphqlParentAncestrySequence:
      graphqlParentAncestrySequence === null
        ? null
        : sequenceOutput(graphqlParentAncestrySequence),
    graphqlParentAncestryValid:
      graphqlParentAncestrySequence !== null,
    linearReviewAncestryEvidence,
    linearReviewAncestrySequence:
      linearReviewAncestrySequence === null
        ? null
        : sequenceOutput(linearReviewAncestrySequence),
    linearReviewAncestryValid:
      linearReviewAncestrySequence !== null,
    manifestSha256: sha256(manifestBytes),
    nonAuthorRequestEventCount: events.length,
    pullAuthor,
    status: "strict-rest-closure",
    timestampSequence: timestampSequence === null
      ? null
      : sequenceOutput(timestampSequence),
    timestampOnlyPairwiseAncestryValid,
  };
}

function parseRestGroup<T extends z.ZodType>(
  groups: ReadonlyMap<string, RestResponseCapture[]>,
  key: string,
  schema: T,
  anchorId: string,
): Array<z.output<T>> {
  return parseRestArray(groups, key, anchorId).map((value) =>
    schema.parse(value)
  );
}

function parseRestArray(
  groups: ReadonlyMap<string, RestResponseCapture[]>,
  key: string,
  anchorId: string,
): unknown[] {
  const group = groups.get(key);
  if (group === undefined) {
    throw new Error(
      `C6 review trajectory missing REST group ${key} ${anchorId}`,
    );
  }
  return group
    .sort((left, right) =>
      (left.request.page ?? 0) - (right.request.page ?? 0)
    )
    .flatMap((item) => {
      if (!Array.isArray(item.body)) {
        throw new Error(
          `C6 review trajectory REST group is not an array ${anchorId}`,
        );
      }
      return item.body;
    });
}

function isDescendant(
  commits: readonly CommitRecord[],
  descendant: string,
  ancestor: string,
): boolean {
  return findAncestryPath(commits, descendant, ancestor) !== null;
}

function isLinearReviewSequence(
  commits: readonly CommitRecord[],
  sequence: TrajectorySequence,
): boolean {
  const byOid = new Map(commits.map((commit) => [commit.oid, commit]));
  const firstReviewed = byOid.get(sequence.firstReview.reviewedCommit);
  const secondReviewed = byOid.get(sequence.secondReview.reviewedCommit);
  return firstReviewed !== undefined &&
    secondReviewed !== undefined &&
    timestamp(firstReviewed.committedAt) <=
      timestamp(sequence.firstReview.createdAt) &&
    timestamp(secondReviewed.committedAt) <=
      timestamp(sequence.secondReview.createdAt) &&
    isDescendant(
      commits,
      sequence.firstFix.oid,
      sequence.firstReview.reviewedCommit,
    ) &&
    isDescendant(
      commits,
      sequence.secondReview.reviewedCommit,
      sequence.firstFix.oid,
    ) &&
    isDescendant(
      commits,
      sequence.secondFix.oid,
      sequence.secondReview.reviewedCommit,
    ) &&
    isDescendant(
      commits,
      sequence.secondFix.oid,
      sequence.firstFix.oid,
    );
}

function buildAncestryEvidence(
  commits: readonly CommitRecord[],
  sequence: TrajectorySequence,
): {
  edges: Array<{
    ancestor: string;
    descendant: string;
    kind:
      | "first-fix-descends-first-reviewed-commit"
      | "second-fix-descends-first-fix"
      | "second-fix-descends-second-reviewed-commit";
    path: string[];
  }>;
  sequence: SequenceOutput;
} | null {
  const definitions = [{
    ancestor: sequence.firstReview.reviewedCommit,
    descendant: sequence.firstFix.oid,
    kind: "first-fix-descends-first-reviewed-commit" as const,
  }, {
    ancestor: sequence.secondReview.reviewedCommit,
    descendant: sequence.secondFix.oid,
    kind: "second-fix-descends-second-reviewed-commit" as const,
  }, {
    ancestor: sequence.firstFix.oid,
    descendant: sequence.secondFix.oid,
    kind: "second-fix-descends-first-fix" as const,
  }];
  const edges = definitions.map((definition) => ({
    ...definition,
    path: findAncestryPath(
      commits,
      definition.descendant,
      definition.ancestor,
    ),
  }));
  if (edges.some((edge) => edge.path === null)) {
    return null;
  }
  return {
    edges: edges.map((edge) => ({
      ...edge,
      path: edge.path!,
    })),
    sequence: sequenceOutput(sequence),
  };
}

function buildLinearReviewAncestryEvidence(
  commits: readonly CommitRecord[],
  sequence: TrajectorySequence,
): {
  edges: Array<{
    ancestor: string;
    descendant: string;
    kind:
      | "first-fix-descends-first-reviewed-commit"
      | "second-fix-descends-first-fix"
      | "second-fix-descends-second-reviewed-commit"
      | "second-reviewed-commit-descends-first-fix";
    path: string[];
  }>;
  reviewedCommitTiming: {
    first: {
      committedAt: string;
      oid: string;
      reviewCreatedAt: string;
    };
    second: {
      committedAt: string;
      oid: string;
      reviewCreatedAt: string;
    };
    status: "reviewed-commits-not-after-review-events";
  };
  sequence: SequenceOutput;
} | null {
  const byOid = new Map(commits.map((commit) => [commit.oid, commit]));
  const firstReviewed = byOid.get(sequence.firstReview.reviewedCommit);
  const secondReviewed = byOid.get(sequence.secondReview.reviewedCommit);
  if (
    firstReviewed === undefined ||
    secondReviewed === undefined ||
    timestamp(firstReviewed.committedAt) >
      timestamp(sequence.firstReview.createdAt) ||
    timestamp(secondReviewed.committedAt) >
      timestamp(sequence.secondReview.createdAt)
  ) {
    return null;
  }
  const definitions = [{
    ancestor: sequence.firstReview.reviewedCommit,
    descendant: sequence.firstFix.oid,
    kind: "first-fix-descends-first-reviewed-commit" as const,
  }, {
    ancestor: sequence.firstFix.oid,
    descendant: sequence.secondReview.reviewedCommit,
    kind: "second-reviewed-commit-descends-first-fix" as const,
  }, {
    ancestor: sequence.secondReview.reviewedCommit,
    descendant: sequence.secondFix.oid,
    kind: "second-fix-descends-second-reviewed-commit" as const,
  }, {
    ancestor: sequence.firstFix.oid,
    descendant: sequence.secondFix.oid,
    kind: "second-fix-descends-first-fix" as const,
  }];
  const edges = definitions.map((definition) => ({
    ...definition,
    path: findAncestryPath(
      commits,
      definition.descendant,
      definition.ancestor,
    ),
  }));
  if (edges.some((edge) => edge.path === null)) {
    return null;
  }
  return {
    edges: edges.map((edge) => ({
      ...edge,
      path: edge.path!,
    })),
    reviewedCommitTiming: {
      first: {
        committedAt: firstReviewed.committedAt,
        oid: firstReviewed.oid,
        reviewCreatedAt: sequence.firstReview.createdAt,
      },
      second: {
        committedAt: secondReviewed.committedAt,
        oid: secondReviewed.oid,
        reviewCreatedAt: sequence.secondReview.createdAt,
      },
      status: "reviewed-commits-not-after-review-events",
    },
    sequence: sequenceOutput(sequence),
  };
}

function findAncestryPath(
  commits: readonly CommitRecord[],
  descendant: string,
  ancestor: string,
): string[] | null {
  const byOid = new Map(commits.map((commit) => [commit.oid, commit]));
  const pending = [[descendant]];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const path = pending.pop()!;
    const current = path[path.length - 1]!;
    if (current === ancestor) {
      return path;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (
      const parent of [...(byOid.get(current)?.parents ?? [])].reverse()
    ) {
      pending.push([...path, parent]);
    }
  }
  return null;
}

function validateRestRequestIdentity(
  request: z.infer<typeof restRequestSchema>,
  manifest: z.infer<typeof restManifestSchema>,
  repositoryId: number,
  anchorId: string,
): void {
  const target = expectedRestTarget(request, manifest, anchorId);
  const expectedRawPath = target.singleton
    ? target.rawPathRoot
    : `${target.rawPathRoot}/page-${
      String(request.page).padStart(4, "0")
    }.json`;
  if (request.response.rawBody.path !== expectedRawPath) {
    throw new Error(
      `C6 review trajectory REST response path mismatch ${anchorId}`,
    );
  }
  validateRestUrl(
    request.request.url,
    target.endpointPath,
    target.singleton ? null : request.page,
    repositoryId,
    anchorId,
  );
}

function expectedRestTarget(
  request: z.infer<typeof restRequestSchema>,
  manifest: z.infer<typeof restManifestSchema>,
  anchorId: string,
): {
  endpointPath: string;
  rawPathRoot: string;
  singleton: boolean;
} {
  const repositoryRoot =
    `/repos/${manifest.input.owner}/${manifest.input.repository}`;
  const pullNumber = manifest.input.pullNumber;
  const issues = new Set(manifest.input.resolvedIssueNumbers);
  if (
    request.endpoint === "pull" &&
    request.issueNumber === null &&
    request.page === null
  ) {
    return {
      endpointPath: `${repositoryRoot}/pulls/${pullNumber}`,
      rawPathRoot: "responses/pull.json",
      singleton: true,
    };
  }
  if (
    request.endpoint === "issue" &&
    request.issueNumber !== null &&
    issues.has(request.issueNumber) &&
    request.page === null
  ) {
    return {
      endpointPath: `${repositoryRoot}/issues/${request.issueNumber}`,
      rawPathRoot: `responses/issues/${request.issueNumber}/issue.json`,
      singleton: true,
    };
  }
  if (request.page === null) {
    throw new Error(
      `C6 review trajectory REST request shape mismatch ${anchorId}`,
    );
  }
  if (
    request.endpoint === "review-comments" &&
    request.issueNumber === null
  ) {
    return {
      endpointPath: `${repositoryRoot}/pulls/${pullNumber}/comments`,
      rawPathRoot: "responses/review-comments",
      singleton: false,
    };
  }
  if (request.endpoint === "reviews" && request.issueNumber === null) {
    return {
      endpointPath: `${repositoryRoot}/pulls/${pullNumber}/reviews`,
      rawPathRoot: "responses/reviews",
      singleton: false,
    };
  }
  if (request.endpoint === "commits" && request.issueNumber === null) {
    return {
      endpointPath: `${repositoryRoot}/pulls/${pullNumber}/commits`,
      rawPathRoot: "responses/commits",
      singleton: false,
    };
  }
  if (
    request.endpoint === "pull-discussion-comments" &&
    request.issueNumber === pullNumber
  ) {
    return {
      endpointPath: `${repositoryRoot}/issues/${pullNumber}/comments`,
      rawPathRoot: "responses/pull-discussion-comments",
      singleton: false,
    };
  }
  if (
    request.endpoint === "issue-comments" &&
    request.issueNumber !== null &&
    issues.has(request.issueNumber)
  ) {
    return {
      endpointPath: `${repositoryRoot}/issues/${request.issueNumber}/comments`,
      rawPathRoot: `responses/issues/${request.issueNumber}/comments`,
      singleton: false,
    };
  }
  throw new Error(
    `C6 review trajectory REST request target mismatch ${anchorId}`,
  );
}

function validateRestGroup(
  group: Array<{
    body: unknown;
    request: z.infer<typeof restRequestSchema>;
  }>,
  manifest: z.infer<typeof restManifestSchema>,
  repositoryId: number,
  anchorId: string,
): void {
  if (group[0]!.request.page === null) {
    if (
      group.length !== 1 ||
      group[0]!.request.response.headers.link !== null
    ) {
      throwRestLinkError(anchorId);
    }
    return;
  }
  const ordered = [...group].sort(
    (left, right) => left.request.page! - right.request.page!,
  );
  for (let index = 0; index < ordered.length; index += 1) {
    const item = ordered[index]!;
    if (
      item.request.page !== index + 1 ||
      !Array.isArray(item.body) ||
      item.body.length > REST_PAGE_SIZE ||
      (index < ordered.length - 1 && item.body.length !== REST_PAGE_SIZE)
    ) {
      throw new Error(
        `C6 review trajectory REST pagination mismatch ${anchorId}`,
      );
    }
    const links = parseRestLinks(
      item.request.response.headers.link,
      anchorId,
    );
    if (
      (links.get("next") ?? null) !==
        (ordered[index + 1]?.request.request.url ?? null)
    ) {
      throwRestLinkError(anchorId);
    }
    const target = expectedRestTarget(item.request, manifest, anchorId);
    for (const [relation, url] of links) {
      const expectedPage = relation === "next"
        ? index + 2
        : relation === "prev"
        ? index
        : relation === "first"
        ? 1
        : ordered.length;
      if (expectedPage < 1 || expectedPage > ordered.length) {
        throwRestLinkError(anchorId);
      }
      validateRestUrl(
        url,
        target.endpointPath,
        expectedPage,
        repositoryId,
        anchorId,
      );
    }
  }
}

function validateRestUrl(
  value: string,
  endpointPath: string,
  page: number | null,
  repositoryId: number,
  anchorId: string,
): void {
  const url = new URL(value);
  const repositoryPrefix = /^\/repos\/[^/]+\/[^/]+/u.exec(endpointPath)?.[0];
  const canonicalPath = repositoryPrefix === undefined
    ? ""
    : `/repositories/${repositoryId}${
      endpointPath.slice(repositoryPrefix.length)
    }`;
  const keys = [...url.searchParams.keys()];
  const validQuery = page === null
    ? keys.length === 0
    : (
      keys.length === 2 &&
      new Set(keys).size === 2 &&
      url.searchParams.get("per_page") === String(REST_PAGE_SIZE) &&
      url.searchParams.get("page") === String(page)
    );
  if (
    url.protocol !== "https:" ||
    url.host !== "api.github.com" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    (
      url.pathname !== endpointPath &&
      (page === null || url.pathname !== canonicalPath)
    ) ||
    !validQuery
  ) {
    throw new Error(
      `C6 review trajectory REST URL mismatch ${anchorId}`,
    );
  }
}

function parseRestLinks(
  value: string | null,
  anchorId: string,
): Map<"first" | "last" | "next" | "prev", string> {
  const links = new Map<"first" | "last" | "next" | "prev", string>();
  if (value === null) {
    return links;
  }
  for (const segment of value.split(",")) {
    const match = /^\s*<([^<>]+)>\s*;\s*rel="(first|last|next|prev)"\s*$/u
      .exec(segment);
    if (match === null) {
      throwRestLinkError(anchorId);
    }
    const relation = match[2] as "first" | "last" | "next" | "prev";
    if (links.has(relation)) {
      throwRestLinkError(anchorId);
    }
    links.set(relation, match[1]!);
  }
  return links;
}

function throwRestLinkError(anchorId: string): never {
  throw new Error(
    `C6 review trajectory REST Link closure mismatch ${anchorId}`,
  );
}

function restGroupKey(
  request: z.infer<typeof restRequestSchema>,
): string {
  return `${request.endpoint}:${request.issueNumber ?? "none"}`;
}

async function parseSourceFile(
  absolutePath: string,
  relativePath: string,
): Promise<{
  file: FileReference;
  gitBlobOid: string;
  records: SourceRecord[];
}> {
  const before = await lstat(absolutePath);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(
      `C6 review trajectory rejects non-file ${relativePath}`,
    );
  }
  const handle = await open(
    absolutePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const opened = await handle.stat();
    const contentHash = createHash("sha256");
    const blobHash = createHash("sha1").update(
      `blob ${opened.size}\0`,
    );
    const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let containsCarriageReturn = false;
    let lastByte = -1;
    const verifier = new Transform({
      transform(chunk, _encoding, callback) {
        try {
          const buffer = Buffer.from(chunk);
          bytes += buffer.byteLength;
          contentHash.update(buffer);
          blobHash.update(buffer);
          utf8Decoder.decode(buffer, { stream: true });
          containsCarriageReturn ||= buffer.includes(13);
          if (buffer.byteLength > 0) {
            lastByte = buffer[buffer.byteLength - 1]!;
          }
          callback(null, buffer);
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      },
    });
    const lines = createInterface({
      crlfDelay: Infinity,
      input: handle.createReadStream({
        autoClose: false,
        start: 0,
      }).pipe(verifier),
    });
    const records: SourceRecord[] = [];
    let rowIndex = 0;
    for await (const line of lines) {
      rowIndex += 1;
      const row = sourceRowSchema.parse(JSON.parse(line) as unknown);
      const anchorKey = normalizeRepository(row.org, row.repo) +
        `#${row.number}`;
      records.push({
        anchorId: `${row.org}/${row.repo}#${row.number}`,
        anchorKey,
        directory: `${row.org}__${row.repo}__${row.number}`,
        issueNumbers: row.resolved_issues.map((issue) => issue.number),
        number: row.number,
        org: row.org,
        repo: row.repo,
        source: {
          path: relativePath,
          rowIndex,
          rowSha256: sha256(`${line}\n`),
        },
        testSignals: {
          f2pCount: recordSize(row.f2p_tests),
          p2pCount: recordSize(row.p2p_tests),
        },
      });
    }
    utf8Decoder.decode();
    const after = await handle.stat();
    if (
      bytes !== opened.size ||
      bytes === 0 ||
      lastByte !== 10 ||
      containsCarriageReturn ||
      !sameFile(before, opened, after)
    ) {
      throw new Error(
        `C6 review trajectory source changed or is not LF JSONL ${
          relativePath
        }`,
      );
    }
    return {
      file: {
        bytes,
        mode: after.mode & 0o777,
        path: relativePath,
        sha256: contentHash.digest("hex"),
      },
      gitBlobOid: blobHash.digest("hex"),
      records,
    };
  } finally {
    await handle.close();
  }
}

function recordSize(value: unknown): number {
  return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    )
    ? Object.keys(value).length
    : 0;
}

function assertGraphqlStructure(
  lock: C6AssetLock,
  sourceRecords: readonly SourceRecord[],
): void {
  const expectedPaths = sourceRecords.flatMap((source) =>
    GRAPHQL_FILES.map((name) => `${source.directory}/${name}`)
  ).sort((left, right) => left.localeCompare(right));
  if (
    JSON.stringify(lock.files.map((file) => file.path)) !==
      JSON.stringify(expectedPaths)
  ) {
    throw new Error(
      "C6 review trajectory GraphQL structure does not match source anchors",
    );
  }
}

function fileMap(lock: C6AssetLock): Map<string, FileReference> {
  return new Map(lock.files.map((file) => [file.path, file]));
}

async function readBoundFile(
  directory: string,
  relativePath: string,
  rootDirectory: string,
  initialFiles: ReadonlyMap<string, FileReference>,
  label: string,
): Promise<Buffer> {
  const bytes = await readC6StableRegularFile(
    join(directory, relativePath),
    `review trajectory ${label} artifact`,
  );
  const path = `${rootDirectory}/${relativePath}`;
  const initial = initialFiles.get(path);
  if (
    initial === undefined ||
    initial.bytes !== bytes.byteLength ||
    initial.sha256 !== sha256(bytes)
  ) {
    throw new Error(
      `C6 review trajectory ${label} artifact changed from closure ${path}`,
    );
  }
  return bytes;
}

function assertArtifactReference(
  reference: z.infer<typeof artifactReferenceSchema>,
  expectedPath: string,
  bytes: Buffer,
  label: string,
  anchorId: string,
): void {
  if (
    reference.path !== expectedPath ||
    reference.bytes !== bytes.byteLength ||
    reference.sha256 !== sha256(bytes)
  ) {
    throw new Error(
      `C6 review trajectory ${label} artifact reference mismatch ${
        anchorId
      }`,
    );
  }
}

async function assertTerminalAssetLock(
  root: string,
  initial: C6AssetLock,
  label: string,
): Promise<void> {
  const terminal = await buildC6AssetLock(root);
  if (JSON.stringify(terminal) !== JSON.stringify(initial)) {
    throw new Error(
      `C6 review trajectory ${label} closure changed during analysis`,
    );
  }
}

async function assertTerminalInputPaths(input: {
  graphqlRoot: string;
  restRoot: string;
  sourceRoot: string;
  targetsPath: string;
  treeReceiptPath: string;
}): Promise<void> {
  await Promise.all([
    assertC6NoSymlinkPathComponents(
      input.sourceRoot,
      "C6 review trajectory terminal source root",
    ),
    assertC6NoSymlinkPathComponents(
      input.graphqlRoot,
      "C6 review trajectory terminal GraphQL root",
    ),
    assertC6NoSymlinkPathComponents(
      input.restRoot,
      "C6 review trajectory terminal REST root",
    ),
    assertC6NoSymlinkPathComponents(
      input.targetsPath,
      "C6 review trajectory terminal target receipt",
    ),
    assertC6NoSymlinkPathComponents(
      input.treeReceiptPath,
      "C6 review trajectory terminal tree receipt",
    ),
  ]);
}

async function assertTerminalSourceClosure(
  root: string,
  initialFiles: readonly FileReference[],
): Promise<void> {
  const terminalPaths = await walkFiles(root);
  if (
    JSON.stringify(terminalPaths) !==
      JSON.stringify(initialFiles.map((file) => file.path))
  ) {
    throw new Error(
      "C6 review trajectory source structure changed during analysis",
    );
  }
  const terminalFiles: FileReference[] = [];
  for (const file of initialFiles) {
    terminalFiles.push(await hashFile(join(root, file.path), file.path));
  }
  if (
    closureSha256(terminalFiles) !== closureSha256(initialFiles) ||
    JSON.stringify(terminalFiles) !== JSON.stringify(initialFiles)
  ) {
    throw new Error(
      "C6 review trajectory source closure changed during analysis",
    );
  }
}

async function hashFile(
  absolutePath: string,
  relativePath: string,
): Promise<FileReference> {
  const before = await lstat(absolutePath);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(
      `C6 review trajectory rejects non-file ${relativePath}`,
    );
  }
  const handle = await open(
    absolutePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const opened = await handle.stat();
    const hash = createHash("sha256");
    let bytes = 0;
    for await (
      const chunk of handle.createReadStream({
        autoClose: false,
        start: 0,
      })
    ) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.byteLength;
      hash.update(buffer);
    }
    const after = await handle.stat();
    if (
      bytes !== opened.size ||
      !sameFile(before, opened, after)
    ) {
      throw new Error(
        `C6 review trajectory file changed while hashing ${relativePath}`,
      );
    }
    return {
      bytes,
      mode: after.mode & 0o777,
      path: relativePath,
      sha256: hash.digest("hex"),
    };
  } finally {
    await handle.close();
  }
}

function closureSha256(files: readonly FileReference[]): string {
  return sha256(JSON.stringify(
    [...files].sort((left, right) =>
      left.path.localeCompare(right.path)
    ),
  ));
}

async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  await walkDirectory(root, root, files);
  return files.sort(compareStrings);
}

async function walkDirectory(
  root: string,
  directory: string,
  files: string[],
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `C6 review trajectory rejects symlink ${path}`,
      );
    }
    if (entry.isDirectory()) {
      await walkDirectory(root, path, files);
    } else if (entry.isFile()) {
      files.push(relative(root, path).split(sep).join("/"));
    } else {
      throw new Error(
        `C6 review trajectory rejects non-file ${path}`,
      );
    }
  }
}

async function readRootDirectories(root: string): Promise<string[]> {
  const directories: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(
        `C6 review trajectory rejects root entry ${entry.name}`,
      );
    }
    directories.push(entry.name);
  }
  return directories.sort(compareStrings);
}

async function readRelativeStructure(root: string): Promise<{
  directories: string[];
  files: string[];
}> {
  const directories: string[] = [];
  const files: string[] = [];
  await walkStructure(root, root, directories, files);
  return {
    directories: directories.sort(compareStrings),
    files: files.sort(compareStrings),
  };
}

async function walkStructure(
  root: string,
  directory: string,
  directories: string[],
  files: string[],
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    const relativePath = relative(root, absolutePath).split(sep).join("/");
    if (entry.isSymbolicLink()) {
      throw new Error(
        `C6 review trajectory rejects nested symlink ${relativePath}`,
      );
    }
    if (entry.isDirectory()) {
      directories.push(relativePath);
      await walkStructure(root, absolutePath, directories, files);
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(
        `C6 review trajectory rejects nested entry ${relativePath}`,
      );
    }
  }
}

function buildExpectedStructure(files: ReadonlySet<string>): {
  directories: string[];
  files: string[];
} {
  const directories = new Set<string>();
  for (const path of files) {
    const components = path.split("/");
    for (let index = 1; index < components.length; index += 1) {
      directories.add(components.slice(0, index).join("/"));
    }
  }
  return {
    directories: [...directories].sort(compareStrings),
    files: [...files].sort(compareStrings),
  };
}

function collectPaginationGaps(
  value: unknown,
  path: string,
): Array<{ endCursor: string | null; path: string }> {
  const gaps: Array<{ endCursor: string | null; path: string }> = [];
  visitPagination(value, path, gaps);
  return gaps.sort((left, right) => compareStrings(left.path, right.path));
}

function visitPagination(
  value: unknown,
  path: string,
  gaps: Array<{ endCursor: string | null; path: string }>,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      visitPagination(item, `${path}[${index}]`, gaps)
    );
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  for (const [name, child] of Object.entries(value)) {
    const childPath = path.length === 0 ? name : `${path}.${name}`;
    if (name === "pageInfo") {
      const pageInfo = pageInfoSchema.parse(child);
      if (pageInfo.hasNextPage) {
        gaps.push({
          endCursor: pageInfo.endCursor,
          path: childPath,
        });
      }
    }
    visitPagination(child, childPath, gaps);
  }
}

function normalizeRepository(org: string, repo: string): string {
  const repository = `${org}/${repo}`.toLowerCase();
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/u.test(repository)) {
    throw new Error(
      `C6 review trajectory invalid repository ${org}/${repo}`,
    );
  }
  return repository;
}

function normalizeRepositoryName(value: string): string {
  const components = value.split("/");
  if (components.length !== 2) {
    throw new Error(
      `C6 review trajectory invalid repository ${value}`,
    );
  }
  return normalizeRepository(components[0]!, components[1]!);
}

function normalizeGitHubUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.host !== "github.com" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      `C6 review trajectory invalid GitHub URL ${value}`,
    );
  }
  return `https://github.com${url.pathname.toLowerCase()}`;
}

function assertSafeRelativePath(path: string): void {
  const components = path.split("/");
  if (
    path.includes("\\") ||
    components.some((component) =>
      component.length === 0 || component === "." || component === ".."
    )
  ) {
    throw new Error(
      `C6 review trajectory rejects unsafe path ${path}`,
    );
  }
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new Error(`C6 review trajectory invalid ${label}`);
  }
}

function sameFile(
  before: Awaited<ReturnType<typeof lstat>>,
  opened: Awaited<ReturnType<Awaited<ReturnType<typeof open>>["stat"]>>,
  after: Awaited<ReturnType<Awaited<ReturnType<typeof open>>["stat"]>>,
): boolean {
  return before.dev === opened.dev &&
    before.ino === opened.ino &&
    before.mode === opened.mode &&
    before.mtimeMs === opened.mtimeMs &&
    before.size === opened.size &&
    opened.dev === after.dev &&
    opened.ino === after.ino &&
    opened.mode === after.mode &&
    opened.mtimeMs === after.mtimeMs &&
    opened.size === after.size;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
