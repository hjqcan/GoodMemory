import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  open,
  readdir,
  rm,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { z } from "zod";

import type { C6AssetLock } from "./c6-asset-lock";
import {
  assertC6NoSymlinkPathComponents,
  loadC6AssetLock,
  readC6StableRegularFile,
  serializeC6AssetLock,
} from "./c6-asset-lock";
import {
  C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
  C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY_POLICY,
  C6_LIVE_MULTILANG_NEIGHBOR_PLATFORM_COMMIT_CAP,
  parseC6LiveMultiLangNeighborCommitCountEligibilityPlan,
} from "./c6-live-multilang-neighbor-commit-count-eligibility-plan";

const ARTIFACT_KIND =
  "c6-live-multilang-neighbor-commit-count-eligibility-qualification";
const CAPTURE_COMPLETION_KIND =
  "c6-live-multilang-neighbor-commit-count-eligibility-completion";
const CAPTURE_TARGET_KIND =
  "c6-live-multilang-neighbor-commit-count-eligibility-target-capture";
const CENSUS_QUALIFICATION_KIND =
  "c6-live-multilang-neighbor-census-qualification";
const DEEP_PLAN_KIND =
  "c6-live-multilang-neighbor-deep-capture-plan";
const ELIGIBILITY_PLAN_KIND =
  "c6-live-multilang-neighbor-commit-count-eligibility-plan";
const ENDPOINT = "https://api.github.com/graphql";
const SOURCE_TARGET_COUNT = 643;
const ELIGIBLE_TARGET_COUNT = 642;
const EXCLUDED_TARGET_COUNT = 1;
const DIRECTORY_MODE = 0o700;
const CAPTURE_FILE_MODE = 0o600;
const OUTPUT_FILE_MODE = 0o644;
const DATASET_ID = "SWE-bench-Live/MultiLang";
const SOURCE_REVISION =
  "608f7ae9ab8ea1f9f0d030fe04562cf6bd1a0c8b";
const TRANSPORT_CONTRACT =
  C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY_POLICY
    .transportContract;
const MAXIMUM_NETWORK_ATTEMPTS =
  TRANSPORT_CONTRACT.maximumNetworkAttemptsPerTarget;
const MAXIMUM_RETRY_AFTER_MILLISECONDS =
  TRANSPORT_CONTRACT.maximumRetryAfterMilliseconds;
