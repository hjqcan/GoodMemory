import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  C6_SOURCE_V4_BOUNDED_MAX_LIVE_LOGICAL_REQUEST_COUNT,
} from "./c6-source-v4-bounded-contract";
import {
  C6_SOURCE_V4_BOUNDED_CONTRACT_SHA256,
} from "./c6-source-v4-bounded-receipts";
import {
  assertC6SourceV4BoundedSnapshotVerified,
} from "./c6-source-v4-bounded-snapshot";
import type {
  LoadedC6SourceV4BoundedSnapshot,
} from "./c6-source-v4-bounded-snapshot";
import {
  classifyC6SourceV3SimplePullRequests,
  enumerateC6SourceV3SimplePullRequests,
  normalizeC6SourceV3SimplePullRequestRows,
} from "./c6-source-v3-simple-census-core";
import type {
  C6SourceV3SimpleRepositoryNode,
  C6SourceV3SimpleRepositoryRow,
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

export interface C6SourceV4BoundedCaptureRepository
  extends C6SourceV3SimpleRepositoryRow {
  repositoryRankSha256: string;
  selectionRank: number;
}

export function buildC6SourceV4BoundedCapturePlan(
  snapshot: LoadedC6SourceV4BoundedSnapshot,
) {
  assertC6SourceV4BoundedSnapshotVerified(snapshot);
  const frameRows = new Map(
    snapshot.v3Reuse.frameRepositories.map(
      (value) => {
        const row =
          value as C6SourceV3SimpleRepositoryRow;
        return [row.repositoryNodeId, row] as const;
      },
    ),
  );
  const selectedRepositories =
    snapshot.selectionReceipt.receipt
      .selectedRepositories.map((selected) => {
        const row = frameRows.get(
          selected.repositoryNodeId,
        );
        if (
          row === undefined ||
          row.sourceSplit !== selected.sourceSplit
        ) {
          throw new Error(
            "C6 source-v4 bounded selected repository is outside the verified frame",
          );
        }
        return projectCaptureRepository(
          row,
          selected,
        );
      });
  return {
    frozenPreWave3AnchorExclusions:
      snapshot.v3Reuse.frame
        .frozenPreWave3AnchorExclusions,
    frozenPreWave3RepositoryExclusions:
      snapshot.v3Reuse.frame
        .frozenPreWave3RepositoryExclusions,
    identity: {
      assetLockSha256:
        snapshot.assetLock.assetLockSha256,
      assetRootSha256:
        snapshot.assetLock.assetLock
          .assetRootSha256,
      pilotExclusionReceiptSha256:
        snapshot.pilotExclusionReceipt.sha256,
      prefixReceiptSha256:
        snapshot.prefixReceipt.sha256,
      selectedRepositoriesSha256:
        snapshot.selectionReceipt.receipt
          .selectedRepositoriesSha256,
      selectionReceiptSha256:
        snapshot.selectionReceipt.sha256,
      v4ContractSha256:
        C6_SOURCE_V4_BOUNDED_CONTRACT_SHA256,
    },
    selectedRepositories,
  };
}

export async function replayC6SourceV4BoundedCapture(
  input: {
    requests:
      readonly C6SourceV3SimpleProjectedLogicalRequest[];
    snapshot: LoadedC6SourceV4BoundedSnapshot;
  },
) {
  let requestIndex = 0;
  const projection =
    await collectC6SourceV4BoundedCapture({
      executeRequest: async (expected) => {
        const actual = input.requests[requestIndex];
        if (actual === undefined) {
          throw new Error(
            "C6 source-v4 bounded capture ledger exhausted",
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
            "C6 source-v4 bounded capture request sequence mismatch",
          );
        }
        requestIndex += 1;
        return actual;
      },
      snapshot: input.snapshot,
    });
  if (requestIndex !== input.requests.length) {
    throw new Error(
      "C6 source-v4 bounded capture ledger has trailing requests",
    );
  }
  return projection;
}

async function collectC6SourceV4BoundedCapture(
  input: {
    executeRequest: (
      request: C6SourceV3SimpleDurableGraphqlRequest,
    ) => Promise<
      C6SourceV3SimpleProjectedLogicalRequest
    >;
    snapshot: LoadedC6SourceV4BoundedSnapshot;
  },
) {
  const plan =
    buildC6SourceV4BoundedCapturePlan(
      input.snapshot,
    );
  const pullRequestClosures = [];
  const pullRequestObservations = [];
  let logicalRequestCount = 0;
  for (const repository of plan.selectedRepositories) {
    const pullRequests =
      await enumerateC6SourceV3SimplePullRequests({
        page: async ({ afterCursor }) => {
          if (
            logicalRequestCount >=
            C6_SOURCE_V4_BOUNDED_MAX_LIVE_LOGICAL_REQUEST_COUNT
          ) {
            throw new Error(
              "C6 source-v4 bounded live logical request budget exceeded",
            );
          }
          const actual = await input.executeRequest(
            buildC6SourceV3SimpleDurableGraphqlRequest({
              operation: "pullRequestPage",
              variables: {
                after: afterCursor,
                repositoryNodeId:
                  repository.repositoryNodeId,
              },
            }),
          );
          logicalRequestCount += 1;
          if (
            actual.operationName !==
              "C6SourceV3SimplePullRequestPage"
          ) {
            throw new Error(
              "C6 source-v4 bounded capture operation sequence mismatch",
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
  const metadataDecisions =
    classifyC6SourceV3SimplePullRequests({
      frozenPreWave3AnchorExclusions:
        plan.frozenPreWave3AnchorExclusions,
      frozenPreWave3RepositoryExclusions:
        plan.frozenPreWave3RepositoryExclusions,
      pullRequests,
    });
  const body = {
    artifactKind:
      "c6-source-v4-bounded-normalized-capture",
    identity: plan.identity,
    logicalRequestCount,
    metadataDecisions,
    pullRequestClosures,
    pullRequests,
    schemaVersion: 1,
    selectedRepositories:
      plan.selectedRepositories,
  };
  return {
    ...body,
    projectionSha256:
      sha256(JSON.stringify(body)),
  };
}

function projectCaptureRepository(
  repository: C6SourceV3SimpleRepositoryRow,
  selected: {
    repositoryRankSha256: string;
    selectionRank: number;
  },
): C6SourceV4BoundedCaptureRepository {
  return {
    createdAt: repository.createdAt,
    id: repository.id,
    isArchived: repository.isArchived,
    isFork: repository.isFork,
    isMirror: repository.isMirror,
    isTemplate: repository.isTemplate,
    leafCreatedFrom: repository.leafCreatedFrom,
    leafCreatedTo: repository.leafCreatedTo,
    nameWithOwner: repository.nameWithOwner,
    primaryLanguage:
      repository.primaryLanguage === null
        ? null
        : {
          name: repository.primaryLanguage.name,
        },
    pushedAt: repository.pushedAt,
    repositoryNodeId:
      repository.repositoryNodeId,
    repositoryRankSha256:
      selected.repositoryRankSha256,
    rootShardId: repository.rootShardId,
    selectionRank: selected.selectionRank,
    sourceSplit: repository.sourceSplit,
    visibility: repository.visibility,
  };
}

function repositoryNode(
  repository: C6SourceV3SimpleRepositoryRow,
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

function sha256(value: string): string {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}
