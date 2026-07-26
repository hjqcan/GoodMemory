import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

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
  C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2,
  projectC6StructuralReviewPretargetEvents,
  selectC6MinimumLinearReviewSequence,
  serializeC6StructuralReviewEventPolicy,
} from "./c6-review-event-policy";
import type {
  C6ReviewPolicyCommit,
  C6ReviewPolicyReview,
  C6ReviewPolicyThread,
} from "./c6-review-event-policy";

const ARTIFACT_KIND =
  "c6-multilingual-review-trajectory-expansion";
const REPOSITORY_CAP = 4;
const DATASET_ID = "SWE-bench/SWE-bench_Multilingual";
const SOURCE_REVISION =
  "e5c585e008e2cb5eecc7c64192d855c53279d788";
const CAPTURE_FILES = [
  "capture.json",
  "request.json",
  "response-headers.json",
  "response.json",
] as const;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const artifactReferenceSchema = z.object({
  bytes: z.number().int().nonnegative(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const targetSchema = z.object({
  agentVisibleRequestSha256: sha256Schema,
  captureDirectory: z.string().min(1),
  captureOrder: z.number().int().positive(),
  instanceId: z.string().min(1),
  owner: z.string().min(1),
  pullNumber: z.number().int().positive(),
  repo: z.string().min(1),
  requestedAnchorId: z.string().min(1),
  rowIndex: z.number().int().nonnegative(),
  sourceSplit: z.string().min(1).optional(),
  sourceSplitRowIndex: z.number().int().nonnegative().optional(),
}).passthrough();
const capturePlanSchema = z.object({
  artifactKind: z.enum([
    "c6-multilingual-source-expansion-plan",
    "c6-swe-bench-live-multilang-capture-plan",
  ]),
  counts: z.object({
    sourceRowCount: z.number().int().positive(),
    targetCount: z.number().int().positive(),
  }).passthrough(),
  independenceBoundary: z.object({
    targetProjectionSha256: sha256Schema,
  }).passthrough(),
  schemaVersion: z.literal(1),
  sourcePool: z.union([
    z.object({
      datasetId: z.literal(DATASET_ID),
      revision: z.literal(SOURCE_REVISION),
    }).passthrough(),
    z.object({
      datasetId: z.literal("SWE-bench-Live/MultiLang"),
      revision: z.literal(
        "608f7ae9ab8ea1f9f0d030fe04562cf6bd1a0c8b",
      ),
    }).passthrough(),
  ]),
  targets: z.array(targetSchema).min(1),
}).passthrough();
const priorFrameSchema = z.object({
  artifactKind: z.literal("c6-source-expansion-screening-frame"),
  candidates: z.array(z.object({
    canonicalAnchorId: z.string().min(1),
  }).passthrough()).min(1),
  counts: z.object({
    combinedStructuralCandidateCount: z.number().int().positive(),
  }).passthrough(),
  independenceBoundary: z.object({
    candidateProjectionSha256: sha256Schema,
  }).passthrough(),
  schemaVersion: z.union([z.literal(2), z.literal(3)]),
}).passthrough();
const pageInfoSchema = z.object({
  endCursor: z.string().nullable(),
  hasNextPage: z.boolean(),
}).passthrough();
const authorSchema = z.object({
  login: z.string().min(1),
}).passthrough().nullable();
const responseSchema = z.object({
  data: z.object({
    repository: z.object({
      nameWithOwner: z.string().min(3),
      pullRequest: z.object({
        baseRepository: z.object({
          nameWithOwner: z.string().min(3),
        }).passthrough(),
        commits: z.object({
          nodes: z.array(z.object({
            commit: z.object({
              committedDate: z.iso.datetime(),
              oid: commitSchema,
              parents: z.object({
                nodes: z.array(
                  z.object({ oid: commitSchema }).passthrough().nullable(),
                ),
                pageInfo: pageInfoSchema,
              }).passthrough(),
            }).passthrough(),
          }).passthrough().nullable()),
          pageInfo: pageInfoSchema,
        }).passthrough(),
        number: z.number().int().positive(),
        reviews: z.object({
          nodes: z.array(z.object({
            author: authorSchema,
            body: z.string(),
            commit: z.object({ oid: commitSchema }).passthrough().nullable(),
            id: z.string().min(1),
            state: z.string().min(1),
            submittedAt: z.iso.datetime(),
          }).passthrough().nullable()),
          pageInfo: pageInfoSchema,
        }).passthrough(),
        reviewThreads: z.object({
          nodes: z.array(z.object({
            comments: z.object({
              nodes: z.array(z.object({
                author: authorSchema,
                body: z.string(),
                createdAt: z.iso.datetime(),
                id: z.string().min(1),
                originalCommit: z.object({
                  oid: commitSchema,
                }).passthrough().nullable(),
              }).passthrough().nullable()),
              pageInfo: pageInfoSchema,
            }).passthrough(),
            id: z.string().min(1),
          }).passthrough().nullable()),
          pageInfo: pageInfoSchema,
        }).passthrough(),
        url: z.url(),
      }).passthrough(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();
const captureManifestSchema = z.object({
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
    repository: z.string().min(3),
    repositoryRedirect: z.object({
      requestedRepository: z.string().min(3),
      resolvedRepository: z.string().min(3),
      status: z.literal("explicit-graphql-resolution-observed"),
    }).strict().optional(),
    url: z.url(),
  }).strict(),
}).strict();
const requestSchema = z.object({
  query: z.literal(C6_GITHUB_GRAPHQL_DISCOVERY_QUERY),
  variables: z.object({
    name: z.string().min(1),
    number: z.number().int().positive(),
    owner: z.string().min(1),
  }).strict(),
}).strict();
const responseHeaderSchema = z.object({
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

export interface C6MultilingualExpansionTarget {
  agentVisibleRequestSha256: string;
  captureDirectory: string;
  captureOrder: number;
  instanceId: string;
  owner: string;
  pullNumber: number;
  repo: string;
  requestedAnchorId: string;
  rowIndex: number;
  sourceSplit?: string;
  sourceSplitRowIndex?: number;
}

export interface C6ValidatedMultilingualGraphqlCapture {
  canonicalRepository: string;
  captureManifestSha256: string;
  commits: C6ReviewPolicyCommit[];
  paginationGaps: Array<{
    endCursor: string | null;
    path: string;
  }>;
  responseSha256: string;
  reviews: C6ReviewPolicyReview[];
  reviewThreads: C6ReviewPolicyThread[];
}

type LinearSequence = NonNullable<
  ReturnType<typeof selectC6MinimumLinearReviewSequence>
>["sequence"];

interface CommonResult {
  agentVisibleRequestSha256: string;
  canonicalAnchorId: string;
  canonicalRepository: string;
  captureDirectory: string;
  captureManifestSha256: string;
  captureOrder: number;
  instanceId: string;
  requestedAnchorId: string;
  responseSha256: string;
  rowIndex: number;
  sourceSplit?: string;
  sourceSplitRowIndex?: number;
}

interface SequenceResult extends CommonResult {
  legalSequenceCount: number;
  pretargetEventCount: number;
  sequence: LinearSequence;
  sequenceLineageIdentitySha256: string;
}

export type C6MultilingualExpansionResult =
  | CommonResult & {
    paginationGaps: C6ValidatedMultilingualGraphqlCapture["paginationGaps"];
    status: "unsupported-pagination";
  }
  | CommonResult & {
    pretargetEventCount: number;
    status: "no-broad-structural-sequence";
  }
  | SequenceResult & {
    status: "prior-frame-overlap";
  }
  | SequenceResult & {
    status: "broad-structural-pretarget";
  };

export interface C6MultilingualReviewTrajectoryExpansion {
  artifactKind: typeof ARTIFACT_KIND;
  boundary: {
    acceptedEpisodeCount: 0;
    candidateManifestFrozen: false;
    codexRunReady: false;
    machineQualifiedEpisodeCount: 0;
    pullAuthorQualified: false;
    status: "multilingual-broad-structural-pretargets-only";
  };
  counts: {
    broadStructuralPretargetCount: number;
    broadStructuralRepositoryCount: number;
    capturedClosureCount: number;
    discoveryCompleteCount: number;
    freshBroadStructuralPretargetCount: number;
    priorFrameOverlapCount: number;
    repositoryCappedFreshCeiling: number;
    sourceTargetCount: number;
    unsupportedPaginationCount: number;
  };
  independenceBoundary: {
    broadPretargetProjectionSha256: string;
    evaluatorFieldInput: false;
    freshPretargetProjectionSha256: string;
    machineOutcomeInput: false;
    semanticLedgerInput: false;
    sourceOrderChanged: false;
  };
  inputs: {
    capturePlanSha256: string;
    graphqlRootSha256: string;
    priorCandidateProjectionSha256: string;
    priorFrameSha256: string;
  };
  policy: {
    definition: typeof C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2;
    policyId: "prospective-structural-review-v2";
    schemaVersion: 2;
    sha256: string;
  };
  results: C6MultilingualExpansionResult[];
  sourceDataset?: {
    datasetId: string;
    revision: string;
  };
  rule: {
    canonicalIdentity:
      "lowercase-resolved-repository-plus-pull-number";
    forbiddenConstructionInputs: readonly [
      "baseCommit",
      "decision",
      "evaluatorOnlySha256",
      "failToPassSha256",
      "goldPatchSha256",
      "hintsSha256",
      "normalizedRowSha256",
      "passToPassSha256",
      "testPatchSha256",
      "semanticScreeningDecision",
      "machineQualificationDecision",
      "outcome",
    ];
    pagination: "any-observed-gap-fails-target-closed";
    repositoryCap: 4;
    resultOrder: "frozen-captureOrder-ascending";
  };
  schemaVersion: 1;
}

export function deriveC6MultilingualReviewTrajectoryExpansion(input: {
  capturePlanSha256: string;
  capturesByDirectory: ReadonlyMap<
    string,
    C6ValidatedMultilingualGraphqlCapture
  >;
  graphqlRootSha256: string;
  priorCandidateProjectionSha256: string;
  priorFrameCanonicalAnchorIds: ReadonlySet<string>;
  priorFrameSha256: string;
  sourceDataset?: {
    datasetId: string;
    revision: string;
  };
  targets: readonly C6MultilingualExpansionTarget[];
}): C6MultilingualReviewTrajectoryExpansion {
  const capturePlanSha256 = sha256Schema.parse(input.capturePlanSha256);
  const graphqlRootSha256 = sha256Schema.parse(input.graphqlRootSha256);
  const priorCandidateProjectionSha256 = sha256Schema.parse(
    input.priorCandidateProjectionSha256,
  );
  const priorFrameSha256 = sha256Schema.parse(input.priorFrameSha256);
  const targets = [...input.targets].sort(
    (left, right) => left.captureOrder - right.captureOrder,
  );
  assertTargets(targets);
  const knownDirectories = new Set(
    targets.map((target) => target.captureDirectory),
  );
  for (const directory of input.capturesByDirectory.keys()) {
    if (!knownDirectories.has(directory)) {
      throw new Error(
        `C6 multilingual expansion unexpected capture ${directory}`,
      );
    }
  }
  const priorAnchors = new Set(
    [...input.priorFrameCanonicalAnchorIds].map(normalizeAnchor),
  );
  if (priorAnchors.size !== input.priorFrameCanonicalAnchorIds.size) {
    throw new Error(
      "C6 multilingual expansion duplicate prior-frame anchor",
    );
  }
  const canonicalAnchors = new Set<string>();
  const results: C6MultilingualExpansionResult[] = [];
  for (const target of targets) {
    const capture = input.capturesByDirectory.get(
      target.captureDirectory,
    );
    if (capture === undefined) {
      throw new Error(
        `C6 multilingual expansion missing capture ${
          target.captureDirectory
        }`,
      );
    }
    const canonicalRepository = normalizeRepository(
      capture.canonicalRepository,
    );
    const canonicalAnchorId =
      `${canonicalRepository}#${target.pullNumber}`;
    if (canonicalAnchors.has(canonicalAnchorId)) {
      throw new Error(
        `C6 multilingual expansion canonical anchor collision ${
          canonicalAnchorId
        }`,
      );
    }
    canonicalAnchors.add(canonicalAnchorId);
    const common: CommonResult = {
      agentVisibleRequestSha256: sha256Schema.parse(
        target.agentVisibleRequestSha256,
      ),
      canonicalAnchorId,
      canonicalRepository,
      captureDirectory: target.captureDirectory,
      captureManifestSha256: sha256Schema.parse(
        capture.captureManifestSha256,
      ),
      captureOrder: target.captureOrder,
      instanceId: target.instanceId,
      requestedAnchorId: target.requestedAnchorId,
      responseSha256: sha256Schema.parse(capture.responseSha256),
      rowIndex: target.rowIndex,
      ...(target.sourceSplit === undefined
        ? {}
        : {
          sourceSplit: target.sourceSplit,
          sourceSplitRowIndex: target.sourceSplitRowIndex,
        }),
    };
    if (capture.paginationGaps.length > 0) {
      results.push({
        ...common,
        paginationGaps: [...capture.paginationGaps].sort(compareGaps),
        status: "unsupported-pagination",
      });
      continue;
    }
    const events = projectC6StructuralReviewPretargetEvents({
      reviews: capture.reviews,
      reviewThreads: capture.reviewThreads,
    });
    const selected = selectC6MinimumLinearReviewSequence({
      anchorId: canonicalAnchorId,
      commits: capture.commits,
      events,
    });
    if (selected === null) {
      results.push({
        ...common,
        pretargetEventCount: events.length,
        status: "no-broad-structural-sequence",
      });
      continue;
    }
    const sequence = {
      ...common,
      legalSequenceCount: selected.legalSequenceCount,
      pretargetEventCount: events.length,
      sequence: selected.sequence,
      sequenceLineageIdentitySha256: selected.lineageIdentitySha256,
    };
    results.push(
      priorAnchors.has(canonicalAnchorId)
        ? { ...sequence, status: "prior-frame-overlap" }
        : { ...sequence, status: "broad-structural-pretarget" },
    );
  }
  const broad = results.filter(isBroadPretarget);
  const fresh = results.filter(
    (result): result is SequenceResult & {
      status: "broad-structural-pretarget";
    } => result.status === "broad-structural-pretarget",
  );
  const freshByRepository = new Map<string, number>();
  for (const result of fresh) {
    freshByRepository.set(
      result.canonicalRepository,
      (freshByRepository.get(result.canonicalRepository) ?? 0) + 1,
    );
  }
  return {
    artifactKind: ARTIFACT_KIND,
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      machineQualifiedEpisodeCount: 0,
      pullAuthorQualified: false,
      status: "multilingual-broad-structural-pretargets-only",
    },
    counts: {
      broadStructuralPretargetCount: broad.length,
      broadStructuralRepositoryCount: new Set(
        broad.map((result) => result.canonicalRepository),
      ).size,
      capturedClosureCount: input.capturesByDirectory.size,
      discoveryCompleteCount: results.filter(
        (result) => result.status !== "unsupported-pagination",
      ).length,
      freshBroadStructuralPretargetCount: fresh.length,
      priorFrameOverlapCount: results.filter(
        (result) => result.status === "prior-frame-overlap",
      ).length,
      repositoryCappedFreshCeiling: [...freshByRepository.values()]
        .reduce(
          (sum, count) => sum + Math.min(REPOSITORY_CAP, count),
          0,
        ),
      sourceTargetCount: targets.length,
      unsupportedPaginationCount: results.filter(
        (result) => result.status === "unsupported-pagination",
      ).length,
    },
    independenceBoundary: {
      broadPretargetProjectionSha256: sha256(
        JSON.stringify(broad.map(candidateProjection)),
      ),
      evaluatorFieldInput: false,
      freshPretargetProjectionSha256: sha256(
        JSON.stringify(fresh.map(candidateProjection)),
      ),
      machineOutcomeInput: false,
      semanticLedgerInput: false,
      sourceOrderChanged: false,
    },
    inputs: {
      capturePlanSha256,
      graphqlRootSha256,
      priorCandidateProjectionSha256,
      priorFrameSha256,
    },
    policy: {
      definition: C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2,
      policyId: C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2.policyId,
      schemaVersion: C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2.schemaVersion,
      sha256: sha256(serializeC6StructuralReviewEventPolicy()),
    },
    results,
    ...(input.sourceDataset === undefined
      ? {}
      : {
        sourceDataset: validateSourceDataset(input.sourceDataset),
      }),
    rule: {
      canonicalIdentity:
        "lowercase-resolved-repository-plus-pull-number",
      forbiddenConstructionInputs: [
        "baseCommit",
        "decision",
        "evaluatorOnlySha256",
        "failToPassSha256",
        "goldPatchSha256",
        "hintsSha256",
        "normalizedRowSha256",
        "passToPassSha256",
        "testPatchSha256",
        "semanticScreeningDecision",
        "machineQualificationDecision",
        "outcome",
      ],
      pagination: "any-observed-gap-fails-target-closed",
      repositoryCap: REPOSITORY_CAP,
      resultOrder: "frozen-captureOrder-ascending",
    },
    schemaVersion: 1,
  };
}

export function serializeC6MultilingualReviewTrajectoryExpansion(
  expansion: C6MultilingualReviewTrajectoryExpansion,
): string {
  return `${JSON.stringify(expansion, null, 2)}\n`;
}

export async function buildC6MultilingualReviewTrajectoryExpansion(input: {
  capturePlanPath: string;
  expectedCapturePlanSha256: string;
  expectedGraphqlRootSha256: string;
  expectedPriorFrameSha256: string;
  graphqlRoot: string;
  priorFramePath: string;
  testHooks?: {
    beforeTerminalVerification?: () => Promise<void> | void;
  };
}): Promise<{
  expansion: C6MultilingualReviewTrajectoryExpansion;
  outputSha256: string;
}> {
  const expectedCapturePlanSha256 = sha256Schema.parse(
    input.expectedCapturePlanSha256,
  );
  const expectedGraphqlRootSha256 = sha256Schema.parse(
    input.expectedGraphqlRootSha256,
  );
  const expectedPriorFrameSha256 = sha256Schema.parse(
    input.expectedPriorFrameSha256,
  );
  const [capturePlanPath, priorFramePath, graphqlRoot] =
    await Promise.all([
      assertC6NoSymlinkPathComponents(
        input.capturePlanPath,
        "C6 multilingual expansion capture plan",
      ),
      assertC6NoSymlinkPathComponents(
        input.priorFramePath,
        "C6 multilingual expansion prior frame",
      ),
      assertC6NoSymlinkPathComponents(
        input.graphqlRoot,
        "C6 multilingual expansion GraphQL root",
      ),
    ]);
  const [planBytes, frameBytes, graphqlLock] = await Promise.all([
    readC6StableRegularFile(
      capturePlanPath,
      "multilingual expansion capture plan",
    ),
    readC6StableRegularFile(
      priorFramePath,
      "multilingual expansion prior frame",
    ),
    buildC6AssetLock(graphqlRoot),
  ]);
  if (sha256(planBytes) !== expectedCapturePlanSha256) {
    throw new Error(
      "C6 multilingual expansion capture plan hash mismatch",
    );
  }
  if (sha256(frameBytes) !== expectedPriorFrameSha256) {
    throw new Error(
      "C6 multilingual expansion prior frame hash mismatch",
    );
  }
  if (graphqlLock.assetRootSha256 !== expectedGraphqlRootSha256) {
    throw new Error(
      "C6 multilingual expansion GraphQL root hash mismatch",
    );
  }
  const rawPlan = parseJson(planBytes, "capture plan");
  const plan = capturePlanSchema.parse(rawPlan);
  if (
    plan.targets.length !== plan.counts.targetCount ||
    plan.targets.length !== plan.counts.sourceRowCount ||
    sha256(JSON.stringify(
      (rawPlan as { targets: unknown }).targets,
    )) !== plan.independenceBoundary.targetProjectionSha256
  ) {
    throw new Error(
      "C6 multilingual expansion capture plan projection mismatch",
    );
  }
  const rawFrame = parseJson(frameBytes, "prior frame");
  const frame = priorFrameSchema.parse(rawFrame);
  if (
    frame.candidates.length !==
      frame.counts.combinedStructuralCandidateCount ||
    sha256(JSON.stringify(
      (rawFrame as { candidates: unknown }).candidates,
    )) !== frame.independenceBoundary.candidateProjectionSha256
  ) {
    throw new Error(
      "C6 multilingual expansion prior frame projection mismatch",
    );
  }
  assertCaptureRootStructure(graphqlLock, plan.targets);
  const graphqlFiles = new Map(
    graphqlLock.files.map((file) => [file.path, file]),
  );
  const capturesByDirectory = new Map<
    string,
    C6ValidatedMultilingualGraphqlCapture
  >();
  for (const target of plan.targets) {
    capturesByDirectory.set(
      target.captureDirectory,
      await validateGraphqlCapture({
        files: graphqlFiles,
        graphqlRoot,
        target,
      }),
    );
  }
  const expansion = deriveC6MultilingualReviewTrajectoryExpansion({
    capturePlanSha256: expectedCapturePlanSha256,
    capturesByDirectory,
    graphqlRootSha256: expectedGraphqlRootSha256,
    priorCandidateProjectionSha256:
      frame.independenceBoundary.candidateProjectionSha256,
    priorFrameCanonicalAnchorIds: new Set(
      frame.candidates.map((candidate) => candidate.canonicalAnchorId),
    ),
    priorFrameSha256: expectedPriorFrameSha256,
    ...(plan.artifactKind ===
        "c6-swe-bench-live-multilang-capture-plan"
      ? {
        sourceDataset: {
          datasetId: plan.sourcePool.datasetId,
          revision: plan.sourcePool.revision,
        },
      }
      : {}),
    targets: plan.targets,
  });

  await input.testHooks?.beforeTerminalVerification?.();
  const [terminalPlanBytes, terminalFrameBytes, terminalGraphqlLock] =
    await Promise.all([
      readC6StableRegularFile(
        capturePlanPath,
        "multilingual expansion terminal capture plan",
      ),
      readC6StableRegularFile(
        priorFramePath,
        "multilingual expansion terminal prior frame",
      ),
      buildC6AssetLock(graphqlRoot),
    ]);
  if (
    !terminalPlanBytes.equals(planBytes) ||
    !terminalFrameBytes.equals(frameBytes) ||
    serializeC6AssetLock(terminalGraphqlLock) !==
      serializeC6AssetLock(graphqlLock)
  ) {
    throw new Error(
      "C6 multilingual expansion input closure changed during projection",
    );
  }
  const serialized =
    serializeC6MultilingualReviewTrajectoryExpansion(expansion);
  return {
    expansion,
    outputSha256: sha256(serialized),
  };
}

export async function materializeC6MultilingualReviewTrajectoryExpansion(
  input: {
    capturePlanPath: string;
    expectedCapturePlanSha256: string;
    expectedGraphqlRootSha256: string;
    expectedPriorFrameSha256: string;
    graphqlRoot: string;
    outputPath: string;
    priorFramePath: string;
    testHooks?: {
      beforeTerminalVerification?: () => Promise<void> | void;
    };
  },
): Promise<{
  expansion: C6MultilingualReviewTrajectoryExpansion;
  outputSha256: string;
}> {
  const result =
    await buildC6MultilingualReviewTrajectoryExpansion(input);
  const outputPath = resolve(input.outputPath);
  await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 multilingual expansion output parent",
  );
  const handle = await open(outputPath, "wx", 0o644);
  try {
    await handle.writeFile(
      serializeC6MultilingualReviewTrajectoryExpansion(
        result.expansion,
      ),
      "utf8",
    );
  } finally {
    await handle.close();
  }
  return result;
}

export async function replayC6MultilingualReviewTrajectoryExpansion(
  input: {
    capturePlanPath: string;
    expectedCapturePlanSha256: string;
    expectedGraphqlRootSha256: string;
    expectedPriorFrameSha256: string;
    expectedProjectionSha256: string;
    graphqlRoot: string;
    priorFramePath: string;
    projectionPath: string;
  },
): Promise<{
  expansion: C6MultilingualReviewTrajectoryExpansion;
  projectionSha256: string;
  reproduced: true;
}> {
  const expectedProjectionSha256 = sha256Schema.parse(
    input.expectedProjectionSha256,
  );
  const projectionPath = await assertC6NoSymlinkPathComponents(
    input.projectionPath,
    "C6 multilingual expansion projection",
  );
  const projectionBytes = await readC6StableRegularFile(
    projectionPath,
    "multilingual expansion projection",
  );
  if (sha256(projectionBytes) !== expectedProjectionSha256) {
    throw new Error(
      "C6 multilingual expansion projection hash mismatch",
    );
  }
  const result = await buildC6MultilingualReviewTrajectoryExpansion(
    input,
  );
  const reproducedBytes = Buffer.from(
    serializeC6MultilingualReviewTrajectoryExpansion(
      result.expansion,
    ),
  );
  if (!projectionBytes.equals(reproducedBytes)) {
    throw new Error(
      "C6 multilingual expansion projection does not match recomputation",
    );
  }
  const terminalProjectionBytes = await readC6StableRegularFile(
    projectionPath,
    "multilingual expansion terminal projection",
  );
  if (!terminalProjectionBytes.equals(projectionBytes)) {
    throw new Error(
      "C6 multilingual expansion projection changed during replay",
    );
  }
  return {
    expansion: result.expansion,
    projectionSha256: result.outputSha256,
    reproduced: true,
  };
}

function assertCaptureRootStructure(
  lock: C6AssetLock,
  targets: readonly C6MultilingualExpansionTarget[],
): void {
  const directories = new Set(
    targets.map((target) => target.captureDirectory),
  );
  const expected = new Set(
    targets.flatMap((target) =>
      CAPTURE_FILES.map(
        (file) => `${target.captureDirectory}/${file}`,
      )
    ),
  );
  for (const file of lock.files) {
    const [directory, name, extra] = file.path.split("/");
    if (
      extra !== undefined ||
      directory === undefined ||
      name === undefined ||
      !directories.has(directory) ||
      !CAPTURE_FILES.includes(name as typeof CAPTURE_FILES[number])
    ) {
      throw new Error(
        `C6 multilingual expansion unexpected capture file ${file.path}`,
      );
    }
    expected.delete(file.path);
  }
  if (expected.size > 0) {
    throw new Error(
      `C6 multilingual expansion missing capture file ${
        [...expected].sort()[0]
      }`,
    );
  }
}

async function validateGraphqlCapture(input: {
  files: ReadonlyMap<string, C6AssetLock["files"][number]>;
  graphqlRoot: string;
  target: C6MultilingualExpansionTarget;
}): Promise<C6ValidatedMultilingualGraphqlCapture> {
  const prefix = `${input.target.captureDirectory}/`;
  const captureBytes = await readBoundFile(
    input.graphqlRoot,
    `${prefix}capture.json`,
    input.files,
    "capture manifest",
  );
  const rawCapture = parseJson(captureBytes, "capture manifest");
  const capture = captureManifestSchema.parse(rawCapture);
  if (
    captureBytes.toString("utf8") !==
      `${JSON.stringify(rawCapture, null, 2)}\n`
  ) {
    throw new Error(
      `C6 multilingual expansion noncanonical capture manifest ${
        input.target.requestedAnchorId
      }`,
    );
  }
  const requestBytes = await readReferencedFile({
    expectedPath: "request.json",
    files: input.files,
    graphqlRoot: input.graphqlRoot,
    prefix,
    reference: capture.request.body,
  });
  const responseHeaderBytes = await readReferencedFile({
    expectedPath: "response-headers.json",
    files: input.files,
    graphqlRoot: input.graphqlRoot,
    prefix,
    reference: capture.response.headers,
  });
  const responseBytes = await readReferencedFile({
    expectedPath: "response.json",
    files: input.files,
    graphqlRoot: input.graphqlRoot,
    prefix,
    reference: capture.response.body,
  });
  const rawRequest = parseJson(requestBytes, "GraphQL request");
  const request = requestSchema.parse(rawRequest);
  if (
    requestBytes.toString("utf8") !== JSON.stringify(rawRequest) ||
    request.variables.owner !== input.target.owner ||
    request.variables.name !== input.target.repo ||
    request.variables.number !== input.target.pullNumber ||
    JSON.stringify(capture.request.variables) !==
      JSON.stringify(request.variables)
  ) {
    throw new Error(
      `C6 multilingual expansion request mismatch ${
        input.target.requestedAnchorId
      }`,
    );
  }
  const rawHeaders = parseJson(responseHeaderBytes, "response headers");
  const headers = responseHeaderSchema.parse(rawHeaders);
  if (
    responseHeaderBytes.toString("utf8") !==
      `${JSON.stringify(rawHeaders, null, 2)}\n` ||
    headers["content-type"].split(";", 1)[0]!.trim().toLowerCase() !==
      "application/json"
  ) {
    throw new Error(
      `C6 multilingual expansion response header mismatch ${
        input.target.requestedAnchorId
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
      `C6 multilingual expansion GraphQL errors ${
        input.target.requestedAnchorId
      }`,
    );
  }
  const response = responseSchema.parse(rawResponse);
  const pull = response.data.repository.pullRequest;
  const requestedRepository = normalizeRepository(
    `${input.target.owner}/${input.target.repo}`,
  );
  const canonicalRepository = normalizeRepository(
    response.data.repository.nameWithOwner,
  );
  const redirected = canonicalRepository !== requestedRepository;
  const expectedUrl =
    `https://github.com/${canonicalRepository}/pull/` +
    input.target.pullNumber;
  if (
    pull.number !== input.target.pullNumber ||
    normalizeRepository(pull.baseRepository.nameWithOwner) !==
      canonicalRepository ||
    normalizeRepository(capture.target.repository) !==
      canonicalRepository ||
    capture.target.pullNumber !== input.target.pullNumber ||
    normalizeUrl(pull.url) !== normalizeUrl(expectedUrl) ||
    normalizeUrl(capture.target.url) !== normalizeUrl(expectedUrl) ||
    redirected !== (capture.target.repositoryRedirect !== undefined)
  ) {
    throw new Error(
      `C6 multilingual expansion response identity mismatch ${
        input.target.requestedAnchorId
      }`,
    );
  }
  if (
    redirected &&
    (
      normalizeRepository(
        capture.target.repositoryRedirect!.requestedRepository,
      ) !== requestedRepository ||
      normalizeRepository(
        capture.target.repositoryRedirect!.resolvedRepository,
      ) !== canonicalRepository
    )
  ) {
    throw new Error(
      `C6 multilingual expansion redirect mismatch ${
        input.target.requestedAnchorId
      }`,
    );
  }
  const paginationGaps = collectPaginationGaps(response.data, "data");
  if (
    capture.discovery.discoverySurfaceComplete !==
      (paginationGaps.length === 0) ||
    JSON.stringify(capture.discovery.paginationGaps) !==
      JSON.stringify(paginationGaps)
  ) {
    throw new Error(
      `C6 multilingual expansion pagination mismatch ${
        input.target.requestedAnchorId
      }`,
    );
  }
  return {
    canonicalRepository,
    captureManifestSha256: sha256(captureBytes),
    commits: pull.commits.nodes.filter(isPresent).map((node) => ({
      committedAt: node.commit.committedDate,
      oid: node.commit.oid,
      parents: node.commit.parents.nodes.filter(isPresent).map(
        (parent) => parent.oid,
      ),
    })),
    paginationGaps,
    responseSha256: sha256(responseBytes),
    reviews: pull.reviews.nodes.filter(isPresent).map((review) => ({
      author: review.author?.login ?? null,
      body: review.body,
      commit: review.commit?.oid ?? null,
      id: review.id,
      state: review.state,
      submittedAt: review.submittedAt,
    })),
    reviewThreads: pull.reviewThreads.nodes.filter(isPresent).map(
      (thread) => ({
        comments: thread.comments.nodes.filter(isPresent).map(
          (comment) => ({
            author: comment.author?.login ?? null,
            body: comment.body,
            createdAt: comment.createdAt,
            id: comment.id,
            originalCommit: comment.originalCommit?.oid ?? null,
          }),
        ),
        id: thread.id,
      }),
    ),
  };
}

async function readReferencedFile(input: {
  expectedPath: string;
  files: ReadonlyMap<string, C6AssetLock["files"][number]>;
  graphqlRoot: string;
  prefix: string;
  reference: z.infer<typeof artifactReferenceSchema>;
}): Promise<Buffer> {
  if (input.reference.path !== input.expectedPath) {
    throw new Error(
      `C6 multilingual expansion reference path mismatch ${
        input.reference.path
      }`,
    );
  }
  const bytes = await readBoundFile(
    input.graphqlRoot,
    `${input.prefix}${input.expectedPath}`,
    input.files,
    input.expectedPath,
  );
  if (
    bytes.byteLength !== input.reference.bytes ||
    sha256(bytes) !== input.reference.sha256
  ) {
    throw new Error(
      `C6 multilingual expansion reference mismatch ${
        input.expectedPath
      }`,
    );
  }
  return bytes;
}

async function readBoundFile(
  root: string,
  path: string,
  files: ReadonlyMap<string, C6AssetLock["files"][number]>,
  label: string,
): Promise<Buffer> {
  const reference = files.get(path);
  if (reference === undefined) {
    throw new Error(`C6 multilingual expansion missing ${label} ${path}`);
  }
  const bytes = await readC6StableRegularFile(
    join(root, ...path.split("/")),
    `multilingual expansion ${label}`,
  );
  if (
    bytes.byteLength !== reference.bytes ||
    sha256(bytes) !== reference.sha256
  ) {
    throw new Error(`C6 multilingual expansion changed ${label} ${path}`);
  }
  return bytes;
}

function collectPaginationGaps(
  value: unknown,
  path: string,
): C6ValidatedMultilingualGraphqlCapture["paginationGaps"] {
  const gaps: C6ValidatedMultilingualGraphqlCapture["paginationGaps"] = [];
  visitPagination(value, path, gaps);
  return gaps.sort(compareGaps);
}

function visitPagination(
  value: unknown,
  path: string,
  gaps: C6ValidatedMultilingualGraphqlCapture["paginationGaps"],
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
    const childPath = `${path}.${name}`;
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

function candidateProjection(result: SequenceResult): unknown {
  return {
    agentVisibleRequestSha256: result.agentVisibleRequestSha256,
    canonicalAnchorId: result.canonicalAnchorId,
    captureOrder: result.captureOrder,
    instanceId: result.instanceId,
    rowIndex: result.rowIndex,
    ...(result.sourceSplit === undefined
      ? {}
      : {
        sourceSplit: result.sourceSplit,
        sourceSplitRowIndex: result.sourceSplitRowIndex,
      }),
    sequence: result.sequence,
    sequenceLineageIdentitySha256:
      result.sequenceLineageIdentitySha256,
  };
}

function isBroadPretarget(
  result: C6MultilingualExpansionResult,
): result is SequenceResult & {
  status: "broad-structural-pretarget" | "prior-frame-overlap";
} {
  return result.status === "broad-structural-pretarget" ||
    result.status === "prior-frame-overlap";
}

function assertTargets(
  targets: readonly C6MultilingualExpansionTarget[],
): void {
  const anchors = new Set<string>();
  const directories = new Set<string>();
  for (const [index, target] of targets.entries()) {
    if (
      target.captureOrder !== index + 1 ||
      target.rowIndex !== index ||
      (
        (target.sourceSplit === undefined) !==
          (target.sourceSplitRowIndex === undefined)
      )
    ) {
      throw new Error(
        "C6 multilingual expansion target order must be contiguous",
      );
    }
    const requestedAnchorId = normalizeAnchor(target.requestedAnchorId);
    const expectedAnchor = `${
      normalizeRepository(`${target.owner}/${target.repo}`)
    }#${target.pullNumber}`;
    if (
      requestedAnchorId !== expectedAnchor ||
      anchors.has(requestedAnchorId) ||
      directories.has(target.captureDirectory)
    ) {
      throw new Error(
        "C6 multilingual expansion target identity mismatch",
      );
    }
    anchors.add(requestedAnchorId);
    directories.add(target.captureDirectory);
  }
}

function validateSourceDataset(value: {
  datasetId: string;
  revision: string;
}): {
  datasetId: string;
  revision: string;
} {
  if (
    value.datasetId.length === 0 ||
    value.datasetId.trim() !== value.datasetId ||
    !/^[a-f0-9]{40}$/u.test(value.revision)
  ) {
    throw new Error(
      "C6 multilingual expansion invalid source dataset",
    );
  }
  return value;
}

function normalizeAnchor(value: string): string {
  const match = /^([^/#]+\/[^/#]+)#([1-9]\d*)$/u.exec(
    value.toLowerCase(),
  );
  if (match === null) {
    throw new Error(`C6 multilingual expansion invalid anchor ${value}`);
  }
  return `${normalizeRepository(match[1]!)}#${match[2]}`;
}

function normalizeRepository(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^[^/#\s]+\/[^/#\s]+$/u.test(normalized)) {
    throw new Error(
      `C6 multilingual expansion invalid repository ${value}`,
    );
  }
  return normalized;
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host.toLowerCase()}${
    url.pathname.toLowerCase()
  }`;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(`C6 multilingual expansion invalid ${label} JSON`);
  }
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function compareGaps(
  left: { path: string },
  right: { path: string },
): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