const RETRYABLE_HTTP_STATUSES = new Set<number>(
  TRANSPORT_CONTRACT.retryableHttpStatuses,
);
const TRANSIENT_GRAPHQL_TYPES = new Set<string>(
  TRANSPORT_CONTRACT.transientGraphqlTypes,
);
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
const SELECTED_RESPONSE_HEADERS = new Set([
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

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const repositorySchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
);
const anchorSchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9]\d*$/u,
);
const sourceSplitSchema = z.enum(SOURCE_SPLITS);
const artifactReferenceSchema = z.object({
  bytes: z.number().int().nonnegative(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const nonemptyArtifactReferenceSchema = artifactReferenceSchema.extend({
  bytes: z.number().int().positive(),
}).strict();
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
  owner: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
  pilotRank: z.number().int().positive(),
  pullNumber: z.number().int().positive(),
  repo: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
  responseNodeRank: z.number().int().positive(),
  sourceSplit: sourceSplitSchema,
  url: z.url(),
}).strict();
const sampleBoundarySchema = z.object({
  adaptiveRepositoryExclusion: z.literal(true),
  mergedPullRequestsOnly: z.literal(true),
  newestPerRepositoryCap: z.literal(16),
  postMergeStructuralMetadataInput: z.literal(true),
  populationRepresentativenessProven: z.literal(false).optional(),
  repositorySampleRandom: z.literal(false),
  reviewSurfaceEnrichmentApplied: z.literal(true),
  reviewSurfacePretargetSelectionOnly: z.literal(true).optional(),
}).strict();
const sourceDatasetSchema = z.object({
  datasetId: z.literal(DATASET_ID),
  revision: z.literal(SOURCE_REVISION),
}).strict();
const censusReferenceSchema = nonemptyArtifactReferenceSchema.extend({
  artifactKind: z.literal(CENSUS_QUALIFICATION_KIND),
  deepCaptureTargetProjectionSha256: sha256Schema,
  schemaVersion: z.literal(3),
}).strict();
const deepPlanSchema = z.object({
  artifactKind: z.literal(DEEP_PLAN_KIND),
  boundary: z.unknown(),
  counts: z.object({
    expectedRequestLowerBound: z.literal(SOURCE_TARGET_COUNT),
    repositoryCount: z.number().int().positive(),
    targetCount: z.literal(SOURCE_TARGET_COUNT),
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
    qualification: censusReferenceSchema,
  }).strict(),
  queryContract: z.unknown(),
  requestBoundary: z.unknown(),
  rule: z.unknown(),
  sampleBoundary: sampleBoundarySchema,
  schemaVersion: z.literal(1),
  sourceDataset: sourceDatasetSchema,
  targets: z.array(targetSchema).length(SOURCE_TARGET_COUNT),
}).strict();
const observationReferenceSchema = z.object({
  captureDirectory: z.string().min(1),
  pilotRank: z.number().int().positive(),
  responseNodeRank: z.number().int().positive(),
  sourceSplit: sourceSplitSchema,
}).strict();
const censusResultSchema = z.object({
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
const censusQualificationSchema = z.object({
  artifactKind: z.literal(CENSUS_QUALIFICATION_KIND),
  boundary: z.unknown(),
  counts: z.object({
    capturedRepositoryCount: z.number().int().positive(),
    deepCaptureTargetCount: z.literal(SOURCE_TARGET_COUNT),
    duplicateObservationCount: z.number().int().nonnegative(),
    existingAnchorOverlapCount: z.number().int().nonnegative(),
    novelCanonicalPullCount: z.number().int().positive(),
    novelWithReviewSurfaceCount: z.literal(SOURCE_TARGET_COUNT),
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
    priorTrancheOutcomeInput: z.literal(false),
    qualificationPolicySha256: sha256Schema,
    semanticDecisionInput: z.literal(false),
    testInput: z.literal(false),
  }).strict(),
  inputs: z.unknown(),
  repositoryCounts: z.unknown(),
  results: z.array(censusResultSchema).min(SOURCE_TARGET_COUNT),
  rule: z.unknown(),
  sampleBoundary: z.object({
    adaptiveRepositoryExclusion: z.literal(true),
    censusTranche: z.literal(2),
    mergedPullRequestsOnly: z.literal(true),
    newestPerRepositoryCap: z.literal(16),
    postMergeStructuralMetadataInput: z.literal(true),
    repositorySampleRandom: z.literal(false),
    reviewSurfaceEnrichmentApplied: z.literal(true),
  }).strict(),
  schemaVersion: z.literal(3),
  sourceDataset: sourceDatasetSchema,
  splitCounts: z.unknown(),
}).strict();
const registrationBoundarySchema = z.object({
  exploratoryAllTargetCountDiagnosticObserved: z.literal(true),
  frozenBeforeCanonicalCapture: z.literal(true),
  initialPlanV2TransportFailureObserved: z.literal(true),
  preregisteredBeforeExploratoryDiagnostic: z.literal(false),
}).strict();
const rateLimitSchema = z.object({
  cost: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  resetAt: z.iso.datetime(),
}).strict();
const graphqlSuccessSchema = z.object({
  data: z.object({
    rateLimit: rateLimitSchema,
    repository: z.object({
      id: z.string().min(1),
      nameWithOwner: repositorySchema,
      pullRequest: z.object({
        commits: z.object({
          totalCount: z.number().int().nonnegative(),
        }).strict(),
        id: z.string().min(1),
        number: z.number().int().positive(),
        url: z.url(),
      }).strict(),
    }).strict(),
  }).strict(),
}).strict();
const requestReceiptSchema = z.object({
  attempt: z.number().int().positive(),
  endpoint: z.literal(ENDPOINT),
  headers: z.object({
    accept: z.literal("application/vnd.github+json"),
    authorization: z.literal("Bearer [REDACTED]"),
    "content-type": z.literal("application/json"),
    "user-agent": z.literal(
      "GoodMemory-C6-Commit-Count-Eligibility/1",
    ),
    "x-github-api-version": z.literal("2022-11-28"),
  }).strict(),
  method: z.literal("POST"),
  operationName: z.literal("C6NeighborCommitCountEligibility"),
  query: z.literal(
    C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
  ),
  querySha256: sha256Schema,
  variables: z.object({
    name: z.string().min(1),
    number: z.number().int().positive(),
    owner: z.string().min(1),
  }).strict(),
}).strict();
const responseReferenceSchema = artifactReferenceSchema.extend({
  httpStatus: z.number().int().min(100).max(599),
}).strict();
const transportErrorReferenceSchema = artifactReferenceSchema.extend({
  phase: z.enum(["body-read", "fetch", "timeout"]),
}).strict();
const attemptSchema = z.object({
  attempt: z.number().int().positive(),
  request: artifactReferenceSchema,
  response: responseReferenceSchema.optional(),
  responseHeaders: artifactReferenceSchema,
  retryAfterMilliseconds: z.number().int().nonnegative().optional(),
  transportError: transportErrorReferenceSchema.optional(),
}).strict();
const targetCaptureSchema = z.object({
  artifactKind: z.literal(CAPTURE_TARGET_KIND),
  attempts: z.array(attemptSchema).min(1),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    status: z.literal("commit-count-only"),
  }).strict(),
  observation: z.object({
    commitCount: z.number().int().nonnegative(),
    platformCommitCap: z.literal(
      C6_LIVE_MULTILANG_NEIGHBOR_PLATFORM_COMMIT_CAP,
    ),
    pullRequestId: z.string().min(1),
    rateLimit: rateLimitSchema,
    repositoryId: z.string().min(1),
    status: z.enum([
      "within-platform-cap",
      "exceeds-platform-cap",
    ]),
  }).strict(),
  planTarget: targetSchema,
  querySha256: sha256Schema,
  schemaVersion: z.literal(1),
}).strict();
const completionCaptureSchema = z.object({
  canonicalAnchorId: anchorSchema,
  captureDirectory: z.string().min(1),
  captureManifest: artifactReferenceSchema,
  commitCount: z.number().int().nonnegative(),
  status: z.enum([
    "within-platform-cap",
    "exceeds-platform-cap",
  ]),
}).strict();
const captureCompletionSchema = z.object({
  artifactKind: z.literal(CAPTURE_COMPLETION_KIND),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    commitCountCaptureExecuted: z.literal(true),
    machineQualifiedEpisodeCount: z.literal(0),
    semanticallyQualifiedEpisodeCount: z.literal(0),
    status: z.literal(
      "commit-count-eligibility-capture-complete-only",
    ),
  }).strict(),
  captures: z.array(completionCaptureSchema).length(
    SOURCE_TARGET_COUNT,
  ),
  counts: z.object({
    capturedTargetCount: z.literal(SOURCE_TARGET_COUNT),
    eligibleTargetCount: z.literal(ELIGIBLE_TARGET_COUNT),
    excludedTargetCount: z.literal(EXCLUDED_TARGET_COUNT),
    logicalRequestCount: z.literal(SOURCE_TARGET_COUNT),
    networkRequestCount: z.number().int().min(SOURCE_TARGET_COUNT),
    plannedTargetCount: z.literal(SOURCE_TARGET_COUNT),
  }).strict(),
  independenceBoundary: z.object({
    commitCountProjectionSha256: sha256Schema,
    goldInput: z.literal(false),
    machineOutcomeInput: z.literal(false),
    patchInput: z.literal(false),
    semanticDecisionInput: z.literal(false),
    targetOrderPreserved: z.literal(true),
    testInput: z.literal(false),
  }).strict(),
  plan: nonemptyArtifactReferenceSchema.extend({
    sourceTargetProjectionSha256: sha256Schema,
  }).strict(),
  query: z.object({
    endpoint: z.literal(ENDPOINT),
    platformCommitCap: z.literal(
      C6_LIVE_MULTILANG_NEIGHBOR_PLATFORM_COMMIT_CAP,
    ),
    querySha256: sha256Schema,
  }).strict(),
  registrationBoundary: registrationBoundarySchema,
  schemaVersion: z.literal(1),
}).strict();
const transportErrorSchema = z.object({
  artifactKind: z.literal(
    "c6-live-multilang-neighbor-commit-count-transport-error",
  ),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  message: z.string(),
  phase: z.enum(["body-read", "fetch", "timeout"]),
  retryScheduled: z.boolean(),
  schemaVersion: z.literal(1),
}).strict();
const resultEvidenceSchema = z.object({
  captureManifest: nonemptyArtifactReferenceSchema,
  finalResponse: responseReferenceSchema.extend({
    bytes: z.number().int().positive(),
  }).strict(),
}).strict();
const qualificationResultSchema = z.object({
  commitCount: z.number().int().nonnegative(),
  decision: z.enum([
    "eligible-for-deep-capture",
    "excluded-platform-commit-cap",
  ]),
  deepCaptureOrder: z.number().int().positive().nullable(),
  evidence: resultEvidenceSchema,
  sourceTarget: targetSchema,
}).strict();
const qualificationSchema = z.object({
  artifactKind: z.literal(ARTIFACT_KIND),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    actorCaptureExecuted: z.literal(false),
    actorQualifiedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    deepCaptureExecuted: z.literal(false),
    machineQualifiedEpisodeCount: z.literal(0),
    semanticallyQualifiedEpisodeCount: z.literal(0),
    status: z.literal(
      "commit-count-platform-eligibility-qualified-deep-plan-required",
    ),
  }).strict(),
  counts: z.object({
    deepCaptureTargetCount: z.literal(ELIGIBLE_TARGET_COUNT),
    eligibleTargetCount: z.literal(ELIGIBLE_TARGET_COUNT),
    excludedTargetCount: z.literal(EXCLUDED_TARGET_COUNT),
    logicalRequestCount: z.literal(SOURCE_TARGET_COUNT),
    networkRequestCount: z.number().int().min(SOURCE_TARGET_COUNT),
    rawFinalSuccessResponseCount: z.literal(SOURCE_TARGET_COUNT),
    replacementCount: z.literal(0),
    resampledTargetCount: z.literal(0),
    resultCount: z.literal(SOURCE_TARGET_COUNT),
    sourceTargetCount: z.literal(SOURCE_TARGET_COUNT),
  }).strict(),
  independenceBoundary: z.object({
    deepCaptureTargetProjectionSha256: sha256Schema,
    deepPlanTargetProjectionSha256: sha256Schema,
    diagnosticInput: z.literal(false),
    eligibleSourceTargetProjectionSha256: sha256Schema,
    excludedSourceTargetProjectionSha256: sha256Schema,
    goldInput: z.literal(false),
    machineOutcomeInput: z.literal(false),
    patchInput: z.literal(false),
    rawCommitCountProjectionSha256: sha256Schema,
    resultProjectionSha256: sha256Schema,
    semanticDecisionInput: z.literal(false),
    sourceTargetProjectionSha256: sha256Schema,
    testInput: z.literal(false),
  }).strict(),
  inputs: z.object({
    canonicalCapture: z.object({
      assetLock: nonemptyArtifactReferenceSchema,
      assetRootSha256: sha256Schema,
      completion: nonemptyArtifactReferenceSchema,
    }).strict(),
    censusQualification: censusReferenceSchema,
    deepCapturePlan: nonemptyArtifactReferenceSchema.extend({
      artifactKind: z.literal(DEEP_PLAN_KIND),
      schemaVersion: z.literal(1),
      targetProjectionSha256: sha256Schema,
    }).strict(),
    eligibilityPlan: nonemptyArtifactReferenceSchema.extend({
      artifactKind: z.literal(ELIGIBILITY_PLAN_KIND),
      schemaVersion: z.literal(1),
      sourceTargetProjectionSha256: sha256Schema,
    }).strict(),
  }).strict(),
  registrationBoundary: registrationBoundarySchema,
  results: z.array(qualificationResultSchema).length(
    SOURCE_TARGET_COUNT,
  ),
  rule: z.object({
    classification: z.literal(
      "commitCount-less-than-or-equal-platform-cap",
    ),
    forbiddenSelectionInputs: z.tuple([
      z.literal("diagnostic"),
      z.literal("gold"),
      z.literal("machineOutcome"),
      z.literal("patch"),
      z.literal("semanticDecision"),
      z.literal("test"),
    ]),
    noReplacementOrResampling: z.literal(true),
    platformCommitCap: z.literal(
      C6_LIVE_MULTILANG_NEIGHBOR_PLATFORM_COMMIT_CAP,
    ),
    rawFinalSuccessResponseRequired: z.literal(true),
    resultOrder: z.literal("frozen-deep-plan-v2-target-order"),
    stableEligibilityFilter: z.literal(true),
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
  sourceDataset: sourceDatasetSchema,
}).strict();

