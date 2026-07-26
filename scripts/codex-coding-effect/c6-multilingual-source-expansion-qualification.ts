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
  C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2,
  projectC6StructuralReviewEvents,
  selectC6MinimumLinearReviewSequence,
  serializeC6StructuralReviewEventPolicy,
} from "./c6-review-event-policy";
import type {
  C6ReviewPolicyCommit,
  C6ReviewPolicyReview,
  C6ReviewPolicyThread,
} from "./c6-review-event-policy";

const ARTIFACT_KIND =
  "c6-multilingual-source-expansion-qualification";
const REPOSITORY_CAP = 4;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const expansionResultSchema = z.object({
  agentVisibleRequestSha256: sha256Schema,
  canonicalAnchorId: z.string().min(1),
  canonicalRepository: z.string().min(3),
  captureDirectory: z.string().min(1),
  captureOrder: z.number().int().positive(),
  instanceId: z.string().min(1),
  requestedAnchorId: z.string().min(1),
  responseSha256: sha256Schema,
  rowIndex: z.number().int().nonnegative(),
  sourceSplit: z.string().min(1).optional(),
  sourceSplitRowIndex: z.number().int().nonnegative().optional(),
  status: z.enum([
    "broad-structural-pretarget",
    "no-broad-structural-sequence",
    "prior-frame-overlap",
    "unsupported-pagination",
  ]),
}).passthrough();
const expansionSchema = z.object({
  artifactKind: z.literal(
    "c6-multilingual-review-trajectory-expansion",
  ),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    machineQualifiedEpisodeCount: z.literal(0),
    pullAuthorQualified: z.literal(false),
  }).passthrough(),
  counts: z.object({
    broadStructuralPretargetCount: z.number().int().positive(),
    freshBroadStructuralPretargetCount: z.number().int().positive(),
    priorFrameOverlapCount: z.number().int().nonnegative(),
    sourceTargetCount: z.number().int().positive(),
  }).passthrough(),
  independenceBoundary: z.object({
    broadPretargetProjectionSha256: sha256Schema,
    machineOutcomeInput: z.literal(false),
    semanticLedgerInput: z.literal(false),
  }).passthrough(),
  inputs: z.object({
    graphqlRootSha256: sha256Schema,
  }).passthrough(),
  policy: z.object({
    policyId: z.literal("prospective-structural-review-v2"),
    schemaVersion: z.literal(2),
    sha256: sha256Schema,
  }).passthrough(),
  results: z.array(expansionResultSchema).min(1),
  schemaVersion: z.literal(1),
  sourceDataset: z.object({
    datasetId: z.string().min(1),
    revision: commitSchema,
  }).strict().optional(),
}).passthrough();
const identityTargetSchema = z.object({
  anchorId: z.string().min(1),
  canonicalAnchorId: z.string().min(1),
  canonicalOwner: z.string().min(1),
  canonicalRepository: z.string().min(1),
  captureDirectory: z.string().min(1),
  originalCaptureOrder: z.number().int().positive(),
  pullNumber: z.number().int().positive(),
  supplementOrder: z.number().int().positive(),
}).strict();
const identityPlanSchema = z.object({
  artifactKind: z.literal("c6-rest-identity-supplement-plan"),
  counts: z.object({
    supplementTargetCount: z.number().int().positive(),
  }).passthrough(),
  independenceBoundary: z.object({
    supplementTargetProjectionSha256: sha256Schema,
  }).passthrough(),
  inputs: z.object({
    expansion: z.object({
      sha256: sha256Schema,
    }).passthrough(),
  }).passthrough(),
  schemaVersion: z.literal(1),
  targets: z.array(identityTargetSchema).min(1),
}).passthrough();
const identityCaptureSchema = z.object({
  anchorId: z.string().min(1),
  canonicalAnchorId: z.string().min(1),
  captureDirectory: z.string().min(1),
  headSha: commitSchema,
  originalCaptureOrder: z.number().int().positive(),
  pullAuthor: z.string().min(1),
  pullNumber: z.number().int().positive(),
  requestSha256: sha256Schema,
  responseBytes: z.number().int().positive(),
  responseSha256: sha256Schema,
  supplementOrder: z.number().int().positive(),
}).strict();
const identityRootSchema = z.object({
  artifactKind: z.literal("c6-rest-identity-supplement-capture-root"),
  boundary: z.object({
    captureAttemptCompletenessProven: z.literal(true),
    platformAuthenticationCryptographicallyProven: z.literal(false),
  }).passthrough(),
  captures: z.array(identityCaptureSchema).min(1),
  counts: z.object({
    capturedTargetCount: z.number().int().positive(),
    plannedTargetCount: z.number().int().positive(),
  }).strict(),
  plan: z.object({
    sha256: sha256Schema,
    targetProjectionSha256: sha256Schema,
  }).passthrough(),
  schemaVersion: z.literal(1),
}).strict();
const identityManifestSchema = z.object({
  artifactKind: z.literal("c6-rest-identity-supplement-capture"),
  boundary: z.object({
    bearerAuthorizationHeaderSent: z.literal(true),
    cryptographicPlatformReceipt: z.literal(false),
    platformAuthenticationCryptographicallyProven: z.literal(false),
  }).strict(),
  capture: identityCaptureSchema,
  request: z.object({
    path: z.literal("request.json"),
    sha256: sha256Schema,
  }).strict(),
  response: z.object({
    bytes: z.number().int().positive(),
    path: z.literal("response.json"),
    sha256: sha256Schema,
    status: z.literal(200),
  }).strict(),
  schemaVersion: z.literal(1),
}).strict();
const identityRequestSchema = z.object({
  headers: z.object({
    accept: z.literal("application/vnd.github+json"),
    apiVersion: z.literal("2022-11-28"),
    authorization: z.literal("Bearer <redacted>"),
    userAgent: z.literal("GoodMemory-C6-REST-Identity-Supplement"),
  }).strict(),
  method: z.literal("GET"),
  url: z.url(),
}).strict();
const pullSchema = z.object({
  base: z.object({
    repo: z.object({
      full_name: z.string().min(3),
    }).passthrough(),
  }).passthrough(),
  head: z.object({ sha: commitSchema }).passthrough(),
  number: z.number().int().positive(),
  user: z.object({ login: z.string().min(1) }).passthrough(),
}).passthrough();
const closedPageInfoSchema = z.object({
  hasNextPage: z.literal(false),
}).passthrough();
const graphqlResponseSchema = z.object({
  data: z.object({
    repository: z.object({
      nameWithOwner: z.string().min(3),
      pullRequest: z.object({
        commits: z.object({
          nodes: z.array(z.object({
            commit: z.object({
              committedDate: z.iso.datetime(),
              oid: commitSchema,
              parents: z.object({
                nodes: z.array(
                  z.object({ oid: commitSchema }).passthrough().nullable(),
                ),
                pageInfo: closedPageInfoSchema,
              }).passthrough(),
            }).passthrough(),
          }).passthrough().nullable()),
          pageInfo: closedPageInfoSchema,
        }).passthrough(),
        headRefOid: commitSchema,
        number: z.number().int().positive(),
        reviews: z.object({
          nodes: z.array(z.object({
            author: z.object({
              login: z.string().min(1),
            }).passthrough().nullable(),
            body: z.string(),
            commit: z.object({
              oid: commitSchema,
            }).passthrough().nullable(),
            id: z.string().min(1),
            state: z.string().min(1),
            submittedAt: z.iso.datetime(),
          }).passthrough().nullable()),
          pageInfo: closedPageInfoSchema,
        }).passthrough(),
        reviewThreads: z.object({
          nodes: z.array(z.object({
            comments: z.object({
              nodes: z.array(z.object({
                author: z.object({
                  login: z.string().min(1),
                }).passthrough().nullable(),
                body: z.string(),
                createdAt: z.iso.datetime(),
                id: z.string().min(1),
                originalCommit: z.object({
                  oid: commitSchema,
                }).passthrough().nullable(),
              }).passthrough().nullable()),
              pageInfo: closedPageInfoSchema,
            }).passthrough(),
            id: z.string().min(1),
          }).passthrough().nullable()),
          pageInfo: closedPageInfoSchema,
        }).passthrough(),
      }).passthrough(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

export interface C6MultilingualQualificationTarget {
  agentVisibleRequestSha256: string;
  canonicalAnchorId: string;
  canonicalRepository: string;
  captureDirectory: string;
  captureOrder: number;
  instanceId: string;
  requestedAnchorId: string;
  rowIndex: number;
  sourceSplit?: string;
  sourceSplitRowIndex?: number;
  status: "broad-structural-pretarget" | "prior-frame-overlap";
}

export interface C6MultilingualIdentityClosure {
  commits: C6ReviewPolicyCommit[];
  identityManifestSha256: string;
  pullAuthor: string;
  reviews: C6ReviewPolicyReview[];
  reviewThreads: C6ReviewPolicyThread[];
}

type ExactSequence = NonNullable<
  ReturnType<typeof selectC6MinimumLinearReviewSequence>
>;

interface CommonResult
  extends Omit<C6MultilingualQualificationTarget, "status"> {
  exactEventCount: number;
  identityManifestSha256: string;
  pullAuthor: string;
}

export type C6MultilingualQualificationResult =
  | CommonResult & {
    exactQualification: "exact-sequence" | "no-exact-sequence";
    exactSequence?: ExactSequence["sequence"];
    exactSequenceLineageIdentitySha256?: string;
    status: "prior-frame-overlap";
  }
  | CommonResult & {
    exactSequence: ExactSequence["sequence"];
    exactSequenceLineageIdentitySha256: string;
    status: "exact-structural-candidate";
  }
  | CommonResult & {
    status: "no-exact-structural-sequence";
  };

export interface C6MultilingualSourceExpansionQualification {
  artifactKind: typeof ARTIFACT_KIND;
  boundary: {
    acceptedEpisodeCount: 0;
    candidateManifestFrozen: false;
    codexRunReady: false;
    machineQualifiedEpisodeCount: 0;
    pullIdentityClosureComplete: true;
    status:
      "multilingual-exact-structural-screening-semantic-review-required";
  };
  counts: {
    exactFreshCandidateCount: number;
    exactFreshRepositoryCount: number;
    identityClosureCount: number;
    noExactFreshSequenceCount: number;
    priorFrameOverlapCount: number;
    repositoryCappedFreshCeiling: number;
    targetCount: number;
  };
  independenceBoundary: {
    candidateOrderChanged: false;
    exactFreshCandidateProjectionSha256: string;
    machineOutcomeInput: false;
    semanticLedgerInput: false;
  };
  inputs: {
    expansionSha256: string;
    graphqlRootSha256: string;
    identityPlanSha256: string;
    identityRootSha256: string;
  };
  policy: {
    definition: typeof C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2;
    policyId: "prospective-structural-review-v2";
    schemaVersion: 2;
    sha256: string;
  };
  results: C6MultilingualQualificationResult[];
  sourceDataset?: {
    datasetId: string;
    revision: string;
  };
  rule: {
    overlap:
      "prior-frame-canonical-overlap-is-never-a-fresh-candidate";
    pullAuthor:
      "case-insensitive-author-events-excluded-before-lineage-search";
    repositoryCap: 4;
    resultOrder: "original-captureOrder-ascending";
  };
  schemaVersion: 1;
}

export function deriveC6MultilingualSourceExpansionQualification(input: {
  expansionSha256: string;
  graphqlRootSha256: string;
  identityPlanSha256: string;
  identityRootSha256: string;
  sourceDataset?: {
    datasetId: string;
    revision: string;
  };
  targets: readonly C6MultilingualQualificationTarget[];
  validatedClosures: ReadonlyMap<
    string,
    C6MultilingualIdentityClosure
  >;
}): C6MultilingualSourceExpansionQualification {
  const expansionSha256 = sha256Schema.parse(input.expansionSha256);
  const graphqlRootSha256 = sha256Schema.parse(
    input.graphqlRootSha256,
  );
  const identityPlanSha256 = sha256Schema.parse(
    input.identityPlanSha256,
  );
  const identityRootSha256 = sha256Schema.parse(
    input.identityRootSha256,
  );
  const targets = [...input.targets].sort(
    (left, right) => left.captureOrder - right.captureOrder,
  );
  assertTargets(targets);
  const knownDirectories = new Set(
    targets.map((target) => target.captureDirectory),
  );
  for (const directory of input.validatedClosures.keys()) {
    if (!knownDirectories.has(directory)) {
      throw new Error(
        `C6 multilingual qualification unexpected identity closure ${
          directory
        }`,
      );
    }
  }
  const results: C6MultilingualQualificationResult[] = targets.map(
    (target) => {
      const closure = input.validatedClosures.get(
        target.captureDirectory,
      );
      if (closure === undefined) {
        throw new Error(
          `C6 multilingual qualification missing identity closure ${
            target.captureDirectory
          }`,
        );
      }
      const events = projectC6StructuralReviewEvents({
        pullAuthor: closure.pullAuthor,
        reviews: closure.reviews,
        reviewThreads: closure.reviewThreads,
      });
      const exact = selectC6MinimumLinearReviewSequence({
        anchorId: normalizeAnchor(target.canonicalAnchorId),
        commits: closure.commits,
        events,
      });
      const common = {
        ...target,
        exactEventCount: events.length,
        identityManifestSha256: sha256Schema.parse(
          closure.identityManifestSha256,
        ),
        pullAuthor: closure.pullAuthor,
      };
      if (target.status === "prior-frame-overlap") {
        return exact === null
          ? {
            ...common,
            exactQualification: "no-exact-sequence" as const,
            status: "prior-frame-overlap" as const,
          }
          : {
            ...common,
            exactQualification: "exact-sequence" as const,
            exactSequence: exact.sequence,
            exactSequenceLineageIdentitySha256:
              exact.lineageIdentitySha256,
            status: "prior-frame-overlap" as const,
          };
      }
      return exact === null
        ? {
          ...common,
          status: "no-exact-structural-sequence" as const,
        }
        : {
          ...common,
          exactSequence: exact.sequence,
          exactSequenceLineageIdentitySha256:
            exact.lineageIdentitySha256,
          status: "exact-structural-candidate" as const,
        };
    },
  );
  const exactFresh = results.filter(
    (result): result is CommonResult & {
      exactSequence: ExactSequence["sequence"];
      exactSequenceLineageIdentitySha256: string;
      status: "exact-structural-candidate";
    } => result.status === "exact-structural-candidate",
  );
  const exactByRepository = new Map<string, number>();
  for (const result of exactFresh) {
    exactByRepository.set(
      result.canonicalRepository,
      (exactByRepository.get(result.canonicalRepository) ?? 0) + 1,
    );
  }
  return {
    artifactKind: ARTIFACT_KIND,
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      machineQualifiedEpisodeCount: 0,
      pullIdentityClosureComplete: true,
      status:
        "multilingual-exact-structural-screening-semantic-review-required",
    },
    counts: {
      exactFreshCandidateCount: exactFresh.length,
      exactFreshRepositoryCount: exactByRepository.size,
      identityClosureCount: input.validatedClosures.size,
      noExactFreshSequenceCount: results.filter(
        (result) => result.status === "no-exact-structural-sequence",
      ).length,
      priorFrameOverlapCount: results.filter(
        (result) => result.status === "prior-frame-overlap",
      ).length,
      repositoryCappedFreshCeiling: [...exactByRepository.values()]
        .reduce(
          (sum, count) => sum + Math.min(REPOSITORY_CAP, count),
          0,
        ),
      targetCount: targets.length,
    },
    independenceBoundary: {
      candidateOrderChanged: false,
      exactFreshCandidateProjectionSha256: sha256(
        JSON.stringify(exactFresh.map(candidateProjection)),
      ),
      machineOutcomeInput: false,
      semanticLedgerInput: false,
    },
    inputs: {
      expansionSha256,
      graphqlRootSha256,
      identityPlanSha256,
      identityRootSha256,
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
      overlap:
        "prior-frame-canonical-overlap-is-never-a-fresh-candidate",
      pullAuthor:
        "case-insensitive-author-events-excluded-before-lineage-search",
      repositoryCap: REPOSITORY_CAP,
      resultOrder: "original-captureOrder-ascending",
    },
    schemaVersion: 1,
  };
}

export function serializeC6MultilingualSourceExpansionQualification(
  qualification: C6MultilingualSourceExpansionQualification,
): string {
  return `${JSON.stringify(qualification, null, 2)}\n`;
}

export async function buildC6MultilingualSourceExpansionQualification(
  input: {
    expectedExpansionSha256: string;
    expectedGraphqlRootSha256: string;
    expectedIdentityPlanSha256: string;
    expectedIdentityRootSha256: string;
    expansionPath: string;
    graphqlRoot: string;
    identityPlanPath: string;
    identityRoot: string;
    testHooks?: {
      beforeTerminalVerification?: () => Promise<void> | void;
    };
  },
): Promise<{
  outputSha256: string;
  qualification: C6MultilingualSourceExpansionQualification;
}> {
  const expected = {
    expansion: sha256Schema.parse(input.expectedExpansionSha256),
    graphqlRoot: sha256Schema.parse(input.expectedGraphqlRootSha256),
    identityPlan: sha256Schema.parse(input.expectedIdentityPlanSha256),
    identityRoot: sha256Schema.parse(input.expectedIdentityRootSha256),
  };
  const [
    expansionPath,
    graphqlRoot,
    identityPlanPath,
    identityRoot,
  ] = await Promise.all([
    assertC6NoSymlinkPathComponents(
      input.expansionPath,
      "C6 multilingual qualification expansion",
    ),
    assertC6NoSymlinkPathComponents(
      input.graphqlRoot,
      "C6 multilingual qualification GraphQL root",
    ),
    assertC6NoSymlinkPathComponents(
      input.identityPlanPath,
      "C6 multilingual qualification identity plan",
    ),
    assertC6NoSymlinkPathComponents(
      input.identityRoot,
      "C6 multilingual qualification identity root",
    ),
  ]);
  const [
    expansionBytes,
    identityPlanBytes,
    graphqlLock,
    identityLock,
  ] = await Promise.all([
    readC6StableRegularFile(
      expansionPath,
      "multilingual qualification expansion",
    ),
    readC6StableRegularFile(
      identityPlanPath,
      "multilingual qualification identity plan",
    ),
    buildC6AssetLock(graphqlRoot),
    buildC6AssetLock(identityRoot),
  ]);
  if (
    sha256(expansionBytes) !== expected.expansion ||
    sha256(identityPlanBytes) !== expected.identityPlan ||
    graphqlLock.assetRootSha256 !== expected.graphqlRoot ||
    identityLock.assetRootSha256 !== expected.identityRoot
  ) {
    throw new Error(
      "C6 multilingual qualification input hash mismatch",
    );
  }
  const rawExpansion = parseJson(expansionBytes, "expansion");
  const expansion = expansionSchema.parse(rawExpansion);
  if (
    expansion.inputs.graphqlRootSha256 !== expected.graphqlRoot ||
    expansion.policy.sha256 !==
      sha256(serializeC6StructuralReviewEventPolicy()) ||
    expansion.results.length !== expansion.counts.sourceTargetCount
  ) {
    throw new Error(
      "C6 multilingual qualification expansion binding mismatch",
    );
  }
  const selectedResults = expansion.results
    .filter((result): result is z.infer<typeof expansionResultSchema> & {
      status: "broad-structural-pretarget" | "prior-frame-overlap";
    } =>
      result.status === "broad-structural-pretarget" ||
      result.status === "prior-frame-overlap"
    )
    .sort((left, right) => left.captureOrder - right.captureOrder);
  if (
    selectedResults.length !==
      expansion.counts.broadStructuralPretargetCount ||
    selectedResults.filter(
      (result) => result.status === "broad-structural-pretarget",
    ).length !== expansion.counts.freshBroadStructuralPretargetCount ||
    selectedResults.filter(
      (result) => result.status === "prior-frame-overlap",
    ).length !== expansion.counts.priorFrameOverlapCount
  ) {
    throw new Error(
      "C6 multilingual qualification expansion count mismatch",
    );
  }
  const rawIdentityPlan = parseJson(
    identityPlanBytes,
    "identity plan",
  );
  const identityPlan = identityPlanSchema.parse(rawIdentityPlan);
  if (
    identityPlan.inputs.expansion.sha256 !== expected.expansion ||
    identityPlan.targets.length !==
      identityPlan.counts.supplementTargetCount ||
    identityPlan.targets.length !== selectedResults.length ||
    sha256(JSON.stringify(
      (rawIdentityPlan as { targets: unknown }).targets,
    )) !==
      identityPlan.independenceBoundary.supplementTargetProjectionSha256
  ) {
    throw new Error(
      "C6 multilingual qualification identity plan mismatch",
    );
  }
  assertIdentityPlanTargets(identityPlan.targets, selectedResults);
  assertIdentityRootStructure(identityLock, identityPlan.targets);
  const identityFiles = new Map(
    identityLock.files.map((file) => [file.path, file]),
  );
  const graphqlFiles = new Map(
    graphqlLock.files.map((file) => [file.path, file]),
  );
  const rootCaptureBytes = await readBoundFile(
    identityRoot,
    "capture.json",
    identityFiles,
    "identity root manifest",
  );
  const rawRootCapture = parseJson(
    rootCaptureBytes,
    "identity root manifest",
  );
  const rootCapture = identityRootSchema.parse(rawRootCapture);
  if (
    rootCaptureBytes.toString("utf8") !==
      `${JSON.stringify(rawRootCapture, null, 2)}\n` ||
    rootCapture.counts.capturedTargetCount !==
      identityPlan.targets.length ||
    rootCapture.counts.plannedTargetCount !==
      identityPlan.targets.length ||
    rootCapture.captures.length !== identityPlan.targets.length ||
    rootCapture.plan.sha256 !== expected.identityPlan ||
    rootCapture.plan.targetProjectionSha256 !==
      identityPlan.independenceBoundary.supplementTargetProjectionSha256
  ) {
    throw new Error(
      "C6 multilingual qualification identity root mismatch",
    );
  }
  const rootCaptures = [...rootCapture.captures].sort(
    (left, right) => left.supplementOrder - right.supplementOrder,
  );
  const validatedClosures = new Map<
    string,
    C6MultilingualIdentityClosure
  >();
  for (const [index, target] of identityPlan.targets.entries()) {
    validatedClosures.set(
      target.captureDirectory,
      await validateIdentityClosure({
        expansionResult: selectedResults[index]!,
        graphqlFiles,
        graphqlRoot,
        identityFiles,
        identityRoot,
        rootCapture: rootCaptures[index]!,
        target,
      }),
    );
  }
  const qualification =
    deriveC6MultilingualSourceExpansionQualification({
      expansionSha256: expected.expansion,
      graphqlRootSha256: expected.graphqlRoot,
      identityPlanSha256: expected.identityPlan,
      identityRootSha256: expected.identityRoot,
      ...(expansion.sourceDataset === undefined
        ? {}
        : {
          sourceDataset: expansion.sourceDataset,
        }),
      targets: selectedResults.map((result) => ({
        agentVisibleRequestSha256:
          result.agentVisibleRequestSha256,
        canonicalAnchorId: result.canonicalAnchorId,
        canonicalRepository: result.canonicalRepository,
        captureDirectory: result.captureDirectory,
        captureOrder: result.captureOrder,
        instanceId: result.instanceId,
        requestedAnchorId: result.requestedAnchorId,
        rowIndex: result.rowIndex,
        ...(result.sourceSplit === undefined
          ? {}
          : {
            sourceSplit: result.sourceSplit,
            sourceSplitRowIndex: result.sourceSplitRowIndex,
          }),
        status: result.status,
      })),
      validatedClosures,
    });

  await input.testHooks?.beforeTerminalVerification?.();
  const [
    terminalExpansionBytes,
    terminalPlanBytes,
    terminalGraphqlLock,
    terminalIdentityLock,
  ] = await Promise.all([
    readC6StableRegularFile(
      expansionPath,
      "multilingual qualification terminal expansion",
    ),
    readC6StableRegularFile(
      identityPlanPath,
      "multilingual qualification terminal identity plan",
    ),
    buildC6AssetLock(graphqlRoot),
    buildC6AssetLock(identityRoot),
  ]);
  if (
    !terminalExpansionBytes.equals(expansionBytes) ||
    !terminalPlanBytes.equals(identityPlanBytes) ||
    serializeC6AssetLock(terminalGraphqlLock) !==
      serializeC6AssetLock(graphqlLock) ||
    serializeC6AssetLock(terminalIdentityLock) !==
      serializeC6AssetLock(identityLock)
  ) {
    throw new Error(
      "C6 multilingual qualification input closure changed during projection",
    );
  }
  const serialized =
    serializeC6MultilingualSourceExpansionQualification(
      qualification,
    );
  return {
    outputSha256: sha256(serialized),
    qualification,
  };
}

export async function materializeC6MultilingualSourceExpansionQualification(
  input: {
    expectedExpansionSha256: string;
    expectedGraphqlRootSha256: string;
    expectedIdentityPlanSha256: string;
    expectedIdentityRootSha256: string;
    expansionPath: string;
    graphqlRoot: string;
    identityPlanPath: string;
    identityRoot: string;
    outputPath: string;
  },
): Promise<{
  outputSha256: string;
  qualification: C6MultilingualSourceExpansionQualification;
}> {
  const result =
    await buildC6MultilingualSourceExpansionQualification(input);
  const outputPath = resolve(input.outputPath);
  await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 multilingual qualification output parent",
  );
  const handle = await open(outputPath, "wx", 0o644);
  try {
    await handle.writeFile(
      serializeC6MultilingualSourceExpansionQualification(
        result.qualification,
      ),
      "utf8",
    );
  } finally {
    await handle.close();
  }
  return result;
}

export async function replayC6MultilingualSourceExpansionQualification(
  input: {
    expectedExpansionSha256: string;
    expectedGraphqlRootSha256: string;
    expectedIdentityPlanSha256: string;
    expectedIdentityRootSha256: string;
    expectedProjectionSha256: string;
    expansionPath: string;
    graphqlRoot: string;
    identityPlanPath: string;
    identityRoot: string;
    projectionPath: string;
  },
): Promise<{
  projectionSha256: string;
  qualification: C6MultilingualSourceExpansionQualification;
  reproduced: true;
}> {
  const expectedProjectionSha256 = sha256Schema.parse(
    input.expectedProjectionSha256,
  );
  const projectionPath = await assertC6NoSymlinkPathComponents(
    input.projectionPath,
    "C6 multilingual qualification projection",
  );
  const projectionBytes = await readC6StableRegularFile(
    projectionPath,
    "multilingual qualification projection",
  );
  if (sha256(projectionBytes) !== expectedProjectionSha256) {
    throw new Error(
      "C6 multilingual qualification projection hash mismatch",
    );
  }
  const result =
    await buildC6MultilingualSourceExpansionQualification(input);
  const reproducedBytes = Buffer.from(
    serializeC6MultilingualSourceExpansionQualification(
      result.qualification,
    ),
  );
  if (!projectionBytes.equals(reproducedBytes)) {
    throw new Error(
      "C6 multilingual qualification projection does not match recomputation",
    );
  }
  const terminalProjectionBytes = await readC6StableRegularFile(
    projectionPath,
    "multilingual qualification terminal projection",
  );
  if (!terminalProjectionBytes.equals(projectionBytes)) {
    throw new Error(
      "C6 multilingual qualification projection changed during replay",
    );
  }
  return {
    projectionSha256: result.outputSha256,
    qualification: result.qualification,
    reproduced: true,
  };
}

function assertIdentityPlanTargets(
  targets: readonly z.infer<typeof identityTargetSchema>[],
  results: readonly z.infer<typeof expansionResultSchema>[],
): void {
  for (const [index, target] of targets.entries()) {
    const result = results[index]!;
    const canonical = parseAnchor(target.canonicalAnchorId);
    if (
      target.supplementOrder !== index + 1 ||
      target.originalCaptureOrder !== result.captureOrder ||
      target.captureDirectory !== result.captureDirectory ||
      normalizeAnchor(target.anchorId) !==
        normalizeAnchor(result.requestedAnchorId) ||
      normalizeAnchor(target.canonicalAnchorId) !==
        normalizeAnchor(result.canonicalAnchorId) ||
      `${target.canonicalOwner}/${target.canonicalRepository}`
          .toLowerCase() !== canonical.repository ||
      target.pullNumber !== canonical.pullNumber
    ) {
      throw new Error(
        "C6 multilingual qualification identity target mismatch",
      );
    }
  }
}

function assertIdentityRootStructure(
  lock: C6AssetLock,
  targets: readonly z.infer<typeof identityTargetSchema>[],
): void {
  const expected = new Set(["capture.json"]);
  for (const target of targets) {
    for (const name of ["manifest.json", "request.json", "response.json"]) {
      expected.add(`${target.captureDirectory}/${name}`);
    }
  }
  for (const file of lock.files) {
    if (!expected.delete(file.path)) {
      throw new Error(
        `C6 multilingual qualification unexpected identity file ${
          file.path
        }`,
      );
    }
  }
  if (expected.size > 0) {
    throw new Error(
      `C6 multilingual qualification missing identity file ${
        [...expected].sort()[0]
      }`,
    );
  }
}

async function validateIdentityClosure(input: {
  expansionResult: z.infer<typeof expansionResultSchema>;
  graphqlFiles: ReadonlyMap<string, C6AssetLock["files"][number]>;
  graphqlRoot: string;
  identityFiles: ReadonlyMap<string, C6AssetLock["files"][number]>;
  identityRoot: string;
  rootCapture: z.infer<typeof identityCaptureSchema>;
  target: z.infer<typeof identityTargetSchema>;
}): Promise<C6MultilingualIdentityClosure> {
  const prefix = `${input.target.captureDirectory}/`;
  const manifestBytes = await readBoundFile(
    input.identityRoot,
    `${prefix}manifest.json`,
    input.identityFiles,
    "identity manifest",
  );
  const rawManifest = parseJson(manifestBytes, "identity manifest");
  const manifest = identityManifestSchema.parse(rawManifest);
  if (
    manifestBytes.toString("utf8") !==
      `${JSON.stringify(rawManifest, null, 2)}\n` ||
    JSON.stringify(manifest.capture) !==
      JSON.stringify(input.rootCapture) ||
    manifest.capture.captureDirectory !== input.target.captureDirectory ||
    manifest.capture.supplementOrder !== input.target.supplementOrder ||
    manifest.capture.originalCaptureOrder !==
      input.target.originalCaptureOrder ||
    normalizeAnchor(manifest.capture.canonicalAnchorId) !==
      normalizeAnchor(input.target.canonicalAnchorId) ||
    normalizeAnchor(manifest.capture.anchorId) !==
      normalizeAnchor(input.target.anchorId) ||
    manifest.capture.pullNumber !== input.target.pullNumber
  ) {
    throw new Error(
      `C6 multilingual qualification identity manifest mismatch ${
        input.target.canonicalAnchorId
      }`,
    );
  }
  const requestBytes = await readBoundFile(
    input.identityRoot,
    `${prefix}request.json`,
    input.identityFiles,
    "identity request",
  );
  const responseBytes = await readBoundFile(
    input.identityRoot,
    `${prefix}response.json`,
    input.identityFiles,
    "identity response",
  );
  if (
    sha256(requestBytes) !== manifest.request.sha256 ||
    sha256(responseBytes) !== manifest.response.sha256 ||
    responseBytes.byteLength !== manifest.response.bytes ||
    sha256(requestBytes) !== manifest.capture.requestSha256 ||
    sha256(responseBytes) !== manifest.capture.responseSha256 ||
    responseBytes.byteLength !== manifest.capture.responseBytes
  ) {
    throw new Error(
      `C6 multilingual qualification identity reference mismatch ${
        input.target.canonicalAnchorId
      }`,
    );
  }
  const rawRequest = parseJson(requestBytes, "identity request");
  const request = identityRequestSchema.parse(rawRequest);
  const canonical = parseAnchor(input.target.canonicalAnchorId);
  const expectedUrl =
    `https://api.github.com/repos/${canonical.repository}/pulls/` +
    canonical.pullNumber;
  if (
    requestBytes.toString("utf8") !==
      `${JSON.stringify(rawRequest, null, 2)}\n` ||
    normalizeUrl(request.url) !== normalizeUrl(expectedUrl)
  ) {
    throw new Error(
      `C6 multilingual qualification identity request mismatch ${
        input.target.canonicalAnchorId
      }`,
    );
  }
  const pull = pullSchema.parse(
    parseJson(responseBytes, "identity response"),
  );
  if (
    normalizeRepository(pull.base.repo.full_name) !==
      canonical.repository ||
    pull.number !== canonical.pullNumber ||
    pull.user.login !== manifest.capture.pullAuthor ||
    pull.head.sha !== manifest.capture.headSha
  ) {
    throw new Error(
      `C6 multilingual qualification pull identity mismatch ${
        input.target.canonicalAnchorId
      }`,
    );
  }
  const graphqlPath =
    `${input.target.captureDirectory}/response.json`;
  const graphqlBytes = await readBoundFile(
    input.graphqlRoot,
    graphqlPath,
    input.graphqlFiles,
    "GraphQL response",
  );
  if (sha256(graphqlBytes) !== input.expansionResult.responseSha256) {
    throw new Error(
      `C6 multilingual qualification GraphQL response mismatch ${
        input.target.canonicalAnchorId
      }`,
    );
  }
  const graphql = graphqlResponseSchema.parse(
    parseJson(graphqlBytes, "GraphQL response"),
  );
  const graphqlPull = graphql.data.repository.pullRequest;
  if (
    normalizeRepository(graphql.data.repository.nameWithOwner) !==
      canonical.repository ||
    graphqlPull.number !== canonical.pullNumber ||
    graphqlPull.headRefOid !== pull.head.sha
  ) {
    throw new Error(
      `C6 multilingual qualification GraphQL identity mismatch ${
        input.target.canonicalAnchorId
      }`,
    );
  }
  return {
    commits: graphqlPull.commits.nodes.filter(isPresent).map((node) => ({
      committedAt: node.commit.committedDate,
      oid: node.commit.oid,
      parents: node.commit.parents.nodes.filter(isPresent).map(
        (parent) => parent.oid,
      ),
    })),
    identityManifestSha256: sha256(manifestBytes),
    pullAuthor: pull.user.login,
    reviews: graphqlPull.reviews.nodes.filter(isPresent).map((review) => ({
      author: review.author?.login ?? null,
      body: review.body,
      commit: review.commit?.oid ?? null,
      id: review.id,
      state: review.state,
      submittedAt: review.submittedAt,
    })),
    reviewThreads: graphqlPull.reviewThreads.nodes.filter(isPresent).map(
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

async function readBoundFile(
  root: string,
  path: string,
  files: ReadonlyMap<string, C6AssetLock["files"][number]>,
  label: string,
): Promise<Buffer> {
  const reference = files.get(path);
  if (reference === undefined) {
    throw new Error(
      `C6 multilingual qualification missing ${label} ${path}`,
    );
  }
  const bytes = await readC6StableRegularFile(
    join(root, ...path.split("/")),
    `multilingual qualification ${label}`,
  );
  if (
    bytes.byteLength !== reference.bytes ||
    sha256(bytes) !== reference.sha256
  ) {
    throw new Error(
      `C6 multilingual qualification changed ${label} ${path}`,
    );
  }
  return bytes;
}

function candidateProjection(
  result: CommonResult & {
    exactSequence: ExactSequence["sequence"];
    exactSequenceLineageIdentitySha256: string;
  },
): unknown {
  return {
    agentVisibleRequestSha256: result.agentVisibleRequestSha256,
    canonicalAnchorId: result.canonicalAnchorId,
    captureOrder: result.captureOrder,
    exactSequence: result.exactSequence,
    exactSequenceLineageIdentitySha256:
      result.exactSequenceLineageIdentitySha256,
    instanceId: result.instanceId,
    rowIndex: result.rowIndex,
    ...(result.sourceSplit === undefined
      ? {}
      : {
        sourceSplit: result.sourceSplit,
        sourceSplitRowIndex: result.sourceSplitRowIndex,
      }),
  };
}

function assertTargets(
  targets: readonly C6MultilingualQualificationTarget[],
): void {
  let priorOrder = 0;
  const anchors = new Set<string>();
  const directories = new Set<string>();
  for (const target of targets) {
    const canonicalAnchorId = normalizeAnchor(target.canonicalAnchorId);
    const repository = canonicalAnchorId.slice(
      0,
      canonicalAnchorId.lastIndexOf("#"),
    );
    if (
      target.captureOrder <= priorOrder ||
      target.rowIndex !== target.captureOrder - 1 ||
      (
        (target.sourceSplit === undefined) !==
          (target.sourceSplitRowIndex === undefined)
      ) ||
      normalizeRepository(target.canonicalRepository) !== repository ||
      anchors.has(canonicalAnchorId) ||
      directories.has(target.captureDirectory)
    ) {
      throw new Error(
        "C6 multilingual qualification target identity mismatch",
      );
    }
    priorOrder = target.captureOrder;
    anchors.add(canonicalAnchorId);
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
      "C6 multilingual qualification invalid source dataset",
    );
  }
  return value;
}

function normalizeAnchor(value: string): string {
  const match = /^([^/#\s]+\/[^/#\s]+)#([1-9]\d*)$/u.exec(
    value.toLowerCase(),
  );
  if (match === null) {
    throw new Error(
      `C6 multilingual qualification invalid anchor ${value}`,
    );
  }
  return `${normalizeRepository(match[1]!)}#${match[2]}`;
}

function parseAnchor(value: string): {
  pullNumber: number;
  repository: string;
} {
  const anchor = normalizeAnchor(value);
  const separator = anchor.lastIndexOf("#");
  return {
    pullNumber: Number(anchor.slice(separator + 1)),
    repository: anchor.slice(0, separator),
  };
}

function normalizeRepository(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^[^/#\s]+\/[^/#\s]+$/u.test(normalized)) {
    throw new Error(
      `C6 multilingual qualification invalid repository ${value}`,
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
    throw new Error(
      `C6 multilingual qualification invalid ${label} JSON`,
    );
  }
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
