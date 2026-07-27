import { createHash } from "node:crypto";

import { z } from "zod";

import {
  buildC6SourceV4BoundedContract,
  C6_SOURCE_V4_BOUNDED_EVALUATION_ID,
  C6_SOURCE_V4_BOUNDED_LANGUAGE_SPLITS,
  C6_SOURCE_V4_BOUNDED_REPOSITORIES_PER_LANGUAGE,
  C6_SOURCE_V4_BOUNDED_REPOSITORY_COUNT,
  C6_SOURCE_V4_BOUNDED_RUNTIME_AUTHORIZATION_SHA256,
  C6_SOURCE_V4_BOUNDED_V3_EVALUATION_ID,
  C6_SOURCE_V4_BOUNDED_V3_EXECUTION_CONTRACT_SHA256,
  C6_SOURCE_V4_BOUNDED_V3_FRAME_REPOSITORY_COUNT,
  C6_SOURCE_V4_BOUNDED_V3_FRAME_SHA256,
  C6_SOURCE_V4_BOUNDED_V3_FROZEN_INPUT_CLOSURE_BYTES,
  C6_SOURCE_V4_BOUNDED_V3_FROZEN_INPUT_CLOSURE_SHA256,
  C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE,
  serializeC6SourceV4BoundedContract,
} from "./c6-source-v4-bounded-contract";
import {
  computeC6SourceV4BoundedRepositoryRankSha256,
  deriveC6SourceV4BoundedPilotRepositoryNodeIdExclusions,
  selectC6SourceV4BoundedRepositories,
} from "./c6-source-v4-bounded-frame";
import type {
  C6SourceV4BoundedRepositoryCandidate,
  C6SourceV4BoundedSelectedRepository,
} from "./c6-source-v4-bounded-frame";
import {
  parseC6SourceV3SimpleFrameDefinition,
} from "./c6-source-v3-simple-census-core";
import type {
  C6SourceV3SimpleFrameDefinition,
} from "./c6-source-v3-simple-census-core";
import type {
  C6SourceV4BoundedV3CommittedRequest,
} from "./c6-source-v4-bounded-v3-runtime";
import {
  verifyC6SourceV3SimpleDurableGraphqlRequest,
} from "./c6-source-v3-simple-census-transport";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const VERIFIED_RECEIPT =
  Symbol("C6 source-v4 bounded verified receipt");
const PRIOR_REPOSITORY_ALIASES_SHA256 =
  "360da907fb4dd3c4e3e023c528b90e8f5401e5f52bc13b69fcce034b8b44ab01";
const PRIOR_REPOSITORY_NODE_IDS_SHA256 =
  "1a37e4813d5d1617af5cecc0b5a0449f5b89b85bd9a1588bfac8ba38a1a79dd3";
const sha256Schema = z.string().regex(SHA256_PATTERN);
const selectedRepositorySchema = z.object({
  repositoryNodeId: z.string().min(1),
  repositoryRankSha256: sha256Schema,
  selectionRank: z.number().int().min(1).max(
    C6_SOURCE_V4_BOUNDED_REPOSITORIES_PER_LANGUAGE,
  ),
  sourceSplit: z.enum(
    C6_SOURCE_V4_BOUNDED_LANGUAGE_SPLITS,
  ),
}).strict();

const v3PrefixReuseReceiptSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v4-bounded-v3-prefix-reuse-receipt",
  ),
  boundary: z.object({
    promotable: z.literal(false),
    reuseAuthority: z.literal("data-reuse-only"),
    terminalDisposition: z.literal(
      "abandoned-infeasible-observation",
    ),
  }).strict(),
  counts: z.object({
    countTreeCount: z.literal(1_536),
    frameRepositoryRowCount: z.literal(
      C6_SOURCE_V4_BOUNDED_V3_FRAME_REPOSITORY_COUNT,
    ),
    logicalRequestCount: z.literal(4_497),
    normalizedRepositoryRowCount: z.literal(191_612),
    repositoryCountRequestCount: z.literal(1_604),
    repositoryLeafClosureCount: z.literal(1_570),
    repositoryPageRequestCount: z.literal(2_893),
  }).strict(),
  historicalV3: z.object({
    evaluationId: z.literal(
      C6_SOURCE_V4_BOUNDED_V3_EVALUATION_ID,
    ),
    executionContractSha256: z.literal(
      C6_SOURCE_V4_BOUNDED_V3_EXECUTION_CONTRACT_SHA256,
    ),
    frameSha256: z.literal(
      C6_SOURCE_V4_BOUNDED_V3_FRAME_SHA256,
    ),
    frozenInputClosureSha256: z.literal(
      C6_SOURCE_V4_BOUNDED_V3_FROZEN_INPUT_CLOSURE_SHA256,
    ),
    runtimeAuthorizationSha256: z.literal(
      C6_SOURCE_V4_BOUNDED_RUNTIME_AUTHORIZATION_SHA256,
    ),
  }).strict(),
  repositoryPrefix: z.object({
    frameRepositoryRowsSha256: z.literal(
      C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
        .frameRepositoriesSha256,
    ),
    normalizedRepositoryRowsSha256: z.literal(
      C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
        .repositoriesSha256,
    ),
    prefixCompletionRootSha256: z.literal(
      C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
        .prefixCompletionRootSha256,
    ),
    priorRepositoryAliasesSha256: z.literal(
      PRIOR_REPOSITORY_ALIASES_SHA256,
    ),
    priorRepositoryNodeIdsSha256: z.literal(
      PRIOR_REPOSITORY_NODE_IDS_SHA256,
    ),
    scannerCommittedRequestClosureSha256:
      z.literal(
        C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
          .committedRequestClosureSha256,
      ),
    scannerRequestStructureSha256: z.literal(
      C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
        .requestStructureSha256,
    ),
  }).strict(),
  schemaVersion: z.literal(1),
}).strict();

const pilotExclusionReceiptSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v4-bounded-pilot-exclusion-receipt",
  ),
  excludedRepositoryNodeIdCount:
    z.number().int().positive(),
  excludedRepositoryNodeIds:
    z.array(z.string().min(1)).min(1),
  excludedRepositoryNodeIdsSha256: sha256Schema,
  frameRepositoryRowsSha256: z.literal(
    C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
      .frameRepositoriesSha256,
  ),
  scannerCommittedRequestClosureSha256:
    z.literal(
      C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
        .committedRequestClosureSha256,
    ),
  scannerRequestStructureSha256: z.literal(
    C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
      .requestStructureSha256,
  ),
  schemaVersion: z.literal(1),
  v3PrefixReuseReceiptSha256: sha256Schema,
}).strict();

const selectionReceiptSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v4-bounded-selection-receipt",
  ),
  evaluationId: z.literal(
    C6_SOURCE_V4_BOUNDED_EVALUATION_ID,
  ),
  pilotExclusionReceiptSha256: sha256Schema,
  repositoriesPerLanguage: z.literal(
    C6_SOURCE_V4_BOUNDED_REPOSITORIES_PER_LANGUAGE,
  ),
  repositoryCount: z.literal(
    C6_SOURCE_V4_BOUNDED_REPOSITORY_COUNT,
  ),
  repositoryFrameRowsSha256: z.literal(
    C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
      .frameRepositoriesSha256,
  ),
  replacementAllowed: z.literal(false),
  schemaVersion: z.literal(1),
  selectedRepositories: z.array(
    selectedRepositorySchema,
  ).length(C6_SOURCE_V4_BOUNDED_REPOSITORY_COUNT),
  selectedRepositoriesSha256: sha256Schema,
  selectionOrder: z.literal(
    "contract-language-order-then-rank-sha256-then-repository-node-id",
  ),
  v3PrefixReuseReceiptSha256: sha256Schema,
  v4ContractSha256: sha256Schema,
}).strict();

export type C6SourceV4BoundedV3PrefixReuseReceipt =
  z.infer<typeof v3PrefixReuseReceiptSchema>;
export type C6SourceV4BoundedPilotExclusionReceipt =
  z.infer<typeof pilotExclusionReceiptSchema>;
export type C6SourceV4BoundedSelectionReceipt =
  z.infer<typeof selectionReceiptSchema>;

export interface ParsedC6SourceV4BoundedV3PrefixReuseReceipt {
  receipt: C6SourceV4BoundedV3PrefixReuseReceipt;
  sha256: string;
}

export interface ParsedC6SourceV4BoundedPilotExclusionReceipt {
  receipt: C6SourceV4BoundedPilotExclusionReceipt;
  sha256: string;
}

export interface ParsedC6SourceV4BoundedSelectionReceipt {
  receipt: C6SourceV4BoundedSelectionReceipt;
  sha256: string;
}

export interface LoadedC6SourceV4BoundedV3PrefixReuseReceipt
  extends ParsedC6SourceV4BoundedV3PrefixReuseReceipt {
  readonly [VERIFIED_RECEIPT]: true;
}

export interface LoadedC6SourceV4BoundedPilotExclusionReceipt
  extends ParsedC6SourceV4BoundedPilotExclusionReceipt {
  readonly [VERIFIED_RECEIPT]: true;
}

export interface LoadedC6SourceV4BoundedSelectionReceipt
  extends ParsedC6SourceV4BoundedSelectionReceipt {
  readonly [VERIFIED_RECEIPT]: true;
}

export interface C6SourceV4BoundedV3PrefixReuseBuildInput {
  committedAttemptCount: number;
  committedRequestClosureSha256: string;
  durableRequestEntries:
    readonly C6SourceV4BoundedV3CommittedRequest[];
  frame: C6SourceV3SimpleFrameDefinition;
  frameRepositories:
    readonly C6SourceV4BoundedRepositoryCandidate[];
  frameRepositoriesSha256: string;
  frozenInputClosure: {
    bytes: number;
    path: string;
    sha256: string;
  };
  pilotPullRequestAttemptCount: number;
  pilotRepositoryNodeIds: readonly string[];
  pilotRepositoryNodeIdsSha256: string;
  prefixCompletionRootSha256: string;
  repositories:
    readonly C6SourceV4BoundedRepositoryCandidate[];
  repositoriesSha256: string;
  repositoryDecisions: readonly unknown[];
  repositoryDecisionsSha256: string;
  repositoryLeafClosures: readonly unknown[];
  repositoryLeafClosuresSha256: string;
  requestStructureSha256: string;
}

export interface C6SourceV4BoundedPilotExclusionBuildInput {
  prefixReceipt:
    LoadedC6SourceV4BoundedV3PrefixReuseReceipt;
  v3Reuse: C6SourceV4BoundedV3PrefixReuseBuildInput;
}

export interface C6SourceV4BoundedSelectionBuildInput {
  pilotExclusionReceipt:
    LoadedC6SourceV4BoundedPilotExclusionReceipt;
  prefixReceipt:
    LoadedC6SourceV4BoundedV3PrefixReuseReceipt;
  v3Reuse: C6SourceV4BoundedV3PrefixReuseBuildInput;
}