export type C6LiveMultiLangNeighborCommitCountEligibilityQualification =
  z.infer<typeof qualificationSchema>;

interface ReplayedCapture {
  assetLock: C6AssetLock;
  assetLockBytes: Buffer;
  assetLockSha256: string;
  completionBytes: Buffer;
  networkRequestCount: number;
  results: Array<z.infer<typeof qualificationResultSchema>>;
}

export async function buildC6LiveMultiLangNeighborCommitCountEligibilityQualification(
  input: {
    captureRoot: string;
    censusQualificationPath: string;
    deepCapturePlanPath: string;
    eligibilityPlanPath: string;
    expectedCaptureAssetLockSha256: string;
    expectedCaptureAssetRootSha256: string;
    expectedCaptureCompletionSha256: string;
    expectedCensusQualificationSha256: string;
    expectedDeepCapturePlanSha256: string;
    expectedEligibilityPlanSha256: string;
    testHooks?: {
      beforeTerminalVerification?: () => Promise<void> | void;
    };
  },
): Promise<{
  outputSha256: string;
  qualification:
    C6LiveMultiLangNeighborCommitCountEligibilityQualification;
}> {
  const expected = {
    captureAssetLockSha256: sha256Schema.parse(
      input.expectedCaptureAssetLockSha256,
    ),
    captureAssetRootSha256: sha256Schema.parse(
      input.expectedCaptureAssetRootSha256,
    ),
    captureCompletionSha256: sha256Schema.parse(
      input.expectedCaptureCompletionSha256,
    ),
    censusQualificationSha256: sha256Schema.parse(
      input.expectedCensusQualificationSha256,
    ),
    deepCapturePlanSha256: sha256Schema.parse(
      input.expectedDeepCapturePlanSha256,
    ),
    eligibilityPlanSha256: sha256Schema.parse(
      input.expectedEligibilityPlanSha256,
    ),
  };
  const paths = {
    captureRoot: await assertC6NoSymlinkPathComponents(
      input.captureRoot,
      "C6 commit-count qualification capture root",
    ),
    censusQualification: await assertC6NoSymlinkPathComponents(
      input.censusQualificationPath,
      "C6 commit-count qualification census input",
    ),
    deepCapturePlan: await assertC6NoSymlinkPathComponents(
      input.deepCapturePlanPath,
      "C6 commit-count qualification deep-plan input",
    ),
    eligibilityPlan: await assertC6NoSymlinkPathComponents(
      input.eligibilityPlanPath,
      "C6 commit-count qualification eligibility-plan input",
    ),
  };
  const [
    censusQualificationBytes,
    deepCapturePlanBytes,
    eligibilityPlanBytes,
  ] = await Promise.all([
    readC6StableRegularFile(
      paths.censusQualification,
      "commit-count qualification census input",
    ),
    readC6StableRegularFile(
      paths.deepCapturePlan,
      "commit-count qualification deep-plan input",
    ),
    readC6StableRegularFile(
      paths.eligibilityPlan,
      "commit-count qualification eligibility-plan input",
    ),
  ]);
  assertHash(
    censusQualificationBytes,
    expected.censusQualificationSha256,
    "census qualification",
  );
  assertHash(
    deepCapturePlanBytes,
    expected.deepCapturePlanSha256,
    "deep-capture plan",
  );
  assertHash(
    eligibilityPlanBytes,
    expected.eligibilityPlanSha256,
    "eligibility plan",
  );
  const censusQualification = censusQualificationSchema.parse(
    canonicalJson(censusQualificationBytes, "census qualification"),
  );
  const deepCapturePlan = deepPlanSchema.parse(
    canonicalJson(deepCapturePlanBytes, "deep-capture plan"),
  );
  const eligibilityPlan =
    parseC6LiveMultiLangNeighborCommitCountEligibilityPlan(
      eligibilityPlanBytes,
    );
  validateTransitiveInputs({
    censusQualification,
    censusQualificationBytes,
    censusQualificationPath: paths.censusQualification,
    deepCapturePlan,
    deepCapturePlanBytes,
    eligibilityPlan,
  });

  const replayed = await replayCanonicalCapture({
    captureRoot: paths.captureRoot,
    deepCapturePlan,
    eligibilityPlan,
    eligibilityPlanBytes,
    eligibilityPlanPath: paths.eligibilityPlan,
    expectedAssetLockSha256:
      expected.captureAssetLockSha256,
    expectedAssetRootSha256:
      expected.captureAssetRootSha256,
    expectedCompletionSha256:
      expected.captureCompletionSha256,
  });
  const qualification = buildQualification({
    censusQualification,
    censusQualificationBytes,
    censusQualificationPath: paths.censusQualification,
    deepCapturePlan,
    deepCapturePlanBytes,
    deepCapturePlanPath: paths.deepCapturePlan,
    eligibilityPlan,
    eligibilityPlanBytes,
    eligibilityPlanPath: paths.eligibilityPlan,
    replayed,
  });

  await input.testHooks?.beforeTerminalVerification?.();
  const terminalInputs = await Promise.all([
    readC6StableRegularFile(
      paths.censusQualification,
      "commit-count qualification terminal census input",
    ),
    readC6StableRegularFile(
      paths.deepCapturePlan,
      "commit-count qualification terminal deep-plan input",
    ),
    readC6StableRegularFile(
      paths.eligibilityPlan,
      "commit-count qualification terminal eligibility-plan input",
    ),
  ]);
  if (
    !terminalInputs[0].equals(censusQualificationBytes) ||
    !terminalInputs[1].equals(deepCapturePlanBytes) ||
    !terminalInputs[2].equals(eligibilityPlanBytes)
  ) {
    throw new Error(
      "C6 commit-count qualification input changed during replay",
    );
  }
  const terminalLock = await loadC6AssetLock(paths.captureRoot);
  if (
    terminalLock.assetLockSha256 !== replayed.assetLockSha256 ||
    serializeC6AssetLock(terminalLock.assetLock) !==
      serializeC6AssetLock(replayed.assetLock)
  ) {
    throw new Error(
      "C6 commit-count qualification capture changed during replay",
    );
  }
  const serialized =
    serializeC6LiveMultiLangNeighborCommitCountEligibilityQualification(
      qualification,
    );
  return {
    outputSha256: sha256(serialized),
    qualification,
  };
}

