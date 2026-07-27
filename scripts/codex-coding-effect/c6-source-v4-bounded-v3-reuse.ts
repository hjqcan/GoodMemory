import { createHash } from "node:crypto";
import { join } from "node:path";

import {
  readC6StableRegularFile,
} from "./c6-asset-lock";
import {
  C6_SOURCE_V4_BOUNDED_RUNTIME_AUTHORIZATION_SHA256,
  C6_SOURCE_V4_BOUNDED_V3_EVALUATION_ID,
  C6_SOURCE_V4_BOUNDED_V3_EXECUTION_CONTRACT_SHA256,
  C6_SOURCE_V4_BOUNDED_V3_FRAME_REPOSITORY_COUNT,
  C6_SOURCE_V4_BOUNDED_V3_FROZEN_INPUT_CLOSURE_SHA256,
  C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE,
} from "./c6-source-v4-bounded-contract";
import {
  deriveC6SourceV4BoundedPilotRepositoryNodeIdExclusions,
} from "./c6-source-v4-bounded-frame";
import {
  replayC6SourceV4BoundedRepositoryPrefix,
} from "./c6-source-v4-bounded-v3-observation";
import {
  scanC6SourceV4BoundedV3CommittedRequests,
} from "./c6-source-v4-bounded-v3-runtime";
import {
  readC6SourceV3SimpleFrozenInputClosureIfExists,
} from "./c6-source-v3-simple-census-finalization";
import {
  readC6SourceV3SimpleProjectedLogicalRequest,
} from "./c6-source-v3-simple-census-ledger";
import type {
  C6SourceV3SimpleArtifactReference,
} from "./c6-source-v3-simple-census-ledger";
import type {
  C6SourceV3SimpleProjectedLogicalRequest,
} from "./c6-source-v3-simple-census-replay";

const REPOSITORY_PREFIX_LOGICAL_REQUEST_COUNT = 4_497;
const REPOSITORY_COUNT_REQUEST_COUNT = 1_604;
const REPOSITORY_PAGE_REQUEST_COUNT = 2_893;
const REPOSITORY_ROW_COUNT = 191_612;
const REPOSITORY_LEAF_CLOSURE_COUNT = 1_570;

