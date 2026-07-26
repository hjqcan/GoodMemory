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

import {
  assertC6NoSymlinkPathComponents,
  buildC6AssetLock,
  readC6StableRegularFile,
  serializeC6AssetLock,
} from "./c6-asset-lock";
import type { C6AssetLock } from "./c6-asset-lock";
import {
  C6_GITHUB_GRAPHQL_DISCOVERY_QUERY,
} from "./c6-github-graphql-discovery";
import {
  C6_LIVE_MULTILANG_NEIGHBOR_CENSUS_QUERY,
} from "./c6-live-multilang-neighbor-census-capture";
import {
  deriveC6LiveMultiLangNeighborCensusContinuationPlan,
  serializeC6LiveMultiLangNeighborCensusContinuationPlan,
} from "./c6-live-multilang-neighbor-census-continuation-plan";
import {
  deriveC6LiveMultiLangNeighborCensusPlan,
  serializeC6LiveMultiLangNeighborCensusPlan,
} from "./c6-live-multilang-neighbor-census-plan";
import type {
  C6LiveMultiLangCanonicalObservation,
} from "./c6-live-multilang-neighbor-census-plan";
import {
  projectC6SWEbenchLiveMultiLangCapturePlan,
  serializeC6SWEbenchLiveMultiLangCapturePlan,
} from "./c6-swe-bench-live-multilang-capture-plan";

const ARTIFACT_KIND =
  "c6-live-multilang-neighbor-census-qualification";
const DATASET_ID = "SWE-bench-Live/MultiLang";
const SOURCE_REVISION =
  "608f7ae9ab8ea1f9f0d030fe04562cf6bd1a0c8b";
const SOURCE_ANCHOR_COUNT = 743;
const NEIGHBOR_REPOSITORY_COUNT = 64;
const NEIGHBOR_CENSUS_CAP = 16;
const NEIGHBOR_ROOT_FILE_COUNT =
  NEIGHBOR_REPOSITORY_COUNT * 4 + 1;
const SOURCE_GRAPHQL_ROOT_FILE_COUNT = SOURCE_ANCHOR_COUNT * 4;
const CAPTURE_FILES = [
  "capture.json",
  "request.json",
  "response-headers.json",
  "response.json",
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
const FORBIDDEN_SELECTION_INPUTS = [
  "body",
  "diff",
  "files",
  "gold",
  "machineDecision",
  "outcome",
  "patch",
  "semanticDecision",
  "test",
] as const;
const QUALIFICATION_POLICY = {
  canonicalIdentity:
    "lowercase-resolved-repository-plus-pull-number",
  classification:
    "reviewCount-positive-or-reviewThreadCount-positive",
  deduplication:
    "canonicalize-then-group-before-existing-anchor-exclusion",
  existingAnchorExclusion:
    "exclude-all-743-reconstructed-canonical-source-anchors",
  forbiddenSelectionInputs: FORBIDDEN_SELECTION_INPUTS,
  noRepositoryCapOrResampling: true,
  resultOrder: "pilotRank-then-responseNodeRank",
  schemaVersion: 1,
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
  bytes: z.number().int().nonnegative(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const sourceTargetSchema = z.object({
  captureDirectory: z.string().min(1),
  captureOrder: z.number().int().positive(),
  owner: z.string().min(1),
  pullNumber: z.number().int().positive(),
  repo: z.string().min(1),
  requestedAnchorId: anchorSchema,
  sourceSplit: sourceSplitSchema,
}).passthrough();
const sourceCapturePlanSchema = z.object({
  artifactKind: z.literal(
    "c6-swe-bench-live-multilang-capture-plan",
  ),
  counts: z.object({
    sourceRowCount: z.literal(SOURCE_ANCHOR_COUNT),
    targetCount: z.literal(SOURCE_ANCHOR_COUNT),
  }).passthrough(),
  independenceBoundary: z.object({
    targetProjectionSha256: sha256Schema,
  }).passthrough(),
  schemaVersion: z.literal(1),
  sourcePool: z.object({
    datasetId: z.literal(DATASET_ID),
    revision: z.literal(SOURCE_REVISION),
  }).passthrough(),
  targets: z.array(sourceTargetSchema).length(SOURCE_ANCHOR_COUNT),
}).passthrough();
const actorFrameSchema = z.object({
  artifactKind: z.literal(
    "c6-reviewer-actor-qualified-screening-frame",
  ),
  candidates: z.array(z.object({
    canonicalRepository: repositorySchema,
  }).passthrough()).min(1),
  counts: z.object({
    combinedStructuralCandidateCount: z.number().int().positive(),
    repositoryCount: z.number().int().positive(),
  }).passthrough(),
  independenceBoundary: z.object({
    candidateProjectionSha256: sha256Schema,
  }).passthrough(),
  schemaVersion: z.literal(1),
}).passthrough();
const neighborTargetSchema = z.object({
  canonicalRepository: repositorySchema,
  censusCap: z.literal(NEIGHBOR_CENSUS_CAP),
  owner: z.string().min(1),
  pilotRank: z.number().int().positive(),
  repo: z.string().min(1),
  seedAnchorId: anchorSchema,
  seedCaptureOrder: z.number().int().positive(),
  sourceSplit: sourceSplitSchema,
  withinSplitRank: z.number().int().positive(),
}).strict();
const neighborPlanSchema = z.object({
  artifactKind: z.literal(
    "c6-live-multilang-neighbor-census-plan",
  ),
  counts: z.object({
    censusCandidateCeiling: z.literal(
      NEIGHBOR_REPOSITORY_COUNT * NEIGHBOR_CENSUS_CAP,
    ),
    selectedRepositoryCount: z.literal(
      NEIGHBOR_REPOSITORY_COUNT,
    ),
    sourceAnchorCount: z.literal(SOURCE_ANCHOR_COUNT),
  }).passthrough(),
  independenceBoundary: z.object({
    existingAnchorProjectionSha256: sha256Schema,
    selectedRepositoryProjectionSha256: sha256Schema,
  }).passthrough(),
  inputs: z.object({
    capturePlan: referenceSchema,
    capturePlanTargetProjectionSha256: sha256Schema,
    graphqlRootSha256: sha256Schema,
  }).passthrough(),
  schemaVersion: z.literal(1),
  targets: z.array(neighborTargetSchema).length(
    NEIGHBOR_REPOSITORY_COUNT,
  ),
}).passthrough();
const completionCaptureSchema = z.object({
  canonicalRepository: repositorySchema,
  captureDirectory: z.string().min(1),
  captureManifest: referenceSchema,
  hasNextPage: z.boolean(),
  pilotRank: z.number().int().positive(),
  rawAnchorCount: z.number().int().min(0).max(
    NEIGHBOR_CENSUS_CAP,
  ),
}).strict();
const completionSchema = z.object({
  artifactKind: z.literal(
    "c6-live-multilang-neighbor-census-completion",
  ),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    actorQualifiedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    machineQualifiedEpisodeCount: z.literal(0),
    semanticallyQualifiedEpisodeCount: z.literal(0),
    status: z.literal(
      "merged-pr-metadata-census-complete-raw-anchors-only",
    ),
  }).strict(),
  captures: z.array(completionCaptureSchema).length(
    NEIGHBOR_REPOSITORY_COUNT,
  ),
  counts: z.object({
    capturedRawAnchorCount: z.number().int().nonnegative().max(
      NEIGHBOR_REPOSITORY_COUNT * NEIGHBOR_CENSUS_CAP,
    ),
    completedRepositoryCount: z.literal(
      NEIGHBOR_REPOSITORY_COUNT,
    ),
    maximumRawAnchorCount: z.literal(
      NEIGHBOR_REPOSITORY_COUNT * NEIGHBOR_CENSUS_CAP,
    ),
    truncatedRepositoryCount: z.number().int().min(0).max(
      NEIGHBOR_REPOSITORY_COUNT,
    ),
  }).strict(),
  independenceBoundary: z.object({
    contentFieldsRequested: z.literal(false),
    rawAnchorProjectionSha256: sha256Schema,
    targetOrderPreserved: z.literal(true),
  }).strict(),
  plan: referenceSchema.extend({
    selectedRepositoryProjectionSha256: sha256Schema,
  }).strict(),
  schemaVersion: z.literal(1),
}).strict();
const sourceCaptureSchema = z.object({
  request: z.object({
    body: referenceSchema,
    variables: z.object({
      name: z.string().min(1),
      number: z.number().int().positive(),
      owner: z.string().min(1),
    }).strict(),
  }).passthrough(),
  response: z.object({
    body: referenceSchema,
    headers: referenceSchema,
    httpStatus: z.literal(200),
  }).passthrough(),
  target: z.object({
    pullNumber: z.number().int().positive(),
    repository: repositorySchema,
    repositoryRedirect: z.object({
      requestedRepository: repositorySchema,
      resolvedRepository: repositorySchema,
      status: z.literal("explicit-graphql-resolution-observed"),
    }).strict().optional(),
    url: z.url(),
  }).strict(),
}).passthrough();
const sourceResponseSchema = z.object({
  data: z.object({
    repository: z.object({
      nameWithOwner: repositorySchema,
      pullRequest: z.object({
        baseRepository: z.object({
          nameWithOwner: repositorySchema,
        }).passthrough(),
        number: z.number().int().positive(),
        url: z.url(),
      }).passthrough(),
    }).passthrough(),
  }).passthrough(),
  errors: z.array(z.unknown()).optional(),
}).passthrough();
const neighborCaptureSchema = z.object({
  artifactKind: z.literal(
    "c6-live-multilang-neighbor-census-repository-capture",
  ),
  counts: z.object({
    maximumRawAnchorCount: z.literal(NEIGHBOR_CENSUS_CAP),
    rawAnchorCount: z.number().int().min(0).max(
      NEIGHBOR_CENSUS_CAP,
    ),
    totalMergedPullRequestCount: z.number().int().nonnegative(),
  }).strict(),
  independenceBoundary: z.object({
    contentFieldsRequested: z.literal(false),
    rawAnchorProjectionSha256: sha256Schema,
  }).strict(),
  planTarget: neighborTargetSchema,
  request: z.object({
    canonical: referenceSchema,
    variables: z.object({
      limit: z.literal(NEIGHBOR_CENSUS_CAP),
      name: z.string().min(1),
      owner: z.string().min(1),
    }).strict(),
  }).passthrough(),
  response: z.object({
    body: referenceSchema,
    headers: referenceSchema,
    httpStatus: z.literal(200),
  }).strict(),
  schemaVersion: z.literal(1),
}).passthrough();
const countConnectionSchema = z.object({
  totalCount: z.number().int().nonnegative(),
}).strict();
const neighborPullSchema = z.object({
  author: z.object({
    login: z.string().min(1),
  }).strict().nullable(),
  baseRefOid: commitSchema,
  comments: countConnectionSchema,
  createdAt: z.iso.datetime(),
  mergeCommit: z.object({
    oid: commitSchema,
  }).strict(),
  mergedAt: z.iso.datetime(),
  number: z.number().int().positive(),
  reviews: countConnectionSchema,
  reviewThreads: countConnectionSchema,
  url: z.url(),
}).strict();
const neighborResponseSchema = z.object({
  data: z.object({
    repository: z.object({
      nameWithOwner: repositorySchema,
      pullRequests: z.object({
        nodes: z.array(neighborPullSchema).max(
          NEIGHBOR_CENSUS_CAP,
        ),
        pageInfo: z.object({
          endCursor: z.string().min(1).nullable(),
          hasNextPage: z.boolean(),
        }).strict(),
        totalCount: z.number().int().nonnegative(),
      }).strict(),
    }).strict(),
  }).passthrough(),
  errors: z.array(z.unknown()).optional(),
}).passthrough();
const neighborRequestSchema = z.object({
  query: z.literal(C6_LIVE_MULTILANG_NEIGHBOR_CENSUS_QUERY),
  variables: z.object({
    limit: z.literal(NEIGHBOR_CENSUS_CAP),
    name: z.string().min(1),
    owner: z.string().min(1),
  }).strict(),
}).passthrough();
const sourceAnchorSchema = z.object({
  canonicalAnchorId: anchorSchema,
  captureOrder: z.number().int().positive(),
}).strict();
const observationSchema = z.object({
  authorLogin: z.string().min(1).nullable(),
  baseRefOid: commitSchema,
  canonicalAnchorId: anchorSchema,
  canonicalRepository: repositorySchema,
  captureDirectory: z.string().min(1),
  commentCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  mergeCommitOid: commitSchema,
  mergedAt: z.iso.datetime(),
  pilotRank: z.number().int().positive(),
  responseNodeRank: z.number().int().positive().max(
    NEIGHBOR_CENSUS_CAP,
  ),
  reviewCount: z.number().int().nonnegative(),
  reviewThreadCount: z.number().int().nonnegative(),
  sourceSplit: sourceSplitSchema,
  url: z.url(),
}).strict();
const derivationInputsSchema = z.object({
  actorFrame: referenceSchema,
  actorFrameCandidateProjectionSha256: sha256Schema,
  neighborCompletion: referenceSchema,
  neighborPlan: referenceSchema,
  neighborRootSha256: sha256Schema,
  sourceCapturePlan: referenceSchema,
  sourceGraphqlRootSha256: sha256Schema,
  sourcePool: referenceSchema,
}).strict();
const priorNeighborPlanReferenceSchema = referenceSchema.extend({
  artifactKind: z.literal(
    "c6-live-multilang-neighbor-census-plan",
  ),
  schemaVersion: z.literal(1),
  selectedRepositoryProjectionSha256: sha256Schema,
}).strict();
const continuationDerivationInputsSchema =
  derivationInputsSchema.extend({
    priorNeighborPlan: priorNeighborPlanReferenceSchema,
  }).strict();
const strictActorCandidateSchema = z.object({
  canonicalAnchorId: anchorSchema,
  canonicalRepository: repositorySchema,
  lineageIdentitySha256: sha256Schema,
  requestedAnchorId: anchorSchema,
  screeningRank: z.number().int().positive(),
  source: z.union([
    z.object({
      datasetId: z.literal(
        "ByteDance-Seed/Multi-SWE-bench",
      ),
      path: z.string().min(1),
      rowIndex: z.number().int().nonnegative(),
      rowSha256: sha256Schema,
      sourceRevision: commitSchema,
    }).strict(),
    z.object({
      agentVisibleRequestSha256: sha256Schema,
      datasetId: z.literal(
        "SWE-bench/SWE-bench_Multilingual",
      ),
      instanceId: z.string().min(1),
      rowIndex: z.number().int().nonnegative(),
      sourceRevision: commitSchema,
    }).strict(),
    z.object({
      agentVisibleRequestSha256: sha256Schema,
      datasetId: z.literal(DATASET_ID),
      instanceId: z.string().min(1),
      rowIndex: z.number().int().nonnegative(),
      sourceRevision: commitSchema,
      sourceSplit: sourceSplitSchema,
      sourceSplitRowIndex: z.number().int().nonnegative(),
    }).strict(),
  ]),
  sourceRank: z.number().int().positive(),
  sourceTranche: z.string().min(1),
}).strict();
const actorQualificationReferenceSchema = referenceSchema.extend({
  actorPlanSha256: sha256Schema,
  actorRootSha256: sha256Schema,
  baseQualificationSha256: sha256Schema,
  exactFreshCandidateProjectionSha256: sha256Schema,
  graphqlRootSha256: sha256Schema,
}).strict();
const strictActorFrameSchema = z.object({
  artifactKind: z.literal(
    "c6-reviewer-actor-qualified-screening-frame",
  ),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    automationExclusionComplete: z.literal(false),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    currentFrameSemanticScreeningReady: z.literal(true),
    eventTimeActorTypeProven: z.literal(false),
    headlineRawStructuralCandidateFloorMet: z.literal(false),
    humanReviewerIdentityProven: z.literal(false),
    machineQualifiedEpisodeCount: z.literal(0),
    status: z.literal(
      "platform-user-filtered-prospective-screening-batch-structural-only",
    ),
    structuralCapacityOnly: z.literal(true),
  }).strict(),
  candidates: z.array(strictActorCandidateSchema).min(1),
  counts: z.object({
    actorRequalifiedPriorFrameOverlapCount:
      z.number().int().nonnegative(),
    combinedStructuralCandidateCount: z.number().int().positive(),
    currentFrameScreeningBufferRequired:
      z.number().int().nonnegative(),
    deduplicatedCandidateCount: z.number().int().nonnegative(),
    headlineMinimumEpisodeFloor: z.number().int().positive(),
    headlineRawCandidateShortfall: z.number().int().nonnegative(),
    headlineRepositoryCappedStructuralShortfall:
      z.number().int().nonnegative(),
    liveMultilangActorQualifiedCandidateCount:
      z.number().int().nonnegative(),
    liveMultilangQualificationTargetCount:
      z.number().int().nonnegative(),
    multiSweActorQualifiedCandidateCount:
      z.number().int().nonnegative(),
    multiSweQualificationTargetCount:
      z.number().int().nonnegative(),
    multilingualActorQualifiedCandidateCount:
      z.number().int().nonnegative(),
    multilingualQualificationTargetCount:
      z.number().int().nonnegative(),
    repositoryCappedStructuralCeiling:
      z.number().int().nonnegative(),
    repositoryCount: z.number().int().positive(),
    screeningBatchMinimumEpisodes: z.number().int().positive(),
    screeningBatchRepositoryCappedMargin:
      z.number().int().nonnegative(),
  }).strict(),
  independenceBoundary: z.object({
    candidateProjectionSha256: sha256Schema,
    goldInput: z.literal(false),
    legacyCandidateInput: z.literal(false),
    legacySemanticLedgerInput: z.literal(false),
    liveMultilangCandidateProjectionSha256: sha256Schema,
    machineOutcomeInput: z.literal(false),
    multiSweCandidateProjectionSha256: sha256Schema,
    multilingualCandidateProjectionSha256: sha256Schema,
    semanticLedgerInput: z.literal(false),
    supersededFrameCandidateInput: z.literal(false),
    trancheOrderFrozenBeforeSemanticScreening: z.literal(true),
  }).strict(),
  inputs: z.object({
    liveMultilangQualification: actorQualificationReferenceSchema,
    multiSweQualification: actorQualificationReferenceSchema,
    multilingualQualification: actorQualificationReferenceSchema,
    supersededFrameV4: referenceSchema.extend({
      candidateProjectionSha256: sha256Schema,
      usedForCandidateSelection: z.literal(false),
    }).strict(),
  }).strict(),
  policy: z.object({
    canonicalIdentity: z.literal(
      "lowercase-resolved-repository-plus-pull-number",
    ),
    deduplication: z.literal(
      "first-candidate-in-frozen-tranche-and-capture-order",
    ),
    eligibility: z.literal(
      "actor-filtered-exact-or-actor-requalified-prior-overlap",
    ),
    forbiddenSelectionInputs: z.tuple([
      z.literal("sourceTestSignals"),
      z.literal("patch"),
      z.literal("test"),
      z.literal("gold"),
      z.literal("outcome"),
      z.literal("legacySemanticScreeningDecision"),
      z.literal("semanticScreeningDecision"),
      z.literal("machineQualificationDecision"),
    ]),
    legacyCandidatePolicy: z.literal(
      "excluded-until-separately-actor-qualified",
    ),
    order: z.literal(
      "multi-swe-captureOrder-then-multilingual-captureOrder-then-live-multilang-captureOrder",
    ),
    repositoryCap: z.literal(4),
  }).strict(),
  schemaVersion: z.literal(1),
}).strict();
const strictSourcePoolRowSchema = z.object({
  agentVisibleRequestSha256: sha256Schema,
  baseCommit: commitSchema,
  createdAt: z.iso.datetime(),
  evaluatorOnlySha256: sha256Schema,
  instanceId: z.string().min(1),
  normalizedRowSha256: sha256Schema,
  pullNumber: z.number().int().positive(),
  repository: repositorySchema,
  rowIndex: z.number().int().nonnegative(),
  sourceSplit: sourceSplitSchema,
  sourceSplitRowIndex: z.number().int().nonnegative(),
}).strict();
const strictSourcePoolSchema = z.object({
  artifactKind: z.literal(
    "c6-swe-bench-live-multilang-source-pool",
  ),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    status: z.literal(
      "source-pool-only-graphql-capture-required",
    ),
  }).strict(),
  counts: z.object({
    observedRows: z.literal(SOURCE_ANCHOR_COUNT),
    repositories: z.number().int().positive(),
    splits: z.literal(8),
  }).strict(),
  independenceBoundary: z.object({
    captureTargetProjectionSha256: sha256Schema,
    evaluatorFieldSelectionInput: z.literal(false),
    machineOutcomeInput: z.literal(false),
    selection: z.literal("all-frozen-source-rows"),
    semanticLedgerInput: z.literal(false),
  }).strict(),
  rows: z.array(strictSourcePoolRowSchema).length(
    SOURCE_ANCHOR_COUNT,
  ),
  schemaVersion: z.literal(1),
  source: z.object({
    artifacts: z.array(z.object({
      bytes: z.number().int().positive(),
      path: z.string().min(1),
      sha256: sha256Schema,
      split: sourceSplitSchema,
    }).strict()).length(8),
    datasetCardLicense: z.literal("MIT"),
    datasetCardLicenseEvidence: referenceSchema,
    datasetId: z.literal(DATASET_ID),
    format: z.literal("parquet"),
    revision: z.literal(SOURCE_REVISION),
    splitOrder: z.tuple([
      z.literal("c"),
      z.literal("cpp"),
      z.literal("go"),
      z.literal("js"),
      z.literal("rust"),
      z.literal("java"),
      z.literal("ts"),
      z.literal("cs"),
    ]),
    webpage: z.literal(
      "https://huggingface.co/datasets/SWE-bench-Live/MultiLang",
    ),
  }).strict(),
}).strict();
const strictSourceTargetSchema = z.object({
  agentVisibleRequestSha256: sha256Schema,
  captureDirectory: z.string().min(1),
  captureOrder: z.number().int().positive(),
  instanceId: z.string().min(1),
  owner: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
  pullNumber: z.number().int().positive(),
  repo: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
  requestedAnchorId: anchorSchema,
  rowIndex: z.number().int().nonnegative(),
  sourceSplit: sourceSplitSchema,
  sourceSplitRowIndex: z.number().int().nonnegative(),
}).strict();
const strictSourceCapturePlanSchema = z.object({
  artifactKind: z.literal(
    "c6-swe-bench-live-multilang-capture-plan",
  ),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    captureExecuted: z.literal(false),
    codexRunReady: z.literal(false),
    status: z.literal("graphql-capture-plan-only"),
  }).strict(),
  counts: z.object({
    repositoryCount: z.number().int().positive(),
    sourceRowCount: z.literal(SOURCE_ANCHOR_COUNT),
    targetCount: z.literal(SOURCE_ANCHOR_COUNT),
  }).strict(),
  independenceBoundary: z.object({
    evaluatorFieldInput: z.literal(false),
    machineOutcomeInput: z.literal(false),
    selection: z.literal("all-frozen-source-rows"),
    semanticLedgerInput: z.literal(false),
    sourceCaptureTargetProjectionSha256: sha256Schema,
    targetProjectionSha256: sha256Schema,
  }).strict(),
  rule: z.object({
    captureOrder: z.literal("source-rowIndex-ascending"),
    canonicalDeduplication: z.literal(
      "deferred-until-captured-resolution",
    ),
    selection: z.literal("all-frozen-source-rows"),
  }).strict(),
  schemaVersion: z.literal(1),
  sourcePool: referenceSchema.extend({
    datasetId: z.literal(DATASET_ID),
    revision: z.literal(SOURCE_REVISION),
  }).strict(),
  targets: z.array(strictSourceTargetSchema).length(
    SOURCE_ANCHOR_COUNT,
  ),
}).strict();
const continuationTargetSchema = neighborTargetSchema.extend({
  withinSplitRank: z.number().int().min(9).max(16),
}).strict();
const continuationPlanBindingSchema = z.object({
  artifactKind: z.literal(
    "c6-live-multilang-neighbor-census-plan",
  ),
  priorPlan: priorNeighborPlanReferenceSchema,
  schemaVersion: z.literal(2),
  selectedRepositoryProjectionSha256: sha256Schema,
  sha256: sha256Schema,
}).strict();
const continuationCompletionCaptureSchema =
  completionCaptureSchema;
