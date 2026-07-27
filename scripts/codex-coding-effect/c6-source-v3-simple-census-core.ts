import { createHash } from "node:crypto";

import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  classifyC6Wave3Pretarget,
} from "./c6-wave3-pretarget-policy";
import type {
  C6Wave3PretargetDecisionReason,
} from "./c6-wave3-pretarget-policy";
import type {
  C6Wave3SourceUniverseV2,
} from "./c6-wave3-source-universe-v2";

export const C6_SOURCE_V3_SIMPLE_ACCESSIBLE_RESULT_CAP =
  1_000 as const;
export const C6_SOURCE_V3_SIMPLE_PAGE_SIZE = 100 as const;
export const C6_SOURCE_V3_SIMPLE_ROOT_SHARD_COUNT =
  1_536 as const;
export const C6_SOURCE_V3_SIMPLE_PULL_REQUEST_LOWER_BOUND =
  "2022-01-01T00:00:00Z" as const;
export const C6_SOURCE_V3_SIMPLE_PULL_REQUEST_UPPER_BOUND =
  "2025-12-31T23:59:59Z" as const;

const utcSecondSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u,
);
const repositorySchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
);
const nonEmptyStringSchema = z.string().min(1);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const pageInfoSchema = z.object({
  endCursor: z.string().min(1).nullable(),
  hasNextPage: z.boolean(),
}).strict();
const repositoryNodeSchema = z.object({
  createdAt: utcSecondSchema,
  id: nonEmptyStringSchema,
  isArchived: z.boolean(),
  isFork: z.boolean(),
  isMirror: z.boolean(),
  isTemplate: z.boolean(),
  nameWithOwner: repositorySchema,
  primaryLanguage: z.object({
    name: nonEmptyStringSchema,
  }).strict().nullable(),
  pushedAt: utcSecondSchema.nullable(),
  visibility: z.string().min(1),
}).strict();
const repositoryPageSchema = z.object({
  nodes: z.array(repositoryNodeSchema).max(
    C6_SOURCE_V3_SIMPLE_PAGE_SIZE,
  ),
  pageInfo: pageInfoSchema,
  repositoryCount: z.number().int().nonnegative(),
}).strict();
const normalizedRepositoryRowSchema =
  repositoryNodeSchema.extend({
    leafCreatedFrom: utcSecondSchema,
    leafCreatedTo: utcSecondSchema,
    repositoryNodeId: nonEmptyStringSchema,
    rootShardId: nonEmptyStringSchema,
    sourceSplit: z.enum([
      "c",
      "cpp",
      "go",
      "js",
      "rust",
      "java",
      "ts",
      "cs",
    ]),
  }).strict();
const pullRequestNodeSchema = z.object({
  author: z.object({
    login: nonEmptyStringSchema,
  }).strict().nullable(),
  baseRefOid: commitSchema,
  commits: z.object({
    totalCount: z.number().int().nonnegative(),
  }).strict(),
  createdAt: utcSecondSchema,
  id: nonEmptyStringSchema,
  mergeCommit: z.object({
    oid: commitSchema,
  }).strict().nullable(),
  mergedAt: utcSecondSchema,
  number: z.number().int().positive(),
  reviews: z.object({
    totalCount: z.number().int().nonnegative(),
  }).strict(),
  reviewThreads: z.object({
    totalCount: z.number().int().nonnegative(),
  }).strict(),
  url: z.url(),
}).strict();
const pullRequestPageSchema = z.object({
  nodes: z.array(pullRequestNodeSchema).max(
    C6_SOURCE_V3_SIMPLE_PAGE_SIZE,
  ),
  pageInfo: pageInfoSchema,
  repositoryNameWithOwner: repositorySchema,
  repositoryNodeId: nonEmptyStringSchema,
  totalCount: z.number().int().nonnegative(),
}).strict();
const normalizedPullRequestRowSchema = z.object({
  authorLogin: nonEmptyStringSchema.nullable(),
  baseRefOid: commitSchema,
  canonicalAnchorId: z.string().regex(
    /^[a-z0-9_.-]+\/[a-z0-9_.-]+#[1-9]\d*$/u,
  ),
  canonicalRepository: z.string().regex(
    /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/u,
  ),
  commitTotalCount: z.number().int().nonnegative(),
  createdAt: utcSecondSchema,
  mergeCommitOid: commitSchema.nullable(),
  mergedAt: utcSecondSchema,
  number: z.number().int().positive(),
  pullRequestNodeId: nonEmptyStringSchema,
  repositoryNodeId: nonEmptyStringSchema,
  reviewCount: z.number().int().nonnegative(),
  reviewThreadCount: z.number().int().nonnegative(),
  url: z.url(),
}).strict();

const LANGUAGE_SPLITS = [
  "c",
  "cpp",
  "go",
  "js",
  "rust",
  "java",
  "ts",
  "cs",
] as const;

export type C6SourceV3SimpleSplit =
  typeof LANGUAGE_SPLITS[number];

const rootShardSchema = z.object({
  createdFrom: utcSecondSchema,
  createdTo: utcSecondSchema,
  language: nonEmptyStringSchema,
  query: nonEmptyStringSchema,
  rootShardId: nonEmptyStringSchema,
  split: z.enum(LANGUAGE_SPLITS),
}).strict();
const frameDefinitionSchema = z.object({
  frozenPreWave3AnchorExclusions:
    z.array(nonEmptyStringSchema),
  frozenPreWave3RepositoryExclusions:
    z.array(nonEmptyStringSchema),
  priorRepositoryAliases:
    z.array(nonEmptyStringSchema),
  priorRepositoryNodeIds:
    z.array(nonEmptyStringSchema),
  rootShards: z.array(rootShardSchema),
}).strict();

export interface C6SourceV3SimpleRootShard {
  createdFrom: string;
  createdTo: string;
  language: string;
  query: string;
  rootShardId: string;
  split: C6SourceV3SimpleSplit;
}

export interface C6SourceV3SimpleCountProbeRequest {
  createdFrom: string;
  createdTo: string;
  query: string;
  rootShardId: string;
}

export interface C6SourceV3SimpleCountTreeNode {
  count: number;
  createdFrom: string;
  createdTo: string;
  depth: number;
  leaf: boolean;
  query: string;
}

export interface C6SourceV3SimpleCountTreeLeaf
  extends C6SourceV3SimpleCountTreeNode {
  leaf: true;
}

export interface C6SourceV3SimpleCountTree {
  leaves: C6SourceV3SimpleCountTreeLeaf[];
  nodes: C6SourceV3SimpleCountTreeNode[];
  rootShardId: string;
}

export type C6SourceV3SimpleRepositoryNode = z.infer<
  typeof repositoryNodeSchema
>;

export interface C6SourceV3SimpleRepositoryPageRequest {
  afterCursor: string | null;
  leaf: C6SourceV3SimpleCountTreeLeaf;
  query: string;
  rootShard: C6SourceV3SimpleRootShard;
}

export type C6SourceV3SimpleRepositoryPage = z.infer<
  typeof repositoryPageSchema
