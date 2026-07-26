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
  deriveC6ReviewerActorFilteredQualification,
  loadC6ReviewerActorReceiptClosure,
  serializeC6ReviewerActorFilteredQualification,
} from "./c6-reviewer-actor-filtered-qualification";
import type {
  C6ReviewerActorFilteredQualification,
  C6ReviewerActorQualificationClosure,
  C6ReviewerActorQualificationTarget,
} from "./c6-reviewer-actor-filtered-qualification";

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
  qualificationSource: z.enum([
    "full-rest-v1",
    "pull-identity-supplement-v1",
  ]),
  source: sourceSchema,
  status: z.enum([
    "exact-structural-candidate",
    "no-exact-structural-sequence",
  ]),
}).passthrough();
const qualificationSchema = z.object({
  artifactKind: z.literal(
    "c6-source-expansion-rest-qualification-v2",
  ),
  counts: z.object({
    targetCount: z.number().int().positive(),
  }).passthrough(),
  inputs: z.object({
    graphqlRootSha256: sha256Schema,
    originalRestRootSha256: sha256Schema,
    supplementRootSha256: sha256Schema,
  }).passthrough(),
  results: z.array(resultSchema).min(1),
  schemaVersion: z.literal(2),
}).passthrough();
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
const pullSchema = z.object({
  base: z.object({
    repo: z.object({
      full_name: z.string().min(3),
    }).passthrough(),
  }).passthrough(),
  number: z.number().int().positive(),
  user: z.object({
    login: z.string().min(1),
  }).passthrough(),
}).passthrough();

export interface C6RestActorQualificationInputResult {
  anchorId: string;
  canonicalAnchorId: string;
  captureDirectory: string;
  captureOrder: number;
  source: {
    path: string;
    rowIndex: number;
    rowSha256: string;
  };
  status:
    | "exact-structural-candidate"
    | "no-exact-structural-sequence";
}

export function projectC6RestReviewerActorQualificationTargets(input: {
  pullAuthors: ReadonlyMap<string, string>;
  results: readonly C6RestActorQualificationInputResult[];
}): C6ReviewerActorQualificationTarget[] {
  return input.results.map((result) => {
    const pullAuthor = input.pullAuthors.get(result.captureDirectory);
    if (pullAuthor === undefined) {
      throw new Error(
        `C6 REST actor qualification missing pull author ${
          result.captureDirectory
        }`,
      );
    }
    const canonicalAnchorId = normalizeAnchor(
      result.canonicalAnchorId,
    );
    return {
      canonicalAnchorId,
      canonicalRepository: parseAnchor(canonicalAnchorId).repository,
      captureDirectory: result.captureDirectory,
      captureOrder: result.captureOrder,
      pullAuthor,
      requestedAnchorId: normalizeAnchor(result.anchorId),
      source: result.source,
      status: result.status,
    };
  });
}