const continuationCompletionSchema = z.object({
  artifactKind: z.literal(
    "c6-live-multilang-neighbor-census-completion",
  ),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    actorQualifiedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    machineQualifiedEpisodeCount: z.literal(0),
    semanticallyQualifiedEpisodeCount: z.literal(0),
    status: z.literal(
      "merged-pr-metadata-census-complete-raw-anchors-only",
    ),
  }).strict(),
  captures: z.array(continuationCompletionCaptureSchema).length(
    NEIGHBOR_REPOSITORY_COUNT,
  ),
  counts: z.object({
    capturedRawAnchorCount: z.number().int().nonnegative().max(
      NEIGHBOR_REPOSITORY_COUNT * NEIGHBOR_CENSUS_CAP,
    ),
    completedRepositoryCount: z.literal(
      NEIGHBOR_REPOSITORY_COUNT,
    ),
    maximumRawAnchorCount: z.literal(
      NEIGHBOR_REPOSITORY_COUNT * NEIGHBOR_CENSUS_CAP,
    ),
    truncatedRepositoryCount: z.number().int().min(0).max(
      NEIGHBOR_REPOSITORY_COUNT,
    ),
  }).strict(),
  independenceBoundary: z.object({
    contentFieldsRequested: z.literal(false),
    rawAnchorProjectionSha256: sha256Schema,
    targetOrderPreserved: z.literal(true),
  }).strict(),
  plan: referenceSchema.extend({
    artifactKind: z.literal(
      "c6-live-multilang-neighbor-census-plan",
    ),
    priorPlan: priorNeighborPlanReferenceSchema,
    schemaVersion: z.literal(2),
    selectedRepositoryProjectionSha256: sha256Schema,
  }).strict(),
  schemaVersion: z.literal(2),
}).strict();
const continuationCaptureSchema = z.object({
  artifactKind: z.literal(
    "c6-live-multilang-neighbor-census-repository-capture",
  ),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    actorQualifiedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    machineQualifiedEpisodeCount: z.literal(0),
    semanticallyQualifiedEpisodeCount: z.literal(0),
    status: z.literal(
      "merged-pr-metadata-census-only-raw-anchors",
    ),
  }).strict(),
  counts: z.object({
    maximumRawAnchorCount: z.literal(NEIGHBOR_CENSUS_CAP),
    rawAnchorCount: z.number().int().min(0).max(
      NEIGHBOR_CENSUS_CAP,
    ),
    totalMergedPullRequestCount: z.number().int().nonnegative(),
  }).strict(),
  discovery: z.object({
    endCursor: z.string().min(1).nullable(),
    hasNextPage: z.boolean(),
    rateLimit: z.object({
      cost: z.number().int().nonnegative(),
      remaining: z.number().int().nonnegative(),
      resetAt: z.iso.datetime(),
    }).strict(),
  }).strict(),
  independenceBoundary: z.object({
    contentFieldsRequested: z.literal(false),
    rawAnchorProjectionSha256: sha256Schema,
  }).strict(),
  plan: continuationPlanBindingSchema,
  planTarget: continuationTargetSchema,
  request: z.object({
    canonical: referenceSchema,
    endpoint: z.literal("https://api.github.com/graphql"),
    headers: z.object({
      accept: z.literal("application/vnd.github+json"),
      authorization: z.literal("Bearer [REDACTED]"),
      "content-type": z.literal("application/json"),
      "user-agent": z.literal(
        "GoodMemory-C6-Neighbor-Census/1",
      ),
      "x-github-api-version": z.literal("2022-11-28"),
    }).strict(),
    method: z.literal("POST"),
    variables: z.object({
      limit: z.literal(NEIGHBOR_CENSUS_CAP),
      name: z.string().min(1),
      owner: z.string().min(1),
    }).strict(),
  }).strict(),
  response: z.object({
    body: referenceSchema,
    headers: referenceSchema,
    httpStatus: z.literal(200),
  }).strict(),
  schemaVersion: z.literal(2),
}).strict();
const continuationRequestSchema = z.object({
  endpoint: z.literal("https://api.github.com/graphql"),
  headers: z.object({
    accept: z.literal("application/vnd.github+json"),
    authorization: z.literal("Bearer [REDACTED]"),
    "content-type": z.literal("application/json"),
    "user-agent": z.literal(
      "GoodMemory-C6-Neighbor-Census/1",
    ),
    "x-github-api-version": z.literal("2022-11-28"),
  }).strict(),
  method: z.literal("POST"),
  query: z.literal(C6_LIVE_MULTILANG_NEIGHBOR_CENSUS_QUERY),
  variables: z.object({
    limit: z.literal(NEIGHBOR_CENSUS_CAP),
    name: z.string().min(1),
    owner: z.string().min(1),
  }).strict(),
}).strict();
const strictResponseHeadersSchema = z.object({
  "content-type": z.string().min(1),
  date: z.string().min(1),
  etag: z.string().min(1).optional(),
  "x-github-request-id": z.string().min(1),
  "x-ratelimit-limit": z.string().regex(/^\d+$/u),
  "x-ratelimit-remaining": z.string().regex(/^\d+$/u),
  "x-ratelimit-reset": z.string().regex(/^\d+$/u),
  "x-ratelimit-resource": z.literal("graphql"),
  "x-ratelimit-used": z.string().regex(/^\d+$/u),
}).strict();
const continuationResponseSchema = z.object({
  data: z.object({
    rateLimit: z.object({
      cost: z.number().int().nonnegative(),
      remaining: z.number().int().nonnegative(),
      resetAt: z.iso.datetime(),
    }).strict(),
    repository: z.object({
      nameWithOwner: repositorySchema,
      pullRequests: z.object({
        nodes: z.array(neighborPullSchema).max(
          NEIGHBOR_CENSUS_CAP,
        ),
        pageInfo: z.object({
          endCursor: z.string().min(1).nullable(),
          hasNextPage: z.boolean(),
        }).strict(),
        totalCount: z.number().int().nonnegative(),
      }).strict(),
    }).strict(),
  }).strict(),
  errors: z.array(z.never()).optional(),
}).strict();
const sourcePageInfoSchema = z.object({
  endCursor: z.string().nullable(),
  hasNextPage: z.boolean(),
}).strict();
const sourceAuthorSchema = z.object({
  login: z.string().min(1),
}).strict().nullable();
const sourceCaptureStrictSchema = z.object({
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    status: z.literal(
      "single-pr-graphql-discovery-not-accepted-evidence",
    ),
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
    body: referenceSchema,
    endpoint: z.literal("https://api.github.com/graphql"),
    headers: z.object({
      accept: z.literal("application/vnd.github+json"),
      authorization: z.literal("Bearer [REDACTED]"),
      "content-type": z.literal("application/json"),
      "user-agent": z.literal(
        "GoodMemory-C6-GraphQL-Discovery/1",
      ),
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
    body: referenceSchema,
    headers: referenceSchema,
    httpStatus: z.literal(200),
  }).strict(),
  schemaVersion: z.literal(1),
  target: z.object({
    pullNumber: z.number().int().positive(),
    repository: repositorySchema,
    repositoryRedirect: z.object({
      requestedRepository: repositorySchema,
      resolvedRepository: repositorySchema,
      status: z.literal(
        "explicit-graphql-resolution-observed",
      ),
    }).strict().optional(),
    url: z.url(),
  }).strict(),
}).strict();
const sourceRequestStrictSchema = z.object({
  query: z.literal(C6_GITHUB_GRAPHQL_DISCOVERY_QUERY),
  variables: z.object({
    name: z.string().min(1),
    number: z.number().int().positive(),
    owner: z.string().min(1),
  }).strict(),
}).strict();
const sourceConnectionSchema = <T extends z.ZodType>(
  node: T,
) => z.object({
  nodes: z.array(node),
  pageInfo: sourcePageInfoSchema,
}).strict();
const sourceResponseStrictSchema = z.object({
  data: z.object({
    rateLimit: z.object({
      cost: z.number().int().nonnegative(),
      remaining: z.number().int().nonnegative(),
      resetAt: z.iso.datetime(),
    }).strict(),
    repository: z.object({
      nameWithOwner: repositorySchema,
      pullRequest: z.object({
        baseRefName: z.string(),
        baseRefOid: commitSchema,
        baseRepository: z.object({
          nameWithOwner: repositorySchema,
        }).strict(),
        closingIssuesReferences: sourceConnectionSchema(z.object({
          body: z.string(),
          createdAt: z.iso.datetime(),
          number: z.number().int().positive(),
          title: z.string(),
          updatedAt: z.iso.datetime(),
          url: z.url(),
        }).strict().nullable()),
        comments: sourceConnectionSchema(z.object({
          author: sourceAuthorSchema,
          body: z.string(),
          createdAt: z.iso.datetime(),
          databaseId: z.number().int().positive(),
          id: z.string().min(1),
          updatedAt: z.iso.datetime(),
          url: z.url(),
        }).strict().nullable()),
        commits: sourceConnectionSchema(z.object({
          commit: z.object({
            committedDate: z.iso.datetime(),
            oid: commitSchema,
            parents: sourceConnectionSchema(z.object({
              oid: commitSchema,
            }).strict().nullable()),
          }).strict(),
        }).strict().nullable()),
        headRefName: z.string().nullable(),
        headRefOid: commitSchema.nullable(),
        headRepository: z.object({
          nameWithOwner: repositorySchema,
        }).strict().nullable(),
        id: z.string().min(1),
        isCrossRepository: z.boolean(),
        mergeCommit: z.object({
          oid: commitSchema,
        }).strict(),
        merged: z.boolean(),
        mergedAt: z.iso.datetime(),
        number: z.number().int().positive(),
        reviewThreads: sourceConnectionSchema(z.object({
          comments: sourceConnectionSchema(z.object({
            author: sourceAuthorSchema,
            body: z.string(),
            commit: z.object({
              oid: commitSchema,
            }).strict().nullable(),
            createdAt: z.iso.datetime(),
            databaseId: z.number().int().positive(),
            id: z.string().min(1),
            line: z.number().int().positive().nullable(),
            originalCommit: z.object({
              oid: commitSchema,
            }).strict().nullable(),
            originalLine: z.number().int().positive().nullable(),
            path: z.string().min(1),
            updatedAt: z.iso.datetime(),
            url: z.url(),
          }).strict().nullable()),
          id: z.string().min(1),
          isResolved: z.boolean(),
        }).strict().nullable()),
        reviews: sourceConnectionSchema(z.object({
          author: sourceAuthorSchema,
          body: z.string(),
          commit: z.object({
            oid: commitSchema,
          }).strict().nullable(),
          databaseId: z.number().int().positive(),
          id: z.string().min(1),
          state: z.string().min(1),
          submittedAt: z.iso.datetime(),
        }).strict().nullable()),
        state: z.string().min(1),
        url: z.url(),
      }).strict(),
    }).strict(),
  }).strict(),
  errors: z.array(z.never()).optional(),
}).strict();