export const C6_SOURCE_V4_BOUNDED_CONTRACT_SHA256 =
  sha256(
    serializeC6SourceV4BoundedContract(
      buildC6SourceV4BoundedContract(),
    ),
  );

export function buildC6SourceV4BoundedV3PrefixReuseReceipt(
  input: C6SourceV4BoundedV3PrefixReuseBuildInput,
): LoadedC6SourceV4BoundedV3PrefixReuseReceipt {
  assertExactKeys(
    input,
    [
      "committedAttemptCount",
      "committedRequestClosureSha256",
      "durableRequestEntries",
      "frame",
      "frameRepositories",
      "frameRepositoriesSha256",
      "frozenInputClosure",
      "pilotPullRequestAttemptCount",
      "pilotRepositoryNodeIds",
      "pilotRepositoryNodeIdsSha256",
      "prefixCompletionRootSha256",
      "repositories",
      "repositoriesSha256",
      "repositoryDecisions",
      "repositoryDecisionsSha256",
      "repositoryLeafClosures",
      "repositoryLeafClosuresSha256",
      "requestStructureSha256",
    ],
    "C6 source-v4 bounded v3 prefix receipt input keys",
  );
  const frame =
    parseC6SourceV3SimpleFrameDefinition(input.frame);
  if (
    hashJson(frame) !==
      C6_SOURCE_V4_BOUNDED_V3_FRAME_SHA256
  ) {
    throw new Error(
      "C6 source-v4 bounded v3 prefix frame identity mismatch",
    );
  }
  assertRepositoryPrefixRows(input);
  const frameRepositoriesSha256 =
    hashJson(input.frameRepositories);
  const repositoriesSha256 =
    hashJson(input.repositories);
  const repositoryDecisionsSha256 =
    hashJson(input.repositoryDecisions);
  const repositoryLeafClosuresSha256 =
    hashJson(input.repositoryLeafClosures);
  if (
    input.frameRepositoriesSha256 !==
      frameRepositoriesSha256 ||
    input.repositoriesSha256 !== repositoriesSha256 ||
    input.repositoryDecisionsSha256 !==
      repositoryDecisionsSha256 ||
    input.repositoryLeafClosuresSha256 !==
      repositoryLeafClosuresSha256 ||
    input.pilotRepositoryNodeIdsSha256 !==
      hashJson(input.pilotRepositoryNodeIds)
  ) {
    throw new Error(
      "C6 source-v4 bounded v3 prefix projection hash mismatch",
    );
  }
  assertSortedUniqueStrings(
    input.pilotRepositoryNodeIds,
    "pilot repository node IDs",
  );
  const frameRepositoryNodeIds = new Set(
    input.frameRepositories.map(
      (row) => row.repositoryNodeId,
    ),
  );
  if (
    input.pilotRepositoryNodeIds.some(
      (repositoryNodeId) =>
        !frameRepositoryNodeIds.has(repositoryNodeId),
    )
  ) {
    throw new Error(
      "C6 source-v4 bounded v3 pilot repository is outside the verified frame",
    );
  }
  const observedClosure = {
    committedAttemptCount:
      input.committedAttemptCount,
    committedRequestClosureSha256:
      input.committedRequestClosureSha256,
    frameRepositoriesSha256,
    pilotPullRequestAttemptCount:
      input.pilotPullRequestAttemptCount,
    pilotRepositoryNodeIdCount:
      input.pilotRepositoryNodeIds.length,
    pilotRepositoryNodeIdsSha256:
      input.pilotRepositoryNodeIdsSha256,
    prefixCompletionRootSha256:
      input.prefixCompletionRootSha256,
    repositoriesSha256,
    repositoryDecisionsSha256,
    repositoryLeafClosuresSha256,
    requestStructureSha256:
      input.requestStructureSha256,
    status: "exact-observation-reuse-input-only",
  } as const;
  assertExactKeys(
    input.frozenInputClosure,
    ["bytes", "path", "sha256"],
    "C6 source-v4 bounded frozen input closure keys",
  );
  if (
    input.durableRequestEntries.length !==
      input.committedAttemptCount ||
    hashCommittedRequestClosure(
      input.durableRequestEntries,
    ) !== input.committedRequestClosureSha256 ||
    input.frozenInputClosure.bytes !==
      C6_SOURCE_V4_BOUNDED_V3_FROZEN_INPUT_CLOSURE_BYTES ||
    input.frozenInputClosure.path !==
      "frozen-input-closure.json" ||
    input.frozenInputClosure.sha256 !==
      C6_SOURCE_V4_BOUNDED_V3_FROZEN_INPUT_CLOSURE_SHA256 ||
    JSON.stringify(observedClosure) !==
      JSON.stringify(
        C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE,
      )
  ) {
    throw new Error(
      "C6 source-v4 bounded v3 observed closure mismatch",
    );
  }

  return loadBuiltV3PrefixReuseReceipt({
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
      frameRepositoryRowCount:
        C6_SOURCE_V4_BOUNDED_V3_FRAME_REPOSITORY_COUNT,
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
        PRIOR_REPOSITORY_ALIASES_SHA256,
      priorRepositoryNodeIdsSha256:
        PRIOR_REPOSITORY_NODE_IDS_SHA256,
      scannerCommittedRequestClosureSha256:
        C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
          .committedRequestClosureSha256,
      scannerRequestStructureSha256:
        C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
          .requestStructureSha256,
    },
    schemaVersion: 1,
  });
}