export async function buildC6RestReviewerActorFilteredQualification(
  input: {
    actorPlanPath: string;
    actorRoot: string;
    baseQualificationPath: string;
    expectedActorPlanSha256: string;
    expectedActorRootSha256: string;
    expectedBaseQualificationSha256: string;
    expectedGraphqlRootSha256: string;
    expectedOriginalRestRootSha256: string;
    expectedSupplementRootSha256: string;
    graphqlRoot: string;
    originalRestRoot: string;
    supplementRoot: string;
    testHooks?: {
      beforeTerminalVerification?: () => Promise<void> | void;
    };
  },
): Promise<{
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
    originalRestRoot: sha256Schema.parse(
      input.expectedOriginalRestRootSha256,
    ),
    supplementRoot: sha256Schema.parse(
      input.expectedSupplementRootSha256,
    ),
  };
  const [
    baseQualificationPath,
    graphqlRoot,
    originalRestRoot,
    supplementRoot,
  ] = await Promise.all([
    assertC6NoSymlinkPathComponents(
      input.baseQualificationPath,
      "C6 REST actor qualification base",
    ),
    assertC6NoSymlinkPathComponents(
      input.graphqlRoot,
      "C6 REST actor qualification GraphQL root",
    ),
    assertC6NoSymlinkPathComponents(
      input.originalRestRoot,
      "C6 REST actor qualification original REST root",
    ),
    assertC6NoSymlinkPathComponents(
      input.supplementRoot,
      "C6 REST actor qualification supplement root",
    ),
  ]);
  const [
    baseBytes,
    graphqlLock,
    originalRestLock,
    supplementLock,
    actorClosure,
  ] = await Promise.all([
    readC6StableRegularFile(
      baseQualificationPath,
      "REST actor qualification base",
    ),
    buildC6AssetLock(graphqlRoot),
    buildC6AssetLock(originalRestRoot),
    buildC6AssetLock(supplementRoot),
    loadC6ReviewerActorReceiptClosure({
      actorPlanPath: input.actorPlanPath,
      actorRoot: input.actorRoot,
      expectedActorPlanSha256: expected.actorPlan,
      expectedActorRootSha256: expected.actorRoot,
      expectedBaseQualificationSha256: expected.baseQualification,
      expectedGraphqlRootSha256: expected.graphqlRoot,
    }),
  ]);
  if (
    sha256(baseBytes) !== expected.baseQualification ||
    graphqlLock.assetRootSha256 !== expected.graphqlRoot ||
    originalRestLock.assetRootSha256 !== expected.originalRestRoot ||
    supplementLock.assetRootSha256 !== expected.supplementRoot
  ) {
    throw new Error(
      "C6 REST actor qualification input hash mismatch",
    );
  }
  const qualification = qualificationSchema.parse(
    parseJson(baseBytes, "base qualification"),
  );
  if (
    qualification.inputs.graphqlRootSha256 !== expected.graphqlRoot ||
    qualification.inputs.originalRestRootSha256 !==
      expected.originalRestRoot ||
    qualification.inputs.supplementRootSha256 !==
      expected.supplementRoot ||
    qualification.results.length !== qualification.counts.targetCount ||
    actorClosure.counts.sourceTargetCount !==
      qualification.results.length
  ) {
    throw new Error(
      "C6 REST actor qualification input binding mismatch",
    );
  }
  assertResultOrder(qualification.results);
  const graphqlFiles = new Map(
    graphqlLock.files.map((file) => [file.path, file]),
  );
  const originalRestFiles = new Map(
    originalRestLock.files.map((file) => [file.path, file]),
  );
  const supplementFiles = new Map(
    supplementLock.files.map((file) => [file.path, file]),
  );
  const pullAuthors = new Map<string, string>();
  const closures = new Map<
    string,
    C6ReviewerActorQualificationClosure
  >();
  const observedAuthors: string[] = [];
  for (const result of qualification.results) {
    const anchor = parseAnchor(result.canonicalAnchorId);
    const pullBytes = result.qualificationSource === "full-rest-v1"
      ? await readBoundFile(
        originalRestRoot,
        `${result.captureDirectory}/responses/pull.json`,
        originalRestFiles,
        "original pull response",
      )
      : await readBoundFile(
        supplementRoot,
        `${result.captureDirectory}/response.json`,
        supplementFiles,
        "supplement pull response",
      );
    const pull = pullSchema.parse(
      parseJson(pullBytes, "pull response"),
    );
    if (
      normalizeRepository(pull.base.repo.full_name) !==
        anchor.repository ||
      pull.number !== anchor.pullNumber
    ) {
      throw new Error(
        `C6 REST actor qualification pull identity mismatch ${
          result.canonicalAnchorId
        }`,
      );
    }
    pullAuthors.set(result.captureDirectory, pull.user.login);

    const graphqlBytes = await readBoundFile(
      graphqlRoot,
      `${result.captureDirectory}/response.json`,
      graphqlFiles,
      "GraphQL response",
    );
    const response = graphqlSchema.parse(
      parseJson(graphqlBytes, "GraphQL response"),
    );
    const graphqlPull = response.data.repository.pullRequest;
    if (
      normalizeRepository(response.data.repository.nameWithOwner) !==
        anchor.repository ||
      graphqlPull.number !== anchor.pullNumber
    ) {
      throw new Error(
        `C6 REST actor qualification GraphQL identity mismatch ${
          result.canonicalAnchorId
        }`,
      );
    }
    const reviews = graphqlPull.reviews.nodes.filter(isPresent).map(
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
    const reviewThreads = graphqlPull.reviewThreads.nodes
      .filter(isPresent)
      .map((thread) => ({
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
      }));
    closures.set(result.captureDirectory, {
      commits: graphqlPull.commits.nodes.filter(isPresent).map(
        (node) => ({
          committedAt: node.commit.committedDate,
          oid: node.commit.oid,
          parents: node.commit.parents.nodes.filter(isPresent).map(
            (parent) => parent.oid,
          ),
        }),
      ),
      reviews,
      reviewThreads,
    });
  }
  const observedLogins = [...new Set(
    observedAuthors.map(normalizeLogin),
  )].sort(compareStrings);
  if (
    JSON.stringify(observedLogins) !==
      JSON.stringify(
        actorClosure.targets.map((target) => target.login),
      ) ||
    observedAuthors.length !==
      actorClosure.counts.sourceReviewReferenceCount
  ) {
    throw new Error(
      "C6 REST actor qualification actor plan is not the complete author closure",
    );
  }
  const result = deriveC6ReviewerActorFilteredQualification({
    actorPlanSha256: expected.actorPlan,
    actorRootSha256: expected.actorRoot,
    actors: actorClosure.actors,
    baseQualificationSha256: expected.baseQualification,
    closures,
    graphqlRootSha256: expected.graphqlRoot,
    pullAuthorRoots: {
      originalRestRootSha256: expected.originalRestRoot,
      supplementRootSha256: expected.supplementRoot,
    },
    targets: projectC6RestReviewerActorQualificationTargets({
      pullAuthors,
      results: qualification.results,
    }),
  });

  await input.testHooks?.beforeTerminalVerification?.();
  const [
    terminalBaseBytes,
    terminalGraphqlLock,
    terminalOriginalRestLock,
    terminalSupplementLock,
    terminalActorClosure,
  ] = await Promise.all([
    readC6StableRegularFile(
      baseQualificationPath,
      "REST actor qualification terminal base",
    ),
    buildC6AssetLock(graphqlRoot),
    buildC6AssetLock(originalRestRoot),
    buildC6AssetLock(supplementRoot),
    loadC6ReviewerActorReceiptClosure({
      actorPlanPath: input.actorPlanPath,
      actorRoot: input.actorRoot,
      expectedActorPlanSha256: expected.actorPlan,
      expectedActorRootSha256: expected.actorRoot,
      expectedBaseQualificationSha256: expected.baseQualification,
      expectedGraphqlRootSha256: expected.graphqlRoot,
    }),
  ]);
  if (
    !terminalBaseBytes.equals(baseBytes) ||
    serializeC6AssetLock(terminalGraphqlLock) !==
      serializeC6AssetLock(graphqlLock) ||
    serializeC6AssetLock(terminalOriginalRestLock) !==
      serializeC6AssetLock(originalRestLock) ||
    serializeC6AssetLock(terminalSupplementLock) !==
      serializeC6AssetLock(supplementLock) ||
    terminalActorClosure.counts.sourceReviewReferenceCount !==
      actorClosure.counts.sourceReviewReferenceCount ||
    terminalActorClosure.counts.sourceTargetCount !==
      actorClosure.counts.sourceTargetCount
  ) {
    throw new Error(
      "C6 REST actor qualification input closure changed during projection",
    );
  }
  const serialized =
    serializeC6ReviewerActorFilteredQualification(result);
  return {
    outputSha256: sha256(serialized),
    qualification: result,
  };
}

