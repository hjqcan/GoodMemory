import { isDeepStrictEqual } from "node:util";

import {
  buildC6SourceV3SimpleCountTree,
  classifyC6SourceV3SimplePullRequests,
  classifyC6SourceV3SimpleRepositories,
  enumerateC6SourceV3SimplePullRequests,
  enumerateC6SourceV3SimpleRepositories,
  normalizeC6SourceV3SimplePullRequestRows,
  verifyC6SourceV3SimpleNormalizedPass,
} from "./c6-source-v3-simple-census-core";
import type {
  C6SourceV3SimpleFrameDefinition,
  C6SourceV3SimplePullRequestPage,
  C6SourceV3SimpleRepositoryNode,
  C6SourceV3SimpleRepositoryPage,
} from "./c6-source-v3-simple-census-core";
import type {
  C6SourceV3SimpleRateLimit,
} from "./c6-source-v3-simple-census-graphql";
import {
  buildC6SourceV3SimpleDurableGraphqlRequest,
} from "./c6-source-v3-simple-census-transport";
import type {
  C6SourceV3SimpleDurableGraphqlRequest,
} from "./c6-source-v3-simple-census-transport";

export type C6SourceV3SimpleProjectedLogicalRequest =
  | {
      operationName:
        "C6SourceV3SimpleRepositoryCount";
      request:
        C6SourceV3SimpleDurableGraphqlRequest;
      result: {
        rateLimit: C6SourceV3SimpleRateLimit;
        repositoryCount: number;
      };
    }
  | {
      operationName:
        "C6SourceV3SimpleRepositoryPage";
      request:
        C6SourceV3SimpleDurableGraphqlRequest;
      result: {
        page: C6SourceV3SimpleRepositoryPage;
        rateLimit: C6SourceV3SimpleRateLimit;
      };
    }
  | {
      operationName:
        "C6SourceV3SimplePullRequestPage";
      request:
        C6SourceV3SimpleDurableGraphqlRequest;
      result: {
        page: C6SourceV3SimplePullRequestPage;
        rateLimit: C6SourceV3SimpleRateLimit;
      };
    };

export async function replayC6SourceV3SimpleNormalizedPass(
  input: {
    frame: C6SourceV3SimpleFrameDefinition;
    requests:
      readonly C6SourceV3SimpleProjectedLogicalRequest[];
  },
) {
  let requestIndex = 0;
  const pass =
    await collectC6SourceV3SimpleNormalizedPass({
      executeRequest: async (expected) => {
        const actual = input.requests[requestIndex];
        if (actual === undefined) {
          throw new Error(
            "C6 source-v3-simple projected request ledger exhausted",
          );
        }
        if (
          !actual.request.body.equals(expected.body) ||
          !isDeepStrictEqual(
            actual.request.persistedRequest,
            expected.persistedRequest,
          )
        ) {
          throw new Error(
            "C6 source-v3-simple durable request sequence mismatch",
          );
        }
        requestIndex += 1;
        return actual;
      },
      frame: input.frame,
    });
  if (requestIndex !== input.requests.length) {
    throw new Error(
      "C6 source-v3-simple projected request ledger has trailing requests",
    );
  }
  return pass;
}

export async function collectC6SourceV3SimpleNormalizedPass(
  input: {
    executeRequest: (
      request: C6SourceV3SimpleDurableGraphqlRequest,
    ) => Promise<
      C6SourceV3SimpleProjectedLogicalRequest
    >;
    frame: C6SourceV3SimpleFrameDefinition;
  },
) {
  const countTrees = [];
  const repositoryLeafClosures = [];
  const repositoryObservations = [];
  for (const rootShard of input.frame.rootShards) {
    const countTree =
      await buildC6SourceV3SimpleCountTree({
        probe: async (probe) => {
          const actual = await input.executeRequest(
            buildC6SourceV3SimpleDurableGraphqlRequest({
              operation: "repositoryCount",
              variables: {
                query: probe.query,
              },
            }),
          );
          if (
            actual.operationName !==
              "C6SourceV3SimpleRepositoryCount"
          ) {
            throw new Error(
              "C6 source-v3-simple projected operation sequence mismatch",
            );
          }
          return actual.result.repositoryCount;
        },
        rootShard,
      });
    countTrees.push(countTree);
    const repositories =
      await enumerateC6SourceV3SimpleRepositories({
        leaves: countTree.leaves,
        page: async (page) => {
          const actual = await input.executeRequest(
            buildC6SourceV3SimpleDurableGraphqlRequest({
              operation: "repositoryPage",
              variables: {
                after: page.afterCursor,
                query: page.query,
              },
            }),
          );
          if (
            actual.operationName !==
              "C6SourceV3SimpleRepositoryPage"
          ) {
            throw new Error(
              "C6 source-v3-simple projected operation sequence mismatch",
            );
          }
          return actual.result.page;
        },
        rootShard,
      });
    repositoryLeafClosures.push(
      ...repositories.closures,
    );
    repositoryObservations.push(...repositories.rows);
  }

  const repositoryClassification =
    classifyC6SourceV3SimpleRepositories({
      observations: repositoryObservations,
      priorRepositoryAliases:
        input.frame.priorRepositoryAliases,
      priorRepositoryNodeIds:
        input.frame.priorRepositoryNodeIds,
    });
  const pullRequestClosures = [];
  const pullRequestObservations = [];
  for (
    const repository of
      repositoryClassification.frameRepositories
  ) {
    const pullRequests =
      await enumerateC6SourceV3SimplePullRequests({
        page: async (page) => {
          const actual = await input.executeRequest(
            buildC6SourceV3SimpleDurableGraphqlRequest({
              operation: "pullRequestPage",
              variables: {
                after: page.afterCursor,
                repositoryNodeId:
                  page.repository.id,
              },
            }),
          );
          if (
            actual.operationName !==
              "C6SourceV3SimplePullRequestPage"
          ) {
            throw new Error(
              "C6 source-v3-simple projected operation sequence mismatch",
            );
          }
          return actual.result.page;
        },
        repository: repositoryNode(repository),
      });
    pullRequestClosures.push(pullRequests.closure);
    pullRequestObservations.push(...pullRequests.rows);
  }
  const pullRequests =
    normalizeC6SourceV3SimplePullRequestRows(
      pullRequestObservations,
    );
  return verifyC6SourceV3SimpleNormalizedPass({
    countTrees,
    metadataDecisions:
      classifyC6SourceV3SimplePullRequests({
        frozenPreWave3AnchorExclusions:
          input.frame.frozenPreWave3AnchorExclusions,
        frozenPreWave3RepositoryExclusions:
          input.frame
            .frozenPreWave3RepositoryExclusions,
        pullRequests,
      }),
    pullRequestClosures,
    pullRequests,
    repositoryDecisions:
      repositoryClassification.decisions,
    repositoryLeafClosures,
    repositories:
      repositoryClassification.repositories,
  }, input.frame);
}

function repositoryNode(
  repository: C6SourceV3SimpleRepositoryNode,
): C6SourceV3SimpleRepositoryNode {
  return {
    createdAt: repository.createdAt,
    id: repository.id,
    isArchived: repository.isArchived,
    isFork: repository.isFork,
    isMirror: repository.isMirror,
    isTemplate: repository.isTemplate,
    nameWithOwner: repository.nameWithOwner,
    primaryLanguage: repository.primaryLanguage,
    pushedAt: repository.pushedAt,
    visibility: repository.visibility,
  };
}
