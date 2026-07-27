import { describe, expect, it } from "bun:test";

import type {
  C6SourceV3SimpleFrameDefinition,
  C6SourceV3SimpleRootShard,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-core";
import type {
  C6SourceV3SimpleProjectedLogicalRequest,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-replay";
import {
  buildC6SourceV3SimpleDurableGraphqlRequest,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-transport";
import {
  collectC6SourceV4BoundedRepositoryPrefixProjection,
  replayC6SourceV4BoundedRepositoryPrefix,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-v3-observation";

const RATE_LIMIT = {
  cost: 1,
  limit: 5_000,
  remaining: 4_999,
  resetAt: "2026-07-27T13:00:00Z",
  used: 1,
};

describe("C6 source-v4 bounded v3 observation import", () => {
  it("replays only the closed repository prefix", async () => {
    const frame = frameDefinition();
    const requests = repositoryRequests(frame);

    const result =
      await collectC6SourceV4BoundedRepositoryPrefixProjection({
        frame,
        requests,
      });

    expect(result.countTrees).toHaveLength(1_536);
    expect(result.repositoryLeafClosures).toHaveLength(
      1_536,
    );
    expect(result.repositories).toHaveLength(1);
    expect(result.frameRepositories).toEqual([
      expect.objectContaining({
        repositoryNodeId: "R_repo_1",
        sourceSplit: "ts",
      }),
    ]);
    expect(result.repositoryDecisions).toEqual([{
      accepted: true,
      canonicalRepository: "example/repository",
      reasons: [],
      repositoryNodeId: "R_repo_1",
    }]);
    expect(result.logicalRequestCount).toBe(1_537);
  });

  it("rejects missing, reordered, trailing PR, and duplicate repository evidence", async () => {
    const frame = frameDefinition();
    const requests = repositoryRequests(frame);

    await expect(
      collectC6SourceV4BoundedRepositoryPrefixProjection({
        frame,
        requests: requests.slice(0, -1),
      }),
    ).rejects.toThrow("ledger exhausted");

    const reordered = [...requests];
    [reordered[0], reordered[1]] = [
      reordered[1]!,
      reordered[0]!,
    ];
    await expect(
      collectC6SourceV4BoundedRepositoryPrefixProjection({
        frame,
        requests: reordered,
      }),
    ).rejects.toThrow("request sequence mismatch");

    await expect(
      collectC6SourceV4BoundedRepositoryPrefixProjection({
        frame,
        requests: [...requests, pullRequestPage()],
      }),
    ).rejects.toThrow("trailing requests");

    const duplicateFrame = frameDefinition({
      secondRepository: true,
    });
    await expect(
      collectC6SourceV4BoundedRepositoryPrefixProjection({
        frame: duplicateFrame,
        requests: repositoryRequests(
          duplicateFrame,
          true,
        ),
      }),
    ).rejects.toThrow("duplicate repository node ID");

    await expect(
      collectC6SourceV4BoundedRepositoryPrefixProjection({
        frame: {
          ...frame,
          rootShards: [],
        },
        requests: [],
      }),
    ).rejects.toThrow("exactly 1,536");

    await expect(
      replayC6SourceV4BoundedRepositoryPrefix({
        frame,
        requests,
      }),
    ).rejects.toThrow("historical v3 frame");
  });
});

function frameDefinition(
  input: {
    secondRepository?: boolean;
  } = {},
): C6SourceV3SimpleFrameDefinition {
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
            "created:2020-01-01T00:00:00Z.." +
            "2020-01-01T00:00:03Z " +
            "pushed:>=2024-01-01 is:public " +
            "archived:false mirror:false template:false " +
            `topic:${rootShardId}`,
          rootShardId,
          split: "ts",
        };
      },
    ),
  };
}

function repositoryRequests(
  frame: C6SourceV3SimpleFrameDefinition,
  secondRepository = false,
): C6SourceV3SimpleProjectedLogicalRequest[] {
  const requests:
    C6SourceV3SimpleProjectedLogicalRequest[] = [];
  for (const [index, rootShard] of
    frame.rootShards.entries()) {
    const hasRepository =
      index === 0 ||
      (secondRepository && index === 1);
    requests.push(
      repositoryCount(
        rootShard.query,
        hasRepository ? 1 : 0,
      ),
    );
    if (hasRepository) {
      requests.push(repositoryPage(rootShard));
    }
  }
  return requests;
}

function repositoryCount(
  query: string,
  repositoryCountValue: number,
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
      repositoryCount: repositoryCountValue,
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
        nodes: [],
        pageInfo: {
          endCursor: null,
          hasNextPage: false,
        },
        repositoryNameWithOwner:
          "Example/Repository",
        repositoryNodeId: "R_repo_1",
        totalCount: 0,
      },
      rateLimit: RATE_LIMIT,
    },
  };
}