>;

export interface C6SourceV3SimpleRepositoryRow
  extends C6SourceV3SimpleRepositoryNode {
  leafCreatedFrom: string;
  leafCreatedTo: string;
  repositoryNodeId: string;
  rootShardId: string;
  sourceSplit: C6SourceV3SimpleSplit;
}

export type C6SourceV3SimpleRepositoryDecisionReason =
  | "prior-repository-alias"
  | "prior-repository-node-id";

export interface C6SourceV3SimpleRepositoryDecision {
  accepted: boolean;
  canonicalRepository: string;
  reasons: C6SourceV3SimpleRepositoryDecisionReason[];
  repositoryNodeId: string;
}

export interface C6SourceV3SimpleRepositoryLeafClosure {
  expectedRepositoryCount: number;
  leafCreatedFrom: string;
  leafCreatedTo: string;
  pageCount: number;
  rootShardId: string;
  terminalReason:
    | "connection-exhausted"
    | "zero-count-leaf";
}

export type C6SourceV3SimplePullRequestNode = z.infer<
  typeof pullRequestNodeSchema
>;

export interface C6SourceV3SimplePullRequestPageRequest {
  afterCursor: string | null;
  repository: C6SourceV3SimpleRepositoryNode;
}

export type C6SourceV3SimplePullRequestPage = z.infer<
  typeof pullRequestPageSchema
>;

export interface C6SourceV3SimplePullRequestRow {
  authorLogin: string | null;
  baseRefOid: string;
  canonicalAnchorId: string;
  canonicalRepository: string;
  commitTotalCount: number;
  createdAt: string;
  mergeCommitOid: string | null;
  mergedAt: string;
  number: number;
  pullRequestNodeId: string;
  repositoryNodeId: string;
  reviewCount: number;
  reviewThreadCount: number;
  url: string;
}

export interface C6SourceV3SimplePullRequestClosure {
  canonicalRepository: string;
  enumeratedInWindowCount: number;
  pageCount: number;
  repositoryNodeId: string;
  skippedAboveUpperBoundCount: number;
  terminalReason:
    | "connection-exhausted"
    | "strictly-older-createdAt-witness";
  totalMergedPullRequestCount: number;
}

export interface C6SourceV3SimpleMetadataDecision {
  accepted: boolean;
  canonicalAnchorId: string;
  canonicalRepository: string;
  pullRequestNodeId: string;
  reasons: C6Wave3PretargetDecisionReason[];
}

export interface C6SourceV3SimpleNormalizedPass {
  countTrees: C6SourceV3SimpleCountTree[];
  metadataDecisions: C6SourceV3SimpleMetadataDecision[];
  pullRequestClosures: C6SourceV3SimplePullRequestClosure[];
  pullRequests: C6SourceV3SimplePullRequestRow[];
  repositoryDecisions: C6SourceV3SimpleRepositoryDecision[];
  repositoryLeafClosures:
    C6SourceV3SimpleRepositoryLeafClosure[];
  repositories: C6SourceV3SimpleRepositoryRow[];
}

const countTreeNodeSchema = z.object({
  count: z.number().int().nonnegative(),
  createdFrom: utcSecondSchema,
  createdTo: utcSecondSchema,
  depth: z.number().int().nonnegative(),
  leaf: z.boolean(),
  query: nonEmptyStringSchema,
}).strict();
const countTreeLeafSchema =
  countTreeNodeSchema.extend({
    leaf: z.literal(true),
  }).strict();
const countTreeSchema = z.object({
  leaves: z.array(countTreeLeafSchema).min(1),
  nodes: z.array(countTreeNodeSchema).min(1),
  rootShardId: nonEmptyStringSchema,
}).strict();
const repositoryDecisionSchema = z.object({
  accepted: z.boolean(),
  canonicalRepository: repositorySchema,
  reasons: z.array(z.enum([
    "prior-repository-alias",
    "prior-repository-node-id",
  ])),
  repositoryNodeId: nonEmptyStringSchema,
}).strict();
const repositoryLeafClosureSchema = z.object({
  expectedRepositoryCount:
    z.number().int().nonnegative(),
  leafCreatedFrom: utcSecondSchema,
  leafCreatedTo: utcSecondSchema,
  pageCount: z.number().int().nonnegative(),
  rootShardId: nonEmptyStringSchema,
  terminalReason: z.enum([
    "connection-exhausted",
    "zero-count-leaf",
  ]),
}).strict();
const pullRequestClosureSchema = z.object({
  canonicalRepository: repositorySchema,
  enumeratedInWindowCount:
    z.number().int().nonnegative(),
  pageCount: z.number().int().positive(),
  repositoryNodeId: nonEmptyStringSchema,
  skippedAboveUpperBoundCount:
    z.number().int().nonnegative(),
  terminalReason: z.enum([
    "connection-exhausted",
    "strictly-older-createdAt-witness",
  ]),
  totalMergedPullRequestCount:
    z.number().int().nonnegative(),
}).strict();
const metadataDecisionSchema = z.object({
  accepted: z.boolean(),
  canonicalAnchorId: z.string().regex(
    /^[a-z0-9_.-]+\/[a-z0-9_.-]+#[1-9]\d*$/u,
  ),
  canonicalRepository: z.string().regex(
    /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/u,
  ),
  pullRequestNodeId: nonEmptyStringSchema,
  reasons: z.array(z.enum([
    "canonical-pull-request-not-novel",
    "canonical-repository-not-novel",
    "commit-total-count-above-maximum",
    "review-count-below-minimum",
    "review-thread-count-below-minimum",
  ])),
}).strict();
const normalizedPassSchema = z.object({
  countTrees: z.array(countTreeSchema),
  metadataDecisions: z.array(metadataDecisionSchema),
  pullRequestClosures:
    z.array(pullRequestClosureSchema),
  pullRequests:
    z.array(normalizedPullRequestRowSchema),
  repositoryDecisions:
    z.array(repositoryDecisionSchema),
  repositoryLeafClosures:
    z.array(repositoryLeafClosureSchema),
  repositories:
    z.array(normalizedRepositoryRowSchema),
}).strict();

export interface C6SourceV3SimpleFrameDefinition {
  frozenPreWave3AnchorExclusions: readonly string[];
  frozenPreWave3RepositoryExclusions: readonly string[];
  priorRepositoryAliases: readonly string[];
  priorRepositoryNodeIds: readonly string[];
  rootShards: readonly C6SourceV3SimpleRootShard[];
}

export function parseC6SourceV3SimpleFrameDefinition(
  input: unknown,
): C6SourceV3SimpleFrameDefinition {
  const frame = frameDefinitionSchema.parse(input);
  assertFrameDefinition(frame);
  return frame;
}

export function verifyC6SourceV3SimpleNormalizedPass(
  input: unknown,
  frame: C6SourceV3SimpleFrameDefinition,
): C6SourceV3SimpleNormalizedPass {
  const pass = normalizedPassSchema.parse(input);
  assertFrameDefinition(frame);
  assertNormalizedPass(pass, frame);
  return pass;
}

