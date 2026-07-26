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
  projectC6StructuralReviewEvents,
  selectC6MinimumLinearReviewSequence,
} from "./c6-review-event-policy";
import type {
  C6ReviewPolicyCommit,
  C6ReviewPolicyReview,
  C6ReviewPolicyThread,
} from "./c6-review-event-policy";

const REPOSITORY_CAP = 4;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const sourceSchema = z.object({
  path: z.string().min(1),
  rowIndex: z.number().int().nonnegative(),
  rowSha256: sha256Schema,
}).strict();
const resultSchema = z.object({
  anchorId: z.string().min(1),
  canonicalAnchorId: z.string().min(1),
  captureDirectory: z.string().min(1),
  captureOrder: z.number().int().positive(),
  source: sourceSchema,
  status: z.enum([
    "exact-structural-candidate",
    "missing-rest-closure",
    "no-exact-structural-sequence",
  ]),
}).passthrough();
const originalQualificationSchema = z.object({
  artifactKind: z.literal("c6-source-expansion-rest-qualification"),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    captureAttemptCompletenessProven: z.literal(false),
    codexRunReady: z.literal(false),
    machineQualifiedEpisodeCount: z.literal(0),
  }).passthrough(),
  counts: z.object({
    capturedClosureCount: z.number().int().nonnegative(),
    exactStructuralCandidateCount: z.number().int().nonnegative(),
    exactStructuralRepositoryCount: z.number().int().nonnegative(),
    missingClosureCount: z.number().int().positive(),
    repositoryCappedStructuralCeiling: z.number().int().nonnegative(),
    targetCount: z.number().int().positive(),
  }).strict(),
  inputs: z.object({
    capturePlanSha256: sha256Schema,
    graphqlRootSha256: sha256Schema,
    restRootSha256: sha256Schema,
  }).strict(),
  results: z.array(resultSchema).min(1),
  schemaVersion: z.literal(1),
}).strict();
const supplementTargetSchema = z.object({
  anchorId: z.string().min(1),
  canonicalAnchorId: z.string().min(1),
  canonicalOwner: z.string().min(1),
  canonicalRepository: z.string().min(1),
  captureDirectory: z.string().min(1),
  originalCaptureOrder: z.number().int().positive(),
  pullNumber: z.number().int().positive(),
  supplementOrder: z.number().int().positive(),
}).strict();
const supplementPlanSchema = z.object({
  artifactKind: z.literal("c6-rest-identity-supplement-plan"),
  counts: z.object({
    supplementTargetCount: z.number().int().positive(),
  }).passthrough(),
  independenceBoundary: z.object({
    supplementTargetProjectionSha256: sha256Schema,
  }).passthrough(),
  inputs: z.object({
    restQualification: z.object({
      sha256: sha256Schema,
    }).passthrough(),
  }).passthrough(),
  schemaVersion: z.literal(1),
  targets: z.array(supplementTargetSchema).min(1),
}).passthrough();
const captureSchema = z.object({
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
const captureRootSchema = z.object({
  artifactKind: z.literal("c6-rest-identity-supplement-capture-root"),
  boundary: z.object({
    captureAttemptCompletenessProven: z.literal(true),
    platformAuthenticationCryptographicallyProven: z.literal(false),
  }).passthrough(),
  captures: z.array(captureSchema).min(1),
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
const captureManifestSchema = z.object({
  artifactKind: z.literal("c6-rest-identity-supplement-capture"),
  boundary: z.object({
    bearerAuthorizationHeaderSent: z.literal(true),
    cryptographicPlatformReceipt: z.literal(false),
    platformAuthenticationCryptographicallyProven: z.literal(false),
  }).strict(),
  capture: captureSchema,
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
const requestSchema = z.object({
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
const pageInfoSchema = z.object({
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
                pageInfo: pageInfoSchema,
              }).passthrough(),
            }).passthrough(),
          }).passthrough().nullable()),
          pageInfo: pageInfoSchema,
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

export interface C6RestIdentitySupplementClosure {
  canonicalAnchorId: string;
  commits: C6ReviewPolicyCommit[];
  pullAuthor: string;
  reviews: C6ReviewPolicyReview[];
  reviewThreads: C6ReviewPolicyThread[];
  supplementManifestSha256: string;
}

export interface C6RestIdentitySupplementedQualification {
  artifactKind: "c6-source-expansion-rest-qualification-v2";
  boundary: {
    acceptedEpisodeCount: 0;
    candidateManifestFrozen: false;
    codexRunReady: false;
    machineQualifiedEpisodeCount: 0;
    originalFullRestCaptureAttemptCompletenessProven: false;
    pullIdentitySupplementClosureComplete: true;
    status:
      "exact-structural-screening-complete-semantic-qualification-required";
  };
  counts: {
    exactStructuralCandidateCount: number;
    exactStructuralRepositoryCount: number;
    fullRestClosureCount: number;
    identitySupplementClosureCount: number;
    missingClosureCount: 0;
    noExactStructuralSequenceCount: number;
    repositoryCappedStructuralCeiling: number;
    targetCount: number;
  };
  inputs: {
    capturePlanSha256: string;
    graphqlRootSha256: string;
    originalQualificationSha256: string;
    originalRestRootSha256: string;
    supplementPlanSha256: string;
    supplementRootSha256: string;
  };
  results: Array<Record<string, unknown> & {
    anchorId: string;
    canonicalAnchorId: string;
    captureDirectory: string;
    captureOrder: number;
    qualificationSource:
      "full-rest-v1" | "pull-identity-supplement-v1";
    source: z.infer<typeof sourceSchema>;
    status:
      "exact-structural-candidate" |
      "no-exact-structural-sequence";
  }>;
  schemaVersion: 2;
}

export function deriveC6RestIdentitySupplementedQualification(input: {
  graphqlRootSha256: string;
  originalQualification: unknown;
  originalQualificationSha256: string;
  supplementClosures: ReadonlyMap<
    string,
    C6RestIdentitySupplementClosure
  >;
  supplementPlanSha256: string;
  supplementRootSha256: string;
}): C6RestIdentitySupplementedQualification {
  const graphqlRootSha256 = sha256Schema.parse(input.graphqlRootSha256);
  const originalQualificationSha256 = sha256Schema.parse(
    input.originalQualificationSha256,
  );
  const supplementPlanSha256 = sha256Schema.parse(
    input.supplementPlanSha256,
  );
  const supplementRootSha256 = sha256Schema.parse(
    input.supplementRootSha256,
  );
  const original = originalQualificationSchema.parse(
    input.originalQualification,
  );
  if (original.inputs.graphqlRootSha256 !== graphqlRootSha256) {
    throw new Error(
      "C6 supplemented qualification GraphQL root mismatch",
    );
  }
  const results = [...original.results].sort(
    (left, right) => left.captureOrder - right.captureOrder,
  );
  assertOriginalCounts(original, results);
  const missingDirectories = new Set(
    results.filter((result) => result.status === "missing-rest-closure")
      .map((result) => result.captureDirectory),
  );
  for (const directory of input.supplementClosures.keys()) {
    if (!missingDirectories.has(directory)) {
      throw new Error(
        `C6 supplemented qualification unknown identity supplement closure ${
          directory
        }`,
      );
    }
  }
  const supplementedResults:
    C6RestIdentitySupplementedQualification["results"] = results.map(
      (result) => {
        if (result.status !== "missing-rest-closure") {
          return {
            ...result,
            qualificationSource: "full-rest-v1" as const,
            status: result.status,
          };
        }
        const closure = input.supplementClosures.get(
          result.captureDirectory,
        );
        if (closure === undefined) {
          throw new Error(
            `C6 supplemented qualification missing identity supplement closure ${
              result.captureDirectory
            }`,
          );
        }
        if (
          normalizeAnchor(closure.canonicalAnchorId) !==
            normalizeAnchor(result.canonicalAnchorId)
        ) {
          throw new Error(
            `C6 supplemented qualification identity supplement mismatch ${
              result.captureDirectory
            }`,
          );
        }
        const events = projectC6StructuralReviewEvents({
          pullAuthor: closure.pullAuthor,
          reviews: closure.reviews,
          reviewThreads: closure.reviewThreads,
        });
        const exact = selectC6MinimumLinearReviewSequence({
          anchorId: normalizeAnchor(result.canonicalAnchorId),
          commits: closure.commits,
          events,
        });
        const { status: _status, ...base } = result;
        const supplementManifestSha256 = sha256Schema.parse(
          closure.supplementManifestSha256,
        );
        if (exact === null) {
          return {
            ...base,
            exactEventCount: events.length,
            qualificationSource: "pull-identity-supplement-v1" as const,
            status: "no-exact-structural-sequence" as const,
            supplementManifestSha256,
          };
        }
        return {
          ...base,
          exactEventCount: events.length,
          exactLineageIdentitySha256: exact.lineageIdentitySha256,
          exactSequence: exact.sequence,
          qualificationSource: "pull-identity-supplement-v1" as const,
          status: "exact-structural-candidate" as const,
          supplementManifestSha256,
        };
      },
    );
  const exact = supplementedResults.filter((result) =>
    result.status === "exact-structural-candidate"
  );
  const repositories = groupCanonicalRepositories(
    exact.map((result) => result.canonicalAnchorId),
  );
  return {
    artifactKind: "c6-source-expansion-rest-qualification-v2",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      machineQualifiedEpisodeCount: 0,
      originalFullRestCaptureAttemptCompletenessProven: false,
      pullIdentitySupplementClosureComplete: true,
      status:
        "exact-structural-screening-complete-semantic-qualification-required",
    },
    counts: {
      exactStructuralCandidateCount: exact.length,
      exactStructuralRepositoryCount: repositories.size,
      fullRestClosureCount: original.counts.capturedClosureCount,
      identitySupplementClosureCount: input.supplementClosures.size,
      missingClosureCount: 0,
      noExactStructuralSequenceCount: supplementedResults.length - exact.length,
      repositoryCappedStructuralCeiling: [...repositories.values()]
        .reduce(
          (sum, count) => sum + Math.min(REPOSITORY_CAP, count),
          0,
        ),
      targetCount: supplementedResults.length,
    },
    inputs: {
      capturePlanSha256: original.inputs.capturePlanSha256,
      graphqlRootSha256,
      originalQualificationSha256,
      originalRestRootSha256: original.inputs.restRootSha256,
      supplementPlanSha256,
      supplementRootSha256,
    },
    results: supplementedResults,
    schemaVersion: 2,
  };
}

export function serializeC6RestIdentitySupplementedQualification(
  qualification: C6RestIdentitySupplementedQualification,
): string {
  return `${JSON.stringify(qualification, null, 2)}\n`;
}

export async function buildC6RestIdentitySupplementedQualification(input: {
  expectedGraphqlRootSha256: string;
  expectedOriginalQualificationSha256: string;
  expectedSupplementPlanSha256: string;
  expectedSupplementRootSha256: string;
  graphqlRoot: string;
  originalQualificationPath: string;
  supplementPlanPath: string;
  supplementRoot: string;
}): Promise<{
  outputSha256: string;
  qualification: C6RestIdentitySupplementedQualification;
}> {
  const expected = {
    graphqlRoot: sha256Schema.parse(input.expectedGraphqlRootSha256),
    originalQualification: sha256Schema.parse(
      input.expectedOriginalQualificationSha256,
    ),
    supplementPlan: sha256Schema.parse(input.expectedSupplementPlanSha256),
    supplementRoot: sha256Schema.parse(input.expectedSupplementRootSha256),
  };
  const [
    graphqlRoot,
    originalQualificationPath,
    supplementPlanPath,
    supplementRoot,
  ] = await Promise.all([
    assertC6NoSymlinkPathComponents(
      input.graphqlRoot,
      "C6 supplemented qualification GraphQL root",
    ),
    assertC6NoSymlinkPathComponents(
      input.originalQualificationPath,
      "C6 supplemented qualification original projection",
    ),
    assertC6NoSymlinkPathComponents(
      input.supplementPlanPath,
      "C6 supplemented qualification plan",
    ),
    assertC6NoSymlinkPathComponents(
      input.supplementRoot,
      "C6 supplemented qualification capture root",
    ),
  ]);
  const [
    originalBytes,
    supplementPlanBytes,
    graphqlLock,
    supplementLock,
  ] = await Promise.all([
    readC6StableRegularFile(
      originalQualificationPath,
      "supplemented original qualification",
    ),
    readC6StableRegularFile(
      supplementPlanPath,
      "supplemented qualification plan",
    ),
    buildC6AssetLock(graphqlRoot),
    buildC6AssetLock(supplementRoot),
  ]);
  if (
    sha256(originalBytes) !== expected.originalQualification ||
    sha256(supplementPlanBytes) !== expected.supplementPlan ||
    graphqlLock.assetRootSha256 !== expected.graphqlRoot ||
    supplementLock.assetRootSha256 !== expected.supplementRoot
  ) {
    throw new Error("C6 supplemented qualification input hash mismatch");
  }
  const original = originalQualificationSchema.parse(
    parseJson(originalBytes, "original qualification"),
  );
  if (original.inputs.graphqlRootSha256 !== expected.graphqlRoot) {
    throw new Error(
      "C6 supplemented qualification original GraphQL root mismatch",
    );
  }
  const rawPlan = parseJson(supplementPlanBytes, "supplement plan");
  const plan = supplementPlanSchema.parse(rawPlan);
  if (
    plan.inputs.restQualification.sha256 !==
      expected.originalQualification ||
    plan.targets.length !== plan.counts.supplementTargetCount ||
    sha256(JSON.stringify(
      (rawPlan as { targets: unknown }).targets,
    )) !== plan.independenceBoundary.supplementTargetProjectionSha256
  ) {
    throw new Error(
      "C6 supplemented qualification plan binding mismatch",
    );
  }
  assertSupplementTargetOrder(plan.targets);
  const supplementFiles = new Map(
    supplementLock.files.map((file) => [file.path, file]),
  );
  const graphqlFiles = new Map(
    graphqlLock.files.map((file) => [file.path, file]),
  );
  const captureRootBytes = await readBoundFile(
    supplementRoot,
    "capture.json",
    supplementFiles,
    "capture root",
  );
  const rawCaptureRoot = parseJson(captureRootBytes, "capture root");
  const captureRoot = captureRootSchema.parse(rawCaptureRoot);
  if (
    captureRootBytes.toString("utf8") !==
      `${JSON.stringify(rawCaptureRoot, null, 2)}\n` ||
    captureRoot.plan.sha256 !== expected.supplementPlan ||
    captureRoot.plan.targetProjectionSha256 !==
      plan.independenceBoundary.supplementTargetProjectionSha256 ||
    captureRoot.counts.capturedTargetCount !== plan.targets.length ||
    captureRoot.counts.plannedTargetCount !== plan.targets.length ||
    captureRoot.captures.length !== plan.targets.length
  ) {
    throw new Error(
      "C6 supplemented qualification capture-root mismatch",
    );
  }
  assertSupplementFileClosure(supplementLock, plan.targets);
  const closures = new Map<string, C6RestIdentitySupplementClosure>();
  for (const [index, target] of plan.targets.entries()) {
    const capture = captureRoot.captures[index]!;
    if (!captureMatchesTarget(capture, target)) {
      throw new Error(
        `C6 supplemented qualification capture identity mismatch ${
          target.canonicalAnchorId
        }`,
      );
    }
    const prefix = `${target.captureDirectory}/`;
    const [manifestBytes, requestBytes, responseBytes, graphqlBytes] =
      await Promise.all([
        readBoundFile(
          supplementRoot,
          `${prefix}manifest.json`,
          supplementFiles,
          "supplement manifest",
        ),
        readBoundFile(
          supplementRoot,
          `${prefix}request.json`,
          supplementFiles,
          "supplement request",
        ),
        readBoundFile(
          supplementRoot,
          `${prefix}response.json`,
          supplementFiles,
          "supplement response",
        ),
        readBoundFile(
          graphqlRoot,
          `${target.captureDirectory}/response.json`,
          graphqlFiles,
          "GraphQL response",
        ),
      ]);
    const rawManifest = parseJson(manifestBytes, "supplement manifest");
    const manifest = captureManifestSchema.parse(rawManifest);
    const rawRequest = parseJson(requestBytes, "supplement request");
    const request = requestSchema.parse(rawRequest);
    if (
      manifestBytes.toString("utf8") !==
        `${JSON.stringify(rawManifest, null, 2)}\n` ||
      requestBytes.toString("utf8") !==
        `${JSON.stringify(rawRequest, null, 2)}\n` ||
      JSON.stringify(manifest.capture) !== JSON.stringify(capture) ||
      manifest.request.sha256 !== sha256(requestBytes) ||
      manifest.response.bytes !== responseBytes.byteLength ||
      manifest.response.sha256 !== sha256(responseBytes) ||
      capture.requestSha256 !== sha256(requestBytes) ||
      capture.responseBytes !== responseBytes.byteLength ||
      capture.responseSha256 !== sha256(responseBytes)
    ) {
      throw new Error(
        `C6 supplemented qualification supplement file mismatch ${
          target.canonicalAnchorId
        }`,
      );
    }
    const expectedUrl = "https://api.github.com/repos/" +
      `${target.canonicalOwner}/${target.canonicalRepository}/pulls/` +
      target.pullNumber;
    if (request.url !== expectedUrl) {
      throw new Error(
        `C6 supplemented qualification request mismatch ${
          target.canonicalAnchorId
        }`,
      );
    }
    const pull = pullSchema.parse(
      parseJson(responseBytes, "supplement pull response"),
    );
    const graphql = graphqlResponseSchema.parse(
      parseJson(graphqlBytes, "GraphQL response"),
    );
    const graphqlPull = graphql.data.repository.pullRequest;
    const canonicalRepository =
      `${target.canonicalOwner}/${target.canonicalRepository}`.toLowerCase();
    if (
      pull.number !== target.pullNumber ||
      graphqlPull.number !== target.pullNumber ||
      pull.base.repo.full_name.toLowerCase() !== canonicalRepository ||
      graphql.data.repository.nameWithOwner.toLowerCase() !==
        canonicalRepository ||
      pull.head.sha !== graphqlPull.headRefOid ||
      capture.headSha !== pull.head.sha ||
      capture.pullAuthor !== pull.user.login
    ) {
      throw new Error(
        `C6 supplemented qualification pull/GraphQL mismatch ${
          target.canonicalAnchorId
        }`,
      );
    }
    closures.set(target.captureDirectory, {
      canonicalAnchorId: target.canonicalAnchorId,
      commits: graphqlPull.commits.nodes.filter(isPresent).map((node) => ({
        committedAt: node.commit.committedDate,
        oid: node.commit.oid,
        parents: node.commit.parents.nodes.filter(isPresent).map(
          (parent) => parent.oid,
        ),
      })),
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
      supplementManifestSha256: sha256(manifestBytes),
    });
  }
  const qualification =
    deriveC6RestIdentitySupplementedQualification({
      graphqlRootSha256: expected.graphqlRoot,
      originalQualification: original,
      originalQualificationSha256: expected.originalQualification,
      supplementClosures: closures,
      supplementPlanSha256: expected.supplementPlan,
      supplementRootSha256: expected.supplementRoot,
    });
  const [
    terminalOriginalBytes,
    terminalPlanBytes,
    terminalGraphqlLock,
    terminalSupplementLock,
  ] = await Promise.all([
    readC6StableRegularFile(
      originalQualificationPath,
      "supplemented terminal original qualification",
    ),
    readC6StableRegularFile(
      supplementPlanPath,
      "supplemented terminal plan",
    ),
    buildC6AssetLock(graphqlRoot),
    buildC6AssetLock(supplementRoot),
  ]);
  if (
    !terminalOriginalBytes.equals(originalBytes) ||
    !terminalPlanBytes.equals(supplementPlanBytes) ||
    serializeC6AssetLock(terminalGraphqlLock) !==
      serializeC6AssetLock(graphqlLock) ||
    serializeC6AssetLock(terminalSupplementLock) !==
      serializeC6AssetLock(supplementLock)
  ) {
    throw new Error(
      "C6 supplemented qualification input changed during projection",
    );
  }
  const serialized =
    serializeC6RestIdentitySupplementedQualification(qualification);
  return {
    outputSha256: sha256(serialized),
    qualification,
  };
}

export async function materializeC6RestIdentitySupplementedQualification(
  input: Parameters<
    typeof buildC6RestIdentitySupplementedQualification
  >[0] & {
    outputPath: string;
  },
): Promise<{
  outputSha256: string;
  qualification: C6RestIdentitySupplementedQualification;
}> {
  const result = await buildC6RestIdentitySupplementedQualification(input);
  const outputPath = resolve(input.outputPath);
  await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 supplemented qualification output parent",
  );
  const handle = await open(outputPath, "wx", 0o644);
  try {
    await handle.writeFile(
      serializeC6RestIdentitySupplementedQualification(
        result.qualification,
      ),
      "utf8",
    );
  } finally {
    await handle.close();
  }
  return result;
}

export async function replayC6RestIdentitySupplementedQualification(
  input: Parameters<
    typeof buildC6RestIdentitySupplementedQualification
  >[0] & {
    expectedProjectionSha256: string;
    projectionPath: string;
  },
): Promise<{
  qualification: C6RestIdentitySupplementedQualification;
  reproduced: true;
}> {
  const expectedProjectionSha256 = sha256Schema.parse(
    input.expectedProjectionSha256,
  );
  const projectionPath = await assertC6NoSymlinkPathComponents(
    input.projectionPath,
    "C6 supplemented qualification projection",
  );
  const projectionBytes = await readC6StableRegularFile(
    projectionPath,
    "supplemented qualification projection",
  );
  if (sha256(projectionBytes) !== expectedProjectionSha256) {
    throw new Error(
      "C6 supplemented qualification projection hash mismatch",
    );
  }
  const result = await buildC6RestIdentitySupplementedQualification(input);
  if (
    serializeC6RestIdentitySupplementedQualification(
      result.qualification,
    ) !== projectionBytes.toString("utf8")
  ) {
    throw new Error(
      "C6 supplemented qualification projection replay mismatch",
    );
  }
  const terminalProjectionBytes = await readC6StableRegularFile(
    projectionPath,
    "supplemented terminal projection",
  );
  if (!terminalProjectionBytes.equals(projectionBytes)) {
    throw new Error(
      "C6 supplemented qualification projection changed during replay",
    );
  }
  return {
    qualification: result.qualification,
    reproduced: true,
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
      `C6 supplemented qualification missing ${label} ${path}`,
    );
  }
  const bytes = await readC6StableRegularFile(
    join(root, ...path.split("/")),
    `supplemented qualification ${label}`,
  );
  if (
    bytes.byteLength !== reference.bytes ||
    sha256(bytes) !== reference.sha256
  ) {
    throw new Error(
      `C6 supplemented qualification changed ${label} ${path}`,
    );
  }
  return bytes;
}

