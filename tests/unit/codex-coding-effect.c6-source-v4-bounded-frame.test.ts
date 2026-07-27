import { createHash } from "node:crypto";

import { describe, expect, it } from "bun:test";

import {
  C6_SOURCE_V4_BOUNDED_LANGUAGE_SPLITS,
  C6_SOURCE_V4_BOUNDED_REPOSITORIES_PER_LANGUAGE,
  C6_SOURCE_V4_BOUNDED_REPOSITORY_COUNT,
  C6_SOURCE_V4_BOUNDED_REPOSITORY_RANK_DOMAIN,
  C6_SOURCE_V4_BOUNDED_RUNTIME_AUTHORIZATION_SHA256,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-contract";
import {
  deriveC6SourceV4BoundedPilotRepositoryNodeIdExclusions,
  selectC6SourceV4BoundedRepositories,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-frame";
import type {
  C6SourceV3SimpleSplit,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-core";
import {
  buildC6SourceV3SimpleDurableGraphqlRequest,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-transport";

describe("C6 source-v4-bounded frame", () => {
  it("derives exclusions from every durable PR request without requiring a completion", () => {
    const repositoryCount =
      buildC6SourceV3SimpleDurableGraphqlRequest({
        operation: "repositoryCount",
        variables: {
          query: "language:TypeScript",
        },
      });
    const firstAttempt =
      buildC6SourceV3SimpleDurableGraphqlRequest({
        operation: "pullRequestPage",
        variables: {
          after: null,
          repositoryNodeId: "R_pilot_b",
        },
      });
    const retry =
      buildC6SourceV3SimpleDurableGraphqlRequest({
        operation: "pullRequestPage",
        variables: {
          after: null,
          repositoryNodeId: "R_pilot_b",
        },
      });
    const inFlight =
      buildC6SourceV3SimpleDurableGraphqlRequest({
        operation: "pullRequestPage",
        variables: {
          after: "cursor",
          repositoryNodeId: "R_pilot_a",
        },
      });

    expect(
      deriveC6SourceV4BoundedPilotRepositoryNodeIdExclusions([
        repositoryCount,
        firstAttempt,
        retry,
        inFlight,
      ]),
    ).toEqual(["R_pilot_a", "R_pilot_b"]);

    const forged = structuredClone(inFlight);
    forged.persistedRequest.variables = {
      ...forged.persistedRequest.variables,
      codexOutcome: "forbidden",
    };
    expect(() =>
      deriveC6SourceV4BoundedPilotRepositoryNodeIdExclusions([
        forged,
      ])
    ).toThrow("durable request mismatch");

    const forgedOuterDigest = structuredClone(inFlight);
    forgedOuterDigest.bodySha256 = "0".repeat(64);
    expect(() =>
      deriveC6SourceV4BoundedPilotRepositoryNodeIdExclusions([
        forgedOuterDigest,
      ])
    ).toThrow("durable request mismatch");
  });

  it("selects exactly 2,048 repositories per language without replacement", () => {
    const repositories = C6_SOURCE_V4_BOUNDED_LANGUAGE_SPLITS
      .flatMap((split) =>
        Array.from(
          {
            length:
              C6_SOURCE_V4_BOUNDED_REPOSITORIES_PER_LANGUAGE +
              2,
          },
          (_, index) => repositoryRow(split, index),
        )
      );
    const exclusions =
      C6_SOURCE_V4_BOUNDED_LANGUAGE_SPLITS.map(
        (split) => repositoryNodeId(split, 0),
      );

    const selected = selectC6SourceV4BoundedRepositories({
      excludedRepositoryNodeIds: exclusions,
      repositories,
    });
    const repeated = selectC6SourceV4BoundedRepositories({
      excludedRepositoryNodeIds: [...exclusions].reverse(),
      repositories: [...repositories].reverse(),
    });

    expect(selected).toHaveLength(
      C6_SOURCE_V4_BOUNDED_REPOSITORY_COUNT,
    );
    expect(repeated).toEqual(selected);
    expect(new Set(selected.map(
      (row) => row.repositoryNodeId,
    )).size).toBe(selected.length);
    expect(selected.some((row) =>
      exclusions.includes(row.repositoryNodeId)
    )).toBe(false);
    for (const split of C6_SOURCE_V4_BOUNDED_LANGUAGE_SPLITS) {
      const splitRows = selected.filter(
        (row) => row.sourceSplit === split,
      );
      expect(splitRows).toHaveLength(
        C6_SOURCE_V4_BOUNDED_REPOSITORIES_PER_LANGUAGE,
      );
      expect(splitRows.map((row) => row.selectionRank))
        .toEqual(Array.from({ length: 2_048 }, (_, index) =>
          index + 1
        ));
    }
    expect(selected[0]!.repositoryRankSha256).toBe(
      rankSha256(
        selected[0]!.sourceSplit,
        selected[0]!.repositoryNodeId,
      ),
    );
  });

  it("rejects hidden selector inputs, duplicate rows, and per-language shortfall", () => {
    const exactFrame = C6_SOURCE_V4_BOUNDED_LANGUAGE_SPLITS
      .flatMap((split) =>
        Array.from(
          {
            length:
              C6_SOURCE_V4_BOUNDED_REPOSITORIES_PER_LANGUAGE,
          },
          (_, index) => repositoryRow(split, index),
        )
      );

    expect(() =>
      selectC6SourceV4BoundedRepositories({
        excludedRepositoryNodeIds: [],
        repositories: exactFrame,
        semanticOutcome: "forbidden",
      } as Parameters<
        typeof selectC6SourceV4BoundedRepositories
      >[0])
    ).toThrow("selector input");
    expect(() =>
      selectC6SourceV4BoundedRepositories({
        excludedRepositoryNodeIds: [],
        repositories: [
          ...exactFrame,
          exactFrame[0]!,
        ],
      })
    ).toThrow("duplicate repository node ID");
    expect(() =>
      selectC6SourceV4BoundedRepositories({
        excludedRepositoryNodeIds: [],
        repositories: exactFrame.map(
          (repository, index) =>
            index === 0
              ? {
                  ...repository,
                  goldOutcome: "forbidden",
                }
              : repository,
        ),
      })
    ).toThrow("invalid repository row");
    expect(() =>
      selectC6SourceV4BoundedRepositories({
        excludedRepositoryNodeIds: [
          repositoryNodeId("c", 0),
        ],
        repositories: exactFrame,
      })
    ).toThrow("requires at least 2048 repositories for c");
    expect(() =>
      selectC6SourceV4BoundedRepositories({
        excludedRepositoryNodeIds: [
          "R_not_in_verified_frame",
        ],
        repositories: exactFrame,
      })
    ).toThrow("outside the verified repository frame");
  });
});

function repositoryRow(
  sourceSplit: C6SourceV3SimpleSplit,
  index: number,
): {
  repositoryNodeId: string;
  sourceSplit: C6SourceV3SimpleSplit;
} {
  const id = repositoryNodeId(sourceSplit, index);
  return {
    repositoryNodeId: id,
    sourceSplit,
  };
}

function repositoryNodeId(
  sourceSplit: C6SourceV3SimpleSplit,
  index: number,
): string {
  return `R_${sourceSplit}_${String(index).padStart(5, "0")}`;
}

function rankSha256(
  sourceSplit: C6SourceV3SimpleSplit,
  repositoryNodeIdValue: string,
): string {
  return createHash("sha256").update([
    C6_SOURCE_V4_BOUNDED_REPOSITORY_RANK_DOMAIN,
    C6_SOURCE_V4_BOUNDED_RUNTIME_AUTHORIZATION_SHA256,
    sourceSplit,
    repositoryNodeIdValue,
  ].join("\u0000")).digest("hex");
}
