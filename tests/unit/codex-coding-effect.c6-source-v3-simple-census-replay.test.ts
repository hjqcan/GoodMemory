import { describe, expect, it } from "bun:test";

import type {
  C6SourceV3SimpleFrameDefinition,
  C6SourceV3SimpleRootShard,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-core";
import {
  replayC6SourceV3SimpleNormalizedPass,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-replay";
import type {
  C6SourceV3SimpleProjectedLogicalRequest,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-replay";
import {
  buildC6SourceV3SimpleDurableGraphqlRequest,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-transport";

const RATE_LIMIT = {
  cost: 1,
  limit: 5_000,
  remaining: 4_999,
  resetAt: "2026-07-26T13:00:00Z",
  used: 1,
};

describe("C6 source-v3-simple deterministic census replay", () => {
  it("rebuilds the complete normalized pass from the ordered projected request ledger", async () => {
    const frame = frameDefinition();
    const requests: C6SourceV3SimpleProjectedLogicalRequest[] = [];
    for (const [index, rootShard] of frame.rootShards.entries()) {
      requests.push(repositoryCount(rootShard.query, index === 0 ? 1 : 0));
      if (index === 0) {
        requests.push(repositoryPage(rootShard));
      }
    }
    requests.push(pullRequestPage());

    const pass = await replayC6SourceV3SimpleNormalizedPass({
      frame,
      requests,
    });

    expect(pass.countTrees).toHaveLength(1_536);
    expect(pass.repositories).toHaveLength(1);
    expect(pass.repositoryDecisions).toEqual([{
      accepted: true,
      canonicalRepository: "example/repository",
      reasons: [],
      repositoryNodeId: "R_repo_1",
    }]);
    expect(pass.pullRequests).toHaveLength(1);
    expect(pass.pullRequestClosures).toEqual([{
      canonicalRepository: "example/repository",
      enumeratedInWindowCount: 1,
      pageCount: 1,
      repositoryNodeId: "R_repo_1",
      skippedAboveUpperBoundCount: 0,
      terminalReason: "connection-exhausted",
      totalMergedPullRequestCount: 1,
    }]);
    expect(pass.metadataDecisions).toHaveLength(1);
  });

  it("rejects a missing or out-of-order projected request instead of accepting a self-reported pass", async () => {
    const frame = frameDefinition();
    const requests = frame.rootShards.map((rootShard) =>
      repositoryCount(rootShard.query, 0)
    );
    await expect(
      replayC6SourceV3SimpleNormalizedPass({
        frame,
        requests: requests.slice(0, -1),
      }),
    ).rejects.toThrow("projected request ledger exhausted");

    const outOfOrder = [...requests];
    outOfOrder[0] = repositoryCount(
      frame.rootShards[1]!.query,
      0,
    );
    await expect(
      replayC6SourceV3SimpleNormalizedPass({
        frame,
        requests: outOfOrder,
      }),
    ).rejects.toThrow("durable request sequence mismatch");
  });
});

function frameDefinition(): C6SourceV3SimpleFrameDefinition {
  return {
    frozenPreWave3AnchorExclusions: [],
    frozenPreWave3RepositoryExclusions: [],
    priorRepositoryAliases: [],
    priorRepositoryNodeIds: [],
    rootShards: Array.from(
      { length: 1_536 },
      (_, index): C6SourceV3SimpleRootShard => {
        const rootShardId =
          `ts:test-${String(index).padStart(4, "0")}`;
        return {
          createdFrom: "2020-01-01T00:00:00Z",
          createdTo: "2020-01-01T00:00:03Z",
          language: "TypeScript",
          query:
            "language:TypeScript " +
            "created:2020-01-01T00:00:00Z..2020-01-01T00:00:03Z " +
            "pushed:>=2024-01-01 is:public archived:false " +
            "mirror:false template:false " +
            `topic:${rootShardId}`,
          rootShardId,
          split: "ts",
        };
      },
    ),
  };
}

function repositoryCount(
  query: string,
  repositoryCount: number,
): C6SourceV3SimpleProjectedLogicalRequest {
  return {
    operationName:
      "C6SourceV3SimpleRepositoryCount",
    request:
      buildC6SourceV3SimpleDurableGraphqlRequest({
        operation: "repositoryCount",
        variables: { query },
      }),
    result: {
      rateLimit: RATE_LIMIT,
      repositoryCount,
    },
  };
}

function repositoryPage(
  rootShard: C6SourceV3SimpleRootShard,
): C6SourceV3SimpleProjectedLogicalRequest {
  return {
    operationName:
      "C6SourceV3SimpleRepositoryPage",
    request:
      buildC6SourceV3SimpleDurableGraphqlRequest({
        operation: "repositoryPage",
        variables: {
          after: null,
          query: rootShard.query,
        },
      }),
    result: {
      page: {
        nodes: [{
          createdAt: "2020-01-01T00:00:01Z",
          id: "R_repo_1",
          isArchived: false,
          isFork: false,
          isMirror: false,
          isTemplate: false,
          nameWithOwner: "Example/Repository",
          primaryLanguage: {
            name: "TypeScript",
          },
          pushedAt: "2024-06-01T00:00:00Z",
          visibility: "PUBLIC",
        }],
        pageInfo: {
          endCursor: null,
          hasNextPage: false,
        },
        repositoryCount: 1,
      },
      rateLimit: RATE_LIMIT,
    },
  };
}

function pullRequestPage():
  C6SourceV3SimpleProjectedLogicalRequest {
  return {
    operationName:
      "C6SourceV3SimplePullRequestPage",
    request:
      buildC6SourceV3SimpleDurableGraphqlRequest({
        operation: "pullRequestPage",
        variables: {
          after: null,
          repositoryNodeId: "R_repo_1",
        },
      }),
    result: {
      page: {
        nodes: [{
          author: {
            login: "octocat",
          },
          baseRefOid: "1".repeat(40),
          commits: {
            totalCount: 1,
          },
          createdAt: "2023-01-01T00:00:00Z",
          id: "PR_node_1",
          mergeCommit: {
            oid: "2".repeat(40),
          },
          mergedAt: "2023-01-02T00:00:00Z",
          number: 1,
          reviews: {
            totalCount: 1,
          },
          reviewThreads: {
            totalCount: 1,
          },
          url: "https://github.com/Example/Repository/pull/1",
        }],
        pageInfo: {
          endCursor: null,
          hasNextPage: false,
        },
        repositoryNameWithOwner:
          "Example/Repository",
        repositoryNodeId: "R_repo_1",
        totalCount: 1,
      },
      rateLimit: RATE_LIMIT,
    },
  };
}
