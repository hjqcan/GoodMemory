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

const ENDPOINT = "https://api.github.com/graphql";
const TARGET_COUNT = 64;
const CENSUS_CAP = 16;
const MAXIMUM_RAW_ANCHOR_COUNT = 1_024;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
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
  "patch",
  "test",
  "gold",
  "outcome",
  "semanticDecision",
  "machineDecision",
] as const;
const ALLOWED_FALSE_ATTESTATION_KEYS = new Set(
  FORBIDDEN_SELECTION_INPUTS.map((input) => `${input}Input`),
);
const FORBIDDEN_SELECTION_KEY_TOKENS = new Set([
  "evaluation",
  "evaluations",
  "evaluator",
  "evaluators",
  "file",
  "files",
  "gold",
  "hidden",
  "outcome",
  "outcomes",
  "patch",
  "patched",
  "patches",
  "patching",
  "test",
  "testing",
  "tests",
]);
const FORBIDDEN_COLLAPSED_SELECTION_KEYS = new Set([
  "evaluatormetadata",
  "expectedchangedfiles",
  "files",
  "goldinput",
  "goldpatchsha256",
  "hiddentests",
  "machinedecisioninput",
  "machineoutcomeinput",
  "outcomeinput",
  "patchinput",
  "semanticdecisioninput",
  "testinput",
]);
const REQUEST_HEADERS = {
  accept: "application/vnd.github+json",
  "content-type": "application/json",
  "user-agent": "GoodMemory-C6-Neighbor-Census/1",
  "x-github-api-version": "2022-11-28",
} as const;
const SELECTED_RESPONSE_HEADERS = [
  "content-type",
  "date",
  "etag",
  "x-github-request-id",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-ratelimit-resource",
  "x-ratelimit-used",
] as const;
const REQUIRED_RESPONSE_HEADERS = [
  "content-type",
  "date",
  "x-github-request-id",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-ratelimit-resource",
  "x-ratelimit-used",
] as const;

