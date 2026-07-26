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
const artifactReferenceSchema = z.object({
  bytes: z.number().int().nonnegative(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const planTargetSchema = z.object({
  anchorId: z.string().min(1),
  canonicalAnchorId: z.string().min(1),
  captureDirectory: z.string().min(1),
  captureOrder: z.number().int().positive(),
  owner: z.string().min(1),
  pullNumber: z.number().int().positive(),
  repository: z.string().min(1),
  resolvedIssueNumbers: z.array(z.number().int().positive()).min(1),
}).passthrough();
const capturePlanSchema = z.object({
  artifactKind: z.literal("c6-source-expansion-rest-capture-plan"),
  counts: z.object({
    targetCount: z.number().int().positive(),
  }).passthrough(),
  targets: z.array(planTargetSchema).min(1),
  schemaVersion: z.literal(1),
}).passthrough();
const manifestSchema = z.object({
  boundary: z.object({
    bearerAuthorizationHeaderSent: z.literal(true),
    cryptographicPlatformReceipt: z.literal(false),
    platformAuthenticationCryptographicallyProven: z.literal(false),
  }).passthrough(),
  input: z.object({
    owner: z.string().min(1),
    pullNumber: z.number().int().positive(),
    repository: z.string().min(1),
    resolvedIssueNumbers: z.array(z.number().int().positive()),
  }).strict(),
  requests: z.array(z.object({
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
    response: z.object({
      rawBody: artifactReferenceSchema,
      status: z.literal(200),
    }).passthrough(),
  }).passthrough()).min(1),
  responseClosureSha256: sha256Schema,
  schemaVersion: z.literal(1),
}).passthrough();
const restPullSchema = z.object({
  base: z.object({
    repo: z.object({
      full_name: z.string().min(3),
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
const restIssueSchema = z.object({
  comments: z.number().int().nonnegative(),
  number: z.number().int().positive(),
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

export interface C6ValidatedSourceExpansionRestClosure {
  captureManifestSha256: string;
  commits: C6ReviewPolicyCommit[];
  pullAuthor: string;
  reviews: C6ReviewPolicyReview[];
  reviewThreads: C6ReviewPolicyThread[];
}

export interface C6SourceExpansionRestQualification {
  artifactKind: "c6-source-expansion-rest-qualification";
  boundary: {
    acceptedEpisodeCount: 0;
    candidateManifestFrozen: false;
    captureAttemptCompletenessProven: false;
    codexRunReady: false;
    machineQualifiedEpisodeCount: 0;
    status: "exact-structural-screening-not-semantic-qualification";
  };
  counts: {
    capturedClosureCount: number;
    exactStructuralCandidateCount: number;
    exactStructuralRepositoryCount: number;
    missingClosureCount: number;
    repositoryCappedStructuralCeiling: number;
    targetCount: number;
  };
  inputs: {
    capturePlanSha256: string;
    graphqlRootSha256: string;
    restRootSha256: string;
  };
  results: Array<
    {
      anchorId: string;
      canonicalAnchorId: string;
      captureDirectory: string;
      captureOrder: number;
      status: "missing-rest-closure";
    } | {
      anchorId: string;
      canonicalAnchorId: string;
      captureDirectory: string;
      captureManifestSha256: string;
      captureOrder: number;
      exactEventCount: number;
      status: "no-exact-structural-sequence";
    } | {
      anchorId: string;
      canonicalAnchorId: string;
      captureDirectory: string;
      captureManifestSha256: string;
      captureOrder: number;
      exactEventCount: number;
      exactLineageIdentitySha256: string;
      exactSequence: NonNullable<
        ReturnType<typeof selectC6MinimumLinearReviewSequence>
      >["sequence"];
      status: "exact-structural-candidate";
    }
  >;
  schemaVersion: 1;
}

export function deriveC6SourceExpansionRestQualification(input: {
  capturePlanSha256: string;
  graphqlRootSha256: string;
  restRootSha256: string;
  targets: ReadonlyArray<{
    anchorId: string;
    canonicalAnchorId: string;
    captureDirectory: string;
    captureOrder: number;
  }>;
  validatedClosures: ReadonlyMap<
    string,
    C6ValidatedSourceExpansionRestClosure
  >;
}): C6SourceExpansionRestQualification {
  const capturePlanSha256 = sha256Schema.parse(input.capturePlanSha256);
  const graphqlRootSha256 = sha256Schema.parse(input.graphqlRootSha256);
  const restRootSha256 = sha256Schema.parse(input.restRootSha256);
  const targets = [...input.targets].sort(
    (left, right) => left.captureOrder - right.captureOrder,
  );
  assertTargetOrder(targets);
  const knownDirectories = new Set(
    targets.map((target) => target.captureDirectory),
  );
  for (const directory of input.validatedClosures.keys()) {
    if (!knownDirectories.has(directory)) {
      throw new Error(
        `C6 REST qualification unknown closure ${directory}`,
      );
    }
  }
  const results: C6SourceExpansionRestQualification["results"] =
    targets.map((target) => {
      const closure = input.validatedClosures.get(target.captureDirectory);
      if (closure === undefined) {
        return {
          ...target,
          status: "missing-rest-closure" as const,
        };
      }
      const events = projectC6StructuralReviewEvents({
        pullAuthor: closure.pullAuthor,
        reviews: closure.reviews,
        reviewThreads: closure.reviewThreads,
      });
      const exact = selectC6MinimumLinearReviewSequence({
        anchorId: target.canonicalAnchorId,
        commits: closure.commits,
        events,
      });
      if (exact === null) {
        return {
          ...target,
          captureManifestSha256: sha256Schema.parse(
            closure.captureManifestSha256,
          ),
          exactEventCount: events.length,
          status: "no-exact-structural-sequence" as const,
        };
      }
      return {
        ...target,
        captureManifestSha256: sha256Schema.parse(
          closure.captureManifestSha256,
        ),
        exactEventCount: events.length,
        exactLineageIdentitySha256: exact.lineageIdentitySha256,
        exactSequence: exact.sequence,
        status: "exact-structural-candidate" as const,
      };
    });
  const exact = results.filter(
    (result) => result.status === "exact-structural-candidate",
  );
  const byRepository = new Map<string, number>();
  for (const result of exact) {
    const repository = result.canonicalAnchorId.slice(
      0,
      result.canonicalAnchorId.lastIndexOf("#"),
    );
    byRepository.set(repository, (byRepository.get(repository) ?? 0) + 1);
  }
  return {
    artifactKind: "c6-source-expansion-rest-qualification",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      captureAttemptCompletenessProven: false,
      codexRunReady: false,
      machineQualifiedEpisodeCount: 0,
      status: "exact-structural-screening-not-semantic-qualification",
    },
    counts: {
      capturedClosureCount: input.validatedClosures.size,
      exactStructuralCandidateCount: exact.length,
      exactStructuralRepositoryCount: byRepository.size,
      missingClosureCount: results.filter(
        (result) => result.status === "missing-rest-closure",
      ).length,
      repositoryCappedStructuralCeiling: [...byRepository.values()].reduce(
        (sum, count) => sum + Math.min(REPOSITORY_CAP, count),
        0,
      ),
      targetCount: targets.length,
    },
    inputs: {
      capturePlanSha256,
      graphqlRootSha256,
      restRootSha256,
    },
    results,
    schemaVersion: 1,
  };
}

export function serializeC6SourceExpansionRestQualification(
  qualification: C6SourceExpansionRestQualification,
): string {
  return `${JSON.stringify(qualification, null, 2)}\n`;
}

export async function buildC6SourceExpansionRestQualification(input: {
  capturePlanPath: string;
  expectedCapturePlanSha256: string;
  expectedGraphqlRootSha256: string;
  expectedRestRootSha256: string;
  graphqlRoot: string;
  restRoot: string;
}): Promise<{
  outputSha256: string;
  qualification: C6SourceExpansionRestQualification;
}> {
  const expectedCapturePlanSha256 = sha256Schema.parse(
    input.expectedCapturePlanSha256,
  );
  const expectedGraphqlRootSha256 = sha256Schema.parse(
    input.expectedGraphqlRootSha256,
  );
  const expectedRestRootSha256 = sha256Schema.parse(
    input.expectedRestRootSha256,
  );
  const [capturePlanPath, graphqlRoot, restRoot] = await Promise.all([
    assertC6NoSymlinkPathComponents(
      input.capturePlanPath,
      "C6 REST qualification capture plan",
    ),
    assertC6NoSymlinkPathComponents(
      input.graphqlRoot,
      "C6 REST qualification GraphQL root",
    ),
    assertC6NoSymlinkPathComponents(
      input.restRoot,
      "C6 REST qualification REST root",
    ),
  ]);
  const [planBytes, graphqlLock, restLock] = await Promise.all([
    readC6StableRegularFile(
      capturePlanPath,
      "REST qualification capture plan",
    ),
    buildC6AssetLock(graphqlRoot),
    buildC6AssetLock(restRoot),
  ]);
  if (sha256(planBytes) !== expectedCapturePlanSha256) {
    throw new Error("C6 REST qualification capture plan hash mismatch");
  }
  if (graphqlLock.assetRootSha256 !== expectedGraphqlRootSha256) {
    throw new Error("C6 REST qualification GraphQL root hash mismatch");
  }
  if (restLock.assetRootSha256 !== expectedRestRootSha256) {
    throw new Error("C6 REST qualification REST root hash mismatch");
  }
  const plan = capturePlanSchema.parse(
    parseJson(planBytes, "capture plan"),
  );
  if (
    plan.targets.length !== plan.counts.targetCount
  ) {
    throw new Error("C6 REST qualification capture plan count mismatch");
  }
  const targets = [...plan.targets].sort(
    (left, right) => left.captureOrder - right.captureOrder,
  );
  assertTargetOrder(targets);
  const knownDirectories = new Set(
    targets.map((target) => target.captureDirectory),
  );
  const presentDirectories = new Set(
    restLock.files.map((file) => file.path.split("/", 1)[0]!),
  );
  for (const directory of presentDirectories) {
    if (!knownDirectories.has(directory)) {
      throw new Error(
        `C6 REST qualification unexpected capture ${directory}`,
      );
    }
  }
  const validatedClosures = new Map<
    string,
    C6ValidatedSourceExpansionRestClosure
  >();
  const restFiles = new Map(
    restLock.files.map((file) => [file.path, file]),
  );
  const graphqlFiles = new Map(
    graphqlLock.files.map((file) => [file.path, file]),
  );
  for (const target of targets) {
    if (!presentDirectories.has(target.captureDirectory)) {
      continue;
    }
    validatedClosures.set(
      target.captureDirectory,
      await validateCapturedClosure({
        graphqlFiles,
        graphqlRoot,
        restFiles,
        restRoot,
        target,
      }),
    );
  }
  const qualification = deriveC6SourceExpansionRestQualification({
    capturePlanSha256: expectedCapturePlanSha256,
    graphqlRootSha256: expectedGraphqlRootSha256,
    restRootSha256: expectedRestRootSha256,
    targets,
    validatedClosures,
  });
  const [terminalPlanBytes, terminalGraphqlLock, terminalRestLock] =
    await Promise.all([
      readC6StableRegularFile(
        capturePlanPath,
        "REST qualification terminal capture plan",
      ),
      buildC6AssetLock(graphqlRoot),
      buildC6AssetLock(restRoot),
    ]);
  if (
    !terminalPlanBytes.equals(planBytes) ||
    serializeC6AssetLock(terminalGraphqlLock) !==
      serializeC6AssetLock(graphqlLock) ||
    serializeC6AssetLock(terminalRestLock) !==
      serializeC6AssetLock(restLock)
  ) {
    throw new Error(
      "C6 REST qualification input closure changed during projection",
    );
  }
  const serialized =
    serializeC6SourceExpansionRestQualification(qualification);
  return {
    outputSha256: sha256(serialized),
    qualification,
  };
}

export async function materializeC6SourceExpansionRestQualification(input: {
  capturePlanPath: string;
  expectedCapturePlanSha256: string;
  expectedGraphqlRootSha256: string;
  expectedRestRootSha256: string;
  graphqlRoot: string;
  outputPath: string;
  restRoot: string;
}): Promise<{
  outputSha256: string;
  qualification: C6SourceExpansionRestQualification;
}> {
  const result = await buildC6SourceExpansionRestQualification(input);
  const serialized = serializeC6SourceExpansionRestQualification(
    result.qualification,
  );
  const outputPath = resolve(input.outputPath);
  await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 REST qualification output parent",
  );
  const handle = await open(outputPath, "wx", 0o644);
  try {
    await handle.writeFile(serialized, "utf8");
  } finally {
    await handle.close();
  }
  return result;
}

export async function replayC6SourceExpansionRestQualification(input: {
  capturePlanPath: string;
  expectedCapturePlanSha256: string;
  expectedGraphqlRootSha256: string;
  expectedProjectionSha256: string;
  expectedRestRootSha256: string;
  graphqlRoot: string;
  projectionPath: string;
  restRoot: string;
}): Promise<{
  projectionSha256: string;
  qualification: C6SourceExpansionRestQualification;
  reproduced: true;
}> {
  const expectedProjectionSha256 = sha256Schema.parse(
    input.expectedProjectionSha256,
  );
  const projectionPath = await assertC6NoSymlinkPathComponents(
    input.projectionPath,
    "C6 REST qualification projection",
  );
  const projectionBytes = await readC6StableRegularFile(
    projectionPath,
    "REST qualification projection",
  );
  if (sha256(projectionBytes) !== expectedProjectionSha256) {
    throw new Error("C6 REST qualification projection hash mismatch");
  }
  const result = await buildC6SourceExpansionRestQualification(input);
  const reproducedBytes = Buffer.from(
    serializeC6SourceExpansionRestQualification(result.qualification),
  );
  if (!projectionBytes.equals(reproducedBytes)) {
    throw new Error(
      "C6 REST qualification projection does not match recomputation",
    );
  }
  const terminalProjectionBytes = await readC6StableRegularFile(
    projectionPath,
    "REST qualification terminal projection",
  );
  if (!terminalProjectionBytes.equals(projectionBytes)) {
    throw new Error(
      "C6 REST qualification projection changed during replay",
    );
  }
  return {
    projectionSha256: result.outputSha256,
    qualification: result.qualification,
    reproduced: true,
  };
}

async function validateCapturedClosure(input: {
  graphqlFiles: ReadonlyMap<string, C6AssetLock["files"][number]>;
  graphqlRoot: string;
  restFiles: ReadonlyMap<string, C6AssetLock["files"][number]>;
  restRoot: string;
  target: z.infer<typeof planTargetSchema>;
}): Promise<C6ValidatedSourceExpansionRestClosure> {
  const manifestPath = `${input.target.captureDirectory}/manifest.json`;
  const manifestBytes = await readBoundFile(
    input.restRoot,
    manifestPath,
    input.restFiles,
    "REST manifest",
  );
  const rawManifest = parseJson(manifestBytes, "REST manifest");
  const manifest = manifestSchema.parse(rawManifest);
  if (
    manifestBytes.toString("utf8") !==
      `${JSON.stringify(rawManifest, null, 2)}\n` ||
    normalizeRepository(`${manifest.input.owner}/${manifest.input.repository}`) !==
      normalizeRepository(`${input.target.owner}/${input.target.repository}`) ||
    manifest.input.pullNumber !== input.target.pullNumber ||
    JSON.stringify(manifest.input.resolvedIssueNumbers) !==
      JSON.stringify(input.target.resolvedIssueNumbers)
  ) {
    throw new Error(
      `C6 REST qualification manifest mismatch ${input.target.anchorId}`,
    );
  }
  const expectedFiles = new Set(["manifest.json"]);
  const groups = new Map<string, unknown[]>();
  const references = [];
  for (const request of manifest.requests) {
    const relativePath = request.response.rawBody.path;
    const fullPath = `${input.target.captureDirectory}/${relativePath}`;
    const bytes = await readBoundFile(
      input.restRoot,
      fullPath,
      input.restFiles,
      "REST response",
    );
    if (
      bytes.byteLength !== request.response.rawBody.bytes ||
      sha256(bytes) !== request.response.rawBody.sha256 ||
      expectedFiles.has(relativePath)
    ) {
      throw new Error(
        `C6 REST qualification response mismatch ${input.target.anchorId}`,
      );
    }
    expectedFiles.add(relativePath);
    references.push(request.response.rawBody);
    const key = `${request.endpoint}:${request.issueNumber ?? "none"}`;
    const group = groups.get(key) ?? [];
    const value = parseJson(bytes, `REST response ${relativePath}`);
    if (request.page === null) {
      if (group.length > 0) {
        throw new Error(
          `C6 REST qualification duplicate singleton ${
            input.target.anchorId
          }`,
        );
      }
      group.push(value);
    } else {
      if (!Array.isArray(value) || request.page !== group.length + 1) {
        throw new Error(
          `C6 REST qualification pagination mismatch ${
            input.target.anchorId
          }`,
        );
      }
      group.push(...value);
    }
    groups.set(key, group);
  }
  const actualFiles = [...input.restFiles.keys()]
    .filter((path) => path.startsWith(`${input.target.captureDirectory}/`))
    .map((path) => path.slice(input.target.captureDirectory.length + 1))
    .sort(compareStrings);
  if (
    JSON.stringify(actualFiles) !==
      JSON.stringify([...expectedFiles].sort(compareStrings)) ||
    manifest.responseClosureSha256 !== sha256(JSON.stringify(references))
  ) {
    throw new Error(
      `C6 REST qualification file closure mismatch ${
        input.target.anchorId
      }`,
    );
  }
  const pull = restPullSchema.parse(
    singleton(groups, "pull:none", input.target.anchorId),
  );
  const commits = arrayGroup(groups, "commits:none", input.target.anchorId)
    .map((value) => restCommitSchema.parse(value));
  const reviews = arrayGroup(
    groups,
    "reviews:none",
    input.target.anchorId,
  );
  const reviewComments = arrayGroup(
    groups,
    "review-comments:none",
    input.target.anchorId,
  );
  const discussionComments = arrayGroup(
    groups,
    `pull-discussion-comments:${input.target.pullNumber}`,
    input.target.anchorId,
  );
  if (
    pull.number !== input.target.pullNumber ||
    pull.commits !== commits.length ||
    pull.review_comments !== reviewComments.length ||
    pull.comments !== discussionComments.length
  ) {
    throw new Error(
      `C6 REST qualification pull count mismatch ${input.target.anchorId}`,
    );
  }
  for (const issueNumber of input.target.resolvedIssueNumbers) {
    const issue = restIssueSchema.parse(
      singleton(groups, `issue:${issueNumber}`, input.target.anchorId),
    );
    const comments = arrayGroup(
      groups,
      `issue-comments:${issueNumber}`,
      input.target.anchorId,
    );
    if (issue.number !== issueNumber || issue.comments !== comments.length) {
      throw new Error(
        `C6 REST qualification issue count mismatch ${
          input.target.anchorId
        }`,
      );
    }
  }
  const graphqlPath =
    `${input.target.captureDirectory}/response.json`;
  const graphqlBytes = await readBoundFile(
    input.graphqlRoot,
    graphqlPath,
    input.graphqlFiles,
    "GraphQL response",
  );
  const graphql = graphqlResponseSchema.parse(
    parseJson(graphqlBytes, "GraphQL response"),
  );
  const graphqlPull = graphql.data.repository.pullRequest;
  if (
    graphqlPull.number !== input.target.pullNumber ||
    normalizeRepository(graphql.data.repository.nameWithOwner) !==
      normalizeRepository(pull.base.repo.full_name) ||
    pull.head.sha !== graphqlPull.headRefOid
  ) {
    throw new Error(
      `C6 REST qualification GraphQL identity mismatch ${
        input.target.anchorId
      }`,
    );
  }
  const graphqlCommits: C6ReviewPolicyCommit[] =
    graphqlPull.commits.nodes.filter(isPresent).map((node) => ({
      committedAt: node.commit.committedDate,
      oid: node.commit.oid,
      parents: node.commit.parents.nodes.filter(isPresent).map(
        (parent) => parent.oid,
      ),
    }));
  const restCommits: C6ReviewPolicyCommit[] = commits.map((commit) => ({
    committedAt: commit.commit.committer.date,
    oid: commit.sha,
    parents: commit.parents.map((parent) => parent.sha),
  }));
  if (JSON.stringify(restCommits) !== JSON.stringify(graphqlCommits)) {
    throw new Error(
      `C6 REST qualification commit closure mismatch ${
        input.target.anchorId
      }`,
    );
  }
  return {
    captureManifestSha256: sha256(manifestBytes),
    commits: graphqlCommits,
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
    throw new Error(`C6 REST qualification missing ${label} ${path}`);
  }
  const bytes = await readC6StableRegularFile(
    join(root, ...path.split("/")),
    `REST qualification ${label}`,
  );
  if (
    bytes.byteLength !== reference.bytes ||
    sha256(bytes) !== reference.sha256
  ) {
    throw new Error(`C6 REST qualification changed ${label} ${path}`);
  }
  return bytes;
}

function singleton(
  groups: ReadonlyMap<string, unknown[]>,
  key: string,
  anchorId: string,
): unknown {
  const group = groups.get(key);
  if (group === undefined || group.length !== 1) {
    throw new Error(
      `C6 REST qualification requires one ${key} ${anchorId}`,
    );
  }
  return group[0];
}

function arrayGroup(
  groups: ReadonlyMap<string, unknown[]>,
  key: string,
  anchorId: string,
): unknown[] {
  const group = groups.get(key);
  if (group === undefined) {
    throw new Error(
      `C6 REST qualification missing ${key} ${anchorId}`,
    );
  }
  return group;
}

function assertTargetOrder(
  targets: ReadonlyArray<{
    canonicalAnchorId: string;
    captureDirectory: string;
    captureOrder: number;
  }>,
): void {
  const anchors = new Set<string>();
  const directories = new Set<string>();
  for (const [index, target] of targets.entries()) {
    if (target.captureOrder !== index + 1) {
      throw new Error(
        "C6 REST qualification target order must be contiguous",
      );
    }
    if (
      anchors.has(target.canonicalAnchorId) ||
      directories.has(target.captureDirectory)
    ) {
      throw new Error("C6 REST qualification duplicate target");
    }
    anchors.add(target.canonicalAnchorId);
    directories.add(target.captureDirectory);
  }
}

function normalizeRepository(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^[^/#]+\/[^/#]+$/u.test(normalized)) {
    throw new Error(`C6 REST qualification invalid repository ${value}`);
  }
  return normalized;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(`C6 REST qualification invalid ${label} JSON`);
  }
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
