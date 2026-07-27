import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  C6_SOURCE_V4_BOUNDED_V3_FRAME_SHA256,
} from "./c6-source-v4-bounded-contract";
import {
  buildC6SourceV3SimpleCountTree,
  classifyC6SourceV3SimpleRepositories,
  enumerateC6SourceV3SimpleRepositories,
  parseC6SourceV3SimpleFrameDefinition,
} from "./c6-source-v3-simple-census-core";
import type {
  C6SourceV3SimpleFrameDefinition,
} from "./c6-source-v3-simple-census-core";
import type {
  C6SourceV3SimpleProjectedLogicalRequest,
} from "./c6-source-v3-simple-census-replay";
import {
  buildC6SourceV3SimpleDurableGraphqlRequest,
} from "./c6-source-v3-simple-census-transport";
import type {
  C6SourceV3SimpleDurableGraphqlRequest,
} from "./c6-source-v3-simple-census-transport";

export async function replayC6SourceV4BoundedRepositoryPrefix(
  input: {
    frame: C6SourceV3SimpleFrameDefinition;
    requests:
      readonly C6SourceV3SimpleProjectedLogicalRequest[];
  },
) {
  const frame =
    parseC6SourceV3SimpleFrameDefinition(input.frame);
  if (
    sha256(JSON.stringify(frame)) !==
      C6_SOURCE_V4_BOUNDED_V3_FRAME_SHA256
  ) {
    throw new Error(
      "C6 source-v4 bounded repository prefix is not bound to the historical v3 frame",
    );
  }
  return await collectC6SourceV4BoundedRepositoryPrefixProjection({
    frame,
    requests: input.requests,
  });
}

export async function collectC6SourceV4BoundedRepositoryPrefixProjection(
  input: {
    frame: C6SourceV3SimpleFrameDefinition;
    requests:
      readonly C6SourceV3SimpleProjectedLogicalRequest[];
  },
) {
  const frame =
    parseC6SourceV3SimpleFrameDefinition(input.frame);
  let requestIndex = 0;
  const executeRequest = (
    expected: C6SourceV3SimpleDurableGraphqlRequest,
  ) => {
    const actual = input.requests[requestIndex];
    if (actual === undefined) {
      throw new Error(
        "C6 source-v4 bounded repository ledger exhausted",
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
        "C6 source-v4 bounded repository request sequence mismatch",
      );
    }
    requestIndex += 1;
    return actual;
  };
  const countTrees = [];
  const repositoryLeafClosures = [];
  const repositoryObservations = [];
  for (const rootShard of frame.rootShards) {
    const countTree =
      await buildC6SourceV3SimpleCountTree({
        probe: async ({ query }) => {
          const actual = executeRequest(
            buildC6SourceV3SimpleDurableGraphqlRequest({
              operation: "repositoryCount",
              variables: { query },
            }),
          );
          if (
            actual.operationName !==
              "C6SourceV3SimpleRepositoryCount"
          ) {
            throw new Error(
              "C6 source-v4 bounded repository operation sequence mismatch",
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
        page: async ({ afterCursor, query }) => {
          const actual = executeRequest(
            buildC6SourceV3SimpleDurableGraphqlRequest({
              operation: "repositoryPage",
              variables: {
                after: afterCursor,
                query,
              },
            }),
          );
          if (
            actual.operationName !==
              "C6SourceV3SimpleRepositoryPage"
          ) {
            throw new Error(
              "C6 source-v4 bounded repository operation sequence mismatch",
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
  if (requestIndex !== input.requests.length) {
    throw new Error(
      "C6 source-v4 bounded repository ledger has trailing requests",
    );
  }
  const classification =
    classifyC6SourceV3SimpleRepositories({
      observations: repositoryObservations,
      priorRepositoryAliases:
        frame.priorRepositoryAliases,
      priorRepositoryNodeIds:
        frame.priorRepositoryNodeIds,
    });
  return {
    countTrees,
    frameRepositories:
      classification.frameRepositories,
    logicalRequestCount: requestIndex,
    repositories: classification.repositories,
    repositoryDecisions: classification.decisions,
    repositoryLeafClosures,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
