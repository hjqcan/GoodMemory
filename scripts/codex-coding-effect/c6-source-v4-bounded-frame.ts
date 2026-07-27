import { createHash } from "node:crypto";

import {
  C6_SOURCE_V4_BOUNDED_LANGUAGE_SPLITS,
  C6_SOURCE_V4_BOUNDED_REPOSITORIES_PER_LANGUAGE,
  C6_SOURCE_V4_BOUNDED_REPOSITORY_RANK_DOMAIN,
  C6_SOURCE_V4_BOUNDED_RUNTIME_AUTHORIZATION_SHA256,
} from "./c6-source-v4-bounded-contract";
import type {
  C6SourceV3SimpleSplit,
} from "./c6-source-v3-simple-census-core";
import {
  verifyC6SourceV3SimpleDurableGraphqlRequest,
} from "./c6-source-v3-simple-census-transport";
import type {
  C6SourceV3SimpleDurableGraphqlRequest,
} from "./c6-source-v3-simple-census-transport";

const SELECTOR_INPUT_KEYS = [
  "excludedRepositoryNodeIds",
  "repositories",
] as const;

export interface C6SourceV4BoundedSelectedRepository {
  repositoryNodeId: string;
  repositoryRankSha256: string;
  selectionRank: number;
  sourceSplit: C6SourceV3SimpleSplit;
}

export interface C6SourceV4BoundedRepositoryCandidate {
  repositoryNodeId: string;
  sourceSplit: C6SourceV3SimpleSplit;
}

export function deriveC6SourceV4BoundedPilotRepositoryNodeIdExclusions(
  requests: readonly C6SourceV3SimpleDurableGraphqlRequest[],
): string[] {
  const repositoryNodeIds = new Set<string>();
  for (const request of requests) {
    let verified: C6SourceV3SimpleDurableGraphqlRequest;
    try {
      verified =
        verifyC6SourceV3SimpleDurableGraphqlRequest({
          body: request.body,
          persistedRequest: request.persistedRequest,
        });
    } catch {
      throw new Error(
        "C6 source-v4-bounded durable request mismatch",
      );
    }
    if (request.bodySha256 !== verified.bodySha256) {
      throw new Error(
        "C6 source-v4-bounded durable request mismatch",
      );
    }
    if (
      verified.persistedRequest.operationName ===
      "C6SourceV3SimplePullRequestPage"
    ) {
      repositoryNodeIds.add(
        verified.persistedRequest.variables
          .repositoryNodeId as string,
      );
    }
  }
  return [...repositoryNodeIds].sort(compareUtf8);
}

export function selectC6SourceV4BoundedRepositories(
  input: {
    excludedRepositoryNodeIds: readonly string[];
    repositories:
      readonly C6SourceV4BoundedRepositoryCandidate[];
  },
): C6SourceV4BoundedSelectedRepository[] {
  if (
    !sameStrings(
      Object.keys(input).sort(compareUtf8),
      SELECTOR_INPUT_KEYS,
    )
  ) {
    throw new Error(
      "C6 source-v4-bounded selector input must contain only excludedRepositoryNodeIds and repositories",
    );
  }

  const excludedRepositoryNodeIds = new Set(
    input.excludedRepositoryNodeIds,
  );
  const seenRepositoryNodeIds = new Set<string>();
  const repositoriesBySplit = new Map<
    C6SourceV3SimpleSplit,
    C6SourceV4BoundedRepositoryCandidate[]
  >(
    C6_SOURCE_V4_BOUNDED_LANGUAGE_SPLITS.map(
      (split) => [split, []],
    ),
  );

  for (const repository of input.repositories) {
    assertRepositoryRow(repository);
    if (
      seenRepositoryNodeIds.has(
        repository.repositoryNodeId,
      )
    ) {
      throw new Error(
        `C6 source-v4-bounded duplicate repository node ID: ${repository.repositoryNodeId}`,
      );
    }
    seenRepositoryNodeIds.add(repository.repositoryNodeId);
    if (
      !excludedRepositoryNodeIds.has(
        repository.repositoryNodeId,
      )
    ) {
      repositoriesBySplit.get(
        repository.sourceSplit,
      )!.push(repository);
    }
  }
  for (const repositoryNodeId of
    excludedRepositoryNodeIds) {
    if (!seenRepositoryNodeIds.has(repositoryNodeId)) {
      throw new Error(
        "C6 source-v4-bounded exclusion is outside the verified repository frame",
      );
    }
  }

  return C6_SOURCE_V4_BOUNDED_LANGUAGE_SPLITS.flatMap(
    (sourceSplit) => {
      const repositories =
        repositoriesBySplit.get(sourceSplit)!;
      if (
        repositories.length <
        C6_SOURCE_V4_BOUNDED_REPOSITORIES_PER_LANGUAGE
      ) {
        throw new Error(
          `C6 source-v4-bounded requires at least 2048 repositories for ${sourceSplit}`,
        );
      }
      return repositories
        .map((repository) => ({
          repositoryNodeId: repository.repositoryNodeId,
          repositoryRankSha256:
            computeC6SourceV4BoundedRepositoryRankSha256(
              sourceSplit,
              repository.repositoryNodeId,
            ),
          sourceSplit,
        }))
        .sort((left, right) =>
          compareUtf8(
            left.repositoryRankSha256,
            right.repositoryRankSha256,
          ) ||
          compareUtf8(
            left.repositoryNodeId,
            right.repositoryNodeId,
          )
        )
        .slice(
          0,
          C6_SOURCE_V4_BOUNDED_REPOSITORIES_PER_LANGUAGE,
        )
        .map((repository, index) => ({
          ...repository,
          selectionRank: index + 1,
        }));
    },
  );
}

function assertRepositoryRow(
  repository: C6SourceV4BoundedRepositoryCandidate,
): void {
  if (
    !sameStrings(
      Object.keys(repository).sort(compareUtf8),
      ["repositoryNodeId", "sourceSplit"],
    ) ||
    typeof repository.repositoryNodeId !== "string" ||
    repository.repositoryNodeId.length === 0 ||
    !C6_SOURCE_V4_BOUNDED_LANGUAGE_SPLITS.includes(
      repository.sourceSplit,
    )
  ) {
    throw new Error(
      "C6 source-v4-bounded invalid repository row",
    );
  }
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(
    Buffer.from(left),
    Buffer.from(right),
  );
}

export function computeC6SourceV4BoundedRepositoryRankSha256(
  sourceSplit: C6SourceV3SimpleSplit,
  repositoryNodeId: string,
): string {
  return createHash("sha256").update([
    C6_SOURCE_V4_BOUNDED_REPOSITORY_RANK_DOMAIN,
    C6_SOURCE_V4_BOUNDED_RUNTIME_AUTHORIZATION_SHA256,
    sourceSplit,
    repositoryNodeId,
  ].join("\u0000")).digest("hex");
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}