type ArtifactReference = z.infer<typeof referenceSchema>;
type NeighborTarget = z.infer<typeof neighborTargetSchema>;
type SourceAnchor = z.infer<typeof sourceAnchorSchema>;
type SourceSplit = z.infer<typeof sourceSplitSchema>;

export interface C6LiveMultiLangNeighborCensusObservation {
  authorLogin: string | null;
  baseRefOid: string;
  canonicalAnchorId: string;
  canonicalRepository: string;
  captureDirectory: string;
  commentCount: number;
  createdAt: string;
  mergeCommitOid: string;
  mergedAt: string;
  pilotRank: number;
  responseNodeRank: number;
  reviewCount: number;
  reviewThreadCount: number;
  sourceSplit: SourceSplit;
  url: string;
}

export interface C6LiveMultiLangNeighborCensusQualificationResult {
  authorLogin: string | null;
  baseRefOid: string;
  canonicalAnchorId: string;
  canonicalRepository: string;
  commentCount: number;
  createdAt: string;
  deepCaptureOrder?: number;
  mergeCommitOid: string;
  mergedAt: string;
  observationRefs: Array<{
    captureDirectory: string;
    pilotRank: number;
    responseNodeRank: number;
    sourceSplit: SourceSplit;
  }>;
  pilotRank: number;
  responseNodeRank: number;
  reviewCount: number;
  reviewThreadCount: number;
  sourceSplit: SourceSplit;
  status:
    | "existing-source-anchor"
    | "novel-no-review-surface"
    | "novel-review-surface-deep-capture-target";
  url: string;
}

export interface C6LiveMultiLangNeighborCensusQualification {
  artifactKind: typeof ARTIFACT_KIND;
  boundary: {
    acceptedEpisodeCount: 0;
    actorCaptureExecuted: false;
    actorQualifiedEpisodeCount: 0;
    candidateManifestFrozen: false;
    canonicalPullDeduplicationComplete: true;
    codexRunReady: false;
    deepCaptureExecuted: false;
    existingAnchorExclusionComplete: true;
    machineQualifiedEpisodeCount: 0;
    populationRepresentativenessProven: false;
    semanticallyQualifiedEpisodeCount: 0;
    status:
      "novel-review-surface-pretargets-deep-capture-required";
  };
  counts: {
    capturedRepositoryCount: number;
    deepCaptureTargetCount: number;
    duplicateObservationCount: number;
    existingAnchorOverlapCount: number;
    novelCanonicalPullCount: number;
    novelWithReviewSurfaceCount: number;
    novelWithoutReviewSurfaceCount: number;
    rawObservationCount: number;
    sourceCanonicalAnchorCount: 743;
    truncatedRepositoryCount: number;
    uniqueCanonicalPullCount: number;
  };
  independenceBoundary: {
    canonicalPullProjectionSha256: string;
    deepCaptureTargetProjectionSha256: string;
    excludedAnchorProjectionSha256: string;
    existingAnchorProjectionSha256: string;
    goldInput: false;
    machineOutcomeInput: false;
    metadataQuerySha256: string;
    patchInput: false;
    postMergeStructuralMetadataInput: true;
    qualificationPolicySha256: string;
    semanticDecisionInput: false;
    testInput: false;
  };
  inputs: z.infer<typeof derivationInputsSchema>;
  repositoryCounts: Array<{
    canonicalRepository: string;
    deepCaptureTargetCount: number;
    existingAnchorOverlapCount: number;
    novelCanonicalPullCount: number;
    rawObservationCount: number;
    uniqueCanonicalPullCount: number;
  }>;
  results: C6LiveMultiLangNeighborCensusQualificationResult[];
  rule: typeof QUALIFICATION_POLICY;
  sampleBoundary: {
    adaptiveRepositoryExclusion: true;
    mergedPullRequestsOnly: true;
    newestPerRepositoryCap: 16;
    postMergeStructuralMetadataInput: true;
    repositorySampleRandom: false;
    reviewSurfaceEnrichmentApplied: true;
  };
  schemaVersion: 2;
  sourceDataset: {
    datasetId: typeof DATASET_ID;
    revision: typeof SOURCE_REVISION;
  };
  splitCounts: Record<SourceSplit, {
    deepCaptureTargetCount: number;
    existingAnchorOverlapCount: number;
    novelCanonicalPullCount: number;
    rawObservationCount: number;
    uniqueCanonicalPullCount: number;
  }>;
}

export interface C6LiveMultiLangNeighborCensusContinuationQualification
  extends Omit<
    C6LiveMultiLangNeighborCensusQualification,
    "independenceBoundary" | "inputs" | "sampleBoundary" |
      "schemaVersion"
  > {
  independenceBoundary:
    C6LiveMultiLangNeighborCensusQualification[
      "independenceBoundary"
    ] & {
      priorTrancheOutcomeInput: false;
    };
  inputs: z.infer<typeof continuationDerivationInputsSchema>;
  sampleBoundary:
    C6LiveMultiLangNeighborCensusQualification[
      "sampleBoundary"
    ] & {
      censusTranche: 2;
    };
  schemaVersion: 3;
}

export function deriveC6LiveMultiLangNeighborCensusQualification(
  input: {
    capturedRepositoryCount: number;
    inputs: z.input<typeof derivationInputsSchema>;
    observations:
      readonly C6LiveMultiLangNeighborCensusObservation[];
    sourceAnchors: readonly SourceAnchor[];
    truncatedRepositoryCount: number;
  },
): C6LiveMultiLangNeighborCensusQualification {
  if (
    !Number.isSafeInteger(input.capturedRepositoryCount) ||
    input.capturedRepositoryCount < 0 ||
    !Number.isSafeInteger(input.truncatedRepositoryCount) ||
    input.truncatedRepositoryCount < 0 ||
    input.truncatedRepositoryCount > input.capturedRepositoryCount
  ) {
    throw new Error("C6 neighbor qualification invalid capture counts");
  }
  const inputs = derivationInputsSchema.parse(input.inputs);
  const sourceAnchors = input.sourceAnchors.map((value) => {
    const parsed = sourceAnchorSchema.parse(value);
    return {
      canonicalAnchorId: normalizeAnchor(parsed.canonicalAnchorId),
      captureOrder: parsed.captureOrder,
    };
  });
  assertSourceAnchors(sourceAnchors);
  const observations = input.observations.map((value) => {
    const parsed = observationSchema.parse(value);
    const canonicalRepository = normalizeRepository(
      parsed.canonicalRepository,
    );
    const canonicalAnchorId = normalizeAnchor(
      parsed.canonicalAnchorId,
    );
    if (
      canonicalAnchorId !==
        `${canonicalRepository}#${
          parseAnchor(canonicalAnchorId).pullNumber
        }`
    ) {
      throw new Error(
        `C6 neighbor qualification observation identity mismatch ${
          canonicalAnchorId
        }`,
      );
    }
    return {
      ...parsed,
      canonicalAnchorId,
      canonicalRepository,
    };
  });
  assertObservationOrder(observations);

  const grouped = new Map<
    string,
    C6LiveMultiLangNeighborCensusObservation[]
  >();
  for (const observation of observations) {
    const prior = grouped.get(observation.canonicalAnchorId);
    if (prior === undefined) {
      grouped.set(observation.canonicalAnchorId, [observation]);
    } else {
      assertDuplicateMetadata(prior[0]!, observation);
      prior.push(observation);
    }
  }
  const sourceAnchorSet = new Set(
    sourceAnchors.map((anchor) => anchor.canonicalAnchorId),
  );
  let deepCaptureOrder = 0;
  const results = [...grouped.values()].map((group) => {
    const primary = group[0]!;
    const existing = sourceAnchorSet.has(primary.canonicalAnchorId);
    const hasReviewSurface =
      primary.reviewCount > 0 || primary.reviewThreadCount > 0;
    const status = existing
      ? "existing-source-anchor" as const
      : hasReviewSurface
        ? "novel-review-surface-deep-capture-target" as const
        : "novel-no-review-surface" as const;
    if (
      status ===
        "novel-review-surface-deep-capture-target"
    ) {
      deepCaptureOrder += 1;
    }
    return {
      authorLogin: primary.authorLogin,
      baseRefOid: primary.baseRefOid,
      canonicalAnchorId: primary.canonicalAnchorId,
      canonicalRepository: primary.canonicalRepository,
      commentCount: primary.commentCount,
      createdAt: primary.createdAt,
      ...(status ===
          "novel-review-surface-deep-capture-target"
        ? { deepCaptureOrder }
        : {}),
      mergeCommitOid: primary.mergeCommitOid,
      mergedAt: primary.mergedAt,
      observationRefs: group.map((observation) => ({
        captureDirectory: observation.captureDirectory,
        pilotRank: observation.pilotRank,
        responseNodeRank: observation.responseNodeRank,
        sourceSplit: observation.sourceSplit,
      })),
      pilotRank: primary.pilotRank,
      responseNodeRank: primary.responseNodeRank,
      reviewCount: primary.reviewCount,
      reviewThreadCount: primary.reviewThreadCount,
      sourceSplit: primary.sourceSplit,
      status,
      url: primary.url,
    };
  });
  const existing = results.filter(
    (result) => result.status === "existing-source-anchor",
  );
  const deepTargets = results.filter(
    (result) =>
      result.status ===
        "novel-review-surface-deep-capture-target",
  );
  const novelWithoutReview = results.filter(
    (result) => result.status === "novel-no-review-surface",
  );
  const novelCount = results.length - existing.length;
  const counts = {
    capturedRepositoryCount: input.capturedRepositoryCount,
    deepCaptureTargetCount: deepTargets.length,
    duplicateObservationCount:
      observations.length - results.length,
    existingAnchorOverlapCount: existing.length,
    novelCanonicalPullCount: novelCount,
    novelWithReviewSurfaceCount: deepTargets.length,
    novelWithoutReviewSurfaceCount: novelWithoutReview.length,
    rawObservationCount: observations.length,
    sourceCanonicalAnchorCount: SOURCE_ANCHOR_COUNT as 743,
    truncatedRepositoryCount: input.truncatedRepositoryCount,
    uniqueCanonicalPullCount: results.length,
  };
  assertCountIdentities(counts);

  return {
    artifactKind: ARTIFACT_KIND,
    boundary: {
      acceptedEpisodeCount: 0,
      actorCaptureExecuted: false,
      actorQualifiedEpisodeCount: 0,
      candidateManifestFrozen: false,
      canonicalPullDeduplicationComplete: true,
      codexRunReady: false,
      deepCaptureExecuted: false,
      existingAnchorExclusionComplete: true,
      machineQualifiedEpisodeCount: 0,
      populationRepresentativenessProven: false,
      semanticallyQualifiedEpisodeCount: 0,
      status:
        "novel-review-surface-pretargets-deep-capture-required",
    },
    counts,
    independenceBoundary: {
      canonicalPullProjectionSha256: sha256(JSON.stringify(
        results.map(canonicalPullProjection),
      )),
      deepCaptureTargetProjectionSha256: sha256(JSON.stringify(
        deepTargets.map(deepCaptureTargetProjection),
      )),
      excludedAnchorProjectionSha256: sha256(JSON.stringify(
        existing.map((result) => result.canonicalAnchorId),
      )),
      existingAnchorProjectionSha256: sha256(JSON.stringify(
        sourceAnchors,
      )),
      goldInput: false,
      machineOutcomeInput: false,
      metadataQuerySha256: sha256(
        C6_LIVE_MULTILANG_NEIGHBOR_CENSUS_QUERY,
      ),
      patchInput: false,
      postMergeStructuralMetadataInput: true,
      qualificationPolicySha256: sha256(
        serializeQualificationPolicy(),
      ),
      semanticDecisionInput: false,
      testInput: false,
    },
    inputs,
    repositoryCounts: aggregateRepositoryCounts(
      observations,
      results,
    ),
    results,
    rule: QUALIFICATION_POLICY,
    sampleBoundary: {
      adaptiveRepositoryExclusion: true,
      mergedPullRequestsOnly: true,
      newestPerRepositoryCap: NEIGHBOR_CENSUS_CAP,
      postMergeStructuralMetadataInput: true,
      repositorySampleRandom: false,
      reviewSurfaceEnrichmentApplied: true,
    },
    schemaVersion: 2,
    sourceDataset: {
      datasetId: DATASET_ID,
      revision: SOURCE_REVISION,
    },
    splitCounts: aggregateSplitCounts(observations, results),
  };
}

export function deriveC6LiveMultiLangNeighborCensusContinuationQualification(
  input: {
    capturedRepositoryCount: number;
    inputs: z.input<typeof continuationDerivationInputsSchema>;
    observations:
      readonly C6LiveMultiLangNeighborCensusObservation[];
    sourceAnchors: readonly SourceAnchor[];
    truncatedRepositoryCount: number;
  },
): C6LiveMultiLangNeighborCensusContinuationQualification {
  const inputs = continuationDerivationInputsSchema.parse(
    input.inputs,
  );
  const qualification =
    deriveC6LiveMultiLangNeighborCensusQualification({
      ...input,
      inputs: {
        actorFrame: inputs.actorFrame,
        actorFrameCandidateProjectionSha256:
          inputs.actorFrameCandidateProjectionSha256,
        neighborCompletion: inputs.neighborCompletion,
        neighborPlan: inputs.neighborPlan,
        neighborRootSha256: inputs.neighborRootSha256,
        sourceCapturePlan: inputs.sourceCapturePlan,
        sourceGraphqlRootSha256: inputs.sourceGraphqlRootSha256,
        sourcePool: inputs.sourcePool,
      },
    });
  return {
    ...qualification,
    independenceBoundary: {
      ...qualification.independenceBoundary,
      priorTrancheOutcomeInput: false,
    },
    inputs,
    sampleBoundary: {
      ...qualification.sampleBoundary,
      censusTranche: 2,
    },
    schemaVersion: 3,
  };
}