export async function loadC6SourceV4BoundedV3ReuseInput(
  input: {
    v3AssetRoot: string;
  },
) {
  const frozen =
    await readC6SourceV3SimpleFrozenInputClosureIfExists(
      input.v3AssetRoot,
    );
  if (
    frozen === null ||
    frozen.reference.sha256 !==
      C6_SOURCE_V4_BOUNDED_V3_FROZEN_INPUT_CLOSURE_SHA256 ||
    frozen.expected.evaluationId !==
      C6_SOURCE_V4_BOUNDED_V3_EVALUATION_ID ||
    frozen.expected.executionContractSha256 !==
      C6_SOURCE_V4_BOUNDED_V3_EXECUTION_CONTRACT_SHA256 ||
    frozen.expected.runtimeAuthorizationSha256 !==
      C6_SOURCE_V4_BOUNDED_RUNTIME_AUTHORIZATION_SHA256
  ) {
    throw new Error(
      "C6 source-v4 bounded v3 frozen input identity mismatch",
    );
  }
  const passRoot = join(input.v3AssetRoot, "pass-a");
  const scan =
    await scanC6SourceV4BoundedV3CommittedRequests({
      evaluationId:
        C6_SOURCE_V4_BOUNDED_V3_EVALUATION_ID,
      executionContractSha256:
        C6_SOURCE_V4_BOUNDED_V3_EXECUTION_CONTRACT_SHA256,
      frozenInputClosureSha256:
        C6_SOURCE_V4_BOUNDED_V3_FROZEN_INPUT_CLOSURE_SHA256,
      passRoot,
      runtimeAuthorizationSha256:
        C6_SOURCE_V4_BOUNDED_RUNTIME_AUTHORIZATION_SHA256,
    });
  const prefixRequests:
    C6SourceV3SimpleProjectedLogicalRequest[] = [];
  const completions:
    C6SourceV3SimpleArtifactReference[] = [];
  for (
    let ordinal = 1;
    ordinal <= REPOSITORY_PREFIX_LOGICAL_REQUEST_COUNT;
    ordinal += 1
  ) {
    const name =
      `logical-request-complete-${
        String(ordinal).padStart(8, "0")
      }.json`;
    const bytes = await readC6StableRegularFile(
      join(passRoot, name),
      "source-v4 bounded v3 repository-prefix completion",
      undefined,
      true,
    );
    const reference = {
      bytes: bytes.length,
      path: `pass-a/${name}`,
      sha256: sha256(bytes),
    };
    completions.push(reference);
    prefixRequests.push(
      await readC6SourceV3SimpleProjectedLogicalRequest(
        input.v3AssetRoot,
        reference,
      ),
    );
  }
  assertOperationBoundary(scan.entries);
  const repositoryPrefix =
    await replayC6SourceV4BoundedRepositoryPrefix({
      frame: frozen.expected.frame,
      requests: prefixRequests,
    });
  assertRepositoryPrefixCounts(
    repositoryPrefix,
    prefixRequests,
  );
  const pilotRepositoryNodeIds =
    deriveC6SourceV4BoundedPilotRepositoryNodeIdExclusions(
      scan.requests,
    );
  const frameRepositoryNodeIds = new Set(
    repositoryPrefix.frameRepositories.map(
      (repository) =>
        repository.repositoryNodeId,
    ),
  );
  if (
    pilotRepositoryNodeIds.some(
      (repositoryNodeId) =>
        !frameRepositoryNodeIds.has(repositoryNodeId),
    )
  ) {
    throw new Error(
      "C6 source-v4 bounded pilot exclusion escapes the verified v3 repository frame",
    );
  }
  const result = {
    committedAttemptCount: scan.entries.length,
    committedRequestClosureSha256:
      scan.committedRequestClosureSha256,
    durableRequestEntries: scan.entries,
    frame: frozen.expected.frame,
    frameRepositories:
      repositoryPrefix.frameRepositories,
    frameRepositoriesSha256: hashJson(
      repositoryPrefix.frameRepositories,
    ),
    frozenInputClosure:
      frozen.reference,
    pilotPullRequestAttemptCount:
      scan.entries.filter(
        (entry) =>
          entry.request.persistedRequest.operationName ===
            "C6SourceV3SimplePullRequestPage",
      ).length,
    pilotRepositoryNodeIds,
    pilotRepositoryNodeIdsSha256:
      hashJson(pilotRepositoryNodeIds),
    prefixCompletionRootSha256:
      hashCompletionRoot(completions),
    repositories: repositoryPrefix.repositories,
    repositoriesSha256: hashJson(
      repositoryPrefix.repositories,
    ),
    repositoryDecisions:
      repositoryPrefix.repositoryDecisions,
    repositoryDecisionsSha256: hashJson(
      repositoryPrefix.repositoryDecisions,
    ),
    repositoryLeafClosures:
      repositoryPrefix.repositoryLeafClosures,
    repositoryLeafClosuresSha256: hashJson(
      repositoryPrefix.repositoryLeafClosures,
    ),
    requestStructureSha256:
      scan.structureSha256,
  };
  assertObservedClosure(result);
  return result;
}