export function deriveC6SourceV3SimpleRootShards(
  sourceUniverse: C6Wave3SourceUniverseV2,
): C6SourceV3SimpleRootShard[] {
  const shards = sourceUniverse.repositoryUniverse.languageSplits
    .flatMap((languageSplit) =>
      languageSplit.rootShards.map((rootShard) => ({
        createdFrom: rootShard.createdFrom,
        createdTo: rootShard.createdTo,
        language: languageSplit.language,
        query: rootShard.query,
        rootShardId: rootShard.rootShardId,
        split: languageSplit.split,
      }))
    )
    .sort((left, right) =>
      compareUtf8(left.rootShardId, right.rootShardId)
    );
  if (
    shards.length !==
      sourceUniverse.repositoryUniverse.rootShardCount ||
    new Set(shards.map((shard) => shard.rootShardId)).size !==
      shards.length
  ) {
    throw new Error(
      "C6 source-v3-simple root shard closure mismatch",
    );
  }
  return shards;
}

export async function buildC6SourceV3SimpleCountTree(input: {
  probe: (
    request: C6SourceV3SimpleCountProbeRequest,
  ) => Promise<number>;
  rootShard: C6SourceV3SimpleRootShard;
}): Promise<C6SourceV3SimpleCountTree> {
  const rootFrom = utcSeconds(
    input.rootShard.createdFrom,
    "root shard createdFrom",
  );
  const rootTo = utcSeconds(
    input.rootShard.createdTo,
    "root shard createdTo",
  );
  if (rootFrom > rootTo) {
    throw new Error(
      "C6 source-v3-simple root shard interval is reversed",
    );
  }
  const result = await collectCountTree({
    createdFromSeconds: rootFrom,
    createdToSeconds: rootTo,
    depth: 0,
    probe: input.probe,
    rootShard: input.rootShard,
  });
  return {
    leaves: result.leaves,
    nodes: result.nodes,
    rootShardId: input.rootShard.rootShardId,
  };
}

export async function enumerateC6SourceV3SimpleRepositories(
  input: {
    leaves: readonly C6SourceV3SimpleCountTreeLeaf[];
    page: (
      request: C6SourceV3SimpleRepositoryPageRequest,
    ) => Promise<C6SourceV3SimpleRepositoryPage>;
    rootShard: C6SourceV3SimpleRootShard;
  },
): Promise<{
  closures: C6SourceV3SimpleRepositoryLeafClosure[];
  rows: C6SourceV3SimpleRepositoryRow[];
}> {
  const seenNodeIds = new Set<string>();
  const closures: C6SourceV3SimpleRepositoryLeafClosure[] = [];
  const rows: C6SourceV3SimpleRepositoryRow[] = [];
  for (const leaf of input.leaves) {
    if (leaf.count === 0) {
      closures.push({
        expectedRepositoryCount: 0,
        leafCreatedFrom: leaf.createdFrom,
        leafCreatedTo: leaf.createdTo,
        pageCount: 0,
        rootShardId: input.rootShard.rootShardId,
        terminalReason: "zero-count-leaf",
      });
      continue;
    }
    let afterCursor: string | null = null;
    let collected = 0;
    let pageCount = 0;
    const seenCursors = new Set<string>();
    while (true) {
      const page = repositoryPageSchema.parse(
        await input.page({
          afterCursor,
          leaf,
          query: leaf.query,
          rootShard: input.rootShard,
        }),
      );
      pageCount += 1;
      if (page.repositoryCount !== leaf.count) {
        throw new Error(
          "C6 source-v3-simple repository count changed during pagination",
        );
      }
      for (const node of page.nodes) {
        assertRepositoryInLeaf(
          node,
          input.rootShard,
          leaf,
        );
        if (seenNodeIds.has(node.id)) {
          throw new Error(
            "C6 source-v3-simple duplicate repository node ID",
          );
        }
        seenNodeIds.add(node.id);
        rows.push({
          ...node,
          leafCreatedFrom: leaf.createdFrom,
          leafCreatedTo: leaf.createdTo,
          repositoryNodeId: node.id,
          rootShardId: input.rootShard.rootShardId,
          sourceSplit: input.rootShard.split,
        });
      }
      collected += page.nodes.length;
      if (collected > leaf.count) {
        throw new Error(
          "C6 source-v3-simple repository page count exceeds leaf count",
        );
      }
      if (!page.pageInfo.hasNextPage) {
        if (collected !== leaf.count) {
          throw new Error(
            "C6 source-v3-simple repository connection terminated before leaf count closure",
          );
        }
        closures.push({
          expectedRepositoryCount: leaf.count,
          leafCreatedFrom: leaf.createdFrom,
          leafCreatedTo: leaf.createdTo,
          pageCount,
          rootShardId: input.rootShard.rootShardId,
          terminalReason: "connection-exhausted",
        });
        break;
      }
      const nextCursor = page.pageInfo.endCursor;
      if (
        nextCursor === null ||
        seenCursors.has(nextCursor) ||
        page.nodes.length === 0 ||
        collected === leaf.count
      ) {
        throw new Error(
          "C6 source-v3-simple invalid repository cursor chain",
        );
      }
      seenCursors.add(nextCursor);
      afterCursor = nextCursor;
    }
  }
  return {
    closures,
    rows: rows.sort((left, right) =>
      compareUtf8(
        left.repositoryNodeId,
        right.repositoryNodeId,
      )
    ),
  };
}

export function classifyC6SourceV3SimpleRepositories(input: {
  observations: readonly C6SourceV3SimpleRepositoryRow[];
  priorRepositoryAliases: readonly string[];
  priorRepositoryNodeIds: readonly string[];
}): {
  decisions: C6SourceV3SimpleRepositoryDecision[];
  frameRepositories: C6SourceV3SimpleRepositoryRow[];
  repositories: C6SourceV3SimpleRepositoryRow[];
} {
  const priorAliases = new Set(
    input.priorRepositoryAliases.map(asciiCaseFold),
  );
  const priorNodeIds = new Set(
    input.priorRepositoryNodeIds,
  );
  const currentAliases = new Map<string, string>();
  const seenNodeIds = new Set<string>();
  const repositories = [...input.observations].sort(
    (left, right) =>
      compareUtf8(
        left.repositoryNodeId,
        right.repositoryNodeId,
      ),
  );
  const decisions = repositories.map((row) => {
    if (seenNodeIds.has(row.repositoryNodeId)) {
      throw new Error(
        "C6 source-v3-simple duplicate repository node ID across the frame",
      );
    }
    seenNodeIds.add(row.repositoryNodeId);
    const alias = asciiCaseFold(row.nameWithOwner);
    const priorCurrentNodeId = currentAliases.get(alias);
    if (
      priorCurrentNodeId !== undefined &&
      priorCurrentNodeId !== row.repositoryNodeId
    ) {
      throw new Error(
        "C6 source-v3-simple repository alias maps to multiple node IDs",
      );
    }
    currentAliases.set(alias, row.repositoryNodeId);
    const reasons: C6SourceV3SimpleRepositoryDecisionReason[] = [];
    if (priorNodeIds.has(row.repositoryNodeId)) {
      reasons.push("prior-repository-node-id");
    }
    if (priorAliases.has(alias)) {
      reasons.push("prior-repository-alias");
    }
    return {
      accepted: reasons.length === 0,
      canonicalRepository: alias,
      reasons,
      repositoryNodeId: row.repositoryNodeId,
    };
  });
  const acceptedNodeIds = new Set(
    decisions
      .filter((decision) => decision.accepted)
      .map((decision) => decision.repositoryNodeId),
  );
  return {
    decisions,
    frameRepositories: repositories.filter((row) =>
      acceptedNodeIds.has(row.repositoryNodeId)
    ),
    repositories,
  };
}