export function serializeC6LiveMultiLangNeighborCensusQualification(
  qualification: C6LiveMultiLangNeighborCensusQualification,
): string {
  return `${JSON.stringify(qualification, null, 2)}\n`;
}

export function serializeC6LiveMultiLangNeighborCensusContinuationQualification(
  qualification:
    C6LiveMultiLangNeighborCensusContinuationQualification,
): string {
  return `${JSON.stringify(qualification, null, 2)}\n`;
}

export async function buildC6LiveMultiLangNeighborCensusQualification(
  input: {
    actorFramePath: string;
    expectedActorFrameSha256: string;
    expectedNeighborCompletionSha256: string;
    expectedNeighborPlanSha256: string;
    expectedNeighborRootSha256: string;
    expectedSourceCapturePlanSha256: string;
    expectedSourceGraphqlRootSha256: string;
    expectedSourcePoolSha256: string;
    neighborPlanPath: string;
    neighborRoot: string;
    sourceCapturePlanPath: string;
    sourceGraphqlRoot: string;
    sourcePoolPath: string;
    testHooks?: {
      beforeTerminalVerification?: () => Promise<void> | void;
    };
  },
): Promise<{
  outputSha256: string;
  qualification: C6LiveMultiLangNeighborCensusQualification;
}> {
  const expected = {
    actorFrame: sha256Schema.parse(
      input.expectedActorFrameSha256,
    ),
    neighborCompletion: sha256Schema.parse(
      input.expectedNeighborCompletionSha256,
    ),
    neighborPlan: sha256Schema.parse(
      input.expectedNeighborPlanSha256,
    ),
    neighborRoot: sha256Schema.parse(
      input.expectedNeighborRootSha256,
    ),
    sourceCapturePlan: sha256Schema.parse(
      input.expectedSourceCapturePlanSha256,
    ),
    sourceGraphqlRoot: sha256Schema.parse(
      input.expectedSourceGraphqlRootSha256,
    ),
    sourcePool: sha256Schema.parse(
      input.expectedSourcePoolSha256,
    ),
  };
  const [
    actorFramePath,
    neighborPlanPath,
    neighborRoot,
    sourceCapturePlanPath,
    sourceGraphqlRoot,
    sourcePoolPath,
  ] = await Promise.all([
    assertC6NoSymlinkPathComponents(
      input.actorFramePath,
      "C6 neighbor qualification actor frame",
    ),
    assertC6NoSymlinkPathComponents(
      input.neighborPlanPath,
      "C6 neighbor qualification plan",
    ),
    assertC6NoSymlinkPathComponents(
      input.neighborRoot,
      "C6 neighbor qualification capture root",
    ),
    assertC6NoSymlinkPathComponents(
      input.sourceCapturePlanPath,
      "C6 neighbor qualification source plan",
    ),
    assertC6NoSymlinkPathComponents(
      input.sourceGraphqlRoot,
      "C6 neighbor qualification source GraphQL root",
    ),
    assertC6NoSymlinkPathComponents(
      input.sourcePoolPath,
      "C6 neighbor qualification source pool",
    ),
  ]);
  await Promise.all([
    assertNoUntrackedRootAssetLock(
      neighborRoot,
      "neighbor",
    ),
    assertNoUntrackedRootAssetLock(
      sourceGraphqlRoot,
      "source GraphQL",
    ),
  ]);
  const completionPath = join(neighborRoot, "completion.json");
  const [
    actorFrameBytes,
    neighborPlanBytes,
    completionBytes,
    neighborLock,
    sourceCapturePlanBytes,
    sourceLock,
    sourcePoolBytes,
  ] = await Promise.all([
    readC6StableRegularFile(
      actorFramePath,
      "neighbor qualification actor frame",
    ),
    readC6StableRegularFile(
      neighborPlanPath,
      "neighbor qualification plan",
    ),
    readC6StableRegularFile(
      completionPath,
      "neighbor qualification completion",
    ),
    buildC6AssetLock(neighborRoot),
    readC6StableRegularFile(
      sourceCapturePlanPath,
      "neighbor qualification source plan",
    ),
    buildC6AssetLock(sourceGraphqlRoot),
    readC6StableRegularFile(
      sourcePoolPath,
      "neighbor qualification source pool",
    ),
  ]);
  if (
    sha256(actorFrameBytes) !== expected.actorFrame ||
    sha256(neighborPlanBytes) !== expected.neighborPlan ||
    sha256(completionBytes) !== expected.neighborCompletion ||
    neighborLock.assetRootSha256 !== expected.neighborRoot ||
    sha256(sourceCapturePlanBytes) !== expected.sourceCapturePlan ||
    sourceLock.assetRootSha256 !== expected.sourceGraphqlRoot ||
    sha256(sourcePoolBytes) !== expected.sourcePool
  ) {
    throw new Error("C6 neighbor qualification input hash mismatch");
  }
  if (neighborLock.files.length !== NEIGHBOR_ROOT_FILE_COUNT) {
    throw new Error(
      `C6 neighbor qualification requires exactly ${
        NEIGHBOR_ROOT_FILE_COUNT
      } neighbor files`,
    );
  }
  if (sourceLock.files.length !== SOURCE_GRAPHQL_ROOT_FILE_COUNT) {
    throw new Error(
      `C6 neighbor qualification requires exactly ${
        SOURCE_GRAPHQL_ROOT_FILE_COUNT
      } source GraphQL files`,
    );
  }

  const rawNeighborPlan = canonicalJson(
    neighborPlanBytes,
    "neighbor plan",
  );
  const neighborPlan = neighborPlanSchema.parse(rawNeighborPlan);
  const rawCompletion = canonicalJson(
    completionBytes,
    "neighbor completion",
  );
  const completion = completionSchema.parse(rawCompletion);
  const rawSourcePlan = canonicalJson(
    sourceCapturePlanBytes,
    "source capture plan",
  );
  const sourcePlan = sourceCapturePlanSchema.parse(rawSourcePlan);
  const rawActorFrame = canonicalJson(
    actorFrameBytes,
    "actor frame",
  );
  const actorFrame = actorFrameSchema.parse(rawActorFrame);
  const rebuiltSourcePlan =
    projectC6SWEbenchLiveMultiLangCapturePlan({
      sourcePoolBytes,
      sourcePoolPath,
    });
  if (
    serializeC6SWEbenchLiveMultiLangCapturePlan(
      rebuiltSourcePlan,
    ) !== sourceCapturePlanBytes.toString("utf8")
  ) {
    throw new Error(
      "C6 neighbor qualification source-pool plan replay mismatch",
    );
  }
  assertPlanBindings({
    completion,
    expected,
    neighborPlanPath,
    neighborPlan,
    rawNeighborPlan,
    rawSourcePlan,
    sourceCapturePlanPath,
    sourcePlan,
  });
  assertTargetOrder(neighborPlan.targets);
  assertCompletionOrder(completion.captures, neighborPlan.targets);
  if (
    completion.counts.capturedRawAnchorCount !==
      completion.captures.reduce(
        (sum, capture) => sum + capture.rawAnchorCount,
        0,
      ) ||
    completion.counts.truncatedRepositoryCount !==
      completion.captures.filter((capture) => capture.hasNextPage)
        .length
  ) {
    throw new Error(
      "C6 neighbor qualification completion count mismatch",
    );
  }
  assertCaptureRootStructure({
    captures: completion.captures.map((capture) => ({
      captureDirectory: capture.captureDirectory,
    })),
    includeCompletion: true,
    lock: neighborLock,
    label: "neighbor",
  });
  assertCaptureRootStructure({
    captures: sourcePlan.targets,
    includeCompletion: false,
    lock: sourceLock,
    label: "source GraphQL",
  });
  await Promise.all([
    assertExactCaptureTree({
      captures: completion.captures,
      includeCompletion: true,
      label: "neighbor",
      root: neighborRoot,
    }),
    assertExactCaptureTree({
      captures: sourcePlan.targets,
      includeCompletion: false,
      label: "source GraphQL",
      root: sourceGraphqlRoot,
    }),
  ]);

  const sourceCapture = await loadSourceAnchors({
    lock: sourceLock,
    root: sourceGraphqlRoot,
    targets: sourcePlan.targets,
  });
  const sourceAnchors = sourceCapture.anchors;
  const currentFrameRepositories = new Set(
    actorFrame.candidates.map((candidate) =>
      normalizeRepository(candidate.canonicalRepository)
    ),
  );
  if (
    actorFrame.candidates.length !==
      actorFrame.counts.combinedStructuralCandidateCount ||
    currentFrameRepositories.size !==
      actorFrame.counts.repositoryCount ||
    sha256(JSON.stringify(
      (rawActorFrame as { candidates: unknown }).candidates,
    )) !== actorFrame.independenceBoundary.candidateProjectionSha256
  ) {
    throw new Error(
      "C6 neighbor qualification actor-frame projection mismatch",
    );
  }
  const rebuiltNeighborPlan =
    deriveC6LiveMultiLangNeighborCensusPlan({
      currentFrameRepositories,
      inputs: {
        actorFrame: reference(actorFrameBytes, actorFramePath),
        actorFrameCandidateProjectionSha256:
          actorFrame.independenceBoundary.candidateProjectionSha256,
        capturePlan: reference(
          sourceCapturePlanBytes,
          sourceCapturePlanPath,
        ),
        capturePlanTargetProjectionSha256:
          sourcePlan.independenceBoundary.targetProjectionSha256,
        graphqlRootSha256: sourceLock.assetRootSha256,
      },
      observations: sourceCapture.observations,
    });
  if (
    serializeC6LiveMultiLangNeighborCensusPlan(
      rebuiltNeighborPlan,
    ) !== neighborPlanBytes.toString("utf8")
  ) {
    throw new Error(
      "C6 neighbor qualification actor/source plan replay mismatch",
    );
  }
  if (
    sha256(JSON.stringify(sourceAnchors)) !==
      neighborPlan.independenceBoundary
        .existingAnchorProjectionSha256
  ) {
    throw new Error(
      "C6 neighbor qualification existing-anchor projection mismatch",
    );
  }
  const observations = await loadNeighborObservations({
    captures: completion.captures,
    lock: neighborLock,
    planTargets: neighborPlan.targets,
    root: neighborRoot,
  });
  if (
    observations.length !== completion.counts.capturedRawAnchorCount ||
    sha256(JSON.stringify(
      observations.map(rawAnchorProjection),
    )) !== completion.independenceBoundary.rawAnchorProjectionSha256
  ) {
    throw new Error(
      "C6 neighbor qualification raw-anchor projection mismatch",
    );
  }

  const qualification =
    deriveC6LiveMultiLangNeighborCensusQualification({
      capturedRepositoryCount:
        completion.counts.completedRepositoryCount,
      inputs: {
        actorFrame: reference(actorFrameBytes, actorFramePath),
        actorFrameCandidateProjectionSha256:
          actorFrame.independenceBoundary.candidateProjectionSha256,
        neighborCompletion: reference(
          completionBytes,
          completionPath,
        ),
        neighborPlan: reference(
          neighborPlanBytes,
          neighborPlanPath,
        ),
        neighborRootSha256: neighborLock.assetRootSha256,
        sourceCapturePlan: reference(
          sourceCapturePlanBytes,
          sourceCapturePlanPath,
        ),
        sourceGraphqlRootSha256: sourceLock.assetRootSha256,
        sourcePool: reference(sourcePoolBytes, sourcePoolPath),
      },
      observations,
      sourceAnchors,
      truncatedRepositoryCount:
        completion.counts.truncatedRepositoryCount,
    });

  await input.testHooks?.beforeTerminalVerification?.();
  const [
    terminalActorFrameBytes,
    terminalNeighborPlanBytes,
    terminalCompletionBytes,
    terminalNeighborLock,
    terminalSourceCapturePlanBytes,
    terminalSourceLock,
    terminalSourcePoolBytes,
  ] = await Promise.all([
    readC6StableRegularFile(
      actorFramePath,
      "neighbor qualification terminal actor frame",
    ),
    readC6StableRegularFile(
      neighborPlanPath,
      "neighbor qualification terminal plan",
    ),
    readC6StableRegularFile(
      completionPath,
      "neighbor qualification terminal completion",
    ),
    buildC6AssetLock(neighborRoot),
    readC6StableRegularFile(
      sourceCapturePlanPath,
      "neighbor qualification terminal source plan",
    ),
    buildC6AssetLock(sourceGraphqlRoot),
    readC6StableRegularFile(
      sourcePoolPath,
      "neighbor qualification terminal source pool",
    ),
  ]);
  await Promise.all([
    assertNoUntrackedRootAssetLock(
      neighborRoot,
      "neighbor",
    ),
    assertNoUntrackedRootAssetLock(
      sourceGraphqlRoot,
      "source GraphQL",
    ),
    assertExactCaptureTree({
      captures: completion.captures,
      includeCompletion: true,
      label: "neighbor",
      root: neighborRoot,
    }),
    assertExactCaptureTree({
      captures: sourcePlan.targets,
      includeCompletion: false,
      label: "source GraphQL",
      root: sourceGraphqlRoot,
    }),
  ]);
  if (
    !terminalActorFrameBytes.equals(actorFrameBytes) ||
    !terminalNeighborPlanBytes.equals(neighborPlanBytes) ||
    !terminalCompletionBytes.equals(completionBytes) ||
    serializeC6AssetLock(terminalNeighborLock) !==
      serializeC6AssetLock(neighborLock) ||
    !terminalSourceCapturePlanBytes.equals(sourceCapturePlanBytes) ||
    serializeC6AssetLock(terminalSourceLock) !==
      serializeC6AssetLock(sourceLock) ||
    !terminalSourcePoolBytes.equals(sourcePoolBytes)
  ) {
    throw new Error(
      "C6 neighbor qualification input closure changed during projection",
    );
  }
  const serialized =
    serializeC6LiveMultiLangNeighborCensusQualification(
      qualification,
    );
  return {
    outputSha256: sha256(serialized),
    qualification,
  };
}

export async function materializeC6LiveMultiLangNeighborCensusQualification(
  input: Parameters<
    typeof buildC6LiveMultiLangNeighborCensusQualification
  >[0] & {
    outputPath: string;
  },
): Promise<{
  outputSha256: string;
  qualification: C6LiveMultiLangNeighborCensusQualification;
}> {
  const result =
    await buildC6LiveMultiLangNeighborCensusQualification(input);
  const outputPath = resolve(input.outputPath);
  await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 neighbor qualification output parent",
  );
  const handle = await open(outputPath, "wx", 0o644);
  try {
    await handle.writeFile(
      serializeC6LiveMultiLangNeighborCensusQualification(
        result.qualification,
      ),
      "utf8",
    );
  } finally {
    await handle.close();
  }
  return result;
}

export interface C6LiveMultiLangNeighborCensusContinuationQualificationBuildInput {
  actorFramePath: string;
  expectedActorFrameSha256: string;
  expectedNeighborCompletionSha256: string;
  expectedNeighborPlanSha256: string;
  expectedNeighborRootSha256: string;
  expectedPriorNeighborPlanSha256: string;
  expectedPriorSelectedRepositoryProjectionSha256: string;
  expectedSourceCapturePlanSha256: string;
  expectedSourceGraphqlRootSha256: string;
  expectedSourcePoolSha256: string;
  neighborPlanPath: string;
  neighborRoot: string;
  priorNeighborPlanPath: string;
  sourceCapturePlanPath: string;
  sourceGraphqlRoot: string;
  sourcePoolPath: string;
  testHooks?: {
    afterOutputPublication?: () => Promise<void> | void;
    afterTerminalSnapshot?: () => Promise<void> | void;
    beforeTerminalVerification?: () => Promise<void> | void;
  };
}

