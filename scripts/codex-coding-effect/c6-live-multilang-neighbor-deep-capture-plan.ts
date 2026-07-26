import { createHash, randomUUID } from "node:crypto";
import { link, lstat, open, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
} from "./c6-asset-lock";
import type {
  C6LiveMultiLangNeighborCommitCountEligibilityQualification,
} from "./c6-live-multilang-neighbor-commit-count-eligibility-qualification";
import {
  parseC6LiveMultiLangNeighborCommitCountEligibilityQualification,
} from "./c6-live-multilang-neighbor-commit-count-eligibility-qualification";
import {
  serializeC6StructuralReviewEventPolicy,
} from "./c6-review-event-policy";

const ARTIFACT_KIND =
  "c6-live-multilang-neighbor-deep-capture-plan";
const QUALIFICATION_KIND =
  "c6-live-multilang-neighbor-census-qualification";
const COMMIT_COUNT_QUALIFICATION_KIND =
  "c6-live-multilang-neighbor-commit-count-eligibility-qualification";
const DATASET_ID = "SWE-bench-Live/MultiLang";
const SOURCE_REVISION =
  "608f7ae9ab8ea1f9f0d030fe04562cf6bd1a0c8b";
const GRAPHQL_ENDPOINT = "https://api.github.com/graphql";
const PAGE_SIZE = 100;
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
const FORBIDDEN_QUALIFICATION_KEY_TOKENS = new Set([
  "checks",
  "diff",
  "evaluator",
  "gold",
  "hidden",
  "outcome",
  "patch",
  "test",
  "tests",
]);
const FORBIDDEN_QUALIFICATION_KEY_COMPOUNDS = [
  "expectedchanged",
  "machinedecision",
  "semanticdecision",
];
const ALLOWED_FALSE_INDEPENDENCE_BOUNDARY_KEYS = new Set([
  "goldInput",
  "machineOutcomeInput",
  "patchInput",
  "priorTrancheOutcomeInput",
  "semanticDecisionInput",
  "testInput",
]);

export const C6_LIVE_MULTILANG_NEIGHBOR_DEEP_INITIAL_QUERY =
  `query C6NeighborDeepInitial($owner: String!, $name: String!, $number: Int!) {
  rateLimit {
    cost
    remaining
    resetAt
  }
  repository(owner: $owner, name: $name) {
    id
    nameWithOwner
    pullRequest(number: $number) {
      id
      number
      url
      author {
        login
      }
      createdAt
      mergedAt
      baseRefOid
      mergeCommit {
        oid
      }
      baseRepository {
        id
        nameWithOwner
      }
      commits(first: 100) {
        totalCount
        nodes {
          commit {
            id
            oid
            committedDate
            parents(first: 100) {
              totalCount
              nodes {
                oid
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
      reviews(first: 100) {
        totalCount
        nodes {
          id
          author {
            login
          }
          body
          commit {
            oid
          }
          state
          submittedAt
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
      reviewThreads(first: 100) {
        totalCount
        nodes {
          id
          comments(first: 100) {
            totalCount
            nodes {
              id
              author {
                login
              }
              body
              createdAt
              originalCommit {
                oid
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}`;

export const C6_LIVE_MULTILANG_NEIGHBOR_COMMITS_PAGE_QUERY =
  `query C6NeighborDeepCommitsPage($owner: String!, $name: String!, $number: Int!, $after: String!) {
  rateLimit {
    cost
    remaining
    resetAt
  }
  repository(owner: $owner, name: $name) {
    id
    nameWithOwner
    pullRequest(number: $number) {
      id
      number
      url
      commits(first: 100, after: $after) {
        totalCount
        nodes {
          commit {
            id
            oid
            committedDate
            parents(first: 100) {
              totalCount
              nodes {
                oid
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}`;

export const C6_LIVE_MULTILANG_NEIGHBOR_REVIEWS_PAGE_QUERY =
  `query C6NeighborDeepReviewsPage($owner: String!, $name: String!, $number: Int!, $after: String!) {
  rateLimit {
    cost
    remaining
    resetAt
  }
  repository(owner: $owner, name: $name) {
    id
    nameWithOwner
    pullRequest(number: $number) {
      id
      number
      url
      reviews(first: 100, after: $after) {
        totalCount
        nodes {
          id
          author {
            login
          }
          body
          commit {
            oid
          }
          state
          submittedAt
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}`;

export const C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREADS_PAGE_QUERY =
  `query C6NeighborDeepReviewThreadsPage($owner: String!, $name: String!, $number: Int!, $after: String!) {
  rateLimit {
    cost
    remaining
    resetAt
  }
  repository(owner: $owner, name: $name) {
    id
    nameWithOwner
    pullRequest(number: $number) {
      id
      number
      url
      reviewThreads(first: 100, after: $after) {
        totalCount
        nodes {
          id
          comments(first: 100) {
            totalCount
            nodes {
              id
              author {
                login
              }
              body
              createdAt
              originalCommit {
                oid
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}`;

export const C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREAD_COMMENTS_PAGE_QUERY =
  `query C6NeighborDeepReviewThreadCommentsPage($owner: String!, $name: String!, $number: Int!, $threadId: ID!, $after: String!) {
  rateLimit {
    cost
    remaining
    resetAt
  }
  repository(owner: $owner, name: $name) {
    id
    nameWithOwner
    pullRequest(number: $number) {
      id
      number
      url
    }
  }
  node(id: $threadId) {
    __typename
    ... on PullRequestReviewThread {
      id
      comments(first: 100, after: $after) {
        totalCount
        nodes {
          id
          author {
            login
          }
          body
          createdAt
          originalCommit {
            oid
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}`;