export async function enumerateC6SourceV3SimplePullRequests(
  input: {
    page: (
      request: C6SourceV3SimplePullRequestPageRequest,
    ) => Promise<C6SourceV3SimplePullRequestPage>;
    repository: C6SourceV3SimpleRepositoryNode;
  },
): Promise<{
  closure: C6SourceV3SimplePullRequestClosure;
  rows: C6SourceV3SimplePullRequestRow[];
}> {
  const repository = repositoryNodeSchema.parse(
    input.repository,
  );
  const seenNodeIds = new Set<string>();
  const seenNumbers = new Set<number>();
  const seenCursors = new Set<string>();
  const rows: C6SourceV3SimplePullRequestRow[] = [];
  let afterCursor: string | null = null;
  let pageCount = 0;
  let observedNodeCount = 0;
  let skippedAboveUpperBoundCount = 0;
  let totalCount: number | null = null;
  let priorCreatedAt: string | null = null;
  while (true) {
    const page = pullRequestPageSchema.parse(
      await input.page({
        afterCursor,
        repository,
      }),
    );
    pageCount += 1;
    if (
      page.repositoryNodeId !== repository.id ||
      page.repositoryNameWithOwner !==
        repository.nameWithOwner
    ) {
      throw new Error(
        "C6 source-v3-simple pull request repository identity drift",
      );
    }
    if (totalCount === null) {
      totalCount = page.totalCount;
    } else if (page.totalCount !== totalCount) {
      throw new Error(
        "C6 source-v3-simple pull request totalCount changed during pagination",
      );
    }
    let olderWitness = false;
    for (const node of page.nodes) {
      observedNodeCount += 1;
      if (
        priorCreatedAt !== null &&
        node.createdAt > priorCreatedAt
      ) {
        throw new Error(
          "C6 source-v3-simple pull requests are not ordered by createdAt descending",
        );
      }
      priorCreatedAt = node.createdAt;
      if (seenNodeIds.has(node.id)) {
        throw new Error(
          "C6 source-v3-simple duplicate pull request node ID",
        );
      }
      seenNodeIds.add(node.id);
      if (seenNumbers.has(node.number)) {
        throw new Error(
          "C6 source-v3-simple duplicate canonical pull request",
        );
      }
      seenNumbers.add(node.number);
      if (
        node.createdAt >
          C6_SOURCE_V3_SIMPLE_PULL_REQUEST_UPPER_BOUND
      ) {
        skippedAboveUpperBoundCount += 1;
        continue;
      }
      if (
        node.createdAt <
          C6_SOURCE_V3_SIMPLE_PULL_REQUEST_LOWER_BOUND
      ) {
        olderWitness = true;
        continue;
      }
      rows.push(normalizePullRequest(repository, node));
    }
    if (observedNodeCount > totalCount) {
      throw new Error(
        "C6 source-v3-simple pull request page count exceeds totalCount",
      );
    }
    if (
      page.pageInfo.hasNextPage &&
      (
        page.pageInfo.endCursor === null ||
        page.nodes.length === 0 ||
        observedNodeCount >= totalCount
      )
    ) {
      throw new Error(
        "C6 source-v3-simple invalid pull request cursor chain",
      );
    }
    if (olderWitness) {
      return {
        closure: {
          canonicalRepository: asciiCaseFold(
            repository.nameWithOwner,
          ),
          enumeratedInWindowCount: rows.length,
          pageCount,
          repositoryNodeId: repository.id,
          skippedAboveUpperBoundCount,
          terminalReason:
            "strictly-older-createdAt-witness",
          totalMergedPullRequestCount: totalCount,
        },
        rows: sortPullRequests(rows),
      };
    }
    if (!page.pageInfo.hasNextPage) {
      if (observedNodeCount !== totalCount) {
        throw new Error(
          "C6 source-v3-simple pull request connection exhausted without totalCount closure",
        );
      }
      return {
        closure: {
          canonicalRepository: asciiCaseFold(
            repository.nameWithOwner,
          ),
          enumeratedInWindowCount: rows.length,
          pageCount,
          repositoryNodeId: repository.id,
          skippedAboveUpperBoundCount,
          terminalReason: "connection-exhausted",
          totalMergedPullRequestCount: totalCount,
        },
        rows: sortPullRequests(rows),
      };
    }
    const nextCursor = page.pageInfo.endCursor;
    if (
      nextCursor === null ||
      seenCursors.has(nextCursor) ||
      page.nodes.length === 0
    ) {
      throw new Error(
        "C6 source-v3-simple invalid pull request cursor chain",
      );
    }
    seenCursors.add(nextCursor);
    afterCursor = nextCursor;
  }
}

export function classifyC6SourceV3SimplePullRequests(input: {
  frozenPreWave3AnchorExclusions: readonly string[];
  frozenPreWave3RepositoryExclusions: readonly string[];
  pullRequests: readonly C6SourceV3SimplePullRequestRow[];
}): C6SourceV3SimpleMetadataDecision[] {
  assertPullRequestRowsNormalized(input.pullRequests);
  return input.pullRequests.map((pullRequest) => {
    const result = classifyC6Wave3Pretarget({
      canonicalAnchorId: pullRequest.canonicalAnchorId,
      canonicalRepository:
        pullRequest.canonicalRepository,
      commitTotalCount: pullRequest.commitTotalCount,
      reviewCount: pullRequest.reviewCount,
      reviewThreadCount:
        pullRequest.reviewThreadCount,
    }, {
      frozenPreWave3AnchorExclusions: [
        ...input.frozenPreWave3AnchorExclusions,
      ],
      frozenPreWave3RepositoryExclusions: [
        ...input.frozenPreWave3RepositoryExclusions,
      ],
    });
    return {
      accepted: result.eligible,
      canonicalAnchorId:
        pullRequest.canonicalAnchorId,
      canonicalRepository:
        pullRequest.canonicalRepository,
      pullRequestNodeId:
        pullRequest.pullRequestNodeId,
      reasons: result.reasons,
    };
  });
}

export function normalizeC6SourceV3SimplePullRequestRows(
  rows: readonly C6SourceV3SimplePullRequestRow[],
): C6SourceV3SimplePullRequestRow[] {
  const normalized = sortPullRequests([...rows]);
  assertPullRequestRowsNormalized(normalized);
  return normalized;
}