export function verifyC6SourceV4BoundedV3PrefixReuseReceipt(
  loaded:
    ParsedC6SourceV4BoundedV3PrefixReuseReceipt,
  input: C6SourceV4BoundedV3PrefixReuseBuildInput,
): LoadedC6SourceV4BoundedV3PrefixReuseReceipt {
  assertParsedV3PrefixReuseReceipt(loaded);
  const rebuilt =
    buildC6SourceV4BoundedV3PrefixReuseReceipt(input);
  assertSameLoadedReceipt(
    loaded,
    rebuilt,
    "C6 source-v4 bounded v3 prefix receipt",
  );
  return markVerifiedReceipt(
    parseC6SourceV4BoundedV3PrefixReuseReceipt(
    serializeC6SourceV4BoundedV3PrefixReuseReceipt(
      loaded.receipt,
    ),
    ),
  );
}

export function serializeC6SourceV4BoundedV3PrefixReuseReceipt(
  input: C6SourceV4BoundedV3PrefixReuseReceipt,
): string {
  const receipt = v3PrefixReuseReceiptSchema.parse(input);
  return canonicalJson(receipt);
}

export function parseC6SourceV4BoundedV3PrefixReuseReceipt(
  input: string | Uint8Array,
): ParsedC6SourceV4BoundedV3PrefixReuseReceipt {
  const text = decodeCanonicalJsonInput(
    input,
    "C6 source-v4 bounded v3 prefix receipt",
  );
  const receipt = v3PrefixReuseReceiptSchema.parse(
    parseJson(
      text,
      "C6 source-v4 bounded v3 prefix receipt",
    ),
  );
  if (text !== canonicalJson(receipt)) {
    throw new Error(
      "C6 source-v4 bounded v3 prefix receipt is not canonical JSON",
    );
  }
  return {
    receipt,
    sha256: sha256(text),
  };
}

export function buildC6SourceV4BoundedPilotExclusionReceipt(
  input: C6SourceV4BoundedPilotExclusionBuildInput,
): LoadedC6SourceV4BoundedPilotExclusionReceipt {
  assertExactKeys(
    input,
    [
      "prefixReceipt",
      "v3Reuse",
    ],
    "C6 source-v4 bounded pilot exclusion input keys",
  );
  assertLoadedV3PrefixReuseReceipt(input.prefixReceipt);
  const prefix =
    input.prefixReceipt.receipt.repositoryPrefix;
  const excludedRepositoryNodeIds =
    deriveC6SourceV4BoundedPilotRepositoryNodeIdExclusions(
      input.v3Reuse.durableRequestEntries.map(
        (entry) => entry.request,
      ),
    );
  const frameRepositoryNodeIds = new Set(
    input.v3Reuse.frameRepositories.map(
      (row) => row.repositoryNodeId,
    ),
  );
  if (
    excludedRepositoryNodeIds.some(
      (repositoryNodeId) =>
        !frameRepositoryNodeIds.has(repositoryNodeId),
    )
  ) {
    throw new Error(
      "C6 source-v4 bounded pilot exclusion is outside the verified repository frame",
    );
  }
  verifyC6SourceV4BoundedV3PrefixReuseReceipt(
    input.prefixReceipt,
    input.v3Reuse,
  );
  const excludedRepositoryNodeIdsSha256 =
    hashJson(excludedRepositoryNodeIds);
  if (
    input.v3Reuse.durableRequestEntries.length !==
      C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
        .committedAttemptCount ||
    hashCommittedRequestClosure(
      input.v3Reuse.durableRequestEntries,
    ) !==
      C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
        .committedRequestClosureSha256 ||
    excludedRepositoryNodeIds.length !==
      C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
        .pilotRepositoryNodeIdCount ||
    excludedRepositoryNodeIdsSha256 !==
      C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
        .pilotRepositoryNodeIdsSha256 ||
    !sameStrings(
      excludedRepositoryNodeIds,
      input.v3Reuse.pilotRepositoryNodeIds,
    )
  ) {
    throw new Error(
      "C6 source-v4 bounded pilot exact observed request closure mismatch",
    );
  }

  return loadBuiltPilotExclusionReceipt({
    artifactKind:
      "c6-source-v4-bounded-pilot-exclusion-receipt",
    excludedRepositoryNodeIdCount:
      excludedRepositoryNodeIds.length,
    excludedRepositoryNodeIds,
    excludedRepositoryNodeIdsSha256:
      excludedRepositoryNodeIdsSha256,
    frameRepositoryRowsSha256:
      prefix.frameRepositoryRowsSha256,
    scannerCommittedRequestClosureSha256:
      prefix.scannerCommittedRequestClosureSha256,
    scannerRequestStructureSha256:
      prefix.scannerRequestStructureSha256,
    schemaVersion: 1,
    v3PrefixReuseReceiptSha256:
      input.prefixReceipt.sha256,
  });
}

export function verifyC6SourceV4BoundedPilotExclusionReceipt(
  loaded:
    ParsedC6SourceV4BoundedPilotExclusionReceipt,
  input: C6SourceV4BoundedPilotExclusionBuildInput,
): LoadedC6SourceV4BoundedPilotExclusionReceipt {
  assertParsedPilotExclusionReceipt(loaded);
  const rebuilt =
    buildC6SourceV4BoundedPilotExclusionReceipt(input);
  assertSameLoadedReceipt(
    loaded,
    rebuilt,
    "C6 source-v4 bounded pilot exclusion receipt",
  );
  return markVerifiedReceipt(
    parseC6SourceV4BoundedPilotExclusionReceipt(
    serializeC6SourceV4BoundedPilotExclusionReceipt(
      loaded.receipt,
    ),
    ),
  );
}

