import { createHash } from "node:crypto";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { z } from "zod";

const ENDPOINT = "https://api.github.com/graphql";
const REQUEST_HEADERS = {
  accept: "application/vnd.github+json",
  "content-type": "application/json",
  "user-agent": "GoodMemory-C6-GraphQL-Discovery/1",
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

export const C6_GITHUB_GRAPHQL_DISCOVERY_QUERY = `query C6GitHubGraphQLDiscovery($owner: String!, $name: String!, $number: Int!) {
  rateLimit {
    cost
    remaining
    resetAt
  }
  repository(owner: $owner, name: $name) {
    nameWithOwner
    pullRequest(number: $number) {
      id
      number
      url
      state
      baseRefName
      baseRefOid
      baseRepository {
        nameWithOwner
      }
      headRefName
      headRefOid
      headRepository {
        nameWithOwner
      }
      isCrossRepository
      merged
      mergedAt
      mergeCommit {
        oid
      }
      closingIssuesReferences(first: 100) {
        nodes {
          number
          url
          title
          body
          createdAt
          updatedAt
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
      comments(first: 100) {
        nodes {
          id
          databaseId
          author {
            login
          }
          body
          createdAt
          updatedAt
          url
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
      commits(first: 100) {
        nodes {
          commit {
            oid
            committedDate
            parents(first: 100) {
              nodes {
                oid
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
      reviews(first: 100) {
        nodes {
          id
          databaseId
          author {
            login
          }
          body
          state
          submittedAt
          commit {
            oid
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          comments(first: 100) {
            nodes {
              id
              databaseId
              author {
                login
              }
              body
              createdAt
              updatedAt
              path
              line
              originalLine
              originalCommit {
                oid
              }
              commit {
                oid
              }
              url
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}`;

const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const pageInfoSchema = z.object({
  endCursor: z.string().nullable(),
  hasNextPage: z.boolean(),
}).passthrough();
const genericConnectionSchema = z.object({
  nodes: z.array(z.unknown().nullable()),
  pageInfo: pageInfoSchema,
}).passthrough();
const commitConnectionSchema = z.object({
  nodes: z.array(z.object({
    commit: z.object({
      committedDate: z.iso.datetime(),
      oid: commitSchema,
      parents: genericConnectionSchema,
    }).passthrough(),
  }).passthrough().nullable()),
  pageInfo: pageInfoSchema,
}).passthrough();
const reviewThreadConnectionSchema = z.object({
  nodes: z.array(z.object({
    comments: genericConnectionSchema,
  }).passthrough().nullable()),
  pageInfo: pageInfoSchema,
}).passthrough();
const responseSchema = z.object({
  data: z.object({
    rateLimit: z.object({
      cost: z.number().int().nonnegative(),
      remaining: z.number().int().nonnegative(),
      resetAt: z.iso.datetime(),
    }).passthrough(),
    repository: z.object({
      nameWithOwner: z.string().min(1),
      pullRequest: z.object({
        baseRepository: z.object({
          nameWithOwner: z.string().min(1),
        }).passthrough(),
        baseRefName: z.string(),
        baseRefOid: commitSchema,
        closingIssuesReferences: genericConnectionSchema,
        comments: genericConnectionSchema,
        commits: commitConnectionSchema,
        headRefName: z.string().nullable(),
        headRefOid: commitSchema.nullable(),
        mergeCommit: z.object({ oid: commitSchema }).passthrough().nullable(),
        merged: z.boolean(),
        mergedAt: z.iso.datetime().nullable(),
        number: z.number().int().positive(),
        reviewThreads: reviewThreadConnectionSchema,
        reviews: genericConnectionSchema,
        url: z.url(),
      }).passthrough(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

interface ArtifactReference {
  bytes: number;
  path: string;
  sha256: string;
}

export interface C6GitHubGraphQLDiscoveryCapture {
  boundary: {
    acceptedEpisodeCount: 0;
    candidateManifestFrozen: false;
    status: "single-pr-graphql-discovery-not-accepted-evidence";
    upperBoundClaimPermitted: false;
  };
  discovery: {
    discoverySurfaceComplete: boolean;
    paginationGaps: Array<{
      endCursor: string | null;
      path: string;
    }>;
    rateLimit: {
      cost: number;
      remaining: number;
      resetAt: string;
    };
  };
  request: {
    body: ArtifactReference;
    endpoint: typeof ENDPOINT;
    headers: {
      accept: typeof REQUEST_HEADERS.accept;
      authorization: "Bearer [REDACTED]";
      "content-type": typeof REQUEST_HEADERS["content-type"];
      "user-agent": typeof REQUEST_HEADERS["user-agent"];
      "x-github-api-version":
        typeof REQUEST_HEADERS["x-github-api-version"];
    };
    method: "POST";
    variables: {
      name: string;
      number: number;
      owner: string;
    };
  };
  response: {
    body: ArtifactReference;
    headers: ArtifactReference;
    httpStatus: number;
  };
  schemaVersion: 1;
  target: {
    pullNumber: number;
    repository: string;
    repositoryRedirect?: {
      requestedRepository: string;
      resolvedRepository: string;
      status: "explicit-graphql-resolution-observed";
    };
    url: string;
  };
}

export type C6GitHubGraphQLDiscoveryFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export async function captureC6GitHubGraphQLDiscovery(input: {
  canonicalOwner?: string;
  canonicalRepo?: string;
  fetchImpl: C6GitHubGraphQLDiscoveryFetch;
  outputDirectory: string;
  owner: string;
  pullNumber: number;
  repo: string;
  token: string;
}): Promise<C6GitHubGraphQLDiscoveryCapture> {
  const owner = requiredUnpadded(input.owner, "owner");
  const repo = requiredUnpadded(input.repo, "repo");
  const requestedRepository = `${owner}/${repo}`;
  const canonicalRepository = resolveCanonicalRepository({
    canonicalOwner: input.canonicalOwner,
    canonicalRepo: input.canonicalRepo,
    requestedRepository,
  });
  const token = requiredUnpadded(input.token, "GitHub token");
  const outputDirectory = resolve(
    requiredUnpadded(input.outputDirectory, "output directory"),
  );
  await assertOutputDoesNotExist(outputDirectory);
  if (
    !Number.isSafeInteger(input.pullNumber) ||
    input.pullNumber <= 0
  ) {
    throw new Error("C6 GitHub GraphQL pull number must be a positive integer");
  }

  const variables = {
    name: repo,
    number: input.pullNumber,
    owner,
  };
  const requestBytes = Buffer.from(JSON.stringify({
    query: C6_GITHUB_GRAPHQL_DISCOVERY_QUERY,
    variables,
  }));
  const requestHeaders = {
    ...REQUEST_HEADERS,
    authorization: `Bearer ${token}`,
  };
  const response = await input.fetchImpl(ENDPOINT, {
    body: requestBytes.toString("utf8"),
    headers: requestHeaders,
    method: "POST",
    redirect: "error",
  });
  const responseBytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(
      `C6 GitHub GraphQL discovery failed with HTTP ${response.status}`,
    );
  }
  const rawResponse = parseResponseJson(responseBytes);
  if (
    typeof rawResponse === "object" &&
    rawResponse !== null &&
    "errors" in rawResponse &&
    Array.isArray(rawResponse.errors) &&
    rawResponse.errors.length > 0
  ) {
    throw new Error("C6 GitHub GraphQL discovery returned GraphQL errors");
  }
  const parsed = responseSchema.parse(rawResponse);
  if (
    parsed.data.repository.nameWithOwner.toLowerCase() !==
      canonicalRepository.toLowerCase()
  ) {
    throw new Error(
      "C6 GitHub GraphQL discovery repository identity mismatch",
    );
  }
  const pullRequest = parsed.data.repository.pullRequest;
  if (
    pullRequest.number !== input.pullNumber ||
    pullRequest.baseRepository.nameWithOwner.toLowerCase() !==
      canonicalRepository.toLowerCase()
  ) {
    throw new Error(
      "C6 GitHub GraphQL discovery pull request identity mismatch",
    );
  }
  const expectedUrl =
    `https://github.com/${canonicalRepository}/pull/${input.pullNumber}`;
  if (normalizeUrl(pullRequest.url) !== normalizeUrl(expectedUrl)) {
    throw new Error(
      "C6 GitHub GraphQL discovery pull request URL mismatch",
    );
  }

  const selectedResponseHeaders = selectResponseHeaders(response.headers);
  const responseHeaderBytes = Buffer.from(
    `${JSON.stringify(selectedResponseHeaders, null, 2)}\n`,
  );
  const paginationGaps = collectPaginationGaps(parsed.data, "data");
  const capture: C6GitHubGraphQLDiscoveryCapture = {
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      status: "single-pr-graphql-discovery-not-accepted-evidence",
      upperBoundClaimPermitted: false,
    },
    discovery: {
      discoverySurfaceComplete: paginationGaps.length === 0,
      paginationGaps,
      rateLimit: parsed.data.rateLimit,
    },
    request: {
      body: artifactReference("request.json", requestBytes),
      endpoint: ENDPOINT,
      headers: {
        ...REQUEST_HEADERS,
        authorization: "Bearer [REDACTED]",
      },
      method: "POST",
      variables,
    },
    response: {
      body: artifactReference("response.json", responseBytes),
      headers: artifactReference(
        "response-headers.json",
        responseHeaderBytes,
      ),
      httpStatus: response.status,
    },
    schemaVersion: 1,
    target: {
      pullNumber: input.pullNumber,
      repository: parsed.data.repository.nameWithOwner,
      ...(canonicalRepository.toLowerCase() !==
          requestedRepository.toLowerCase()
        ? {
          repositoryRedirect: {
            requestedRepository,
            resolvedRepository:
              parsed.data.repository.nameWithOwner,
            status:
              "explicit-graphql-resolution-observed" as const,
          },
        }
        : {}),
      url: pullRequest.url,
    },
  };
  const captureBytes = Buffer.from(`${JSON.stringify(capture, null, 2)}\n`);
  const tokenBytes = Buffer.from(token);
  if (
    [requestBytes, responseHeaderBytes, responseBytes, captureBytes]
      .some((bytes) => bytes.includes(tokenBytes))
  ) {
    throw new Error(
      "C6 GitHub GraphQL discovery refuses to persist the GitHub token",
    );
  }

  await mkdir(dirname(outputDirectory), { recursive: true });
  await mkdir(outputDirectory);
  await writeFile(join(outputDirectory, "request.json"), requestBytes, {
    flag: "wx",
  });
  await writeFile(
    join(outputDirectory, "response-headers.json"),
    responseHeaderBytes,
    { flag: "wx" },
  );
  await writeFile(join(outputDirectory, "response.json"), responseBytes, {
    flag: "wx",
  });
  await writeFile(join(outputDirectory, "capture.json"), captureBytes, {
    flag: "wx",
  });
  return capture;
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

function collectPaginationGaps(
  value: unknown,
  path: string,
): C6GitHubGraphQLDiscoveryCapture["discovery"]["paginationGaps"] {
  const gaps: C6GitHubGraphQLDiscoveryCapture["discovery"]["paginationGaps"] =
    [];
  visit(value, path, gaps);
  return gaps.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );
}

function visit(
  value: unknown,
  path: string,
  gaps: C6GitHubGraphQLDiscoveryCapture["discovery"]["paginationGaps"],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, `${path}[${index}]`, gaps));
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
    visit(child, childPath, gaps);
  }
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host.toLowerCase()}${
    url.pathname.toLowerCase()
  }`;
}

function parseResponseJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error(
      "C6 GitHub GraphQL discovery returned invalid JSON",
    );
  }
}

function requiredUnpadded(value: string, name: string): string {
  if (
    value.length === 0 ||
    value.trim() !== value ||
    (
      (name === "owner" || name === "repo") &&
      !/^[A-Za-z0-9_.-]+$/u.test(value)
    )
  ) {
    throw new Error(`C6 GitHub GraphQL ${name} must not be empty or padded`);
  }
  return value;
}

function resolveCanonicalRepository(input: {
  canonicalOwner?: string;
  canonicalRepo?: string;
  requestedRepository: string;
}): string {
  const hasCanonicalOwner = input.canonicalOwner !== undefined;
  const hasCanonicalRepo = input.canonicalRepo !== undefined;
  if (hasCanonicalOwner !== hasCanonicalRepo) {
    throw new Error(
      "C6 GitHub GraphQL canonical owner and repo must be specified together",
    );
  }
  if (!hasCanonicalOwner || !hasCanonicalRepo) {
    return input.requestedRepository;
  }
  const canonicalRepository = `${
    requiredUnpadded(input.canonicalOwner!, "canonical owner")
  }/${
    requiredUnpadded(input.canonicalRepo!, "canonical repo")
  }`;
  if (
    canonicalRepository.toLowerCase() ===
      input.requestedRepository.toLowerCase()
  ) {
    throw new Error(
      "C6 GitHub GraphQL canonical repository must identify a different repository",
    );
  }
  return canonicalRepository;
}

function selectResponseHeaders(headers: Headers): Record<string, string> {
  const required = Object.fromEntries(
    REQUIRED_RESPONSE_HEADERS.map((name) => {
      const value = headers.get(name);
      if (value === null || value.length === 0) {
        throw new Error(
          `C6 GitHub GraphQL discovery requires response header ${name}`,
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
      "C6 GitHub GraphQL discovery response provenance headers do not match",
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

async function assertOutputDoesNotExist(path: string): Promise<void> {
  try {
    await lstat(path);
    const error = new Error(
      "C6 GitHub GraphQL discovery output already exists",
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

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