export function assertC6SourceV3SimpleTwoPassEquality(input: {
  first: C6SourceV3SimpleNormalizedPass;
  frame: C6SourceV3SimpleFrameDefinition;
  second: C6SourceV3SimpleNormalizedPass;
}): {
  equal: true;
  normalizedProjectionSha256: string;
} {
  assertFrameDefinition(input.frame);
  assertNormalizedPass(input.first, input.frame);
  assertNormalizedPass(input.second, input.frame);
  const normalizedProjectionSha256 =
    compareAndHashNormalizedProjection(
      input.first,
      input.second,
    );
  return {
    equal: true,
    normalizedProjectionSha256,
  };
}

export function hashC6SourceV3SimpleNormalizedProjection(
  pass: Pick<
    C6SourceV3SimpleNormalizedPass,
    | "metadataDecisions"
    | "pullRequests"
    | "repositories"
    | "repositoryDecisions"
  >,
): string {
  const hash = createHash("sha256");
  updateNormalizedProjectionHash(
    hash,
    "repositories",
    pass.repositories,
    projectRepositoryRow,
  );
  updateNormalizedProjectionHash(
    hash,
    "repositoryDecisions",
    pass.repositoryDecisions,
    projectRepositoryDecision,
  );
  updateNormalizedProjectionHash(
    hash,
    "pullRequests",
    pass.pullRequests,
    projectPullRequestRow,
  );
  updateNormalizedProjectionHash(
    hash,
    "metadataDecisions",
    pass.metadataDecisions,
    projectMetadataDecision,
  );
  return hash.digest("hex");
}

function assertNormalizedPass(
  pass: C6SourceV3SimpleNormalizedPass,
  frame: C6SourceV3SimpleFrameDefinition,
): void {
  assertRepositoryLeafClosureLedger(
    pass,
    frame.rootShards,
  );
  assertRepositoryLedger(pass);
  assertPullRequestRowsNormalized(pass.pullRequests);
  const expectedRepositoryDecisions =
    classifyC6SourceV3SimpleRepositories({
      observations: pass.repositories,
      priorRepositoryAliases:
        frame.priorRepositoryAliases,
      priorRepositoryNodeIds:
        frame.priorRepositoryNodeIds,
    }).decisions;
  if (
    !isDeepStrictEqual(
      pass.repositoryDecisions,
      expectedRepositoryDecisions,
    )
  ) {
    throw new Error(
      "C6 source-v3-simple repository decision ledger does not match the frozen exclusion frame",
    );
  }
  const acceptedRepositories = new Map(
    pass.repositoryDecisions
      .filter((decision) => decision.accepted)
      .map((decision) => [
        decision.repositoryNodeId,
        decision.canonicalRepository,
      ]),
  );
  const closures = new Map<string, number>();
  for (const closure of pass.pullRequestClosures) {
    const canonicalRepository = acceptedRepositories.get(
      closure.repositoryNodeId,
    );
    if (
      canonicalRepository === undefined ||
      canonicalRepository !== closure.canonicalRepository ||
      closures.has(closure.repositoryNodeId) ||
      !isNonnegativeSafeInteger(
        closure.enumeratedInWindowCount,
      ) ||
      !isNonnegativeSafeInteger(closure.pageCount) ||
      closure.pageCount === 0 ||
      !isNonnegativeSafeInteger(
        closure.skippedAboveUpperBoundCount,
      ) ||
      !isNonnegativeSafeInteger(
        closure.totalMergedPullRequestCount,
      ) ||
      (
        closure.terminalReason ===
          "connection-exhausted" &&
        closure.totalMergedPullRequestCount !==
          closure.enumeratedInWindowCount +
            closure.skippedAboveUpperBoundCount
      ) ||
      (
        closure.terminalReason ===
          "strictly-older-createdAt-witness" &&
        closure.totalMergedPullRequestCount <
          closure.enumeratedInWindowCount +
            closure.skippedAboveUpperBoundCount +
            1
      )
    ) {
      throw new Error(
        "C6 source-v3-simple pull request closure ledger mismatch",
      );
    }
    closures.set(
      closure.repositoryNodeId,
      closure.enumeratedInWindowCount,
    );
  }
  if (closures.size !== acceptedRepositories.size) {
    throw new Error(
      "C6 source-v3-simple pull request closure ledger mismatch",
    );
  }
  const pullRequestCounts = new Map<string, number>();
  for (const pullRequest of pass.pullRequests) {
    const canonicalRepository = acceptedRepositories.get(
      pullRequest.repositoryNodeId,
    );
    if (canonicalRepository === undefined) {
      throw new Error(
        "C6 source-v3-simple pull request belongs to a rejected repository",
      );
    }
    if (
      canonicalRepository !==
        pullRequest.canonicalRepository
    ) {
      throw new Error(
        "C6 source-v3-simple pull request repository identity mismatch",
      );
    }
    pullRequestCounts.set(
      pullRequest.repositoryNodeId,
      (
        pullRequestCounts.get(pullRequest.repositoryNodeId) ??
          0
      ) + 1,
    );
  }
  for (
    const [repositoryNodeId, expectedCount] of closures
  ) {
    if (
      (pullRequestCounts.get(repositoryNodeId) ?? 0) !==
        expectedCount
    ) {
      throw new Error(
        "C6 source-v3-simple pull request closure count mismatch",
      );
    }
  }
  if (
    pass.metadataDecisions.length !==
      pass.pullRequests.length
  ) {
    throw new Error(
      "C6 source-v3-simple metadata decision ledger is not bijective",
    );
  }
  const decisions = new Map<
    string,
    C6SourceV3SimpleMetadataDecision
  >();
  for (const decision of pass.metadataDecisions) {
    if (
      decisions.has(decision.pullRequestNodeId) ||
      decision.accepted !== (decision.reasons.length === 0)
    ) {
      throw new Error(
        "C6 source-v3-simple metadata decision ledger is not bijective",
      );
    }
    decisions.set(decision.pullRequestNodeId, decision);
  }
  for (const pullRequest of pass.pullRequests) {
    const decision = decisions.get(
      pullRequest.pullRequestNodeId,
    );
    if (
      decision === undefined ||
      decision.canonicalAnchorId !==
        pullRequest.canonicalAnchorId ||
      decision.canonicalRepository !==
        pullRequest.canonicalRepository
    ) {
      throw new Error(
        "C6 source-v3-simple metadata decision ledger is not bijective",
      );
    }
  }
  const expectedMetadataDecisions =
    classifyC6SourceV3SimplePullRequests({
      frozenPreWave3AnchorExclusions:
        frame.frozenPreWave3AnchorExclusions,
      frozenPreWave3RepositoryExclusions:
        frame.frozenPreWave3RepositoryExclusions,
      pullRequests: pass.pullRequests,
    });
  if (
    !isDeepStrictEqual(
      pass.metadataDecisions,
      expectedMetadataDecisions,
    )
  ) {
    throw new Error(
      "C6 source-v3-simple metadata decision ledger does not match the frozen predicate",
    );
  }
}