export async function buildC6LiveMultiLangNeighborCensusContinuationQualification(
  input:
    C6LiveMultiLangNeighborCensusContinuationQualificationBuildInput,
): Promise<{
  outputSha256: string;
  qualification:
    C6LiveMultiLangNeighborCensusContinuationQualification;
}> {
  const expected = {
    actorFrame: sha256Schema.parse(
      input.expectedActorFrameSha256,
    ),
    neighborCompletion: sha256Schema.parse(
      input.expectedNeighborCompletionSha256,
    ),
    neighborPlan: sha256Schema.parse(
      input.expectedNeighborPlanSha256,
    ),
    neighborRoot: sha256Schema.parse(
      input.expectedNeighborRootSha256,
    ),
    priorNeighborPlan: sha256Schema.parse(
      input.expectedPriorNeighborPlanSha256,
    ),
    priorSelectedRepositoryProjection: sha256Schema.parse(
      input.expectedPriorSelectedRepositoryProjectionSha256,
    ),
    sourceCapturePlan: sha256Schema.parse(
      input.expectedSourceCapturePlanSha256,
    ),
    sourceGraphqlRoot: sha256Schema.parse(
      input.expectedSourceGraphqlRootSha256,
    ),
    sourcePool: sha256Schema.parse(
      input.expectedSourcePoolSha256,
    ),
  };
  const [
    actorFramePath,
    neighborPlanPath,
    neighborRoot,
    priorNeighborPlanPath,
    sourceCapturePlanPath,
    sourceGraphqlRoot,
    sourcePoolPath,
  ] = await Promise.all([
    assertC6NoSymlinkPathComponents(
      input.actorFramePath,
      "C6 continuation qualification actor frame",
    ),
    assertC6NoSymlinkPathComponents(
      input.neighborPlanPath,
      "C6 continuation qualification plan",
    ),
    assertC6NoSymlinkPathComponents(
      input.neighborRoot,
      "C6 continuation qualification capture root",
    ),
    assertC6NoSymlinkPathComponents(
      input.priorNeighborPlanPath,
      "C6 continuation qualification prior plan",
    ),
    assertC6NoSymlinkPathComponents(
      input.sourceCapturePlanPath,
      "C6 continuation qualification source plan",
    ),
    assertC6NoSymlinkPathComponents(
      input.sourceGraphqlRoot,
      "C6 continuation qualification source GraphQL root",
    ),
    assertC6NoSymlinkPathComponents(
      input.sourcePoolPath,
      "C6 continuation qualification source pool",
    ),
  ]);
  await Promise.all([
    assertNoUntrackedRootAssetLock(
      neighborRoot,
      "continuation neighbor",
    ),
    assertNoUntrackedRootAssetLock(
      sourceGraphqlRoot,
      "continuation source GraphQL",
    ),
  ]);
  const completionPath = join(neighborRoot, "completion.json");
  const [
    actorFrameBytes,
    neighborPlanBytes,
    completionBytes,
    neighborLock,
    priorNeighborPlanBytes,
    sourceCapturePlanBytes,
    sourceLock,
    sourcePoolBytes,
  ] = await Promise.all([
    readC6StableRegularFile(
      actorFramePath,
      "continuation qualification actor frame",
    ),
    readC6StableRegularFile(
      neighborPlanPath,
      "continuation qualification plan",
    ),
    readC6StableRegularFile(
      completionPath,
      "continuation qualification completion",
    ),
    buildC6AssetLock(neighborRoot),
    readC6StableRegularFile(
      priorNeighborPlanPath,
      "continuation qualification prior plan",
    ),
    readC6StableRegularFile(
      sourceCapturePlanPath,
      "continuation qualification source plan",
    ),
    buildC6AssetLock(sourceGraphqlRoot),
    readC6StableRegularFile(
      sourcePoolPath,
      "continuation qualification source pool",
    ),
  ]);
  if (
    sha256(actorFrameBytes) !== expected.actorFrame ||
    sha256(neighborPlanBytes) !== expected.neighborPlan ||
    sha256(completionBytes) !== expected.neighborCompletion ||
    neighborLock.assetRootSha256 !== expected.neighborRoot ||
    sha256(priorNeighborPlanBytes) !== expected.priorNeighborPlan ||
    sha256(sourceCapturePlanBytes) !== expected.sourceCapturePlan ||
    sourceLock.assetRootSha256 !== expected.sourceGraphqlRoot ||
    sha256(sourcePoolBytes) !== expected.sourcePool
  ) {
    throw new Error(
      "C6 continuation qualification input hash mismatch",
    );
  }
  if (
    neighborLock.files.length !== NEIGHBOR_ROOT_FILE_COUNT ||
    sourceLock.files.length !== SOURCE_GRAPHQL_ROOT_FILE_COUNT
  ) {
    throw new Error(
      "C6 continuation qualification asset file-count mismatch",
    );
  }

  const rawActorFrame = canonicalJson(
    actorFrameBytes,
    "continuation actor frame",
  );
  assertNoContinuationContamination(
    rawActorFrame,
    "actor frame",
  );
  const actorFrame = strictActorFrameSchema.parse(rawActorFrame);
  const rawSourcePool = canonicalJson(
    sourcePoolBytes,
    "continuation source pool",
  );
  const sourcePool = strictSourcePoolSchema.parse(rawSourcePool);
  const rawSourcePlan = canonicalJson(
    sourceCapturePlanBytes,
    "continuation source plan",
  );
  const sourcePlan = strictSourceCapturePlanSchema.parse(
    rawSourcePlan,
  );
  const rawPriorPlan = canonicalJson(
    priorNeighborPlanBytes,
    "continuation prior plan",
  );
  assertNoContinuationContamination(
    rawPriorPlan,
    "prior plan",
  );
  const rawNeighborPlan = canonicalJson(
    neighborPlanBytes,
    "continuation plan",
  );
  assertNoContinuationContamination(
    rawNeighborPlan,
    "continuation plan",
  );
  const rawCompletion = canonicalJson(
    completionBytes,
    "continuation completion",
  );
  assertNoContinuationContamination(
    rawCompletion,
    "continuation completion",
  );
  const completion = continuationCompletionSchema.parse(
    rawCompletion,
  );
  const rebuiltSourcePlan =
    projectC6SWEbenchLiveMultiLangCapturePlan({
      sourcePoolBytes,
      sourcePoolPath,
    });
  if (
    serializeC6SWEbenchLiveMultiLangCapturePlan(
      rebuiltSourcePlan,
    ) !== sourceCapturePlanBytes.toString("utf8") ||
    sourcePlan.sourcePool.sha256 !== expected.sourcePool ||
    sourcePlan.sourcePool.path !== basename(sourcePoolPath) ||
    sourcePlan.sourcePool.bytes !== sourcePoolBytes.byteLength ||
    sourcePlan.sourcePool.datasetId !== sourcePool.source.datasetId ||
    sourcePlan.sourcePool.revision !== sourcePool.source.revision
  ) {
    throw new Error(
      "C6 continuation qualification source-plan replay mismatch",
    );
  }
  assertCaptureRootStructure({
    captures: sourcePlan.targets,
    includeCompletion: false,
    lock: sourceLock,
    label: "continuation source GraphQL",
  });
  assertCaptureRootStructure({
    captures: completion.captures,
    includeCompletion: true,
    lock: neighborLock,
    label: "continuation neighbor",
  });
  await Promise.all([
    assertExactCaptureTree({
      captures: sourcePlan.targets,
      includeCompletion: false,
      label: "continuation source GraphQL",
      root: sourceGraphqlRoot,
    }),
    assertExactCaptureTree({
      captures: completion.captures,
      includeCompletion: true,
      label: "continuation neighbor",
      root: neighborRoot,
    }),
    assertContinuationCaptureModes({
      captures: completion.captures,
      profile: "neighbor",
      root: neighborRoot,
    }),
    assertContinuationCaptureModes({
      captures: sourcePlan.targets,
      profile: "source",
      root: sourceGraphqlRoot,
    }),
  ]);

  const sourceCapture = await loadContinuationSourceAnchors({
    lock: sourceLock,
    root: sourceGraphqlRoot,
    targets: sourcePlan.targets,
  });
  const currentFrameRepositories = new Set(
    actorFrame.candidates.map((candidate) =>
      normalizeRepository(candidate.canonicalRepository)
    ),
  );
  if (
    actorFrame.candidates.length !==
      actorFrame.counts.combinedStructuralCandidateCount ||
    currentFrameRepositories.size !==
      actorFrame.counts.repositoryCount ||
    sha256(JSON.stringify(
      (rawActorFrame as { candidates: unknown }).candidates,
    )) !== actorFrame.independenceBoundary.candidateProjectionSha256
  ) {
    throw new Error(
      "C6 continuation qualification actor-frame projection mismatch",
    );
  }
  const planInputs = {
    actorFrame: reference(actorFrameBytes, actorFramePath),
    actorFrameCandidateProjectionSha256:
      actorFrame.independenceBoundary.candidateProjectionSha256,
    capturePlan: reference(
      sourceCapturePlanBytes,
      sourceCapturePlanPath,
    ),
    capturePlanTargetProjectionSha256:
      sourcePlan.independenceBoundary.targetProjectionSha256,
    graphqlRootSha256: sourceLock.assetRootSha256,
  };
  const rebuiltPriorPlan =
    deriveC6LiveMultiLangNeighborCensusPlan({
      currentFrameRepositories,
      inputs: planInputs,
      observations: sourceCapture.observations,
    });
  if (
    serializeC6LiveMultiLangNeighborCensusPlan(
      rebuiltPriorPlan,
    ) !== priorNeighborPlanBytes.toString("utf8") ||
    rebuiltPriorPlan.independenceBoundary
      .selectedRepositoryProjectionSha256 !==
        expected.priorSelectedRepositoryProjection
  ) {
    throw new Error(
      "C6 continuation qualification prior-plan replay mismatch",
    );
  }
  const rebuiltNeighborPlan =
    deriveC6LiveMultiLangNeighborCensusContinuationPlan({
      currentFrameRepositories,
      expectedPriorPlanSha256: expected.priorNeighborPlan,
      expectedPriorSelectedRepositoryProjectionSha256:
        expected.priorSelectedRepositoryProjection,
      inputs: planInputs,
      observations: sourceCapture.observations,
      priorPlanBytes: priorNeighborPlanBytes,
      priorPlanPath: priorNeighborPlanPath,
    });
  if (
    serializeC6LiveMultiLangNeighborCensusContinuationPlan(
      rebuiltNeighborPlan,
    ) !== neighborPlanBytes.toString("utf8")
  ) {
    throw new Error(
      "C6 continuation qualification continuation-plan replay mismatch",
    );
  }
  assertContinuationPlanAndCompletionBindings({
    completion,
    neighborPlanBytes,
    neighborPlanPath,
    plan: rebuiltNeighborPlan,
    priorNeighborPlanBytes,
    priorNeighborPlanPath,
  });
  assertContinuationTargetOrder({
    currentFrameRepositories,
    plan: rebuiltNeighborPlan,
    priorPlan: rebuiltPriorPlan,
  });
  assertCompletionOrder(
    completion.captures,
    rebuiltNeighborPlan.targets,
  );
  if (
    completion.counts.capturedRawAnchorCount !==
      completion.captures.reduce(
        (sum, capture) => sum + capture.rawAnchorCount,
        0,
      ) ||
    completion.counts.truncatedRepositoryCount !==
      completion.captures.filter((capture) => capture.hasNextPage)
        .length
  ) {
    throw new Error(
      "C6 continuation qualification completion count mismatch",
    );
  }
  const observations =
    await loadContinuationNeighborObservations({
      captures: completion.captures,
      lock: neighborLock,
      plan: rebuiltNeighborPlan,
      root: neighborRoot,
    });
  if (
    observations.length !==
      completion.counts.capturedRawAnchorCount ||
    sha256(JSON.stringify(
      observations.map(rawAnchorProjection),
    )) !== completion.independenceBoundary.rawAnchorProjectionSha256
  ) {
    throw new Error(
      "C6 continuation qualification raw-anchor projection mismatch",
    );
  }

  const qualification =
    deriveC6LiveMultiLangNeighborCensusContinuationQualification({
      capturedRepositoryCount:
        completion.counts.completedRepositoryCount,
      inputs: {
        actorFrame: reference(actorFrameBytes, actorFramePath),
        actorFrameCandidateProjectionSha256:
          actorFrame.independenceBoundary.candidateProjectionSha256,
        neighborCompletion: reference(
          completionBytes,
          completionPath,
        ),
        neighborPlan: reference(
          neighborPlanBytes,
          neighborPlanPath,
        ),
        neighborRootSha256: neighborLock.assetRootSha256,
        priorNeighborPlan: {
          artifactKind:
            "c6-live-multilang-neighbor-census-plan",
          ...reference(
            priorNeighborPlanBytes,
            priorNeighborPlanPath,
          ),
          schemaVersion: 1,
          selectedRepositoryProjectionSha256:
            expected.priorSelectedRepositoryProjection,
        },
        sourceCapturePlan: reference(
          sourceCapturePlanBytes,
          sourceCapturePlanPath,
        ),
        sourceGraphqlRootSha256: sourceLock.assetRootSha256,
        sourcePool: reference(sourcePoolBytes, sourcePoolPath),
      },
      observations,
      sourceAnchors: sourceCapture.anchors,
      truncatedRepositoryCount:
        completion.counts.truncatedRepositoryCount,
    });

  await input.testHooks?.beforeTerminalVerification?.();
  const closure = {
    actorFramePath,
    completionPath,
    neighborCaptures: completion.captures,
    neighborPlanPath,
    neighborRoot,
    priorNeighborPlanPath,
    sourceCapturePlanPath,
    sourceGraphqlRoot,
    sourcePoolPath,
    sourceTargets: sourcePlan.targets,
  };
  const initialSnapshot = {
    actorFrameBytes,
    completionBytes,
    neighborLock,
    neighborPlanBytes,
    priorNeighborPlanBytes,
    sourceCapturePlanBytes,
    sourceLock,
    sourcePoolBytes,
  };
  await assertContinuationClosureStructureAndModes(closure);
  const terminalSnapshot =
    await takeContinuationClosureSnapshot(closure);
  assertContinuationClosureSnapshotMatches(
    initialSnapshot,
    terminalSnapshot,
  );
  await input.testHooks?.afterTerminalSnapshot?.();
  await assertContinuationClosureStructureAndModes(closure);
  const finalSnapshot =
    await takeContinuationClosureSnapshot(closure);
  assertContinuationClosureSnapshotMatches(
    initialSnapshot,
    finalSnapshot,
  );
  const serialized =
    serializeC6LiveMultiLangNeighborCensusContinuationQualification(
      qualification,
    );
  return {
    outputSha256: sha256(serialized),
    qualification,
  };
}

interface ContinuationQualificationClosure {
  actorFramePath: string;
  completionPath: string;
  neighborCaptures: readonly { captureDirectory: string }[];
  neighborPlanPath: string;
  neighborRoot: string;
  priorNeighborPlanPath: string;
  sourceCapturePlanPath: string;
  sourceGraphqlRoot: string;
  sourcePoolPath: string;
  sourceTargets: readonly { captureDirectory: string }[];
}

interface ContinuationQualificationClosureSnapshot {
  actorFrameBytes: Buffer;
  completionBytes: Buffer;
  neighborLock: C6AssetLock;
  neighborPlanBytes: Buffer;
  priorNeighborPlanBytes: Buffer;
  sourceCapturePlanBytes: Buffer;
  sourceLock: C6AssetLock;
  sourcePoolBytes: Buffer;
}

async function assertContinuationClosureStructureAndModes(
  closure: ContinuationQualificationClosure,
): Promise<void> {
  await Promise.all([
    assertNoUntrackedRootAssetLock(
      closure.neighborRoot,
      "continuation neighbor",
    ),
    assertNoUntrackedRootAssetLock(
      closure.sourceGraphqlRoot,
      "continuation source GraphQL",
    ),
    assertExactCaptureTree({
      captures: closure.neighborCaptures,
      includeCompletion: true,
      label: "continuation neighbor",
      root: closure.neighborRoot,
    }),
    assertExactCaptureTree({
      captures: closure.sourceTargets,
      includeCompletion: false,
      label: "continuation source GraphQL",
      root: closure.sourceGraphqlRoot,
    }),
    assertContinuationCaptureModes({
      captures: closure.neighborCaptures,
      profile: "neighbor",
      root: closure.neighborRoot,
    }),
    assertContinuationCaptureModes({
      captures: closure.sourceTargets,
      profile: "source",
      root: closure.sourceGraphqlRoot,
    }),
  ]);
}