export async function materializeC6RestReviewerActorFilteredQualification(
  input: Parameters<
    typeof buildC6RestReviewerActorFilteredQualification
  >[0] & {
    outputPath: string;
  },
): Promise<{
  outputSha256: string;
  qualification: C6ReviewerActorFilteredQualification;
}> {
  const result =
    await buildC6RestReviewerActorFilteredQualification(input);
  const outputPath = resolve(input.outputPath);
  await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 REST actor qualification output parent",
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

export async function replayC6RestReviewerActorFilteredQualification(
  input: Parameters<
    typeof buildC6RestReviewerActorFilteredQualification
  >[0] & {
    expectedProjectionSha256: string;
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
    "C6 REST actor qualification projection",
  );
  const projectionBytes = await readC6StableRegularFile(
    projectionPath,
    "REST actor qualification projection",
  );
  if (sha256(projectionBytes) !== expectedProjectionSha256) {
    throw new Error(
      "C6 REST actor qualification projection hash mismatch",
    );
  }
  const result =
    await buildC6RestReviewerActorFilteredQualification(input);
  if (
    serializeC6ReviewerActorFilteredQualification(
      result.qualification,
    ) !== projectionBytes.toString("utf8")
  ) {
    throw new Error(
      "C6 REST actor qualification projection does not match recomputation",
    );
  }
  const terminalProjectionBytes = await readC6StableRegularFile(
    projectionPath,
    "REST actor qualification terminal projection",
  );
  if (!terminalProjectionBytes.equals(projectionBytes)) {
    throw new Error(
      "C6 REST actor qualification projection changed during replay",
    );
  }
  return { qualification: result.qualification, reproduced: true };
}

function assertResultOrder(
  results: readonly z.infer<typeof resultSchema>[],
): void {
  const directories = new Set<string>();
  for (const [index, result] of results.entries()) {
    if (
      result.captureOrder !== index + 1 ||
      directories.has(result.captureDirectory)
    ) {
      throw new Error(
        "C6 REST actor qualification result order mismatch",
      );
    }
    directories.add(result.captureDirectory);
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
      `C6 REST actor qualification missing ${label} ${path}`,
    );
  }
  const bytes = await readC6StableRegularFile(
    join(root, ...path.split("/")),
    `REST actor qualification ${label}`,
  );
  if (
    bytes.byteLength !== reference.bytes ||
    sha256(bytes) !== reference.sha256
  ) {
    throw new Error(
      `C6 REST actor qualification changed ${label} ${path}`,
    );
  }
  return bytes;
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
      `C6 REST actor qualification invalid anchor ${value}`,
    );
  }
  return `${normalizeRepository(match[1]!)}#${match[2]}`;
}

function normalizeRepository(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^[^/#\s]+\/[^/#\s]+$/u.test(normalized)) {
    throw new Error(
      `C6 REST actor qualification invalid repository ${value}`,
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
      `C6 REST actor qualification invalid login ${value}`,
    );
  }
  return value.toLowerCase();
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(
      `C6 REST actor qualification invalid ${label} JSON`,
    );
  }
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