export function serializeC6SourceV4BoundedPilotExclusionReceipt(
  input: C6SourceV4BoundedPilotExclusionReceipt,
): string {
  const receipt = pilotExclusionReceiptSchema.parse(input);
  assertPilotExclusionReceipt(receipt);
  return canonicalJson(receipt);
}

export function parseC6SourceV4BoundedPilotExclusionReceipt(
  input: string | Uint8Array,
): ParsedC6SourceV4BoundedPilotExclusionReceipt {
  const text = decodeCanonicalJsonInput(
    input,
    "C6 source-v4 bounded pilot exclusion receipt",
  );
  const receipt = pilotExclusionReceiptSchema.parse(
    parseJson(
      text,
      "C6 source-v4 bounded pilot exclusion receipt",
    ),
  );
  assertPilotExclusionReceipt(receipt);
  if (text !== canonicalJson(receipt)) {
    throw new Error(
      "C6 source-v4 bounded pilot exclusion receipt is not canonical JSON",
    );
  }
  return {
    receipt,
    sha256: sha256(text),
  };
}

export function buildC6SourceV4BoundedSelectionReceipt(
  input: C6SourceV4BoundedSelectionBuildInput,
): LoadedC6SourceV4BoundedSelectionReceipt {
  assertExactKeys(
    input,
    [
      "pilotExclusionReceipt",
      "prefixReceipt",
      "v3Reuse",
    ],
    "C6 source-v4 bounded selection input keys",
  );
  assertLoadedV3PrefixReuseReceipt(input.prefixReceipt);
  assertLoadedPilotExclusionReceipt(
    input.pilotExclusionReceipt,
  );
  verifyC6SourceV4BoundedPilotExclusionReceipt(
    input.pilotExclusionReceipt,
    {
      prefixReceipt: input.prefixReceipt,
      v3Reuse: input.v3Reuse,
    },
  );
  const prefix =
    input.prefixReceipt.receipt.repositoryPrefix;
  const exclusion = input.pilotExclusionReceipt.receipt;
  if (
    exclusion.v3PrefixReuseReceiptSha256 !==
      input.prefixReceipt.sha256 ||
    exclusion.scannerCommittedRequestClosureSha256 !==
      prefix.scannerCommittedRequestClosureSha256 ||
    exclusion.scannerRequestStructureSha256 !==
      prefix.scannerRequestStructureSha256 ||
    exclusion.frameRepositoryRowsSha256 !==
      prefix.frameRepositoryRowsSha256
  ) {
    throw new Error(
      "C6 source-v4 bounded selection cross-receipt identity mismatch",
    );
  }
  if (
    exclusion.excludedRepositoryNodeIdCount !==
      C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
        .pilotRepositoryNodeIdCount ||
    exclusion.excludedRepositoryNodeIdsSha256 !==
      C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
        .pilotRepositoryNodeIdsSha256
  ) {
    throw new Error(
      "C6 source-v4 bounded selection exact observed pilot exclusion mismatch",
    );
  }
  verifyC6SourceV4BoundedV3PrefixReuseReceipt(
    input.prefixReceipt,
    input.v3Reuse,
  );
  if (
    !sameStrings(
      exclusion.excludedRepositoryNodeIds,
      input.v3Reuse.pilotRepositoryNodeIds,
    )
  ) {
    throw new Error(
      "C6 source-v4 bounded selection pilot exclusion set mismatch",
    );
  }
  assertFrameRowsMatchPrefix(
    input.v3Reuse.frameRepositories,
    prefix.frameRepositoryRowsSha256,
  );
  const selectedRepositories =
    selectC6SourceV4BoundedRepositories({
      excludedRepositoryNodeIds:
        exclusion.excludedRepositoryNodeIds,
      repositories: input.v3Reuse.frameRepositories.map(
        projectRepositoryCandidate,
      ),
    }).map((repository) =>
      selectedRepositorySchema.parse(repository)
    );

  return loadBuiltSelectionReceipt({
    artifactKind:
      "c6-source-v4-bounded-selection-receipt",
    evaluationId:
      C6_SOURCE_V4_BOUNDED_EVALUATION_ID,
    pilotExclusionReceiptSha256:
      input.pilotExclusionReceipt.sha256,
    repositoriesPerLanguage:
      C6_SOURCE_V4_BOUNDED_REPOSITORIES_PER_LANGUAGE,
    repositoryCount:
      C6_SOURCE_V4_BOUNDED_REPOSITORY_COUNT,
    repositoryFrameRowsSha256:
      prefix.frameRepositoryRowsSha256,
    replacementAllowed: false,
    schemaVersion: 1,
    selectedRepositories,
    selectedRepositoriesSha256:
      hashJson(selectedRepositories),
    selectionOrder:
      "contract-language-order-then-rank-sha256-then-repository-node-id",
    v3PrefixReuseReceiptSha256:
      input.prefixReceipt.sha256,
    v4ContractSha256:
      C6_SOURCE_V4_BOUNDED_CONTRACT_SHA256,
  });
}