function assertSupplementTargetOrder(
  targets: readonly z.infer<typeof supplementTargetSchema>[],
): void {
  const directories = new Set<string>();
  for (const [index, target] of targets.entries()) {
    if (
      target.supplementOrder !== index + 1 ||
      directories.has(target.captureDirectory)
    ) {
      throw new Error(
        "C6 supplemented qualification supplement target order mismatch",
      );
    }
    directories.add(target.captureDirectory);
  }
}

function assertSupplementFileClosure(
  lock: C6AssetLock,
  targets: readonly z.infer<typeof supplementTargetSchema>[],
): void {
  const expected = ["capture.json"];
  for (const target of targets) {
    expected.push(
      `${target.captureDirectory}/manifest.json`,
      `${target.captureDirectory}/request.json`,
      `${target.captureDirectory}/response.json`,
    );
  }
  const actual = lock.files.map((file) => file.path).sort(compareStrings);
  if (
    JSON.stringify(actual) !==
      JSON.stringify(expected.sort(compareStrings))
  ) {
    throw new Error(
      "C6 supplemented qualification supplement file closure mismatch",
    );
  }
}

function captureMatchesTarget(
  capture: z.infer<typeof captureSchema>,
  target: z.infer<typeof supplementTargetSchema>,
): boolean {
  return (
    capture.anchorId === target.anchorId &&
    capture.canonicalAnchorId === target.canonicalAnchorId &&
    capture.captureDirectory === target.captureDirectory &&
    capture.originalCaptureOrder === target.originalCaptureOrder &&
    capture.pullNumber === target.pullNumber &&
    capture.supplementOrder === target.supplementOrder
  );
}