function assertFrameDefinition(
  frame: C6SourceV3SimpleFrameDefinition,
): void {
  if (
    frame.rootShards.length !==
      C6_SOURCE_V3_SIMPLE_ROOT_SHARD_COUNT
  ) {
    throw new Error(
      "C6 source-v3-simple count tree frame does not contain exactly 1,536 root shards",
    );
  }
  const rootShardIds = new Set<string>();
  for (const [index, rootShard] of frame.rootShards.entries()) {
    if (
      rootShardIds.has(rootShard.rootShardId) ||
      (
        index > 0 &&
        compareUtf8(
          frame.rootShards[index - 1]!.rootShardId,
          rootShard.rootShardId,
        ) >= 0
      ) ||
      rootShard.createdFrom > rootShard.createdTo ||
      replaceCreatedInterval(
        rootShard.query,
        rootShard.createdFrom,
        rootShard.createdTo,
      ) !== rootShard.query
    ) {
      throw new Error(
        "C6 source-v3-simple count tree frame is not the normalized frozen root-shard frame",
      );
    }
    rootShardIds.add(rootShard.rootShardId);
  }
  for (const values of [
    frame.frozenPreWave3AnchorExclusions,
    frame.frozenPreWave3RepositoryExclusions,
    frame.priorRepositoryAliases,
    frame.priorRepositoryNodeIds,
  ]) {
    if (new Set(values).size !== values.length) {
      throw new Error(
        "C6 source-v3-simple frozen exclusion frame contains duplicates",
      );
    }
  }
}

function assertRepositoryLeafClosureLedger(
  pass: C6SourceV3SimpleNormalizedPass,
  rootShards: readonly C6SourceV3SimpleRootShard[],
): void {
  const leaves = new Map<
    string,
    C6SourceV3SimpleCountTreeLeaf
  >();
  const rootShardById = new Map(
    rootShards.map((rootShard) => [
      rootShard.rootShardId,
      rootShard,
    ]),
  );
  if (pass.countTrees.length !== rootShards.length) {
    throw new Error(
      "C6 source-v3-simple count tree frame is incomplete",
    );
  }
  for (
    const [index, countTree] of pass.countTrees.entries()
  ) {
    const rootShard = rootShards[index];
    if (
      rootShard === undefined ||
      countTree.rootShardId !== rootShard.rootShardId
    ) {
      throw new Error(
        "C6 source-v3-simple count tree frame is incomplete",
      );
    }
    const validatedLeaves = assertCountTreeAgainstRootShard(
      countTree,
      rootShard,
    );
    for (const leaf of validatedLeaves) {
      const key = repositoryLeafKey({
        leafCreatedFrom: leaf.createdFrom,
        leafCreatedTo: leaf.createdTo,
        rootShardId: countTree.rootShardId,
      });
      if (
        !Number.isInteger(leaf.count) ||
        leaf.count < 0 ||
        leaf.count >
          C6_SOURCE_V3_SIMPLE_ACCESSIBLE_RESULT_CAP ||
        leaf.createdFrom > leaf.createdTo ||
        leaves.has(key)
      ) {
        throw new Error(
          "C6 source-v3-simple repository leaf closure ledger mismatch",
        );
      }
      leaves.set(key, leaf);
    }
  }
  if (
    pass.repositoryLeafClosures.length !== leaves.size
  ) {
    throw new Error(
      "C6 source-v3-simple repository leaf closure ledger mismatch",
    );
  }
  const closures = new Set<string>();
  for (const closure of pass.repositoryLeafClosures) {
    const key = repositoryLeafKey(closure);
    const leaf = leaves.get(key);
    const zeroLeaf = leaf?.count === 0;
    if (
      leaf === undefined ||
      closures.has(key) ||
      closure.expectedRepositoryCount !== leaf.count ||
      !Number.isInteger(closure.pageCount) ||
      closure.pageCount < 0 ||
      (
        zeroLeaf &&
        (
          closure.pageCount !== 0 ||
          closure.terminalReason !== "zero-count-leaf"
        )
      ) ||
      (
        !zeroLeaf &&
        (
          closure.pageCount === 0 ||
          closure.terminalReason !==
            "connection-exhausted"
        )
      )
    ) {
      throw new Error(
        "C6 source-v3-simple repository leaf closure ledger mismatch",
      );
    }
    closures.add(key);
  }
  const repositoryCounts = new Map<string, number>();
  for (const repository of pass.repositories) {
    const parsedRepository =
      normalizedRepositoryRowSchema.safeParse(repository);
    if (!parsedRepository.success) {
      throw new Error(
        "C6 source-v3-simple normalized repository row is invalid",
      );
    }
    const key = repositoryLeafKey(repository);
    const leaf = leaves.get(key);
    const rootShard = rootShardById.get(
      repository.rootShardId,
    );
    if (
      leaf === undefined ||
      rootShard === undefined ||
      repository.sourceSplit !== rootShard.split
    ) {
      throw new Error(
        "C6 source-v3-simple repository leaf closure ledger mismatch",
      );
    }
    assertRepositoryInLeaf(
      repository,
      rootShard,
      leaf,
    );
    repositoryCounts.set(
      key,
      (repositoryCounts.get(key) ?? 0) + 1,
    );
  }
  for (const [key, leaf] of leaves) {
    if ((repositoryCounts.get(key) ?? 0) !== leaf.count) {
      throw new Error(
        "C6 source-v3-simple repository leaf closure ledger mismatch",
      );
    }
  }
}

function assertCountTreeAgainstRootShard(
  countTree: C6SourceV3SimpleCountTree,
  rootShard: C6SourceV3SimpleRootShard,
): C6SourceV3SimpleCountTreeLeaf[] {
  let nodeIndex = 0;
  const visit = (
    createdFromSeconds: number,
    createdToSeconds: number,
    depth: number,
  ): {
    count: number;
    leaves: C6SourceV3SimpleCountTreeLeaf[];
  } => {
    const node = countTree.nodes[nodeIndex];
    nodeIndex += 1;
    const createdFrom = formatUtcSeconds(
      createdFromSeconds,
    );
    const createdTo = formatUtcSeconds(createdToSeconds);
    const query = replaceCreatedInterval(
      rootShard.query,
      createdFrom,
      createdTo,
    );
    if (
      node === undefined ||
      node.createdFrom !== createdFrom ||
      node.createdTo !== createdTo ||
      node.depth !== depth ||
      node.query !== query ||
      !isNonnegativeSafeInteger(node.count)
    ) {
      throw new Error(
        "C6 source-v3-simple count tree does not match its frozen root shard",
      );
    }
    if (
      node.count <=
        C6_SOURCE_V3_SIMPLE_ACCESSIBLE_RESULT_CAP
    ) {
      if (!node.leaf) {
        throw new Error(
          "C6 source-v3-simple count tree has an invalid internal node",
        );
      }
      return {
        count: node.count,
        leaves: [
          node as C6SourceV3SimpleCountTreeLeaf,
        ],
      };
    }
    if (
      node.leaf ||
      createdFromSeconds === createdToSeconds
    ) {
      throw new Error(
        "C6 source-v3-simple count tree has an invalid overflowing leaf",
      );
    }
    const midpoint = Math.floor(
      (createdFromSeconds + createdToSeconds) / 2,
    );
    const left = visit(
      createdFromSeconds,
      midpoint,
      depth + 1,
    );
    const right = visit(
      midpoint + 1,
      createdToSeconds,
      depth + 1,
    );
    if (left.count + right.count !== node.count) {
      throw new Error(
        "C6 source-v3-simple count tree child total does not equal parent count",
      );
    }
    return {
      count: node.count,
      leaves: [...left.leaves, ...right.leaves],
    };
  };
  const result = visit(
    utcSeconds(
      rootShard.createdFrom,
      "root shard createdFrom",
    ),
    utcSeconds(
      rootShard.createdTo,
      "root shard createdTo",
    ),
    0,
  );
  if (
    nodeIndex !== countTree.nodes.length ||
    !isDeepStrictEqual(countTree.leaves, result.leaves)
  ) {
    throw new Error(
      "C6 source-v3-simple count tree is not a complete deterministic traversal",
    );
  }
  return result.leaves;
}