export const C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_PARENTS_PAGE_QUERY =
  `query C6NeighborDeepCommitParentsPage($owner: String!, $name: String!, $number: Int!, $commitId: ID!, $after: String!) {
  rateLimit {
    cost
    remaining
    resetAt
  }
  repository(owner: $owner, name: $name) {
    id
    nameWithOwner
    pullRequest(number: $number) {
      id
      number
      url
    }
  }
  node(id: $commitId) {
    __typename
    ... on Commit {
      id
      oid
      parents(first: 100, after: $after) {
        totalCount
        nodes {
          oid
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}`;

export const C6_LIVE_MULTILANG_NEIGHBOR_DEEP_CAPTURE_QUERY_POLICY = {
  allowedBodyPaths: [
    "repository.pullRequest.reviews.nodes.body",
    "repository.pullRequest.reviewThreads.nodes.comments.nodes.body",
    "node.PullRequestReviewThread.comments.nodes.body",
  ],
  endpoint: GRAPHQL_ENDPOINT,
  forbiddenQueryPaths: [
    "repository.pullRequest.title",
    "repository.pullRequest.titleHTML",
    "repository.pullRequest.body",
    "repository.pullRequest.bodyHTML",
    "repository.pullRequest.bodyText",
    "repository.pullRequest.comments",
    "repository.pullRequest.closingIssuesReferences",
    "repository.pullRequest.files",
    "repository.pullRequest.commits.nodes.commit.message",
    "repository.pullRequest.commits.nodes.commit.messageBody",
    "repository.pullRequest.commits.nodes.commit.messageHeadline",
    "issue.title",
    "issue.titleHTML",
    "issue.body",
    "issue.bodyHTML",
    "issue.bodyText",
    "issue.comments",
    "diff",
    "patch",
    "test",
    "gold",
    "checks",
    "outcome",
  ],
  pagination: {
    closureRequiredBeforeStructuralQualification: true,
    pageSize: PAGE_SIZE,
    supplementFamilies: [
      "commits",
      "reviews",
      "reviewThreads",
      "reviewThreads.comments",
      "commits.parents",
    ],
    supplementScheduling:
      "only-from-hasNextPage-with-prior-non-null-endCursor",
  },
  policyId: "c6-live-multilang-neighbor-deep-capture-query-v1",
  schemaVersion: 1,
  targetSelectionUsesReviewBodies: false,
} as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const repositorySchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
);
const anchorSchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9]\d*$/u,
);
const sourceSplitSchema = z.enum(SOURCE_SPLITS);
const referenceSchema = z.object({
  bytes: z.number().int().positive(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const observationReferenceSchema = z.object({
  captureDirectory: z.string().min(1),
  pilotRank: z.number().int().positive(),
  responseNodeRank: z.number().int().positive(),
  sourceSplit: sourceSplitSchema,
}).strict();
const qualificationResultSchema = z.object({
  authorLogin: z.string().min(1).nullable(),
  baseRefOid: commitSchema,
  canonicalAnchorId: anchorSchema,
  canonicalRepository: repositorySchema,
  commentCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  deepCaptureOrder: z.number().int().positive().optional(),
  mergeCommitOid: commitSchema,
  mergedAt: z.iso.datetime(),
  observationRefs: z.array(observationReferenceSchema).min(1),
  pilotRank: z.number().int().positive(),
  responseNodeRank: z.number().int().positive(),
  reviewCount: z.number().int().nonnegative(),
  reviewThreadCount: z.number().int().nonnegative(),
  sourceSplit: sourceSplitSchema,
  status: z.enum([
    "existing-source-anchor",
    "novel-no-review-surface",
    "novel-review-surface-deep-capture-target",
  ]),
  url: z.url(),
}).strict();
const qualificationBreakdownSchema = z.object({
  deepCaptureTargetCount: z.number().int().nonnegative(),
  existingAnchorOverlapCount: z.number().int().nonnegative(),
  novelCanonicalPullCount: z.number().int().nonnegative(),
  rawObservationCount: z.number().int().nonnegative(),
  uniqueCanonicalPullCount: z.number().int().nonnegative(),
}).strict();
const qualificationSchemaV2 = z.object({
  artifactKind: z.literal(QUALIFICATION_KIND),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    actorCaptureExecuted: z.literal(false),
    actorQualifiedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    canonicalPullDeduplicationComplete: z.literal(true),
    codexRunReady: z.literal(false),
    deepCaptureExecuted: z.literal(false),
    existingAnchorExclusionComplete: z.literal(true),
    machineQualifiedEpisodeCount: z.literal(0),
    populationRepresentativenessProven: z.literal(false),
    semanticallyQualifiedEpisodeCount: z.literal(0),
    status: z.literal(
      "novel-review-surface-pretargets-deep-capture-required",
    ),
  }).strict(),
  counts: z.object({
    capturedRepositoryCount: z.number().int().positive(),
    deepCaptureTargetCount: z.number().int().positive(),
    duplicateObservationCount: z.number().int().nonnegative(),
    existingAnchorOverlapCount: z.number().int().nonnegative(),
    novelCanonicalPullCount: z.number().int().positive(),
    novelWithReviewSurfaceCount: z.number().int().positive(),
    novelWithoutReviewSurfaceCount:
      z.number().int().nonnegative(),
    rawObservationCount: z.number().int().positive(),
    sourceCanonicalAnchorCount: z.literal(743),
    truncatedRepositoryCount: z.number().int().nonnegative(),
    uniqueCanonicalPullCount: z.number().int().positive(),
  }).strict(),
  independenceBoundary: z.object({
    canonicalPullProjectionSha256: sha256Schema,
    deepCaptureTargetProjectionSha256: sha256Schema,
    excludedAnchorProjectionSha256: sha256Schema,
    existingAnchorProjectionSha256: sha256Schema,
    goldInput: z.literal(false),
    machineOutcomeInput: z.literal(false),
    metadataQuerySha256: sha256Schema,
    patchInput: z.literal(false),
    postMergeStructuralMetadataInput: z.literal(true),
    qualificationPolicySha256: sha256Schema,
    semanticDecisionInput: z.literal(false),
    testInput: z.literal(false),
  }).strict(),
  inputs: z.object({
    actorFrame: referenceSchema,
    actorFrameCandidateProjectionSha256: sha256Schema,
    neighborCompletion: referenceSchema,
    neighborPlan: referenceSchema,
    neighborRootSha256: sha256Schema,
    sourceCapturePlan: referenceSchema,
    sourceGraphqlRootSha256: sha256Schema,
    sourcePool: referenceSchema,
  }).strict(),
  repositoryCounts: z.array(z.object({
    canonicalRepository: repositorySchema,
    ...qualificationBreakdownSchema.shape,
  }).strict()).min(1),
  results: z.array(qualificationResultSchema).min(1),
  rule: z.object({
    canonicalIdentity: z.literal(
      "lowercase-resolved-repository-plus-pull-number",
    ),
    classification: z.literal(
      "reviewCount-positive-or-reviewThreadCount-positive",
    ),
    deduplication: z.literal(
      "canonicalize-then-group-before-existing-anchor-exclusion",
    ),
    existingAnchorExclusion: z.literal(
      "exclude-all-743-reconstructed-canonical-source-anchors",
    ),
    forbiddenSelectionInputs: z.tuple([
      z.literal("body"),
      z.literal("diff"),
      z.literal("files"),
      z.literal("gold"),
      z.literal("machineDecision"),
      z.literal("outcome"),
      z.literal("patch"),
      z.literal("semanticDecision"),
      z.literal("test"),
    ]),
    noRepositoryCapOrResampling: z.literal(true),
    resultOrder: z.literal(
      "pilotRank-then-responseNodeRank",
    ),
    schemaVersion: z.literal(1),
  }).strict(),
  sampleBoundary: z.object({
    adaptiveRepositoryExclusion: z.literal(true),
    mergedPullRequestsOnly: z.literal(true),
    newestPerRepositoryCap: z.literal(16),
    postMergeStructuralMetadataInput: z.literal(true),
    repositorySampleRandom: z.literal(false),
    reviewSurfaceEnrichmentApplied: z.literal(true),
  }).strict(),
  schemaVersion: z.literal(2),
  sourceDataset: z.object({
    datasetId: z.literal(DATASET_ID),
    revision: z.literal(SOURCE_REVISION),
  }).strict(),
  splitCounts: z.object({
    c: qualificationBreakdownSchema,
    cpp: qualificationBreakdownSchema,
    go: qualificationBreakdownSchema,
    js: qualificationBreakdownSchema,
    rust: qualificationBreakdownSchema,
    java: qualificationBreakdownSchema,
    ts: qualificationBreakdownSchema,
    cs: qualificationBreakdownSchema,
  }).strict(),
}).strict();
const priorNeighborPlanReferenceSchema = referenceSchema.extend({
  artifactKind: z.literal(
    "c6-live-multilang-neighbor-census-plan",
  ),
  schemaVersion: z.literal(1),
  selectedRepositoryProjectionSha256: sha256Schema,
}).strict();
const qualificationSchemaV3 = qualificationSchemaV2.extend({
  independenceBoundary:
    qualificationSchemaV2.shape.independenceBoundary.extend({
      priorTrancheOutcomeInput: z.literal(false),
    }).strict(),
  inputs: qualificationSchemaV2.shape.inputs.extend({
    priorNeighborPlan: priorNeighborPlanReferenceSchema,
  }).strict(),
  sampleBoundary:
    qualificationSchemaV2.shape.sampleBoundary.extend({
      censusTranche: z.literal(2),
    }).strict(),
  schemaVersion: z.literal(3),
}).strict();
const qualificationSchema = z.discriminatedUnion(
  "schemaVersion",
  [qualificationSchemaV2, qualificationSchemaV3],
);
const legacyQualificationReferenceSchema = referenceSchema.extend({
  artifactKind: z.literal(QUALIFICATION_KIND),
  deepCaptureTargetProjectionSha256: sha256Schema,
  schemaVersion: z.union([
    z.literal(2),
    z.literal(3),
  ]),
}).strict();
const commitCountQualificationReferenceSchema =
  referenceSchema.extend({
    artifactKind: z.literal(COMMIT_COUNT_QUALIFICATION_KIND),
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
const targetSchema = z.object({
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
  owner: z.string().min(1),
  pilotRank: z.number().int().positive(),
  pullNumber: z.number().int().positive(),
  repo: z.string().min(1),
  responseNodeRank: z.number().int().positive(),
  sourceSplit: sourceSplitSchema,
  url: z.url(),
}).strict();
const queryDescriptorSchema = z.object({
  operationName: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const planSchema = z.object({
  artifactKind: z.literal(ARTIFACT_KIND),
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
    status: z.literal(
      "neighbor-review-surface-deep-capture-plan-only",
    ),
  }).strict(),
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
    endpoint: z.literal(GRAPHQL_ENDPOINT),
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
  rule: z.custom<
    typeof C6_LIVE_MULTILANG_NEIGHBOR_DEEP_CAPTURE_QUERY_POLICY
  >((value) =>
    JSON.stringify(value) === JSON.stringify(
      C6_LIVE_MULTILANG_NEIGHBOR_DEEP_CAPTURE_QUERY_POLICY,
    )
  ),
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
    datasetId: z.literal(DATASET_ID),
    revision: z.literal(SOURCE_REVISION),
  }).strict(),
  targets: z.array(targetSchema).min(1),
}).strict();

export type C6LiveMultiLangNeighborDeepCapturePlan = z.infer<
  typeof planSchema
>;

assertQueryFieldBoundary();

export function deriveC6LiveMultiLangNeighborDeepCapturePlan(input: {
  expectedTargetCount: number;
  qualificationBytes: Uint8Array;
  qualificationPath: string;
}): C6LiveMultiLangNeighborDeepCapturePlan {
  const expectedTargetCount = z.number().int().positive().parse(
    input.expectedTargetCount,
  );
  const qualificationBytes = Buffer.from(input.qualificationBytes);
  const rawQualification = canonicalJson(
    qualificationBytes,
    "neighbor qualification",
  );
  assertNoForbiddenQualificationInputs(rawQualification);
  const isCommitCountQualification =
    typeof rawQualification === "object" &&
    rawQualification !== null &&
    "artifactKind" in rawQualification &&
    rawQualification.artifactKind ===
      COMMIT_COUNT_QUALIFICATION_KIND;
  let qualificationArtifactKind:
    | typeof COMMIT_COUNT_QUALIFICATION_KIND
    | typeof QUALIFICATION_KIND;
  let qualificationSchemaVersion: 1 | 2 | 3;
  let qualificationSampleBoundary: {
    adaptiveRepositoryExclusion: true;
    mergedPullRequestsOnly: true;
    newestPerRepositoryCap: 16;
    postMergeStructuralMetadataInput: true;
    repositorySampleRandom: false;
    reviewSurfaceEnrichmentApplied: true;
  };
  let qualificationSourceDataset: {
    datasetId: typeof DATASET_ID;
    revision: typeof SOURCE_REVISION;
  };
  let deepPlanTargetProjectionSha256: string | undefined;
  let deepTargetProjectionSha256: string;
  let targets: Array<z.infer<typeof targetSchema>>;

  if (isCommitCountQualification) {
    const qualification =
      parseC6LiveMultiLangNeighborCommitCountEligibilityQualification(
        qualificationBytes,
      );
    targets = targetsFromCommitCountQualification(
      qualification,
      expectedTargetCount,
    );
    deepTargetProjectionSha256 =
      qualification.independenceBoundary
        .deepCaptureTargetProjectionSha256;
    deepPlanTargetProjectionSha256 =
      qualification.independenceBoundary
        .deepPlanTargetProjectionSha256;
    if (
      sha256(JSON.stringify(
        qualification.results
          .filter((result) =>
            result.decision === "eligible-for-deep-capture"
          )
          .map(commitCountDeepTargetProjection),
      )) !== deepTargetProjectionSha256 ||
      sha256(JSON.stringify(targets)) !==
        deepPlanTargetProjectionSha256
    ) {
      throw new Error(
        "C6 neighbor deep-capture plan commit-count projection mismatch",
      );
    }
    qualificationArtifactKind = qualification.artifactKind;
    qualificationSchemaVersion = qualification.schemaVersion;
    qualificationSampleBoundary = qualification.sampleBoundary;
    qualificationSourceDataset = qualification.sourceDataset;
  } else {
    const qualification = qualificationSchema.parse(
      rawQualification,
    );
    const deepTargets = qualification.results.filter(
      (result) =>
        result.status ===
          "novel-review-surface-deep-capture-target",
    );
    if (
      qualification.counts.deepCaptureTargetCount !==
        expectedTargetCount ||
      qualification.counts.novelWithReviewSurfaceCount !==
        expectedTargetCount ||
      deepTargets.length !== expectedTargetCount
    ) {
      throw new Error(
        `C6 neighbor deep-capture plan requires exactly ${
          expectedTargetCount
        } deep-capture targets`,
      );
    }
    deepTargetProjectionSha256 = sha256(JSON.stringify(
      deepTargets.map(deepTargetProjection),
    ));
    if (
      deepTargetProjectionSha256 !==
        qualification.independenceBoundary
          .deepCaptureTargetProjectionSha256
    ) {
      throw new Error(
        "C6 neighbor deep-capture plan deep-target projection mismatch",
      );
    }
    targets = targetsFromLegacyQualification(deepTargets);
    qualificationArtifactKind = qualification.artifactKind;
    qualificationSchemaVersion = qualification.schemaVersion;
    qualificationSampleBoundary = qualification.sampleBoundary;
    qualificationSourceDataset = qualification.sourceDataset;
  }

  const capturePolicySha256 = sha256(
    serializeC6LiveMultiLangNeighborDeepCaptureQueryPolicy(),
  );
  const plan = {
    artifactKind: ARTIFACT_KIND,
    boundary: {
      acceptedEpisodeCount: 0,
      actorCaptureExecuted: false,
      actorQualifiedEpisodeCount: 0,
      candidateManifestFrozen: false,
      captureCompletenessProven: false,
      codexRunReady: false,
      deepCaptureExecuted: false,
      machineQualifiedEpisodeCount: 0,
      semanticallyQualifiedEpisodeCount: 0,
      status:
        "neighbor-review-surface-deep-capture-plan-only",
    },
    counts: {
      expectedRequestLowerBound: targets.length,
      repositoryCount: new Set(
        targets.map((target) => target.canonicalRepository),
      ).size,
      targetCount: targets.length,
    },
    independenceBoundary: {
      goldInput: false,
      machineOutcomeInput: false,
      patchInput: false,
      qualificationDeepTargetProjectionSha256:
        deepTargetProjectionSha256,
      semanticDecisionInput: false,
      targetProjectionSha256: sha256(JSON.stringify(targets)),
      testInput: false,
    },
    inputs: {
      qualification: isCommitCountQualification
        ? {
          ...reference(qualificationBytes, input.qualificationPath),
          artifactKind: qualificationArtifactKind,
          deepCaptureTargetProjectionSha256:
            deepTargetProjectionSha256,
          deepPlanTargetProjectionSha256:
            deepPlanTargetProjectionSha256!,
          schemaVersion: qualificationSchemaVersion,
        }
        : {
          ...reference(qualificationBytes, input.qualificationPath),
          artifactKind: qualificationArtifactKind,
          deepCaptureTargetProjectionSha256:
            deepTargetProjectionSha256,
          schemaVersion: qualificationSchemaVersion,
        },
    },
    queryContract: {
      capturePolicySha256,
      endpoint: GRAPHQL_ENDPOINT,
      initial: queryDescriptor(
        "C6NeighborDeepInitial",
        C6_LIVE_MULTILANG_NEIGHBOR_DEEP_INITIAL_QUERY,
      ),
      structuralReviewPolicySha256: sha256(
        serializeC6StructuralReviewEventPolicy(),
      ),
      supplements: {
        commitParents: queryDescriptor(
          "C6NeighborDeepCommitParentsPage",
          C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_PARENTS_PAGE_QUERY,
        ),
        commits: queryDescriptor(
          "C6NeighborDeepCommitsPage",
          C6_LIVE_MULTILANG_NEIGHBOR_COMMITS_PAGE_QUERY,
        ),
        reviewThreadComments: queryDescriptor(
          "C6NeighborDeepReviewThreadCommentsPage",
          C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREAD_COMMENTS_PAGE_QUERY,
        ),
        reviewThreads: queryDescriptor(
          "C6NeighborDeepReviewThreadsPage",
          C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREADS_PAGE_QUERY,
        ),
        reviews: queryDescriptor(
          "C6NeighborDeepReviewsPage",
          C6_LIVE_MULTILANG_NEIGHBOR_REVIEWS_PAGE_QUERY,
        ),
      },
    },
    requestBoundary: {
      initialRequestPerTarget: 1,
      paginationSupplementRequestCountKnown: false,
      surfaceCompletenessClaimed: false,
    },
    rule: C6_LIVE_MULTILANG_NEIGHBOR_DEEP_CAPTURE_QUERY_POLICY,
    sampleBoundary: {
      adaptiveRepositoryExclusion:
        qualificationSampleBoundary.adaptiveRepositoryExclusion,
      mergedPullRequestsOnly:
        qualificationSampleBoundary.mergedPullRequestsOnly,
      newestPerRepositoryCap:
        qualificationSampleBoundary.newestPerRepositoryCap,
      postMergeStructuralMetadataInput:
        qualificationSampleBoundary.postMergeStructuralMetadataInput,
      populationRepresentativenessProven: false,
      repositorySampleRandom:
        qualificationSampleBoundary.repositorySampleRandom,
      reviewSurfaceEnrichmentApplied:
        qualificationSampleBoundary.reviewSurfaceEnrichmentApplied,
      reviewSurfacePretargetSelectionOnly: true,
    },
    schemaVersion: 1,
    sourceDataset: qualificationSourceDataset,
    targets,
  };
  return planSchema.parse(plan);
}

export async function buildC6LiveMultiLangNeighborDeepCapturePlan(
  input: {
    expectedDeepCaptureTargetProjectionSha256: string;
    expectedQualificationSha256: string;
    expectedTargetCount: number;
    qualificationPath: string;
    testHooks?: {
      afterOutputPublication?: () => Promise<void> | void;
      beforeTerminalVerification?: () => Promise<void> | void;
    };
  },
): Promise<{
  outputSha256: string;
  plan: C6LiveMultiLangNeighborDeepCapturePlan;
}> {
  const expectedQualificationSha256 = sha256Schema.parse(
    input.expectedQualificationSha256,
  );
  const expectedDeepCaptureTargetProjectionSha256 =
    sha256Schema.parse(
      input.expectedDeepCaptureTargetProjectionSha256,
    );
  const expectedTargetCount = z.number().int().positive().parse(
    input.expectedTargetCount,
  );
  const qualificationPath = await assertC6NoSymlinkPathComponents(
    input.qualificationPath,
    "C6 neighbor deep-capture qualification",
  );
  const qualificationBytes = await readC6StableRegularFile(
    qualificationPath,
    "neighbor deep-capture qualification",
  );
  if (sha256(qualificationBytes) !== expectedQualificationSha256) {
    throw new Error(
      "C6 neighbor deep-capture qualification hash mismatch",
    );
  }
  const plan = deriveC6LiveMultiLangNeighborDeepCapturePlan({
    expectedTargetCount,
    qualificationBytes,
    qualificationPath,
  });
  if (
    plan.inputs.qualification
      .deepCaptureTargetProjectionSha256 !==
        expectedDeepCaptureTargetProjectionSha256
  ) {
    throw new Error(
      "C6 neighbor deep-capture expected projection mismatch",
    );
  }

  await input.testHooks?.beforeTerminalVerification?.();
  const terminalQualificationBytes =
    await readC6StableRegularFile(
      qualificationPath,
      "neighbor deep-capture terminal qualification",
    );
  if (!terminalQualificationBytes.equals(qualificationBytes)) {
    throw new Error(
      "C6 neighbor deep-capture qualification changed during projection",
    );
  }
  const serialized =
    serializeC6LiveMultiLangNeighborDeepCapturePlan(plan);
  return {
    outputSha256: sha256(serialized),
    plan,
  };
}

export async function materializeC6LiveMultiLangNeighborDeepCapturePlan(
  input: Parameters<
    typeof buildC6LiveMultiLangNeighborDeepCapturePlan
  >[0] & {
    outputPath: string;
  },
): Promise<{
  outputSha256: string;
  plan: C6LiveMultiLangNeighborDeepCapturePlan;
}> {
  const result =
    await buildC6LiveMultiLangNeighborDeepCapturePlan(input);
  const serialized =
    serializeC6LiveMultiLangNeighborDeepCapturePlan(
      result.plan,
    );
  const outputPath = resolve(input.outputPath);
  const outputParent = await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 neighbor deep-capture plan output parent",
  );
  const temporaryPath = join(
    outputParent,
    `.${basename(outputPath)}.incomplete-${randomUUID()}`,
  );
  let ownedIdentity:
    | { device: number; inode: number }
    | undefined;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      const openedStat = await handle.stat();
      ownedIdentity = {
        device: openedStat.dev,
        inode: openedStat.ino,
      };
      await handle.writeFile(serialized, "utf8");
      await handle.chmod(0o644);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (!ownedIdentity) {
      throw new Error(
        "C6 neighbor deep-capture temporary plan identity missing",
      );
    }
    const temporaryBytes = await readC6StableRegularFile(
      temporaryPath,
      "C6 neighbor deep-capture temporary plan",
    );
    if (temporaryBytes.toString("utf8") !== serialized) {
      throw new Error(
        "C6 neighbor deep-capture temporary plan mismatch",
      );
    }
    await assertC6NoSymlinkPathComponents(
      outputParent,
      "C6 neighbor deep-capture terminal output parent",
    );
    await link(temporaryPath, outputPath);

    await input.testHooks?.afterOutputPublication?.();
    const revalidated =
      await buildC6LiveMultiLangNeighborDeepCapturePlan({
        ...input,
        testHooks: undefined,
      });
    const revalidatedBytes =
      serializeC6LiveMultiLangNeighborDeepCapturePlan(
        revalidated.plan,
      );
    if (
      revalidated.outputSha256 !== result.outputSha256 ||
      revalidatedBytes !== serialized
    ) {
      throw new Error(
        "C6 neighbor deep-capture post-publication replay mismatch",
      );
    }
    const publishedBytes = await readC6StableRegularFile(
      outputPath,
      "C6 neighbor deep-capture published plan",
    );
    if (publishedBytes.toString("utf8") !== serialized) {
      throw new Error(
        "C6 neighbor deep-capture published plan mismatch",
      );
    }
    const [publishedStat, temporaryStat] = await Promise.all([
      lstat(outputPath),
      lstat(temporaryPath),
    ]);
    if (
      publishedStat.isSymbolicLink() ||
      !publishedStat.isFile() ||
      (publishedStat.mode & 0o777) !== 0o644 ||
      temporaryStat.isSymbolicLink() ||
      !temporaryStat.isFile() ||
      publishedStat.dev !== ownedIdentity.device ||
      publishedStat.ino !== ownedIdentity.inode ||
      temporaryStat.dev !== ownedIdentity.device ||
      temporaryStat.ino !== ownedIdentity.inode
    ) {
      throw new Error(
        "C6 neighbor deep-capture published plan identity or mode mismatch",
      );
    }
    await rm(temporaryPath);
  } catch (error) {
    if (ownedIdentity) {
      await Promise.all([
        removePathIfOwned(outputPath, ownedIdentity),
        removePathIfOwned(temporaryPath, ownedIdentity),
      ]);
    }
    throw error;
  }
  return result;
}