function assertOriginalCounts(
  original: z.infer<typeof originalQualificationSchema>,
  results: readonly z.infer<typeof resultSchema>[],
): void {
  if (
    results.length !== original.counts.targetCount ||
    results.some((result, index) => result.captureOrder !== index + 1)
  ) {
    throw new Error(
      "C6 supplemented qualification original order mismatch",
    );
  }
  const missing = results.filter((result) =>
    result.status === "missing-rest-closure"
  ).length;
  const exact = results.filter((result) =>
    result.status === "exact-structural-candidate"
  ).length;
  if (
    missing !== original.counts.missingClosureCount ||
    exact !== original.counts.exactStructuralCandidateCount ||
    results.length - missing !== original.counts.capturedClosureCount
  ) {
    throw new Error(
      "C6 supplemented qualification original count mismatch",
    );
  }
}

function groupCanonicalRepositories(
  anchors: readonly string[],
): Map<string, number> {
  const result = new Map<string, number>();
  for (const anchor of anchors) {
    const repository = normalizeAnchor(anchor).slice(
      0,
      normalizeAnchor(anchor).lastIndexOf("#"),
    );
    result.set(repository, (result.get(repository) ?? 0) + 1);
  }
  return result;
}

function normalizeAnchor(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^[^/#]+\/[^/#]+#[1-9]\d*$/u.test(normalized)) {
    throw new Error(
      `C6 supplemented qualification invalid anchor ${value}`,
    );
  }
  return normalized;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(
      `C6 supplemented qualification invalid ${label} JSON`,
    );
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