function assertRepositoryLedger(
  pass: C6SourceV3SimpleNormalizedPass,
): void {
  if (
    pass.repositories.length !==
      pass.repositoryDecisions.length
  ) {
    throw new Error(
      "C6 source-v3-simple repository decision ledger is not bijective",
    );
  }
  const priorNodeIds = new Set<string>();
  for (const [index, repository] of pass.repositories.entries()) {
    if (
      repository.id !== repository.repositoryNodeId
    ) {
      throw new Error(
        "C6 source-v3-simple repository identity mismatch",
      );
    }
    if (
      index > 0 &&
      compareUtf8(
        pass.repositories[index - 1]!.repositoryNodeId,
        repository.repositoryNodeId,
      ) >= 0
    ) {
      throw new Error(
        "C6 source-v3-simple repositories are not globally normalized",
      );
    }
    if (priorNodeIds.has(repository.repositoryNodeId)) {
      throw new Error(
        "C6 source-v3-simple duplicate repository node ID across the frame",
      );
    }
    priorNodeIds.add(repository.repositoryNodeId);
    const decision = pass.repositoryDecisions[index];
    if (
      decision === undefined ||
      decision.repositoryNodeId !==
        repository.repositoryNodeId ||
      decision.canonicalRepository !==
        asciiCaseFold(repository.nameWithOwner) ||
      decision.accepted !== (decision.reasons.length === 0)
    ) {
      throw new Error(
        "C6 source-v3-simple repository decision ledger is not bijective",
      );
    }
  }
}

function repositoryLeafKey(input: {
  leafCreatedFrom: string;
  leafCreatedTo: string;
  rootShardId: string;
}): string {
  return [
    input.rootShardId,
    input.leafCreatedFrom,
    input.leafCreatedTo,
  ].join("\u0000");
}

function isNonnegativeSafeInteger(
  value: number,
): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function assertPullRequestRowsNormalized(
  rows: readonly C6SourceV3SimplePullRequestRow[],
): void {
  const nodeIds = new Set<string>();
  const anchors = new Set<string>();
  for (const [index, row] of rows.entries()) {
    normalizedPullRequestRowSchema.parse(row);
    if (
      row.createdAt <
        C6_SOURCE_V3_SIMPLE_PULL_REQUEST_LOWER_BOUND ||
      row.createdAt >
        C6_SOURCE_V3_SIMPLE_PULL_REQUEST_UPPER_BOUND
    ) {
      throw new Error(
        "C6 source-v3-simple pull request window invariant mismatch",
      );
    }
    if (
      row.canonicalRepository !==
        asciiCaseFold(row.canonicalRepository) ||
      row.canonicalAnchorId !==
        `${row.canonicalRepository}#${row.number}` ||
      nodeIds.has(row.pullRequestNodeId) ||
      anchors.has(row.canonicalAnchorId)
    ) {
      throw new Error(
        "C6 source-v3-simple pull request rows are not globally unique",
      );
    }
    if (
      index > 0 &&
      comparePullRequests(rows[index - 1]!, row) >= 0
    ) {
      throw new Error(
        "C6 source-v3-simple pull request rows are not globally normalized",
      );
    }
    nodeIds.add(row.pullRequestNodeId);
    anchors.add(row.canonicalAnchorId);
  }
}

function compareAndHashNormalizedProjection(
  first: C6SourceV3SimpleNormalizedPass,
  second: C6SourceV3SimpleNormalizedPass,
): string {
  const projections: ReadonlyArray<readonly [
    string,
    readonly unknown[],
    readonly unknown[],
  ]> = [
    [
      "repositories",
      first.repositories,
      second.repositories,
    ],
    [
      "repositoryDecisions",
      first.repositoryDecisions,
      second.repositoryDecisions,
    ],
    [
      "pullRequests",
      first.pullRequests,
      second.pullRequests,
    ],
    [
      "metadataDecisions",
      first.metadataDecisions,
      second.metadataDecisions,
    ],
  ];
  for (const [, firstRows, secondRows] of projections) {
    if (firstRows.length !== secondRows.length) {
      throw new Error(
        "C6 source-v3-simple two-pass normalized projection mismatch",
      );
    }
    for (const [index, firstRow] of firstRows.entries()) {
      const secondRow = secondRows[index];
      if (!isDeepStrictEqual(firstRow, secondRow)) {
        throw new Error(
          "C6 source-v3-simple two-pass normalized projection mismatch",
        );
      }
    }
  }
  return hashC6SourceV3SimpleNormalizedProjection(first);
}

function projectRepositoryRow(
  row: C6SourceV3SimpleRepositoryRow,
) {
  return {
    createdAt: row.createdAt,
    id: row.id,
    isArchived: row.isArchived,
    isFork: row.isFork,
    isMirror: row.isMirror,
    isTemplate: row.isTemplate,
    leafCreatedFrom: row.leafCreatedFrom,
    leafCreatedTo: row.leafCreatedTo,
    nameWithOwner: row.nameWithOwner,
    primaryLanguage: row.primaryLanguage,
    pushedAt: row.pushedAt,
    repositoryNodeId: row.repositoryNodeId,
    rootShardId: row.rootShardId,
    sourceSplit: row.sourceSplit,
    visibility: row.visibility,
  };
}

function projectRepositoryDecision(
  row: C6SourceV3SimpleRepositoryDecision,
) {
  return {
    accepted: row.accepted,
    canonicalRepository: row.canonicalRepository,
    reasons: row.reasons,
    repositoryNodeId: row.repositoryNodeId,
  };
}