async function takeContinuationClosureSnapshot(
  closure: ContinuationQualificationClosure,
): Promise<ContinuationQualificationClosureSnapshot> {
  const [
    actorFrameBytes,
    neighborPlanBytes,
    completionBytes,
    neighborLock,
    priorNeighborPlanBytes,
    sourceCapturePlanBytes,
    sourceLock,
    sourcePoolBytes,
  ] = await Promise.all([
    readC6StableRegularFile(
      closure.actorFramePath,
      "continuation terminal actor frame",
    ),
    readC6StableRegularFile(
      closure.neighborPlanPath,
      "continuation terminal plan",
    ),
    readC6StableRegularFile(
      closure.completionPath,
      "continuation terminal completion",
    ),
    buildC6AssetLock(closure.neighborRoot),
    readC6StableRegularFile(
      closure.priorNeighborPlanPath,
      "continuation terminal prior plan",
    ),
    readC6StableRegularFile(
      closure.sourceCapturePlanPath,
      "continuation terminal source plan",
    ),
    buildC6AssetLock(closure.sourceGraphqlRoot),
    readC6StableRegularFile(
      closure.sourcePoolPath,
      "continuation terminal source pool",
    ),
  ]);
  return {
    actorFrameBytes,
    completionBytes,
    neighborLock,
    neighborPlanBytes,
    priorNeighborPlanBytes,
    sourceCapturePlanBytes,
    sourceLock,
    sourcePoolBytes,
  };
}

function assertContinuationClosureSnapshotMatches(
  expected: ContinuationQualificationClosureSnapshot,
  actual: ContinuationQualificationClosureSnapshot,
): void {
  if (
    !actual.actorFrameBytes.equals(expected.actorFrameBytes) ||
    !actual.neighborPlanBytes.equals(expected.neighborPlanBytes) ||
    !actual.completionBytes.equals(expected.completionBytes) ||
    serializeC6AssetLock(actual.neighborLock) !==
      serializeC6AssetLock(expected.neighborLock) ||
    !actual.priorNeighborPlanBytes.equals(
      expected.priorNeighborPlanBytes,
    ) ||
    !actual.sourceCapturePlanBytes.equals(
      expected.sourceCapturePlanBytes,
    ) ||
    serializeC6AssetLock(actual.sourceLock) !==
      serializeC6AssetLock(expected.sourceLock) ||
    !actual.sourcePoolBytes.equals(expected.sourcePoolBytes)
  ) {
    throw new Error(
      "C6 continuation qualification input closure changed during projection",
    );
  }
}

export async function materializeC6LiveMultiLangNeighborCensusContinuationQualification(
  input:
    C6LiveMultiLangNeighborCensusContinuationQualificationBuildInput & {
      outputPath: string;
    },
): Promise<{
  outputSha256: string;
  qualification:
    C6LiveMultiLangNeighborCensusContinuationQualification;
}> {
  const result =
    await buildC6LiveMultiLangNeighborCensusContinuationQualification(
      input,
    );
  const serialized =
    serializeC6LiveMultiLangNeighborCensusContinuationQualification(
      result.qualification,
    );
  const outputPath = resolve(input.outputPath);
  const outputParent = await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 continuation qualification output parent",
  );
  const temporaryName =
    `.${basename(outputPath)}.incomplete-${randomUUID()}`;
  const temporaryPath = join(outputParent, temporaryName);
  let published = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(serialized, "utf8");
      await handle.chmod(0o644);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const temporaryBytes = await readC6StableRegularFile(
      temporaryPath,
      "continuation qualification temporary output",
    );
    if (temporaryBytes.toString("utf8") !== serialized) {
      throw new Error(
        "C6 continuation qualification temporary output mismatch",
      );
    }
    await assertC6NoSymlinkPathComponents(
      outputParent,
      "C6 continuation qualification terminal output parent",
    );
    await link(temporaryPath, outputPath);
    published = true;
    await rm(temporaryPath);

    await input.testHooks?.afterOutputPublication?.();
    const revalidated =
      await buildC6LiveMultiLangNeighborCensusContinuationQualification({
        ...input,
        testHooks: undefined,
      });
    const revalidatedBytes =
      serializeC6LiveMultiLangNeighborCensusContinuationQualification(
        revalidated.qualification,
      );
    if (
      revalidated.outputSha256 !== result.outputSha256 ||
      revalidatedBytes !== serialized
    ) {
      throw new Error(
        "C6 continuation qualification post-publication replay mismatch",
      );
    }
    const publishedBytes = await readC6StableRegularFile(
      outputPath,
      "continuation qualification published output",
    );
    if (publishedBytes.toString("utf8") !== serialized) {
      throw new Error(
        "C6 continuation qualification published output mismatch",
      );
    }
  } catch (error) {
    await rm(temporaryPath, { force: true });
    if (published) {
      await rm(outputPath, { force: true });
    }
    throw error;
  }
  return result;
}

async function loadContinuationSourceAnchors(input: {
  lock: C6AssetLock;
  root: string;
  targets: readonly z.infer<typeof strictSourceTargetSchema>[];
}): Promise<{
  anchors: SourceAnchor[];
  observations: C6LiveMultiLangCanonicalObservation[];
}> {
  const files = new Map(
    input.lock.files.map((file) => [file.path, file]),
  );
  const anchors: SourceAnchor[] = [];
  const observations: C6LiveMultiLangCanonicalObservation[] = [];
  for (const target of input.targets) {
    const prefix = `${target.captureDirectory}/`;
    const captureBytes = await readBoundFile(
      input.root,
      `${prefix}capture.json`,
      files,
    );
    const rawCapture = canonicalJson(
      captureBytes,
      "continuation source capture manifest",
    );
    assertNoContinuationContamination(
      rawCapture,
      "source capture manifest",
    );
    const capture = sourceCaptureStrictSchema.parse(rawCapture);
    const requestBytes = await readReferencedFile({
      expectedPath: "request.json",
      files,
      prefix,
      reference: capture.request.body,
      root: input.root,
    });
    const rawRequest = parseJson(
      requestBytes,
      "continuation source request",
    );
    assertNoContinuationContamination(
      rawRequest,
      "source request",
    );
    const request = sourceRequestStrictSchema.parse(rawRequest);
    const responseHeaderBytes = await readReferencedFile({
      expectedPath: "response-headers.json",
      files,
      prefix,
      reference: capture.response.headers,
      root: input.root,
    });
    const rawResponseHeaders = canonicalJson(
      responseHeaderBytes,
      "continuation source response headers",
    );
    assertNoContinuationContamination(
      rawResponseHeaders,
      "source response headers",
    );
    strictResponseHeadersSchema.parse(rawResponseHeaders);
    const responseBytes = await readReferencedFile({
      expectedPath: "response.json",
      files,
      prefix,
      reference: capture.response.body,
      root: input.root,
    });
    const rawResponse = parseJson(
      responseBytes,
      "continuation source response",
    );
    assertNoContinuationContamination(
      rawResponse,
      "source response",
    );
    const response = sourceResponseStrictSchema.parse(rawResponse);
    const requestedRepository = normalizeRepository(
      `${target.owner}/${target.repo}`,
    );
    const canonicalRepository = normalizeRepository(
      response.data.repository.nameWithOwner,
    );
    const pull = response.data.repository.pullRequest;
    const canonicalAnchorId =
      `${canonicalRepository}#${target.pullNumber}`;
    const expectedUrl =
      `https://github.com/${canonicalRepository}/pull/` +
      target.pullNumber;
    if (
      JSON.stringify(request.variables) !==
        JSON.stringify(capture.request.variables) ||
      request.variables.name !== target.repo ||
      request.variables.number !== target.pullNumber ||
      request.variables.owner !== target.owner ||
      normalizeAnchor(target.requestedAnchorId) !==
        `${requestedRepository}#${target.pullNumber}` ||
      normalizeRepository(pull.baseRepository.nameWithOwner) !==
        canonicalRepository ||
      pull.number !== target.pullNumber ||
      normalizeRepository(capture.target.repository) !==
        canonicalRepository ||
      capture.target.pullNumber !== target.pullNumber ||
      normalizeUrl(pull.url) !== normalizeUrl(expectedUrl) ||
      normalizeUrl(capture.target.url) !== normalizeUrl(expectedUrl)
    ) {
      throw new Error(
        `C6 continuation qualification source identity mismatch ${
          target.captureOrder
        }`,
      );
    }
    const redirected = requestedRepository !== canonicalRepository;
    if (
      redirected !==
        (capture.target.repositoryRedirect !== undefined) ||
      (
        redirected &&
        (
          normalizeRepository(
            capture.target.repositoryRedirect!.requestedRepository,
          ) !== requestedRepository ||
          normalizeRepository(
            capture.target.repositoryRedirect!.resolvedRepository,
          ) !== canonicalRepository
        )
      )
    ) {
      throw new Error(
        `C6 continuation qualification source redirect mismatch ${
          target.captureOrder
        }`,
      );
    }
    anchors.push({
      canonicalAnchorId,
      captureOrder: target.captureOrder,
    });
    observations.push({
      canonicalAnchorId,
      canonicalRepository,
      captureOrder: target.captureOrder,
      pullNumber: target.pullNumber,
      requestedAnchorId:
        `${requestedRepository}#${target.pullNumber}`,
      requestedRepository,
      sourceSplit: target.sourceSplit,
    });
  }
  assertSourceAnchors(anchors);
  return {
    anchors,
    observations,
  };
}

async function loadContinuationNeighborObservations(input: {
  captures: readonly z.infer<
    typeof continuationCompletionCaptureSchema
  >[];
  lock: C6AssetLock;
  plan: ReturnType<
    typeof deriveC6LiveMultiLangNeighborCensusContinuationPlan
  >;
  root: string;
}): Promise<C6LiveMultiLangNeighborCensusObservation[]> {
  const files = new Map(
    input.lock.files.map((file) => [file.path, file]),
  );
  const observations: C6LiveMultiLangNeighborCensusObservation[] =
    [];
  const expectedPlanBinding = {
    artifactKind:
      "c6-live-multilang-neighbor-census-plan" as const,
    priorPlan: input.plan.inputs.priorNeighborPlan,
    schemaVersion: 2 as const,
    selectedRepositoryProjectionSha256:
      input.plan.independenceBoundary
        .selectedRepositoryProjectionSha256,
    sha256: sha256(
      serializeC6LiveMultiLangNeighborCensusContinuationPlan(
        input.plan,
      ),
    ),
  };
  for (const [index, completionCapture] of input.captures.entries()) {
    const target = input.plan.targets[index]!;
    const prefix = `${completionCapture.captureDirectory}/`;
    const captureBytes = await readBoundFile(
      input.root,
      `${prefix}capture.json`,
      files,
    );
    if (
      captureBytes.byteLength !==
        completionCapture.captureManifest.bytes ||
      sha256(captureBytes) !==
        completionCapture.captureManifest.sha256 ||
      completionCapture.captureManifest.path !==
        `${prefix}capture.json`
    ) {
      throw new Error(
        `C6 continuation qualification capture manifest mismatch ${
          target.pilotRank
        }`,
      );
    }
    const rawCapture = canonicalJson(
      captureBytes,
      "continuation capture manifest",
    );
    assertNoContinuationContamination(
      rawCapture,
      "continuation capture manifest",
    );
    const capture = continuationCaptureSchema.parse(rawCapture);
    if (
      !sameJsonValue(capture.planTarget, target) ||
      !sameJsonValue(capture.plan, expectedPlanBinding)
    ) {
      throw new Error(
        `C6 continuation qualification capture plan mismatch ${
          target.pilotRank
        }`,
      );
    }
    const requestBytes = await readReferencedFile({
      expectedPath: "request.json",
      files,
      prefix,
      reference: capture.request.canonical,
      root: input.root,
    });
    const responseHeaderBytes = await readReferencedFile({
      expectedPath: "response-headers.json",
      files,
      prefix,
      reference: capture.response.headers,
      root: input.root,
    });
    const rawResponseHeaders = canonicalJson(
      responseHeaderBytes,
      "continuation response headers",
    );
    assertNoContinuationContamination(
      rawResponseHeaders,
      "continuation response headers",
    );
    strictResponseHeadersSchema.parse(rawResponseHeaders);
    const responseBytes = await readReferencedFile({
      expectedPath: "response.json",
      files,
      prefix,
      reference: capture.response.body,
      root: input.root,
    });
    const rawRequest = canonicalJson(
      requestBytes,
      "continuation request",
    );
    assertNoContinuationContamination(
      rawRequest,
      "continuation request",
    );
    const request = continuationRequestSchema.parse(rawRequest);
    if (
      request.variables.limit !== target.censusCap ||
      request.variables.name !== target.repo ||
      request.variables.owner !== target.owner ||
      JSON.stringify(request.variables) !==
        JSON.stringify(capture.request.variables) ||
      request.endpoint !== capture.request.endpoint ||
      request.method !== capture.request.method ||
      JSON.stringify(request.headers) !==
        JSON.stringify(capture.request.headers)
    ) {
      throw new Error(
        `C6 continuation qualification request mismatch ${
          target.pilotRank
        }`,
      );
    }
    const rawResponse = parseJson(
      responseBytes,
      "continuation response",
    );
    assertNoContinuationContamination(
      rawResponse,
      "continuation response",
    );
    const response = continuationResponseSchema.parse(rawResponse);
    const repository = normalizeRepository(
      response.data.repository.nameWithOwner,
    );
    if (
      repository !== normalizeRepository(target.canonicalRepository) ||
      JSON.stringify(capture.discovery.rateLimit) !==
        JSON.stringify(response.data.rateLimit)
    ) {
      throw new Error(
        `C6 continuation qualification repository identity mismatch ${
          target.pilotRank
        }`,
      );
    }
    const connection = response.data.repository.pullRequests;
    const expectedNodeCount = Math.min(
      connection.totalCount,
      NEIGHBOR_CENSUS_CAP,
    );
    const expectedHasNextPage =
      connection.totalCount > NEIGHBOR_CENSUS_CAP;
    if (
      connection.nodes.length !== expectedNodeCount ||
      connection.pageInfo.hasNextPage !== expectedHasNextPage ||
      connection.pageInfo.endCursor !==
        capture.discovery.endCursor ||
      capture.discovery.hasNextPage !== expectedHasNextPage ||
      (
        expectedHasNextPage &&
        connection.pageInfo.endCursor === null
      ) ||
      (
        connection.nodes.length === 0 &&
        connection.pageInfo.endCursor !== null
      ) ||
      completionCapture.hasNextPage !== expectedHasNextPage ||
      completionCapture.rawAnchorCount !== connection.nodes.length ||
      capture.counts.rawAnchorCount !== connection.nodes.length ||
      capture.counts.totalMergedPullRequestCount !==
        connection.totalCount
    ) {
      throw new Error(
        `C6 continuation qualification pagination mismatch ${
          target.pilotRank
        }`,
      );
    }
    const rawAnchors = connection.nodes.map((pull) => ({
      authorLogin: pull.author?.login ?? null,
      baseRefOid: pull.baseRefOid,
      canonicalAnchorId: `${repository}#${pull.number}`,
      commentCount: pull.comments.totalCount,
      createdAt: pull.createdAt,
      mergeCommitOid: pull.mergeCommit.oid,
      mergedAt: pull.mergedAt,
      reviewCount: pull.reviews.totalCount,
      reviewThreadCount: pull.reviewThreads.totalCount,
      url: pull.url,
    }));
    let priorCreatedAt = Number.POSITIVE_INFINITY;
    for (const rawAnchor of rawAnchors) {
      const createdAt = Date.parse(rawAnchor.createdAt);
      if (createdAt > priorCreatedAt) {
        throw new Error(
          `C6 continuation qualification response order mismatch ${
            target.pilotRank
          }`,
        );
      }
      priorCreatedAt = createdAt;
    }
    if (
      sha256(JSON.stringify(rawAnchors)) !==
        capture.independenceBoundary.rawAnchorProjectionSha256
    ) {
      throw new Error(
        `C6 continuation qualification repository projection mismatch ${
          target.pilotRank
        }`,
      );
    }
    for (const [nodeIndex, rawAnchor] of rawAnchors.entries()) {
      const expectedUrl =
        `https://github.com/${repository}/pull/` +
        parseAnchor(rawAnchor.canonicalAnchorId).pullNumber;
      if (normalizeUrl(rawAnchor.url) !== normalizeUrl(expectedUrl)) {
        throw new Error(
          `C6 continuation qualification pull identity mismatch ${
            rawAnchor.canonicalAnchorId
          }`,
        );
      }
      observations.push({
        ...rawAnchor,
        canonicalRepository: repository,
        captureDirectory: completionCapture.captureDirectory,
        pilotRank: target.pilotRank,
        responseNodeRank: nodeIndex + 1,
        sourceSplit: target.sourceSplit,
      });
    }
  }
  return observations;
}