export function verifyC6SourceV4BoundedSelectionReceipt(
  loaded: ParsedC6SourceV4BoundedSelectionReceipt,
  input: C6SourceV4BoundedSelectionBuildInput,
): LoadedC6SourceV4BoundedSelectionReceipt {
  assertParsedSelectionReceipt(loaded);
  const rebuilt =
    buildC6SourceV4BoundedSelectionReceipt(input);
  assertSameLoadedReceipt(
    loaded,
    rebuilt,
    "C6 source-v4 bounded selection receipt",
  );
  return markVerifiedReceipt(
    parseC6SourceV4BoundedSelectionReceipt(
    serializeC6SourceV4BoundedSelectionReceipt(
      loaded.receipt,
    ),
    ),
  );
}

export function serializeC6SourceV4BoundedSelectionReceipt(
  input: C6SourceV4BoundedSelectionReceipt,
): string {
  const receipt = selectionReceiptSchema.parse(input);
  assertSelectionReceipt(receipt);
  return canonicalJson(receipt);
}

export function parseC6SourceV4BoundedSelectionReceipt(
  input: string | Uint8Array,
): ParsedC6SourceV4BoundedSelectionReceipt {
  const text = decodeCanonicalJsonInput(
    input,
    "C6 source-v4 bounded selection receipt",
  );
  const receipt = selectionReceiptSchema.parse(
    parseJson(
      text,
      "C6 source-v4 bounded selection receipt",
    ),
  );
  assertSelectionReceipt(receipt);
  if (text !== canonicalJson(receipt)) {
    throw new Error(
      "C6 source-v4 bounded selection receipt is not canonical JSON",
    );
  }
  return {
    receipt,
    sha256: sha256(text),
  };
}

function assertRepositoryPrefixRows(
  input: Pick<
    C6SourceV4BoundedV3PrefixReuseBuildInput,
    "frameRepositories" | "repositories"
  >,
): void {
  if (
    input.repositories.length !== 191_612 ||
    input.frameRepositories.length !==
      C6_SOURCE_V4_BOUNDED_V3_FRAME_REPOSITORY_COUNT
  ) {
    throw new Error(
      "C6 source-v4 bounded v3 prefix repository row count mismatch",
    );
  }
  const normalizedNodeIds =
    assertUniqueRepositoryNodeIds(
      input.repositories,
      "normalized repository rows",
    );
  assertUniqueRepositoryNodeIds(
    input.frameRepositories,
    "frame repository rows",
  );
  if (
    input.frameRepositories.some(
      (row) =>
        !normalizedNodeIds.has(row.repositoryNodeId),
    )
  ) {
    throw new Error(
      "C6 source-v4 bounded frame repository row is outside normalized rows",
    );
  }
}

function assertFrameRowsMatchPrefix(
  rows:
    readonly C6SourceV4BoundedRepositoryCandidate[],
  expectedSha256: string,
): void {
  if (
    rows.length !==
      C6_SOURCE_V4_BOUNDED_V3_FRAME_REPOSITORY_COUNT ||
    hashJson(rows) !== expectedSha256
  ) {
    throw new Error(
      "C6 source-v4 bounded repository frame closure mismatch",
    );
  }
  assertUniqueRepositoryNodeIds(
    rows,
    "frame repository rows",
  );
}

function assertUniqueRepositoryNodeIds(
  rows:
    readonly C6SourceV4BoundedRepositoryCandidate[],
  label: string,
): Set<string> {
  const repositoryNodeIds = new Set<string>();
  for (const row of rows) {
    if (
      typeof row.repositoryNodeId !== "string" ||
      row.repositoryNodeId.length === 0 ||
      repositoryNodeIds.has(row.repositoryNodeId)
    ) {
      throw new Error(
        `C6 source-v4 bounded ${label} contain an invalid or duplicate repository node ID`,
      );
    }
    repositoryNodeIds.add(row.repositoryNodeId);
  }
  return repositoryNodeIds;
}

function hashCommittedRequestClosure(
  entries:
    readonly C6SourceV4BoundedV3CommittedRequest[],
): string {
  return sha256(entries.map((entry) => {
    assertExactKeys(
      entry,
      [
        "attemptNumber",
        "logicalRequestOrdinal",
        "request",
        "requestBodySha256",
        "requestCommittedSha256",
        "requestSha256",
      ],
      "C6 source-v4 bounded committed request entry keys",
    );
    if (
      !Number.isInteger(entry.logicalRequestOrdinal) ||
      entry.logicalRequestOrdinal < 1 ||
      !Number.isInteger(entry.attemptNumber) ||
      entry.attemptNumber < 1 ||
      entry.attemptNumber > 4
    ) {
      throw new Error(
        "C6 source-v4 bounded committed request entry ordinal mismatch",
      );
    }
    assertSha256(
      entry.requestCommittedSha256,
      "request-committed closure hash",
    );
    assertSha256(
      entry.requestSha256,
      "request closure hash",
    );
    assertSha256(
      entry.requestBodySha256,
      "request-body closure hash",
    );
    const request =
      verifyC6SourceV3SimpleDurableGraphqlRequest({
        body: entry.request.body,
        persistedRequest:
          entry.request.persistedRequest,
      });
    if (
      sha256(request.body) !==
        entry.requestBodySha256 ||
      entry.request.bodySha256 !==
        entry.requestBodySha256 ||
      sha256(canonicalJson(
        request.persistedRequest,
      )) !== entry.requestSha256
    ) {
      throw new Error(
        "C6 source-v4 bounded committed request payload hash mismatch",
      );
    }
    return [
      entry.logicalRequestOrdinal,
      entry.attemptNumber,
      entry.requestCommittedSha256,
      entry.requestSha256,
      entry.requestBodySha256,
    ].join("\u0000");
  }).join("\n"));
}

