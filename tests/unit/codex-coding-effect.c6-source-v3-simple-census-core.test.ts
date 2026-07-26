import { describe, expect, it } from "bun:test";

import {
  assertC6SourceV3SimpleTwoPassEquality,
  buildC6SourceV3SimpleCountTree,
  classifyC6SourceV3SimplePullRequests,
  classifyC6SourceV3SimpleRepositories,
  enumerateC6SourceV3SimplePullRequests,
  enumerateC6SourceV3SimpleRepositories,
  hashC6SourceV3SimpleNormalizedProjection,
  normalizeC6SourceV3SimplePullRequestRows,
  verifyC6SourceV3SimpleNormalizedPass,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-core";
import type {
  C6SourceV3SimpleNormalizedPass,
  C6SourceV3SimplePullRequestNode,
  C6SourceV3SimpleRepositoryNode,
  C6SourceV3SimpleRootShard,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-core";

const ROOT_SHARD: C6SourceV3SimpleRootShard = {
  createdFrom: "2020-01-01T00:00:00Z",
  createdTo: "2020-01-01T00:00:03Z",
  language: "TypeScript",
  query:
    "language:TypeScript " +
    "created:2020-01-01T00:00:00Z..2020-01-01T00:00:03Z " +
    "pushed:>=2024-01-01 is:public archived:false " +
    "mirror:false template:false",
  rootShardId: "ts:2020-01-01",
  split: "ts",
};
const CENSUS_ROOT_SHARDS = [
  ROOT_SHARD,
  ...Array.from({ length: 1_535 }, (_, index) => ({
    ...ROOT_SHARD,
    rootShardId:
      `zz:test-${String(index).padStart(4, "0")}`,
  })),
];
const CENSUS_FRAME = {
  frozenPreWave3AnchorExclusions: [] as string[],
  frozenPreWave3RepositoryExclusions: [] as string[],
  priorRepositoryAliases: [] as string[],
  priorRepositoryNodeIds: [] as string[],
  rootShards: CENSUS_ROOT_SHARDS,
};

describe("C6 source-v3-simple census core", () => {
  it("recursively closes an overflowing shard with deterministic UTC-second leaves", async () => {
    const counts = new Map([
      [
        "2020-01-01T00:00:00Z..2020-01-01T00:00:03Z",
        1_200,
      ],
      [
        "2020-01-01T00:00:00Z..2020-01-01T00:00:01Z",
        400,
      ],
      [
        "2020-01-01T00:00:02Z..2020-01-01T00:00:03Z",
        800,
      ],
    ]);
    const queries: string[] = [];

    const result = await buildC6SourceV3SimpleCountTree({
      probe: async (request) => {
        queries.push(request.query);
        return counts.get(
          `${request.createdFrom}..${request.createdTo}`,
        )!;
      },
      rootShard: ROOT_SHARD,
    });

    expect(result.nodes.map((node) => ({
      count: node.count,
      createdFrom: node.createdFrom,
      createdTo: node.createdTo,
      depth: node.depth,
      leaf: node.leaf,
    }))).toEqual([
      {
        count: 1_200,
        createdFrom: "2020-01-01T00:00:00Z",
        createdTo: "2020-01-01T00:00:03Z",
        depth: 0,
        leaf: false,
      },
      {
        count: 400,
        createdFrom: "2020-01-01T00:00:00Z",
        createdTo: "2020-01-01T00:00:01Z",
        depth: 1,
        leaf: true,
      },
      {
        count: 800,
        createdFrom: "2020-01-01T00:00:02Z",
        createdTo: "2020-01-01T00:00:03Z",
        depth: 1,
        leaf: true,
      },
    ]);
    expect(result.leaves.map((leaf) => leaf.count)).toEqual([
      400,
      800,
    ]);
    expect(queries).toHaveLength(3);
    expect(queries[1]).toContain(
      "created:2020-01-01T00:00:00Z.." +
        "2020-01-01T00:00:01Z",
    );
    expect(queries[2]).toContain(
      "created:2020-01-01T00:00:02Z.." +
        "2020-01-01T00:00:03Z",
    );
  });

  it("fails closed when one UTC second still exceeds the accessible cap", async () => {
    await expect(
      buildC6SourceV3SimpleCountTree({
        probe: async () => 1_001,
        rootShard: {
          ...ROOT_SHARD,
          createdTo: ROOT_SHARD.createdFrom,
          query: ROOT_SHARD.query.replace(
            ROOT_SHARD.createdTo,
            ROOT_SHARD.createdFrom,
          ),
        },
      }),
    ).rejects.toThrow("single UTC second");
  });

  it("fails closed when live child counts do not close their parent", async () => {
    await expect(
      buildC6SourceV3SimpleCountTree({
        probe: async ({ createdFrom, createdTo }) => {
          if (
            createdFrom === ROOT_SHARD.createdFrom &&
            createdTo === ROOT_SHARD.createdTo
          ) {
            return 1_200;
          }
          return createdFrom === ROOT_SHARD.createdFrom
            ? 400
            : 799;
        },
        rootShard: ROOT_SHARD,
      }),
    ).rejects.toThrow("child total");
  });

  it("enumerates every leaf row and rejects prior aliases and node IDs before PR capture", async () => {
    const leaf = {
      count: 3,
      createdFrom: ROOT_SHARD.createdFrom,
      createdTo: ROOT_SHARD.createdTo,
      depth: 0,
      leaf: true as const,
      query: ROOT_SHARD.query,
    };
    const nodes = [
      repositoryNode({
        id: "R_new",
        nameWithOwner: "new/repository",
      }),
      repositoryNode({
        id: "R_prior_id",
        nameWithOwner: "renamed/repository",
      }),
      repositoryNode({
        id: "R_recreated",
        nameWithOwner: "Prior/Alias",
      }),
    ];
    let calls = 0;

    const repositoryCapture =
      await enumerateC6SourceV3SimpleRepositories({
        leaves: [leaf],
        page: async ({ afterCursor }) => {
          calls += 1;
          expect(afterCursor).toBeNull();
          return {
            nodes,
            pageInfo: {
              endCursor: null,
              hasNextPage: false,
            },
            repositoryCount: 3,
          };
        },
        rootShard: ROOT_SHARD,
      });
    const observations = repositoryCapture.rows;
    const classified = classifyC6SourceV3SimpleRepositories({
      observations,
      priorRepositoryAliases: ["prior/alias"],
      priorRepositoryNodeIds: ["R_prior_id"],
    });

    expect(calls).toBe(1);
    expect(repositoryCapture.closures).toEqual([{
      expectedRepositoryCount: 3,
      leafCreatedFrom: ROOT_SHARD.createdFrom,
      leafCreatedTo: ROOT_SHARD.createdTo,
      pageCount: 1,
      rootShardId: ROOT_SHARD.rootShardId,
      terminalReason: "connection-exhausted",
    }]);
    expect(observations.map((row) => row.repositoryNodeId)).toEqual([
      "R_new",
      "R_prior_id",
      "R_recreated",
    ]);
    expect(classified.frameRepositories.map(
      (row) => row.repositoryNodeId,
    )).toEqual(["R_new"]);
    expect(classified.decisions).toEqual([
      {
        accepted: true,
        canonicalRepository: "new/repository",
        reasons: [],
        repositoryNodeId: "R_new",
      },
      {
        accepted: false,
        canonicalRepository: "renamed/repository",
        reasons: ["prior-repository-node-id"],
        repositoryNodeId: "R_prior_id",
      },
      {
        accepted: false,
        canonicalRepository: "prior/alias",
        reasons: ["prior-repository-alias"],
        repositoryNodeId: "R_recreated",
      },
    ]);
  });

  it("fails closed on a repeated repository node across the global frame", () => {
    const row = {
      ...repositoryNode({
        id: "R_duplicate",
        nameWithOwner: "owner/repository",
      }),
      leafCreatedFrom: ROOT_SHARD.createdFrom,
      leafCreatedTo: ROOT_SHARD.createdTo,
      repositoryNodeId: "R_duplicate",
      rootShardId: ROOT_SHARD.rootShardId,
      sourceSplit: ROOT_SHARD.split,
    };

    expect(() =>
      classifyC6SourceV3SimpleRepositories({
        observations: [
          row,
          {
            ...row,
            rootShardId: "ts:2020-01-15",
          },
        ],
        priorRepositoryAliases: [],
        priorRepositoryNodeIds: [],
      })
    ).toThrow("duplicate repository node ID");
  });

  it("retains upper-bound receipts and stops only on a strictly older PR witness", async () => {
    const repository = repositoryNode({
      id: "R_new",
      nameWithOwner: "New/Repository",
    });
    const pages: Array<{
      afterCursor: string | null;
    }> = [];

    const result =
      await enumerateC6SourceV3SimplePullRequests({
        page: async ({ afterCursor }) => {
          pages.push({ afterCursor });
          return {
            nodes: [
              pullRequestNode({
                createdAt: "2026-01-01T00:00:00Z",
                id: "PR_upper",
                number: 30,
              }),
              pullRequestNode({
                createdAt: "2025-12-31T23:59:59Z",
                id: "PR_in_window",
                number: 20,
              }),
              pullRequestNode({
                createdAt: "2021-12-31T23:59:59Z",
                id: "PR_older_witness",
                number: 10,
              }),
            ],
            pageInfo: {
              endCursor: "unused-next-page",
              hasNextPage: true,
            },
            repositoryNameWithOwner: "New/Repository",
            repositoryNodeId: "R_new",
            totalCount: 300,
          };
        },
        repository,
      });

    expect(pages).toEqual([{ afterCursor: null }]);
    expect(result.rows.map((row) => row.pullRequestNodeId)).toEqual([
      "PR_in_window",
    ]);
    expect(result.rows[0]!.canonicalRepository).toBe(
      "new/repository",
    );
    expect(result.closure).toEqual({
      canonicalRepository: "new/repository",
      enumeratedInWindowCount: 1,
      pageCount: 1,
      repositoryNodeId: "R_new",
      skippedAboveUpperBoundCount: 1,
      terminalReason: "strictly-older-createdAt-witness",
      totalMergedPullRequestCount: 300,
    });
  });

  it("rejects two different PR node IDs for the same canonical repository and number", async () => {
    const repository = repositoryNode({
      id: "R_case",
      nameWithOwner: "Owner/Repository",
    });

    await expect(
      enumerateC6SourceV3SimplePullRequests({
        page: async () => ({
          nodes: [
            pullRequestNode({
              id: "PR_first",
              number: 7,
            }),
            pullRequestNode({
              createdAt: "2023-12-31T00:00:00Z",
              id: "PR_second",
              number: 7,
            }),
          ],
          pageInfo: {
            endCursor: null,
            hasNextPage: false,
          },
          repositoryNameWithOwner: "Owner/Repository",
          repositoryNodeId: "R_case",
          totalCount: 2,
        }),
        repository,
      }),
    ).rejects.toThrow("duplicate canonical pull request");
  });

  it("records one frozen metadata decision per normalized PR and rejects pass drift", () => {
    const rows = [
      normalizedPullRequest({
        canonicalAnchorId: "new/repository#20",
        pullRequestNodeId: "PR_20",
      }),
      normalizedPullRequest({
        canonicalAnchorId: "new/repository#21",
        commitTotalCount: 251,
        number: 21,
        pullRequestNodeId: "PR_21",
      }),
    ];
    const decisions = classifyC6SourceV3SimplePullRequests({
      frozenPreWave3AnchorExclusions: [],
      frozenPreWave3RepositoryExclusions: [],
      pullRequests: rows,
    });

    expect(decisions).toEqual([
      {
        accepted: true,
        canonicalAnchorId: "new/repository#20",
        canonicalRepository: "new/repository",
        pullRequestNodeId: "PR_20",
        reasons: [],
      },
      {
        accepted: false,
        canonicalAnchorId: "new/repository#21",
        canonicalRepository: "new/repository",
        pullRequestNodeId: "PR_21",
        reasons: ["commit-total-count-above-maximum"],
      },
    ]);

    const pass = normalizedPass(rows, decisions);
    expect(
      verifyC6SourceV3SimpleNormalizedPass(
        pass,
        CENSUS_FRAME,
      ),
    ).toEqual(pass);
    expect(() =>
      verifyC6SourceV3SimpleNormalizedPass(
        {
          ...pass,
          unexpected: true,
        },
        CENSUS_FRAME,
      )
    ).toThrow();
    expect(
      assertC6SourceV3SimpleTwoPassEquality({
        first: pass,
        frame: CENSUS_FRAME,
        second: structuredClone(pass),
      }),
    ).toMatchObject({
      equal: true,
      normalizedProjectionSha256:
        expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const differentCaptureShape = structuredClone(pass);
    differentCaptureShape.countTrees[0]!.nodes[0]!.query +=
      " capture-pass-b";
    differentCaptureShape.countTrees[0]!.leaves[0]!.query +=
      " capture-pass-b";
    expect(() =>
      assertC6SourceV3SimpleTwoPassEquality({
        first: pass,
        frame: CENSUS_FRAME,
        second: differentCaptureShape,
      })
    ).toThrow("count tree");
    const missingLedger = structuredClone(pass);
    missingLedger.metadataDecisions = [];
    expect(() =>
      assertC6SourceV3SimpleTwoPassEquality({
        first: missingLedger,
        frame: CENSUS_FRAME,
        second: structuredClone(missingLedger),
      })
    ).toThrow("metadata decision ledger");
    const drifted = structuredClone(pass);
    drifted.pullRequests[0]!.reviewCount += 1;
    expect(() =>
      assertC6SourceV3SimpleTwoPassEquality({
        first: pass,
        frame: CENSUS_FRAME,
        second: drifted,
      })
    ).toThrow("two-pass normalized projection mismatch");
  });

  it("rejects malformed older-witness pages before early termination", async () => {
    const repository = repositoryNode({
      id: "R_new",
      nameWithOwner: "new/repository",
    });
    const olderNodes = [
      pullRequestNode({
        createdAt: "2021-12-31T23:59:59Z",
        id: "PR_older_1",
        number: 1,
      }),
      pullRequestNode({
        createdAt: "2021-12-30T23:59:59Z",
        id: "PR_older_2",
        number: 2,
      }),
    ];

    await expect(
      enumerateC6SourceV3SimplePullRequests({
        page: async () => ({
          nodes: olderNodes,
          pageInfo: {
            endCursor: null,
            hasNextPage: false,
          },
          repositoryNameWithOwner: "new/repository",
          repositoryNodeId: "R_new",
          totalCount: 1,
        }),
        repository,
      }),
    ).rejects.toThrow("page count exceeds totalCount");

    await expect(
      enumerateC6SourceV3SimplePullRequests({
        page: async () => ({
          nodes: [olderNodes[0]!],
          pageInfo: {
            endCursor: null,
            hasNextPage: true,
          },
          repositoryNameWithOwner: "new/repository",
          repositoryNodeId: "R_new",
          totalCount: 2,
        }),
        repository,
      }),
    ).rejects.toThrow("invalid pull request cursor chain");
  });

  it("normalizes repositories and pull requests across the full frame", () => {
    const repositoryRows = [
      normalizedRepository({
        id: "R_z",
        nameWithOwner: "owner/z",
        repositoryNodeId: "R_z",
      }),
      normalizedRepository({
        id: "R_a",
        nameWithOwner: "owner/a",
        repositoryNodeId: "R_a",
      }),
    ];
    const repositories = classifyC6SourceV3SimpleRepositories({
      observations: repositoryRows,
      priorRepositoryAliases: [],
      priorRepositoryNodeIds: [],
    });

    expect(repositories.repositories.map(
      (repository) => repository.repositoryNodeId,
    )).toEqual(["R_a", "R_z"]);

    const pullRequests = normalizeC6SourceV3SimplePullRequestRows([
      normalizedPullRequest({
        canonicalAnchorId: "owner/z#2",
        canonicalRepository: "owner/z",
        createdAt: "2023-01-01T00:00:00Z",
        number: 2,
        pullRequestNodeId: "PR_z",
        repositoryNodeId: "R_z",
      }),
      normalizedPullRequest({
        canonicalAnchorId: "owner/a#1",
        canonicalRepository: "owner/a",
        createdAt: "2024-01-01T00:00:00Z",
        number: 1,
        pullRequestNodeId: "PR_a",
        repositoryNodeId: "R_a",
      }),
    ]);
    expect(pullRequests.map(
      (pullRequest) => pullRequest.pullRequestNodeId,
    )).toEqual(["PR_a", "PR_z"]);
  });

  it("has independently replayable normalized projection hash vectors", () => {
    expect(
      hashC6SourceV3SimpleNormalizedProjection({
        metadataDecisions: [],
        pullRequests: [],
        repositories: [],
        repositoryDecisions: [],
      }),
    ).toBe(
      "ab0747cf5bea94c71c3a9a44d213f7bfa9ed86dadee29998ba103e253825d29d",
    );
    const repository = normalizedRepository({
      id: "R_1",
      nameWithOwner: "Owner/Repo",
      repositoryNodeId: "R_1",
    });
    const pullRequest = normalizedPullRequest({
      authorLogin: null,
      canonicalAnchorId: "owner/repo#1",
      canonicalRepository: "owner/repo",
      commitTotalCount: 2,
      mergeCommitOid: null,
      number: 1,
      pullRequestNodeId: "PR_1",
      repositoryNodeId: "R_1",
      reviewCount: 4,
      reviewThreadCount: 2,
      url: "https://github.com/Owner/Repo/pull/1",
    });
    expect(
      hashC6SourceV3SimpleNormalizedProjection({
        metadataDecisions: [{
          accepted: true,
          canonicalAnchorId: "owner/repo#1",
          canonicalRepository: "owner/repo",
          pullRequestNodeId: "PR_1",
          reasons: [],
        }],
        pullRequests: [pullRequest],
        repositories: [repository],
        repositoryDecisions: [{
          accepted: true,
          canonicalRepository: "owner/repo",
          reasons: [],
          repositoryNodeId: "R_1",
        }],
      }),
    ).toBe(
      "f11328f79f5917c0264f26206ac1ffd45d72141f76200deb3df3a8e373a14382",
    );
  });

  it("fails closed on incomplete or identity-inconsistent normalized ledgers", () => {
    const rows = [normalizedPullRequest()];
    const decisions =
      classifyC6SourceV3SimplePullRequests({
        frozenPreWave3AnchorExclusions: [],
        frozenPreWave3RepositoryExclusions: [],
        pullRequests: rows,
      });
    const pass = normalizedPass(rows, decisions);
    const assertRejected = (
      mutation: (
        value: C6SourceV3SimpleNormalizedPass,
      ) => void,
      message: string,
    ) => {
      const mutated = structuredClone(pass);
      mutation(mutated);
      expect(() =>
        assertC6SourceV3SimpleTwoPassEquality({
          first: mutated,
          frame: CENSUS_FRAME,
          second: structuredClone(mutated),
        })
      ).toThrow(message);
    };

    assertRejected((value) => {
      value.repositories[0]!.id = "R_raw_mismatch";
    }, "repository identity");
    assertRejected((value) => {
      value.repositoryDecisions[0]!.reasons = [
        "prior-repository-node-id",
      ];
    }, "repository decision");
    assertRejected((value) => {
      value.pullRequests[0]!.canonicalAnchorId =
        "other/repository#20";
      value.pullRequests[0]!.canonicalRepository =
        "other/repository";
      value.metadataDecisions[0]!.canonicalAnchorId =
        "other/repository#20";
      value.metadataDecisions[0]!.canonicalRepository =
        "other/repository";
    }, "pull request repository identity");
    assertRejected((value) => {
      value.metadataDecisions[0]!.accepted = false;
    }, "metadata decision");
    assertRejected((value) => {
      value.repositoryDecisions = [];
    }, "repository decision ledger");
    assertRejected((value) => {
      value.pullRequestClosures = [];
    }, "pull request closure ledger");
    assertRejected((value) => {
      value.repositoryLeafClosures = [];
    }, "repository leaf closure ledger");
    assertRejected((value) => {
      value.repositories[0]!.leafCreatedTo =
        "2020-01-01T00:00:02Z";
    }, "repository leaf closure ledger");
    assertRejected((value) => {
      value.repositories[0]!.isFork = true;
    }, "frozen source frame");
    assertRejected((value) => {
      value.repositories[0]!.id = "";
      value.repositories[0]!.repositoryNodeId = "";
      value.repositoryDecisions[0]!.repositoryNodeId = "";
      value.pullRequestClosures[0]!.repositoryNodeId = "";
      value.pullRequests[0]!.repositoryNodeId = "";
    }, "repository row");
    assertRejected((value) => {
      value.pullRequestClosures[0]!.pageCount = 0;
      value.pullRequestClosures[0]!
        .skippedAboveUpperBoundCount = -1;
      value.pullRequestClosures[0]!
        .totalMergedPullRequestCount = -1;
    }, "pull request closure ledger");
    assertRejected((value) => {
      value.countTrees = [];
      value.metadataDecisions = [];
      value.pullRequestClosures = [];
      value.pullRequests = [];
      value.repositories = [];
      value.repositoryDecisions = [];
      value.repositoryLeafClosures = [];
    }, "count tree frame");
    assertRejected((value) => {
      value.pullRequests[0]!.commitTotalCount = 999;
    }, "metadata decision");
    assertRejected((value) => {
      value.pullRequests[0]!.createdAt =
        "2030-01-01T00:00:00Z";
    }, "pull request window");

    expect(() =>
      assertC6SourceV3SimpleTwoPassEquality({
        first: pass,
        frame: {
          ...CENSUS_FRAME,
          priorRepositoryNodeIds: ["R_new"],
        },
        second: structuredClone(pass),
      })
    ).toThrow("repository decision");
  });
});

function repositoryNode(
  overrides: Partial<C6SourceV3SimpleRepositoryNode> = {},
): C6SourceV3SimpleRepositoryNode {
  return {
    createdAt: "2020-01-01T00:00:01Z",
    id: "R_default",
    isArchived: false,
    isFork: false,
    isMirror: false,
    isTemplate: false,
    nameWithOwner: "default/repository",
    primaryLanguage: {
      name: "TypeScript",
    },
    pushedAt: "2025-01-01T00:00:00Z",
    visibility: "PUBLIC",
    ...overrides,
  };
}

function pullRequestNode(
  overrides: Partial<C6SourceV3SimplePullRequestNode> = {},
): C6SourceV3SimplePullRequestNode {
  return {
    author: {
      login: "contributor",
    },
    baseRefOid: "a".repeat(40),
    commits: {
      totalCount: 20,
    },
    createdAt: "2024-01-01T00:00:00Z",
    id: "PR_default",
    mergeCommit: {
      oid: "b".repeat(40),
    },
    mergedAt: "2024-01-02T00:00:00Z",
    number: 1,
    reviews: {
      totalCount: 5,
    },
    reviewThreads: {
      totalCount: 3,
    },
    url: "https://github.com/default/repository/pull/1",
    ...overrides,
  };
}

function normalizedPullRequest(
  overrides: Partial<
    Awaited<
      ReturnType<
        typeof enumerateC6SourceV3SimplePullRequests
      >
    >["rows"][number]
  > = {},
) {
  return {
    authorLogin: "contributor",
    baseRefOid: "a".repeat(40),
    canonicalAnchorId: "new/repository#20",
    canonicalRepository: "new/repository",
    commitTotalCount: 20,
    createdAt: "2024-01-01T00:00:00Z",
    mergeCommitOid: "b".repeat(40),
    mergedAt: "2024-01-02T00:00:00Z",
    number: 20,
    pullRequestNodeId: "PR_20",
    repositoryNodeId: "R_new",
    reviewCount: 5,
    reviewThreadCount: 3,
    url: "https://github.com/new/repository/pull/20",
    ...overrides,
  };
}

function normalizedRepository(
  overrides: Partial<
    C6SourceV3SimpleNormalizedPass["repositories"][number]
  > = {},
): C6SourceV3SimpleNormalizedPass["repositories"][number] {
  const node = repositoryNode(overrides);
  return {
    ...node,
    leafCreatedFrom: ROOT_SHARD.createdFrom,
    leafCreatedTo: ROOT_SHARD.createdTo,
    repositoryNodeId: node.id,
    rootShardId: ROOT_SHARD.rootShardId,
    sourceSplit: ROOT_SHARD.split,
    ...overrides,
  };
}

function normalizedPass(
  pullRequests: C6SourceV3SimpleNormalizedPass["pullRequests"],
  metadataDecisions:
    C6SourceV3SimpleNormalizedPass["metadataDecisions"],
): C6SourceV3SimpleNormalizedPass {
  const repository = repositoryNode({
    id: "R_new",
    nameWithOwner: "new/repository",
  });
  const leaf = {
    count: 1,
    createdFrom: ROOT_SHARD.createdFrom,
    createdTo: ROOT_SHARD.createdTo,
    depth: 0,
    leaf: true as const,
    query: ROOT_SHARD.query,
  };
  const countTrees = CENSUS_ROOT_SHARDS.map(
    (rootShard) => {
      const rootLeaf = rootShard.rootShardId ===
          ROOT_SHARD.rootShardId
        ? leaf
        : {
            count: 0,
            createdFrom: rootShard.createdFrom,
            createdTo: rootShard.createdTo,
            depth: 0,
            leaf: true as const,
            query: rootShard.query,
          };
      return {
        leaves: [rootLeaf],
        nodes: [rootLeaf],
        rootShardId: rootShard.rootShardId,
      };
    },
  );
  return {
    countTrees,
    metadataDecisions,
    pullRequestClosures: [{
      canonicalRepository: "new/repository",
      enumeratedInWindowCount: pullRequests.length,
      pageCount: 1,
      repositoryNodeId: "R_new",
      skippedAboveUpperBoundCount: 0,
      terminalReason: "connection-exhausted",
      totalMergedPullRequestCount: pullRequests.length,
    }],
    pullRequests,
    repositoryDecisions: [{
      accepted: true,
      canonicalRepository: "new/repository",
      reasons: [],
      repositoryNodeId: "R_new",
    }],
    repositoryLeafClosures: countTrees.map((tree) => {
      const treeLeaf = tree.leaves[0]!;
      return {
        expectedRepositoryCount: treeLeaf.count,
        leafCreatedFrom: treeLeaf.createdFrom,
        leafCreatedTo: treeLeaf.createdTo,
        pageCount: treeLeaf.count === 0 ? 0 : 1,
        rootShardId: tree.rootShardId,
        terminalReason: treeLeaf.count === 0
          ? "zero-count-leaf" as const
          : "connection-exhausted" as const,
      };
    }),
    repositories: [{
      ...repository,
      leafCreatedFrom: ROOT_SHARD.createdFrom,
      leafCreatedTo: ROOT_SHARD.createdTo,
      repositoryNodeId: "R_new",
      rootShardId: ROOT_SHARD.rootShardId,
      sourceSplit: ROOT_SHARD.split,
    }],
  };
}