function assertContinuationPlanAndCompletionBindings(input: {
  completion: z.infer<typeof continuationCompletionSchema>;
  neighborPlanBytes: Uint8Array;
  neighborPlanPath: string;
  plan: ReturnType<
    typeof deriveC6LiveMultiLangNeighborCensusContinuationPlan
  >;
  priorNeighborPlanBytes: Uint8Array;
  priorNeighborPlanPath: string;
}): void {
  const expectedPriorPlan = {
    artifactKind:
      "c6-live-multilang-neighbor-census-plan" as const,
    ...reference(
      input.priorNeighborPlanBytes,
      input.priorNeighborPlanPath,
    ),
    schemaVersion: 1 as const,
    selectedRepositoryProjectionSha256:
      input.plan.independenceBoundary
        .priorSelectedRepositoryProjectionSha256,
  };
  const expectedCompletionPlan = {
    ...reference(input.neighborPlanBytes, input.neighborPlanPath),
    artifactKind:
      "c6-live-multilang-neighbor-census-plan" as const,
    priorPlan: expectedPriorPlan,
    schemaVersion: 2 as const,
    selectedRepositoryProjectionSha256:
      input.plan.independenceBoundary
        .selectedRepositoryProjectionSha256,
  };
  if (
    !sameJsonValue(
      input.plan.inputs.priorNeighborPlan,
      expectedPriorPlan,
    ) ||
    !sameJsonValue(
      input.completion.plan,
      expectedCompletionPlan,
    )
  ) {
    throw new Error(
      "C6 continuation qualification completion plan binding mismatch",
    );
  }
}

function assertContinuationTargetOrder(input: {
  currentFrameRepositories: ReadonlySet<string>;
  plan: ReturnType<
    typeof deriveC6LiveMultiLangNeighborCensusContinuationPlan
  >;
  priorPlan: ReturnType<
    typeof deriveC6LiveMultiLangNeighborCensusPlan
  >;
}): void {
  const priorRepositories = new Set(
    input.priorPlan.targets.map((target) =>
      normalizeRepository(target.canonicalRepository)
    ),
  );
  const continuationRepositories = new Set<string>();
  for (const [index, rawTarget] of input.plan.targets.entries()) {
    const target = continuationTargetSchema.parse(rawTarget);
    const repository = normalizeRepository(
      target.canonicalRepository,
    );
    if (
      target.pilotRank !== index + 1 ||
      normalizeRepository(`${target.owner}/${target.repo}`) !==
        repository ||
      priorRepositories.has(repository) ||
      input.currentFrameRepositories.has(repository) ||
      continuationRepositories.has(repository)
    ) {
      throw new Error(
        `C6 continuation qualification target order mismatch ${
          index + 1
        }`,
      );
    }
    continuationRepositories.add(repository);
  }
  if (
    priorRepositories.size !== NEIGHBOR_REPOSITORY_COUNT ||
    continuationRepositories.size !== NEIGHBOR_REPOSITORY_COUNT
  ) {
    throw new Error(
      "C6 continuation qualification repository tranche size mismatch",
    );
  }
}

async function assertContinuationCaptureModes(input: {
  captures: readonly { captureDirectory: string }[];
  profile: "neighbor" | "source";
  root: string;
}): Promise<void> {
  const modes = input.profile === "neighbor"
    ? {
      directory: 0o700,
      file: 0o600,
      root: 0o700,
    }
    : {
      directory: 0o755,
      file: 0o644,
      root: 0o700,
    };
  const rootStat = await lstat(input.root);
  if (
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    (rootStat.mode & 0o777) !== modes.root
  ) {
    throw new Error(
      `C6 continuation qualification ${input.profile} root mode mismatch`,
    );
  }
  const paths = [
    ...(input.profile === "neighbor"
      ? [join(input.root, "completion.json")]
      : []),
    ...input.captures.flatMap((capture) => {
      const directory = join(
        input.root,
        capture.captureDirectory,
      );
      return [
        directory,
        ...CAPTURE_FILES.map((file) => join(directory, file)),
      ];
    }),
  ];
  const stats = await Promise.all(paths.map((path) => lstat(path)));
  for (const [index, stat] of stats.entries()) {
    const path = paths[index]!;
    const offset = input.profile === "neighbor" ? 1 : 0;
    const directory = index >= offset &&
      (index - offset) % (CAPTURE_FILES.length + 1) === 0;
    const expectedMode = directory
      ? modes.directory
      : modes.file;
    if (
      stat.isSymbolicLink() ||
      (
        directory
          ? !stat.isDirectory()
          : !stat.isFile()
      ) ||
      (stat.mode & 0o777) !== expectedMode
    ) {
      throw new Error(
        `C6 continuation qualification ${input.profile} mode mismatch ${path}`,
      );
    }
  }
}

function assertNoContinuationContamination(
  value: unknown,
  label: string,
  path = "$",
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoContinuationContamination(
        entry,
        label,
        `${path}[${index}]`,
      )
    );
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const collapsed = key.toLowerCase().replace(
      /[^a-z0-9]/gu,
      "",
    );
    if (
      collapsed.includes("evaluator") ||
      collapsed.includes("evaluation") ||
      collapsed.includes("hidden")
    ) {
      throw new Error(
        `C6 continuation qualification forbidden ${label} key ${path}.${key}`,
      );
    }
    assertNoContinuationContamination(
      entry,
      label,
      `${path}.${key}`,
    );
  }
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(sortJsonValue(left)) ===
    JSON.stringify(sortJsonValue(right));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJsonValue(entry)]),
  );
}

async function loadSourceAnchors(input: {
  lock: C6AssetLock;
  root: string;
  targets: readonly z.infer<typeof sourceTargetSchema>[];
}): Promise<{
  anchors: SourceAnchor[];
  observations: C6LiveMultiLangCanonicalObservation[];
}> {
  const files = new Map(
    input.lock.files.map((file) => [file.path, file]),
  );
  const anchors: SourceAnchor[] = [];
  const observations: C6LiveMultiLangCanonicalObservation[] = [];
  for (const target of input.targets) {
    const prefix = `${target.captureDirectory}/`;
    const captureBytes = await readBoundFile(
      input.root,
      `${prefix}capture.json`,
      files,
    );
    const rawCapture = canonicalJson(
      captureBytes,
      "source capture manifest",
    );
    const capture = sourceCaptureSchema.parse(rawCapture);
    await readReferencedFile({
      expectedPath: "request.json",
      files,
      prefix,
      reference: capture.request.body,
      root: input.root,
    });
    await readReferencedFile({
      expectedPath: "response-headers.json",
      files,
      prefix,
      reference: capture.response.headers,
      root: input.root,
    });
    const responseBytes = await readReferencedFile({
      expectedPath: "response.json",
      files,
      prefix,
      reference: capture.response.body,
      root: input.root,
    });
    const response = sourceResponseSchema.parse(
      parseJson(responseBytes, "source GraphQL response"),
    );
    if (response.errors !== undefined && response.errors.length > 0) {
      throw new Error(
        `C6 neighbor qualification source GraphQL errors ${
          target.requestedAnchorId
        }`,
      );
    }
    const requestedRepository = normalizeRepository(
      `${target.owner}/${target.repo}`,
    );
    const canonicalRepository = normalizeRepository(
      response.data.repository.nameWithOwner,
    );
    const pull = response.data.repository.pullRequest;
    const canonicalAnchorId =
      `${canonicalRepository}#${target.pullNumber}`;
    const expectedUrl =
      `https://github.com/${canonicalRepository}/pull/` +
      target.pullNumber;
    if (
      normalizeAnchor(target.requestedAnchorId) !==
        `${requestedRepository}#${target.pullNumber}` ||
      normalizeRepository(pull.baseRepository.nameWithOwner) !==
        canonicalRepository ||
      pull.number !== target.pullNumber ||
      normalizeRepository(capture.target.repository) !==
        canonicalRepository ||
      capture.target.pullNumber !== target.pullNumber ||
      normalizeUrl(pull.url) !== normalizeUrl(expectedUrl) ||
      normalizeUrl(capture.target.url) !== normalizeUrl(expectedUrl)
    ) {
      throw new Error(
        `C6 neighbor qualification source identity mismatch ${
          target.captureOrder
        }`,
      );
    }
    const redirected = requestedRepository !== canonicalRepository;
    if (
      redirected !==
        (capture.target.repositoryRedirect !== undefined) ||
      (
        redirected &&
        (
          normalizeRepository(
            capture.target.repositoryRedirect!.requestedRepository,
          ) !== requestedRepository ||
          normalizeRepository(
            capture.target.repositoryRedirect!.resolvedRepository,
          ) !== canonicalRepository
        )
      )
    ) {
      throw new Error(
        `C6 neighbor qualification source redirect mismatch ${
          target.captureOrder
        }`,
      );
    }
    anchors.push({
      canonicalAnchorId,
      captureOrder: target.captureOrder,
    });
    observations.push({
      canonicalAnchorId,
      canonicalRepository,
      captureOrder: target.captureOrder,
      pullNumber: target.pullNumber,
      requestedAnchorId:
        `${requestedRepository}#${target.pullNumber}`,
      requestedRepository,
      sourceSplit: target.sourceSplit,
    });
  }
  assertSourceAnchors(anchors);
  return {
    anchors,
    observations,
  };
}

async function loadNeighborObservations(input: {
  captures: readonly z.infer<typeof completionCaptureSchema>[];
  lock: C6AssetLock;
  planTargets: readonly NeighborTarget[];
  root: string;
}): Promise<C6LiveMultiLangNeighborCensusObservation[]> {
  const files = new Map(
    input.lock.files.map((file) => [file.path, file]),
  );
  const observations: C6LiveMultiLangNeighborCensusObservation[] =
    [];
  for (const [index, completionCapture] of input.captures.entries()) {
    const target = input.planTargets[index]!;
    const prefix = `${completionCapture.captureDirectory}/`;
    const captureBytes = await readBoundFile(
      input.root,
      `${prefix}capture.json`,
      files,
    );
    if (
      captureBytes.byteLength !==
        completionCapture.captureManifest.bytes ||
      sha256(captureBytes) !==
        completionCapture.captureManifest.sha256 ||
      completionCapture.captureManifest.path !==
        `${prefix}capture.json`
    ) {
      throw new Error(
        `C6 neighbor qualification capture manifest mismatch ${
          target.pilotRank
        }`,
      );
    }
    const capture = neighborCaptureSchema.parse(
      canonicalJson(captureBytes, "neighbor capture manifest"),
    );
    if (JSON.stringify(capture.planTarget) !== JSON.stringify(target)) {
      throw new Error(
        `C6 neighbor qualification capture target mismatch ${
          target.pilotRank
        }`,
      );
    }
    const requestBytes = await readReferencedFile({
      expectedPath: "request.json",
      files,
      prefix,
      reference: capture.request.canonical,
      root: input.root,
    });
    await readReferencedFile({
      expectedPath: "response-headers.json",
      files,
      prefix,
      reference: capture.response.headers,
      root: input.root,
    });
    const responseBytes = await readReferencedFile({
      expectedPath: "response.json",
      files,
      prefix,
      reference: capture.response.body,
      root: input.root,
    });
    const request = neighborRequestSchema.parse(
      parseJson(requestBytes, "neighbor request"),
    );
    if (
      request.variables.limit !== target.censusCap ||
      request.variables.name !== target.repo ||
      request.variables.owner !== target.owner ||
      JSON.stringify(request.variables) !==
        JSON.stringify(capture.request.variables)
    ) {
      throw new Error(
        `C6 neighbor qualification request mismatch ${
          target.pilotRank
        }`,
      );
    }
    const response = neighborResponseSchema.parse(
      parseJson(responseBytes, "neighbor response"),
    );
    if (response.errors !== undefined && response.errors.length > 0) {
      throw new Error(
        `C6 neighbor qualification GraphQL errors ${
          target.pilotRank
        }`,
      );
    }
    const repository = normalizeRepository(
      response.data.repository.nameWithOwner,
    );
    if (repository !== normalizeRepository(target.canonicalRepository)) {
      throw new Error(
        `C6 neighbor qualification repository identity mismatch ${
          target.pilotRank
        }`,
      );
    }
    const connection = response.data.repository.pullRequests;
    const expectedNodeCount = Math.min(
      connection.totalCount,
      NEIGHBOR_CENSUS_CAP,
    );
    const expectedHasNextPage =
      connection.totalCount > NEIGHBOR_CENSUS_CAP;
    if (
      connection.nodes.length !== expectedNodeCount ||
      connection.pageInfo.hasNextPage !== expectedHasNextPage ||
      (
        connection.pageInfo.hasNextPage &&
        connection.pageInfo.endCursor === null
      ) ||
      (
        connection.nodes.length === 0 &&
        connection.pageInfo.endCursor !== null
      ) ||
      completionCapture.hasNextPage !== expectedHasNextPage ||
      completionCapture.rawAnchorCount !== connection.nodes.length ||
      capture.counts.rawAnchorCount !== connection.nodes.length ||
      capture.counts.totalMergedPullRequestCount !==
        connection.totalCount
    ) {
      throw new Error(
        `C6 neighbor qualification pagination mismatch ${
          target.pilotRank
        }`,
      );
    }
    const rawAnchors = connection.nodes.map((pull) => ({
      authorLogin: pull.author?.login ?? null,
      baseRefOid: pull.baseRefOid,
      canonicalAnchorId: `${repository}#${pull.number}`,
      commentCount: pull.comments.totalCount,
      createdAt: pull.createdAt,
      mergeCommitOid: pull.mergeCommit.oid,
      mergedAt: pull.mergedAt,
      reviewCount: pull.reviews.totalCount,
      reviewThreadCount: pull.reviewThreads.totalCount,
      url: pull.url,
    }));
    let priorCreatedAt = Number.POSITIVE_INFINITY;
    for (const rawAnchor of rawAnchors) {
      const createdAt = Date.parse(rawAnchor.createdAt);
      if (createdAt > priorCreatedAt) {
        throw new Error(
          `C6 neighbor qualification response order mismatch ${
            target.pilotRank
          }`,
        );
      }
      priorCreatedAt = createdAt;
    }
    if (
      sha256(JSON.stringify(rawAnchors)) !==
        capture.independenceBoundary.rawAnchorProjectionSha256
    ) {
      throw new Error(
        `C6 neighbor qualification repository projection mismatch ${
          target.pilotRank
        }`,
      );
    }
    for (const [nodeIndex, rawAnchor] of rawAnchors.entries()) {
      const expectedUrl =
        `https://github.com/${repository}/pull/` +
        parseAnchor(rawAnchor.canonicalAnchorId).pullNumber;
      if (normalizeUrl(rawAnchor.url) !== normalizeUrl(expectedUrl)) {
        throw new Error(
          `C6 neighbor qualification pull identity mismatch ${
            rawAnchor.canonicalAnchorId
          }`,
        );
      }
      observations.push({
        ...rawAnchor,
        canonicalRepository: repository,
        captureDirectory: completionCapture.captureDirectory,
        pilotRank: target.pilotRank,
        responseNodeRank: nodeIndex + 1,
        sourceSplit: target.sourceSplit,
      });
    }
  }
  return observations;
}