export async function materializeC6LiveMultiLangNeighborCommitCountEligibilityQualification(
  input: Parameters<
    typeof buildC6LiveMultiLangNeighborCommitCountEligibilityQualification
  >[0] & {
    outputPath: string;
    testHooks?: {
      afterOutputPublication?: () => Promise<void> | void;
      beforeTerminalVerification?: () => Promise<void> | void;
    };
  },
): Promise<{
  outputSha256: string;
  qualification:
    C6LiveMultiLangNeighborCommitCountEligibilityQualification;
}> {
  const result =
    await buildC6LiveMultiLangNeighborCommitCountEligibilityQualification(
      input,
    );
  const serialized =
    serializeC6LiveMultiLangNeighborCommitCountEligibilityQualification(
      result.qualification,
    );
  const outputPath = resolve(input.outputPath);
  const outputParent = await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 commit-count qualification output parent",
  );
  const temporaryPath = join(
    outputParent,
    `.${basename(outputPath)}.incomplete-${randomUUID()}`,
  );
  let owned:
    | { dev: number; ino: number }
    | undefined;
  try {
    const handle = await open(temporaryPath, "wx", CAPTURE_FILE_MODE);
    try {
      const stat = await handle.stat();
      owned = { dev: stat.dev, ino: stat.ino };
      await handle.writeFile(serialized, "utf8");
      await handle.chmod(OUTPUT_FILE_MODE);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporaryPath, outputPath);
    await input.testHooks?.afterOutputPublication?.();
    const replay =
      await buildC6LiveMultiLangNeighborCommitCountEligibilityQualification({
        ...input,
        testHooks: undefined,
      });
    if (
      replay.outputSha256 !== result.outputSha256 ||
      serializeC6LiveMultiLangNeighborCommitCountEligibilityQualification(
        replay.qualification,
      ) !== serialized
    ) {
      throw new Error(
        "C6 commit-count qualification post-publication replay mismatch",
      );
    }
    if (owned === undefined) {
      throw new Error(
        "C6 commit-count qualification output identity missing",
      );
    }
    await assertOwnedOutput(outputPath, temporaryPath, owned);
    const published = await readC6StableRegularFile(
      outputPath,
      "commit-count qualification published output",
    );
    if (
      published.toString("utf8") !== serialized ||
      sha256(published) !== result.outputSha256
    ) {
      throw new Error(
        "C6 commit-count qualification published output mismatch",
      );
    }
    await rm(temporaryPath);
    return result;
  } catch (error) {
    if (owned !== undefined) {
      await Promise.all([
        removeIfOwned(outputPath, owned),
        removeIfOwned(temporaryPath, owned),
      ]);
    }
    throw error;
  }
}

export function parseC6LiveMultiLangNeighborCommitCountEligibilityQualification(
  input: string | Uint8Array,
): C6LiveMultiLangNeighborCommitCountEligibilityQualification {
  const bytes = typeof input === "string"
    ? Buffer.from(input)
    : Buffer.from(input);
  const qualification = qualificationSchema.parse(
    canonicalJson(bytes, "qualification"),
  );
  validateQualification(qualification);
  return qualification;
}

export function serializeC6LiveMultiLangNeighborCommitCountEligibilityQualification(
  qualification:
    C6LiveMultiLangNeighborCommitCountEligibilityQualification,
): string {
  validateQualification(qualification);
  return `${JSON.stringify(qualificationSchema.parse(qualification), null, 2)}\n`;
}

async function replayCanonicalCapture(input: {
  captureRoot: string;
  deepCapturePlan: z.infer<typeof deepPlanSchema>;
  eligibilityPlan: ReturnType<
    typeof parseC6LiveMultiLangNeighborCommitCountEligibilityPlan
  >;
  eligibilityPlanBytes: Buffer;
  eligibilityPlanPath: string;
  expectedAssetLockSha256: string;
  expectedAssetRootSha256: string;
  expectedCompletionSha256: string;
}): Promise<ReplayedCapture> {
  const loadedLock = await loadC6AssetLock(input.captureRoot);
  if (
    loadedLock.assetLockSha256 !==
      input.expectedAssetLockSha256 ||
    loadedLock.assetLock.assetRootSha256 !==
      input.expectedAssetRootSha256
  ) {
    throw new Error(
      "C6 commit-count qualification capture asset lock mismatch",
    );
  }
  await assertPrivateCaptureTree(
    input.captureRoot,
    loadedLock.assetLock,
  );
  const files = new Map(
    loadedLock.assetLock.files.map((file) => [file.path, file]),
  );
  const consumed = new Set<string>();
  const completionBytes = await readReference({
    consumed,
    expectedPath: "completion.json",
    files,
    reference: {
      bytes: requiredAsset(files, "completion.json").bytes,
      path: "completion.json",
      sha256: requiredAsset(files, "completion.json").sha256,
    },
    root: input.captureRoot,
  });
  if (sha256(completionBytes) !== input.expectedCompletionSha256) {
    throw new Error(
      "C6 commit-count qualification completion hash mismatch",
    );
  }
  const completion = captureCompletionSchema.parse(
    canonicalJson(completionBytes, "capture completion"),
  );
  validateCompletionInput({
    completion,
    deepCapturePlan: input.deepCapturePlan,
    eligibilityPlan: input.eligibilityPlan,
    eligibilityPlanBytes: input.eligibilityPlanBytes,
    eligibilityPlanPath: input.eligibilityPlanPath,
  });

  const results = [];
  let deepCaptureOrder = 0;
  let networkRequestCount = 0;
  for (const [index, sourceTarget] of
    input.deepCapturePlan.targets.entries()) {
    const completionCapture = completion.captures[index]!;
    if (
      completionCapture.canonicalAnchorId !==
        sourceTarget.canonicalAnchorId ||
      completionCapture.captureDirectory !==
        sourceTarget.captureDirectory ||
      completionCapture.captureManifest.path !==
        `${sourceTarget.captureDirectory}/capture.json`
    ) {
      throw new Error(
        `C6 commit-count qualification completion order mismatch ${
          index + 1
        }`,
      );
    }
    const captureBytes = await readReference({
      consumed,
      expectedPath:
        `${sourceTarget.captureDirectory}/capture.json`,
      files,
      reference: completionCapture.captureManifest,
      root: input.captureRoot,
    });
    const capture = targetCaptureSchema.parse(
      canonicalJson(captureBytes, "target capture"),
    );
    if (
      JSON.stringify(capture.planTarget) !==
        JSON.stringify(sourceTarget) ||
      capture.querySha256 !==
        input.eligibilityPlan.queryContract.querySha256
    ) {
      throw new Error(
        `C6 commit-count qualification target capture mismatch ${
          sourceTarget.canonicalAnchorId
        }`,
      );
    }
    const final = await replayAttempts({
      capture,
      consumed,
      files,
      root: input.captureRoot,
      sourceTarget,
    });
    networkRequestCount += capture.attempts.length;
    const commitCount =
      final.response.data.repository.pullRequest.commits.totalCount;
    const eligible =
      commitCount <=
        C6_LIVE_MULTILANG_NEIGHBOR_PLATFORM_COMMIT_CAP;
    const status = eligible
      ? "within-platform-cap"
      : "exceeds-platform-cap";
    if (
      capture.observation.commitCount !== commitCount ||
      capture.observation.status !== status ||
      capture.observation.platformCommitCap !==
        C6_LIVE_MULTILANG_NEIGHBOR_PLATFORM_COMMIT_CAP ||
      capture.observation.pullRequestId !==
        final.response.data.repository.pullRequest.id ||
      capture.observation.repositoryId !==
        final.response.data.repository.id ||
      JSON.stringify(capture.observation.rateLimit) !==
        JSON.stringify(final.response.data.rateLimit) ||
      completionCapture.commitCount !== commitCount ||
      completionCapture.status !== status
    ) {
      throw new Error(
        `C6 commit-count qualification raw/capture decision mismatch ${
          sourceTarget.canonicalAnchorId
        }`,
      );
    }
    if (eligible) {
      deepCaptureOrder += 1;
    }
    results.push({
      commitCount,
      decision: eligible
        ? "eligible-for-deep-capture" as const
        : "excluded-platform-commit-cap" as const,
      deepCaptureOrder: eligible ? deepCaptureOrder : null,
      evidence: {
        captureManifest: completionCapture.captureManifest,
        finalResponse: final.reference,
      },
      sourceTarget,
    });
  }
  if (
    deepCaptureOrder !== ELIGIBLE_TARGET_COUNT ||
    results.length - deepCaptureOrder !== EXCLUDED_TARGET_COUNT ||
    networkRequestCount !== completion.counts.networkRequestCount ||
    completion.independenceBoundary.commitCountProjectionSha256 !==
      sha256(JSON.stringify(
        results.map((result) => ({
          canonicalAnchorId:
            result.sourceTarget.canonicalAnchorId,
          commitCount: result.commitCount,
          status: result.decision ===
              "eligible-for-deep-capture"
            ? "within-platform-cap"
            : "exceeds-platform-cap",
        })),
      ))
  ) {
    throw new Error(
      "C6 commit-count qualification completion count/projection mismatch",
    );
  }
  if (
    consumed.size !== files.size ||
    [...files.keys()].some((path) => !consumed.has(path))
  ) {
    throw new Error(
      "C6 commit-count qualification capture reference closure mismatch",
    );
  }
  const assetLockBytes = await readC6StableRegularFile(
    join(input.captureRoot, "asset-lock.json"),
    "commit-count qualification asset lock",
  );
  return {
    assetLock: loadedLock.assetLock,
    assetLockBytes,
    assetLockSha256: loadedLock.assetLockSha256,
    completionBytes,
    networkRequestCount,
    results,
  };
}

