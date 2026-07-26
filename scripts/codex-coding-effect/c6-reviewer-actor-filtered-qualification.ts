import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
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
import {
  classifyC6ReviewerActor,
  C6_REVIEWER_ACTOR_POLICY_V1,
  serializeC6ReviewerActorPolicy,
} from "./c6-reviewer-actor-policy";
import type {
  C6ReviewerActorReason,
} from "./c6-reviewer-actor-policy";
import {
  parseC6ReviewerActorIdentityCapturePlan,
} from "./c6-reviewer-actor-identity-capture";
import type {
  C6ReviewerActorIdentityCapturePlan,
} from "./c6-reviewer-actor-identity-capture";

const ARTIFACT_KIND =
  "c6-reviewer-actor-filtered-source-expansion-qualification";
const LINEAGE_DOMAIN_SEPARATOR =
  "goodmemory:c6:reviewer-actor-filtered-lineage:v1";
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const baseResultSchema = z.object({
  agentVisibleRequestSha256: sha256Schema,
  canonicalAnchorId: z.string().min(1),
  canonicalRepository: z.string().min(3),
  captureDirectory: z.string().min(1),
  captureOrder: z.number().int().positive(),
  instanceId: z.string().min(1),
  pullAuthor: z.string().min(1),
  requestedAnchorId: z.string().min(1),
  rowIndex: z.number().int().nonnegative(),
  sourceSplit: z.string().min(1).optional(),
  sourceSplitRowIndex: z.number().int().nonnegative().optional(),
  status: z.enum([
    "exact-structural-candidate",
    "no-exact-structural-sequence",
    "prior-frame-overlap",
  ]),
}).passthrough();
const baseQualificationSchema = z.object({
  artifactKind: z.literal(
    "c6-multilingual-source-expansion-qualification",
  ),
  counts: z.object({
    targetCount: z.number().int().positive(),
  }).passthrough(),
  inputs: z.object({
    graphqlRootSha256: sha256Schema,
  }).passthrough(),
  results: z.array(baseResultSchema).min(1),
  schemaVersion: z.literal(1),
  sourceDataset: z.object({
    datasetId: z.string().min(1),
    revision: commitSchema,
  }).strict().optional(),
}).passthrough();
const actorTargetSchema = z.object({
  captureDirectory: z.string().min(1),
  captureOrder: z.number().int().positive(),
  login: z.string().min(1),
}).strict();
const actorArtifactReferenceSchema = z.object({
  bytes: z.number().int().positive(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const actorCaptureSchema = z.object({
  captureDirectory: z.string().min(1),
  captureOrder: z.number().int().positive(),
  eligible: z.boolean(),
  finalAttempt: z.number().int().positive(),
  login: z.string().min(1),
  networkAttemptCount: z.number().int().positive(),
  platformType: z.string().min(1).nullable(),
  reason: z.enum([
    "eligible-platform-user",
    "known-automation-login",
    "platform-actor-not-user",
    "platform-actor-unresolved",
  ]),
  responseLogin: z.string().min(1).nullable(),
  status: z.union([z.literal(200), z.literal(404)]),
}).strict();
const actorAttemptResponseSchema =
  actorArtifactReferenceSchema.extend({
    httpStatus: z.number().int().min(100).max(599),
    redirected: z.literal(false),
    responseUrl: z.url(),
  }).strict();
const actorAttemptSchema = z.object({
  attempt: z.number().int().positive(),
  request: actorArtifactReferenceSchema,
  response: actorAttemptResponseSchema.optional(),
  responseHeaders: actorArtifactReferenceSchema,
  retryAfterMilliseconds: z.number().int().min(0).max(60_000)
    .optional(),
  transportError: actorArtifactReferenceSchema.extend({
    phase: z.enum(["body-read", "fetch", "timeout"]),
  }).strict().optional(),
}).strict();
const actorRootSchema = z.object({
  artifactKind: z.literal(
    "c6-reviewer-actor-identity-capture-root",
  ),
  boundary: z.object({
    captureAttemptCompletenessProven: z.literal(true),
    cryptographicPlatformReceipt: z.literal(false),
    eventTimeActorTypeProven: z.literal(false),
    humanReviewerIdentityProven: z.literal(false),
    transportAttemptCompletenessProven: z.literal(true),
  }).strict(),
  captures: z.array(actorCaptureSchema).min(1),
  counts: z.object({
    capturedTargetCount: z.number().int().positive(),
    eligibleActorCount: z.number().int().nonnegative(),
    ineligibleActorCount: z.number().int().nonnegative(),
    networkAttemptCount: z.number().int().positive(),
    plannedTargetCount: z.number().int().positive(),
    resolvedActorCount: z.number().int().nonnegative(),
    retryCount: z.number().int().nonnegative(),
    unresolvedActorCount: z.number().int().nonnegative(),
  }).strict(),
  plan: z.object({
    bytes: z.number().int().positive(),
    path: z.string().min(1),
    sha256: sha256Schema,
    targetProjectionSha256: sha256Schema,
  }).strict(),
  policy: z.object({
    policyId: z.literal("reviewer-platform-actor-eligibility-v1"),
    sha256: sha256Schema,
  }).strict(),
  schemaVersion: z.literal(2),
}).strict();
const actorManifestSchema = z.object({
  artifactKind: z.literal(
    "c6-reviewer-actor-identity-capture",
  ),
  attempts: z.array(actorAttemptSchema).min(1).max(4),
  boundary: z.object({
    cryptographicPlatformReceipt: z.literal(false),
    eventTimeActorTypeProven: z.literal(false),
    humanReviewerIdentityProven: z.literal(false),
    transportAttemptCompletenessProven: z.literal(true),
  }).strict(),
  capture: actorCaptureSchema,
  policy: z.object({
    policyId: z.literal("reviewer-platform-actor-eligibility-v1"),
    sha256: sha256Schema,
  }).strict(),
  schemaVersion: z.literal(2),
}).strict();
const actorRequestSchema = z.object({
  attempt: z.number().int().positive(),
  headers: z.object({
    accept: z.literal("application/vnd.github+json"),
    apiVersion: z.literal("2022-11-28"),
    authorization: z.literal("Bearer <redacted>"),
    userAgent: z.literal("GoodMemory-C6-Reviewer-Actor-Identity"),
  }).strict(),
  method: z.literal("GET"),
  requestTimeoutMilliseconds:
    z.number().int().positive().max(300_000),
  url: z.url(),
}).strict();
const actorResponseHeadersSchema = z.object({
  "content-type": z.string().min(1).optional(),
  date: z.string().min(1).optional(),
  etag: z.string().min(1).optional(),
  "retry-after": z.string().min(1).optional(),
  "x-github-request-id": z.string().min(1).optional(),
  "x-ratelimit-limit": z.string().min(1).optional(),
  "x-ratelimit-remaining": z.string().min(1).optional(),
  "x-ratelimit-reset": z.string().min(1).optional(),
  "x-ratelimit-resource": z.string().min(1).optional(),
  "x-ratelimit-used": z.string().min(1).optional(),
}).strict();
const actorTransportErrorSchema = z.object({
  artifactKind: z.literal(
    "c6-reviewer-actor-identity-transport-error",
  ),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  message: z.string(),
  phase: z.enum(["body-read", "fetch", "timeout"]),
  retryScheduled: z.boolean(),
  schemaVersion: z.literal(1),
  transientTransportCode: z.enum([
    "EAI_AGAIN",
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETDOWN",
    "ENETRESET",
    "ENETUNREACH",
    "ENOTFOUND",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_SOCKET",
  ]).nullable(),
  transientTransportFailure: z.boolean(),
}).strict();
const actorResponseSchema = z.object({
  login: z.string().min(1),
  type: z.string().min(1),
}).passthrough();
const actorNotFoundSchema = z.object({
  documentation_url: z.url().optional(),
  message: z.string().min(1),
  status: z.union([z.string(), z.number()]).optional(),
}).strict();
const pageInfoSchema = z.object({
  hasNextPage: z.literal(false),
}).passthrough();
const graphqlSchema = z.object({
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
                pageInfo: pageInfoSchema,
              }).passthrough(),
            }).passthrough(),
          }).passthrough().nullable()),
          pageInfo: pageInfoSchema,
        }).passthrough(),
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
          pageInfo: pageInfoSchema,
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
              pageInfo: pageInfoSchema,
            }).passthrough(),
            id: z.string().min(1),
          }).passthrough().nullable()),
          pageInfo: pageInfoSchema,
        }).passthrough(),
      }).passthrough(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

export interface C6ReviewerActorQualificationTarget {
  agentVisibleRequestSha256?: string;
  canonicalAnchorId: string;
  canonicalRepository: string;
  captureDirectory: string;
  captureOrder: number;
  instanceId?: string;
  pullAuthor: string;
  requestedAnchorId: string;
  rowIndex?: number;
  source?: {
    path: string;
    rowIndex: number;
    rowSha256: string;
  };
  sourceSplit?: string;
  sourceSplitRowIndex?: number;
  status:
    | "exact-structural-candidate"
    | "no-exact-structural-sequence"
    | "prior-frame-overlap";
}

export interface C6ReviewerActorQualificationClosure {
  commits: C6ReviewPolicyCommit[];
  reviews: C6ReviewPolicyReview[];
  reviewThreads: C6ReviewPolicyThread[];
}

export interface C6ReviewerActorReceipt {
  captureManifestSha256: string;
  eligible: boolean;
  reason: C6ReviewerActorReason;
}

type Exact = NonNullable<
  ReturnType<typeof selectC6MinimumLinearReviewSequence>
>;

interface CommonResult
  extends Omit<C6ReviewerActorQualificationTarget, "status"> {
  actorIneligibleEventCount: number;
  actorQualifiedEventCount: number;
}

export type C6ReviewerActorFilteredQualificationResult =
  | CommonResult & {
    actorFilteredQualification:
      | "exact-sequence"
      | "no-exact-sequence";
    exactSequence?: Exact["sequence"];
    exactSequenceLineageIdentitySha256?: string;
    status: "prior-frame-overlap";
  }
  | CommonResult & {
    baseSequenceLineageIdentitySha256: string;
    exactSequence: Exact["sequence"];
    exactSequenceLineageIdentitySha256: string;
    firstReviewActorManifestSha256: string;
    secondReviewActorManifestSha256: string;
    status: "actor-filtered-exact-structural-candidate";
  }
  | CommonResult & {
    status: "no-actor-filtered-exact-structural-sequence";
  };

export interface C6ReviewerActorFilteredQualification {
  artifactKind: typeof ARTIFACT_KIND;
  boundary: {
    acceptedEpisodeCount: 0;
    automationExclusionComplete: false;
    candidateManifestFrozen: false;
    codexRunReady: false;
    eventTimeActorTypeProven: false;
    humanReviewerIdentityProven: false;
    machineQualifiedEpisodeCount: 0;
    status:
      "actor-filtered-exact-structural-screening-semantic-review-required";
  };
  counts: {
    actorFilteredExactFreshCandidateCount: number;
    actorFilteredNoExactFreshSequenceCount: number;
    actorIneligibleEventCount: number;
    actorPlanTargetCount: number;
    actorQualifiedEventCount: number;
    priorFrameOverlapCount: number;
    targetCount: number;
  };
  independenceBoundary: {
    candidateOrderChanged: false;
    exactFreshCandidateProjectionSha256: string;
    goldInput: false;
    machineOutcomeInput: false;
    semanticLedgerInput: false;
  };
  inputs: {
    actorPlanSha256: string;
    actorRootSha256: string;
    baseQualificationSha256: string;
    graphqlRootSha256: string;
    pullAuthorRoots?: {
      originalRestRootSha256: string;
      supplementRootSha256: string;
    };
  };
  policies: {
    actor: {
      definition: typeof C6_REVIEWER_ACTOR_POLICY_V1;
      sha256: string;
    };
    structuralReview: {
      definition: typeof C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2;
      sha256: string;
    };
  };
  results: C6ReviewerActorFilteredQualificationResult[];
  rule: {
    actorFilter:
      "captured-platform-user-and-frozen-automation-login-rule";
    exactSelection:
      "reselect-v2-minimum-lineage-from-full-raw-event-set-after-actor-filter";
    resultOrder: "base-qualification-captureOrder";
  };
  schemaVersion: 1;
  sourceDataset?: {
    datasetId: string;
    revision: string;
  };
}

export function deriveC6ReviewerActorFilteredQualification(input: {
  actorPlanSha256: string;
  actorRootSha256: string;
  actors: ReadonlyMap<string, C6ReviewerActorReceipt>;
  baseQualificationSha256: string;
  closures: ReadonlyMap<
    string,
    C6ReviewerActorQualificationClosure
  >;
  graphqlRootSha256: string;
  pullAuthorRoots?: {
    originalRestRootSha256: string;
    supplementRootSha256: string;
  };
  sourceDataset?: {
    datasetId: string;
    revision: string;
  };
  targets: readonly C6ReviewerActorQualificationTarget[];
}): C6ReviewerActorFilteredQualification {
  const hashes = {
    actorPlanSha256: sha256Schema.parse(input.actorPlanSha256),
    actorRootSha256: sha256Schema.parse(input.actorRootSha256),
    baseQualificationSha256: sha256Schema.parse(
      input.baseQualificationSha256,
    ),
    graphqlRootSha256: sha256Schema.parse(input.graphqlRootSha256),
  };
  const actors = normalizeActorMap(input.actors);
  const targets = [...input.targets];
  assertTargets(targets);
  const knownDirectories = new Set(
    targets.map((target) => target.captureDirectory),
  );
  for (const directory of input.closures.keys()) {
    if (!knownDirectories.has(directory)) {
      throw new Error(
        `C6 actor-filtered qualification unexpected closure ${directory}`,
      );
    }
  }
  const results: C6ReviewerActorFilteredQualificationResult[] =
    targets.map((target) => {
      const closure = input.closures.get(target.captureDirectory);
      if (closure === undefined) {
        throw new Error(
          `C6 actor-filtered qualification missing closure ${
            target.captureDirectory
          }`,
        );
      }
      const eventCounts = countAndValidateActors(closure, actors);
      const filtered = filterClosureByActor(closure, actors);
      const events = projectC6StructuralReviewEvents({
        pullAuthor: target.pullAuthor,
        reviews: filtered.reviews,
        reviewThreads: filtered.reviewThreads,
      });
      const exact = selectC6MinimumLinearReviewSequence({
        anchorId: normalizeAnchor(target.canonicalAnchorId),
        commits: closure.commits,
        events,
      });
      const common = {
        ...target,
        actorIneligibleEventCount: eventCounts.ineligible,
        actorQualifiedEventCount: eventCounts.eligible,
      };
      if (target.status === "prior-frame-overlap") {
        return exact === null
          ? {
            ...common,
            actorFilteredQualification:
              "no-exact-sequence" as const,
            status: "prior-frame-overlap" as const,
          }
          : {
            ...common,
            actorFilteredQualification: "exact-sequence" as const,
            exactSequence: exact.sequence,
            exactSequenceLineageIdentitySha256:
              actorQualifiedLineage(exact, actors),
            status: "prior-frame-overlap" as const,
          };
      }
      if (exact === null) {
        return {
          ...common,
          status:
            "no-actor-filtered-exact-structural-sequence" as const,
        };
      }
      const firstReceipt = requiredActor(
        actors,
        exact.sequence.firstReview.author,
      );
      const secondReceipt = requiredActor(
        actors,
        exact.sequence.secondReview.author,
      );
      return {
        ...common,
        baseSequenceLineageIdentitySha256:
          exact.lineageIdentitySha256,
        exactSequence: exact.sequence,
        exactSequenceLineageIdentitySha256:
          actorQualifiedLineage(exact, actors),
        firstReviewActorManifestSha256:
          firstReceipt.captureManifestSha256,
        secondReviewActorManifestSha256:
          secondReceipt.captureManifestSha256,
        status:
          "actor-filtered-exact-structural-candidate" as const,
      };
    });
  const exactFresh = results.filter(
    (result): result is CommonResult & {
      baseSequenceLineageIdentitySha256: string;
      exactSequence: Exact["sequence"];
      exactSequenceLineageIdentitySha256: string;
      firstReviewActorManifestSha256: string;
      secondReviewActorManifestSha256: string;
      status: "actor-filtered-exact-structural-candidate";
    } =>
      result.status ===
        "actor-filtered-exact-structural-candidate"
  );
  return {
    artifactKind: ARTIFACT_KIND,
    boundary: {
      acceptedEpisodeCount: 0,
      automationExclusionComplete: false,
      candidateManifestFrozen: false,
      codexRunReady: false,
      eventTimeActorTypeProven: false,
      humanReviewerIdentityProven: false,
      machineQualifiedEpisodeCount: 0,
      status:
        "actor-filtered-exact-structural-screening-semantic-review-required",
    },
    counts: {
      actorFilteredExactFreshCandidateCount: exactFresh.length,
      actorFilteredNoExactFreshSequenceCount: results.filter(
        (result) =>
          result.status ===
            "no-actor-filtered-exact-structural-sequence"
      ).length,
      actorIneligibleEventCount: results.reduce(
        (sum, result) => sum + result.actorIneligibleEventCount,
        0,
      ),
      actorPlanTargetCount: actors.size,
      actorQualifiedEventCount: results.reduce(
        (sum, result) => sum + result.actorQualifiedEventCount,
        0,
      ),
      priorFrameOverlapCount: results.filter(
        (result) => result.status === "prior-frame-overlap",
      ).length,
      targetCount: targets.length,
    },
    independenceBoundary: {
      candidateOrderChanged: false,
      exactFreshCandidateProjectionSha256: sha256(
        JSON.stringify(exactFresh.map(candidateProjection)),
      ),
      goldInput: false,
      machineOutcomeInput: false,
      semanticLedgerInput: false,
    },
    inputs: {
      ...hashes,
      ...(input.pullAuthorRoots === undefined
        ? {}
        : {
          pullAuthorRoots: {
            originalRestRootSha256: sha256Schema.parse(
              input.pullAuthorRoots.originalRestRootSha256,
            ),
            supplementRootSha256: sha256Schema.parse(
              input.pullAuthorRoots.supplementRootSha256,
            ),
          },
        }),
    },
    policies: {
      actor: {
        definition: C6_REVIEWER_ACTOR_POLICY_V1,
        sha256: sha256(serializeC6ReviewerActorPolicy()),
      },
      structuralReview: {
        definition: C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2,
        sha256: sha256(serializeC6StructuralReviewEventPolicy()),
      },
    },
    results,
    rule: {
      actorFilter:
        "captured-platform-user-and-frozen-automation-login-rule",
      exactSelection:
        "reselect-v2-minimum-lineage-from-full-raw-event-set-after-actor-filter",
      resultOrder: "base-qualification-captureOrder",
    },
    schemaVersion: 1,
    ...(input.sourceDataset === undefined
      ? {}
      : {
        sourceDataset: validateSourceDataset(input.sourceDataset),
      }),
  };
}

export function serializeC6ReviewerActorFilteredQualification(
  qualification: C6ReviewerActorFilteredQualification,
): string {
  return `${JSON.stringify(qualification, null, 2)}\n`;
}

export async function buildC6ReviewerActorFilteredQualification(input: {
  actorPlanPath: string;
  actorRoot: string;
  baseQualificationPath: string;
  expectedActorPlanSha256: string;
  expectedActorRootSha256: string;
  expectedBaseQualificationSha256: string;
  expectedGraphqlRootSha256: string;
  graphqlRoot: string;
  testHooks?: {
    beforeTerminalVerification?: () => Promise<void> | void;
  };
}): Promise<{
  outputSha256: string;
  qualification: C6ReviewerActorFilteredQualification;
}> {
  const expected = {
    actorPlan: sha256Schema.parse(input.expectedActorPlanSha256),
    actorRoot: sha256Schema.parse(input.expectedActorRootSha256),
    baseQualification: sha256Schema.parse(
      input.expectedBaseQualificationSha256,
    ),
    graphqlRoot: sha256Schema.parse(
      input.expectedGraphqlRootSha256,
    ),
  };
  const [
    actorPlanPath,
    actorRoot,
    baseQualificationPath,
    graphqlRoot,
  ] = await Promise.all([
    assertC6NoSymlinkPathComponents(
      input.actorPlanPath,
      "C6 actor-filtered qualification actor plan",
    ),
    assertC6NoSymlinkPathComponents(
      input.actorRoot,
      "C6 actor-filtered qualification actor root",
    ),
    assertC6NoSymlinkPathComponents(
      input.baseQualificationPath,
      "C6 actor-filtered qualification base",
    ),
    assertC6NoSymlinkPathComponents(
      input.graphqlRoot,
      "C6 actor-filtered qualification GraphQL root",
    ),
  ]);
  const [
    actorPlanBytes,
    actorLock,
    baseQualificationBytes,
    graphqlLock,
  ] = await Promise.all([
    readC6StableRegularFile(
      actorPlanPath,
      "actor-filtered qualification actor plan",
    ),
    buildC6AssetLock(actorRoot),
    readC6StableRegularFile(
      baseQualificationPath,
      "actor-filtered qualification base",
    ),
    buildC6AssetLock(graphqlRoot),
  ]);
  if (
    sha256(actorPlanBytes) !== expected.actorPlan ||
    actorLock.assetRootSha256 !== expected.actorRoot ||
    sha256(baseQualificationBytes) !== expected.baseQualification ||
    graphqlLock.assetRootSha256 !== expected.graphqlRoot
  ) {
    throw new Error(
      "C6 actor-filtered qualification input hash mismatch",
    );
  }
  const actorPlan =
    parseC6ReviewerActorIdentityCapturePlan(actorPlanBytes);
  const baseQualification = baseQualificationSchema.parse(
    parseJson(baseQualificationBytes, "base qualification"),
  );
  if (
    actorPlan.inputs.graphqlRootSha256 !== expected.graphqlRoot ||
    actorPlan.inputs.qualificationSha256 !==
      expected.baseQualification ||
    actorPlan.policy.sha256 !==
      sha256(serializeC6ReviewerActorPolicy()) ||
    actorPlan.targets.length !== actorPlan.counts.uniqueActorCount ||
    actorPlan.counts.sourceTargetCount !==
      baseQualification.results.length ||
    sha256(JSON.stringify(actorPlan.targets)) !==
      actorPlan.independenceBoundary.targetProjectionSha256 ||
    baseQualification.inputs.graphqlRootSha256 !==
      expected.graphqlRoot ||
    baseQualification.results.length !==
      baseQualification.counts.targetCount
  ) {
    throw new Error(
      "C6 actor-filtered qualification input binding mismatch",
    );
  }
  assertActorPlanTargets(actorPlan.targets);
  assertBaseResults(baseQualification.results);
  const actorFiles = new Map(
    actorLock.files.map((file) => [file.path, file]),
  );
  const actors = await loadActorReceipts({
    actorFiles,
    actorPlan,
    actorPlanBytes,
    actorPlanPath,
    actorPlanSha256: expected.actorPlan,
    actorRoot,
  });
  const graphqlFiles = new Map(
    graphqlLock.files.map((file) => [file.path, file]),
  );
  const closures = new Map<
    string,
    C6ReviewerActorQualificationClosure
  >();
  const observedAuthors: string[] = [];
  for (const result of baseQualification.results) {
    const bytes = await readBoundFile(
      graphqlRoot,
      `${result.captureDirectory}/response.json`,
      graphqlFiles,
      "GraphQL response",
    );
    const response = graphqlSchema.parse(
      parseJson(bytes, "GraphQL response"),
    );
    const repository = normalizeRepository(
      response.data.repository.nameWithOwner,
    );
    const pull = response.data.repository.pullRequest;
    const anchor = parseAnchor(result.canonicalAnchorId);
    if (
      repository !== anchor.repository ||
      pull.number !== anchor.pullNumber
    ) {
      throw new Error(
        `C6 actor-filtered qualification GraphQL identity mismatch ${
          result.canonicalAnchorId
        }`,
      );
    }
    const reviews = pull.reviews.nodes.filter(isPresent).map(
      (review) => {
        if (review.author !== null) {
          observedAuthors.push(review.author.login);
        }
        return {
          author: review.author?.login ?? null,
          body: review.body,
          commit: review.commit?.oid ?? null,
          id: review.id,
          state: review.state,
          submittedAt: review.submittedAt,
        };
      },
    );
    const reviewThreads = pull.reviewThreads.nodes.filter(isPresent).map(
      (thread) => ({
        comments: thread.comments.nodes.filter(isPresent).map(
          (comment) => {
            if (comment.author !== null) {
              observedAuthors.push(comment.author.login);
            }
            return {
              author: comment.author?.login ?? null,
              body: comment.body,
              createdAt: comment.createdAt,
              id: comment.id,
              originalCommit: comment.originalCommit?.oid ?? null,
            };
          },
        ),
        id: thread.id,
      }),
    );
    closures.set(result.captureDirectory, {
      commits: pull.commits.nodes.filter(isPresent).map((node) => ({
        committedAt: node.commit.committedDate,
        oid: node.commit.oid,
        parents: node.commit.parents.nodes.filter(isPresent).map(
          (parent) => parent.oid,
        ),
      })),
      reviews,
      reviewThreads,
    });
  }
  const plannedLogins = actorPlan.targets.map((target) => target.login);
  const observedLogins = [...new Set(
    observedAuthors.map(normalizeLogin),
  )].sort(compareStrings);
  if (
    JSON.stringify(plannedLogins) !== JSON.stringify(observedLogins) ||
    observedAuthors.length !==
      actorPlan.counts.sourceReviewReferenceCount
  ) {
    throw new Error(
      "C6 actor-filtered qualification actor plan is not the complete author closure",
    );
  }
  const qualification = deriveC6ReviewerActorFilteredQualification({
    actorPlanSha256: expected.actorPlan,
    actorRootSha256: expected.actorRoot,
    actors,
    baseQualificationSha256: expected.baseQualification,
    closures,
    graphqlRootSha256: expected.graphqlRoot,
    ...(baseQualification.sourceDataset === undefined
      ? {}
      : { sourceDataset: baseQualification.sourceDataset }),
    targets: baseQualification.results.map((result) => ({
      agentVisibleRequestSha256: result.agentVisibleRequestSha256,
      canonicalAnchorId: result.canonicalAnchorId,
      canonicalRepository: result.canonicalRepository,
      captureDirectory: result.captureDirectory,
      captureOrder: result.captureOrder,
      instanceId: result.instanceId,
      pullAuthor: result.pullAuthor,
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
  });

  await input.testHooks?.beforeTerminalVerification?.();
  const [
    terminalActorPlanBytes,
    terminalActorLock,
    terminalBaseBytes,
    terminalGraphqlLock,
  ] = await Promise.all([
    readC6StableRegularFile(
      actorPlanPath,
      "actor-filtered qualification terminal actor plan",
    ),
    buildC6AssetLock(actorRoot),
    readC6StableRegularFile(
      baseQualificationPath,
      "actor-filtered qualification terminal base",
    ),
    buildC6AssetLock(graphqlRoot),
  ]);
  if (
    !terminalActorPlanBytes.equals(actorPlanBytes) ||
    serializeC6AssetLock(terminalActorLock) !==
      serializeC6AssetLock(actorLock) ||
    !terminalBaseBytes.equals(baseQualificationBytes) ||
    serializeC6AssetLock(terminalGraphqlLock) !==
      serializeC6AssetLock(graphqlLock)
  ) {
    throw new Error(
      "C6 actor-filtered qualification input closure changed during projection",
    );
  }
  const serialized =
    serializeC6ReviewerActorFilteredQualification(qualification);
  return {
    outputSha256: sha256(serialized),
    qualification,
  };
}

export async function materializeC6ReviewerActorFilteredQualification(
  input: {
    actorPlanPath: string;
    actorRoot: string;
    baseQualificationPath: string;
    expectedActorPlanSha256: string;
    expectedActorRootSha256: string;
    expectedBaseQualificationSha256: string;
    expectedGraphqlRootSha256: string;
    graphqlRoot: string;
    outputPath: string;
  },
): Promise<{
  outputSha256: string;
  qualification: C6ReviewerActorFilteredQualification;
}> {
  const result =
    await buildC6ReviewerActorFilteredQualification(input);
  const outputPath = resolve(input.outputPath);
  await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 actor-filtered qualification output parent",
  );
  const handle = await open(outputPath, "wx", 0o644);
  try {
    await handle.writeFile(
      serializeC6ReviewerActorFilteredQualification(
        result.qualification,
      ),
      "utf8",
    );
  } finally {
    await handle.close();
  }
  return result;
}

export async function replayC6ReviewerActorFilteredQualification(
  input: {
    actorPlanPath: string;
    actorRoot: string;
    baseQualificationPath: string;
    expectedActorPlanSha256: string;
    expectedActorRootSha256: string;
    expectedBaseQualificationSha256: string;
    expectedGraphqlRootSha256: string;
    expectedProjectionSha256: string;
    graphqlRoot: string;
    projectionPath: string;
  },
): Promise<{
  qualification: C6ReviewerActorFilteredQualification;
  reproduced: true;
}> {
  const expectedProjectionSha256 = sha256Schema.parse(
    input.expectedProjectionSha256,
  );
  const projectionPath = await assertC6NoSymlinkPathComponents(
    input.projectionPath,
    "C6 actor-filtered qualification projection",
  );
  const projectionBytes = await readC6StableRegularFile(
    projectionPath,
    "actor-filtered qualification projection",
  );
  if (sha256(projectionBytes) !== expectedProjectionSha256) {
    throw new Error(
      "C6 actor-filtered qualification projection hash mismatch",
    );
  }
  const result =
    await buildC6ReviewerActorFilteredQualification(input);
  if (
    serializeC6ReviewerActorFilteredQualification(
      result.qualification,
    ) !== projectionBytes.toString("utf8")
  ) {
    throw new Error(
      "C6 actor-filtered qualification projection does not match recomputation",
    );
  }
  const terminalProjectionBytes = await readC6StableRegularFile(
    projectionPath,
    "actor-filtered qualification terminal projection",
  );
  if (!terminalProjectionBytes.equals(projectionBytes)) {
    throw new Error(
      "C6 actor-filtered qualification projection changed during replay",
    );
  }
  return { qualification: result.qualification, reproduced: true };
}

export async function loadC6ReviewerActorReceiptClosure(input: {
  actorPlanPath: string;
  actorRoot: string;
  expectedActorPlanSha256: string;
  expectedActorRootSha256: string;
  expectedBaseQualificationSha256: string;
  expectedGraphqlRootSha256: string;
}): Promise<{
  actors: Map<string, C6ReviewerActorReceipt>;
  counts: {
    sourceReviewReferenceCount: number;
    sourceTargetCount: number;
    uniqueActorCount: number;
  };
  targets: Array<z.infer<typeof actorTargetSchema>>;
}> {
  const expected = {
    actorPlan: sha256Schema.parse(input.expectedActorPlanSha256),
    actorRoot: sha256Schema.parse(input.expectedActorRootSha256),
    baseQualification: sha256Schema.parse(
      input.expectedBaseQualificationSha256,
    ),
    graphqlRoot: sha256Schema.parse(
      input.expectedGraphqlRootSha256,
    ),
  };
  const [actorPlanPath, actorRoot] = await Promise.all([
    assertC6NoSymlinkPathComponents(
      input.actorPlanPath,
      "C6 actor receipt closure plan",
    ),
    assertC6NoSymlinkPathComponents(
      input.actorRoot,
      "C6 actor receipt closure root",
    ),
  ]);
  const [actorPlanBytes, actorLock] = await Promise.all([
    readC6StableRegularFile(
      actorPlanPath,
      "actor receipt closure plan",
    ),
    buildC6AssetLock(actorRoot),
  ]);
  if (
    sha256(actorPlanBytes) !== expected.actorPlan ||
    actorLock.assetRootSha256 !== expected.actorRoot
  ) {
    throw new Error("C6 actor receipt closure input hash mismatch");
  }
  const actorPlan =
    parseC6ReviewerActorIdentityCapturePlan(actorPlanBytes);
  if (
    actorPlan.inputs.graphqlRootSha256 !== expected.graphqlRoot ||
    actorPlan.inputs.qualificationSha256 !==
      expected.baseQualification ||
    actorPlan.policy.sha256 !==
      sha256(serializeC6ReviewerActorPolicy()) ||
    actorPlan.targets.length !== actorPlan.counts.uniqueActorCount ||
    sha256(JSON.stringify(actorPlan.targets)) !==
      actorPlan.independenceBoundary.targetProjectionSha256
  ) {
    throw new Error("C6 actor receipt closure plan mismatch");
  }
  assertActorPlanTargets(actorPlan.targets);
  const actors = await loadActorReceipts({
    actorFiles: new Map(
      actorLock.files.map((file) => [file.path, file]),
    ),
    actorPlan,
    actorPlanBytes,
    actorPlanPath,
    actorPlanSha256: expected.actorPlan,
    actorRoot,
  });
  const [terminalPlanBytes, terminalActorLock] = await Promise.all([
    readC6StableRegularFile(
      actorPlanPath,
      "actor receipt closure terminal plan",
    ),
    buildC6AssetLock(actorRoot),
  ]);
  if (
    !terminalPlanBytes.equals(actorPlanBytes) ||
    serializeC6AssetLock(terminalActorLock) !==
      serializeC6AssetLock(actorLock)
  ) {
    throw new Error(
      "C6 actor receipt closure changed during validation",
    );
  }
  return {
    actors,
    counts: actorPlan.counts,
    targets: actorPlan.targets,
  };
}

async function loadActorReceipts(input: {
  actorFiles: ReadonlyMap<string, C6AssetLock["files"][number]>;
  actorPlan: C6ReviewerActorIdentityCapturePlan;
  actorPlanBytes: Buffer;
  actorPlanPath: string;
  actorPlanSha256: string;
  actorRoot: string;
}): Promise<Map<string, C6ReviewerActorReceipt>> {
  const rootBytes = await readBoundFile(
    input.actorRoot,
    "capture.json",
    input.actorFiles,
    "actor root",
  );
  const root = actorRootSchema.parse(
    parseCanonicalJson(rootBytes, "actor root"),
  );
  if (
    root.plan.sha256 !== input.actorPlanSha256 ||
    root.plan.bytes !== input.actorPlanBytes.byteLength ||
    root.plan.path !== basename(input.actorPlanPath) ||
    root.plan.targetProjectionSha256 !==
      input.actorPlan.independenceBoundary.targetProjectionSha256 ||
    root.policy.sha256 !==
      sha256(serializeC6ReviewerActorPolicy()) ||
    root.captures.length !== input.actorPlan.targets.length ||
    root.counts.capturedTargetCount !== input.actorPlan.targets.length ||
    root.counts.plannedTargetCount !== input.actorPlan.targets.length
  ) {
    throw new Error(
      "C6 actor-filtered qualification actor root mismatch",
    );
  }
  const actors = new Map<string, C6ReviewerActorReceipt>();
  const expectedFiles = new Set(["capture.json"]);
  let eligible = 0;
  let networkAttempts = 0;
  let resolved = 0;
  for (const [index, target] of input.actorPlan.targets.entries()) {
    const capture = root.captures[index]!;
    if (
      capture.captureOrder !== target.captureOrder ||
      capture.captureDirectory !== target.captureDirectory ||
      normalizeLogin(capture.login) !== target.login
    ) {
      throw new Error(
        "C6 actor-filtered qualification actor capture order mismatch",
      );
    }
    const prefix = `${target.captureDirectory}/`;
    expectedFiles.add(`${prefix}manifest.json`);
    const manifestBytes = await readBoundFile(
      input.actorRoot,
      `${prefix}manifest.json`,
      input.actorFiles,
      "actor manifest",
    );
    const manifest = actorManifestSchema.parse(
      parseCanonicalJson(manifestBytes, "actor manifest"),
    );
    if (
      JSON.stringify(manifest.capture) !== JSON.stringify(capture) ||
      manifest.policy.sha256 !==
        sha256(serializeC6ReviewerActorPolicy()) ||
      manifest.attempts.length !== capture.networkAttemptCount ||
      capture.finalAttempt !== manifest.attempts.length
    ) {
      throw new Error(
        `C6 actor-filtered qualification actor receipt mismatch ${
          target.login
        }`,
      );
    }
    const responseBytes = await replayActorAttempts({
      actorFiles: input.actorFiles,
      actorRoot: input.actorRoot,
      attempts: manifest.attempts,
      capture,
      expectedFiles,
      prefix,
      target,
    });
    networkAttempts += manifest.attempts.length;
    const actor = capture.status === 200
      ? actorResponseSchema.parse(
        parseJson(responseBytes, "actor response"),
      )
      : null;
    if (capture.status === 404) {
      actorNotFoundSchema.parse(
        parseJson(
          responseBytes,
          "unresolved actor response",
        ),
      );
    }
    const classification = classifyC6ReviewerActor({
      plannedLogin: target.login,
      platformType: actor?.type ?? null,
      responseLogin: actor?.login ?? null,
      status: capture.status,
    });
    if (
      classification.eligible !== capture.eligible ||
      classification.reason !== capture.reason ||
      (actor?.type ?? null) !== capture.platformType ||
      (actor?.login ?? null) !== capture.responseLogin
    ) {
      throw new Error(
        `C6 actor-filtered qualification actor classification mismatch ${
          target.login
        }`,
      );
    }
    if (classification.eligible) {
      eligible += 1;
    }
    if (capture.status === 200) {
      resolved += 1;
    }
    actors.set(target.login, {
      captureManifestSha256: sha256(manifestBytes),
      eligible: classification.eligible,
      reason: classification.reason,
    });
  }
  if (
    eligible !== root.counts.eligibleActorCount ||
    root.counts.ineligibleActorCount !== actors.size - eligible ||
    root.counts.networkAttemptCount !== networkAttempts ||
    root.counts.retryCount !== networkAttempts - actors.size ||
    resolved !== root.counts.resolvedActorCount ||
    root.counts.unresolvedActorCount !== actors.size - resolved
  ) {
    throw new Error(
      "C6 actor-filtered qualification actor count mismatch",
    );
  }
  assertExactActorFiles(input.actorFiles, expectedFiles);
  return actors;
}

async function replayActorAttempts(input: {
  actorFiles: ReadonlyMap<string, C6AssetLock["files"][number]>;
  actorRoot: string;
  attempts: Array<z.infer<typeof actorAttemptSchema>>;
  capture: z.infer<typeof actorCaptureSchema>;
  expectedFiles: Set<string>;
  prefix: string;
  target: z.infer<typeof actorTargetSchema>;
}): Promise<Buffer> {
  const expectedUrl =
    `https://api.github.com/users/${
      encodeURIComponent(input.target.login)
    }`;
  let requestTimeoutMilliseconds: number | null = null;
  let finalResponse: Buffer | null = null;
  for (const [index, attempt] of input.attempts.entries()) {
    const attemptNumber = index + 1;
    const attemptDirectory =
      `attempt-${String(attemptNumber).padStart(2, "0")}`;
    const finalAttempt = attemptNumber === input.attempts.length;
    const expectedRequestPath =
      `${attemptDirectory}/request.json`;
    const expectedHeadersPath =
      `${attemptDirectory}/response-headers.json`;
    if (
      attempt.attempt !== attemptNumber ||
      attempt.request.path !== expectedRequestPath ||
      attempt.responseHeaders.path !== expectedHeadersPath ||
      (attempt.response === undefined) ===
        (attempt.transportError === undefined)
    ) {
      throw new Error(
        `C6 actor-filtered qualification actor attempt mismatch ${
          input.target.login
        }`,
      );
    }
    const [requestBytes, responseHeaderBytes] = await Promise.all([
      readAttemptArtifact(
        input,
        attempt.request,
        "actor request",
      ),
      readAttemptArtifact(
        input,
        attempt.responseHeaders,
        "actor response headers",
      ),
    ]);
    const request = actorRequestSchema.parse(
      parseCanonicalJson(requestBytes, "actor request"),
    );
    const responseHeaders = actorResponseHeadersSchema.parse(
      parseCanonicalJson(
        responseHeaderBytes,
        "actor response headers",
      ),
    );
    if (
      request.attempt !== attemptNumber ||
      request.url !== expectedUrl ||
      (
        requestTimeoutMilliseconds !== null &&
        request.requestTimeoutMilliseconds !==
          requestTimeoutMilliseconds
      )
    ) {
      throw new Error(
        `C6 actor-filtered qualification actor request mismatch ${
          input.target.login
        }`,
      );
    }
    requestTimeoutMilliseconds ??=
      request.requestTimeoutMilliseconds;

    if (attempt.response !== undefined) {
      const expectedResponsePath =
        `${attemptDirectory}/response.json`;
      if (
        attempt.response.path !== expectedResponsePath ||
        attempt.response.responseUrl !== expectedUrl ||
        attempt.response.redirected
      ) {
        throw new Error(
          `C6 actor-filtered qualification actor response mismatch ${
            input.target.login
          }`,
        );
      }
      const responseBytes = await readAttemptArtifact(
        input,
        attempt.response,
        "actor response",
      );
      if (finalAttempt) {
        if (
          attempt.response.httpStatus !== input.capture.status ||
          attempt.retryAfterMilliseconds !== undefined
        ) {
          throw new Error(
            "C6 actor-filtered qualification final actor response mismatch",
          );
        }
        validateActorSuccessHeaders(responseHeaders);
        finalResponse = responseBytes;
      } else if (
        ![429, 502, 503, 504].includes(
          attempt.response.httpStatus,
        ) ||
        attempt.retryAfterMilliseconds === undefined
      ) {
        throw new Error(
          "C6 actor-filtered qualification HTTP retry mismatch",
        );
      }
      if (!finalAttempt) {
        validateRetryDelay(
          responseHeaders["retry-after"],
          responseHeaders.date,
          attemptNumber,
          attempt.retryAfterMilliseconds,
        );
      }
      continue;
    }

    const transport = attempt.transportError!;
    const expectedTransportPath =
      `${attemptDirectory}/transport-error.json`;
    if (transport.path !== expectedTransportPath || finalAttempt) {
      throw new Error(
        "C6 actor-filtered qualification transport retry mismatch",
      );
    }
    const transportBytes = await readAttemptArtifact(
      input,
      transport,
      "actor transport error",
    );
    const transportError = actorTransportErrorSchema.parse(
      parseCanonicalJson(
        transportBytes,
        "actor transport error",
      ),
    );
    const transient =
      transportError.phase === "timeout" ||
      transportError.transientTransportCode !== null;
    if (
      transportError.phase !== transport.phase ||
      !transient ||
      !transportError.transientTransportFailure ||
      !transportError.retryScheduled ||
      attempt.retryAfterMilliseconds === undefined
    ) {
      throw new Error(
        "C6 actor-filtered qualification transport receipt mismatch",
      );
    }
    validateRetryDelay(
      responseHeaders["retry-after"],
      responseHeaders.date,
      attemptNumber,
      attempt.retryAfterMilliseconds,
    );
  }
  if (finalResponse === null) {
    throw new Error(
      "C6 actor-filtered qualification final actor response missing",
    );
  }
  return finalResponse;
}

async function readAttemptArtifact(input: {
  actorFiles: ReadonlyMap<string, C6AssetLock["files"][number]>;
  actorRoot: string;
  expectedFiles: Set<string>;
  prefix: string;
}, reference: z.infer<typeof actorArtifactReferenceSchema>, label: string):
  Promise<Buffer> {
  const path = `${input.prefix}${reference.path}`;
  input.expectedFiles.add(path);
  const bytes = await readBoundFile(
    input.actorRoot,
    path,
    input.actorFiles,
    label,
  );
  if (
    bytes.byteLength !== reference.bytes ||
    sha256(bytes) !== reference.sha256
  ) {
    throw new Error(
      `C6 actor-filtered qualification ${label} reference mismatch`,
    );
  }
  return bytes;
}

function validateActorSuccessHeaders(
  headers: z.infer<typeof actorResponseHeadersSchema>,
): void {
  if (
    headers["content-type"] === undefined ||
    !headers["content-type"].toLowerCase().startsWith(
      "application/json",
    ) ||
    headers.date === undefined ||
    !Number.isFinite(Date.parse(headers.date)) ||
    headers["x-github-request-id"] === undefined ||
    headers["x-github-request-id"].trim().length === 0 ||
    headers["x-ratelimit-resource"] !== "core" ||
    !isDigits(headers["x-ratelimit-limit"]) ||
    !isDigits(headers["x-ratelimit-remaining"]) ||
    !isDigits(headers["x-ratelimit-reset"]) ||
    !isDigits(headers["x-ratelimit-used"])
  ) {
    throw new Error(
      "C6 actor-filtered qualification invalid actor response headers",
    );
  }
}

function validateRetryDelay(
  retryAfter: string | undefined,
  responseDate: string | undefined,
  retryNumber: number,
  recorded: number | undefined,
): void {
  if (recorded === undefined || recorded < 0 || recorded > 60_000) {
    throw new Error(
      "C6 actor-filtered qualification invalid retry delay",
    );
  }
  if (retryAfter === undefined) {
    const expected = Math.min(
      1_000 * 2 ** (retryNumber - 1),
      60_000,
    );
    if (recorded !== expected) {
      throw new Error(
        "C6 actor-filtered qualification retry delay mismatch",
      );
    }
    return;
  }
  if (/^\d+(?:\.\d+)?$/u.test(retryAfter)) {
    const expected = Math.min(
      Math.ceil(Number(retryAfter) * 1_000),
      60_000,
    );
    if (recorded !== expected) {
      throw new Error(
        "C6 actor-filtered qualification Retry-After mismatch",
      );
    }
  } else {
    const retryTimestamp = Date.parse(retryAfter);
    const responseTimestamp = responseDate === undefined
      ? Number.NaN
      : Date.parse(responseDate);
    const expected =
      Number.isFinite(retryTimestamp) &&
        Number.isFinite(responseTimestamp)
        ? Math.min(
          Math.max(0, retryTimestamp - responseTimestamp),
          60_000,
        )
        : Math.min(
          1_000 * 2 ** (retryNumber - 1),
          60_000,
        );
    if (recorded !== expected) {
      throw new Error(
        "C6 actor-filtered qualification Retry-After mismatch",
      );
    }
  }
}

function assertExactActorFiles(
  files: ReadonlyMap<string, C6AssetLock["files"][number]>,
  expected: ReadonlySet<string>,
): void {
  if (
    files.size !== expected.size ||
    [...files.keys()].some((path) => !expected.has(path))
  ) {
    throw new Error(
      "C6 actor-filtered qualification actor receipt tree mismatch",
    );
  }
}

function isDigits(value: string | undefined): boolean {
  return value !== undefined && /^\d+$/u.test(value);
}

function countAndValidateActors(
  closure: C6ReviewerActorQualificationClosure,
  actors: ReadonlyMap<string, C6ReviewerActorReceipt>,
): { eligible: number; ineligible: number } {
  let eligible = 0;
  let ineligible = 0;
  for (const author of allAuthors(closure)) {
    const actor = requiredActor(actors, author);
    if (actor.eligible) {
      eligible += 1;
    } else {
      ineligible += 1;
    }
  }
  return { eligible, ineligible };
}

function filterClosureByActor(
  closure: C6ReviewerActorQualificationClosure,
  actors: ReadonlyMap<string, C6ReviewerActorReceipt>,
): {
  reviews: C6ReviewPolicyReview[];
  reviewThreads: C6ReviewPolicyThread[];
} {
  return {
    reviews: closure.reviews.filter(
      (review) =>
        review.author !== null &&
        requiredActor(actors, review.author).eligible,
    ),
    reviewThreads: closure.reviewThreads.map((thread) => ({
      comments: thread.comments.filter(
        (comment) =>
          comment.author !== null &&
          requiredActor(actors, comment.author).eligible,
      ),
      id: thread.id,
    })),
  };
}

function allAuthors(
  closure: C6ReviewerActorQualificationClosure,
): string[] {
  return [
    ...closure.reviews.flatMap(
      (review) => review.author === null ? [] : [review.author],
    ),
    ...closure.reviewThreads.flatMap((thread) =>
      thread.comments.flatMap(
        (comment) =>
          comment.author === null ? [] : [comment.author],
      )
    ),
  ];
}

function requiredActor(
  actors: ReadonlyMap<string, C6ReviewerActorReceipt>,
  login: string,
): C6ReviewerActorReceipt {
  const normalized = normalizeLogin(login);
  const actor = actors.get(normalized);
  if (actor === undefined) {
    throw new Error(
      `C6 actor-filtered qualification missing actor closure ${
        normalized
      }`,
    );
  }
  return actor;
}

function normalizeActorMap(
  values: ReadonlyMap<string, C6ReviewerActorReceipt>,
): Map<string, C6ReviewerActorReceipt> {
  const normalized = new Map<string, C6ReviewerActorReceipt>();
  for (const [login, actor] of values) {
    const key = normalizeLogin(login);
    if (normalized.has(key)) {
      throw new Error(
        `C6 actor-filtered qualification duplicate actor ${login}`,
      );
    }
    normalized.set(key, {
      captureManifestSha256: sha256Schema.parse(
        actor.captureManifestSha256,
      ),
      eligible: actor.eligible,
      reason: actor.reason,
    });
  }
  return normalized;
}

function actorQualifiedLineage(
  exact: Exact,
  actors: ReadonlyMap<string, C6ReviewerActorReceipt>,
): string {
  const first = requiredActor(
    actors,
    exact.sequence.firstReview.author,
  );
  const second = requiredActor(
    actors,
    exact.sequence.secondReview.author,
  );
  return sha256(
    `${LINEAGE_DOMAIN_SEPARATOR}\0${JSON.stringify({
      actorPolicySha256: sha256(serializeC6ReviewerActorPolicy()),
      baseSequenceLineageIdentitySha256:
        exact.lineageIdentitySha256,
      firstReviewActorManifestSha256:
        first.captureManifestSha256,
      secondReviewActorManifestSha256:
        second.captureManifestSha256,
    })}`,
  );
}

function candidateProjection(
  result: CommonResult & {
    exactSequence: Exact["sequence"];
    exactSequenceLineageIdentitySha256: string;
    firstReviewActorManifestSha256: string;
    secondReviewActorManifestSha256: string;
  },
): unknown {
  if (result.source !== undefined) {
    return {
      canonicalAnchorId: result.canonicalAnchorId,
      captureOrder: result.captureOrder,
      exactSequence: result.exactSequence,
      exactSequenceLineageIdentitySha256:
        result.exactSequenceLineageIdentitySha256,
      firstReviewActorManifestSha256:
        result.firstReviewActorManifestSha256,
      requestedAnchorId: result.requestedAnchorId,
      secondReviewActorManifestSha256:
        result.secondReviewActorManifestSha256,
      source: result.source,
    };
  }
  return {
    agentVisibleRequestSha256: result.agentVisibleRequestSha256,
    canonicalAnchorId: result.canonicalAnchorId,
    captureOrder: result.captureOrder,
    exactSequence: result.exactSequence,
    exactSequenceLineageIdentitySha256:
      result.exactSequenceLineageIdentitySha256,
    firstReviewActorManifestSha256:
      result.firstReviewActorManifestSha256,
    instanceId: result.instanceId,
    rowIndex: result.rowIndex,
    secondReviewActorManifestSha256:
      result.secondReviewActorManifestSha256,
    ...(result.sourceSplit === undefined
      ? {}
      : {
        sourceSplit: result.sourceSplit,
        sourceSplitRowIndex: result.sourceSplitRowIndex,
      }),
  };
}

function assertTargets(
  targets: readonly C6ReviewerActorQualificationTarget[],
): void {
  let prior = 0;
  const anchors = new Set<string>();
  const directories = new Set<string>();
  for (const target of targets) {
    const anchor = normalizeAnchor(target.canonicalAnchorId);
    const repository = parseAnchor(anchor).repository;
    const agentVisibleSource =
      target.agentVisibleRequestSha256 !== undefined &&
      target.instanceId !== undefined &&
      target.rowIndex !== undefined &&
      target.source === undefined &&
      target.rowIndex === target.captureOrder - 1;
    const legacySource =
      target.agentVisibleRequestSha256 === undefined &&
      target.instanceId === undefined &&
      target.rowIndex === undefined &&
      target.source !== undefined &&
      /^[a-f0-9]{64}$/u.test(target.source.rowSha256) &&
      target.source.path.length > 0 &&
      target.source.rowIndex >= 0;
    if (
      target.captureOrder <= prior ||
      (!agentVisibleSource && !legacySource) ||
      normalizeRepository(target.canonicalRepository) !== repository ||
      (
        (target.sourceSplit === undefined) !==
          (target.sourceSplitRowIndex === undefined)
      ) ||
      anchors.has(anchor) ||
      directories.has(target.captureDirectory)
    ) {
      throw new Error(
        "C6 actor-filtered qualification target identity mismatch",
      );
    }
    prior = target.captureOrder;
    anchors.add(anchor);
    directories.add(target.captureDirectory);
  }
}

function assertBaseResults(
  results: readonly z.infer<typeof baseResultSchema>[],
): void {
  assertTargets(results);
}

function assertActorPlanTargets(
  targets: readonly z.infer<typeof actorTargetSchema>[],
): void {
  let priorLogin = "";
  for (const [index, target] of targets.entries()) {
    if (
      target.captureOrder !== index + 1 ||
      target.login !== normalizeLogin(target.login) ||
      target.captureDirectory !== `actor-${sha256(target.login)}` ||
      (index > 0 && compareStrings(priorLogin, target.login) >= 0)
    ) {
      throw new Error(
        "C6 actor-filtered qualification actor plan order mismatch",
      );
    }
    priorLogin = target.login;
  }
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
      `C6 actor-filtered qualification missing ${label} ${path}`,
    );
  }
  const bytes = await readC6StableRegularFile(
    join(root, ...path.split("/")),
    `actor-filtered qualification ${label}`,
  );
  if (
    bytes.byteLength !== reference.bytes ||
    sha256(bytes) !== reference.sha256
  ) {
    throw new Error(
      `C6 actor-filtered qualification changed ${label} ${path}`,
    );
  }
  return bytes;
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
      "C6 actor-filtered qualification invalid source dataset",
    );
  }
  return value;
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

function normalizeAnchor(value: string): string {
  const match = /^([^/#\s]+\/[^/#\s]+)#([1-9]\d*)$/u.exec(
    value.toLowerCase(),
  );
  if (match === null) {
    throw new Error(
      `C6 actor-filtered qualification invalid anchor ${value}`,
    );
  }
  return `${normalizeRepository(match[1]!)}#${match[2]}`;
}

function normalizeRepository(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^[^/#\s]+\/[^/#\s]+$/u.test(normalized)) {
    throw new Error(
      `C6 actor-filtered qualification invalid repository ${value}`,
    );
  }
  return normalized;
}

function normalizeLogin(value: string): string {
  if (
    value.length === 0 ||
    value.trim() !== value ||
    /[/\s]/u.test(value)
  ) {
    throw new Error(
      `C6 actor-filtered qualification invalid login ${value}`,
    );
  }
  return value.toLowerCase();
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host.toLowerCase()}${url.pathname}`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(
      `C6 actor-filtered qualification invalid ${label} JSON`,
    );
  }
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
      `C6 actor-filtered qualification noncanonical ${label} JSON`,
    );
  }
  return raw;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