function assertObservedClosure(
  input: {
    committedAttemptCount: number;
    committedRequestClosureSha256: string;
    frameRepositoriesSha256: string;
    pilotPullRequestAttemptCount: number;
    pilotRepositoryNodeIds:
      readonly string[];
    pilotRepositoryNodeIdsSha256: string;
    prefixCompletionRootSha256: string;
    repositoriesSha256: string;
    repositoryDecisionsSha256: string;
    repositoryLeafClosuresSha256: string;
    requestStructureSha256: string;
  },
): void {
  const actual = {
    committedAttemptCount:
      input.committedAttemptCount,
    committedRequestClosureSha256:
      input.committedRequestClosureSha256,
    frameRepositoriesSha256:
      input.frameRepositoriesSha256,
    pilotPullRequestAttemptCount:
      input.pilotPullRequestAttemptCount,
    pilotRepositoryNodeIdCount:
      input.pilotRepositoryNodeIds.length,
    pilotRepositoryNodeIdsSha256:
      input.pilotRepositoryNodeIdsSha256,
    prefixCompletionRootSha256:
      input.prefixCompletionRootSha256,
    repositoriesSha256:
      input.repositoriesSha256,
    repositoryDecisionsSha256:
      input.repositoryDecisionsSha256,
    repositoryLeafClosuresSha256:
      input.repositoryLeafClosuresSha256,
    requestStructureSha256:
      input.requestStructureSha256,
    status: "exact-observation-reuse-input-only",
  } as const;
  if (
    JSON.stringify(actual) !==
      JSON.stringify(
        C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE,
      )
  ) {
    throw new Error(
      "C6 source-v4 bounded v3 observed closure mismatch",
    );
  }
}

function assertOperationBoundary(
  entries: readonly {
    logicalRequestOrdinal: number;
    request: {
      persistedRequest: {
        operationName: string;
      };
    };
  }[],
): void {
  for (const entry of entries) {
    const operation =
      entry.request.persistedRequest.operationName;
    const expected = entry.logicalRequestOrdinal <=
        REPOSITORY_PREFIX_LOGICAL_REQUEST_COUNT
      ? new Set([
          "C6SourceV3SimpleRepositoryCount",
          "C6SourceV3SimpleRepositoryPage",
        ])
      : new Set([
          "C6SourceV3SimplePullRequestPage",
        ]);
    if (!expected.has(operation)) {
      throw new Error(
        "C6 source-v4 bounded v3 repository/PR operation boundary mismatch",
      );
    }
  }
}

function assertRepositoryPrefixCounts(
  prefix: {
    countTrees: readonly unknown[];
    frameRepositories: readonly unknown[];
    logicalRequestCount: number;
    repositories: readonly unknown[];
    repositoryLeafClosures: readonly unknown[];
  },
  requests:
    readonly C6SourceV3SimpleProjectedLogicalRequest[],
): void {
  const countRequests = requests.filter(
    (request) =>
      request.operationName ===
        "C6SourceV3SimpleRepositoryCount",
  ).length;
  const pageRequests = requests.filter(
    (request) =>
      request.operationName ===
        "C6SourceV3SimpleRepositoryPage",
  ).length;
  if (
    prefix.logicalRequestCount !==
      REPOSITORY_PREFIX_LOGICAL_REQUEST_COUNT ||
    countRequests !== REPOSITORY_COUNT_REQUEST_COUNT ||
    pageRequests !== REPOSITORY_PAGE_REQUEST_COUNT ||
    prefix.countTrees.length !== 1_536 ||
    prefix.repositoryLeafClosures.length !==
      REPOSITORY_LEAF_CLOSURE_COUNT ||
    prefix.repositories.length !== REPOSITORY_ROW_COUNT ||
    prefix.frameRepositories.length !==
      C6_SOURCE_V4_BOUNDED_V3_FRAME_REPOSITORY_COUNT
  ) {
    throw new Error(
      "C6 source-v4 bounded v3 repository-prefix count mismatch",
    );
  }
}

function hashCompletionRoot(
  completions:
    readonly C6SourceV3SimpleArtifactReference[],
): string {
  return sha256(Buffer.from(completions.map(
    (completion, index) =>
      `${index + 1}\u0000${completion.sha256}\n`,
  ).join("")));
}

function hashJson(value: unknown): string {
  return sha256(Buffer.from(JSON.stringify(value)));
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