async function replayAttempts(input: {
  capture: z.infer<typeof targetCaptureSchema>;
  consumed: Set<string>;
  files: Map<string, C6AssetLock["files"][number]>;
  root: string;
  sourceTarget: z.infer<typeof targetSchema>;
}): Promise<{
  reference: z.infer<typeof responseReferenceSchema>;
  response: z.infer<typeof graphqlSuccessSchema>;
}> {
  if (input.capture.attempts.length > MAXIMUM_NETWORK_ATTEMPTS) {
    throw new Error(
      "C6 commit-count qualification retry attempt limit exceeded",
    );
  }
  let final:
    | {
      reference: z.infer<typeof responseReferenceSchema>;
      response: z.infer<typeof graphqlSuccessSchema>;
    }
    | undefined;
  for (const [index, attempt] of input.capture.attempts.entries()) {
    const attemptNumber = index + 1;
    const base =
      `${input.sourceTarget.captureDirectory}/attempts/attempt-${
        String(attemptNumber).padStart(2, "0")
      }`;
    if (attempt.attempt !== attemptNumber) {
      throw new Error(
        "C6 commit-count qualification attempt order mismatch",
      );
    }
    const requestBytes = await readReference({
      consumed: input.consumed,
      expectedPath: `${base}/request.json`,
      files: input.files,
      reference: attempt.request,
      root: input.root,
    });
    const request = requestReceiptSchema.parse(
      canonicalJson(requestBytes, "request receipt"),
    );
    if (
      request.attempt !== attemptNumber ||
      request.querySha256 !==
        sha256(
          C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
        ) ||
      request.variables.owner !== input.sourceTarget.owner ||
      request.variables.name !== input.sourceTarget.repo ||
      request.variables.number !== input.sourceTarget.pullNumber
    ) {
      throw new Error(
        "C6 commit-count qualification request identity mismatch",
      );
    }
    const responseHeaderBytes = await readReference({
      consumed: input.consumed,
      expectedPath: `${base}/response-headers.json`,
      files: input.files,
      reference: attempt.responseHeaders,
      root: input.root,
    });
    const headers = stringRecordSchema(
      canonicalJson(responseHeaderBytes, "response headers"),
    );
    if (
      Object.keys(headers).some((name) =>
        !SELECTED_RESPONSE_HEADERS.has(name)
      )
    ) {
      throw new Error(
        "C6 commit-count qualification response header mismatch",
      );
    }
    if (attempt.transportError !== undefined) {
      if (
        attempt.response !== undefined ||
        attempt.retryAfterMilliseconds !==
          exponentialRetryDelay(attemptNumber) ||
        index === input.capture.attempts.length - 1
      ) {
        throw new Error(
          "C6 commit-count qualification transport attempt mismatch",
        );
      }
      const transportErrorBytes = await readReference({
        consumed: input.consumed,
        expectedPath: `${base}/transport-error.json`,
        files: input.files,
        reference: attempt.transportError,
        root: input.root,
      });
      const transportError = transportErrorSchema.parse(
        canonicalJson(transportErrorBytes, "transport error"),
      );
      if (
        transportError.phase !== attempt.transportError.phase ||
        !transportError.retryScheduled ||
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
          "C6 commit-count qualification transport provenance mismatch",
        );
      }
      continue;
    }
    if (attempt.response === undefined) {
      throw new Error(
        "C6 commit-count qualification attempt response missing",
      );
    }
    const responseBytes = await readReference({
      consumed: input.consumed,
      expectedPath: `${base}/response.json`,
      files: input.files,
      reference: attempt.response,
      root: input.root,
    });
    const raw = json(responseBytes, "response");
    const isFinal = index === input.capture.attempts.length - 1;
    const errors = graphqlErrors(raw);
    const success =
      attempt.response.httpStatus === 200 &&
      errors.length === 0;
    if (!isFinal) {
      if (
        success ||
        attempt.retryAfterMilliseconds === undefined
      ) {
        throw new Error(
          "C6 commit-count qualification retry attempt boundary mismatch",
        );
      }
      validateResponseRetry({
        attemptNumber,
        errors,
        headers,
        retryAfterMilliseconds:
          attempt.retryAfterMilliseconds,
        status: attempt.response.httpStatus,
      });
      continue;
    }
    if (
      !success ||
      attempt.retryAfterMilliseconds !== undefined
    ) {
      throw new Error(
        "C6 commit-count qualification final response mismatch",
      );
    }
    validateSuccessHeaders(headers);
    const response = graphqlSuccessSchema.parse(raw);
    validateGraphqlIdentity(response, input.sourceTarget);
    final = {
      reference: attempt.response,
      response,
    };
  }
  if (final === undefined) {
    throw new Error(
      "C6 commit-count qualification final success missing",
    );
  }
  return final;
}

function validateSuccessHeaders(
  headers: Readonly<Record<string, string>>,
): void {
  for (const name of REQUIRED_SUCCESS_HEADERS) {
    if (headers[name] === undefined || headers[name]!.length === 0) {
      throw new Error(
        `C6 commit-count qualification missing success header ${name}`,
      );
    }
  }
  if (
    headers["content-type"]!.split(";", 1)[0]!.trim()
      .toLowerCase() !== "application/json" ||
    headers["x-ratelimit-resource"] !== "graphql" ||
    !/^\d+$/u.test(headers["x-ratelimit-limit"]!) ||
    !/^\d+$/u.test(headers["x-ratelimit-remaining"]!) ||
    !/^\d+$/u.test(headers["x-ratelimit-reset"]!) ||
    !/^\d+$/u.test(headers["x-ratelimit-used"]!)
  ) {
    throw new Error(
      "C6 commit-count qualification invalid success headers",
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
        "C6 commit-count qualification non-transient GraphQL retry",
      );
    }
  } else if (!RETRYABLE_HTTP_STATUSES.has(input.status)) {
    throw new Error(
      `C6 commit-count qualification non-retryable HTTP status ${
        input.status
      }`,
    );
  }
  if (
    input.retryAfterMilliseconds !==
      responseRetryDelay(input.headers, input.attemptNumber)
  ) {
    throw new Error(
      "C6 commit-count qualification retry delay mismatch",
    );
  }
}

function responseRetryDelay(
  headers: Readonly<Record<string, string>>,
  attemptNumber: number,
): number {
  const retryAfter = headers["retry-after"];
  if (
    retryAfter !== undefined &&
    /^\d+$/u.test(retryAfter)
  ) {
    return Math.min(
      Number(retryAfter) * 1_000,
      MAXIMUM_RETRY_AFTER_MILLISECONDS,
    );
  }
  return exponentialRetryDelay(attemptNumber);
}

