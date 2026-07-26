import { z } from "zod";

import type {
  C6SourceV3SimplePullRequestPage,
  C6SourceV3SimpleRepositoryPage,
} from "./c6-source-v3-simple-census-core";

const utcSecondSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u,
);
const nonEmptyStringSchema = z.string().min(1);
const repositoryNameSchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const pageInfoSchema = z.object({
  endCursor: nonEmptyStringSchema.nullable(),
  hasNextPage: z.boolean(),
}).strict();
const rateLimitSchema = z.object({
  cost: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  remaining: z.number().int().nonnegative(),
  resetAt: utcSecondSchema,
  used: z.number().int().nonnegative(),
}).strict();
const repositoryNodeSchema = z.object({
  __typename: z.literal("Repository"),
  createdAt: utcSecondSchema,
  id: nonEmptyStringSchema,
  isArchived: z.boolean(),
  isFork: z.boolean(),
  isMirror: z.boolean(),
  isTemplate: z.boolean(),
  nameWithOwner: repositoryNameSchema,
  primaryLanguage: z.object({
    name: nonEmptyStringSchema,
  }).strict().nullable(),
  pushedAt: utcSecondSchema.nullable(),
  visibility: nonEmptyStringSchema,
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
const graphqlErrorSchema = z.object({
  extensions: z.object({
    type: nonEmptyStringSchema.optional(),
  }).passthrough().optional(),
  message: z.string(),
}).passthrough();
const envelopeSchema = z.object({
  data: z.unknown().optional(),
  errors: z.array(graphqlErrorSchema).optional(),
  extensions: z.unknown().optional(),
}).strict();
const countDataSchema = z.object({
  rateLimit: rateLimitSchema,
  search: z.object({
    repositoryCount: z.number().int().nonnegative(),
  }).strict(),
}).strict();
const repositoryPageDataSchema = z.object({
  rateLimit: rateLimitSchema,
  search: z.object({
    nodes: z.array(repositoryNodeSchema).max(100),
    pageInfo: pageInfoSchema,
    repositoryCount: z.number().int().nonnegative(),
  }).strict(),
}).strict();
const pullRequestPageDataSchema = z.object({
  node: z.object({
    __typename: z.literal("Repository"),
    id: nonEmptyStringSchema,
    nameWithOwner: repositoryNameSchema,
    pullRequests: z.object({
      nodes: z.array(pullRequestNodeSchema).max(100),
      pageInfo: pageInfoSchema,
      totalCount: z.number().int().nonnegative(),
    }).strict(),
  }).strict(),
  rateLimit: rateLimitSchema,
}).strict();

export type C6SourceV3SimpleRateLimit = z.infer<
  typeof rateLimitSchema
>;

export class C6SourceV3SimpleGraphqlResponseError
  extends Error {
  readonly types: Array<string | null>;

  constructor(types: Array<string | null>) {
    super(
      "C6 source-v3-simple GraphQL response contains errors",
    );
    this.name = "C6SourceV3SimpleGraphqlResponseError";
    this.types = types;
  }
}

export function projectC6SourceV3SimpleRepositoryCount(
  body: string | Uint8Array,
): {
  rateLimit: C6SourceV3SimpleRateLimit;
  repositoryCount: number;
} {
  const parsed = countDataSchema.safeParse(
    successData(body),
  );
  if (!parsed.success) {
    throw new Error(
      "C6 source-v3-simple repository count schema mismatch",
    );
  }
  return {
    rateLimit: parsed.data.rateLimit,
    repositoryCount:
      parsed.data.search.repositoryCount,
  };
}

export function projectC6SourceV3SimpleRepositoryPage(
  body: string | Uint8Array,
): {
  page: C6SourceV3SimpleRepositoryPage;
  rateLimit: C6SourceV3SimpleRateLimit;
} {
  const parsed = repositoryPageDataSchema.safeParse(
    successData(body),
  );
  if (!parsed.success) {
    throw new Error(
      "C6 source-v3-simple repository page schema mismatch",
    );
  }
  return {
    page: {
      nodes: parsed.data.search.nodes.map((node) => ({
        createdAt: node.createdAt,
        id: node.id,
        isArchived: node.isArchived,
        isFork: node.isFork,
        isMirror: node.isMirror,
        isTemplate: node.isTemplate,
        nameWithOwner: node.nameWithOwner,
        primaryLanguage: node.primaryLanguage,
        pushedAt: node.pushedAt,
        visibility: node.visibility,
      })),
      pageInfo: parsed.data.search.pageInfo,
      repositoryCount:
        parsed.data.search.repositoryCount,
    },
    rateLimit: parsed.data.rateLimit,
  };
}

export function projectC6SourceV3SimplePullRequestPage(
  input: {
    body: string | Uint8Array;
    requestedRepositoryNodeId: string;
  },
): {
  page: C6SourceV3SimplePullRequestPage;
  rateLimit: C6SourceV3SimpleRateLimit;
} {
  const parsed = pullRequestPageDataSchema.safeParse(
    successData(input.body),
  );
  if (!parsed.success) {
    throw new Error(
      "C6 source-v3-simple pull request page schema mismatch",
    );
  }
  if (parsed.data.node.id !== input.requestedRepositoryNodeId) {
    throw new Error(
      "C6 source-v3-simple pull request repository identity mismatch",
    );
  }
  return {
    page: {
      nodes: parsed.data.node.pullRequests.nodes,
      pageInfo:
        parsed.data.node.pullRequests.pageInfo,
      repositoryNameWithOwner:
        parsed.data.node.nameWithOwner,
      repositoryNodeId: parsed.data.node.id,
      totalCount:
        parsed.data.node.pullRequests.totalCount,
    },
    rateLimit: parsed.data.rateLimit,
  };
}

function successData(
  body: string | Uint8Array,
): unknown {
  const bytes = Buffer.from(body);
  let text: string;
  try {
    text = new TextDecoder("utf-8", {
      fatal: true,
    }).decode(bytes);
  } catch {
    throw new Error(
      "C6 source-v3-simple GraphQL response is not UTF-8",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      "C6 source-v3-simple GraphQL response is not JSON",
    );
  }
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw new Error(
      "C6 source-v3-simple GraphQL envelope schema mismatch",
    );
  }
  if (
    envelope.data.errors !== undefined &&
    envelope.data.errors.length > 0
  ) {
    throw new C6SourceV3SimpleGraphqlResponseError(
      envelope.data.errors.map(
        (error) => error.extensions?.type ?? null,
      ),
    );
  }
  if (envelope.data.data === undefined) {
    throw new Error(
      "C6 source-v3-simple GraphQL response has no data",
    );
  }
  return envelope.data.data;
}
