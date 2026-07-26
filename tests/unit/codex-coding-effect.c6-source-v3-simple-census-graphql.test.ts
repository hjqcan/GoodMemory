import { describe, expect, it } from "bun:test";

import {
  C6SourceV3SimpleGraphqlResponseError,
  projectC6SourceV3SimplePullRequestPage,
  projectC6SourceV3SimpleRepositoryCount,
  projectC6SourceV3SimpleRepositoryPage,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-graphql";

const RATE_LIMIT = {
  cost: 1,
  limit: 5_000,
  remaining: 4_999,
  resetAt: "2026-07-26T12:00:00Z",
  used: 1,
};

describe("C6 source-v3-simple GraphQL projectors", () => {
  it("projects the count operation from a strict success envelope", () => {
    expect(projectC6SourceV3SimpleRepositoryCount(
      responseBytes({
        data: {
          rateLimit: RATE_LIMIT,
          search: {
            repositoryCount: 17,
          },
        },
      }),
    )).toEqual({
      rateLimit: RATE_LIMIT,
      repositoryCount: 17,
    });
  });

  it("requires every repository search node to be a real Repository", () => {
    const response = {
      data: {
        rateLimit: RATE_LIMIT,
        search: {
          nodes: [null],
          pageInfo: {
            endCursor: null,
            hasNextPage: false,
          },
          repositoryCount: 1,
        },
      },
    };
    expect(() =>
      projectC6SourceV3SimpleRepositoryPage(
        responseBytes(response),
      )
    ).toThrow("repository page schema");

    response.data.search.nodes = [{
      __typename: "Issue",
    }] as never;
    expect(() =>
      projectC6SourceV3SimpleRepositoryPage(
        responseBytes(response),
      )
    ).toThrow("repository page schema");
  });

  it("binds direct node lookup identity and preserves allowed nulls", () => {
    const projected =
      projectC6SourceV3SimplePullRequestPage({
        body: responseBytes({
          data: {
            node: {
              __typename: "Repository",
              id: "R_expected",
              nameWithOwner: "Owner/Repo",
              pullRequests: {
                nodes: [{
                  author: null,
                  baseRefOid: "a".repeat(40),
                  commits: {
                    totalCount: 2,
                  },
                  createdAt: "2024-01-01T00:00:00Z",
                  id: "PR_1",
                  mergeCommit: null,
                  mergedAt: "2024-01-02T00:00:00Z",
                  number: 1,
                  reviews: {
                    totalCount: 4,
                  },
                  reviewThreads: {
                    totalCount: 2,
                  },
                  url:
                    "https://github.com/Owner/Repo/pull/1",
                }],
                pageInfo: {
                  endCursor: null,
                  hasNextPage: false,
                },
                totalCount: 1,
              },
            },
            rateLimit: RATE_LIMIT,
          },
        }),
        requestedRepositoryNodeId: "R_expected",
      });

    expect(projected.page).toMatchObject({
      nodes: [{
        author: null,
        mergeCommit: null,
      }],
      repositoryNameWithOwner: "Owner/Repo",
      repositoryNodeId: "R_expected",
      totalCount: 1,
    });
    expect(() =>
      projectC6SourceV3SimplePullRequestPage({
        body: responseBytes({
          data: {
            node: {
              __typename: "Repository",
              id: "R_other",
              nameWithOwner: "Owner/Repo",
              pullRequests: {
                nodes: [],
                pageInfo: {
                  endCursor: null,
                  hasNextPage: false,
                },
                totalCount: 0,
              },
            },
            rateLimit: RATE_LIMIT,
          },
        }),
        requestedRepositoryNodeId: "R_expected",
      })
    ).toThrow("repository identity");
  });

  it("never consumes partial data when GraphQL errors are present", () => {
    let thrown: unknown;
    try {
      projectC6SourceV3SimpleRepositoryCount(
        responseBytes({
          data: {
            rateLimit: RATE_LIMIT,
            search: {
              repositoryCount: 999,
            },
          },
          errors: [{
            extensions: {
              type: "RATE_LIMITED",
            },
            message: "transient",
          }],
        }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(
      C6SourceV3SimpleGraphqlResponseError,
    );
    expect(
      (
        thrown as C6SourceV3SimpleGraphqlResponseError
      ).types,
    ).toEqual(["RATE_LIMITED"]);
  });
});

function responseBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}
