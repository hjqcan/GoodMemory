import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  captureC6GitHubGraphQLDiscovery,
  C6_GITHUB_GRAPHQL_DISCOVERY_QUERY,
} from "../../scripts/codex-coding-effect/c6-github-graphql-discovery";
import {
  parseC6GitHubGraphQLDiscoveryCliOptions,
  runC6GitHubGraphQLDiscoveryCaptureCommand,
} from "../../scripts/capture-codex-coding-effect-c6-github-graphql-discovery";

const TOKEN = "github-token-that-must-never-be-persisted";

describe("Codex coding-effect C6 GitHub GraphQL discovery", () => {
  it("pins every requested connection and provenance field in one query", () => {
    expect(
      C6_GITHUB_GRAPHQL_DISCOVERY_QUERY.match(/\(first: 100\)/gu),
    ).toHaveLength(7);
    for (const field of [
      "baseRefName",
      "baseRefOid",
      "headRefName",
      "headRefOid",
      "mergeCommit",
      "closingIssuesReferences(first: 100)",
      "comments(first: 100)",
      "commits(first: 100)",
      "parents(first: 100)",
      "reviews(first: 100)",
      "reviewThreads(first: 100)",
      "originalCommit",
      "commit",
      "rateLimit",
      "cost",
      "remaining",
      "resetAt",
      "hasNextPage",
      "endCursor",
    ]) {
      expect(C6_GITHUB_GRAPHQL_DISCOVERY_QUERY).toContain(field);
    }
  });

  it("captures one fixed request and exact response without persisting the token", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c6-graphql-"));
    try {
      const outputDirectory = join(root, "capture");
      const responseBytes = Buffer.from(JSON.stringify(buildResponse()));
      let observedRequest:
        | { init: RequestInit; url: string }
        | undefined;
      const capture = await captureC6GitHubGraphQLDiscovery({
        fetchImpl: async (url, init) => {
          observedRequest = { init, url };
          return graphqlResponse(responseBytes, {
            headers: {
              etag: "\"discovery-etag\"",
              "x-unselected-header": "not-persisted",
            },
          });
        },
        outputDirectory,
        owner: "example",
        pullNumber: 7,
        repo: "project",
        token: TOKEN,
      });

      expect(observedRequest?.url).toBe("https://api.github.com/graphql");
      expect(observedRequest?.init.method).toBe("POST");
      expect(observedRequest?.init.redirect).toBe("error");
      expect(observedRequest?.init.headers).toEqual({
        accept: "application/vnd.github+json",
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        "user-agent": "GoodMemory-C6-GraphQL-Discovery/1",
        "x-github-api-version": "2022-11-28",
      });
      const requestBody = String(observedRequest?.init.body);
      expect(JSON.parse(requestBody)).toEqual({
        query: C6_GITHUB_GRAPHQL_DISCOVERY_QUERY,
        variables: {
          name: "project",
          number: 7,
          owner: "example",
        },
      });
      expect(await readFile(join(outputDirectory, "request.json"), "utf8"))
        .toBe(requestBody);
      expect(await readFile(join(outputDirectory, "response.json"))).toEqual(
        responseBytes,
      );
      expect(JSON.parse(await readFile(
        join(outputDirectory, "response-headers.json"),
        "utf8",
      ))).toEqual({
        "content-type": "application/json; charset=utf-8",
        date: "Sat, 25 Jul 2026 12:00:00 GMT",
        etag: "\"discovery-etag\"",
        "x-github-request-id": "request-id",
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "4999",
        "x-ratelimit-reset": "1784995200",
        "x-ratelimit-resource": "graphql",
        "x-ratelimit-used": "1",
      });
      expect(capture.boundary).toEqual({
        acceptedEpisodeCount: 0,
        candidateManifestFrozen: false,
        status: "single-pr-graphql-discovery-not-accepted-evidence",
        upperBoundClaimPermitted: false,
      });
      expect(capture.discovery).toMatchObject({
        discoverySurfaceComplete: true,
        paginationGaps: [],
        rateLimit: {
          cost: 1,
          remaining: 4_999,
          resetAt: "2026-07-25T12:00:00Z",
        },
      });
      expect(capture.response.body).toEqual({
        bytes: responseBytes.byteLength,
        path: "response.json",
        sha256: sha256(responseBytes),
      });
      for (const filename of await readdir(outputDirectory)) {
        expect(await readFile(join(outputDirectory, filename), "utf8"))
          .not.toContain(TOKEN);
      }

      await expect(captureC6GitHubGraphQLDiscovery({
        fetchImpl: async () => {
          throw new Error("existing output must prevent a network request");
        },
        outputDirectory,
        owner: "example",
        pullNumber: 7,
        repo: "project",
        token: TOKEN,
      })).rejects.toMatchObject({ code: "EEXIST" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("lists every top-level and nested pagination gap and forbids upper-bound claims", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c6-graphql-"));
    try {
      const response = buildResponse();
      response.data.repository.pullRequest.comments.pageInfo = {
        endCursor: "discussion-cursor",
        hasNextPage: true,
      };
      response.data.repository.pullRequest.commits.nodes[0]!
        .commit.parents.pageInfo = {
          endCursor: "parent-cursor",
          hasNextPage: true,
        };
      const capture = await captureC6GitHubGraphQLDiscovery({
        fetchImpl: async () =>
          graphqlResponse(JSON.stringify(response)),
        outputDirectory: join(root, "capture"),
        owner: "example",
        pullNumber: 7,
        repo: "project",
        token: TOKEN,
      });

      expect(capture.discovery).toMatchObject({
        discoverySurfaceComplete: false,
        paginationGaps: [{
          endCursor: "discussion-cursor",
          path: "data.repository.pullRequest.comments.pageInfo",
        }, {
          endCursor: "parent-cursor",
          path:
            "data.repository.pullRequest.commits.nodes[0].commit.parents.pageInfo",
        }],
      });
      expect(capture.boundary.upperBoundClaimPermitted).toBe(false);
      expect(capture.boundary.acceptedEpisodeCount).toBe(0);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("fails before writing on GraphQL errors, identity drift, or token reflection", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c6-graphql-"));
    try {
      const graphqlErrorOutput = join(root, "graphql-error");
      await expect(captureC6GitHubGraphQLDiscovery({
        fetchImpl: async () =>
          graphqlResponse(JSON.stringify({
            data: null,
            errors: [{ message: "query failed" }],
          })),
        outputDirectory: graphqlErrorOutput,
        owner: "example",
        pullNumber: 7,
        repo: "project",
        token: TOKEN,
      })).rejects.toThrow("returned GraphQL errors");

      const identityDrift = buildResponse();
      identityDrift.data.repository.nameWithOwner = "other/project";
      const identityOutput = join(root, "identity-drift");
      await expect(captureC6GitHubGraphQLDiscovery({
        fetchImpl: async () =>
          graphqlResponse(JSON.stringify(identityDrift)),
        outputDirectory: identityOutput,
        owner: "example",
        pullNumber: 7,
        repo: "project",
        token: TOKEN,
      })).rejects.toThrow("repository identity mismatch");

      const reflectedToken = {
        ...buildResponse(),
        reflectedToken: TOKEN,
      };
      const tokenOutput = join(root, "token-reflection");
      await expect(captureC6GitHubGraphQLDiscovery({
        fetchImpl: async () =>
          graphqlResponse(JSON.stringify(reflectedToken)),
        outputDirectory: tokenOutput,
        owner: "example",
        pullNumber: 7,
        repo: "project",
        token: TOKEN,
      })).rejects.toThrow("refuses to persist the GitHub token");

      await expect(readdir(root)).resolves.toEqual([]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("accepts a repository transfer only through an explicit redirect binding", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c6-graphql-"));
    try {
      const redirected = buildResponse();
      redirected.data.repository.nameWithOwner = "new-owner/project";
      redirected.data.repository.pullRequest.baseRepository.nameWithOwner =
        "new-owner/project";
      redirected.data.repository.pullRequest.url =
        "https://github.com/new-owner/project/pull/7";

      const capture = await captureC6GitHubGraphQLDiscovery({
        canonicalOwner: "new-owner",
        canonicalRepo: "project",
        fetchImpl: async () =>
          graphqlResponse(JSON.stringify(redirected)),
        outputDirectory: join(root, "accepted"),
        owner: "old-owner",
        pullNumber: 7,
        repo: "project",
        token: TOKEN,
      });

      expect(capture.request.variables).toEqual({
        name: "project",
        number: 7,
        owner: "old-owner",
      });
      expect(capture.target).toEqual({
        pullNumber: 7,
        repository: "new-owner/project",
        repositoryRedirect: {
          requestedRepository: "old-owner/project",
          resolvedRepository: "new-owner/project",
          status: "explicit-graphql-resolution-observed",
        },
        url: "https://github.com/new-owner/project/pull/7",
      });

      await expect(captureC6GitHubGraphQLDiscovery({
        canonicalOwner: "wrong-owner",
        canonicalRepo: "project",
        fetchImpl: async () =>
          graphqlResponse(JSON.stringify(redirected)),
        outputDirectory: join(root, "wrong-binding"),
        owner: "old-owner",
        pullNumber: 7,
        repo: "project",
        token: TOKEN,
      })).rejects.toThrow("repository identity mismatch");

      await expect(captureC6GitHubGraphQLDiscovery({
        canonicalOwner: "old-owner",
        canonicalRepo: "project",
        fetchImpl: async () =>
          graphqlResponse(JSON.stringify(buildResponse())),
        outputDirectory: join(root, "redundant-binding"),
        owner: "old-owner",
        pullNumber: 7,
        repo: "project",
        token: TOKEN,
      })).rejects.toThrow("must identify a different repository");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects missing or untrusted response provenance headers before writing", async () => {
    const mutations: ReadonlyArray<Readonly<Record<string, string | null>>> = [
      { "content-type": "text/html" },
      { date: null },
      { "x-github-request-id": null },
      { "x-ratelimit-limit": null },
      { "x-ratelimit-remaining": null },
      { "x-ratelimit-reset": null },
      { "x-ratelimit-resource": "core" },
      { "x-ratelimit-used": null },
    ];
    for (const [index, headers] of mutations.entries()) {
      const root = await mkdtemp(join(tmpdir(), "goodmemory-c6-graphql-"));
      try {
        const outputDirectory = join(root, "capture");
        await expect(captureC6GitHubGraphQLDiscovery({
          fetchImpl: async () =>
            graphqlResponse(JSON.stringify(buildResponse()), { headers }),
          outputDirectory,
          owner: "example",
          pullNumber: 7,
          repo: "project",
          token: TOKEN,
        })).rejects.toThrow();
        await expect(readdir(outputDirectory)).rejects.toMatchObject({
          code: "ENOENT",
        });
      } catch (error) {
        throw new Error(`GraphQL header mutation ${index} did not fail closed`, {
          cause: error,
        });
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    }
  });

  it("accepts the token only from GITHUB_TOKEN at the CLI boundary", async () => {
    expect(() =>
      parseC6GitHubGraphQLDiscoveryCliOptions([
        "--owner=example",
        "--repo=project",
        "--pull-number=7",
        "--output-dir=/evidence/capture",
        "--token=forbidden",
      ])
    ).toThrow("unknown C6 GitHub GraphQL discovery option --token");

    const args = [
      "--owner=example",
      "--repo=project",
      "--pull-number=7",
      "--output-dir=/evidence/capture",
    ];
    let networkCalls = 0;
    await expect(runC6GitHubGraphQLDiscoveryCaptureCommand(args, {
      env: {},
      fetchImpl: async () => {
        networkCalls += 1;
        return new Response();
      },
    })).rejects.toThrow("GITHUB_TOKEN is required");
    expect(networkCalls).toBe(0);

    expect(() =>
      parseC6GitHubGraphQLDiscoveryCliOptions([
        "--owner=old-owner",
        "--repo=project",
        "--canonical-owner=new-owner",
        "--pull-number=7",
        "--output-dir=/evidence/capture",
      ])
    ).toThrow(
      "--canonical-owner and --canonical-repo must be specified together",
    );

    const root = await mkdtemp(join(tmpdir(), "goodmemory-c6-graphql-cli-"));
    try {
      let authorization = "";
      const result = await runC6GitHubGraphQLDiscoveryCaptureCommand([
        "--owner=example",
        "--repo=project",
        "--pull-number=7",
        `--output-dir=${join(root, "capture")}`,
      ], {
        env: { GITHUB_TOKEN: TOKEN },
        fetchImpl: async (_url, init) => {
          authorization = (
            init.headers as Record<string, string>
          ).authorization;
          return graphqlResponse(JSON.stringify(buildResponse()));
        },
      });

      expect(authorization).toBe(`Bearer ${TOKEN}`);
      expect(result).toMatchObject({
        discoverySurfaceComplete: true,
        outputDirectory: join(root, "capture"),
        paginationGapCount: 0,
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function buildResponse() {
  const pageInfo = (): {
    endCursor: string | null;
    hasNextPage: boolean;
  } => ({
    endCursor: null,
    hasNextPage: false,
  });
  return {
    data: {
      rateLimit: {
        cost: 1,
        remaining: 4_999,
        resetAt: "2026-07-25T12:00:00Z",
      },
      repository: {
        nameWithOwner: "example/project",
        pullRequest: {
          baseRepository: {
            nameWithOwner: "example/project",
          },
          baseRefName: "main",
          baseRefOid: "0".repeat(40),
          closingIssuesReferences: {
            nodes: [],
            pageInfo: pageInfo(),
          },
          comments: {
            nodes: [],
            pageInfo: pageInfo(),
          },
          commits: {
            nodes: [{
              commit: {
                committedDate: "2026-07-20T12:00:00Z",
                oid: "1".repeat(40),
                parents: {
                  nodes: [{ oid: "0".repeat(40) }],
                  pageInfo: pageInfo(),
                },
              },
            }],
            pageInfo: pageInfo(),
          },
          headRefName: "feature",
          headRefOid: "1".repeat(40),
          mergeCommit: null,
          merged: false,
          mergedAt: null,
          number: 7,
          reviewThreads: {
            nodes: [{
              comments: {
                nodes: [],
                pageInfo: pageInfo(),
              },
              id: "thread-id",
              isResolved: false,
            }],
            pageInfo: pageInfo(),
          },
          reviews: {
            nodes: [],
            pageInfo: pageInfo(),
          },
          url: "https://github.com/example/project/pull/7",
        },
      },
    },
  };
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function graphqlResponse(
  body: BodyInit,
  options: {
    headers?: Readonly<Record<string, string | null>>;
    status?: number;
  } = {},
): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    date: "Sat, 25 Jul 2026 12:00:00 GMT",
    "x-github-request-id": "request-id",
    "x-ratelimit-limit": "5000",
    "x-ratelimit-remaining": "4999",
    "x-ratelimit-reset": "1784995200",
    "x-ratelimit-resource": "graphql",
    "x-ratelimit-used": "1",
  });
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (value === null) {
      headers.delete(name);
    } else {
      headers.set(name, value);
    }
  }
  return new Response(body, {
    headers,
    status: options.status ?? 200,
  });
}