function projectPullRequestRow(
  row: C6SourceV3SimplePullRequestRow,
) {
  return {
    authorLogin: row.authorLogin,
    baseRefOid: row.baseRefOid,
    canonicalAnchorId: row.canonicalAnchorId,
    canonicalRepository: row.canonicalRepository,
    commitTotalCount: row.commitTotalCount,
    createdAt: row.createdAt,
    mergeCommitOid: row.mergeCommitOid,
    mergedAt: row.mergedAt,
    number: row.number,
    pullRequestNodeId: row.pullRequestNodeId,
    repositoryNodeId: row.repositoryNodeId,
    reviewCount: row.reviewCount,
    reviewThreadCount: row.reviewThreadCount,
    url: row.url,
  };
}

function projectMetadataDecision(
  row: C6SourceV3SimpleMetadataDecision,
) {
  return {
    accepted: row.accepted,
    canonicalAnchorId: row.canonicalAnchorId,
    canonicalRepository: row.canonicalRepository,
    pullRequestNodeId: row.pullRequestNodeId,
    reasons: row.reasons,
  };
}

function updateNormalizedProjectionHash<T>(
  hash: ReturnType<typeof createHash>,
  name: string,
  rows: readonly T[],
  project: (row: T) => unknown,
): void {
  hash.update(`${name}\u0000${rows.length}\u0000`);
  for (const row of rows) {
    const rowBytes = Buffer.from(
      JSON.stringify(project(row)),
    );
    hash.update(`${rowBytes.length}:`);
    hash.update(rowBytes);
    hash.update("\n");
  }
}

async function collectCountTree(input: {
  createdFromSeconds: number;
  createdToSeconds: number;
  depth: number;
  probe: (
    request: C6SourceV3SimpleCountProbeRequest,
  ) => Promise<number>;
  rootShard: C6SourceV3SimpleRootShard;
}): Promise<{
  leaves: C6SourceV3SimpleCountTreeLeaf[];
  nodes: C6SourceV3SimpleCountTreeNode[];
}> {
  const createdFrom = formatUtcSeconds(
    input.createdFromSeconds,
  );
  const createdTo = formatUtcSeconds(input.createdToSeconds);
  const query = replaceCreatedInterval(
    input.rootShard.query,
    createdFrom,
    createdTo,
  );
  const count = await input.probe({
    createdFrom,
    createdTo,
    query,
    rootShardId: input.rootShard.rootShardId,
  });
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(
      "C6 source-v3-simple count probe returned an invalid count",
    );
  }
  if (
    count <= C6_SOURCE_V3_SIMPLE_ACCESSIBLE_RESULT_CAP
  ) {
    const leaf: C6SourceV3SimpleCountTreeLeaf = {
      count,
      createdFrom,
      createdTo,
      depth: input.depth,
      leaf: true,
      query,
    };
    return {
      leaves: [leaf],
      nodes: [leaf],
    };
  }
  if (
    input.createdFromSeconds === input.createdToSeconds
  ) {
    throw new Error(
      "C6 source-v3-simple single UTC second exceeds the accessible result cap",
    );
  }
  const midpoint = Math.floor(
    (
      input.createdFromSeconds +
      input.createdToSeconds
    ) / 2,
  );
  const left = await collectCountTree({
    ...input,
    createdToSeconds: midpoint,
    depth: input.depth + 1,
  });
  const right = await collectCountTree({
    ...input,
    createdFromSeconds: midpoint + 1,
    depth: input.depth + 1,
  });
  const childCount = [
    ...left.leaves,
    ...right.leaves,
  ].reduce((sum, leaf) => sum + leaf.count, 0);
  if (childCount !== count) {
    throw new Error(
      "C6 source-v3-simple count tree child total does not equal parent count",
    );
  }
  return {
    leaves: [...left.leaves, ...right.leaves],
    nodes: [
      {
        count,
        createdFrom,
        createdTo,
        depth: input.depth,
        leaf: false,
        query,
      },
      ...left.nodes,
      ...right.nodes,
    ],
  };
}

function replaceCreatedInterval(
  query: string,
  createdFrom: string,
  createdTo: string,
): string {
  const pattern =
    /created:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\.\.\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/gu;
  const matches = query.match(pattern);
  if (matches?.length !== 1) {
    throw new Error(
      "C6 source-v3-simple root query has an invalid created interval",
    );
  }
  return query.replace(
    pattern,
    `created:${createdFrom}..${createdTo}`,
  );
}

function assertRepositoryInLeaf(
  node: C6SourceV3SimpleRepositoryNode,
  rootShard: C6SourceV3SimpleRootShard,
  leaf: C6SourceV3SimpleCountTreeLeaf,
): void {
  if (
    node.createdAt < leaf.createdFrom ||
    node.createdAt > leaf.createdTo ||
    node.isArchived ||
    node.isFork ||
    node.isMirror ||
    node.isTemplate ||
    node.primaryLanguage?.name !== rootShard.language ||
    node.pushedAt === null ||
    node.pushedAt < "2024-01-01T00:00:00Z" ||
    node.visibility !== "PUBLIC"
  ) {
    throw new Error(
      "C6 source-v3-simple repository does not satisfy the frozen source frame",
    );
  }
}

function normalizePullRequest(
  repository: C6SourceV3SimpleRepositoryNode,
  node: C6SourceV3SimplePullRequestNode,
): C6SourceV3SimplePullRequestRow {
  const canonicalRepository = asciiCaseFold(
    repository.nameWithOwner,
  );
  return {
    authorLogin: node.author?.login ?? null,
    baseRefOid: node.baseRefOid,
    canonicalAnchorId:
      `${canonicalRepository}#${node.number}`,
    canonicalRepository,
    commitTotalCount: node.commits.totalCount,
    createdAt: node.createdAt,
    mergeCommitOid: node.mergeCommit?.oid ?? null,
    mergedAt: node.mergedAt,
    number: node.number,
    pullRequestNodeId: node.id,
    repositoryNodeId: repository.id,
    reviewCount: node.reviews.totalCount,
    reviewThreadCount: node.reviewThreads.totalCount,
    url: node.url,
  };
}

function sortPullRequests(
  rows: C6SourceV3SimplePullRequestRow[],
): C6SourceV3SimplePullRequestRow[] {
  return rows.sort(comparePullRequests);
}

function comparePullRequests(
  left: C6SourceV3SimplePullRequestRow,
  right: C6SourceV3SimplePullRequestRow,
): number {
  return right.createdAt.localeCompare(left.createdAt) ||
    compareUtf8(
      left.pullRequestNodeId,
      right.pullRequestNodeId,
    );
}

function utcSeconds(value: string, label: string): number {
  utcSecondSchema.parse(value);
  const milliseconds = Date.parse(value);
  if (
    !Number.isSafeInteger(milliseconds) ||
    new Date(milliseconds).toISOString()
        .replace(".000Z", "Z") !== value
  ) {
    throw new Error(
      `C6 source-v3-simple ${label} is not a canonical UTC second`,
    );
  }
  return milliseconds / 1_000;
}

function formatUtcSeconds(value: number): string {
  return new Date(value * 1_000)
    .toISOString()
    .replace(".000Z", "Z");
}

function asciiCaseFold(value: string): string {
  return value.replace(/[A-Z]/gu, (character) =>
    character.toLowerCase()
  );
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}