function assertSortedUniqueStrings(
  values: readonly string[],
  label: string,
): void {
  for (const [index, value] of values.entries()) {
    if (
      value.length === 0 ||
      (
        index > 0 &&
        compareUtf8(values[index - 1]!, value) >= 0
      )
    ) {
      throw new Error(
        `C6 source-v4 bounded ${label} are not sorted and unique`,
      );
    }
  }
}

function assertPilotExclusionReceipt(
  receipt: C6SourceV4BoundedPilotExclusionReceipt,
): void {
  if (
    receipt.excludedRepositoryNodeIdCount !==
      receipt.excludedRepositoryNodeIds.length ||
    receipt.excludedRepositoryNodeIdsSha256 !==
      hashJson(receipt.excludedRepositoryNodeIds)
  ) {
    throw new Error(
      "C6 source-v4 bounded pilot exclusion count/hash mismatch",
    );
  }
  for (
    let index = 1;
    index < receipt.excludedRepositoryNodeIds.length;
    index += 1
  ) {
    if (
      compareUtf8(
        receipt.excludedRepositoryNodeIds[index - 1]!,
        receipt.excludedRepositoryNodeIds[index]!,
      ) >= 0
    ) {
      throw new Error(
        "C6 source-v4 bounded pilot exclusion IDs are not sorted and unique",
      );
    }
  }
}

function assertSelectionReceipt(
  receipt: C6SourceV4BoundedSelectionReceipt,
): void {
  if (
    receipt.v4ContractSha256 !==
      C6_SOURCE_V4_BOUNDED_CONTRACT_SHA256
  ) {
    throw new Error(
      "C6 source-v4 bounded selection contract identity mismatch",
    );
  }
  if (
    receipt.selectedRepositoriesSha256 !==
      hashJson(receipt.selectedRepositories)
  ) {
    throw new Error(
      "C6 source-v4 bounded selection hash mismatch",
    );
  }
  const seenRepositoryNodeIds = new Set<string>();
  for (
    const [splitIndex, sourceSplit] of
    C6_SOURCE_V4_BOUNDED_LANGUAGE_SPLITS.entries()
  ) {
    const offset =
      splitIndex *
      C6_SOURCE_V4_BOUNDED_REPOSITORIES_PER_LANGUAGE;
    for (
      let index = 0;
      index <
        C6_SOURCE_V4_BOUNDED_REPOSITORIES_PER_LANGUAGE;
      index += 1
    ) {
      const repository =
        receipt.selectedRepositories[offset + index]!;
      const prior = index === 0
        ? undefined
        : receipt.selectedRepositories[
          offset + index - 1
        ];
      if (
        repository.sourceSplit !== sourceSplit ||
        repository.selectionRank !== index + 1 ||
        (
          prior !== undefined &&
          compareSelectedRepositories(
            prior,
            repository,
          ) >= 0
        )
      ) {
        throw new Error(
          "C6 source-v4 bounded selection rank/order mismatch",
        );
      }
      if (
        repository.repositoryRankSha256 !==
          computeC6SourceV4BoundedRepositoryRankSha256(
            sourceSplit,
            repository.repositoryNodeId,
          )
      ) {
        throw new Error(
          "C6 source-v4 bounded selection rank hash mismatch",
        );
      }
      if (
        seenRepositoryNodeIds.has(
          repository.repositoryNodeId,
        )
      ) {
        throw new Error(
          "C6 source-v4 bounded selection contains replacement",
        );
      }
      seenRepositoryNodeIds.add(
        repository.repositoryNodeId,
      );
    }
  }
}

function projectRepositoryCandidate(
  row: C6SourceV4BoundedRepositoryCandidate,
): C6SourceV4BoundedRepositoryCandidate {
  return {
    repositoryNodeId: row.repositoryNodeId,
    sourceSplit: row.sourceSplit,
  };
}

function compareSelectedRepositories(
  left: C6SourceV4BoundedSelectedRepository,
  right: C6SourceV4BoundedSelectedRepository,
): number {
  return compareUtf8(
    left.repositoryRankSha256,
    right.repositoryRankSha256,
  ) || compareUtf8(
    left.repositoryNodeId,
    right.repositoryNodeId,
  );
}

function loadBuiltV3PrefixReuseReceipt(
  receipt: C6SourceV4BoundedV3PrefixReuseReceipt,
): LoadedC6SourceV4BoundedV3PrefixReuseReceipt {
  return markVerifiedReceipt(
    parseC6SourceV4BoundedV3PrefixReuseReceipt(
      serializeC6SourceV4BoundedV3PrefixReuseReceipt(
        receipt,
      ),
    ),
  );
}

function loadBuiltPilotExclusionReceipt(
  receipt: C6SourceV4BoundedPilotExclusionReceipt,
): LoadedC6SourceV4BoundedPilotExclusionReceipt {
  return markVerifiedReceipt(
    parseC6SourceV4BoundedPilotExclusionReceipt(
      serializeC6SourceV4BoundedPilotExclusionReceipt(
        receipt,
      ),
    ),
  );
}