async function removePathIfOwned(
  path: string,
  ownedIdentity: { device: number; inode: number },
): Promise<void> {
  try {
    const stat = await lstat(path);
    if (
      !stat.isSymbolicLink() &&
      stat.isFile() &&
      stat.dev === ownedIdentity.device &&
      stat.ino === ownedIdentity.inode
    ) {
      await rm(path);
    }
  } catch (error) {
    if (!isErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code;
}

export function serializeC6LiveMultiLangNeighborDeepCapturePlan(
  plan: C6LiveMultiLangNeighborDeepCapturePlan,
): string {
  return `${JSON.stringify(planSchema.parse(plan), null, 2)}\n`;
}

export function serializeC6LiveMultiLangNeighborDeepCaptureQueryPolicy():
  string {
  return `${
    JSON.stringify(
      C6_LIVE_MULTILANG_NEIGHBOR_DEEP_CAPTURE_QUERY_POLICY,
      null,
      2,
    )
  }\n`;
}

function targetsFromCommitCountQualification(
  qualification:
    C6LiveMultiLangNeighborCommitCountEligibilityQualification,
  expectedTargetCount: number,
): Array<z.infer<typeof targetSchema>> {
  const eligible = qualification.results.filter(
    (result) =>
      result.decision === "eligible-for-deep-capture",
  );
  if (
    expectedTargetCount !== 642 ||
    qualification.counts.sourceTargetCount !== 643 ||
    qualification.counts.resultCount !== 643 ||
    qualification.counts.eligibleTargetCount !==
      expectedTargetCount ||
    qualification.counts.deepCaptureTargetCount !==
      expectedTargetCount ||
    qualification.counts.excludedTargetCount !== 1 ||
    qualification.counts.replacementCount !== 0 ||
    qualification.counts.resampledTargetCount !== 0 ||
    eligible.length !== expectedTargetCount
  ) {
    throw new Error(
      "C6 neighbor deep-capture plan requires canonical 642/1 commit-count qualification",
    );
  }
  const seenAnchors = new Set<string>();
  const seenDirectories = new Set<string>();
  return eligible.map((result, index) => {
    const captureOrder = index + 1;
    if (
      result.deepCaptureOrder !== captureOrder ||
      seenAnchors.has(result.sourceTarget.canonicalAnchorId) ||
      seenDirectories.has(result.sourceTarget.captureDirectory)
    ) {
      throw new Error(
        "C6 neighbor deep-capture commit-count stable filter mismatch",
      );
    }
    seenAnchors.add(result.sourceTarget.canonicalAnchorId);
    seenDirectories.add(result.sourceTarget.captureDirectory);
    return targetSchema.parse({
      ...result.sourceTarget,
      captureOrder,
    });
  });
}

function targetsFromLegacyQualification(
  deepTargets: Array<z.infer<typeof qualificationResultSchema>>,
): Array<z.infer<typeof targetSchema>> {
  const seenAnchors = new Set<string>();
  const seenDirectories = new Set<string>();
  return deepTargets.map((result, index) => {
    const captureOrder = index + 1;
    if (result.deepCaptureOrder !== captureOrder) {
      throw new Error(
        "C6 neighbor deep-capture order must be contiguous",
      );
    }
    const { pullNumber, repository } = parseAnchor(
      result.canonicalAnchorId,
    );
    if (
      repository !== result.canonicalRepository ||
      repository !== repository.toLowerCase()
    ) {
      throw new Error(
        `C6 neighbor deep-capture canonical identity mismatch ${
          result.canonicalAnchorId
        }`,
      );
    }
    const [owner, repo] = repository.split("/");
    const captureDirectory = `${owner}__${repo}__${pullNumber}`;
    if (
      seenAnchors.has(result.canonicalAnchorId) ||
      seenDirectories.has(captureDirectory)
    ) {
      throw new Error(
        `C6 neighbor deep-capture target collision ${
          result.canonicalAnchorId
        }`,
      );
    }
    if (result.reviewCount === 0 && result.reviewThreadCount === 0) {
      throw new Error(
        `C6 neighbor deep-capture target lacks review surface ${
          result.canonicalAnchorId
        }`,
      );
    }
    assertGitHubPullUrl(
      result.url,
      repository,
      pullNumber,
    );
    seenAnchors.add(result.canonicalAnchorId);
    seenDirectories.add(captureDirectory);
    return {
      authorLogin: result.authorLogin,
      baseRefOid: result.baseRefOid,
      canonicalAnchorId: result.canonicalAnchorId,
      canonicalRepository: repository,
      captureDirectory,
      captureOrder,
      createdAt: result.createdAt,
      mergeCommitOid: result.mergeCommitOid,
      mergedAt: result.mergedAt,
      observedReviewCount: result.reviewCount,
      observedReviewThreadCount: result.reviewThreadCount,
      owner: owner!,
      pilotRank: result.pilotRank,
      pullNumber,
      repo: repo!,
      responseNodeRank: result.responseNodeRank,
      sourceSplit: result.sourceSplit,
      url: result.url,
    };
  });
}

function commitCountDeepTargetProjection(
  result:
    C6LiveMultiLangNeighborCommitCountEligibilityQualification[
      "results"
    ][number],
): unknown {
  return {
    canonicalAnchorId: result.sourceTarget.canonicalAnchorId,
    canonicalRepository: result.sourceTarget.canonicalRepository,
    deepCaptureOrder: result.deepCaptureOrder,
    pilotRank: result.sourceTarget.pilotRank,
    responseNodeRank: result.sourceTarget.responseNodeRank,
    sourceSplit: result.sourceTarget.sourceSplit,
  };
}

function deepTargetProjection(
  result: z.infer<typeof qualificationResultSchema>,
): unknown {
  return {
    canonicalAnchorId: result.canonicalAnchorId,
    canonicalRepository: result.canonicalRepository,
    deepCaptureOrder: result.deepCaptureOrder,
    pilotRank: result.pilotRank,
    responseNodeRank: result.responseNodeRank,
    sourceSplit: result.sourceSplit,
  };
}

function queryDescriptor(
  operationName: string,
  query: string,
): {
  operationName: string;
  sha256: string;
} {
  return {
    operationName,
    sha256: sha256(query),
  };
}

function assertQueryFieldBoundary(): void {
  const queries = [
    {
      bodyCount: 2,
      commentConnectionCount: 1,
      query: C6_LIVE_MULTILANG_NEIGHBOR_DEEP_INITIAL_QUERY,
    },
    {
      bodyCount: 0,
      commentConnectionCount: 0,
      query: C6_LIVE_MULTILANG_NEIGHBOR_COMMITS_PAGE_QUERY,
    },
    {
      bodyCount: 1,
      commentConnectionCount: 0,
      query: C6_LIVE_MULTILANG_NEIGHBOR_REVIEWS_PAGE_QUERY,
    },
    {
      bodyCount: 1,
      commentConnectionCount: 1,
      query: C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREADS_PAGE_QUERY,
    },
    {
      bodyCount: 1,
      commentConnectionCount: 1,
      query:
        C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREAD_COMMENTS_PAGE_QUERY,
    },
    {
      bodyCount: 0,
      commentConnectionCount: 0,
      query: C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_PARENTS_PAGE_QUERY,
    },
  ];
  const forbiddenFields = [
    "title",
    "titleHTML",
    "closingIssuesReferences",
    "issue",
    "issues",
    "files",
    "diff",
    "patch",
    "test",
    "gold",
    "checks",
    "checkSuites",
    "checkRuns",
    "outcome",
    "message",
    "messageHeadline",
    "messageBody",
    "bodyHTML",
    "bodyText",
  ];
  for (const entry of queries) {
    for (const field of forbiddenFields) {
      if (new RegExp(`\\b${field}\\b`, "iu").test(entry.query)) {
        throw new Error(
          `C6 neighbor deep-capture query includes forbidden field ${field}`,
        );
      }
    }
    if (
      countLines(entry.query, "body") !== entry.bodyCount ||
      countLines(entry.query, "comments(") !==
        entry.commentConnectionCount
    ) {
      throw new Error(
        "C6 neighbor deep-capture query body boundary mismatch",
      );
    }
  }
}

function countLines(query: string, prefix: string): number {
  return query.split("\n").filter(
    (line) => {
      const field = line.trim();
      return prefix.endsWith("(")
        ? field.startsWith(prefix)
        : field === prefix;
    },
  ).length;
}

function assertGitHubPullUrl(
  value: string,
  repository: string,
  pullNumber: number,
): void {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "github.com" ||
    url.port.length > 0 ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    url.pathname.toLowerCase() !==
      `/${repository}/pull/${pullNumber}`
  ) {
    throw new Error(
      `C6 neighbor deep-capture invalid pull URL ${value}`,
    );
  }
}

function parseAnchor(value: string): {
  pullNumber: number;
  repository: string;
} {
  const parsed = anchorSchema.parse(value);
  const separator = parsed.lastIndexOf("#");
  return {
    pullNumber: Number(parsed.slice(separator + 1)),
    repository: parsed.slice(0, separator),
  };
}

function reference(
  bytes: Uint8Array,
  path: string,
): z.infer<typeof referenceSchema> {
  return {
    bytes: bytes.byteLength,
    path: basename(resolve(path)),
    sha256: sha256(bytes),
  };
}

function canonicalJson(
  bytes: Uint8Array,
  label: string,
): unknown {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(
      `C6 neighbor deep-capture invalid ${label} JSON`,
    );
  }
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

function assertNoForbiddenQualificationInputs(
  value: unknown,
  path = "$",
): void {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      assertNoForbiddenQualificationInputs(
        entry,
        `${path}[${index}]`,
      );
    }
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const allowedFalseBoundaryDeclaration =
      path === "$.independenceBoundary" &&
      ALLOWED_FALSE_INDEPENDENCE_BOUNDARY_KEYS.has(key) &&
      entry === false;
    if (
      !allowedFalseBoundaryDeclaration &&
      isForbiddenQualificationKey(key)
    ) {
      throw new Error(
        `C6 neighbor deep-capture forbidden qualification input ${path}.${key}`,
      );
    }
    assertNoForbiddenQualificationInputs(
      entry,
      `${path}.${key}`,
    );
  }
}