function exponentialRetryDelay(attemptNumber: number): number {
  const delay =
    TRANSPORT_CONTRACT.exponentialBackoffMilliseconds[
      attemptNumber - 1
    ];
  if (delay === undefined) {
    throw new Error(
      "C6 commit-count qualification retry contract exhausted",
    );
  }
  return delay;
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

function isTransientGraphqlError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const extensions = "extensions" in error &&
      typeof error.extensions === "object" &&
      error.extensions !== null
    ? error.extensions
    : null;
  if (extensions === null) {
    return false;
  }
  for (const key of ["type", "code"]) {
    if (
      key in extensions &&
      typeof extensions[key as keyof typeof extensions] ===
        "string" &&
      TRANSIENT_GRAPHQL_TYPES.has(
        String(extensions[key as keyof typeof extensions])
          .toUpperCase(),
      )
    ) {
      return true;
    }
  }
  return false;
}

function buildQualification(input: {
  censusQualification: z.infer<typeof censusQualificationSchema>;
  censusQualificationBytes: Buffer;
  censusQualificationPath: string;
  deepCapturePlan: z.infer<typeof deepPlanSchema>;
  deepCapturePlanBytes: Buffer;
  deepCapturePlanPath: string;
  eligibilityPlan: ReturnType<
    typeof parseC6LiveMultiLangNeighborCommitCountEligibilityPlan
  >;
  eligibilityPlanBytes: Buffer;
  eligibilityPlanPath: string;
  replayed: ReplayedCapture;
}): C6LiveMultiLangNeighborCommitCountEligibilityQualification {
  const eligibleResults = input.replayed.results.filter(
    (result) =>
      result.decision === "eligible-for-deep-capture",
  );
  const excludedResults = input.replayed.results.filter(
    (result) =>
      result.decision === "excluded-platform-commit-cap",
  );
  const deepPlanTargets = eligibleResults.map((result) => ({
    ...result.sourceTarget,
    captureOrder: result.deepCaptureOrder!,
  }));
  const qualification = {
    artifactKind: ARTIFACT_KIND,
    boundary: {
      acceptedEpisodeCount: 0,
      actorCaptureExecuted: false,
      actorQualifiedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      deepCaptureExecuted: false,
      machineQualifiedEpisodeCount: 0,
      semanticallyQualifiedEpisodeCount: 0,
      status:
        "commit-count-platform-eligibility-qualified-deep-plan-required",
    },
    counts: {
      deepCaptureTargetCount: eligibleResults.length,
      eligibleTargetCount: eligibleResults.length,
      excludedTargetCount: excludedResults.length,
      logicalRequestCount: SOURCE_TARGET_COUNT,
      networkRequestCount: input.replayed.networkRequestCount,
      rawFinalSuccessResponseCount: SOURCE_TARGET_COUNT,
      replacementCount: 0,
      resampledTargetCount: 0,
      resultCount: input.replayed.results.length,
      sourceTargetCount: input.deepCapturePlan.targets.length,
    },
    independenceBoundary: {
      deepCaptureTargetProjectionSha256: sha256(JSON.stringify(
        eligibleResults.map(deepTargetProjection),
      )),
      deepPlanTargetProjectionSha256: sha256(JSON.stringify(
        deepPlanTargets,
      )),
      diagnosticInput: false,
      eligibleSourceTargetProjectionSha256: sha256(JSON.stringify(
        eligibleResults.map((result) => result.sourceTarget),
      )),
      excludedSourceTargetProjectionSha256: sha256(JSON.stringify(
        excludedResults.map((result) => result.sourceTarget),
      )),
      goldInput: false,
      machineOutcomeInput: false,
      patchInput: false,
      rawCommitCountProjectionSha256: sha256(JSON.stringify(
        input.replayed.results.map((result) => ({
          canonicalAnchorId: result.sourceTarget.canonicalAnchorId,
          commitCount: result.commitCount,
        })),
      )),
      resultProjectionSha256: sha256(JSON.stringify(
        input.replayed.results,
      )),
      semanticDecisionInput: false,
      sourceTargetProjectionSha256:
        input.deepCapturePlan.independenceBoundary
          .targetProjectionSha256,
      testInput: false,
    },
    inputs: {
      canonicalCapture: {
        assetLock: reference(
          input.replayed.assetLockBytes,
          "asset-lock.json",
        ),
        assetRootSha256:
          input.replayed.assetLock.assetRootSha256,
        completion: reference(
          input.replayed.completionBytes,
          "completion.json",
        ),
      },
      censusQualification: {
        ...reference(
          input.censusQualificationBytes,
          input.censusQualificationPath,
        ),
        artifactKind: CENSUS_QUALIFICATION_KIND,
        deepCaptureTargetProjectionSha256:
          input.censusQualification.independenceBoundary
            .deepCaptureTargetProjectionSha256,
        schemaVersion: 3,
      },
      deepCapturePlan: {
        ...reference(
          input.deepCapturePlanBytes,
          input.deepCapturePlanPath,
        ),
        artifactKind: DEEP_PLAN_KIND,
        schemaVersion: 1,
        targetProjectionSha256:
          input.deepCapturePlan.independenceBoundary
            .targetProjectionSha256,
      },
      eligibilityPlan: {
        ...reference(
          input.eligibilityPlanBytes,
          input.eligibilityPlanPath,
        ),
        artifactKind: ELIGIBILITY_PLAN_KIND,
        schemaVersion: 1,
        sourceTargetProjectionSha256:
          input.eligibilityPlan.independenceBoundary
            .sourceTargetProjectionSha256,
      },
    },
    registrationBoundary:
      input.eligibilityPlan.registrationBoundary,
    results: input.replayed.results,
    rule: {
      classification:
        "commitCount-less-than-or-equal-platform-cap",
      forbiddenSelectionInputs: [
        "diagnostic",
        "gold",
        "machineOutcome",
        "patch",
        "semanticDecision",
        "test",
      ],
      noReplacementOrResampling: true,
      platformCommitCap:
        C6_LIVE_MULTILANG_NEIGHBOR_PLATFORM_COMMIT_CAP,
      rawFinalSuccessResponseRequired: true,
      resultOrder: "frozen-deep-plan-v2-target-order",
      stableEligibilityFilter: true,
    },
    sampleBoundary: {
      ...input.deepCapturePlan.sampleBoundary,
      populationRepresentativenessProven: false,
      reviewSurfacePretargetSelectionOnly: true,
    },
    schemaVersion: 1,
    sourceDataset: input.deepCapturePlan.sourceDataset,
  };
  return qualificationSchema.parse(qualification);
}