function assertPlanBindings(input: {
  completion: z.infer<typeof completionSchema>;
  expected: {
    neighborCompletion: string;
    neighborPlan: string;
    neighborRoot: string;
    sourceCapturePlan: string;
    sourceGraphqlRoot: string;
  };
  neighborPlan: z.infer<typeof neighborPlanSchema>;
  neighborPlanPath: string;
  rawNeighborPlan: unknown;
  rawSourcePlan: unknown;
  sourceCapturePlanPath: string;
  sourcePlan: z.infer<typeof sourceCapturePlanSchema>;
}): void {
  if (
    input.neighborPlan.inputs.capturePlan.bytes !==
      Buffer.byteLength(
        `${JSON.stringify(input.rawSourcePlan, null, 2)}\n`,
      ) ||
    input.neighborPlan.inputs.capturePlan.path !==
      basename(input.sourceCapturePlanPath) ||
    input.neighborPlan.inputs.capturePlan.sha256 !==
      input.expected.sourceCapturePlan ||
    input.neighborPlan.inputs.graphqlRootSha256 !==
      input.expected.sourceGraphqlRoot ||
    input.neighborPlan.inputs.capturePlanTargetProjectionSha256 !==
      input.sourcePlan.independenceBoundary.targetProjectionSha256 ||
    input.completion.plan.sha256 !== input.expected.neighborPlan ||
    input.completion.plan.path !== basename(input.neighborPlanPath) ||
    input.completion.plan.bytes !==
      Buffer.byteLength(
        `${JSON.stringify(input.rawNeighborPlan, null, 2)}\n`,
      ) ||
    input.completion.plan.selectedRepositoryProjectionSha256 !==
      input.neighborPlan.independenceBoundary
        .selectedRepositoryProjectionSha256 ||
    sha256(JSON.stringify(
      (input.rawSourcePlan as { targets: unknown }).targets,
    )) !== input.sourcePlan.independenceBoundary.targetProjectionSha256 ||
    sha256(JSON.stringify(
      input.neighborPlan.targets.map(selectedRepositoryProjection),
    )) !== input.neighborPlan.independenceBoundary
      .selectedRepositoryProjectionSha256 ||
    (
      input.rawNeighborPlan as {
        independenceBoundary?: {
          selectedRepositoryProjectionSha256?: string;
        };
      }
    ).independenceBoundary?.selectedRepositoryProjectionSha256 !==
      input.neighborPlan.independenceBoundary
        .selectedRepositoryProjectionSha256
  ) {
    throw new Error(
      "C6 neighbor qualification plan binding mismatch",
    );
  }
}

function assertTargetOrder(
  targets: readonly NeighborTarget[],
): void {
  const repositories = new Set<string>();
  for (const [index, target] of targets.entries()) {
    if (
      target.pilotRank !== index + 1 ||
      normalizeRepository(`${target.owner}/${target.repo}`) !==
        normalizeRepository(target.canonicalRepository) ||
      repositories.has(normalizeRepository(target.canonicalRepository))
    ) {
      throw new Error(
        `C6 neighbor qualification target order mismatch ${
          index + 1
        }`,
      );
    }
    repositories.add(normalizeRepository(target.canonicalRepository));
  }
}

function assertCompletionOrder(
  captures: readonly z.infer<typeof completionCaptureSchema>[],
  targets: readonly NeighborTarget[],
): void {
  for (const [index, capture] of captures.entries()) {
    const target = targets[index]!;
    if (
      capture.pilotRank !== index + 1 ||
      normalizeRepository(capture.canonicalRepository) !==
        normalizeRepository(target.canonicalRepository)
    ) {
      throw new Error(
        `C6 neighbor qualification completion order mismatch ${
          index + 1
        }`,
      );
    }
  }
}

function assertCaptureRootStructure(input: {
  captures: readonly { captureDirectory: string }[];
  includeCompletion: boolean;
  label: string;
  lock: C6AssetLock;
}): void {
  const directories = new Set(
    input.captures.map((capture) => capture.captureDirectory),
  );
  if (directories.size !== input.captures.length) {
    throw new Error(
      `C6 neighbor qualification duplicate ${input.label} directory`,
    );
  }
  const expected = new Set(
    input.captures.flatMap((capture) =>
      CAPTURE_FILES.map(
        (file) => `${capture.captureDirectory}/${file}`,
      )
    ),
  );
  if (input.includeCompletion) {
    expected.add("completion.json");
  }
  for (const file of input.lock.files) {
    if (!expected.delete(file.path)) {
      throw new Error(
        `C6 neighbor qualification unexpected ${input.label} file ${
          file.path
        }`,
      );
    }
  }
  if (expected.size > 0) {
    throw new Error(
      `C6 neighbor qualification missing ${input.label} file ${
        [...expected].sort()[0]
      }`,
    );
  }
}

async function assertNoUntrackedRootAssetLock(
  root: string,
  label: string,
): Promise<void> {
  try {
    await lstat(join(root, "asset-lock.json"));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
  throw new Error(
    `C6 neighbor qualification rejects untracked root asset-lock.json in ${label}`,
  );
}

async function assertExactCaptureTree(input: {
  captures: readonly { captureDirectory: string }[];
  includeCompletion: boolean;
  label: string;
  root: string;
}): Promise<void> {
  const expectedDirectories = new Set(
    input.captures.map((capture) => capture.captureDirectory),
  );
  const rootEntries = await readdir(input.root, {
    withFileTypes: true,
  });
  for (const entry of rootEntries) {
    if (expectedDirectories.delete(entry.name)) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error(
          `C6 neighbor qualification invalid ${input.label} capture directory ${entry.name}`,
        );
      }
      continue;
    }
    if (
      input.includeCompletion &&
      entry.name === "completion.json" &&
      entry.isFile() &&
      !entry.isSymbolicLink()
    ) {
      continue;
    }
    throw new Error(
      `C6 neighbor qualification unexpected ${input.label} root entry ${entry.name}`,
    );
  }
  if (expectedDirectories.size > 0) {
    throw new Error(
      `C6 neighbor qualification missing ${input.label} capture directory ${
        [...expectedDirectories].sort()[0]
      }`,
    );
  }
  for (const capture of input.captures) {
    const directory = join(input.root, capture.captureDirectory);
    const entries = await readdir(directory, {
      withFileTypes: true,
    });
    const expectedFiles = new Set<string>(CAPTURE_FILES);
    for (const entry of entries) {
      if (
        !expectedFiles.delete(
          entry.name as typeof CAPTURE_FILES[number],
        ) ||
        !entry.isFile() ||
        entry.isSymbolicLink()
      ) {
        throw new Error(
          `C6 neighbor qualification unexpected ${input.label} capture entry ${
            capture.captureDirectory
          }/${entry.name}`,
        );
      }
    }
    if (expectedFiles.size > 0) {
      throw new Error(
        `C6 neighbor qualification missing ${input.label} capture entry ${
          capture.captureDirectory
        }/${[...expectedFiles].sort()[0]}`,
      );
    }
  }
}

function assertSourceAnchors(
  anchors: readonly SourceAnchor[],
): void {
  if (anchors.length !== SOURCE_ANCHOR_COUNT) {
    throw new Error(
      `C6 neighbor qualification requires exactly ${
        SOURCE_ANCHOR_COUNT
      } source anchors`,
    );
  }
  const ids = new Set<string>();
  for (const [index, anchor] of anchors.entries()) {
    if (
      anchor.captureOrder !== index + 1 ||
      ids.has(anchor.canonicalAnchorId)
    ) {
      throw new Error(
        `C6 neighbor qualification source anchor closure mismatch ${
          index + 1
        }`,
      );
    }
    ids.add(anchor.canonicalAnchorId);
  }
}

function assertObservationOrder(
  observations: readonly C6LiveMultiLangNeighborCensusObservation[],
): void {
  let priorPilotRank = 0;
  let priorNodeRank = 0;
  for (const observation of observations) {
    if (
      observation.pilotRank < priorPilotRank ||
      (
        observation.pilotRank === priorPilotRank &&
        observation.responseNodeRank <= priorNodeRank
      )
    ) {
      throw new Error(
        "C6 neighbor qualification observation order mismatch",
      );
    }
    priorPilotRank = observation.pilotRank;
    priorNodeRank = observation.responseNodeRank;
  }
}

function assertDuplicateMetadata(
  left: C6LiveMultiLangNeighborCensusObservation,
  right: C6LiveMultiLangNeighborCensusObservation,
): void {
  if (
    JSON.stringify(duplicateMetadataProjection(left)) !==
      JSON.stringify(duplicateMetadataProjection(right))
  ) {
    throw new Error(
      `C6 neighbor qualification duplicate canonical pull metadata mismatch ${
        left.canonicalAnchorId
      }`,
    );
  }
}

function duplicateMetadataProjection(
  observation: C6LiveMultiLangNeighborCensusObservation,
): unknown {
  return {
    authorLogin: observation.authorLogin,
    baseRefOid: observation.baseRefOid,
    canonicalAnchorId: observation.canonicalAnchorId,
    canonicalRepository: observation.canonicalRepository,
    commentCount: observation.commentCount,
    createdAt: observation.createdAt,
    mergeCommitOid: observation.mergeCommitOid,
    mergedAt: observation.mergedAt,
    reviewCount: observation.reviewCount,
    reviewThreadCount: observation.reviewThreadCount,
    url: normalizeUrl(observation.url),
  };
}

function assertCountIdentities(
  counts: C6LiveMultiLangNeighborCensusQualification["counts"],
): void {
  if (
    counts.rawObservationCount !==
      counts.uniqueCanonicalPullCount +
        counts.duplicateObservationCount ||
    counts.uniqueCanonicalPullCount !==
      counts.existingAnchorOverlapCount +
        counts.novelCanonicalPullCount ||
    counts.novelCanonicalPullCount !==
      counts.novelWithReviewSurfaceCount +
        counts.novelWithoutReviewSurfaceCount ||
    counts.deepCaptureTargetCount !==
      counts.novelWithReviewSurfaceCount
  ) {
    throw new Error(
      "C6 neighbor qualification count identity mismatch",
    );
  }
}

function aggregateRepositoryCounts(
  observations: readonly C6LiveMultiLangNeighborCensusObservation[],
  results: readonly C6LiveMultiLangNeighborCensusQualificationResult[],
): C6LiveMultiLangNeighborCensusQualification["repositoryCounts"] {
  const repositories = new Map<string, {
    canonicalRepository: string;
    deepCaptureTargetCount: number;
    existingAnchorOverlapCount: number;
    novelCanonicalPullCount: number;
    rawObservationCount: number;
    uniqueCanonicalPullCount: number;
  }>();
  for (const observation of observations) {
    const repository = repositories.get(
      observation.canonicalRepository,
    ) ?? {
      canonicalRepository: observation.canonicalRepository,
      deepCaptureTargetCount: 0,
      existingAnchorOverlapCount: 0,
      novelCanonicalPullCount: 0,
      rawObservationCount: 0,
      uniqueCanonicalPullCount: 0,
    };
    repository.rawObservationCount += 1;
    repositories.set(observation.canonicalRepository, repository);
  }
  for (const result of results) {
    const repository = repositories.get(result.canonicalRepository)!;
    repository.uniqueCanonicalPullCount += 1;
    if (result.status === "existing-source-anchor") {
      repository.existingAnchorOverlapCount += 1;
    } else {
      repository.novelCanonicalPullCount += 1;
    }
    if (
      result.status ===
        "novel-review-surface-deep-capture-target"
    ) {
      repository.deepCaptureTargetCount += 1;
    }
  }
  return [...repositories.values()];
}

function aggregateSplitCounts(
  observations: readonly C6LiveMultiLangNeighborCensusObservation[],
  results: readonly C6LiveMultiLangNeighborCensusQualificationResult[],
): C6LiveMultiLangNeighborCensusQualification["splitCounts"] {
  const counts = Object.fromEntries(SOURCE_SPLITS.map((split) => [
    split,
    {
      deepCaptureTargetCount: 0,
      existingAnchorOverlapCount: 0,
      novelCanonicalPullCount: 0,
      rawObservationCount: 0,
      uniqueCanonicalPullCount: 0,
    },
  ])) as C6LiveMultiLangNeighborCensusQualification["splitCounts"];
  for (const observation of observations) {
    counts[observation.sourceSplit].rawObservationCount += 1;
  }
  for (const result of results) {
    const split = counts[result.sourceSplit];
    split.uniqueCanonicalPullCount += 1;
    if (result.status === "existing-source-anchor") {
      split.existingAnchorOverlapCount += 1;
    } else {
      split.novelCanonicalPullCount += 1;
    }
    if (
      result.status ===
        "novel-review-surface-deep-capture-target"
    ) {
      split.deepCaptureTargetCount += 1;
    }
  }
  return counts;
}

function canonicalPullProjection(
  result: C6LiveMultiLangNeighborCensusQualificationResult,
): unknown {
  return {
    canonicalAnchorId: result.canonicalAnchorId,
    canonicalRepository: result.canonicalRepository,
    observationRefs: result.observationRefs,
    pilotRank: result.pilotRank,
    responseNodeRank: result.responseNodeRank,
    status: result.status,
  };
}

function deepCaptureTargetProjection(
  result: C6LiveMultiLangNeighborCensusQualificationResult,
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

function rawAnchorProjection(
  observation: C6LiveMultiLangNeighborCensusObservation,
): unknown {
  return {
    authorLogin: observation.authorLogin,
    baseRefOid: observation.baseRefOid,
    canonicalAnchorId: observation.canonicalAnchorId,
    commentCount: observation.commentCount,
    createdAt: observation.createdAt,
    mergeCommitOid: observation.mergeCommitOid,
    mergedAt: observation.mergedAt,
    reviewCount: observation.reviewCount,
    reviewThreadCount: observation.reviewThreadCount,
    url: observation.url,
  };
}

function selectedRepositoryProjection(target: NeighborTarget): unknown {
  return {
    pilotRank: target.pilotRank,
    sourceSplit: target.sourceSplit,
    withinSplitRank: target.withinSplitRank,
    canonicalRepository: target.canonicalRepository,
    seedCaptureOrder: target.seedCaptureOrder,
    seedAnchorId: target.seedAnchorId,
  };
}

async function readReferencedFile(input: {
  expectedPath: string;
  files: ReadonlyMap<string, C6AssetLock["files"][number]>;
  prefix: string;
  reference: ArtifactReference;
  root: string;
}): Promise<Buffer> {
  if (input.reference.path !== input.expectedPath) {
    throw new Error(
      `C6 neighbor qualification reference path mismatch ${
        input.reference.path
      }`,
    );
  }
  const path = `${input.prefix}${input.expectedPath}`;
  const bytes = await readBoundFile(input.root, path, input.files);
  if (
    bytes.byteLength !== input.reference.bytes ||
    sha256(bytes) !== input.reference.sha256
  ) {
    throw new Error(
      `C6 neighbor qualification reference mismatch ${path}`,
    );
  }
  return bytes;
}

async function readBoundFile(
  root: string,
  path: string,
  files: ReadonlyMap<string, C6AssetLock["files"][number]>,
): Promise<Buffer> {
  const file = files.get(path);
  if (file === undefined) {
    throw new Error(
      `C6 neighbor qualification missing capture file ${path}`,
    );
  }
  const bytes = await readC6StableRegularFile(
    join(root, ...path.split("/")),
    "neighbor qualification capture file",
  );
  if (
    bytes.byteLength !== file.bytes ||
    sha256(bytes) !== file.sha256
  ) {
    throw new Error(
      `C6 neighbor qualification changed capture file ${path}`,
    );
  }
  return bytes;
}

function reference(
  bytes: Uint8Array,
  path: string,
): ArtifactReference {
  return {
    bytes: bytes.byteLength,
    path: basename(path),
    sha256: sha256(bytes),
  };
}

function serializeQualificationPolicy(): string {
  return `${JSON.stringify(QUALIFICATION_POLICY, null, 2)}\n`;
}

function canonicalJson(bytes: Uint8Array, label: string): unknown {
  const raw = parseJson(bytes, label);
  if (
    Buffer.from(bytes).toString("utf8") !==
      `${JSON.stringify(raw, null, 2)}\n`
  ) {
    throw new Error(
      `C6 neighbor qualification noncanonical ${label}`,
    );
  }
  return raw;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(
      `C6 neighbor qualification invalid ${label} JSON`,
    );
  }
}

function parseAnchor(value: string): {
  pullNumber: number;
  repository: string;
} {
  const parsed = anchorSchema.parse(value);
  const index = parsed.lastIndexOf("#");
  return {
    pullNumber: Number(parsed.slice(index + 1)),
    repository: normalizeRepository(parsed.slice(0, index)),
  };
}

function normalizeAnchor(value: string): string {
  const parsed = parseAnchor(value);
  return `${parsed.repository}#${parsed.pullNumber}`;
}

function normalizeRepository(value: string): string {
  return repositorySchema.parse(value).toLowerCase();
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${
    url.pathname.replace(/\/+$/u, "").toLowerCase()
  }`;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
