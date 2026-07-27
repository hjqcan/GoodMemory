import { createHash } from "node:crypto";

import {
  beforeAll,
  describe,
  expect,
  it,
} from "bun:test";

import {
  buildC6SourceV4BoundedContract,
  C6_SOURCE_V4_BOUNDED_EVALUATION_ID,
  C6_SOURCE_V4_BOUNDED_LANGUAGE_SPLITS,
  C6_SOURCE_V4_BOUNDED_REPOSITORIES_PER_LANGUAGE,
  C6_SOURCE_V4_BOUNDED_REPOSITORY_COUNT,
  C6_SOURCE_V4_BOUNDED_RUNTIME_AUTHORIZATION_SHA256,
  C6_SOURCE_V4_BOUNDED_V3_EVALUATION_ID,
  C6_SOURCE_V4_BOUNDED_V3_EXECUTION_CONTRACT_SHA256,
  C6_SOURCE_V4_BOUNDED_V3_FRAME_SHA256,
  C6_SOURCE_V4_BOUNDED_V3_FROZEN_INPUT_CLOSURE_SHA256,
  C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE,
  serializeC6SourceV4BoundedContract,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-contract";
import {
  selectC6SourceV4BoundedRepositories,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-frame";
import type {
  C6SourceV4BoundedRepositoryCandidate,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-frame";
import {
  buildC6SourceV4BoundedPilotExclusionReceipt,
  buildC6SourceV4BoundedSelectionReceipt,
  buildC6SourceV4BoundedV3PrefixReuseReceipt,
  parseC6SourceV4BoundedPilotExclusionReceipt,
  parseC6SourceV4BoundedSelectionReceipt,
  parseC6SourceV4BoundedV3PrefixReuseReceipt,
  serializeC6SourceV4BoundedPilotExclusionReceipt,
  serializeC6SourceV4BoundedSelectionReceipt,
  serializeC6SourceV4BoundedV3PrefixReuseReceipt,
  verifyC6SourceV4BoundedSelectionReceipt,
  verifyC6SourceV4BoundedV3PrefixReuseReceipt,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-receipts";
import type {
  C6SourceV4BoundedPilotExclusionBuildInput,
  C6SourceV4BoundedSelectionBuildInput,
  C6SourceV4BoundedV3PrefixReuseBuildInput,
  LoadedC6SourceV4BoundedPilotExclusionReceipt,
  LoadedC6SourceV4BoundedV3PrefixReuseReceipt,
  ParsedC6SourceV4BoundedPilotExclusionReceipt,
  ParsedC6SourceV4BoundedSelectionReceipt,
  ParsedC6SourceV4BoundedV3PrefixReuseReceipt,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-receipts";
import type {
  C6SourceV3SimpleFrameDefinition,
  C6SourceV3SimpleSplit,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-core";
import {
  loadC6SourceV3SimpleCensusPreflight,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-preflight";
import {
  buildC6SourceV3SimpleDurableGraphqlRequest,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-transport";
import type {
  C6SourceV3SimpleDurableGraphqlRequest,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-transport";
import type {
  C6SourceV4BoundedV3CommittedRequest,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-v3-runtime";

const TEST_TIMEOUT_MILLISECONDS = 60_000;

let frame: C6SourceV3SimpleFrameDefinition;
let normalizedRepositoryRows:
  C6SourceV4BoundedRepositoryCandidate[];
let frameRepositoryRows:
  C6SourceV4BoundedRepositoryCandidate[];
let prefixReceipt:
  ParsedC6SourceV4BoundedV3PrefixReuseReceipt;
let syntheticPrefixInput:
  C6SourceV4BoundedV3PrefixReuseBuildInput;
let pilotExclusionReceipt:
  ParsedC6SourceV4BoundedPilotExclusionReceipt;
let selectionReceipt:
  ParsedC6SourceV4BoundedSelectionReceipt;

beforeAll(async () => {
  const preflight =
    await loadC6SourceV3SimpleCensusPreflight({
      repositoryRoot: process.cwd(),
    });
  frame = preflight.frame;
  normalizedRepositoryRows =
    buildRepositoryRows(191_612);
  frameRepositoryRows =
    normalizedRepositoryRows.slice(8);

  prefixReceipt =
    parseC6SourceV4BoundedV3PrefixReuseReceipt(
      canonicalJson({
        artifactKind:
          "c6-source-v4-bounded-v3-prefix-reuse-receipt",
        boundary: {
          promotable: false,
          reuseAuthority: "data-reuse-only",
          terminalDisposition:
            "abandoned-infeasible-observation",
        },
        counts: {
          countTreeCount: 1_536,
          frameRepositoryRowCount: 191_604,
          logicalRequestCount: 4_497,
          normalizedRepositoryRowCount: 191_612,
          repositoryCountRequestCount: 1_604,
          repositoryLeafClosureCount: 1_570,
          repositoryPageRequestCount: 2_893,
        },
        historicalV3: {
          evaluationId:
            C6_SOURCE_V4_BOUNDED_V3_EVALUATION_ID,
          executionContractSha256:
            C6_SOURCE_V4_BOUNDED_V3_EXECUTION_CONTRACT_SHA256,
          frameSha256:
            C6_SOURCE_V4_BOUNDED_V3_FRAME_SHA256,
          frozenInputClosureSha256:
            C6_SOURCE_V4_BOUNDED_V3_FROZEN_INPUT_CLOSURE_SHA256,
          runtimeAuthorizationSha256:
            C6_SOURCE_V4_BOUNDED_RUNTIME_AUTHORIZATION_SHA256,
        },
        repositoryPrefix: {
          frameRepositoryRowsSha256:
            C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
              .frameRepositoriesSha256,
          normalizedRepositoryRowsSha256:
            C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
              .repositoriesSha256,
          prefixCompletionRootSha256:
            C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
              .prefixCompletionRootSha256,
          priorRepositoryAliasesSha256:
            hashJson(frame.priorRepositoryAliases),
          priorRepositoryNodeIdsSha256:
            hashJson(frame.priorRepositoryNodeIds),
          scannerCommittedRequestClosureSha256:
            C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
              .committedRequestClosureSha256,
          scannerRequestStructureSha256:
            C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
              .requestStructureSha256,
        },
        schemaVersion: 1,
      }),
    );

  syntheticPrefixInput = {
    committedAttemptCount:
      C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
        .committedAttemptCount,
    committedRequestClosureSha256:
      C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
        .committedRequestClosureSha256,
    durableRequestEntries: [],
    frame,
    frameRepositories: frameRepositoryRows,
    frameRepositoriesSha256:
      hashJson(frameRepositoryRows),
    frozenInputClosure: {
      bytes: 0,
      path: "frozen-input-closure.json",
      sha256:
        C6_SOURCE_V4_BOUNDED_V3_FROZEN_INPUT_CLOSURE_SHA256,
    },
    pilotPullRequestAttemptCount:
      C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
        .pilotPullRequestAttemptCount,
    pilotRepositoryNodeIds: [
      frameRepositoryRows[1]!.repositoryNodeId,
      frameRepositoryRows[2]!.repositoryNodeId,
    ].sort(compareUtf8),
    pilotRepositoryNodeIdsSha256: hashJson([
      frameRepositoryRows[1]!.repositoryNodeId,
      frameRepositoryRows[2]!.repositoryNodeId,
    ].sort(compareUtf8)),
    prefixCompletionRootSha256:
      C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
        .prefixCompletionRootSha256,
    repositories: normalizedRepositoryRows,
    repositoriesSha256:
      hashJson(normalizedRepositoryRows),
    repositoryDecisions: [],
    repositoryDecisionsSha256: hashJson([]),
    repositoryLeafClosures: [],
    repositoryLeafClosuresSha256: hashJson([]),
    requestStructureSha256:
      C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
        .requestStructureSha256,
  };

  const syntheticExcludedRepositoryNodeIds = [
    frameRepositoryRows[1]!.repositoryNodeId,
    frameRepositoryRows[2]!.repositoryNodeId,
  ].sort(compareUtf8);
  pilotExclusionReceipt =
    parseC6SourceV4BoundedPilotExclusionReceipt(
      canonicalJson({
        artifactKind:
          "c6-source-v4-bounded-pilot-exclusion-receipt",
        excludedRepositoryNodeIdCount:
          syntheticExcludedRepositoryNodeIds.length,
        excludedRepositoryNodeIds:
          syntheticExcludedRepositoryNodeIds,
        excludedRepositoryNodeIdsSha256:
          hashJson(syntheticExcludedRepositoryNodeIds),
        frameRepositoryRowsSha256:
          C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
            .frameRepositoriesSha256,
        scannerCommittedRequestClosureSha256:
          C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
            .committedRequestClosureSha256,
        scannerRequestStructureSha256:
          C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
            .requestStructureSha256,
        schemaVersion: 1,
        v3PrefixReuseReceiptSha256:
          prefixReceipt.sha256,
      }),
    );

  const selectionFrame =
    C6_SOURCE_V4_BOUNDED_LANGUAGE_SPLITS.flatMap(
      (sourceSplit) =>
        Array.from(
          {
            length:
              C6_SOURCE_V4_BOUNDED_REPOSITORIES_PER_LANGUAGE +
              1,
          },
          (_, index) =>
            repositoryRow(sourceSplit, index),
        ),
    );
  const selectedRepositories =
    selectC6SourceV4BoundedRepositories({
      excludedRepositoryNodeIds: [],
      repositories: selectionFrame,
    }).map((repository) => ({
      repositoryNodeId: repository.repositoryNodeId,
      repositoryRankSha256:
        repository.repositoryRankSha256,
      selectionRank: repository.selectionRank,
      sourceSplit: repository.sourceSplit,
    }));
  selectionReceipt =
    parseC6SourceV4BoundedSelectionReceipt(
      canonicalJson({
        artifactKind:
          "c6-source-v4-bounded-selection-receipt",
        evaluationId:
          C6_SOURCE_V4_BOUNDED_EVALUATION_ID,
        pilotExclusionReceiptSha256:
          pilotExclusionReceipt.sha256,
        repositoriesPerLanguage:
          C6_SOURCE_V4_BOUNDED_REPOSITORIES_PER_LANGUAGE,
        repositoryCount:
          C6_SOURCE_V4_BOUNDED_REPOSITORY_COUNT,
        repositoryFrameRowsSha256:
          C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
            .frameRepositoriesSha256,
        replacementAllowed: false,
        schemaVersion: 1,
        selectedRepositories,
        selectedRepositoriesSha256:
          hashJson(selectedRepositories),
        selectionOrder:
          "contract-language-order-then-rank-sha256-then-repository-node-id",
        v3PrefixReuseReceiptSha256:
          prefixReceipt.sha256,
        v4ContractSha256: sha256(
          serializeC6SourceV4BoundedContract(
            buildC6SourceV4BoundedContract(),
          ),
        ),
      }),
    );
}, TEST_TIMEOUT_MILLISECONDS);

describe("C6 source-v4 bounded strict receipts", () => {
  it("parses only the canonical exact historical v3 prefix closure", () => {
    expect(prefixReceipt.receipt).toMatchObject({
      boundary: {
        promotable: false,
        reuseAuthority: "data-reuse-only",
        terminalDisposition:
          "abandoned-infeasible-observation",
      },
      counts: {
        countTreeCount: 1_536,
        frameRepositoryRowCount: 191_604,
        logicalRequestCount: 4_497,
        normalizedRepositoryRowCount: 191_612,
        repositoryCountRequestCount: 1_604,
        repositoryLeafClosureCount: 1_570,
        repositoryPageRequestCount: 2_893,
      },
      repositoryPrefix: {
        frameRepositoryRowsSha256:
          C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
            .frameRepositoriesSha256,
        normalizedRepositoryRowsSha256:
          C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
            .repositoriesSha256,
        prefixCompletionRootSha256:
          C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
            .prefixCompletionRootSha256,
        scannerCommittedRequestClosureSha256:
          C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
            .committedRequestClosureSha256,
        scannerRequestStructureSha256:
          C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
            .requestStructureSha256,
      },
    });
    expect(
      parseC6SourceV4BoundedV3PrefixReuseReceipt(
        serializeC6SourceV4BoundedV3PrefixReuseReceipt(
          prefixReceipt.receipt,
        ),
      ),
    ).toEqual(prefixReceipt);
    expect(() =>
      parseC6SourceV4BoundedV3PrefixReuseReceipt(
        JSON.stringify(prefixReceipt.receipt),
      )
    ).toThrow("canonical JSON");

    const crossRun = structuredClone(
      prefixReceipt.receipt,
    );
    (
      crossRun.historicalV3 as
        unknown as Record<string, unknown>
    ).evaluationId =
      C6_SOURCE_V4_BOUNDED_EVALUATION_ID;
    expect(() =>
      parseC6SourceV4BoundedV3PrefixReuseReceipt(
        canonicalJson(crossRun),
      )
    ).toThrow();
  }, TEST_TIMEOUT_MILLISECONDS);

  it("refuses to build or verify a formal prefix receipt from synthetic rows", () => {
    expect(() =>
      buildC6SourceV4BoundedV3PrefixReuseReceipt(
        syntheticPrefixInput,
      )
    ).toThrow("observed closure");
    expect(() =>
      verifyC6SourceV4BoundedV3PrefixReuseReceipt(
        prefixReceipt,
        syntheticPrefixInput,
      )
    ).toThrow("observed closure");
  }, TEST_TIMEOUT_MILLISECONDS);

  it("derives pilot exclusions from durable requests and rejects unknown or injected IDs", () => {
    expect(
      parseC6SourceV4BoundedPilotExclusionReceipt(
        serializeC6SourceV4BoundedPilotExclusionReceipt(
          pilotExclusionReceipt.receipt,
        ),
      ),
    ).toEqual(pilotExclusionReceipt);

    const knownRequest =
      buildC6SourceV3SimpleDurableGraphqlRequest({
        operation: "pullRequestPage",
        variables: {
          after: null,
          repositoryNodeId:
            frameRepositoryRows[1]!.repositoryNodeId,
        },
      });
    const pilotInput:
      C6SourceV4BoundedPilotExclusionBuildInput = {
        prefixReceipt:
          prefixReceipt as unknown as
            LoadedC6SourceV4BoundedV3PrefixReuseReceipt,
        v3Reuse: {
          ...syntheticPrefixInput,
          durableRequestEntries: [
            committedRequestEntry(knownRequest),
          ],
        },
      };
    expect(() =>
      buildC6SourceV4BoundedPilotExclusionReceipt(
        pilotInput,
      )
    ).toThrow("verified receipt");
    expect(() =>
      buildC6SourceV4BoundedPilotExclusionReceipt({
        ...pilotInput,
        excludedRepositoryNodeIds: ["R_injected"],
      } as C6SourceV4BoundedPilotExclusionBuildInput)
    ).toThrow("input keys");

    const unknownRequest =
      buildC6SourceV3SimpleDurableGraphqlRequest({
        operation: "pullRequestPage",
        variables: {
          after: null,
          repositoryNodeId: "R_not_in_191604_frame",
        },
      });
    expect(() =>
      buildC6SourceV4BoundedPilotExclusionReceipt({
        ...pilotInput,
        v3Reuse: {
          ...pilotInput.v3Reuse,
          durableRequestEntries: [
            committedRequestEntry(unknownRequest),
          ],
        },
      })
    ).toThrow("verified receipt");
    expect(() =>
      buildC6SourceV4BoundedPilotExclusionReceipt({
        ...pilotInput,
        prefixReceipt: {
          ...prefixReceipt,
          sha256: "f".repeat(64),
        } as unknown as
          LoadedC6SourceV4BoundedV3PrefixReuseReceipt,
      })
    ).toThrow("verified receipt");
  }, TEST_TIMEOUT_MILLISECONDS);

  it("self-verifies the exact 8 by 2048 ranked selection without replacement", () => {
    const receipt = selectionReceipt.receipt;
    expect(receipt.selectedRepositories).toHaveLength(
      C6_SOURCE_V4_BOUNDED_REPOSITORY_COUNT,
    );
    expect(
      new Set(receipt.selectedRepositories.map(
        (row) => row.repositoryNodeId,
      )).size,
    ).toBe(C6_SOURCE_V4_BOUNDED_REPOSITORY_COUNT);
    for (
      const [splitIndex, split] of
      C6_SOURCE_V4_BOUNDED_LANGUAGE_SPLITS.entries()
    ) {
      const rows = receipt.selectedRepositories.slice(
        splitIndex *
          C6_SOURCE_V4_BOUNDED_REPOSITORIES_PER_LANGUAGE,
        (splitIndex + 1) *
          C6_SOURCE_V4_BOUNDED_REPOSITORIES_PER_LANGUAGE,
      );
      expect(rows.every(
        (row) => row.sourceSplit === split,
      )).toBe(true);
      expect(rows.map((row) => row.selectionRank))
        .toEqual(Array.from(
          {
            length:
              C6_SOURCE_V4_BOUNDED_REPOSITORIES_PER_LANGUAGE,
          },
          (_, index) => index + 1,
        ));
    }
    expect(
      parseC6SourceV4BoundedSelectionReceipt(
        serializeC6SourceV4BoundedSelectionReceipt(
          receipt,
        ),
      ),
    ).toEqual(selectionReceipt);

    const selectionInput:
      C6SourceV4BoundedSelectionBuildInput = {
        pilotExclusionReceipt:
          pilotExclusionReceipt as unknown as
            LoadedC6SourceV4BoundedPilotExclusionReceipt,
        prefixReceipt:
          prefixReceipt as unknown as
            LoadedC6SourceV4BoundedV3PrefixReuseReceipt,
        v3Reuse: syntheticPrefixInput,
      };
    expect(() =>
      buildC6SourceV4BoundedSelectionReceipt(
        selectionInput,
      )
    ).toThrow("verified receipt");
    expect(() =>
      verifyC6SourceV4BoundedSelectionReceipt(
        {
          ...selectionReceipt,
          sha256: "e".repeat(64),
        },
        selectionInput,
      )
    ).toThrow("receipt SHA-256");
  }, TEST_TIMEOUT_MILLISECONDS);

  it("rejects wrong selection rank, order, selected hash, and hidden fields", () => {
    const wrongRank = structuredClone(
      selectionReceipt.receipt,
    );
    wrongRank.selectedRepositories[0]!
      .repositoryRankSha256 = "d".repeat(64);
    wrongRank.selectedRepositoriesSha256 =
      hashJson(wrongRank.selectedRepositories);
    expect(() =>
      parseC6SourceV4BoundedSelectionReceipt(
        canonicalJson(wrongRank),
      )
    ).toThrow("rank hash");

    const wrongOrder = structuredClone(
      selectionReceipt.receipt,
    );
    [
      wrongOrder.selectedRepositories[0],
      wrongOrder.selectedRepositories[1],
    ] = [
      wrongOrder.selectedRepositories[1]!,
      wrongOrder.selectedRepositories[0]!,
    ];
    wrongOrder.selectedRepositoriesSha256 =
      hashJson(wrongOrder.selectedRepositories);
    expect(() =>
      parseC6SourceV4BoundedSelectionReceipt(
        canonicalJson(wrongOrder),
      )
    ).toThrow("rank/order");

    const wrongSelectedHash = structuredClone(
      selectionReceipt.receipt,
    );
    wrongSelectedHash.selectedRepositoriesSha256 =
      "c".repeat(64);
    expect(() =>
      parseC6SourceV4BoundedSelectionReceipt(
        canonicalJson(wrongSelectedHash),
      )
    ).toThrow("selection hash");

    const hiddenField = structuredClone(
      selectionReceipt.receipt,
    );
    (
      hiddenField.selectedRepositories[0] as
        unknown as Record<string, unknown>
    ).goldOutcome = "forbidden";
    expect(() =>
      parseC6SourceV4BoundedSelectionReceipt(
        canonicalJson(hiddenField),
      )
    ).toThrow();
  }, TEST_TIMEOUT_MILLISECONDS);
});

function buildRepositoryRows(
  count: number,
): C6SourceV4BoundedRepositoryCandidate[] {
  const perSplit = Math.floor(
    count / C6_SOURCE_V4_BOUNDED_LANGUAGE_SPLITS.length,
  );
  let remainder =
    count %
    C6_SOURCE_V4_BOUNDED_LANGUAGE_SPLITS.length;
  return C6_SOURCE_V4_BOUNDED_LANGUAGE_SPLITS.flatMap(
    (sourceSplit) => {
      const splitCount =
        perSplit + (remainder-- > 0 ? 1 : 0);
      return Array.from(
        { length: splitCount },
        (_, index) => repositoryRow(sourceSplit, index),
      );
    },
  );
}

function repositoryRow(
  sourceSplit: C6SourceV3SimpleSplit,
  index: number,
): C6SourceV4BoundedRepositoryCandidate {
  return {
    repositoryNodeId:
      `R_${sourceSplit}_${String(index).padStart(6, "0")}`,
    sourceSplit,
  };
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function committedRequestEntry(
  request: C6SourceV3SimpleDurableGraphqlRequest,
): C6SourceV4BoundedV3CommittedRequest {
  return {
    attemptNumber: 1,
    logicalRequestOrdinal: 1,
    request,
    requestBodySha256: "a".repeat(64),
    requestCommittedSha256: "b".repeat(64),
    requestSha256: "c".repeat(64),
  };
}

function hashJson(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function sha256(value: string): string {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(
    Buffer.from(left),
    Buffer.from(right),
  );
}