function validateTransitiveInputs(input: {
  censusQualification: z.infer<typeof censusQualificationSchema>;
  censusQualificationBytes: Buffer;
  censusQualificationPath: string;
  deepCapturePlan: z.infer<typeof deepPlanSchema>;
  deepCapturePlanBytes: Buffer;
  eligibilityPlan: ReturnType<
    typeof parseC6LiveMultiLangNeighborCommitCountEligibilityPlan
  >;
}): void {
  if (
    input.deepCapturePlan.inputs.qualification.sha256 !==
      sha256(input.censusQualificationBytes) ||
    input.deepCapturePlan.inputs.qualification.bytes !==
      input.censusQualificationBytes.byteLength ||
    input.deepCapturePlan.inputs.qualification.path !==
      basename(input.censusQualificationPath) ||
    input.deepCapturePlan.inputs.qualification
      .deepCaptureTargetProjectionSha256 !==
        input.censusQualification.independenceBoundary
          .deepCaptureTargetProjectionSha256 ||
    input.deepCapturePlan.independenceBoundary
      .qualificationDeepTargetProjectionSha256 !==
        input.censusQualification.independenceBoundary
          .deepCaptureTargetProjectionSha256 ||
    input.deepCapturePlan.independenceBoundary
      .targetProjectionSha256 !==
        sha256(JSON.stringify(input.deepCapturePlan.targets)) ||
    input.eligibilityPlan.inputs.deepCapturePlan.sha256 !==
      sha256(input.deepCapturePlanBytes) ||
    input.eligibilityPlan.independenceBoundary
      .sourceTargetProjectionSha256 !==
        input.deepCapturePlan.independenceBoundary
          .targetProjectionSha256 ||
    JSON.stringify(input.eligibilityPlan.targets) !==
      JSON.stringify(input.deepCapturePlan.targets)
  ) {
    throw new Error(
      "C6 commit-count qualification transitive input mismatch",
    );
  }
  const censusTargets = input.censusQualification.results.filter(
    (result) =>
      result.status ===
        "novel-review-surface-deep-capture-target",
  );
  if (
    censusTargets.length !== SOURCE_TARGET_COUNT ||
    sha256(JSON.stringify(
      censusTargets.map(censusDeepTargetProjection),
    )) !==
      input.censusQualification.independenceBoundary
        .deepCaptureTargetProjectionSha256 ||
    JSON.stringify(censusTargets.map(censusResultToPlanTarget)) !==
      JSON.stringify(input.deepCapturePlan.targets)
  ) {
    throw new Error(
      "C6 commit-count qualification census/deep-plan projection mismatch",
    );
  }
}

function validateCompletionInput(input: {
  completion: z.infer<typeof captureCompletionSchema>;
  deepCapturePlan: z.infer<typeof deepPlanSchema>;
  eligibilityPlan: ReturnType<
    typeof parseC6LiveMultiLangNeighborCommitCountEligibilityPlan
  >;
  eligibilityPlanBytes: Buffer;
  eligibilityPlanPath: string;
}): void {
  if (
    input.completion.plan.path !==
      basename(input.eligibilityPlanPath) ||
    input.completion.plan.bytes !==
      input.eligibilityPlanBytes.byteLength ||
    input.completion.plan.sha256 !==
      sha256(input.eligibilityPlanBytes) ||
    input.completion.plan.sourceTargetProjectionSha256 !==
      input.deepCapturePlan.independenceBoundary
        .targetProjectionSha256 ||
    input.completion.query.querySha256 !==
      input.eligibilityPlan.queryContract.querySha256 ||
    JSON.stringify(input.completion.registrationBoundary) !==
      JSON.stringify(input.eligibilityPlan.registrationBoundary)
  ) {
    throw new Error(
      "C6 commit-count qualification completion input mismatch",
    );
  }
}

function validateQualification(
  qualification:
    C6LiveMultiLangNeighborCommitCountEligibilityQualification,
): void {
  const eligible = [];
  const excluded = [];
  const seenAnchors = new Set<string>();
  const seenCaptureDirectories = new Set<string>();
  const seenCaptureManifests = new Set<string>();
  const seenFinalResponses = new Set<string>();
  let expectedDeepOrder = 0;
  for (const [index, result] of qualification.results.entries()) {
    const sourceTarget = result.sourceTarget;
    const canonicalRepository =
      `${sourceTarget.owner}/${sourceTarget.repo}`;
    const canonicalAnchorId =
      `${canonicalRepository}#${sourceTarget.pullNumber}`;
    const captureDirectory =
      `${sourceTarget.owner}__${sourceTarget.repo}__${
        sourceTarget.pullNumber
      }`;
    const sourceUrl = new URL(sourceTarget.url);
    const canonicalUrlPath =
      `/${canonicalRepository}/pull/${sourceTarget.pullNumber}`;
    const captureManifestPath =
      `${captureDirectory}/capture.json`;
    const finalResponsePrefix =
      `${captureDirectory}/attempts/attempt-`;
    if (
      sourceTarget.captureOrder !== index + 1 ||
      canonicalRepository !== canonicalRepository.toLowerCase() ||
      sourceTarget.canonicalRepository !== canonicalRepository ||
      sourceTarget.canonicalAnchorId !== canonicalAnchorId ||
      sourceTarget.captureDirectory !== captureDirectory ||
      sourceUrl.protocol !== "https:" ||
      sourceUrl.hostname !== "github.com" ||
      sourceUrl.pathname.toLowerCase() !==
        canonicalUrlPath.toLowerCase() ||
      sourceUrl.search !== "" ||
      sourceUrl.hash !== "" ||
      result.evidence.captureManifest.path !==
        captureManifestPath ||
      !result.evidence.finalResponse.path.startsWith(
        finalResponsePrefix,
      ) ||
      !result.evidence.finalResponse.path.endsWith(
        "/response.json",
      ) ||
      seenAnchors.has(canonicalAnchorId) ||
      seenCaptureDirectories.has(captureDirectory) ||
      seenCaptureManifests.has(captureManifestPath) ||
      seenFinalResponses.has(result.evidence.finalResponse.path)
    ) {
      throw new Error(
        "C6 commit-count qualification result identity/order mismatch",
      );
    }
    seenAnchors.add(canonicalAnchorId);
    seenCaptureDirectories.add(captureDirectory);
    seenCaptureManifests.add(captureManifestPath);
    seenFinalResponses.add(result.evidence.finalResponse.path);
    const shouldBeEligible =
      result.commitCount <=
        C6_LIVE_MULTILANG_NEIGHBOR_PLATFORM_COMMIT_CAP;
    if (shouldBeEligible) {
      expectedDeepOrder += 1;
      if (
        result.decision !== "eligible-for-deep-capture" ||
        result.deepCaptureOrder !== expectedDeepOrder
      ) {
        throw new Error(
          "C6 commit-count qualification eligible order mismatch",
        );
      }
      eligible.push(result);
    } else {
      if (
        result.decision !== "excluded-platform-commit-cap" ||
        result.deepCaptureOrder !== null
      ) {
        throw new Error(
          "C6 commit-count qualification exclusion mismatch",
        );
      }
      excluded.push(result);
    }
  }
  const deepPlanTargets = eligible.map((result) => ({
    ...result.sourceTarget,
    captureOrder: result.deepCaptureOrder!,
  }));
  if (
    eligible.length !== ELIGIBLE_TARGET_COUNT ||
    excluded.length !== EXCLUDED_TARGET_COUNT ||
    qualification.independenceBoundary
      .sourceTargetProjectionSha256 !==
        sha256(JSON.stringify(
          qualification.results.map((result) => result.sourceTarget),
        )) ||
    qualification.independenceBoundary
      .eligibleSourceTargetProjectionSha256 !==
        sha256(JSON.stringify(
          eligible.map((result) => result.sourceTarget),
        )) ||
    qualification.independenceBoundary
      .excludedSourceTargetProjectionSha256 !==
        sha256(JSON.stringify(
          excluded.map((result) => result.sourceTarget),
        )) ||
    qualification.independenceBoundary
      .deepCaptureTargetProjectionSha256 !==
        sha256(JSON.stringify(eligible.map(deepTargetProjection))) ||
    qualification.independenceBoundary
      .deepPlanTargetProjectionSha256 !==
        sha256(JSON.stringify(deepPlanTargets)) ||
    qualification.independenceBoundary
      .rawCommitCountProjectionSha256 !==
        sha256(JSON.stringify(
          qualification.results.map((result) => ({
            canonicalAnchorId:
              result.sourceTarget.canonicalAnchorId,
            commitCount: result.commitCount,
          })),
        )) ||
    qualification.independenceBoundary
      .resultProjectionSha256 !==
        sha256(JSON.stringify(qualification.results))
  ) {
    throw new Error(
      "C6 commit-count qualification projection mismatch",
    );
  }
}