export const C6_LIVE_MULTILANG_NEIGHBOR_CENSUS_QUERY =
  `query C6LiveMultiLangNeighborCensus($owner: String!, $name: String!, $limit: Int!) {
  rateLimit {
    cost
    remaining
    resetAt
  }
  repository(owner: $owner, name: $name) {
    nameWithOwner
    pullRequests(first: $limit, states: [MERGED], orderBy: {field: CREATED_AT, direction: DESC}) {
      totalCount
      nodes {
        number
        url
        createdAt
        mergedAt
        baseRefOid
        mergeCommit {
          oid
        }
        author {
          login
        }
        reviews {
          totalCount
        }
        reviewThreads {
          totalCount
        }
        comments {
          totalCount
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}`;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const repositorySchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
);
const sourceSplitSchema = z.enum(SOURCE_SPLITS);
const inputReferenceSchema = z.object({
  bytes: z.number().int().positive(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const targetSchema = z.object({
  canonicalRepository: repositorySchema,
  censusCap: z.literal(CENSUS_CAP),
  owner: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
  pilotRank: z.number().int().positive(),
  repo: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
  seedAnchorId: z.string().min(1),
  seedCaptureOrder: z.number().int().positive(),
  sourceSplit: sourceSplitSchema,
  withinSplitRank: z.number().int().min(1).max(16),
}).strict();
const targetV1Schema = targetSchema.extend({
  withinSplitRank: z.number().int().min(1).max(8),
});
const targetV2Schema = targetSchema.extend({
  withinSplitRank: z.number().int().min(9).max(16),
});
const planV1Schema = z.object({
  artifactKind: z.literal(
    "c6-live-multilang-neighbor-census-plan",
  ),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    censusCaptured: z.literal(false),
    codexRunReady: z.literal(false),
    machineQualifiedEpisodeCount: z.literal(0),
    semanticallyQualifiedEpisodeCount: z.literal(0),
    status: z.literal("repository-neighbor-census-plan-only"),
  }).strict(),
  counts: z.object({
    canonicalRedirectCollapseCount: z.number().int().nonnegative(),
    canonicalRepositoryCount: z.number().int().positive(),
    censusCandidateCeiling: z.literal(MAXIMUM_RAW_ANCHOR_COUNT),
    currentFrameRepositoryCount: z.number().int().positive(),
    eligibleRepositoryCount: z.number().int().positive(),
    excludedCurrentFrameRepositoryCount:
      z.number().int().nonnegative(),
    selectedRepositoryCount: z.literal(TARGET_COUNT),
    sourceAnchorCount: z.number().int().positive(),
    sourceRequestedRepositoryCount: z.number().int().positive(),
  }).strict(),
  independenceBoundary: z.object({
    actorFrameRepositoryProjectionSha256: sha256Schema,
    canonicalRepositoryProjectionSha256: sha256Schema,
    eligibleRepositoryProjectionSha256: sha256Schema,
    existingAnchorProjectionSha256: sha256Schema,
    goldInput: z.literal(false),
    machineDecisionInput: z.literal(false),
    outcomeInput: z.literal(false),
    patchInput: z.literal(false),
    selectedRepositoryProjectionSha256: sha256Schema,
    semanticDecisionInput: z.literal(false),
    testInput: z.literal(false),
  }).strict(),
  inputs: z.object({
    actorFrame: inputReferenceSchema,
    actorFrameCandidateProjectionSha256: sha256Schema,
    capturePlan: inputReferenceSchema,
    capturePlanTargetProjectionSha256: sha256Schema,
    graphqlRootSha256: sha256Schema,
  }).strict(),
  rule: z.object({
    canonicalIdentity: z.literal(
      "lowercase-resolved-repository-plus-pull-number",
    ),
    currentFrameRepositoryExclusion: z.literal(
      "exclude-all-current-actor-qualified-frame-repositories",
    ),
    existingAnchorExclusion: z.literal(
      "exclude-all-canonical-source-anchors-before-neighbor-qualification",
    ),
    forbiddenSelectionInputs: z.tuple([
      z.literal("patch"),
      z.literal("test"),
      z.literal("gold"),
      z.literal("outcome"),
      z.literal("semanticDecision"),
      z.literal("machineDecision"),
    ]),
    perRepositoryCensusCap: z.literal(CENSUS_CAP),
    repositorySplitAssignment: z.literal(
      "earliest-source-captureOrder",
    ),
    selectionOrder: z.literal(
      "withinSplitRank-ascending-then-frozen-sourceSplit-order",
    ),
    sourceSplitOrder: z.tuple([
      z.literal("c"),
      z.literal("cpp"),
      z.literal("go"),
      z.literal("js"),
      z.literal("rust"),
      z.literal("java"),
      z.literal("ts"),
      z.literal("cs"),
    ]),
    withinSplitSelection: z.literal(
      "first-8-eligible-canonical-repositories-by-seed-captureOrder",
    ),
  }).strict(),
  schemaVersion: z.literal(1),
  splitCounts: z.object({
    c: z.object({
      eligible: z.number().int().positive(),
      selected: z.literal(8),
    }).strict(),
    cpp: z.object({
      eligible: z.number().int().positive(),
      selected: z.literal(8),
    }).strict(),
    go: z.object({
      eligible: z.number().int().positive(),
      selected: z.literal(8),
    }).strict(),
    js: z.object({
      eligible: z.number().int().positive(),
      selected: z.literal(8),
    }).strict(),
    rust: z.object({
      eligible: z.number().int().positive(),
      selected: z.literal(8),
    }).strict(),
    java: z.object({
      eligible: z.number().int().positive(),
      selected: z.literal(8),
    }).strict(),
    ts: z.object({
      eligible: z.number().int().positive(),
      selected: z.literal(8),
    }).strict(),
    cs: z.object({
      eligible: z.number().int().positive(),
      selected: z.literal(8),
    }).strict(),
  }).strict(),
  targets: z.array(targetV1Schema).length(TARGET_COUNT),
}).strict();
const priorPlanReferenceSchema = z.object({
  artifactKind: z.literal(
    "c6-live-multilang-neighbor-census-plan",
  ),
  bytes: z.number().int().positive(),
  path: z.string().min(1),
  schemaVersion: z.literal(1),
  selectedRepositoryProjectionSha256: sha256Schema,
  sha256: sha256Schema,
}).strict();
const splitCountSchema = z.object({
  actorFrameEligible: z.number().int().nonnegative(),
  continuationEligible: z.number().int().nonnegative(),
  priorSelected: z.literal(8),
  selected: z.literal(8),
}).strict();
const planV2Schema = z.object({
  artifactKind: z.literal(
    "c6-live-multilang-neighbor-census-plan",
  ),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    actorQualifiedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    censusCaptured: z.literal(false),
    codexCallCount: z.literal(0),
    codexRunReady: z.literal(false),
    machineQualifiedEpisodeCount: z.literal(0),
    semanticallyQualifiedEpisodeCount: z.literal(0),
    status: z.literal(
      "repository-neighbor-census-continuation-plan-only",
    ),
  }).strict(),
  counts: z.object({
    canonicalRedirectCollapseCount: z.number().int().nonnegative(),
    canonicalRepositoryCount: z.number().int().positive(),
    continuationEligibleRepositoryCount:
      z.number().int().positive(),
    cumulativeCensusCandidateCeiling: z.literal(
      MAXIMUM_RAW_ANCHOR_COUNT * 2,
    ),
    cumulativeSelectedRepositoryCount: z.literal(
      TARGET_COUNT * 2,
    ),
    currentFrameRepositoryCount: z.number().int().positive(),
    eligibleRepositoryCount: z.number().int().positive(),
    excludedCurrentFrameRepositoryCount:
      z.number().int().nonnegative(),
    excludedPriorTrancheRepositoryCount: z.literal(TARGET_COUNT),
    priorSelectedRepositoryCount: z.literal(TARGET_COUNT),
    selectedRepositoryCount: z.literal(TARGET_COUNT),
    sourceAnchorCount: z.number().int().positive(),
    sourceRequestedRepositoryCount: z.number().int().positive(),
    trancheCensusCandidateCeiling: z.literal(
      MAXIMUM_RAW_ANCHOR_COUNT,
    ),
  }).strict(),
  independenceBoundary: z.object({
    actorFrameRepositoryProjectionSha256: sha256Schema,
    canonicalRepositoryProjectionSha256: sha256Schema,
    combinedExclusionProjectionSha256: sha256Schema,
    continuationEligibleRepositoryProjectionSha256: sha256Schema,
    eligibleRepositoryProjectionSha256: sha256Schema,
    existingAnchorProjectionSha256: sha256Schema,
    goldInput: z.literal(false),
    machineDecisionInput: z.literal(false),
    outcomeInput: z.literal(false),
    patchInput: z.literal(false),
    priorNeighborPlanSha256: sha256Schema,
    priorSelectedRepositoryProjectionSha256: sha256Schema,
    selectedRepositoryProjectionSha256: sha256Schema,
    semanticDecisionInput: z.literal(false),
    testInput: z.literal(false),
  }).strict(),
  inputs: z.object({
    actorFrame: inputReferenceSchema,
    actorFrameCandidateProjectionSha256: sha256Schema,
    capturePlan: inputReferenceSchema,
    capturePlanTargetProjectionSha256: sha256Schema,
    graphqlRootSha256: sha256Schema,
    priorNeighborPlan: priorPlanReferenceSchema,
  }).strict(),
  rule: z.object({
    canonicalIdentity: z.literal(
      "lowercase-resolved-repository-plus-pull-number",
    ),
    currentFrameRepositoryExclusion: z.literal(
      "exclude-all-current-actor-qualified-frame-repositories",
    ),
    existingAnchorExclusion: z.literal(
      "exclude-all-canonical-source-anchors-before-neighbor-qualification",
    ),
    forbiddenSelectionInputs: z.tuple([
      z.literal("patch"),
      z.literal("test"),
      z.literal("gold"),
      z.literal("outcome"),
      z.literal("semanticDecision"),
      z.literal("machineDecision"),
    ]),
    perRepositoryCensusCap: z.literal(CENSUS_CAP),
    priorTrancheBinding: z.literal(
      "rederive-ranks-1-through-8-byte-for-byte-before-continuation",
    ),
    priorTrancheRepositoryExclusion: z.literal(
      "exclude-all-prior-tranche-selected-repositories",
    ),
    repositorySplitAssignment: z.literal(
      "earliest-source-captureOrder",
    ),
    selectionOrder: z.literal(
      "withinSplitRank-ascending-then-frozen-sourceSplit-order",
    ),
    sourceSplitOrder: z.tuple([
      z.literal("c"),
      z.literal("cpp"),
      z.literal("go"),
      z.literal("js"),
      z.literal("rust"),
      z.literal("java"),
      z.literal("ts"),
      z.literal("cs"),
    ]),
    withinSplitSelection: z.literal(
      "eligible-canonical-repository-ranks-9-through-16-by-seed-captureOrder",
    ),
  }).strict(),
  schemaVersion: z.literal(2),
  splitCounts: z.object({
    c: splitCountSchema,
    cpp: splitCountSchema,
    go: splitCountSchema,
    js: splitCountSchema,
    rust: splitCountSchema,
    java: splitCountSchema,
    ts: splitCountSchema,
    cs: splitCountSchema,
  }).strict(),
  targets: z.array(targetV2Schema).length(TARGET_COUNT),
}).strict();
const planSchema = z.discriminatedUnion("schemaVersion", [
  planV1Schema,
  planV2Schema,
]);
const countConnectionSchema = z.object({
  totalCount: z.number().int().nonnegative(),
}).strict();
const pullSchema = z.object({
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
const responseSchema = z.object({
  data: z.object({
    rateLimit: z.object({
      cost: z.number().int().nonnegative(),
      remaining: z.number().int().nonnegative(),
      resetAt: z.iso.datetime(),
    }).strict(),
    repository: z.object({
      nameWithOwner: repositorySchema,
      pullRequests: z.object({
        nodes: z.array(pullSchema).max(CENSUS_CAP),
        pageInfo: z.object({
          endCursor: z.string().min(1).nullable(),
          hasNextPage: z.boolean(),
        }).strict(),
        totalCount: z.number().int().nonnegative(),
      }).strict(),
    }).strict(),
  }).strict(),
  errors: z.array(z.unknown()).optional(),
}).strict();

type CensusTarget = z.infer<typeof targetSchema>;
type ContinuationPlan = z.infer<typeof planV2Schema>;
type ParsedResponse = z.infer<typeof responseSchema>;

interface ArtifactReference {
  bytes: number;
  path: string;
  sha256: string;
}

interface RawAnchor {
  authorLogin: string | null;
  baseRefOid: string;
  canonicalAnchorId: string;
  commentCount: number;
  createdAt: string;
  mergeCommitOid: string;
  mergedAt: string;
  reviewCount: number;
  reviewThreadCount: number;
  url: string;
}

interface Boundary {
  acceptedEpisodeCount: 0;
  actorQualifiedEpisodeCount: 0;
  candidateManifestFrozen: false;
  codexRunReady: false;
  machineQualifiedEpisodeCount: 0;
  semanticallyQualifiedEpisodeCount: 0;
}

interface ContinuationPlanBinding {
  artifactKind: "c6-live-multilang-neighbor-census-plan";
  priorPlan: z.infer<typeof priorPlanReferenceSchema>;
  schemaVersion: 2;
  selectedRepositoryProjectionSha256: string;
  sha256: string;
}

interface ContinuationPriorPlanClosure {
  binding: ContinuationPlanBinding;
  bytes: Buffer;
  path: string;
  sha256: string;
}

interface C6LiveMultiLangNeighborCensusRepositoryCaptureBase {
  artifactKind: "c6-live-multilang-neighbor-census-repository-capture";
  boundary: Boundary & {
    status: "merged-pr-metadata-census-only-raw-anchors";
  };
  counts: {
    maximumRawAnchorCount: 16;
    rawAnchorCount: number;
    totalMergedPullRequestCount: number;
  };
  discovery: {
    endCursor: string | null;
    hasNextPage: boolean;
    rateLimit: ParsedResponse["data"]["rateLimit"];
  };
  independenceBoundary: {
    contentFieldsRequested: false;
    rawAnchorProjectionSha256: string;
  };
  planTarget: CensusTarget;
  request: {
    canonical: ArtifactReference;
    endpoint: typeof ENDPOINT;
    headers: typeof REQUEST_HEADERS & {
      authorization: "Bearer [REDACTED]";
    };
    method: "POST";
    variables: {
      limit: 16;
      name: string;
      owner: string;
    };
  };
  response: {
    body: ArtifactReference;
    headers: ArtifactReference;
    httpStatus: 200;
  };
}

export type C6LiveMultiLangNeighborCensusRepositoryCapture =
  | (
    C6LiveMultiLangNeighborCensusRepositoryCaptureBase & {
      schemaVersion: 1;
    }
  )
  | (
    C6LiveMultiLangNeighborCensusRepositoryCaptureBase & {
      plan: ContinuationPlanBinding;
      schemaVersion: 2;
    }
  );

interface CompletionCapture {
  canonicalRepository: string;
  captureDirectory: string;
  captureManifest: ArtifactReference;
  hasNextPage: boolean;
  pilotRank: number;
  rawAnchorCount: number;
}

interface C6LiveMultiLangNeighborCensusCompletionBase {
  artifactKind: "c6-live-multilang-neighbor-census-completion";
  boundary: Boundary & {
    status:
      "merged-pr-metadata-census-complete-raw-anchors-only";
  };
  captures: CompletionCapture[];
  counts: {
    capturedRawAnchorCount: number;
    completedRepositoryCount: 64;
    maximumRawAnchorCount: 1024;
    truncatedRepositoryCount: number;
  };
  independenceBoundary: {
    contentFieldsRequested: false;
    rawAnchorProjectionSha256: string;
    targetOrderPreserved: true;
  };
}

export type C6LiveMultiLangNeighborCensusCompletion =
  | (
    C6LiveMultiLangNeighborCensusCompletionBase & {
      plan: ArtifactReference & {
        selectedRepositoryProjectionSha256: string;
      };
      schemaVersion: 1;
    }
  )
  | (
    C6LiveMultiLangNeighborCensusCompletionBase & {
      plan: ArtifactReference & ContinuationPlanBinding;
      schemaVersion: 2;
    }
  );

export type C6LiveMultiLangNeighborCensusFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export async function captureC6LiveMultiLangNeighborCensus(input: {
  expectedPlanSchemaVersion?: 1 | 2;
  expectedPlanSha256: string;
  expectedPriorPlanSha256?: string;
  expectedPriorSelectedRepositoryProjectionSha256?: string;
  fetchImpl: C6LiveMultiLangNeighborCensusFetch;
  outputRoot: string;
  planPath: string;
  priorPlanPath?: string;
  testHooks?: {
    beforePrepublicationVerification?: (
      temporaryRoot: string,
    ) => Promise<void> | void;
    beforePublishedVerification?: (
      publishedRoot: string,
    ) => Promise<void> | void;
    beforeTerminalVerification?: () => Promise<void> | void;
  };
  token: string;
}): Promise<{
  assetRootSha256: string;
  completion: C6LiveMultiLangNeighborCensusCompletion;
  completionSha256: string;
  outputRoot: string;
}> {
  const expectedPlanSha256 = sha256Schema.parse(
    input.expectedPlanSha256,
  );
  const token = requiredUnpadded(input.token, "GitHub token");
  const planPath = await assertC6NoSymlinkPathComponents(
    input.planPath,
    "C6 neighbor census capture plan",
  );
  const planBytes = await readC6StableRegularFile(
    planPath,
    "neighbor census capture plan",
  );
  if (sha256(planBytes) !== expectedPlanSha256) {
    throw new Error(
      "C6 neighbor census capture plan hash mismatch",
    );
  }
  const rawPlan = parseJson(planBytes, "plan");
  if (
    typeof rawPlan === "object" &&
    rawPlan !== null &&
    "schemaVersion" in rawPlan &&
    rawPlan.schemaVersion === 2
  ) {
    assertNoForbiddenSelectionInputs(rawPlan, "plan");
  }
  const plan = planSchema.parse(rawPlan);
  const expectedPlanSchemaVersion =
    input.expectedPlanSchemaVersion ?? 1;
  if (plan.schemaVersion !== expectedPlanSchemaVersion) {
    throw new Error(
      "C6 neighbor census capture plan schema version mismatch",
    );
  }
  if (
    planBytes.toString("utf8") !==
      `${JSON.stringify(rawPlan, null, 2)}\n` ||
    sha256(JSON.stringify(
      plan.targets.map(selectedRepositoryProjection),
    )) !==
      plan.independenceBoundary.selectedRepositoryProjectionSha256
  ) {
    throw new Error(
      "C6 neighbor census capture plan projection mismatch",
    );
  }
  let continuationPlanBinding:
    ContinuationPlanBinding | undefined;
  let priorPlanClosure:
    ContinuationPriorPlanClosure | undefined;
  if (plan.schemaVersion === 2) {
    priorPlanClosure = await loadContinuationPriorPlan({
      expectedPlanSha256,
      expectedPriorPlanSha256:
        input.expectedPriorPlanSha256,
      expectedPriorSelectedRepositoryProjectionSha256:
        input.expectedPriorSelectedRepositoryProjectionSha256,
      plan,
      priorPlanPath: input.priorPlanPath,
    });
    continuationPlanBinding = priorPlanClosure.binding;
  }
  if (
    plan.schemaVersion === 1 &&
    (
      input.expectedPriorPlanSha256 !== undefined ||
      input.expectedPriorSelectedRepositoryProjectionSha256 !==
        undefined ||
      input.priorPlanPath !== undefined
    )
  ) {
    throw new Error(
      "C6 neighbor census capture prior-plan bindings require plan schema v2",
    );
  }
  assertTargetOrder(plan.targets, plan.schemaVersion);

  const outputRoot = resolve(
    requiredUnpadded(input.outputRoot, "output root"),
  );
  await assertC6NoSymlinkPathComponents(
    dirname(outputRoot),
    "C6 neighbor census capture output parent",
  );
  await assertDoesNotExist(outputRoot);
  const temporaryRoot =
    `${outputRoot}.incomplete-${randomUUID()}`;
  await mkdir(temporaryRoot, { mode: DIRECTORY_MODE });
  let outputRootCreated = false;
  try {
    await assertC6NoSymlinkPathComponents(
      temporaryRoot,
      "C6 neighbor census capture temporary root",
    );
    const captures: CompletionCapture[] = [];
    const referencedFiles: ArtifactReference[] = [];
    const allRawAnchors: RawAnchor[] = [];
    const observedAnchorIds = new Set<string>();
    for (const target of plan.targets) {
      await assertC6NoSymlinkPathComponents(
        temporaryRoot,
        "C6 neighbor census capture temporary root",
      );
      const captureDirectory = targetDirectory(target);
      const variables = {
        limit: CENSUS_CAP,
        name: target.repo,
        owner: target.owner,
      } as const;
      const canonicalRequest = {
        endpoint: ENDPOINT,
        headers: {
          ...REQUEST_HEADERS,
          authorization: "Bearer [REDACTED]" as const,
        },
        method: "POST" as const,
        query: C6_LIVE_MULTILANG_NEIGHBOR_CENSUS_QUERY,
        variables,
      };
      const requestBytes = Buffer.from(
        `${JSON.stringify(canonicalRequest, null, 2)}\n`,
      );
      const response = await input.fetchImpl(ENDPOINT, {
        body: JSON.stringify({
          query: C6_LIVE_MULTILANG_NEIGHBOR_CENSUS_QUERY,
          variables,
        }),
        headers: {
          ...REQUEST_HEADERS,
          authorization: `Bearer ${token}`,
        },
        method: "POST",
        redirect: "error",
      });
      const responseBytes = Buffer.from(
        await response.arrayBuffer(),
      );
      assertTokenAbsent(token, responseBytes);
      if (response.status !== 200) {
        throw new Error(
          "C6 neighbor census capture unexpected HTTP status " +
            response.status,
        );
      }
      const responseHeaders = selectResponseHeaders(
        response.headers,
      );
      const responseHeaderBytes = Buffer.from(
        `${JSON.stringify(responseHeaders, null, 2)}\n`,
      );
      const parsed = parseGraphqlResponse(responseBytes);
      const validated = validateRepositoryResponse({
        observedAnchorIds,
        parsed,
        target,
      });
      const captureBase:
        C6LiveMultiLangNeighborCensusRepositoryCaptureBase = {
        artifactKind:
          "c6-live-multilang-neighbor-census-repository-capture",
        boundary: {
          ...emptyBoundary(),
          status: "merged-pr-metadata-census-only-raw-anchors",
        },
        counts: {
          maximumRawAnchorCount: CENSUS_CAP,
          rawAnchorCount: validated.rawAnchors.length,
          totalMergedPullRequestCount: validated.totalCount,
        },
        discovery: {
          endCursor: validated.endCursor,
          hasNextPage: validated.hasNextPage,
          rateLimit: parsed.data.rateLimit,
        },
        independenceBoundary: {
          contentFieldsRequested: false,
          rawAnchorProjectionSha256: sha256(JSON.stringify(
            validated.rawAnchors,
          )),
        },
        planTarget: target,
        request: {
          canonical: artifactReference(
            "request.json",
            requestBytes,
          ),
          endpoint: ENDPOINT,
          headers: canonicalRequest.headers,
          method: "POST",
          variables,
        },
        response: {
          body: artifactReference(
            "response.json",
            responseBytes,
          ),
          headers: artifactReference(
            "response-headers.json",
            responseHeaderBytes,
          ),
          httpStatus: response.status,
        },
      };
      const capture:
        C6LiveMultiLangNeighborCensusRepositoryCapture =
        plan.schemaVersion === 1
          ? {
            ...captureBase,
            schemaVersion: 1,
          }
          : {
            ...captureBase,
            plan: continuationPlanBinding!,
            schemaVersion: 2,
          };
      const captureBytes = Buffer.from(
        `${JSON.stringify(capture, null, 2)}\n`,
      );
      assertTokenAbsent(
        token,
        requestBytes,
        responseHeaderBytes,
        responseBytes,
        captureBytes,
      );

      const directoryPath = join(
        temporaryRoot,
        captureDirectory,
      );
      await mkdir(directoryPath, { mode: DIRECTORY_MODE });
      await assertC6NoSymlinkPathComponents(
        directoryPath,
        "C6 neighbor census capture repository output",
      );
      await Promise.all([
        writeFile(
          join(directoryPath, "request.json"),
          requestBytes,
          { flag: "wx", mode: FILE_MODE },
        ),
        writeFile(
          join(directoryPath, "response-headers.json"),
          responseHeaderBytes,
          { flag: "wx", mode: FILE_MODE },
        ),
        writeFile(
          join(directoryPath, "response.json"),
          responseBytes,
          { flag: "wx", mode: FILE_MODE },
        ),
        writeFile(
          join(directoryPath, "capture.json"),
          captureBytes,
          { flag: "wx", mode: FILE_MODE },
        ),
      ]);
      const captureManifest = artifactReference(
        `${captureDirectory}/capture.json`,
        captureBytes,
      );
      referencedFiles.push(
        prefixArtifactReference(
          captureDirectory,
          capture.request.canonical,
        ),
        prefixArtifactReference(
          captureDirectory,
          capture.response.headers,
        ),
        prefixArtifactReference(
          captureDirectory,
          capture.response.body,
        ),
        captureManifest,
      );
      allRawAnchors.push(...validated.rawAnchors);
      captures.push({
        canonicalRepository: target.canonicalRepository,
        captureDirectory,
        captureManifest,
        hasNextPage: validated.hasNextPage,
        pilotRank: target.pilotRank,
        rawAnchorCount: validated.rawAnchors.length,
      });
    }

    await input.testHooks?.beforeTerminalVerification?.();
    const terminalPlanBytes = await readC6StableRegularFile(
      planPath,
      "neighbor census capture terminal plan",
    );
    if (
      !terminalPlanBytes.equals(planBytes) ||
      sha256(terminalPlanBytes) !== expectedPlanSha256
    ) {
      throw new Error(
        "C6 neighbor census capture plan changed during capture",
      );
    }
    if (priorPlanClosure !== undefined) {
      const terminalPriorPlanBytes =
        await readC6StableRegularFile(
          priorPlanClosure.path,
          "neighbor census capture terminal prior plan",
        );
      if (
        !terminalPriorPlanBytes.equals(priorPlanClosure.bytes) ||
        sha256(terminalPriorPlanBytes) !==
          priorPlanClosure.sha256
      ) {
        throw new Error(
          "C6 neighbor census capture prior plan changed during capture",
        );
      }
    }

    const completionBase:
      C6LiveMultiLangNeighborCensusCompletionBase = {
      artifactKind:
        "c6-live-multilang-neighbor-census-completion",
      boundary: {
        ...emptyBoundary(),
        status:
          "merged-pr-metadata-census-complete-raw-anchors-only",
      },
      captures,
      counts: {
        capturedRawAnchorCount: allRawAnchors.length,
        completedRepositoryCount: TARGET_COUNT,
        maximumRawAnchorCount: MAXIMUM_RAW_ANCHOR_COUNT,
        truncatedRepositoryCount: captures.filter(
          (capture) => capture.hasNextPage,
        ).length,
      },
      independenceBoundary: {
        contentFieldsRequested: false,
        rawAnchorProjectionSha256: sha256(JSON.stringify(
          allRawAnchors,
        )),
        targetOrderPreserved: true,
      },
    };
    const planReference = artifactReference(
      basename(planPath),
      planBytes,
    );
    const completion: C6LiveMultiLangNeighborCensusCompletion =
      plan.schemaVersion === 1
        ? {
          ...completionBase,
          plan: {
            ...planReference,
            selectedRepositoryProjectionSha256:
              plan.independenceBoundary
                .selectedRepositoryProjectionSha256,
          },
          schemaVersion: 1,
        }
        : {
          ...completionBase,
          plan: {
            ...planReference,
            ...continuationPlanBinding!,
          },
          schemaVersion: 2,
        };
    const completionBytes = Buffer.from(
      `${JSON.stringify(completion, null, 2)}\n`,
    );
    assertTokenAbsent(token, completionBytes);
    await writeFile(
      join(temporaryRoot, "completion.json"),
      completionBytes,
      { flag: "wx", mode: FILE_MODE },
    );
    referencedFiles.push(
      artifactReference("completion.json", completionBytes),
    );
    await input.testHooks?.beforePrepublicationVerification?.(
      temporaryRoot,
    );
    await assertExactCaptureTree(
      temporaryRoot,
      referencedFiles,
    );
    const prepublicationLock = await buildC6AssetLock(
      temporaryRoot,
    );

    await assertC6NoSymlinkPathComponents(
      dirname(outputRoot),
      "C6 neighbor census capture output parent",
    );
    await assertDoesNotExist(outputRoot);
    try {
      await mkdir(outputRoot, { mode: DIRECTORY_MODE });
      outputRootCreated = true;
    } catch (error) {
      if (isErrorCode(error, "EEXIST")) {
        throw new Error(
          "C6 neighbor census capture output already exists",
        );
      }
      throw error;
    }
    for (
      const entry of (await readdir(temporaryRoot)).sort(
        completionLast,
      )
    ) {
      await publishNoReplace(
        join(temporaryRoot, entry),
        join(outputRoot, entry),
      );
    }
    await assertExactCaptureTree(outputRoot, referencedFiles);
    const publishedLock = await buildC6AssetLock(outputRoot);
    const serializedPrepublicationLock =
      serializeC6AssetLock(prepublicationLock);
    const serializedPublishedLock =
      serializeC6AssetLock(publishedLock);
    if (
      serializedPublishedLock !== serializedPrepublicationLock
    ) {
      throw new Error(
        "C6 neighbor census capture published asset closure mismatch",
      );
    }
    await input.testHooks?.beforePublishedVerification?.(
      outputRoot,
    );
    await assertExactCaptureTree(outputRoot, referencedFiles);
    const terminalLock = await buildC6AssetLock(outputRoot);
    const serializedTerminalLock =
      serializeC6AssetLock(terminalLock);
    if (
      serializedTerminalLock !== serializedPrepublicationLock ||
      serializedTerminalLock !== serializedPublishedLock
    ) {
      throw new Error(
        "C6 neighbor census capture terminal asset closure mismatch",
      );
    }
    await rm(temporaryRoot, { recursive: true });
    return {
      assetRootSha256: terminalLock.assetRootSha256,
      completion,
      completionSha256: sha256(completionBytes),
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

function validateRepositoryResponse(input: {
  observedAnchorIds: Set<string>;
  parsed: ParsedResponse;
  target: CensusTarget;
}): {
  endCursor: string | null;
  hasNextPage: boolean;
  rawAnchors: RawAnchor[];
  totalCount: number;
} {
  const repository = normalizeRepository(
    input.parsed.data.repository.nameWithOwner,
  );
  if (repository !== input.target.canonicalRepository) {
    throw new Error(
      "C6 neighbor census capture repository identity mismatch",
    );
  }
  const connection = input.parsed.data.repository.pullRequests;
  const expectedNodeCount = Math.min(
    connection.totalCount,
    CENSUS_CAP,
  );
  const expectedHasNextPage =
    connection.totalCount > CENSUS_CAP;
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
    )
  ) {
    throw new Error(
      "C6 neighbor census capture pagination boundary mismatch",
    );
  }
  const rawAnchors: RawAnchor[] = [];
  let priorCreatedAt = Number.POSITIVE_INFINITY;
  for (const pull of connection.nodes) {
    const createdAt = Date.parse(pull.createdAt);
    if (createdAt > priorCreatedAt) {
      throw new Error(
        "C6 neighbor census capture must preserve CREATED_AT DESC order",
      );
    }
    priorCreatedAt = createdAt;
    const canonicalAnchorId = `${repository}#${pull.number}`;
    if (input.observedAnchorIds.has(canonicalAnchorId)) {
      throw new Error(
        `C6 neighbor census capture duplicate pull request ${canonicalAnchorId}`,
      );
    }
    input.observedAnchorIds.add(canonicalAnchorId);
    const expectedUrl =
      `https://github.com/${repository}/pull/${pull.number}`;
    if (normalizeUrl(pull.url) !== normalizeUrl(expectedUrl)) {
      throw new Error(
        "C6 neighbor census capture pull request identity mismatch",
      );
    }
    rawAnchors.push({
      authorLogin: pull.author?.login ?? null,
      baseRefOid: pull.baseRefOid,
      canonicalAnchorId,
      commentCount: pull.comments.totalCount,
      createdAt: pull.createdAt,
      mergeCommitOid: pull.mergeCommit.oid,
      mergedAt: pull.mergedAt,
      reviewCount: pull.reviews.totalCount,
      reviewThreadCount: pull.reviewThreads.totalCount,
      url: pull.url,
    });
  }
  return {
    endCursor: connection.pageInfo.endCursor,
    hasNextPage: connection.pageInfo.hasNextPage,
    rawAnchors,
    totalCount: connection.totalCount,
  };
}

function parseGraphqlResponse(bytes: Buffer): ParsedResponse {
  const raw = parseJson(bytes, "GraphQL response");
  if (
    typeof raw === "object" &&
    raw !== null &&
    "errors" in raw &&
    Array.isArray(raw.errors) &&
    raw.errors.length > 0
  ) {
    throw new Error(
      "C6 neighbor census capture returned GraphQL errors",
    );
  }
  return responseSchema.parse(raw);
}

async function loadContinuationPriorPlan(input: {
  expectedPlanSha256: string;
  expectedPriorPlanSha256: string | undefined;
  expectedPriorSelectedRepositoryProjectionSha256:
    string | undefined;
  plan: ContinuationPlan;
  priorPlanPath: string | undefined;
}): Promise<ContinuationPriorPlanClosure> {
  const expectedPriorPlanSha256 = sha256Schema.parse(
    requiredUnpadded(
      input.expectedPriorPlanSha256 ?? "",
      "expected prior-plan SHA-256",
    ),
  );
  const expectedPriorSelectedRepositoryProjectionSha256 =
    sha256Schema.parse(
      requiredUnpadded(
      input.expectedPriorSelectedRepositoryProjectionSha256 ?? "",
        "expected prior selected-repository projection SHA-256",
      ),
    );
  const priorPlanPath = await assertC6NoSymlinkPathComponents(
    requiredUnpadded(
      input.priorPlanPath ?? "",
      "prior plan path",
    ),
    "C6 neighbor census capture prior plan",
  );
  const priorPlanBytes = await readC6StableRegularFile(
    priorPlanPath,
    "neighbor census capture prior plan",
  );
  if (sha256(priorPlanBytes) !== expectedPriorPlanSha256) {
    throw new Error(
      "C6 neighbor census capture prior-plan hash mismatch",
    );
  }
  const rawPriorPlan = parseJson(priorPlanBytes, "prior plan");
  assertNoForbiddenSelectionInputs(rawPriorPlan, "prior plan");
  if (
    priorPlanBytes.toString("utf8") !==
      `${JSON.stringify(rawPriorPlan, null, 2)}\n`
  ) {
    throw new Error(
      "C6 neighbor census capture noncanonical prior plan",
    );
  }
  const parsedPriorPlan = planV1Schema.parse(rawPriorPlan);
  const priorProjectionSha256 = sha256(JSON.stringify(
    parsedPriorPlan.targets.map(selectedRepositoryProjection),
  ));
  if (
    priorProjectionSha256 !==
      parsedPriorPlan.independenceBoundary
        .selectedRepositoryProjectionSha256 ||
    priorProjectionSha256 !==
      expectedPriorSelectedRepositoryProjectionSha256
  ) {
    throw new Error(
      "C6 neighbor census capture prior selected-repository projection mismatch",
    );
  }
  assertTargetOrder(parsedPriorPlan.targets, 1);

  const priorPlan = input.plan.inputs.priorNeighborPlan;
  if (
    expectedPriorPlanSha256 !==
      input.plan.independenceBoundary.priorNeighborPlanSha256 ||
    expectedPriorPlanSha256 !== priorPlan.sha256
  ) {
    throw new Error(
      "C6 neighbor census capture prior-plan hash mismatch",
    );
  }
  if (
    expectedPriorSelectedRepositoryProjectionSha256 !==
      input.plan.independenceBoundary
        .priorSelectedRepositoryProjectionSha256 ||
    expectedPriorSelectedRepositoryProjectionSha256 !==
      priorPlan.selectedRepositoryProjectionSha256
  ) {
    throw new Error(
      "C6 neighbor census capture prior selected-repository projection mismatch",
    );
  }
  if (priorPlan.bytes !== priorPlanBytes.byteLength) {
    throw new Error(
      "C6 neighbor census capture prior-plan byte-length mismatch",
    );
  }
  if (priorPlan.path !== basename(priorPlanPath)) {
    throw new Error(
      "C6 neighbor census capture prior-plan path mismatch",
    );
  }
  const priorRepositories = new Set(
    parsedPriorPlan.targets.map(
      (target) => target.canonicalRepository,
    ),
  );
  const overlap = input.plan.targets.find((target) =>
    priorRepositories.has(target.canonicalRepository)
  );
  if (overlap !== undefined) {
    throw new Error(
      "C6 neighbor census capture continuation target " +
        `${overlap.canonicalRepository} overlaps prior plan`,
    );
  }
  return {
    binding: {
      artifactKind: input.plan.artifactKind,
      priorPlan,
      schemaVersion: input.plan.schemaVersion,
      selectedRepositoryProjectionSha256:
        input.plan.independenceBoundary
          .selectedRepositoryProjectionSha256,
      sha256: input.expectedPlanSha256,
    },
    bytes: priorPlanBytes,
    path: priorPlanPath,
    sha256: expectedPriorPlanSha256,
  };
}

function assertTargetOrder(
  targets: readonly CensusTarget[],
  planSchemaVersion: 1 | 2,
): void {
  const repositories = new Set<string>();
  for (const [index, target] of targets.entries()) {
    const pilotRank = index + 1;
    const expectedSplit = SOURCE_SPLITS[index % SOURCE_SPLITS.length]!;
    const expectedWithinSplitRank =
      Math.floor(index / SOURCE_SPLITS.length) +
      (planSchemaVersion === 1 ? 1 : 9);
    if (
      target.pilotRank !== pilotRank ||
      target.sourceSplit !== expectedSplit ||
      target.withinSplitRank !== expectedWithinSplitRank ||
      normalizeRepository(
        `${target.owner}/${target.repo}`,
      ) !== target.canonicalRepository ||
      repositories.has(target.canonicalRepository)
    ) {
      throw new Error(
        `C6 neighbor census capture target order mismatch ${pilotRank}`,
      );
    }
    repositories.add(target.canonicalRepository);
  }
}

function selectedRepositoryProjection(target: CensusTarget): unknown {
  return {
    pilotRank: target.pilotRank,
    sourceSplit: target.sourceSplit,
    withinSplitRank: target.withinSplitRank,
    canonicalRepository: target.canonicalRepository,
    seedCaptureOrder: target.seedCaptureOrder,
    seedAnchorId: target.seedAnchorId,
  };
}

function targetDirectory(target: CensusTarget): string {
  return `${
    String(target.pilotRank).padStart(3, "0")
  }__${target.owner}__${target.repo}`;
}

function emptyBoundary(): Boundary {
  return {
    acceptedEpisodeCount: 0,
    actorQualifiedEpisodeCount: 0,
    candidateManifestFrozen: false,
    codexRunReady: false,
    machineQualifiedEpisodeCount: 0,
    semanticallyQualifiedEpisodeCount: 0,
  };
}

function selectResponseHeaders(headers: Headers): Record<string, string> {
  const required = Object.fromEntries(
    REQUIRED_RESPONSE_HEADERS.map((name) => {
      const value = headers.get(name);
      if (value === null || value.length === 0) {
        throw new Error(
          `C6 neighbor census capture requires response header ${name}`,
        );
      }
      return [name, value];
    }),
  ) as Record<typeof REQUIRED_RESPONSE_HEADERS[number], string>;
  if (
    required["content-type"].split(";", 1)[0]!.trim().toLowerCase() !==
      "application/json" ||
    required["x-ratelimit-resource"] !== "graphql"
  ) {
    throw new Error(
      "C6 neighbor census capture provenance header mismatch",
    );
  }
  const selected: Record<string, string> = {};
  for (const name of SELECTED_RESPONSE_HEADERS) {
    const value = headers.get(name);
    if (value !== null) {
      selected[name] = value;
    }
  }
  return selected;
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

function prefixArtifactReference(
  directory: string,
  reference: ArtifactReference,
): ArtifactReference {
  return {
    ...reference,
    path: `${directory}/${reference.path}`,
  };
}

async function assertExactCaptureTree(
  root: string,
  references: readonly ArtifactReference[],
): Promise<void> {
  await assertC6NoSymlinkPathComponents(
    root,
    "C6 neighbor census capture exact tree root",
  );
  await assertMode(root, DIRECTORY_MODE, "root");
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
        "C6 neighbor census capture invalid closure path " +
          reference.path,
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
    ].sort()[0]!;
    throw new Error(
      `C6 neighbor census capture exact tree missing ${missing}`,
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
  const entries = await readdir(directory, {
    withFileTypes: true,
  });
  entries.sort((left, right) =>
    left.name.localeCompare(right.name)
  );
  for (const entry of entries) {
    const relativePath = relativeDirectory.length === 0
      ? entry.name
      : `${relativeDirectory}/${entry.name}`;
    const absolutePath = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        "C6 neighbor census capture exact tree rejects symlink " +
          relativePath,
      );
    }
    if (entry.isDirectory()) {
      if (!remainingDirectories.delete(relativePath)) {
        throw new Error(
          "C6 neighbor census capture exact tree unexpected directory " +
            relativePath,
        );
      }
      await assertMode(
        absolutePath,
        DIRECTORY_MODE,
        relativePath,
      );
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
        "C6 neighbor census capture exact tree rejects non-file " +
          relativePath,
      );
    }
    const expected = remainingFiles.get(relativePath);
    if (expected === undefined) {
      throw new Error(
        "C6 neighbor census capture exact tree unexpected file " +
          relativePath,
      );
    }
    await assertMode(absolutePath, FILE_MODE, relativePath);
    const bytes = await readC6StableRegularFile(
      absolutePath,
      "neighbor census capture exact tree file",
    );
    if (
      bytes.byteLength !== expected.bytes ||
      sha256(bytes) !== expected.sha256
    ) {
      throw new Error(
        "C6 neighbor census capture exact tree content mismatch " +
          relativePath,
      );
    }
    remainingFiles.delete(relativePath);
  }
}

async function assertMode(
  path: string,
  expectedMode: number,
  label: string,
): Promise<void> {
  const actualMode = (await lstat(path)).mode & 0o777;
  if (actualMode !== expectedMode) {
    throw new Error(
      "C6 neighbor census capture exact tree mode mismatch " +
        `${label}: expected ${expectedMode.toString(8)}, ` +
        `received ${actualMode.toString(8)}`,
    );
  }
}

async function publishNoReplace(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  const sourceStat = await lstat(sourcePath);
  if (sourceStat.isSymbolicLink()) {
    throw new Error(
      `C6 neighbor census capture refuses symlink ${sourcePath}`,
    );
  }
  if (sourceStat.isDirectory()) {
    await mkdir(destinationPath, {
      mode: sourceStat.mode & 0o777,
    });
    for (const entry of (await readdir(sourcePath)).sort()) {
      await publishNoReplace(
        join(sourcePath, entry),
        join(destinationPath, entry),
      );
    }
    return;
  }
  if (!sourceStat.isFile()) {
    throw new Error(
      `C6 neighbor census capture refuses non-file ${sourcePath}`,
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

function assertTokenAbsent(
  token: string,
  ...artifacts: readonly Uint8Array[]
): void {
  const tokenBytes = Buffer.from(token);
  if (
    artifacts.some((artifact) =>
      Buffer.from(artifact).includes(tokenBytes)
    )
  ) {
    throw new Error(
      "C6 neighbor census capture refuses to persist the GitHub token",
    );
  }
}

async function assertDoesNotExist(path: string): Promise<void> {
  try {
    await lstat(path);
    const error = new Error(
      "C6 neighbor census capture output already exists",
    ) as Error & { code: string };
    error.code = "EEXIST";
    throw error;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
}

function normalizeRepository(value: string): string {
  return repositorySchema.parse(value).toLowerCase();
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host.toLowerCase()}${
    url.pathname.toLowerCase()
  }`;
}

function requiredUnpadded(value: string, label: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(
      `C6 neighbor census capture ${label} must not be empty or padded`,
    );
  }
  return value;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(`C6 neighbor census capture invalid ${label} JSON`);
  }
}

function assertNoForbiddenSelectionInputs(
  value: unknown,
  label: string,
  path: readonly (number | string)[] = [],
): void {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      assertNoForbiddenSelectionInputs(
        entry,
        label,
        [...path, index],
      );
    }
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = [...path, key];
    if (
      isForbiddenSelectionInputKey(key) &&
      !isAllowedFalseAttestation(path, key, entry)
    ) {
      throw new Error(
        "C6 neighbor census capture forbidden selection input " +
          `${label} ${formatJsonPath(entryPath)}`,
      );
    }
    assertNoForbiddenSelectionInputs(
      entry,
      label,
      entryPath,
    );
  }
}

function isAllowedFalseAttestation(
  parentPath: readonly (number | string)[],
  key: string,
  value: unknown,
): boolean {
  return (
    parentPath.length === 1 &&
    parentPath[0] === "independenceBoundary" &&
    ALLOWED_FALSE_ATTESTATION_KEYS.has(key) &&
    value === false
  );
}

function isForbiddenSelectionInputKey(key: string): boolean {
  const tokens = key
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .split(/[^A-Za-z0-9]+/u)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());
  if (
    tokens.some((token) =>
      FORBIDDEN_SELECTION_KEY_TOKENS.has(token)
    )
  ) {
    return true;
  }
  const normalizedKey = tokens.join("");
  return (
    FORBIDDEN_COLLAPSED_SELECTION_KEYS.has(normalizedKey) ||
    normalizedKey.includes("semanticdecision") ||
    normalizedKey.includes("machinedecision")
  );
}

function formatJsonPath(
  path: readonly (number | string)[],
): string {
  return path.reduce<string>(
    (formatted, segment) =>
      typeof segment === "number"
        ? `${formatted}[${segment}]`
        : `${formatted}.${segment}`,
    "$",
  );
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