function isForbiddenQualificationKey(key: string): boolean {
  const segments = key.split(/[^A-Za-z0-9]+/u).filter(
    (segment) => segment.length > 0,
  );
  const normalized = segments.join("").toLowerCase();
  if (
    ["evaluator", "gold", "hidden", "outcome"].some(
      (marker) => normalized.includes(marker),
    ) ||
    normalized === "patch" ||
    normalized.startsWith("patch") ||
    normalized.endsWith("patch") ||
    normalized.includes("goldpatch") ||
    normalized === "test" ||
    normalized.startsWith("test") ||
    normalized.endsWith("tests") ||
    normalized === "files" ||
    normalized.includes("changedfiles") ||
    normalized === "check" ||
    normalized === "checks" ||
    normalized.includes("checkruns") ||
    normalized.includes("checksuites") ||
    FORBIDDEN_QUALIFICATION_KEY_COMPOUNDS.some(
      (compound) => normalized.includes(compound),
    )
  ) {
    return true;
  }
  const tokens = segments.flatMap((segment) => {
    const camelCaseTokens = segment
      .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
      .split(" ")
      .map((token) => token.toLowerCase());
    return [segment.toLowerCase(), ...camelCaseTokens];
  });
  return tokens.some((token) =>
    FORBIDDEN_QUALIFICATION_KEY_TOKENS.has(token)
  );
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