function loadBuiltSelectionReceipt(
  receipt: C6SourceV4BoundedSelectionReceipt,
): LoadedC6SourceV4BoundedSelectionReceipt {
  return markVerifiedReceipt(
    parseC6SourceV4BoundedSelectionReceipt(
      serializeC6SourceV4BoundedSelectionReceipt(
        receipt,
      ),
    ),
  );
}

function assertLoadedV3PrefixReuseReceipt(
  loaded:
    LoadedC6SourceV4BoundedV3PrefixReuseReceipt,
): void {
  assertVerifiedReceipt(
    loaded,
    "C6 source-v4 bounded v3 prefix receipt",
  );
  assertLoadedReceipt(
    loaded,
    serializeC6SourceV4BoundedV3PrefixReuseReceipt,
    "C6 source-v4 bounded v3 prefix receipt",
  );
}

function assertLoadedPilotExclusionReceipt(
  loaded:
    LoadedC6SourceV4BoundedPilotExclusionReceipt,
): void {
  assertVerifiedReceipt(
    loaded,
    "C6 source-v4 bounded pilot exclusion receipt",
  );
  assertLoadedReceipt(
    loaded,
    serializeC6SourceV4BoundedPilotExclusionReceipt,
    "C6 source-v4 bounded pilot exclusion receipt",
  );
}

function assertLoadedSelectionReceipt(
  loaded: LoadedC6SourceV4BoundedSelectionReceipt,
): void {
  assertVerifiedReceipt(
    loaded,
    "C6 source-v4 bounded selection receipt",
  );
  assertLoadedReceipt(
    loaded,
    serializeC6SourceV4BoundedSelectionReceipt,
    "C6 source-v4 bounded selection receipt",
  );
}

function assertParsedV3PrefixReuseReceipt(
  parsed:
    ParsedC6SourceV4BoundedV3PrefixReuseReceipt,
): void {
  assertLoadedReceipt(
    parsed,
    serializeC6SourceV4BoundedV3PrefixReuseReceipt,
    "C6 source-v4 bounded v3 prefix receipt",
  );
}

function assertParsedPilotExclusionReceipt(
  parsed:
    ParsedC6SourceV4BoundedPilotExclusionReceipt,
): void {
  assertLoadedReceipt(
    parsed,
    serializeC6SourceV4BoundedPilotExclusionReceipt,
    "C6 source-v4 bounded pilot exclusion receipt",
  );
}

function assertParsedSelectionReceipt(
  parsed:
    ParsedC6SourceV4BoundedSelectionReceipt,
): void {
  assertLoadedReceipt(
    parsed,
    serializeC6SourceV4BoundedSelectionReceipt,
    "C6 source-v4 bounded selection receipt",
  );
}

function assertVerifiedReceipt(
  loaded: object,
  label: string,
): void {
  if (
    !(
      VERIFIED_RECEIPT in loaded
    ) ||
    (
      loaded as {
        [VERIFIED_RECEIPT]?: unknown;
      }
    )[VERIFIED_RECEIPT] !== true
  ) {
    throw new Error(
      `${label} requires a verified receipt`,
    );
  }
}

function markVerifiedReceipt<
  T extends {
    receipt: unknown;
    sha256: string;
  },
>(
  parsed: T,
): T & {
  readonly [VERIFIED_RECEIPT]: true;
} {
  Object.defineProperty(
    parsed,
    VERIFIED_RECEIPT,
    {
      enumerable: false,
      value: true,
    },
  );
  return parsed as T & {
    readonly [VERIFIED_RECEIPT]: true;
  };
}

function assertLoadedReceipt<T>(
  loaded: {
    receipt: T;
    sha256: string;
  },
  serialize: (receipt: T) => string,
  label: string,
): void {
  assertExactKeys(
    loaded,
    ["receipt", "sha256"],
    `${label} loaded keys`,
  );
  assertSha256(loaded.sha256, `${label} SHA-256`);
  if (sha256(serialize(loaded.receipt)) !== loaded.sha256) {
    throw new Error(`${label} receipt SHA-256 mismatch`);
  }
}

function assertSameLoadedReceipt<T>(
  loaded: {
    receipt: T;
    sha256: string;
  },
  rebuilt: {
    receipt: T;
    sha256: string;
  },
  label: string,
): void {
  if (
    loaded.sha256 !== rebuilt.sha256 ||
    JSON.stringify(loaded.receipt) !==
      JSON.stringify(rebuilt.receipt)
  ) {
    throw new Error(
      `${label} does not equal the exact rebuilt receipt`,
    );
  }
}

function decodeCanonicalJsonInput(
  input: string | Uint8Array,
  label: string,
): string {
  try {
    return new TextDecoder("utf-8", {
      fatal: true,
    }).decode(Buffer.from(input));
  } catch {
    throw new Error(`${label} is not UTF-8`);
  }
}

function parseJson(
  text: string,
  label: string,
): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} is not JSON`);
  }
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function hashJson(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

function assertSha256(
  value: string,
  label: string,
): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(
      `C6 source-v4 bounded ${label} is not SHA-256`,
    );
  }
}

function assertExactKeys(
  value: object,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort(compareUtf8);
  const sortedExpected = [...expected].sort(compareUtf8);
  if (
    actual.length !== sortedExpected.length ||
    actual.some(
      (key, index) => key !== sortedExpected[index],
    )
  ) {
    throw new Error(`${label} mismatch`);
  }
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(
    Buffer.from(left),
    Buffer.from(right),
  );
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length &&
    left.every(
      (value, index) => value === right[index],
    );
}