async function readReference(input: {
  consumed: Set<string>;
  expectedPath: string;
  files: Map<string, C6AssetLock["files"][number]>;
  reference: z.infer<typeof artifactReferenceSchema>;
  root: string;
}): Promise<Buffer> {
  if (
    input.reference.path !== input.expectedPath ||
    input.consumed.has(input.expectedPath)
  ) {
    throw new Error(
      "C6 commit-count qualification duplicate/path reference mismatch " +
        input.expectedPath,
    );
  }
  const locked = requiredAsset(input.files, input.expectedPath);
  if (
    locked.bytes !== input.reference.bytes ||
    locked.sha256 !== input.reference.sha256 ||
    locked.mode !== CAPTURE_FILE_MODE
  ) {
    throw new Error(
      "C6 commit-count qualification reference/lock mismatch " +
        input.expectedPath,
    );
  }
  const bytes = await readC6StableRegularFile(
    join(input.root, ...input.expectedPath.split("/")),
    "commit-count qualification capture reference",
  );
  if (
    bytes.byteLength !== input.reference.bytes ||
    sha256(bytes) !== input.reference.sha256
  ) {
    throw new Error(
      "C6 commit-count qualification reference content mismatch " +
        input.expectedPath,
    );
  }
  input.consumed.add(input.expectedPath);
  return bytes;
}

async function assertPrivateCaptureTree(
  root: string,
  assetLock: C6AssetLock,
): Promise<void> {
  const rootStat = await lstat(root);
  if (
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    (rootStat.mode & 0o777) !== DIRECTORY_MODE
  ) {
    throw new Error(
      "C6 commit-count qualification capture root mode mismatch",
    );
  }
  const expectedFiles = new Set([
    ...assetLock.files.map((file) => file.path),
    "asset-lock.json",
  ]);
  const expectedDirectories = new Set<string>();
  for (const path of expectedFiles) {
    const parts = path.split("/");
    for (let length = 1; length < parts.length; length += 1) {
      expectedDirectories.add(parts.slice(0, length).join("/"));
    }
  }
  await walkPrivateTree(
    root,
    "",
    expectedDirectories,
    expectedFiles,
  );
  if (
    expectedDirectories.size > 0 ||
    expectedFiles.size > 0
  ) {
    throw new Error(
      "C6 commit-count qualification capture tree missing entry",
    );
  }
}

async function walkPrivateTree(
  root: string,
  relativeDirectory: string,
  expectedDirectories: Set<string>,
  expectedFiles: Set<string>,
): Promise<void> {
  const directory = relativeDirectory.length === 0
    ? root
    : join(root, ...relativeDirectory.split("/"));
  for (const entry of await readdir(directory, {
    withFileTypes: true,
  })) {
    const relativePath = relativeDirectory.length === 0
      ? entry.name
      : `${relativeDirectory}/${entry.name}`;
    const absolutePath = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        "C6 commit-count qualification capture tree rejects symlink",
      );
    }
    if (entry.isDirectory()) {
      if (!expectedDirectories.delete(relativePath)) {
        throw new Error(
          "C6 commit-count qualification capture tree extra directory",
        );
      }
      if (
        ((await lstat(absolutePath)).mode & 0o777) !==
          DIRECTORY_MODE
      ) {
        throw new Error(
          "C6 commit-count qualification capture directory mode mismatch",
        );
      }
      await walkPrivateTree(
        root,
        relativePath,
        expectedDirectories,
        expectedFiles,
      );
      continue;
    }
    if (
      !entry.isFile() ||
      !expectedFiles.delete(relativePath) ||
      ((await lstat(absolutePath)).mode & 0o777) !==
        CAPTURE_FILE_MODE
    ) {
      throw new Error(
        "C6 commit-count qualification capture file/mode mismatch",
      );
    }
  }
}

function validateGraphqlIdentity(
  response: z.infer<typeof graphqlSuccessSchema>,
  target: z.infer<typeof targetSchema>,
): void {
  const repository = response.data.repository;
  const pull = repository.pullRequest;
  if (
    repository.nameWithOwner.toLowerCase() !==
      target.canonicalRepository ||
    pull.number !== target.pullNumber ||
    normalizeUrl(pull.url) !== normalizeUrl(target.url)
  ) {
    throw new Error(
      "C6 commit-count qualification raw response identity mismatch",
    );
  }
}

function censusResultToPlanTarget(
  result: z.infer<typeof censusResultSchema>,
): z.infer<typeof targetSchema> {
  const separator = result.canonicalAnchorId.lastIndexOf("#");
  const pullNumber = Number(
    result.canonicalAnchorId.slice(separator + 1),
  );
  const [owner, repo] = result.canonicalRepository.split("/");
  return targetSchema.parse({
    authorLogin: result.authorLogin,
    baseRefOid: result.baseRefOid,
    canonicalAnchorId: result.canonicalAnchorId,
    canonicalRepository: result.canonicalRepository,
    captureDirectory:
      `${owner}__${repo}__${pullNumber}`,
    captureOrder: result.deepCaptureOrder,
    createdAt: result.createdAt,
    mergeCommitOid: result.mergeCommitOid,
    mergedAt: result.mergedAt,
    observedReviewCount: result.reviewCount,
    observedReviewThreadCount: result.reviewThreadCount,
    owner,
    pilotRank: result.pilotRank,
    pullNumber,
    repo,
    responseNodeRank: result.responseNodeRank,
    sourceSplit: result.sourceSplit,
    url: result.url,
  });
}

function censusDeepTargetProjection(
  result: z.infer<typeof censusResultSchema>,
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

function deepTargetProjection(
  result: z.infer<typeof qualificationResultSchema>,
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

function requiredAsset(
  files: Map<string, C6AssetLock["files"][number]>,
  path: string,
): C6AssetLock["files"][number] {
  const file = files.get(path);
  if (file === undefined) {
    throw new Error(
      `C6 commit-count qualification capture asset missing ${path}`,
    );
  }
  return file;
}

function reference(
  bytes: Uint8Array,
  path: string,
): z.infer<typeof nonemptyArtifactReferenceSchema> {
  return {
    bytes: bytes.byteLength,
    path: basename(path),
    sha256: sha256(bytes),
  };
}

function canonicalJson(bytes: Uint8Array, label: string): unknown {
  const raw = json(bytes, label);
  if (
    Buffer.from(bytes).toString("utf8") !==
      `${JSON.stringify(raw, null, 2)}\n`
  ) {
    throw new Error(
      `C6 commit-count qualification noncanonical ${label}`,
    );
  }
  return raw;
}

function json(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(
      `C6 commit-count qualification invalid ${label} JSON`,
    );
  }
}

function stringRecordSchema(value: unknown): Record<string, string> {
  return z.record(z.string(), z.string()).parse(value);
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.toLowerCase().replace(/\/+$/u, "");
  return url.toString();
}

function assertHash(
  bytes: Uint8Array,
  expected: string,
  label: string,
): void {
  if (sha256(bytes) !== expected) {
    throw new Error(
      `C6 commit-count qualification ${label} hash mismatch`,
    );
  }
}

async function assertOwnedOutput(
  outputPath: string,
  temporaryPath: string,
  owned: { dev: number; ino: number },
): Promise<void> {
  const [output, temporary] = await Promise.all([
    lstat(outputPath),
    lstat(temporaryPath),
  ]);
  if (
    !output.isFile() ||
    output.isSymbolicLink() ||
    !temporary.isFile() ||
    temporary.isSymbolicLink() ||
    output.dev !== owned.dev ||
    output.ino !== owned.ino ||
    temporary.dev !== owned.dev ||
    temporary.ino !== owned.ino ||
    (output.mode & 0o777) !== OUTPUT_FILE_MODE ||
    (temporary.mode & 0o777) !== OUTPUT_FILE_MODE
  ) {
    throw new Error(
      "C6 commit-count qualification output identity mismatch",
    );
  }
}

async function removeIfOwned(
  path: string,
  owned: { dev: number; ino: number },
): Promise<void> {
  try {
    const stat = await lstat(path);
    if (
      stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.dev === owned.dev &&
      stat.ino === owned.ino
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
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
